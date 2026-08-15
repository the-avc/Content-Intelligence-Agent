// src/agents/writer.ts
// The Writer Agent — generates the actual social media content
//
// This agent runs in TWO modes:
//
// Mode 1 — Initial write:
//   Gets research + strategy → writes a first draft
//
// Mode 2 — Revision:
//   Gets the existing draft + critic feedback → rewrites it
//   This is how Loop 2 (quality loop) works

import { Agent, run } from "@openai/agents";
import { GeneratedContentSchema, PLATFORM_CONSTRAINTS } from "../types/schemas.js";
import type {
    ResearchOutput,
    ContentStrategy,
    ContentRequest,
    GeneratedContent,
    CriticOutput,
} from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordCall } from "../utils/tokenTracker.js";
import "dotenv/config";

const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";

const writerAgent = new Agent({
    name: "Writer Agent",
    model: MODEL,

    instructions: `
You are a skilled content writer who creates platform-specific social media content.
You write based on provided research and a content strategy — you do NOT invent facts.

CORE RULES:
1. Only use facts and statistics from the provided research evidence
2. Do not add statistics or claims that aren't in the research
3. Follow the platform format guidelines exactly (length, tone, structure)
4. Write for the specific audience described
5. Use the hook and outline from the strategy as your guide
6. Reference the evidence IDs you used in claimsUsed field

WHEN REVISING:
- Read the critic's feedback carefully
- Address every problem mentioned
- Keep what was working (the strengths)
- Do not just rephrase the same content — actually improve it
`,

    outputType: GeneratedContentSchema,
});

// Mode 1: Write the initial draft
export async function runWriterAgent(
    request: ContentRequest,
    research: ResearchOutput,
    strategy: ContentStrategy,
    version: number = 1
): Promise<GeneratedContent> {
    logSection("Writer Agent");
    logAgent("Writer Agent", `Writing version ${version} for ${request.platform}`);

    const platformInfo = PLATFORM_CONSTRAINTS[request.platform];

    // Build a lookup of evidence by ID so the writer knows what facts to use
    const evidenceLookup = research.facts
        .map(f => `[${f.id}] ${f.content} (Source: ${f.source.title})`)
        .join("\n");

    const inputMessage = `
Write a ${request.platform} post based on the following:

CONTENT REQUIREMENTS:
- Platform: ${request.platform}
- Audience: ${request.audience}
- Objective: ${request.objective}
- Style: ${request.style}
- Max length: ${platformInfo.maxChars} characters
- Format: ${platformInfo.formatNotes}

CONTENT STRATEGY TO FOLLOW:
- Angle: ${strategy.angle}
- Hook idea: ${strategy.hook}
- Outline:
${strategy.outline.map((s, i) => `  ${i + 1}. ${s.section}: ${s.keyPoints.join(", ")}`).join("\n")}

- DO NOT include: ${strategy.avoidList.join(", ")}

AVAILABLE EVIDENCE (only use these facts):
${evidenceLookup}

Write the post now. Track which evidence IDs you used in claimsUsed.`;

    const startTime = Date.now();
    const result = await run(writerAgent, inputMessage);
    const durationMs = Date.now() - startTime;

    // Aggregate token usage across all model turns
    // (RunResult has no top-level .usage; it lives in each rawResponse)
    const totalInputTokens = result.rawResponses.reduce(
        (sum, r) => sum + (r.usage?.inputTokens ?? 0),
        0
    );
    const totalOutputTokens = result.rawResponses.reduce(
        (sum, r) => sum + (r.usage?.outputTokens ?? 0),
        0
    );

    recordCall({
        agentName: `Writer Agent (v${version})`,
        model: MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
    });

    const output = result.finalOutput as GeneratedContent;
    logAgent("Writer Agent", `Draft written — ${output.wordCount} words`);

    return { ...output, version };
}

// Mode 2: Revise based on critic feedback (used in Loop 2)
export async function runWriterRevision(
    request: ContentRequest,
    research: ResearchOutput,
    currentContent: GeneratedContent,
    criticFeedback: CriticOutput,
    version: number
): Promise<GeneratedContent> {
    logSection("Writer Agent (Revision)");
    logAgent("Writer Agent", `Revising — version ${version} based on critic feedback`);

    const platformInfo = PLATFORM_CONSTRAINTS[request.platform];

    const evidenceLookup = research.facts
        .map(f => `[${f.id}] ${f.content} (Source: ${f.source.title})`)
        .join("\n");

    const inputMessage = `
Revise the following ${request.platform} post based on critic feedback.

CURRENT POST (version ${version - 1}):
${currentContent.content}

WHAT WAS GOOD (keep these):
${criticFeedback.strengths.map((s, i) => `${i + 1}. ${s}`).join("\n")}

PROBLEMS TO FIX:
${criticFeedback.problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}

SPECIFIC CHANGES REQUESTED:
${criticFeedback.recommendedChanges.map((c, i) => `${i + 1}. ${c}`).join("\n")}

PLATFORM REQUIREMENTS:
- Max length: ${platformInfo.maxChars} characters  
- Format: ${platformInfo.formatNotes}

AVAILABLE EVIDENCE (only use these facts):
${evidenceLookup}

Write an improved version that addresses all the problems listed.`;

    const startTime = Date.now();
    const result = await run(writerAgent, inputMessage);
    const durationMs = Date.now() - startTime;

    // Aggregate token usage across all model turns
    // (RunResult has no top-level .usage; it lives in each rawResponse)
    const totalInputTokens = result.rawResponses.reduce(
        (sum, r) => sum + (r.usage?.inputTokens ?? 0),
        0
    );
    const totalOutputTokens = result.rawResponses.reduce(
        (sum, r) => sum + (r.usage?.outputTokens ?? 0),
        0
    );

    recordCall({
        agentName: `Writer Agent (v${version})`,
        model: MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
    });

    const output = result.finalOutput as GeneratedContent;
    logAgent("Writer Agent", `Revision complete — version ${version}`);

    return {
        ...output,
        version,
        revisionNotes: `Revised based on critic feedback: ${criticFeedback.problems.join("; ")}`,
    };
}

// Mode 3: Rewrite with new evidence (used in Loop 1)
// Different from Mode 2 (revision) — the problem here is MISSING EVIDENCE,
// not writing quality. The Writer needs to know which claims lacked support
// and use the new research to back them up properly.
export async function runWriterWithNewEvidence(
  request: ContentRequest,
  research: ResearchOutput,       // the MERGED research (old + new facts)
  currentContent: GeneratedContent,
  unsupportedClaims: string[],    // from fact checker — what was wrong
  version: number
): Promise<GeneratedContent> {
  logSection("Writer Agent (Evidence Rewrite)");
  logAgent("Writer Agent", `Rewriting with new evidence — version ${version}`);

  const platformInfo = PLATFORM_CONSTRAINTS[request.platform];

  // Show the writer ALL available evidence after merging
  const evidenceLookup = research.facts
    .map(f => `[${f.id}] ${f.content} (Source: ${f.source.title})`)
    .join("\n");

  const inputMessage = `
Rewrite the following ${request.platform} post.
The previous version had claims that could not be verified — fix those 
using the new evidence provided below.

PREVIOUS POST (for reference):
${currentContent.content}

CLAIMS THAT WERE UNSUPPORTED (these need to be fixed or removed):
${unsupportedClaims.map((c, i) => `${i + 1}. ${c}`).join("\n") || "None listed"}

INSTRUCTIONS:
- Remove or replace any unsupported claims
- Use the new evidence below to back up your statements
- Keep the same structure and angle if it was good
- Stay within platform limits: ${platformInfo.maxChars} characters
- Format: ${platformInfo.formatNotes}

ALL AVAILABLE EVIDENCE (old + new facts merged):
${evidenceLookup}

Write the improved version now.`;

  const startTime = Date.now();
  const result = await run(writerAgent, inputMessage);
  const durationMs = Date.now() - startTime;

  const totalInputTokens = result.rawResponses.reduce(
    (sum, r) => sum + (r.usage?.inputTokens ?? 0), 0
  );
  const totalOutputTokens = result.rawResponses.reduce(
    (sum, r) => sum + (r.usage?.outputTokens ?? 0), 0
  );

  recordCall({
    agentName: `Writer Agent (evidence-v${version})`,
    model: MODEL,
    inputTokens:  totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs,
  });

  const output = result.finalOutput as GeneratedContent;
  logAgent("Writer Agent", `Evidence rewrite complete — version ${version}`);

  return {
    ...output,
    version,
    revisionNotes: `Rewritten with new evidence. Fixed claims: ${unsupportedClaims.join("; ")}`,
  };
}
