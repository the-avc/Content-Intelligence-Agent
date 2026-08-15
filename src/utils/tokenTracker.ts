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

// Each agent call gets recorded here
type AgentCall = {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
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
  durationMs: number;
}) {
  // Look up the price for this model
  const pricing = MODEL_PRICING[params.model];

  if (!pricing) {
    logWarn(`No pricing found for model "${params.model}". Using gpt-4o-mini pricing.`);
  }

  const { input: inputPrice, output: outputPrice } = pricing ?? MODEL_PRICING["gpt-4o-mini"]!;

  // Cost formula:
  // (tokens used / 1,000,000) × price per million
  const inputCost  = (params.inputTokens  / 1_000_000) * inputPrice;
  const outputCost = (params.outputTokens / 1_000_000) * outputPrice;
  const totalCost  = inputCost + outputCost;

  // Save this call
  calls.push({
    agentName:   params.agentName,
    model:       params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costUSD:     totalCost,
    durationMs:  params.durationMs,
  });

  // Print it immediately so you can see cost in real-time
  logCost(
    `${params.agentName} → ` +
    `${params.inputTokens} in + ${params.outputTokens} out tokens = ` +
    `$${totalCost.toFixed(5)} (${params.durationMs}ms)`
  );
}

// Print a summary of all costs at the end of a run
export function printCostSummary() {
  logSection("💰 Run Cost Summary");

  // Add up totals
  let totalInput    = 0;
  let totalOutput   = 0;
  let totalCost     = 0;
  let totalDuration = 0;

  for (const call of calls) {
    totalInput    += call.inputTokens;
    totalOutput   += call.outputTokens;
    totalCost     += call.costUSD;
    totalDuration += call.durationMs;
  }

  // Show per-agent breakdown
  console.log("Cost per agent:");
  for (const call of calls) {
    console.log(`  ${call.agentName.padEnd(18)} $${call.costUSD.toFixed(5)}`);
  }

  // Show totals
  console.log("\n--- Totals ---");
  logCost(`Input tokens   : ${totalInput.toLocaleString()}`);
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
