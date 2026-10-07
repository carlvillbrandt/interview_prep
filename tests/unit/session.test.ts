import { describe, expect, it } from "vitest";
import type { Company } from "@/data/catalog";
import { DEFAULT_SETTINGS, InterviewSettingsSchema } from "@/lib/interviewLoader";
import { StartInterviewRequestSchema } from "@/lib/schemas";
import { buildConversationalContext, buildGreeting, CV_CONTEXT_MAX_CHARS, maxCallSeconds } from "@/lib/session";
import { stripEmotionTags } from "@/lib/speech";

const company: Company = {
  industry: "consulting",
  slug: "alixpartners-restructuring",
  name: "AlixPartners",
  tagline: "",
  featured: true,
  interviewStyle: "Turnaround case + Fit",
};

const debriefSettings = InterviewSettingsSchema.parse({
  greeting: "Hi, I'm Markus Lehner. What should I call you?",
  greetingWithName: "Hi {{candidate_name}}, I'm Markus Lehner. Ready?",
  interviewMinutes: 35,
  maxCallMinutes: 45,
  inCallDebrief: true,
  languages: ["en", "de"],
  focusCommands: { Technical: "case only", Behavioral: "fit only" },
});

describe("conversational context", () => {
  it("uses firm timing, debrief mode and focus presets", () => {
    const ctx = buildConversationalContext({ company, level: "Intern", focus: "Technical", settings: debriefSettings });
    expect(ctx).toContain("about 35 minutes");
    expect(ctx).toContain("hard-stops at 45 minutes");
    expect(ctx).toContain('Apply your "case only" practice control');
    expect(ctx).toContain("spoken debrief at the end");
    expect(ctx).not.toContain("never give feedback, scores or hiring signals during the interview");
  });

  it("keeps the no-feedback rule for firms without an in-call debrief", () => {
    const ctx = buildConversationalContext({ company, level: "Analyst", focus: "Mixed" });
    expect(ctx).toContain("never give feedback, scores or hiring signals during the interview");
    expect(ctx).toContain(`hard-stops at ${DEFAULT_SETTINGS.maxCallMinutes} minutes`);
  });

  it("includes the CV, capped, only when provided", () => {
    expect(buildConversationalContext({ company, level: "Intern", focus: "Mixed" })).not.toContain("Candidate CV");
    const ctx = buildConversationalContext({ company, level: "Intern", focus: "Mixed", cvText: "q".repeat(CV_CONTEXT_MAX_CHARS + 500) });
    expect(ctx).toContain("Candidate CV");
    expect(ctx).toContain("never read it back");
    expect(ctx.match(/q{100,}/)?.[0].length).toBe(CV_CONTEXT_MAX_CHARS);
  });
});

describe("greeting", () => {
  it("uses the firm greeting, or the named variant when a name was given", () => {
    expect(buildGreeting({ company, settings: debriefSettings })).toBe("Hi, I'm Markus Lehner. What should I call you?");
    expect(buildGreeting({ company, settings: debriefSettings, candidateName: "Anna Müller" })).toBe("Hi Anna, I'm Markus Lehner. Ready?");
  });

  it("falls back to a generated greeting", () => {
    expect(buildGreeting({ company, interviewerName: "Sam Patel" })).toContain("I'm Sam Patel");
  });

  it("converts minutes to the Tavus max_call_duration", () => {
    expect(maxCallSeconds(debriefSettings)).toBe(2700);
  });
});

describe("start request levels", () => {
  it("defaults to the industry's first level and rejects levels from another industry", () => {
    expect(StartInterviewRequestSchema.parse({ industry: "consulting", company: "bain-cdd" }).level).toBe("Intern");
    expect(StartInterviewRequestSchema.safeParse({ industry: "consulting", company: "bain-cdd", level: "Vice President" }).success).toBe(false);
    expect(StartInterviewRequestSchema.parse({ industry: "investment-banking", company: "x", level: "Vice President" }).level).toBe("Vice President");
  });
});

describe("stripEmotionTags", () => {
  it.each([
    ['<emotion value="content"/> Thanks for making the time.', "Thanks for making the time."],
    ["<emotion value='neutral' /> What's the headline?", "What's the headline?"],
    ["<neutral> Walk me through it.", "Walk me through it."],
    ["[surprised] Interesting.", "Interesting."],
    ["neutral What would you look at first?", "What would you look at first?"],
    ["content: Goodbye.", "Goodbye."],
    ["Content strategy matters here.", "Content strategy matters here."],
    ["I'm content with that answer.", "I'm content with that answer."],
  ])("%s", (input, expected) => expect(stripEmotionTags(input)).toBe(expected));
});
