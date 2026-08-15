import OpenAI from "openai";
import { recordCall, getModelPricing } from "../utils/tokenTracker.js";
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
  const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;

  // Calculate cost using dynamic rates from the pricing module (prompt caching gets a 50% discount)
  const pricing = getModelPricing(MODEL);
  const cachedPrice = pricing.input * 0.5;
  const standardInputCount = Math.max(0, inputTokens - cachedTokens);

  const inputCost  = (standardInputCount / 1_000_000) * pricing.input;
  const cachedCost = (cachedTokens / 1_000_000) * cachedPrice;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const costUSD    = inputCost + cachedCost + outputCost;

  recordCall({
    agentName: "Baseline (single LLM)",
    model: MODEL,
    inputTokens,
    outputTokens,
    cachedInputTokens: cachedTokens,
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
