import OpenAI from "openai";
import { recordCall } from "../utils/tokenTracker.js";
import { logSection, logInfo, logCost } from "../utils/logger.js";
import type { ContentRequest } from "../types/schemas.js";
import "dotenv/config";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";

export type BaselineResult = {
  content: string;
  platform: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  durationMs: number;
};

// Run the baseline — one API call, no research, no fact checking
export async function runBaseline(request: ContentRequest): Promise<BaselineResult> {
  logSection("Baseline (Single LLM Call)");
  logInfo("Running baseline — no research, no agents, just one LLM call");

  const prompt = `
Write a ${request.platform} post about the following topic.

Topic: ${request.topic}
Audience: ${request.audience}
Objective: ${request.objective}
Style: ${request.style}

Write the post now.
`;

  const startTime = Date.now();

  // Direct API call — no agents, no tools, no structured output
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are a social media content writer. Write platform-appropriate content.`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  const durationMs = Date.now() - startTime;

  const content = response.choices[0]?.message.content ?? "";
  const inputTokens  = response.usage?.prompt_tokens     ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  // Calculate cost using the same pricing as our tracker
  const inputCost  = (inputTokens  / 1_000_000) * 0.15;
  const outputCost = (outputTokens / 1_000_000) * 0.60;
  const costUSD    = inputCost + outputCost;

  recordCall({
    agentName: "Baseline (single LLM)",
    model: MODEL,
    inputTokens,
    outputTokens,
    durationMs,
  });

  logInfo(`Baseline complete in ${durationMs}ms`);
  logCost(`Baseline cost: $${costUSD.toFixed(5)}`);

  console.log("\n=== BASELINE OUTPUT ===\n");
  console.log(content);

  return {
    content,
    platform: request.platform,
    model: MODEL,
    inputTokens,
    outputTokens,
    costUSD,
    durationMs,
  };
}
