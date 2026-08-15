import { Agent, run } from "@openai/agents";
import { searchWebTool, fetchPageTool } from "../tools/index.js";
import { ResearchOutputSchema } from "../types/schemas.js";
import type { ResearchOutput } from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordCall } from "../utils/tokenTracker.js";
import "dotenv/config";

const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";

// Create the Research Agent
const researchAgent = new Agent({
    name: "Research Agent",
    model: MODEL,
    instructions: `
You are an expert research agent. Your job is to find accurate, 
specific information about a topic and return it in a structured format.

HOW TO DO YOUR JOB:
1. Search the web 3-4 times using different search queries
   - Start broad ("AI coding assistants overview")
   - Then get specific ("GitHub Copilot productivity statistics 2024")
   - Then search for recent news ("AI coding tools latest developments")

2. For the most useful search results, use fetch_page to read the full article
   - This gives you actual data, not just headlines

3. Classify each piece of information honestly:
   - FACT: Something stated clearly with a source
   - STATISTIC: A specific number or percentage with attribution
   - OPINION: Someone's view or prediction
   - INTERPRETATION: A conclusion drawn from data
   - UNCERTAIN: You found this but can't fully verify it

4. Be honest about what you could NOT find. List uncertainties.

5. Always record the URL where you found each piece of information.

IMPORTANT: Do not invent statistics or facts. Only report what you actually found.
`,

    tools: [searchWebTool, fetchPageTool],
    outputType: ResearchOutputSchema,
});

// Returns structured research data
export async function runResearchAgent(
    topic: string,
    audience: string,
    additionalQueries?: string[] // Used when Loop 1 asks for more targeted research
): Promise<ResearchOutput> {
    logSection("Research Agent");
    logAgent("Research Agent", `Researching: "${topic}"`);

    // Build the input message for the agent
    const inputMessage = additionalQueries && additionalQueries.length > 0
        ? `Research the following topic and return structured evidence.
       
Topic: ${topic}
Target audience: ${audience}

IMPORTANT: Also specifically search for these targeted queries (these are gaps 
identified from a previous research pass):
${additionalQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return your findings in the required structured format.`
        : `Research the following topic and return structured evidence.
       
Topic: ${topic}
Target audience: ${audience}

Search broadly first, then dig into the most useful sources for specific facts.
Return your findings in the required structured format.`;

    const startTime = Date.now();
    const result = await run(researchAgent, inputMessage);
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
        agentName: "Research Agent",
        model: MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cachedInputTokens: totalCachedTokens,
        durationMs,
    });

    logAgent("Research Agent", `Done — found ${result.finalOutput?.facts.length ?? 0} evidence items`);

    return result.finalOutput as ResearchOutput;
}
