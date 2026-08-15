import { z } from "zod"

export const ContentRequestSchema = z.object({
    topic: z.string().min(10).describe("The subject to research and write about"),
    platform: z
        .enum(["LinkedIn", "Twitter", "Instagram", "Newsletter", "Blog"])
        .describe("Target social media platform"),
    audience: z.string().describe("Who will read this content"),
    objective: z
        .enum(["Educational", "Promotional", "Inspirational", "Analytical", "Conversational"])
        .describe("Primary goal of the content"),
    style: z.string().describe("Desired tone and writing style"),
});

// RESEARCH AGENT OUTPUT

export const EvidenceTypeSchema = z.enum([
    "FACT",         // Verifiable, sourced claim
    "OPINION",      // Attributed view or perspective
    "STATISTIC",    // Numerical data point
    "INTERPRETATION",// Analysis or conclusion drawn from data
    "UNCERTAIN",    // Could not be fully verified
]);

export const SourceSchema = z.object({
    url: z.string().url(),
    title: z.string(),
    snippet: z.string(),    // Relevant excerpt from the source
    fetchedAt: z.string(), // ISO timestamp
});

export const EvidenceItemSchema = z.object({
    id: z.string(),                    // Unique ID, e.g. "ev_001"
    content: z.string(),               // The actual fact/data/insight
    type: EvidenceTypeSchema,
    source: SourceSchema,
    confidence: z.number().min(0).max(1), // 0.0 – 1.0
    relevance: z.number().min(0).max(1),  // How relevant to the topic
});

export const ResearchOutputSchema = z.object({
    topic: z.string(),
    facts: z.array(EvidenceItemSchema),
    keyInsights: z.array(z.string()),   // 3-5 most important takeaways
    uncertainties: z.array(z.string()), // Things the researcher couldn't verify
    sources: z.array(SourceSchema),
    searchQueries: z.array(z.string()), // What search queries were used
    researchedAt: z.string(),           // ISO timestamp
});

// STRATEGIST AGENT OUTPUT

export const ContentOutlineItemSchema = z.object({
    section: z.string(),       // e.g. "Hook", "Core argument", "CTA"
    keyPoints: z.array(z.string()),
    evidenceIds: z.array(z.string()), // Which evidence items to use here
});
export const ContentStrategySchema = z.object({
    audience: z.string(),
    angle: z.string(),         // The specific lens/framing
    hook: z.string(),          // The opening hook idea
    outline: z.array(ContentOutlineItemSchema),
    keyPoints: z.array(z.string()),
    avoidList: z.array(z.string()), // Topics/claims to exclude (not enough evidence)
    platformGuidelines: z.object({
        platform: z.string(),
        maxLength: z.number(),
        tone: z.string(),
        formatNotes: z.string(),
    }),
});

//WRITER AGENT OUTPUT
export const GeneratedContentSchema = z.object({
    content: z.string(),        // The actual post text
    platform: z.string(),
    wordCount: z.number(),
    claimsUsed: z.array(z.string()), // Which evidence IDs this content draws from
    version: z.number(),        // 1 = initial, 2+ = revised
    revisionNotes: z.string().optional(), // Why it was revised (if applicable)
});

//FACT CHECKER AGENT OUTPUT

export const VerificationStatusSchema = z.enum([
    "SUPPORTED",           // Evidence clearly backs the claim
    "PARTIALLY_SUPPORTED", // Evidence partially supports it
    "UNSUPPORTED",         // No evidence found for this claim
    "CONTRADICTED",        // Evidence contradicts the claim
    "UNVERIFIABLE",        // Cannot determine either way
]);

export const ClaimVerificationSchema = z.object({
    claimId: z.string(),
    claimText: z.string(),
    evidence: z.string(),      // The supporting/contradicting evidence text
    sourceUrl: z.string(),
    status: VerificationStatusSchema,
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),     // Why this status was assigned
});

export const FactCheckOutputSchema = z.object({
    verifications: z.array(ClaimVerificationSchema),
    supportRate: z.number().min(0).max(1),  // Fraction of SUPPORTED claims
    unsupportedClaims: z.array(z.string()), // Claims that need fixing
    contradictedClaims: z.array(z.string()),
    overallReliability: z.number().min(0).max(10),
    requiresReResearch: z.boolean(),        // Triggers Loop 1 if true
    targetedQueries: z.array(z.string()),   // If re-research needed, what to search for
});

//CRITIC AGENT OUTPUT
export const EvaluationScoresSchema = z.object({
    factualAccuracy: z.number().min(0).max(10),
    relevance: z.number().min(0).max(10),
    informationDensity: z.number().min(0).max(10),
    clarity: z.number().min(0).max(10),
    originality: z.number().min(0).max(10),
    platformFit: z.number().min(0).max(10),
    audienceFit: z.number().min(0).max(10),
    overall: z.number().min(0).max(10),
});

export const CriticOutputSchema = z.object({
    scores: EvaluationScoresSchema,
    strengths: z.array(z.string()),
    problems: z.array(z.string()),
    recommendedChanges: z.array(z.string()),
    requiresRevision: z.boolean(),  // Triggers Loop 2 if true
    revisionPriority: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

//PIPELINE RESULT

export const PipelineResultSchema = z.object({
    // Final content
    finalContent: GeneratedContentSchema,
    // Supporting data
    research: ResearchOutputSchema,
    strategy: ContentStrategySchema,
    factCheck: FactCheckOutputSchema,
    evaluation: CriticOutputSchema,
    // Pipeline metadata
    meta: z.object({
        totalRevisions: z.number(),
        totalEvidenceLoops: z.number(),
        pipelineVersion: z.string(),
        runId: z.string(),
        startedAt: z.string(),
        completedAt: z.string(),
    }),
});


//TOKEN & COST TRACKING
export interface AgentCallRecord {
    agentName: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;  // Prompt-cached tokens (50% cheaper)
    costUSD: number;
    durationMs: number;
    timestamp: string;
}

export interface RunCostSummary {
    calls: AgentCallRecord[];
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUSD: number;
    totalDurationMs: number;
    costBreakdownByAgent: Record<string, number>;
}

//PLATFORM CONSTRAINTS ──────────────────────────────────
export const PLATFORM_CONSTRAINTS = {
    LinkedIn: {
        maxChars: 3000,
        tone: "Professional but personable",
        formatNotes: "Use line breaks between sections. Hashtags at end (3-5). Hook in first line.",
    },
    Twitter: {
        maxChars: 280,
        tone: "Punchy, direct",
        formatNotes: "One strong idea. Optional thread. No jargon.",
    },
    Instagram: {
        maxChars: 2200,
        tone: "Visual, conversational",
        formatNotes: "First line is the hook. Use emojis sparingly. CTA at end.",
    },
    Newsletter: {
        maxChars: 5000,
        tone: "Conversational expert",
        formatNotes: "Subheadings for scanning. Include a key takeaway. Link to sources.",
    },
    Blog: {
        maxChars: 8000,
        tone: "Authoritative, educational",
        formatNotes: "H2/H3 structure. Include introduction and conclusion. Cite sources inline.",
    },
} as const;

export type ContentRequest = z.infer<typeof ContentRequestSchema>
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>
export type ContentStrategy = z.infer<typeof ContentStrategySchema>
export type GeneratedContent = z.infer<typeof GeneratedContentSchema>
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type ClaimVerification = z.infer<typeof ClaimVerificationSchema>
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>
export type EvaluationScores = z.infer<typeof EvaluationScoresSchema>
export type CriticOutput = z.infer<typeof CriticOutputSchema>
export type PipelineResult = z.infer<typeof PipelineResultSchema>