// src/utils/tokenTracker.ts
// Tracks token usage and calculates cost for every agent call
//
// WHY: Every OpenAI API call uses tokens. Tokens cost money.
// We track this so we know exactly how much each agent costs
// and ensure we stay within our $2-3 budget.

import { logCost, logWarn, logSection } from "./logger.js";

// OpenAI pricing — USD per 1 million tokens (as of Aug 2026)
// Source: platform.openai.com/docs/pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o":      { input: 2.50, output: 10.00 },
};

// Returns the pricing (per 1 Million tokens) for a given model.
// Prioritizes environment variables to allow dynamic override without code changes.
export function getModelPricing(model: string): { input: number; output: number } {
  const customInput = process.env.CUSTOM_MODEL_INPUT_PRICE;
  const customOutput = process.env.CUSTOM_MODEL_OUTPUT_PRICE;

  if (customInput && customOutput) {
    const inputVal = parseFloat(customInput);
    const outputVal = parseFloat(customOutput);
    if (!isNaN(inputVal) && !isNaN(outputVal)) {
      return { input: inputVal, output: outputVal };
    }
  }

  // Fallback to static pricing table
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    logWarn(`No pricing found for model "${model}". Using gpt-4o-mini default pricing.`);
    return MODEL_PRICING["gpt-4o-mini"]!;
  }

  return pricing;
}

// Each agent call gets recorded here
type AgentCall = {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUSD: number;
  durationMs: number;
};

// All calls for the current pipeline run
const calls: AgentCall[] = [];

// Clear all records — call this at the start of each run
export function resetTracker() {
  calls.length = 0;
}

// Record one agent call and calculate its cost
export function recordCall(params: {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  durationMs: number;
}) {
  const { input: inputPrice, output: outputPrice } = getModelPricing(params.model);

  const cachedCount = params.cachedInputTokens ?? 0;
  const standardInputCount = Math.max(0, params.inputTokens - cachedCount);

  // Cost formula:
  // (tokens used / 1,000,000) × price per million
  // Prompt cache hits get a 50% discount from standard input price
  const inputCost  = (standardInputCount / 1_000_000) * inputPrice;
  const cachedCost = (cachedCount / 1_000_000) * (inputPrice * 0.5);
  const outputCost = (params.outputTokens / 1_000_000) * outputPrice;
  const totalCost  = inputCost + cachedCost + outputCost;

  // Save this call
  calls.push({
    agentName:   params.agentName,
    model:       params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cachedInputTokens: cachedCount,
    costUSD:     totalCost,
    durationMs:  params.durationMs,
  });

  // Print it immediately so you can see cost in real-time
  const cachedStr = cachedCount > 0 ? ` (cached: ${cachedCount})` : "";
  logCost(
    `${params.agentName} → ` +
    `${params.inputTokens} in${cachedStr} + ${params.outputTokens} out tokens = ` +
    `$${totalCost.toFixed(5)} (${params.durationMs}ms)`
  );
}

// Print a summary of all costs at the end of a run
export function printCostSummary() {
  logSection("💰 Run Cost Summary");

  // Add up totals
  let totalInput    = 0;
  let totalCached   = 0;
  let totalOutput   = 0;
  let totalCost     = 0;
  let totalDuration = 0;

  for (const call of calls) {
    totalInput    += call.inputTokens;
    totalCached   += call.cachedInputTokens;
    totalOutput   += call.outputTokens;
    totalCost     += call.costUSD;
    totalDuration += call.durationMs;
  }

  // Show per-agent breakdown
  console.log("Cost per agent:");
  for (const call of calls) {
    const cacheInfo = call.cachedInputTokens > 0 ? ` [cached: ${call.cachedInputTokens}]` : "";
    console.log(`  ${call.agentName.padEnd(18)} $${call.costUSD.toFixed(5)}${cacheInfo}`);
  }

  // Show totals
  console.log("\n--- Totals ---");
  logCost(`Input tokens   : ${totalInput.toLocaleString()}${totalCached > 0 ? ` (cached: ${totalCached.toLocaleString()})` : ""}`);
  logCost(`Output tokens  : ${totalOutput.toLocaleString()}`);
  logCost(`Total API calls: ${calls.length}`);
  logCost(`Total time     : ${(totalDuration / 1000).toFixed(1)}s`);
  logCost(`TOTAL COST     : $${totalCost.toFixed(5)}`);

  // Budget check — warn if over 80% of $3 budget
  const BUDGET = 3.00;
  const percentUsed = (totalCost / BUDGET) * 100;

  if (percentUsed > 80) {
    logWarn(`You've used ${percentUsed.toFixed(1)}% of your $${BUDGET} budget!`);
  } else {
    logCost(`Budget used: ${percentUsed.toFixed(1)}% of $${BUDGET}`);
  }
}

// Return all recorded calls (used by the pipeline to save results)
export function getAllCalls(): AgentCall[] {
  return [...calls];
}

// Return the total cost so far
export function getTotalCost(): number {
  return calls.reduce((sum, call) => sum + call.costUSD, 0);
}
