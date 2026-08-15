// src/agents/researcher.ts
// The Research Agent — finds facts and evidence about a topic
//
// This is the ONLY agent that uses tools (search + fetch page).
// All other agents reason over data — this one goes out and GETS it.
//
// What it does:
// 1. Takes a topic and audience as input
// 2. Searches the web multiple times with different queries
// 3. Reads full pages to extract detailed evidence
// 4. Returns a structured list of facts, sources, and insights

import { Agent, run } from "@openai/agents";
import { searchWebTool, fetchPageTool } from "../tools/index.js";
import { ResearchOutputSchema } from "../types/schemas.js";
import type { ResearchOutput } from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordCall } from "../utils/tokenTracker.js";
import "dotenv/config";

const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";

// Create the Research Agent
// Think of this like hiring a researcher with specific instructions
const researchAgent = new Agent({
    name: "Research Agent",
    model: MODEL,

    // Instructions = the agent's job description
    // Be specific — vague instructions = vague output
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

    // Attach the tools this agent can use
    tools: [searchWebTool, fetchPageTool],

    // Tell the SDK what shape the output should be
    // The agent will format its response to match this schema
    outputType: ResearchOutputSchema,
});

// The function you call to run the Research Agent
// Returns structured research data
export async function runResearchAgent(
    topic: string,
    audience: string,
    additionalQueries?: string[] // Used when Loop 1 asks for more targeted research
): Promise<ResearchOutput> {
    logSection("Research Agent");
    logAgent("Research Agent", `Researching: "${topic}"`);

    // Build the input message for the agent
    // This is what the agent reads as its task
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

    // Run the agent — the SDK handles the tool calls automatically
    // The agent will call search_web and fetch_page as many times as it needs
    const result = await run(researchAgent, inputMessage);

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

    // Record token usage for cost tracking
    recordCall({
        agentName: "Research Agent",
        model: MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
    });

    logAgent("Research Agent", `Done — found ${result.finalOutput?.facts.length ?? 0} evidence items`);

    // finalOutput is already typed as ResearchOutput because of outputType above
    return result.finalOutput as ResearchOutput;
}
