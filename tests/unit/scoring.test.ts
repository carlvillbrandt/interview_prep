import { describe, expect, it, vi } from "vitest";
import type { Company } from "@/data/catalog";
import { ScoringResultSchema, type TranscriptTurn } from "@/lib/schemas";
import {
  hireSignalFor,
  insufficientDataMessage,
  postProcessScoring,
  scoreInterview,
  type ModelScoring,
} from "@/lib/scoring";
import { normalizeTranscript, quoteInCandidateTurns } from "@/lib/transcript";

const transcript: TranscriptTurn[] = [
  { role: "interviewer", content: "Walk me through your resume." },
  { role: "candidate", content: "Sure. I studied economics at State, then interned at a boutique bank where I built three merger models." },
  { role: "interviewer", content: "Why banking?" },
  { role: "candidate", content: "Honestly, I love the pace, and I want to learn how deals actually get done from the inside." },
  { role: "interviewer", content: "Walk me through a DCF." },
  { role: "candidate", content: "You project unlevered free cash flow, discount it at the WACC, and add a terminal value." },
];

const company: Company = {
  industry: "investment-banking",
  slug: "test-bank",
  name: "Test Bank",
  tagline: "",
  featured: false,
  interviewStyle: "Technical + Fit",
};

function modelOutput(overrides: Partial<ModelScoring> = {}): ModelScoring {
  const cat = (score: number) => ({ score, comment: "Specific evidence." });
  return {
    overall_score: 6.84,
    hire_signal: "Hire",
    categories: {
      communication_clarity: cat(7),
      structure_and_logic: cat(6.6),
      technical_or_case_competence: cat(6),
      firm_and_role_motivation: cat(5),
      behavioral_evidence: cat(12),
      poise_and_professionalism: cat(0),
    },
    strengths: ["Clear DCF summary."],
    improvements: ["Make the firm motivation specific."],
    key_moments: [
      {
        quote: "I love the pace, and I want to learn how deals actually get done",
        issue: "Generic motivation.",
        better_answer: "I want to work on TMT deals because…",
      },
    ],
    next_steps: ["Drill DCF.", "Research the bank.", "Practice STAR stories.", "Extra step that should be dropped."],
    summary: "Solid fundamentals, generic motivation.",
    ...overrides,
  };
}

describe("hireSignalFor", () => {
  it.each([
    [1, "Strong No Hire"],
    [3.9, "Strong No Hire"],
    [4, "No Hire"],
    [5.4, "No Hire"],
    [5.5, "Lean Hire"],
    [6.9, "Lean Hire"],
    [7, "Hire"],
    [8.4, "Hire"],
    [8.5, "Strong Hire"],
    [10, "Strong Hire"],
  ])("%s → %s", (score, signal) => expect(hireSignalFor(score)).toBe(signal));
});

describe("ScoringResultSchema", () => {
  it("rejects out-of-range or malformed payloads", () => {
    const { scoring } = postProcessScoring(modelOutput(), transcript);
    expect(ScoringResultSchema.safeParse(scoring).success).toBe(true);
    expect(ScoringResultSchema.safeParse({ ...scoring, overall_score: 11 }).success).toBe(false);
    expect(ScoringResultSchema.safeParse({ ...scoring, hire_signal: "Maybe" }).success).toBe(false);
    expect(ScoringResultSchema.safeParse({ ...scoring, next_steps: ["one"] }).success).toBe(false);
    expect(
      ScoringResultSchema.safeParse({
        ...scoring,
        categories: { ...scoring!.categories, structure_and_logic: { score: 6.5, comment: "x" } },
      }).success,
    ).toBe(false);
  });
});

describe("postProcessScoring", () => {
  it("rounds and clamps scores, derives the hire signal and keeps exactly 3 next steps", () => {
    const { scoring, unverifiedQuotes } = postProcessScoring(modelOutput(), transcript);
    expect(unverifiedQuotes).toEqual([]);
    expect(scoring!.overall_score).toBe(6.8);
    expect(scoring!.hire_signal).toBe("Lean Hire"); // derived from 6.8, overriding the model's "Hire"
    expect(scoring!.categories.structure_and_logic.score).toBe(7);
    expect(scoring!.categories.behavioral_evidence.score).toBe(10);
    expect(scoring!.categories.poise_and_professionalism.score).toBe(1);
    expect(scoring!.next_steps).toHaveLength(3);
  });

  it("drops moments whose quotes are not verbatim candidate words and reports them", () => {
    const { scoring, unverifiedQuotes } = postProcessScoring(
      modelOutput({
        key_moments: [
          { quote: "Walk me through a DCF", issue: "x", better_answer: "y" }, // interviewer's words
          { quote: "I adore fast-paced environments", issue: "x", better_answer: "y" }, // invented
          { quote: "discount it at the WACC", issue: "x", better_answer: "y" }, // real
        ],
      }),
      transcript,
    );
    expect(unverifiedQuotes).toEqual(["Walk me through a DCF", "I adore fast-paced environments"]);
    expect(scoring!.key_moments.map((m) => m.quote)).toEqual(["discount it at the WACC"]);
  });

  it("returns a validation error instead of a result when required content is missing", () => {
    const r = postProcessScoring(modelOutput({ next_steps: ["only one"] }), transcript);
    expect(r.scoring).toBeNull();
    expect(r.validationError).toMatch(/next_steps/);
  });
});

describe("quote verification", () => {
  it("ignores case, punctuation and whitespace but requires contiguous candidate text", () => {
    expect(quoteInCandidateTurns("YOU PROJECT unlevered free-cash flow", transcript)).toBe(true);
    expect(quoteInCandidateTurns("project free cash flow", transcript)).toBe(false);
    expect(quoteInCandidateTurns("Why banking?", transcript)).toBe(false);
  });
});

describe("insufficient data", () => {
  it("refuses to score fewer than 3 substantive candidate turns", () => {
    expect(insufficientDataMessage(transcript)).toBeNull();
    expect(insufficientDataMessage(transcript.slice(0, 4))).toMatch(/only captured 2 substantive answers/);
    expect(insufficientDataMessage([{ role: "candidate", content: "Yes, I can hear you." }, { role: "candidate", content: "ok" }])).toMatch(
      /didn't capture any substantive answers/,
    );
  });

  it("scoreInterview never calls the model when data is insufficient", async () => {
    const call = vi.fn();
    const r = await scoreInterview(
      { company, level: "Analyst", focus: "Mixed", transcript: transcript.slice(0, 2), objectivesText: "" },
      call,
    );
    expect(r.kind).toBe("insufficient_data");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("scoreInterview retry", () => {
  const input = { company, level: "Analyst" as const, focus: "Mixed" as const, transcript, objectivesText: "name: x" };

  it("retries once when a quote is fabricated, telling the model which quote failed", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        output: modelOutput({ key_moments: [{ quote: "I am the best candidate", issue: "x", better_answer: "y" }] }),
        model: "m",
      })
      .mockResolvedValueOnce({ output: modelOutput(), model: "m" });
    const r = await scoreInterview(input, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][1]).toContain('"I am the best candidate"');
    expect(r.kind === "scored" && r.scoring.key_moments).toHaveLength(1);
  });

  it("after a second failure, keeps the score but drops the unverifiable quotes", async () => {
    const bad = modelOutput({ key_moments: [{ quote: "invented words here", issue: "x", better_answer: "y" }] });
    const call = vi.fn().mockResolvedValue({ output: bad, model: "m" });
    const r = await scoreInterview(input, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.kind).toBe("scored");
    expect(r.kind === "scored" && r.scoring.key_moments).toEqual([]);
  });

  it("throws if the output never validates", async () => {
    const call = vi.fn().mockResolvedValue({ output: null, model: "m" });
    await expect(scoreInterview(input, call)).rejects.toThrow(/invalid after a retry/);
  });
});

describe("normalizeTranscript", () => {
  it("maps roles, drops system/tool entries and merges consecutive fragments", () => {
    const turns = normalizeTranscript([
      { role: "system", content: "You are…" },
      { role: "assistant", content: "Hello." },
      { role: "user", content: "Hi" },
      { role: "user", content: "there." },
      { role: "tool", content: "{}" },
      { role: "assistant", content: "  " },
    ]);
    expect(turns).toEqual([
      { role: "interviewer", content: "Hello." },
      { role: "candidate", content: "Hi there." },
    ]);
    expect(normalizeTranscript(undefined)).toBeNull();
  });
});
