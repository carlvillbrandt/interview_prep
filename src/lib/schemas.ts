import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Domain enums                                                        */
/* ------------------------------------------------------------------ */

export const INDUSTRY_SLUGS = [
  "investment-banking",
  "venture-capital",
  "consulting",
] as const;
export const IndustrySlugSchema = z.enum(INDUSTRY_SLUGS);
export type IndustrySlug = z.infer<typeof IndustrySlugSchema>;

export const LEVELS = [
  "Intern",
  "Working Student",
  "Summer Analyst",
  "Analyst",
  "Entry-level Consultant",
  "Experienced Consultant",
  "Associate",
  "MBA Associate",
  "Senior Associate",
  "Principal",
  "Vice President",
] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

/** Levels offered in setup per industry; the first is the default. */
export const LEVELS_BY_INDUSTRY: Record<IndustrySlug, readonly Level[]> = {
  "investment-banking": ["Summer Analyst", "Analyst", "Associate", "MBA Associate", "Vice President"],
  "venture-capital": ["Intern", "Analyst", "Associate", "Senior Associate", "Principal"],
  consulting: ["Intern", "Working Student", "Entry-level Consultant", "Experienced Consultant", "MBA Associate"],
};

export const FOCUSES = ["Mixed", "Behavioral", "Technical"] as const;
export const FocusSchema = z.enum(FOCUSES);
export type Focus = z.infer<typeof FocusSchema>;

export const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a kebab-case slug");

/* ------------------------------------------------------------------ */
/* API request payloads                                                */
/* ------------------------------------------------------------------ */

export const StartInterviewRequestSchema = z
  .object({
    industry: IndustrySlugSchema,
    company: SlugSchema,
    level: LevelSchema.optional(),
    focus: FocusSchema.default("Mixed"),
    candidateName: z
      .string()
      .trim()
      .max(60)
      .regex(/^[\p{L}\p{M}' .-]*$/u, "letters, spaces, apostrophes and hyphens only")
      .optional()
      .transform((v) => (v ? v : undefined)),
    /** Plain text extracted from the candidate's CV by POST /api/cv (optional). */
    cvText: z.string().max(12_000).optional(),
  })
  .transform((r) => ({ ...r, level: r.level ?? LEVELS_BY_INDUSTRY[r.industry][0] }))
  .refine((r) => LEVELS_BY_INDUSTRY[r.industry].includes(r.level), {
    message: "is not a level offered for this industry",
    path: ["level"],
  });
export type StartInterviewRequest = z.infer<typeof StartInterviewRequestSchema>;

export const CvExtractResponseSchema = z.object({
  text: z.string(),
  pages: z.number().int().nonnegative(),
  truncated: z.boolean(),
  fileName: z.string(),
});
export type CvExtractResponse = z.infer<typeof CvExtractResponseSchema>;

export const StartInterviewResponseSchema = z.object({
  conversationId: z.string(),
  conversationUrl: z.url(),
  maxDurationSeconds: z.number().int().positive(),
  interviewerName: z.string().optional(),
});
export type StartInterviewResponse = z.infer<typeof StartInterviewResponseSchema>;

export const ConversationIdSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "invalid conversation id");

export const EndInterviewRequestSchema = z.object({
  conversationId: ConversationIdSchema,
  reason: z
    .enum(["user", "timeout", "interviewer_left", "tab_closed", "error"])
    .optional(),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().default(true),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

export const TranscriptTurnSchema = z.object({
  role: z.enum(["interviewer", "candidate"]),
  content: z.string(),
  secondsFromStart: z.number().optional(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export const HIRE_SIGNALS = [
  "Strong No Hire",
  "No Hire",
  "Lean Hire",
  "Hire",
  "Strong Hire",
] as const;
export const HireSignalSchema = z.enum(HIRE_SIGNALS);
export type HireSignal = z.infer<typeof HireSignalSchema>;

export const CATEGORY_KEYS = [
  "communication_clarity",
  "structure_and_logic",
  "technical_or_case_competence",
  "firm_and_role_motivation",
  "behavioral_evidence",
  "poise_and_professionalism",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  communication_clarity: "Communication clarity",
  structure_and_logic: "Structure & logic",
  technical_or_case_competence: "Technical / case competence",
  firm_and_role_motivation: "Firm & role motivation",
  behavioral_evidence: "Behavioral evidence",
  poise_and_professionalism: "Poise & professionalism",
};

const CategoryScoreSchema = z.object({
  score: z.number().int().min(1).max(10),
  comment: z.string().min(1),
});

/** The validated, final scoring payload stored and shown to the candidate. */
export const ScoringResultSchema = z.object({
  overall_score: z.number().min(1).max(10),
  hire_signal: HireSignalSchema,
  categories: z.object({
    communication_clarity: CategoryScoreSchema,
    structure_and_logic: CategoryScoreSchema,
    technical_or_case_competence: CategoryScoreSchema,
    firm_and_role_motivation: CategoryScoreSchema,
    behavioral_evidence: CategoryScoreSchema,
    poise_and_professionalism: CategoryScoreSchema,
  }),
  strengths: z.array(z.string().min(1)).min(1).max(6),
  improvements: z.array(z.string().min(1)).min(1).max(6),
  key_moments: z
    .array(
      z.object({
        quote: z.string().min(1),
        issue: z.string().min(1),
        better_answer: z.string().min(1),
      }),
    )
    .max(5),
  next_steps: z.array(z.string().min(1)).length(3),
  summary: z.string().min(1),
});
export type ScoringResult = z.infer<typeof ScoringResultSchema>;

/* ------------------------------------------------------------------ */
/* Stored interview record                                             */
/* ------------------------------------------------------------------ */

export const INTERVIEW_STATUSES = [
  "active",
  /** Call finished and no written scorecard is produced (scoring disabled). Terminal. */
  "ended",
  "processing",
  "complete",
  "insufficient_data",
  "failed",
] as const;
export const InterviewStatusSchema = z.enum(INTERVIEW_STATUSES);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

export const InterviewRecordSchema = z.object({
  conversationId: ConversationIdSchema,
  industry: IndustrySlugSchema,
  company: SlugSchema,
  companyName: z.string(),
  level: LevelSchema,
  focus: FocusSchema,
  candidateName: z.string().optional(),
  status: InterviewStatusSchema,
  createdAt: z.string(),
  endedAt: z.string().optional(),
  endReason: z.string().optional(),
  completedAt: z.string().optional(),
  transcript: z.array(TranscriptTurnSchema).optional(),
  perception: z.string().optional(),
  perceptionAvailable: z.boolean().default(false),
  scoring: ScoringResultSchema.optional(),
  /** Human-readable reason for insufficient_data / failed. */
  message: z.string().optional(),
  scoringModel: z.string().optional(),
});
export type InterviewRecord = z.infer<typeof InterviewRecordSchema>;

/** Shape returned by GET /api/interview/[id]/result. Never includes secrets. */
export type PublicInterviewResult = Omit<InterviewRecord, "perception">;
