import { runResearchAgent } from "../agents/researcher.js";
import { runStrategistAgent } from "../agents/strategist.js";
import { runWriterAgent, runWriterRevision, runWriterWithNewEvidence } from "../agents/writer.js";
import { runFactCheckerAgent } from "../agents/factChecker.js";
import { runCriticAgent } from "../agents/critic.js";

import { loadFromCache, saveToCache } from "../utils/cache.js";
import { initLogger, logInfo, logSuccess, logWarn, logLoop, logSection, saveResultToFile } from "../utils/logger.js";
import { resetTracker, printCostSummary, getAllCalls } from "../utils/tokenTracker.js";

import type {
    ContentRequest,
    PipelineResult,
    ResearchOutput,
    EvidenceItem,
} from "../types/schemas.js";

import crypto from "crypto";
import "dotenv/config";

const MAX_EVIDENCE_LOOPS = parseInt(process.env.MAX_EVIDENCE_LOOPS ?? "2");
const MAX_REVISION_LOOPS = parseInt(process.env.MAX_REVISION_LOOPS ?? "2");
const EVIDENCE_THRESHOLD = parseFloat(process.env.EVIDENCE_THRESHOLD ?? "0.5");
const QUALITY_THRESHOLD = parseFloat(process.env.QUALITY_THRESHOLD ?? "7.0");

export async function runContentPipeline(request: ContentRequest): Promise<PipelineResult> {

    // Create a unique ID for this run (used for log file names)
    const runId = crypto.randomBytes(4).toString("hex");
    const startedAt = new Date().toISOString();

    // Set up logger and cost tracker for this run
    initLogger(runId);
    resetTracker();

    logInfo(`Starting pipeline for topic: "${request.topic}"`);
    logInfo(`Platform: ${request.platform} | Audience: ${request.audience}`);

    // ─── STEP 1: RESEARCH ──────────────────────────────────────
    // Check cache first — if we researched this topic recently, skip the API call
    logSection("Step 1: Research");

    let research: ResearchOutput | null = loadFromCache(request.topic);

    if (!research) {
        research = await runResearchAgent(request.topic, request.audience);
        saveToCache(request.topic, research);
    }

    // ─── STEP 2: STRATEGY ──────────────────────────────────────
    logSection("Step 2: Content Strategy");
    const strategy = await runStrategistAgent(request, research);

    // ─── STEP 3 + LOOP 1: WRITE → FACT CHECK → RE-RESEARCH ────
    // This loop ensures the content is grounded in evidence.
    // If the fact checker finds < 70% of claims are supported,
    // we go back and research more, then rewrite.
    logSection("Step 3: Write + Fact Check (Evidence Loop)");

    let currentContent = await runWriterAgent(request, research, strategy, 1);
    let factCheckResult = await runFactCheckerAgent(currentContent, research);

    let evidenceLoopCount = 0;

    // LOOP 1 triggers if EITHER:
    // - the agent itself flagged re-research is needed (requiresReResearch)
    // - OR the support rate is below our configurable EVIDENCE_THRESHOLD
    while (
        (factCheckResult.requiresReResearch || factCheckResult.supportRate < EVIDENCE_THRESHOLD) &&
        evidenceLoopCount < MAX_EVIDENCE_LOOPS
    ) {
        evidenceLoopCount++;
        logLoop(
            "Evidence Gap",
            evidenceLoopCount,
            `Only ${(factCheckResult.supportRate * 100).toFixed(0)}% of claims supported. ` +
            `Re-researching with targeted queries...`
        );

        // Ask the researcher to fill in the specific gaps
        const additionalResearch = await runResearchAgent(
            request.topic,
            request.audience,
            factCheckResult.targetedQueries // These are the specific queries the fact checker suggested
        );

        if (!research) {
            throw new Error("Research data is missing");
        }

        // Merge the new facts into the existing research
        const existingIds: Set<string> = new Set(research.facts.map(f => f.id));
        const newFacts: EvidenceItem[] = additionalResearch.facts.filter(f => !existingIds.has(f.id));

        research = {
            ...research,
            facts: [...research.facts, ...newFacts],
            sources: [...research.sources, ...additionalResearch.sources],
            keyInsights: [...new Set([...research.keyInsights, ...additionalResearch.keyInsights])],
        };

        logInfo(`Merged ${newFacts.length} new facts into research (total: ${research.facts.length})`);

        // Rewrite with the improved research
        currentContent = await runWriterWithNewEvidence(
            request,
            research,
            currentContent,  // the existing draft
            factCheckResult.unsupportedClaims, // the specific claims that failed
            evidenceLoopCount + 1
        );
        factCheckResult = await runFactCheckerAgent(currentContent, research);
    }

    if (evidenceLoopCount > 0) {
        logSuccess(`Evidence loop completed after ${evidenceLoopCount} retries`);
    }

    if (factCheckResult.requiresReResearch) {
        logWarn(
            `Evidence loop limit reached (${MAX_EVIDENCE_LOOPS}). ` +
            `Final support rate: ${(factCheckResult.supportRate * 100).toFixed(0)}%`
        );
    }

    // ─── STEP 4 + LOOP 2: CRITIQUE → REVISE ───────────────────
    // This loop ensures the content is high quality.
    // If the critic scores it below 7.0, the Writer revises it.
    logSection("Step 4: Critique + Revision (Quality Loop)");

    let criticResult = await runCriticAgent(request, currentContent, factCheckResult);
    let revisionCount = 0;

    // LOOP 2 triggers if EITHER:
    // - the critic flagged revision is needed (requiresRevision)
    // - OR the score is below our configurable QUALITY_THRESHOLD
    while (
        (criticResult.requiresRevision || criticResult.scores.overall < QUALITY_THRESHOLD) &&
        revisionCount < MAX_REVISION_LOOPS
    ) {
        revisionCount++;
        logLoop(
            "Quality",
            revisionCount,
            `Score: ${criticResult.scores.overall}/10 — below threshold of ${QUALITY_THRESHOLD}. Revising...`
        );

        // Send the content back to the Writer with the critic's feedback
        currentContent = await runWriterRevision(
            request,
            research,
            currentContent,
            criticResult,
            currentContent.version + 1
        );

        // After revision, re-check facts and re-evaluate
        factCheckResult = await runFactCheckerAgent(currentContent, research);
        criticResult = await runCriticAgent(request, currentContent, factCheckResult);
    }

    if (revisionCount > 0) {
        logSuccess(`Quality loop completed after ${revisionCount} revision(s)`);
    }

    const finalScore = criticResult.scores.overall;

    if (finalScore >= QUALITY_THRESHOLD) {
        logSuccess(`Content approved — final score: ${finalScore}/10`);
    } else {
        logWarn(
            `Revision limit reached (${MAX_REVISION_LOOPS}). ` +
            `Best score achieved: ${finalScore}/10`
        );
    }

    // ─── STEP 5: PACKAGE FINAL RESULT ─────────────────────────
    const completedAt = new Date().toISOString();

    const result: PipelineResult = {
        finalContent: currentContent,
        research,
        strategy,
        factCheck: factCheckResult,
        evaluation: criticResult,
        meta: {
            totalRevisions: revisionCount,
            totalEvidenceLoops: evidenceLoopCount,
            pipelineVersion: "1.0.0",
            runId,
            startedAt,
            completedAt,
        },
    };

    // ─── STEP 6: PRINT SUMMARY ────────────────────────────────
    logSection("Pipeline Complete");

    console.log("\n=== FINAL CONTENT ===\n");
    console.log(currentContent.content);
    console.log("\n=== EVALUATION ===");
    console.log(`Factual Accuracy:    ${criticResult.scores.factualAccuracy}/10`);
    console.log(`Relevance:           ${criticResult.scores.relevance}/10`);
    console.log(`Information Density: ${criticResult.scores.informationDensity}/10`);
    console.log(`Clarity:             ${criticResult.scores.clarity}/10`);
    console.log(`Platform Fit:        ${criticResult.scores.platformFit}/10`);
    console.log(`Overall Score:       ${criticResult.scores.overall}/10`);
    console.log("\n=== FACT CHECK ===");
    console.log(`Claims verified:     ${factCheckResult.verifications.length}`);
    console.log(`Support rate:        ${(factCheckResult.supportRate * 100).toFixed(0)}%`);
    console.log(`Unsupported claims:  ${factCheckResult.unsupportedClaims.length}`);
    console.log("\n=== SOURCES USED ===");
    research.sources.slice(0, 5).forEach((s, i) => {
        console.log(`${i + 1}. ${s.title} — ${s.url}`);
    });

    // Print and save cost summary
    printCostSummary();

    // Save the full result as a JSON file in logs/
    saveResultToFile(runId, {
        ...result,
        costSummary: getAllCalls(),
    });

    return result;
}
