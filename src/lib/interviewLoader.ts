import { promises as fs } from "node:fs";
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
  return path.join(/*turbopackIgnore: true*/ root, industry, slug);
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
  })
  .strict();
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
  const files = entries.filter((f) => /\.(md|txt)$/i.test(f) && /^[A-Za-z0-9._-]+$/.test(f)).sort();
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

  // Objectives: 5–7, unique names, resolvable `next`, no cycles back to the start.
  const objNames = content.objectives.map((o) => o.name);
  if (content.objectives.length < 5 || content.objectives.length > 7) {
    errors.push(`${where}/objectives.txt: expected 5–7 objectives, found ${content.objectives.length}`);
  }
  const dupObj = objNames.filter((n, i) => objNames.indexOf(n) !== i);
  if (dupObj.length) errors.push(`${where}/objectives.txt: duplicate objective names: ${[...new Set(dupObj)].join(", ")}`);
  for (const o of content.objectives) {
    if (o.next && !objNames.includes(o.next)) {
      errors.push(`${where}/objectives.txt: objective "${o.name}" has next "${o.next}", which is not defined`);
    }
    if (o.next === o.name) errors.push(`${where}/objectives.txt: objective "${o.name}" points to itself`);
  }

  // Guardrails
  const grNames = content.guardrails.map((g) => g.name);
  if (content.guardrails.length === 0) errors.push(`${where}/guardrails.txt: at least one guardrail is required`);
  if (content.guardrails.length > 50) errors.push(`${where}/guardrails.txt: Tavus allows at most 50 guardrails per PAL`);
  const dupGr = grNames.filter((n, i) => grNames.indexOf(n) !== i);
  if (dupGr.length) errors.push(`${where}/guardrails.txt: duplicate guardrail names: ${[...new Set(dupGr)].join(", ")}`);

  // System prompt length
  const words = wordCount(content.systemPrompt);
  const lengthMsg = `${where}/systemprompt.txt: ${words} words (target 400–900)`;
  if (words < 400 || words > 900) {
    if (opts.featured) errors.push(lengthMsg);
    else warnings.push(lengthMsg);
  }
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

  // Combined prompt budget (Tavus recommends ≤ ~5k tokens ≈ 20k chars for best latency).
  const combined = content.systemPrompt.length + content.capabilities.length;
  if (combined > 20_000) {
    warnings.push(`${where}: system prompt + capabilities is ${combined} characters; Tavus latency degrades above ~20k`);
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

/** The PAL system prompt: systemprompt.txt + a Capabilities section, per DECISIONS.md §2. */
export function buildPalSystemPrompt(content: InterviewContent, companyName: string): string {
  return [
    RUNTIME_PREAMBLE,
    renderForPal(content.systemPrompt, companyName),
    `## Capabilities\n\n${renderForPal(content.capabilities, companyName)}`,
  ].join("\n\n");
}

/** Extracts "Daniel Whitfield" from a prompt that opens "You are Daniel Whitfield, a Vice President…". */
export function extractInterviewerName(systemPrompt: string): string | undefined {
  const m = /^\s*You are ([\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]+){0,3})\s*,/u.exec(systemPrompt);
  return m?.[1];
}
