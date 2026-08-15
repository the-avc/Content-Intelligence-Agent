// src/agents/strategist.ts
// The Strategist Agent — turns research into a content plan
//
// This agent does NOT search the web. It reads the research output
// from the Research Agent and decides HOW to present that information.
//
// What it decides:
// - What angle to take (the specific framing of the content)
// - What the opening hook should be
// - What points to cover and in what order
// - What to AVOID (claims with weak evidence)

import { Agent, run } from "@openai/agents";
import { ContentStrategySchema, PLATFORM_CONSTRAINTS } from "../types/schemas.js";
import type { ResearchOutput, ContentRequest, ContentStrategy } from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordCall } from "../utils/tokenTracker.js";
import "dotenv/config";

const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";

const strategistAgent = new Agent({
    name: "Strategist Agent",
    model: MODEL,

    instructions: `
You are a content strategist. You receive research data and turn it into 
a clear content plan — a blueprint the Writer will follow.

YOUR JOB:
1. Read all the research facts and evidence provided
2. Identify the single strongest angle for the content
   - What is most interesting or surprising?
   - What does this specific audience care about most?
3. Write a compelling hook idea (the opening line concept)
4. Create a content outline — what sections and in what order
5. List which evidence items should be used for each section
6. List what to AVOID — claims that are uncertain or weakly supported

IMPORTANT RULE: 
If a fact is marked as UNCERTAIN or has low confidence, put it in avoidList.
The Writer should not use uncertain information in the content.

Think about the platform format when creating the outline.
LinkedIn posts are different from blog posts — adjust accordingly.
`,

    // No tools — this agent only thinks, it doesn't search
    outputType: ContentStrategySchema,
});

export async function runStrategistAgent(
    request: ContentRequest,
    research: ResearchOutput
): Promise<ContentStrategy> {
    logSection("Strategist Agent");
    logAgent("Strategist Agent", `Planning content strategy for: ${request.platform}`);

    // Get the platform constraints so the strategist knows the limits
    const platformInfo = PLATFORM_CONSTRAINTS[request.platform];

    // Build a clear summary of the research to pass to the strategist
    const researchSummary = research.facts
        .map(f => `[${f.id}] [${f.type}] [confidence: ${f.confidence}] ${f.content} (Source: ${f.source.url})`)
        .join("\n");

    const inputMessage = `
Create a content strategy for the following:

CONTENT REQUEST:
- Topic: ${request.topic}
- Platform: ${request.platform}
- Audience: ${request.audience}
- Objective: ${request.objective}
- Style: ${request.style}

PLATFORM CONSTRAINTS:
- Max characters: ${platformInfo.maxChars}
- Tone: ${platformInfo.tone}
- Format notes: ${platformInfo.formatNotes}

RESEARCH EVIDENCE (use these evidence IDs in your outline):
${researchSummary}

KEY INSIGHTS FROM RESEARCH:
${research.keyInsights.map((k, i) => `${i + 1}. ${k}`).join("\n")}

UNCERTAIN ITEMS (avoid these):
${research.uncertainties.map((u, i) => `${i + 1}. ${u}`).join("\n")}

Return a structured content strategy.`;

    const startTime = Date.now();
    const result = await run(strategistAgent, inputMessage);
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
        agentName: "Strategist Agent",
        model: MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
    });

    logAgent("Strategist Agent", `Strategy ready — angle: "${result.finalOutput?.angle}"`);

    return result.finalOutput as ContentStrategy;
}
