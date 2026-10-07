import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Company } from "@/data/catalog";
import {
  CATEGORY_KEYS,
  HIRE_SIGNALS,
  ScoringResultSchema,
  type Focus,
  type HireSignal,
  type IndustrySlug,
  type Level,
  type ScoringResult,
  type TranscriptTurn,
} from "@/lib/schemas";
import {
  formatTranscript,
  MIN_SUBSTANTIVE_TURNS,
  quoteInCandidateTurns,
  substantiveCandidateTurns,
} from "@/lib/transcript";

/** Newest Sonnet at build time (DECISIONS.md §7). */
export const SCORING_MODEL = "claude-sonnet-5-5";

/* ------------------------------------------------------------------ */
/* Output schema sent to Claude (kept free of numeric/length bounds,   */
/* which structured outputs don't enforce; we enforce them afterwards) */
/* ------------------------------------------------------------------ */

const ModelCategorySchema = z.object({ score: z.number(), comment: z.string() });

export const ModelScoringSchema = z.object({
  overall_score: z.number(),
  hire_signal: z.enum(HIRE_SIGNALS),
  categories: z.object({
    communication_clarity: ModelCategorySchema,
    structure_and_logic: ModelCategorySchema,
    technical_or_case_competence: ModelCategorySchema,
    firm_and_role_motivation: ModelCategorySchema,
    behavioral_evidence: ModelCategorySchema,
    poise_and_professionalism: ModelCategorySchema,
  }),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  key_moments: z.array(z.object({ quote: z.string(), issue: z.string(), better_answer: z.string() })),
  next_steps: z.array(z.string()),
  summary: z.string(),
});
export type ModelScoring = z.infer<typeof ModelScoringSchema>;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

export function hireSignalFor(score: number): HireSignal {
  if (score < 4) return "Strong No Hire";
  if (score < 5.5) return "No Hire";
  if (score < 7) return "Lean Hire";
  if (score < 8.5) return "Hire";
  return "Strong Hire";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface PostProcessResult {
  /** Null if the model output can't be made valid (caller retries). */
  scoring: ScoringResult | null;
  /** Quotes that could not be found verbatim in the candidate's turns. */
  unverifiedQuotes: string[];
  validationError?: string;
}

/**
 * Normalises raw model output: rounds/clamps scores, derives the hire signal from the
 * overall score, verifies each quote against the candidate's turns (dropping any that
 * don't match), and validates the final shape with Zod.
 */
export function postProcessScoring(raw: ModelScoring, transcript: TranscriptTurn[]): PostProcessResult {
  const unverifiedQuotes: string[] = [];
  const key_moments = raw.key_moments.filter((m) => {
    const ok = quoteInCandidateTurns(m.quote, transcript);
    if (!ok) unverifiedQuotes.push(m.quote);
    return ok;
  });

  const overall = Math.round(clamp(raw.overall_score, 1, 10) * 10) / 10;
  const categories = Object.fromEntries(
    CATEGORY_KEYS.map((k) => [
      k,
      { score: Math.round(clamp(raw.categories[k].score, 1, 10)), comment: raw.categories[k].comment.trim() },
    ]),
  ) as ScoringResult["categories"];

  const candidate = {
    overall_score: overall,
    hire_signal: hireSignalFor(overall),
    categories,
    strengths: raw.strengths.map((s) => s.trim()).filter(Boolean).slice(0, 6),
    improvements: raw.improvements.map((s) => s.trim()).filter(Boolean).slice(0, 6),
    key_moments: key_moments.slice(0, 5),
    next_steps: raw.next_steps.map((s) => s.trim()).filter(Boolean).slice(0, 3),
    summary: raw.summary.trim(),
  };
  const parsed = ScoringResultSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      scoring: null,
      unverifiedQuotes,
      validationError: `${issue.path.join(".")}: ${issue.message}`,
    };
  }
  return { scoring: parsed.data, unverifiedQuotes };
}

/* ------------------------------------------------------------------ */
/* Rubrics                                                             */
/* ------------------------------------------------------------------ */

const INDUSTRY_RUBRIC: Record<IndustrySlug, string> = {
  "investment-banking": `Investment banking rubric:
- Technical: accuracy on accounting (three statements and how they link, e.g. depreciation flowing through all three), enterprise vs equity value, valuation methods (comps, precedents, DCF), DCF mechanics (unlevered FCF, WACC, terminal value), LBO logic (leverage, returns drivers, IRR intuition), accretion/dilution. A wrong accounting treatment or valuation error is a significant deduction. Heavily penalize confident but wrong answers.
- Fit: crisp "walk me through your resume" (≈90 seconds, logical narrative ending at banking), specific "why this bank / why this group" grounded in real differentiators, evidence of work ethic, attention to detail and teamwork.
- Communication: concise, numbers stated clearly, answer first and then support.`,
  "venture-capital": `Venture capital / private equity rubric:
- Technical / judgment: structured market sizing (top-down and bottom-up, sanity checks), clear investment thesis (market, team, product, moat, why now), ability to "pitch a company" with risks and what would have to be true, understanding of fund economics/returns (power law, ownership, IRR/MOIC for PE), unit economics, and diligence questions. Penalize hype without evidence and theses that ignore key risks.
- Fit: genuine, specific interest in the firm's strategy, stage and portfolio; sourcing instincts and network; an evidence-based point of view on sectors.
- Communication: opinionated but open to challenge; separates facts from assumptions.`,
  consulting: `Consulting rubric:
- Case: clarifying questions, a MECE and hypothesis-driven structure tailored to the problem (not a generic framework), clean quantitative work with stated assumptions, synthesis that answers the question with a recommendation, risks and next steps. Penalize arithmetic errors, unstructured brainstorming and failure to synthesize.
- Personal experience / fit: specific, structured stories (situation → actions → result → reflection) showing leadership, impact, influencing others, and drive; clear personal contribution ("I" not "we").
- Communication: top-down (answer first), signposted, concise; handles interviewer pushback constructively.`,
};

function buildSystemPrompt(): string {
  return `You are a senior interviewer and interview coach who evaluates mock interview transcripts for PrepRoom, a practice platform. You score candidates the way a calibrated hiring committee would, and you write feedback a candidate can act on immediately.

Evidence rules (strict):
- Score only on what is in the transcript. Do not assume answers the candidate did not give. Unanswered or skipped questions count against the relevant category.
- Every "quote" in key_moments must be copied character-for-character from a single CANDIDATE turn: a contiguous span of 5–40 words, with no paraphrasing, no ellipses, and nothing from the interviewer.
- Speech-to-text artefacts (filler words, small transcription glitches) are not the candidate's fault; don't penalize them, and don't treat odd transcribed words as factual errors unless the meaning is clearly wrong.
- Visual or tone observations (eye contact, body language, confidence of voice) are allowed ONLY if a perception analysis is supplied below. If it is not supplied, make no visual or vocal-delivery claims at all.

Calibration (use the full 1–10 range):
- 9–10: exceptional, would clearly receive an offer; rare in practice.
- 7–8: strong mock interview: solid structure, mostly accurate, specific motivation.
- 5–6: mixed: some good moments with notable gaps (rambling, shaky technicals, generic motivation).
- 3–4: weak: little structure, factual errors, vague or missing answers.
- 1–2: did not meaningfully engage.
Penalize rambling, lack of structure, factual/technical errors, and unanswered questions. Be honest rather than flattering. Most mock interviews land between 4 and 8.

Category guidance:
- communication_clarity: concise, clear, easy to follow, answer-first.
- structure_and_logic: organised answers, frameworks fitted to the question, logical flow.
- technical_or_case_competence: accuracy and depth on the technical/case/pitch portion. If no such question was asked, score it 5 and say it was not assessed.
- firm_and_role_motivation: specific, credible reasons for this firm and role.
- behavioral_evidence: concrete stories with personal actions and results.
- poise_and_professionalism: composure under pushback, courtesy, recovery from mistakes (visual cues only if a perception analysis is supplied).

Output requirements:
- overall_score: one decimal place, holistic (not a plain average), consistent with the category scores.
- hire_signal: Strong No Hire (<4), No Hire (4–5.4), Lean Hire (5.5–6.9), Hire (7–8.4), Strong Hire (≥8.5).
- Each category comment: 1–2 sentences referencing specific evidence.
- strengths and improvements: 2–4 items each, specific to this transcript, not generic advice.
- key_moments: 2–4 moments; each with the verbatim quote, the issue (or why it worked), and a concrete better answer the candidate could have said, written in the first person as a spoken answer.
- next_steps: exactly 3 concrete practice actions (what to drill, how, and how to know it's fixed).
- summary: 2–3 sentences.`;
}

function buildUserPrompt(input: ScoringInput, retryNote?: string): string {
  const { company, level, focus, transcript, objectivesText, perception } = input;
  return `<interview>
Firm: ${company.name}
Industry: ${company.industry}
Interview style at this firm: ${company.interviewStyle}
Role / level: ${level}
Interview focus selected by the candidate: ${focus}
</interview>

<firm_rubric>
${INDUSTRY_RUBRIC[company.industry]}
Weight the categories according to the selected focus (${focus}) and adjust expectations to the ${level} level.
</firm_rubric>

<interview_objectives>
These are the stages the interviewer was instructed to cover. Use them to judge coverage and what was asked:
${objectivesText.trim()}
</interview_objectives>

<perception_analysis>
${perception ? perception : "NOT AVAILABLE: feedback must be based on spoken content only. Make no visual or vocal-delivery observations."}
</perception_analysis>

<transcript>
${formatTranscript(transcript)}
</transcript>
${retryNote ? `\n<correction>\n${retryNote}\n</correction>\n` : ""}
Evaluate the candidate now.`;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

export interface ScoringInput {
  company: Company;
  level: Level;
  focus: Focus;
  transcript: TranscriptTurn[];
  objectivesText: string;
  perception?: string;
}

export type ScoringOutcome =
  | { kind: "insufficient_data"; message: string }
  | { kind: "scored"; scoring: ScoringResult; model: string };

export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
  }
}

export function insufficientDataMessage(transcript: TranscriptTurn[]): string | null {
  const substantive = substantiveCandidateTurns(transcript).length;
  if (substantive >= MIN_SUBSTANTIVE_TURNS) return null;
  return substantive === 0
    ? "We didn't capture any substantive answers from you in this session, so there's nothing honest to score. This usually means the call ended early or your microphone wasn't picked up."
    : `We only captured ${substantive} substantive answer${substantive === 1 ? "" : "s"} from you. That isn't enough to score fairly, and we won't guess. Try a longer session (aim for at least 8–10 minutes).`;
}

type ModelCaller = (system: string, user: string) => Promise<{ output: ModelScoring | null; model: string }>;

const defaultCaller: ModelCaller = async (system, user) => {
  const client = new Anthropic({ maxRetries: 2, timeout: 75_000 });
  const response = await client.beta.messages.parse({
    model: SCORING_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "medium", format: betaZodOutputFormat(ModelScoringSchema) },
  });
  if (response.stop_reason === "refusal") {
    throw new ScoringError("The scoring model declined to evaluate this transcript.");
  }
  if (response.stop_reason === "max_tokens") {
    return { output: null, model: response.model };
  }
  return { output: response.parsed_output ?? null, model: response.model };
};

export async function scoreInterview(input: ScoringInput, callModel: ModelCaller = defaultCaller): Promise<ScoringOutcome> {
  const insufficient = insufficientDataMessage(input.transcript);
  if (insufficient) return { kind: "insufficient_data", message: insufficient };

  const system = buildSystemPrompt();
  let retryNote: string | undefined;
  let last: PostProcessResult | null = null;
  let model = SCORING_MODEL;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { output, model: usedModel } = await callModel(system, buildUserPrompt(input, retryNote));
    model = usedModel;
    if (!output) {
      retryNote = "Your previous response could not be parsed. Return only the requested JSON object.";
      continue;
    }
    last = postProcessScoring(output, input.transcript);
    if (last.scoring && last.unverifiedQuotes.length === 0) {
      return { kind: "scored", scoring: last.scoring, model };
    }
    const problems: string[] = [];
    if (last.unverifiedQuotes.length) {
      problems.push(
        `These quotes do not appear verbatim in any CANDIDATE turn and were rejected:\n${last.unverifiedQuotes
          .map((q) => `- "${q}"`)
          .join("\n")}\nCopy quotes exactly from a single CANDIDATE turn.`,
      );
    }
    if (last.validationError) problems.push(`Output failed validation at ${last.validationError}.`);
    retryNote = problems.join("\n\n");
  }

  // After one retry: use the result with unverifiable quotes dropped, never fabricated ones.
  if (last?.scoring) return { kind: "scored", scoring: last.scoring, model };
  throw new ScoringError(`Scoring output was invalid after a retry${last?.validationError ? ` (${last.validationError})` : ""}.`);
}
