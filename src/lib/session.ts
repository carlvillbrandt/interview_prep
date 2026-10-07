import type { Company } from "@/data/catalog";
import type { Focus, Level } from "@/lib/schemas";

export const MAX_CALL_DURATION_SECONDS = 20 * 60;

const LEVEL_GUIDANCE: Record<Level, string> = {
  "Summer Analyst":
    "Undergraduate internship candidate. Expect limited work experience; test fundamentals, curiosity and coachability. Technicals at textbook depth (three statements, basic valuation). Be encouraging but still probe.",
  Analyst:
    "Full-time analyst candidate (undergraduate or early career). Expect solid fundamentals and at least one relevant internship. Technicals at standard depth, with one follow-up that goes a level deeper.",
  Associate:
    "Associate candidate with 2–4 years of relevant experience. Expect fluent technicals, real deal or project examples with their own contribution clearly separated, and commercial judgment.",
  "MBA Associate":
    "Post-MBA associate candidate, often a career switcher. Probe the story behind the switch, transferable skills, leadership examples and business judgment; technicals at a solid but not specialist level.",
  "Senior Associate":
    "Senior associate candidate. Expect ownership of workstreams, management of junior team members, and crisp, opinionated answers. Push harder on edge cases and second-order effects.",
  "Vice President":
    "VP-level candidate. Focus on judgment, client/portfolio leadership, origination or business development, and how they develop teams. Technicals become discussions of trade-offs, not definitions.",
};

const FOCUS_GUIDANCE: Record<Focus, string> = {
  Mixed:
    "Balance the session roughly evenly between fit/behavioral questions and one technical, case or pitch deep-dive.",
  Behavioral:
    "Weight the session toward fit and behavioral questions (motivation, teamwork, leadership, failure, conflict). Keep the technical/case portion short: one compact question.",
  Technical:
    "Weight the session toward technical, case or pitch questions with follow-ups. Keep fit questions to a brief opener and one motivation question.",
};

/** Per-conversation context appended to the PAL's system prompt (Tavus `conversational_context`). */
export function buildConversationalContext(opts: {
  company: Company;
  level: Level;
  focus: Focus;
  candidateName?: string;
}): string {
  const { company, level, focus, candidateName } = opts;
  return [
    "Session details",
    `- Firm: ${company.name}`,
    `- LEVEL (role the candidate is interviewing for): ${level}`,
    `- FOCUS (interview emphasis): ${focus}`,
    `- CANDIDATE_NAME: ${candidateName ?? "not provided. Do not ask for or invent a name; address them naturally without one"}`,
    `- Interview format at this firm: ${company.interviewStyle}`,
    `- Time box: about ${Math.round(MAX_CALL_DURATION_SECONDS / 60) - 2} minutes. The call hard-stops at ${MAX_CALL_DURATION_SECONDS / 60} minutes, so begin closing by minute 17.`,
    "",
    "Difficulty calibration",
    `- Level: ${LEVEL_GUIDANCE[level]}`,
    `- Focus: ${FOCUS_GUIDANCE[focus]}`,
    "",
    "This is a practice interview on PrepRoom. Feedback and a score are delivered to the candidate on a separate results screen after the call, so never give feedback, scores or hiring signals during the interview.",
  ].join("\n");
}

export function buildGreeting(opts: {
  company: Company;
  interviewerName?: string;
  candidateName?: string;
}): string {
  const hello = opts.candidateName ? `Hi ${opts.candidateName.split(" ")[0]}` : "Hi there";
  const intro = opts.interviewerName
    ? `I'm ${opts.interviewerName}, and I'll be running your interview with ${opts.company.name} today.`
    : `Thanks for joining your ${opts.company.name} interview today.`;
  return `${hello}, thanks for making the time. ${intro} Before we dive in, can you hear and see me okay?`;
}
