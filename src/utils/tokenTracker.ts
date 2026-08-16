import { logCost, logWarn, logSection } from "./logger.js";

// Source: platform.openai.com/docs/pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o":      { input: 2.50, output: 10.00 },
};

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

// Helper to abstract boilerplate from agent files
export function recordAgentResult(params: {
  agentName: string;
  model: string;
  result: any; // RunResult from @openai/agents
  durationMs: number;
}) {
  const totalInputTokens = params.result.rawResponses.reduce(
    (sum: number, r: any) => sum + (r.usage?.inputTokens ?? 0), 0
  );
  const totalOutputTokens = params.result.rawResponses.reduce(
    (sum: number, r: any) => sum + (r.usage?.outputTokens ?? 0), 0
  );
  const totalCachedTokens = params.result.rawResponses.reduce(
    (sum: number, r: any) => {
      const details = r.usage?.inputTokensDetails;
      if (Array.isArray(details)) {
        return sum + details.reduce((s: number, d: any) => s + (d.cached_tokens ?? 0), 0);
      }
      return sum;
    }, 0
  );

  recordCall({
    agentName: params.agentName,
    model: params.model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cachedInputTokens: totalCachedTokens,
    durationMs: params.durationMs,
  });
}

// Print a summary of all costs at the end of a run
export function printCostSummary() {
  logSection("💰 Run Cost Summary");

  let totalInput = 0, totalCached = 0, totalOutput = 0, totalCost = 0, totalDuration = 0;

  for (const call of calls) {
    totalInput    += call.inputTokens;
    totalCached   += call.cachedInputTokens;
    totalOutput   += call.outputTokens;
    totalCost     += call.costUSD;
    totalDuration += call.durationMs;
    
    const cacheInfo = call.cachedInputTokens > 0 ? ` [cached: ${call.cachedInputTokens}]` : "";
    console.log(`  ${call.agentName.padEnd(25)} $${call.costUSD.toFixed(5)}${cacheInfo}`);
  }

  console.log(`\n  TOTAL: $${totalCost.toFixed(5)} (${calls.length} calls, ${(totalDuration / 1000).toFixed(1)}s)`);
}

// Return all recorded calls (used by the pipeline to save results)
export function getAllCalls(): AgentCall[] {
  return [...calls];
}

// Return the total cost so far
export function getTotalCost(): number {
  return calls.reduce((sum, call) => sum + call.costUSD, 0);
}
