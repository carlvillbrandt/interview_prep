import type { Company } from "@/data/catalog";
import { DEFAULT_SETTINGS, renderTemplate, type InterviewSettings } from "@/lib/interviewLoader";
import type { Focus, Level } from "@/lib/schemas";

/** Default hard stop for firms without settings.json (seconds). */
export const MAX_CALL_DURATION_SECONDS = DEFAULT_SETTINGS.maxCallMinutes * 60;

export function maxCallSeconds(settings: InterviewSettings): number {
  return settings.maxCallMinutes * 60;
}

const LEVEL_GUIDANCE: Record<Level, string> = {
  Intern:
    "Internship candidate, usually a student. Test fundamentals, structure, curiosity and coachability. Keep technical and legal depth at an introductory level and reward good questions.",
  "Working Student":
    "Working-student candidate combining studies with part-time work. Expect basics plus some practical exposure; test reliability and how they prioritise.",
  "Summer Analyst":
    "Undergraduate internship candidate. Expect limited work experience; test fundamentals, curiosity and coachability. Technicals at textbook depth (three statements, basic valuation). Be encouraging but still probe.",
  Analyst:
    "Full-time analyst candidate (undergraduate or early career). Expect solid fundamentals and at least one relevant internship. Technicals at standard depth, with one follow-up that goes a level deeper.",
  "Entry-level Consultant":
    "Full-time entry-level consultant candidate (graduating or recent graduate). Expect a candidate-led case with clean structure and math, and specific motivation.",
  "Experienced Consultant":
    "Experienced-hire candidate with prior consulting or industry experience. Expect them to drive the case, prioritise quickly, give a commercial synthesis, and show client-facing judgment.",
  Associate:
    "Associate candidate with 2–4 years of relevant experience. Expect fluent technicals, real deal or project examples with their own contribution clearly separated, and commercial judgment.",
  "MBA Associate":
    "Post-MBA candidate, often a career switcher. Probe the story behind the switch, transferable skills, leadership examples and business judgment; technicals at a solid but not specialist level.",
  "Senior Associate":
    "Senior associate candidate. Expect ownership of workstreams, management of junior team members, and crisp, opinionated answers. Push harder on edge cases and second-order effects.",
  Principal:
    "Principal-level candidate. Expect investment judgment, sourcing and portfolio support track record, and clear theses; push on conviction and trade-offs.",
  "Vice President":
    "VP-level candidate. Focus on judgment, client/portfolio leadership, origination or business development, and how they develop teams. Technicals become discussions of trade-offs, not definitions.",
};

const FOCUS_GUIDANCE: Record<Focus, string> = {
  Mixed:
    "Balance the session between fit/behavioral questions and the technical, case or pitch portion, following your normal interview flow.",
  Behavioral:
    "Weight the session toward fit and behavioral questions (motivation, teamwork, leadership, failure, conflict). Keep the technical/case portion short.",
  Technical:
    "Weight the session toward technical, case or pitch questions with follow-ups. Keep fit questions brief.",
};

/** Max CV characters passed to the interviewer (≈ 1.5k tokens). */
export const CV_CONTEXT_MAX_CHARS = 6_000;

/** Per-conversation context appended to the PAL's system prompt (Tavus `conversational_context`). */
export function buildConversationalContext(opts: {
  company: Company;
  level: Level;
  focus: Focus;
  candidateName?: string;
  settings?: InterviewSettings;
  cvText?: string;
}): string {
  const { company, level, focus, candidateName } = opts;
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const focusCommand = settings.focusCommands?.[focus];
  const closeBy = Math.max(1, settings.interviewMinutes - 2);

  const lines = [
    "Session details",
    `- Firm: ${company.name}`,
    `- LEVEL (role the candidate selected in setup): ${level}`,
    `- FOCUS (interview emphasis selected in setup): ${focus}`,
    `- CANDIDATE_NAME: ${candidateName ?? "not provided in setup. Ask for or use the name the candidate gives you; never invent one"}`,
    `- Interview format at this firm: ${company.interviewStyle}`,
    `- Time box: about ${settings.interviewMinutes} minutes. The call hard-stops at ${settings.maxCallMinutes} minutes${
      settings.inCallDebrief ? ", so leave enough time for the debrief and close" : `, so begin closing by minute ${closeBy}`
    }.`,
    "",
    "Difficulty calibration",
    `- Level: ${LEVEL_GUIDANCE[level]}`,
    `- Focus: ${
      focusCommand
        ? `The candidate chose this focus in setup. Apply your "${focusCommand}" practice control from the start, as if they had said it.`
        : FOCUS_GUIDANCE[focus]
    }`,
    "",
    settings.inCallDebrief
      ? "This is a practice interview on PrepRoom. Follow your own instructions for feedback: none during the interview, except on a practice-control request, and a spoken debrief at the end. The candidate also receives a written scorecard on a results screen after the call."
      : "This is a practice interview on PrepRoom. Feedback and a score are delivered to the candidate on a separate results screen after the call, so never give feedback, scores or hiring signals during the interview.",
  ];

  const cv = opts.cvText?.trim();
  if (cv) {
    lines.push(
      "",
      "Candidate CV",
      "The candidate attached their CV in setup. This is their CV and the only CV for this session. Use it only to choose precise questions; never read it back, summarize it, or mention contact details or other personal data from it.",
      '"""',
      cv.slice(0, CV_CONTEXT_MAX_CHARS),
      '"""',
    );
  }
  return lines.join("\n");
}

export function buildGreeting(opts: {
  company: Company;
  interviewerName?: string;
  candidateName?: string;
  settings?: InterviewSettings;
}): string {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const firstName = opts.candidateName?.split(" ")[0];
  if (firstName && settings.greetingWithName) {
    return renderTemplate(settings.greetingWithName, { candidate_name: firstName, company_name: opts.company.name });
  }
  if (settings.greeting) return renderTemplate(settings.greeting, { company_name: opts.company.name });

  const hello = firstName ? `Hi ${firstName}` : "Hi there";
  const intro = opts.interviewerName
    ? `I'm ${opts.interviewerName}, and I'll be running your interview with ${opts.company.name} today.`
    : `Thanks for joining your ${opts.company.name} interview today.`;
  return `${hello}, thanks for making the time. ${intro} Before we dive in, can you hear and see me okay?`;
}
