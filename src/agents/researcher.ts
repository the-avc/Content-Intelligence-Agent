import { tavily } from "@tavily/core";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ResearchOutputSchema } from "../types/schemas.js";
import type { ResearchOutput } from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordCall } from "../utils/tokenTracker.js";
import "dotenv/config";

// Convert the Zod schema into a standard JSON Schema for Tavily
const rawSchema = zodToJsonSchema(ResearchOutputSchema, { $refStrategy: "none" }) as any;

// Tavily is extremely strict and will reject the schema if it contains "additionalProperties"
// anywhere in the schema tree. We recursively remove it.
function removeAdditionalProperties(obj: any) {
    if (Array.isArray(obj)) {
        obj.forEach(removeAdditionalProperties);
    } else if (obj !== null && typeof obj === 'object') {
        delete obj.additionalProperties;
        for (const key in obj) {
            removeAdditionalProperties(obj[key]);
        }
    }
}
removeAdditionalProperties(rawSchema);

const outputSchema = {
    properties: rawSchema.properties,
    required: rawSchema.required,
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runResearchAgent(
    topic: string,
    audience: string,
    additionalQueries?: string[]
): Promise<ResearchOutput> {
    logSection("Research Agent (Powered by Tavily)");
    logAgent("Research Agent", `Researching: "${topic}"`);

    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
        throw new Error("TAVILY_API_KEY is not set in environment variables");
    }

    const tvly = tavily({ apiKey: tavilyKey });

    const inputMessage = additionalQueries && additionalQueries.length > 0
        ? `Research the following topic: ${topic}. 
Target audience: ${audience}.
Also specifically search for these targeted queries (these are gaps identified from a previous research pass):
${additionalQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        : `Research the following topic: ${topic}.
Target audience: ${audience}.`;

    const startTime = Date.now();

    // 1. Kick off the asynchronous research task
    logAgent("Research Agent", "Initiating deep research task (this saves tokens by using Tavily native!)...");
    const researchRes = await tvly.research(inputMessage, {
        model: "pro", // 'pro' model for comprehensive multi-angle research
        outputSchema: outputSchema,
        citationFormat: "numbered", // Ensures sources match up well
    }) as any; // Typecasting since the SDK types might vary

    const requestId = researchRes.requestId;
    if (!requestId) {
        throw new Error("Failed to get requestId from Tavily Research API.");
    }
    
    logAgent("Research Agent", `Task started. Job ID: ${requestId}. Polling...`);

    // 2. Poll for completion
    let content: any = null;
    let pollCount = 0;
    while (true) {
        await delay(10000); // Poll every 10 seconds
        pollCount++;
        
        const pollRes = await tvly.getResearch(requestId) as any;
        if (pollRes.status === "completed" || pollRes.status === "success") {
            content = pollRes.content;
            break;
        } else if (pollRes.status === "failed" || pollRes.status === "error") {
            throw new Error("Tavily research task failed.");
        }
        
        if (pollCount % 2 === 0) {
            logAgent("Research Agent", `Still researching... (Status: ${pollRes.status})`);
        }
        
        if (pollCount > 30) {
            throw new Error("Tavily research task timed out (took > 5 minutes).");
        }
    }

    const durationMs = Date.now() - startTime;
    
    // 3. Parse it back to Zod to ensure type safety
    let parsedData: ResearchOutput;
    try {
        if (typeof content === "string") {
            content = JSON.parse(content);
        }
        parsedData = ResearchOutputSchema.parse(content);
    } catch (e) {
        console.error(e);
        logAgent("Research Agent", "Warning: Failed strict schema parse, using loose data.");
        parsedData = content as ResearchOutput;
    }

    // 4. Record cost (using dummy 0 values since Tavily handles the LLM cost natively)
    recordCall({
        agentName: "Tavily Research API",
        model: "tavily-pro",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        durationMs,
    });

    logAgent("Research Agent", `Done ?" found ${parsedData.facts?.length ?? 0} evidence items in ${Math.round(durationMs/1000)}s`);

    return parsedData;
}
