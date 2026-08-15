// src/main.ts
// Command-line entry point to run the pipeline, baseline, or side-by-side comparison

import { runContentPipeline } from "./pipeline/contentPipeline.js";
import { runBaseline } from "./evaluation/baseline.js";
import { compareResults, saveExperiment } from "./evaluation/metrics.js";
import { logError, logSection } from "./utils/logger.js";
import type { ContentRequest } from "./types/schemas.js";
import "dotenv/config";

// The default request from the project specification
const defaultRequest: ContentRequest = {
  topic: "Impact of AI coding assistants on software development",
  platform: "LinkedIn",
  audience: "Computer science students and software developers",
  objective: "Educational",
  style: "Technical but understandable",
};

async function main() {
  // Guard clause to make sure keys are present
  if (!process.env.OPENAI_API_KEY) {
    logError("API Key Missing: Please add OPENAI_API_KEY to your .env file.");
    process.exit(1);
  }

  // Parse command line flags
  const args = process.argv.slice(2);
  const mode = args[0] || "--pipeline"; // default to running the pipeline

  try {
    if (mode === "--baseline") {
      // Mode A: Run baseline only
      await runBaseline(defaultRequest);

    } else if (mode === "--pipeline") {
      // Mode B: Run multi-agent pipeline only
      await runContentPipeline(defaultRequest);

    } else if (mode === "--compare" || mode === "--experiment") {
      // Mode C: Run both and generate comparison metrics
      logSection("Starting Experiment: Baseline vs Multi-Agent Pipeline");

      // 1. Run baseline
      const baselineResult = await runBaseline(defaultRequest);

      // 2. Run pipeline & measure time
      const pipelineStart = Date.now();
      const pipelineResult = await runContentPipeline(defaultRequest);
      const pipelineDuration = Date.now() - pipelineStart;

      // 3. Calculate comparison metrics
      const comparison = compareResults(
        defaultRequest.topic,
        baselineResult,
        pipelineResult,
        pipelineDuration
      );

      // Save comparison experiment as JSON
      saveExperiment(comparison);

    } else {
      console.log("Usage commands:");
      console.log("  npm start                 - Run the multi-agent pipeline (default)");
      console.log("  npm start -- --baseline   - Run the single LLM baseline");
      console.log("  npm start -- --compare    - Run both and print comparison table");
    }
  } catch (error) {
    logError(`An error occurred during execution: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main();
