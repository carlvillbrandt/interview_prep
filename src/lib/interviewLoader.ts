import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Locations                                                           */
/* ------------------------------------------------------------------ */

export const INTERVIEW_FILES = [
  "systemprompt.txt",
  "capabilities.txt",
  "guardrails.txt",
  "objectives.txt",
] as const;
export type InterviewFileName = (typeof INTERVIEW_FILES)[number];

/** Root of the per-company folders. Overridable for tests via INTERVIEWS_DIR. */
export function interviewsRoot(): string {
  const configured = process.env.INTERVIEWS_DIR;
  if (configured) return path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  return path.join(process.cwd(), "interviews");
}

export function templatesRoot(): string {
  // Templates always live in the real /interviews folder, even when tests override INTERVIEWS_DIR.
  return path.join(process.cwd(), "interviews", "_templates");
}

export function companyDir(industry: string, slug: string, root = interviewsRoot()): string {
  const primary = path.join(/*turbopackIgnore: true*/ root, industry, slug);
  // Test-only: firms missing from /interviews can come from a fixtures folder (see playwright.config.ts).
  const fallback = process.env.INTERVIEWS_FALLBACK_DIR;
  if (fallback && !existsSync(primary)) {
    return path.join(/*turbopackIgnore: true*/ path.resolve(/*turbopackIgnore: true*/ process.cwd(), fallback), industry, slug);
  }
  return primary;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class InterviewParseError extends Error {
  constructor(
    public readonly file: string,
    public readonly line: number | null,
    public readonly detail: string,
  ) {
    super(line ? `${file}:${line}: ${detail}` : `${file}: ${detail}`);
    this.name = "InterviewParseError";
  }
}

/* ------------------------------------------------------------------ */
/* Block format parser                                                 */
/*                                                                     */
/*   # comment lines are ignored                                       */
/*   name: stay_in_character                                           */
/*   prompt: |                                                         */
/*     multi-line value, indented                                      */
/*   ---                                                               */
/*   name: next_block                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedBlock {
  /** 1-based line where the block's first key appears. */
  line: number;
  fields: Record<string, string>;
  /** 1-based line of each key, for error reporting. */
  fieldLines: Record<string, number>;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/;

export function parseBlocks(text: string, file: string): ParsedBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ParsedBlock[] = [];
  let current: ParsedBlock | null = null;

  const closeBlock = () => {
    if (current && Object.keys(current.fields).length > 0) blocks.push(current);
    current = null;
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (trimmed === "---") {
      if (raw !== trimmed && raw.startsWith(" ")) {
        throw new InterviewParseError(file, lineNo, "block separator '---' must start at column 1");
      }
      closeBlock();
      i++;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (/^\s/.test(raw)) {
      throw new InterviewParseError(
        file,
        lineNo,
        `unexpected indented line outside a "key: |" block: "${truncate(trimmed)}"`,
      );
    }

    const match = KEY_LINE.exec(raw);
    if (!match) {
      throw new InterviewParseError(
        file,
        lineNo,
        `expected "key: value" or "---", got "${truncate(trimmed)}"`,
      );
    }
    const key = match[1];
    const rest = match[2].trim();
    const block: ParsedBlock = current ?? { line: lineNo, fields: {}, fieldLines: {} };
    current = block;

    if (key in block.fields) {
      throw new InterviewParseError(
        file,
        lineNo,
        `duplicate key "${key}" in block starting at line ${block.line} (did you forget a "---" separator?)`,
      );
    }

    if (rest === "|" || rest === "|-" || rest === ">") {
      // Block scalar: collect following indented (or blank) lines.
      const folded = rest === ">";
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") {
          collected.push("");
          j++;
          continue;
        }
        if (!/^\s/.test(l)) break;
        collected.push(l);
        j++;
      }
      while (collected.length && collected[collected.length - 1] === "") collected.pop();
      if (collected.length === 0) {
        throw new InterviewParseError(file, lineNo, `"${key}: ${rest}" has no indented content below it`);
      }
      const indent = Math.min(
        ...collected.filter((l) => l !== "").map((l) => l.length - l.trimStart().length),
      );
      const dedented = collected.map((l) => l.slice(indent));
      block.fields[key] = folded
        ? dedented.join("\n").replace(/([^\n])\n(?!\n)/g, "$1 ").trim()
        : dedented.join("\n").trim();
      block.fieldLines[key] = lineNo;
      i = j;
      continue;
    }

    if (rest === "") {
      throw new InterviewParseError(file, lineNo, `key "${key}" has an empty value`);
    }
    block.fields[key] = stripQuotes(rest);
    block.fieldLines[key] = lineNo;
    i++;
  }
  closeBlock();
  return blocks;
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* ------------------------------------------------------------------ */
/* Typed definitions (limits mirror the Tavus API spec)                */
/* ------------------------------------------------------------------ */

const ModalitySchema = z.enum(["verbal", "visual"]);

export const GuardrailDefSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_]+$/, "name may contain only letters, digits and underscores")
      .max(100, "name must be at most 100 characters"),
    prompt: z.string().min(1).max(1000, "prompt must be at most 1000 characters (Tavus limit)"),
    modality: ModalitySchema.optional(),
  })
  .strict();
export type GuardrailDef = z.infer<typeof GuardrailDefSchema>;

export const ObjectiveDefSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_]+$/, "name may contain only letters, digits and underscores"),
    prompt: z.string().min(1),
    confirmation_mode: z.enum(["auto", "manual"]).optional(),
    next: z
      .string()
      .regex(/^[A-Za-z0-9_]+$/, "next must be an objective name")
      .optional(),
    modality: ModalitySchema.optional(),
    output_variables: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      ),
    /**
     * Conditional next objectives (Tavus `next_conditional_objectives`), one per line:
     *   objective_name: condition that activates it
     */
    branches: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return undefined;
        const out: Record<string, string> = {};
        for (const raw of v.split("\n")) {
          const line = raw.trim();
          if (!line) continue;
          const m = /^([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line);
          if (!m) {
            ctx.addIssue({ code: "custom", message: `each line must be "objective_name: condition", got "${line.slice(0, 50)}"` });
            return z.NEVER;
          }
          out[m[1]] = m[2].trim();
        }
        return out;
      }),
  })
  .strict()
  .refine((o) => !(o.next && o.branches), { message: 'use either "next" or "branches", not both', path: ["branches"] });
export type ObjectiveDef = z.infer<typeof ObjectiveDefSchema>;

function parseTyped<T>(
  blocks: ParsedBlock[],
  schema: z.ZodType<T>,
  file: string,
  kind: string,
): T[] {
  return blocks.map((block, idx) => {
    const result = schema.safeParse(block.fields);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    const key = issue.path[0];
    let line = block.line;
    let detail: string;
    if (issue.code === "unrecognized_keys") {
      const bad = issue.keys[0];
      line = block.fieldLines[bad] ?? block.line;
      detail = `unknown key "${bad}" in ${kind} #${idx + 1}`;
    } else if (typeof key === "string" && !(key in block.fields)) {
      detail = `${kind} #${idx + 1} is missing required key "${key}"`;
    } else {
      if (typeof key === "string") line = block.fieldLines[key] ?? block.line;
      detail = `${kind} #${idx + 1}${typeof key === "string" ? ` "${key}"` : ""}: ${issue.message}`;
    }
    throw new InterviewParseError(file, line, detail);
  });
}

export function parseGuardrails(text: string, file = "guardrails.txt"): GuardrailDef[] {
  return parseTyped(parseBlocks(text, file), GuardrailDefSchema, file, "guardrail");
}

export function parseObjectives(text: string, file = "objectives.txt"): ObjectiveDef[] {
  return parseTyped(parseBlocks(text, file), ObjectiveDefSchema, file, "objective");
}

/* ------------------------------------------------------------------ */
/* Optional settings.json                                              */
/* ------------------------------------------------------------------ */

export const InterviewSettingsSchema = z
  .object({
    /** Spoken verbatim when no candidate name was given in setup. */
    greeting: z.string().min(1).max(600).optional(),
    /** Used when the candidate entered a name; may contain {{candidate_name}}. */
    greetingWithName: z.string().min(1).max(600).optional(),
    /** Planned interview length, used in the session context and setup copy. */
    interviewMinutes: z.number().int().min(5).max(90).default(18),
    /** Hard stop (Tavus max_call_duration). */
    maxCallMinutes: z.number().int().min(5).max(120).default(20),
    /** The interviewer gives a spoken debrief at the end (in addition to the written scorecard). */
    inCallDebrief: z.boolean().default(false),
    /** Spoken languages (Tavus language codes); the first is the opening language. */
    languages: z.array(z.string().min(2).max(16)).min(1).max(10).default(["en"]),
    /** Practice-control phrase to apply when the candidate picks a focus in setup. */
    focusCommands: z.object({ Technical: z.string().optional(), Behavioral: z.string().optional(), Mixed: z.string().optional() }).strict().optional(),
    /** Raven visual awareness queries. */
    perceptionQueries: z.array(z.string().min(5).max(300)).max(10).optional(),
    /** Allow candidates to attach a CV in setup (default true). */
    cvUpload: z.boolean().default(true),
  })
  .strict()
  .refine((s) => s.maxCallMinutes >= s.interviewMinutes, { message: "maxCallMinutes must be >= interviewMinutes", path: ["maxCallMinutes"] });
export type InterviewSettings = z.infer<typeof InterviewSettingsSchema>;

export const DEFAULT_SETTINGS: InterviewSettings = InterviewSettingsSchema.parse({});

export async function loadSettings(dir: string, displayDir = dir): Promise<{ settings: InterviewSettings; raw: string }> {
  const file = path.join(displayDir, "settings.json");
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, "settings.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { settings: DEFAULT_SETTINGS, raw: "" };
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new InterviewParseError(file, null, `invalid JSON: ${(err as Error).message}`);
  }
  const parsed = InterviewSettingsSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.join(".");
    throw new InterviewParseError(
      file,
      null,
      issue.code === "unrecognized_keys" ? `unknown setting "${issue.keys[0]}"` : `${where ? `"${where}": ` : ""}${issue.message}`,
    );
  }
  return { settings: parsed.data, raw };
}

/* ------------------------------------------------------------------ */
/* Loading a company folder                                            */
/* ------------------------------------------------------------------ */

export interface KnowledgeFile {
  name: string;
  content: string;
}

export interface InterviewContent {
  industry: string;
  slug: string;
  dir: string;
  systemPrompt: string;
  capabilities: string;
  guardrailsText: string;
  objectivesText: string;
  guardrails: GuardrailDef[];
  objectives: ObjectiveDef[];
  knowledge: KnowledgeFile[];
  settings: InterviewSettings;
  /** Raw settings.json text ("" if absent); part of the content hash. */
  settingsText: string;
}

async function readRequired(dir: string, file: InterviewFileName, displayDir: string): Promise<string> {
  const full = path.join(dir, file);
  try {
    const text = await fs.readFile(full, "utf8");
    if (text.trim() === "") {
      throw new InterviewParseError(path.join(displayDir, file), null, "file is empty");
    }
    return text;
  } catch (err) {
    if (err instanceof InterviewParseError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new InterviewParseError(path.join(displayDir, file), null, "file is missing");
    }
    throw err;
  }
}

export async function loadKnowledge(dir: string): Promise<KnowledgeFile[]> {
  const kdir = path.join(dir, "knowledge");
  let entries: string[];
  try {
    entries = await fs.readdir(kdir);
  } catch {
    return [];
  }
  // README files are notes for editors, not interviewer material.
  const files = entries
    .filter((f) => /\.(md|txt)$/i.test(f) && /^[A-Za-z0-9._-]+$/.test(f) && !/^readme\./i.test(f))
    .sort();
  return Promise.all(
    files.map(async (name) => ({ name, content: await fs.readFile(path.join(kdir, name), "utf8") })),
  );
}

/** Loads and parses an interview folder. Throws InterviewParseError naming the file and line. */
export async function loadInterviewFromDir(
  dir: string,
  meta: { industry: string; slug: string },
): Promise<InterviewContent> {
  const displayDir = path.relative(process.cwd(), dir) || dir;
  // Read in parallel but report the first failure in file order, so errors are deterministic.
  const settled = await Promise.allSettled(INTERVIEW_FILES.map((f) => readRequired(dir, f, displayDir)));
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) throw failure.reason;
  const [systemPrompt, capabilities, guardrailsText, objectivesText] = settled.map(
    (r) => (r as PromiseFulfilledResult<string>).value,
  );
  const guardrails = parseGuardrails(guardrailsText, path.join(displayDir, "guardrails.txt"));
  const objectives = parseObjectives(objectivesText, path.join(displayDir, "objectives.txt"));
  const knowledge = await loadKnowledge(dir);
  const { settings, raw: settingsText } = await loadSettings(dir, displayDir);
  return {
    ...meta,
    dir,
    systemPrompt: systemPrompt.trim(),
    capabilities: capabilities.trim(),
    guardrailsText,
    objectivesText,
    guardrails,
    objectives,
    knowledge,
    settings,
    settingsText,
  };
}

export async function loadInterview(industry: string, slug: string): Promise<InterviewContent> {
  return loadInterviewFromDir(companyDir(industry, slug), { industry, slug });
}

/* ------------------------------------------------------------------ */
/* Semantic validation                                                 */
/* ------------------------------------------------------------------ */

export const RUNTIME_PLACEHOLDERS = ["level", "focus", "candidate_name", "company_name"] as const;
const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function validateInterviewContent(
  content: InterviewContent,
  opts: { featured?: boolean; allowedPlaceholders?: readonly string[] } = {},
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const where = path.relative(process.cwd(), content.dir) || content.dir;
  const allowed = new Set(opts.allowedPlaceholders ?? RUNTIME_PLACEHOLDERS);

  // Objectives: 2–10 stages, unique names, every `next` / branch target defined.
  const objNames = content.objectives.map((o) => o.name);
  if (content.objectives.length < 2 || content.objectives.length > 10) {
    errors.push(`${where}/objectives.txt: expected 2–10 objectives, found ${content.objectives.length}`);
  }
  const dupObj = objNames.filter((n, i) => objNames.indexOf(n) !== i);
  if (dupObj.length) errors.push(`${where}/objectives.txt: duplicate objective names: ${[...new Set(dupObj)].join(", ")}`);
  for (const o of content.objectives) {
    const targets = [...(o.next ? [o.next] : []), ...Object.keys(o.branches ?? {})];
    for (const t of targets) {
      if (!objNames.includes(t)) {
        errors.push(`${where}/objectives.txt: objective "${o.name}" leads to "${t}", which is not defined`);
      }
      if (t === o.name) errors.push(`${where}/objectives.txt: objective "${o.name}" points to itself`);
    }
  }

  // Guardrails
  const grNames = content.guardrails.map((g) => g.name);
  if (content.guardrails.length === 0) errors.push(`${where}/guardrails.txt: at least one guardrail is required`);
  if (content.guardrails.length > 50) errors.push(`${where}/guardrails.txt: Tavus allows at most 50 guardrails per PAL`);
  const dupGr = grNames.filter((n, i) => grNames.indexOf(n) !== i);
  if (dupGr.length) errors.push(`${where}/guardrails.txt: duplicate guardrail names: ${[...new Set(dupGr)].join(", ")}`);

  // System prompt length: firm content decides; only a near-empty prompt is an error.
  const words = wordCount(content.systemPrompt);
  if (words < 150) errors.push(`${where}/systemprompt.txt: only ${words} words; the interviewer needs a real persona and structure`);
  else if (opts.featured && words < 400) warnings.push(`${where}/systemprompt.txt: ${words} words; featured firms usually need 400+`);
  if (wordCount(content.capabilities) < 30) {
    warnings.push(`${where}/capabilities.txt: very short (${wordCount(content.capabilities)} words)`);
  }

  // Placeholders
  const sources: [string, string][] = [
    ["systemprompt.txt", content.systemPrompt],
    ["capabilities.txt", content.capabilities],
    ["guardrails.txt", content.guardrailsText],
    ["objectives.txt", content.objectivesText],
  ];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      if (!allowed.has(m[1])) {
        errors.push(`${where}/${file}: unknown placeholder {{${m[1]}}} (allowed: ${[...allowed].join(", ")})`);
      }
    }
  }

  // Combined prompt budget. Tavus: best ≤ ~5k tokens, degradation from ~15–20k tokens (≈ 60–80k chars).
  const combined = content.systemPrompt.length + content.capabilities.length + knowledgeChars(content);
  if (combined > INLINE_KNOWLEDGE_MAX_CHARS) {
    warnings.push(
      `${where}: prompt + capabilities + knowledge is ${combined} characters; above ${INLINE_KNOWLEDGE_MAX_CHARS} the knowledge base is uploaded as Tavus documents (public APP_BASE_URL required) instead of inlined`,
    );
  }

  return { errors, warnings };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Tokens substituted for per-session placeholders inside the shared PAL prompt. */
const SESSION_TOKENS: Record<string, string> = {
  level: "LEVEL",
  focus: "FOCUS",
  candidate_name: "CANDIDATE_NAME",
};

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => (key in vars ? vars[key] : whole));
}

/** Render text for the shared PAL: company name baked in, session values as tokens. */
export function renderForPal(text: string, companyName: string): string {
  return renderTemplate(text, { ...SESSION_TOKENS, company_name: companyName });
}

const RUNTIME_PREAMBLE = `Runtime variables: this prompt refers to LEVEL, FOCUS and CANDIDATE_NAME. Their real values for the current session are given in the "Session details" section of your conversational context. Always use those real values, and never say the words LEVEL, FOCUS or CANDIDATE_NAME aloud. If no candidate name is given, do not invent one.`;

/**
 * Knowledge up to this size is inlined into the system prompt (reliable: cases and answer
 * keys are always in context). Larger knowledge goes to Tavus documents (RAG). ≈ 12k tokens.
 */
export const INLINE_KNOWLEDGE_MAX_CHARS = 48_000;

export function knowledgeChars(content: Pick<InterviewContent, "knowledge">): number {
  return content.knowledge.reduce((n, k) => n + k.content.length, 0);
}

export type KnowledgeMode = "none" | "inline" | "documents";

/** How to deliver knowledge/ to the interviewer. See DECISIONS.md §11. */
export function knowledgeMode(content: InterviewContent, publiclyReachable: boolean): KnowledgeMode {
  if (content.knowledge.length === 0) return "none";
  const total = content.systemPrompt.length + content.capabilities.length + knowledgeChars(content);
  if (total <= INLINE_KNOWLEDGE_MAX_CHARS) return "inline";
  // Too big to inline comfortably; documents need a public URL, otherwise inline anyway.
  return publiclyReachable ? "documents" : "inline";
}

/**
 * The PAL system prompt: systemprompt.txt + a Capabilities section (DECISIONS.md §2),
 * plus the knowledge base when it is inlined (§11).
 */
export function buildPalSystemPrompt(
  content: InterviewContent,
  companyName: string,
  opts: { inlineKnowledge?: boolean } = {},
): string {
  const prompt = renderForPal(content.systemPrompt, companyName);
  const capabilities = renderForPal(content.capabilities, companyName);
  const usesTokens = /\b(LEVEL|FOCUS|CANDIDATE_NAME)\b/.test(prompt + capabilities);
  const parts = [...(usesTokens ? [RUNTIME_PREAMBLE] : []), prompt, `## Capabilities\n\n${capabilities}`];
  if (opts.inlineKnowledge && content.knowledge.length > 0) {
    parts.push(
      [
        "## Knowledge base",
        "The following reference material is your knowledge base. It is for you only: never read it aloud, and follow its own instructions about what may be revealed and when.",
        ...content.knowledge.map((k) => `### ${k.name}\n\n${renderForPal(k.content.trim(), companyName)}`),
      ].join("\n\n"),
    );
  }
  return parts.join("\n\n");
}

/** Extracts "Daniel Whitfield" from a prompt that opens "You are Daniel Whitfield, a Vice President…". */
export function extractInterviewerName(systemPrompt: string): string | undefined {
  const m = /^\s*You are ([\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]+){0,3})\s*,/u.exec(systemPrompt);
  return m?.[1];
}
