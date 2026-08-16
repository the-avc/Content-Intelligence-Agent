import { Agent, run } from "@openai/agents";
import { CriticOutputSchema } from "../types/schemas.js";
import type {
  GeneratedContent,
  ContentRequest,
  FactCheckOutput,
  CriticOutput,
} from "../types/schemas.js";
import { logAgent, logSection } from "../utils/logger.js";
import { recordAgentResult } from "../utils/tokenTracker.js";
import "dotenv/config";

const MODEL = process.env.PRIMARY_MODEL ?? "gpt-4o-mini";
const EVALUATOR_MODEL = process.env.EVALUATOR_MODEL ?? MODEL;

const criticAgent = new Agent({
  name: "Critic Agent",
  model: EVALUATOR_MODEL,

  instructions: `
You are a critical content evaluator. You assess social media content 
objectively and provide specific, actionable feedback.

SCORING GUIDE (0-10 for each dimension):
- factualAccuracy: Are all claims supported by evidence? No unsupported stats?
- relevance: Does it stay on topic? Does it serve the stated objective?
- informationDensity: Does it contain useful, specific information? Or is it vague?
- clarity: Is it easy to read and understand? No jargon without explanation?
- originality: Is the angle fresh? Or is it a generic take everyone has seen?
- platformFit: Does the format match the platform? Right length, right tone?
- audienceFit: Does it speak to the specific audience described?
- overall: Your honest overall assessment

WHAT TO LOOK FOR:
Problems that should lower the score:
- Generic opening lines ("In today's world..." or "AI is transforming...")
- Statistics mentioned without context
- Weak or vague conclusions
- Content too long or too short for the platform
- Technical terms unexplained for a non-technical audience
- Claims that were marked UNSUPPORTED or CONTRADICTED by fact checker

Set requiresRevision = true if overall score < 7.0
Provide specific, actionable recommendedChanges — not vague suggestions.
Bad feedback: "Make it better"
Good feedback: "Replace the opening line with a specific statistic from the research"
`,

  outputType: CriticOutputSchema,
});

export async function runCriticAgent(
  request: ContentRequest,
  content: GeneratedContent,
  factCheck: FactCheckOutput
): Promise<CriticOutput> {
  logSection("Critic Agent");
  logAgent("Critic Agent", "Evaluating content quality...");

  // Give the critic the fact check results so it can factor them into scoring
  const factCheckSummary =
    `Support rate: ${(factCheck.supportRate * 100).toFixed(0)}%\n` +
    `Unsupported claims: ${factCheck.unsupportedClaims.join(", ") || "none"}\n` +
    `Contradicted claims: ${factCheck.contradictedClaims.join(", ") || "none"}`;

  const inputMessage = `
Evaluate the following ${request.platform} content.

CONTENT TO EVALUATE:
${content.content}

CONTENT REQUIREMENTS:
- Platform: ${request.platform}
- Audience: ${request.audience}
- Objective: ${request.objective}
- Style: ${request.style}

FACT CHECK RESULTS (factor these into your factualAccuracy score):
${factCheckSummary}

Score this content on all dimensions and provide specific feedback.
Set requiresRevision = true if overall score is below 7.0.`;

  const startTime = Date.now();
  const result = await run(criticAgent, inputMessage);
  const durationMs = Date.now() - startTime;

  recordAgentResult({
    agentName: "Critic Agent",
    model: EVALUATOR_MODEL,
    result,
    durationMs,
  });

  const output = result.finalOutput as CriticOutput;

  logAgent(
    "Critic Agent",
    `Score: ${output.scores.overall}/10 | ` +
    `Requires revision: ${output.requiresRevision} | ` +
    `Priority: ${output.revisionPriority}`
  );

  return output;
}
