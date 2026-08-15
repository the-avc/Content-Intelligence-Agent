import type { PipelineResult } from "../types/schemas.js";
import type { BaselineResult } from "./baseline.js";
import { logSection } from "../utils/logger.js";
import { getTotalCost } from "../utils/tokenTracker.js";
import fs from "fs";
import path from "path";

export type ComparisonResult = {
    topic: string;
    platform: string;

    baseline: {
        content: string;
        costUSD: number;
        durationMs: number;
        wordCount: number;
    };

    pipeline: {
        content: string;
        costUSD: number;
        durationMs: number;
        wordCount: number;
        overallScore: number;
        factualAccuracy: number;
        supportRate: number;
        totalRevisions: number;
        totalEvidenceLoops: number;
    };

    // Differences (positive = pipeline is better)
    comparison: {
        costDifferenceUSD: number;       // pipeline cost - baseline cost (pipeline usually costs more)
        speedDifferenceSec: number;      // pipeline time - baseline time (pipeline is slower)
        qualityScore: number;            // pipeline overall score (baseline has no score)
        factSupportRate: number;         // pipeline claim support % (baseline has no verification)
    };
};

// Compare baseline vs pipeline and print a clear report
export function compareResults(
    topic: string,
    baseline: BaselineResult,
    pipeline: PipelineResult,
    pipelineDurationMs: number
): ComparisonResult {
    logSection("Comparison: Baseline vs Multi-Agent Pipeline");

    // Count words simply
    const baselineWords = baseline.content.split(/\s+/).filter(w => w.length > 0).length;
    const pipelineWords = pipeline.finalContent.content.split(/\s+/).filter(w => w.length > 0).length;

    // Total pipeline cost = sum of all agent calls
    const pipelineCost = getTotalCost() - baseline.costUSD;
    const result: ComparisonResult = {
        topic,
        platform: baseline.platform,

        baseline: {
            content: baseline.content,
            costUSD: baseline.costUSD,
            durationMs: baseline.durationMs,
            wordCount: baselineWords,
        },

        pipeline: {
            content: pipeline.finalContent.content,
            costUSD: pipelineCost,
            durationMs: pipelineDurationMs,
            wordCount: pipelineWords,
            overallScore: pipeline.evaluation.scores.overall,
            factualAccuracy: pipeline.evaluation.scores.factualAccuracy,
            supportRate: pipeline.factCheck.supportRate,
            totalRevisions: pipeline.meta.totalRevisions,
            totalEvidenceLoops: pipeline.meta.totalEvidenceLoops,
        },

        comparison: {
            costDifferenceUSD: pipelineCost - baseline.costUSD,
            speedDifferenceSec: (pipelineDurationMs - baseline.durationMs) / 1000,
            qualityScore: pipeline.evaluation.scores.overall,
            factSupportRate: pipeline.factCheck.supportRate,
        },
    };

    // Print side-by-side comparison to terminal
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║         BASELINE  vs  MULTI-AGENT PIPELINE       ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║ Topic: ${topic.substring(0, 42).padEnd(42)} ║`);
    console.log("╠══════════════════╦═══════════════╦═══════════════╣");
    console.log("║ Metric           ║   Baseline    ║   Pipeline    ║");
    console.log("╠══════════════════╬═══════════════╬═══════════════╣");
    console.log(`║ Cost (USD)       ║ $${baseline.costUSD.toFixed(5).padEnd(12)} ║ $${pipelineCost.toFixed(5).padEnd(12)} ║`);
    console.log(`║ Speed            ║ ${(baseline.durationMs / 1000).toFixed(1)}s          ║ ${(pipelineDurationMs / 1000).toFixed(1)}s          ║`);
    console.log(`║ Word count       ║ ${String(baselineWords).padEnd(13)} ║ ${String(pipelineWords).padEnd(13)} ║`);
    console.log(`║ Quality score    ║ N/A           ║ ${String(pipeline.evaluation.scores.overall + "/10").padEnd(13)} ║`);
    console.log(`║ Fact support     ║ N/A           ║ ${(pipeline.factCheck.supportRate * 100).toFixed(0).padEnd(10)}%   ║`);
    console.log(`║ Revisions        ║ 0             ║ ${String(pipeline.meta.totalRevisions).padEnd(13)} ║`);
    console.log(`║ Sources cited    ║ 0             ║ ${String(pipeline.research.sources.length).padEnd(13)} ║`);
    console.log("╚══════════════════╩═══════════════╩═══════════════╝");

    // Key takeaways
    console.log("\nKey findings:");

    if (pipeline.evaluation.scores.overall >= 7) {
        console.log(`  ✓ Pipeline produced quality content (${pipeline.evaluation.scores.overall}/10)`);
    } else {
        console.log(`  ✗ Pipeline score below threshold (${pipeline.evaluation.scores.overall}/10) — needs investigation`);
    }

    if (pipeline.factCheck.supportRate >= 0.7) {
        console.log(`  ✓ ${(pipeline.factCheck.supportRate * 100).toFixed(0)}% of claims verified against sources`);
    } else {
        console.log(`  ⚠ Only ${(pipeline.factCheck.supportRate * 100).toFixed(0)}% of claims supported — consider more research loops`);
    }

    console.log(`  ℹ Baseline: 1 API call | Pipeline: multiple calls + research + verification`);
    console.log(`  ℹ Pipeline sources: ${pipeline.research.sources.length} | Baseline sources: 0`);

    return result;
}

// Save experiment results to experimental/ folder for later analysis
export function saveExperiment(result: ComparisonResult) {
    const dir = path.join(process.cwd(), "experimental");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    const filename = `experiment_${Date.now()}.json`;
    const filePath = path.join(dir, filename);

    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    console.log(`\nExperiment saved → ${filePath}`);
}
