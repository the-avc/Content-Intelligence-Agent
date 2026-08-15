import { Agent, run } from "@openai/agents";
import { FactCheckOutputSchema } from "../types/schemas.js";
import type { GeneratedContent, ResearchOutput, FactCheckOutput } from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordCall } from "../utils/tokenTracker.js";
import "dotenv/config";

const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";
const EVALUATOR_MODEL = process.env.EVALUATOR_MODEL ?? MODEL;

const factCheckerAgent = new Agent({
    name: "Fact Checker Agent",
    model: EVALUATOR_MODEL,

    instructions: `
You are a rigorous fact checker. You verify factual claims in content 
against provided evidence.

YOUR PROCESS:
1. Read the content carefully
2. Extract every factual claim (statistics, dates, named facts, percentages)
3. For each claim, search the provided evidence list for support
4. Assign a verification status:
   - SUPPORTED: The evidence clearly backs this claim with a source
   - PARTIALLY_SUPPORTED: Evidence partially supports it but doesn't fully confirm
   - UNSUPPORTED: No evidence in the provided list covers this claim
   - CONTRADICTED: The evidence actually says something different
   - UNVERIFIABLE: The claim is too vague to verify either way

5. Assign a confidence score (0.0 to 1.0) for each verification

6. Calculate the overall supportRate (fraction of SUPPORTED claims out of all claims)

7. Set requiresReResearch = true if supportRate < 0.5
   Also provide targetedQueries — specific search queries that would find the missing evidence

IMPORTANT: 
- Only use the evidence provided — do not rely on your own training knowledge
- If a claim is not in the evidence, mark it UNSUPPORTED even if you know it's true
- This ensures the content is grounded in actual researched sources
`,

    outputType: FactCheckOutputSchema,
});

export async function runFactCheckerAgent(
    content: GeneratedContent,
    research: ResearchOutput
): Promise<FactCheckOutput> {
    logSection("Fact Checker Agent");
    logAgent("Fact Checker Agent", "Verifying claims in generated content...");

    // Format all evidence as a readable list for the agent
    const evidenceList = research.facts
        .map(f =>
            `[${f.id}] [${f.type}] ${f.content}\n` +
            `  Source: ${f.source.title} (${f.source.url})\n` +
            `  Snippet: ${f.source.snippet}`
        )
        .join("\n\n");

    const inputMessage = `
Fact-check the following content against the provided evidence.

CONTENT TO CHECK:
${content.content}

AVAILABLE EVIDENCE:
${evidenceList}

Extract every factual claim from the content and verify each one 
against the evidence above. Return structured verification results.`;

    const startTime = Date.now();
    const result = await run(factCheckerAgent, inputMessage);
    const durationMs = Date.now() - startTime;

    // Aggregate token usage across all model turns
    const totalInputTokens = result.rawResponses.reduce(
        (sum, r) => sum + (r.usage?.inputTokens ?? 0),
        0
    );
    const totalOutputTokens = result.rawResponses.reduce(
        (sum, r) => sum + (r.usage?.outputTokens ?? 0),
        0
    );
    const totalCachedTokens = result.rawResponses.reduce(
        (sum, r) => {
            const details = r.usage?.inputTokensDetails;
            if (Array.isArray(details)) {
                return sum + details.reduce((s, d) => s + (d.cached_tokens ?? 0), 0);
            }
            return sum;
        },
        0
    );

    recordCall({
        agentName: "Fact Checker Agent",
        model: EVALUATOR_MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cachedInputTokens: totalCachedTokens,
        durationMs,
    });

    const output = result.finalOutput as FactCheckOutput;

    logAgent(
        "Fact Checker Agent",
        `Done — support rate: ${(output.supportRate * 100).toFixed(0)}% | ` +
        `re-research needed: ${output.requiresReResearch}`
    );

    return output;
}
