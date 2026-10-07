import path from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import {
  buildPalSystemPrompt,
  DEFAULT_SETTINGS,
  INLINE_KNOWLEDGE_MAX_CHARS,
  knowledgeMode,
  loadSettings,
  extractInterviewerName,
  InterviewParseError,
  loadInterviewFromDir,
  parseBlocks,
  parseGuardrails,
  parseObjectives,
  renderForPal,
  validateInterviewContent,
} from "@/lib/interviewLoader";

const FIXTURE = path.join(process.cwd(), "tests/fixtures/interviews/consulting/e2e-test-firm");

describe("parseBlocks", () => {
  it("parses inline and block-scalar values across --- separators, ignoring comments", () => {
    const blocks = parseBlocks(
      ["# header comment", "name: one", "prompt: |", "  line a", "", "  line b", "---", "name: two", "prompt: single line"].join("\n"),
      "x.txt",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].fields).toEqual({ name: "one", prompt: "line a\n\nline b" });
    expect(blocks[0].line).toBe(2);
    expect(blocks[1].fields.prompt).toBe("single line");
    expect(blocks[1].fieldLines.prompt).toBe(9);
  });

  it("handles CRLF line endings and quoted values", () => {
    const blocks = parseBlocks('name: "quoted"\r\nprompt: |\r\n  hi\r\n', "x.txt");
    expect(blocks[0].fields).toEqual({ name: "quoted", prompt: "hi" });
  });

  it("dedents by the minimum indentation and keeps relative indentation", () => {
    const [b] = parseBlocks("prompt: |\n    a\n      b\n", "x.txt");
    expect(b.fields.prompt).toBe("a\n  b");
  });

  it("reports the file and line for a malformed line", () => {
    try {
      parseBlocks("name: ok\nthis is not a key\n", "guardrails.txt");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InterviewParseError);
      expect((e as InterviewParseError).message).toBe('guardrails.txt:2: expected "key: value" or "---", got "this is not a key"');
    }
  });

  it("detects a duplicate key (missing separator) with its line", () => {
    expect(() => parseBlocks("name: a\nprompt: x\nname: b\nprompt: y\n", "g.txt")).toThrow(/g\.txt:3: duplicate key "name"/);
  });

  it("rejects an empty block scalar and a stray indented line", () => {
    expect(() => parseBlocks("prompt: |\nname: x\n", "g.txt")).toThrow(/g\.txt:1: .*no indented content/);
    expect(() => parseBlocks("   orphan\n", "g.txt")).toThrow(/g\.txt:1: unexpected indented line/);
  });
});

describe("typed parsers", () => {
  it("parses guardrails and enforces Tavus naming/length limits with line numbers", () => {
    expect(parseGuardrails("name: stay_in_role\nprompt: Stay in role.\n")).toEqual([{ name: "stay_in_role", prompt: "Stay in role." }]);
    expect(() => parseGuardrails("name: bad name\nprompt: x\n", "g.txt")).toThrow(/g\.txt:1: guardrail #1 "name": name may contain only/);
    expect(() => parseGuardrails(`name: long\nprompt: ${"x".repeat(1001)}\n`, "g.txt")).toThrow(/g\.txt:2: .*1000 characters/);
    expect(() => parseGuardrails("name: a\n", "g.txt")).toThrow(/missing required key "prompt"/);
    expect(() => parseGuardrails("name: a\nprompt: b\ncolour: red\n", "g.txt")).toThrow(/g\.txt:3: unknown key "colour"/);
  });

  it("parses objectives with optional fields", () => {
    const objs = parseObjectives(
      "name: a\nprompt: do a\nconfirmation_mode: manual\nnext: b\noutput_variables: x, y\n---\nname: b\nprompt: do b\n",
    );
    expect(objs[0]).toEqual({ name: "a", prompt: "do a", confirmation_mode: "manual", next: "b", output_variables: ["x", "y"] });
    expect(objs[1].next).toBeUndefined();
    expect(() => parseObjectives("name: a\nprompt: b\nconfirmation_mode: sometimes\n", "o.txt")).toThrow(/o\.txt:3/);
  });
});

describe("loading and validating a company folder", () => {
  it("loads the fixture firm with knowledge files and passes validation", async () => {
    const content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
    expect(content.objectives.length).toBeGreaterThanOrEqual(5);
    expect(content.guardrails.length).toBeGreaterThanOrEqual(8);
    expect(content.knowledge.map((k) => k.name)).toEqual(["overview.md"]);
    const report = validateInterviewContent(content, { featured: true });
    expect(report.errors).toEqual([]);
  });

  it("names the missing file", async () => {
    await expect(loadInterviewFromDir(path.join(FIXTURE, "nope"), { industry: "consulting", slug: "nope" })).rejects.toThrow(
      /systemprompt\.txt: file is missing/,
    );
  });

  it("flags broken objective chains, counts, and unknown placeholders", async () => {
    const content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
    const broken = {
      ...content,
      systemPrompt: `${content.systemPrompt} {{favourite_color}}`,
      objectives: [{ name: "only", prompt: "x", next: "ghost", output_variables: undefined, branches: undefined }],
    };
    const { errors } = validateInterviewContent(broken, { featured: true });
    expect(errors.some((e) => e.includes("expected 2–10 objectives"))).toBe(true);
    expect(errors.some((e) => e.includes('leads to "ghost"'))).toBe(true);
    expect(errors.some((e) => e.includes("{{favourite_color}}"))).toBe(true);
  });
});

describe("rendering", () => {
  it("bakes in the company name and turns session placeholders into tokens", () => {
    expect(renderForPal("{{company_name}} for a {{level}} ({{focus}}) named {{candidate_name}}", "Acme")).toBe(
      "Acme for a LEVEL (FOCUS) named CANDIDATE_NAME",
    );
  });

  it("builds the PAL prompt with a runtime preamble and a Capabilities section", async () => {
    const content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
    const prompt = buildPalSystemPrompt(content, "Meridian Test Partners");
    expect(prompt).toMatch(/^Runtime variables:/);
    expect(prompt).toContain("## Capabilities");
    expect(prompt).not.toMatch(/\{\{/);
    expect(prompt).not.toContain("## Knowledge base");
    const withKb = buildPalSystemPrompt(content, "Meridian Test Partners", { inlineKnowledge: true });
    expect(withKb).toContain("## Knowledge base");
    expect(withKb).toContain("### overview.md");
  });

  it("omits the runtime preamble when a prompt uses no session placeholders", async () => {
    const content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
    const plain = { ...content, systemPrompt: "You are Jo Smith, a Manager. ".repeat(40), capabilities: "Ask follow-ups." };
    expect(buildPalSystemPrompt(plain, "X")).not.toContain("Runtime variables");
  });

  it("inlines knowledge that fits and only uses documents for large knowledge with a public URL", async () => {
    const content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
    expect(knowledgeMode(content, false)).toBe("inline");
    expect(knowledgeMode({ ...content, knowledge: [] }, true)).toBe("none");
    const huge = { ...content, knowledge: [{ name: "big.md", content: "x".repeat(INLINE_KNOWLEDGE_MAX_CHARS) }] };
    expect(knowledgeMode(huge, true)).toBe("documents");
    expect(knowledgeMode(huge, false)).toBe("inline");
  });

  it("extracts the interviewer name from the opening line", () => {
    expect(extractInterviewerName("You are Daniel Whitfield, a Vice President…")).toBe("Daniel Whitfield");
    expect(extractInterviewerName("You are an interviewer.")).toBeUndefined();
  });
});

describe("objective branches", () => {
  it("parses conditional next objectives", () => {
    const [o] = parseObjectives(
      "name: main\nprompt: run it\nbranches: |\n  end_early: Only when they ask to stop.\n  deliver_debrief: When done.\n",
    );
    expect(o.branches).toEqual({ end_early: "Only when they ask to stop.", deliver_debrief: "When done." });
  });

  it("rejects malformed branch lines and next + branches together", () => {
    expect(() => parseObjectives("name: a\nprompt: b\nbranches: |\n  not a branch\n", "o.txt")).toThrow(/o\.txt:3: .*objective_name: condition/);
    expect(() => parseObjectives("name: a\nprompt: b\nnext: c\nbranches: |\n  d: e\n", "o.txt")).toThrow(/either "next" or "branches"/);
  });

  it("validates that branch targets exist", async () => {
    const content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
    const objectives = parseObjectives("name: a\nprompt: b\nbranches: |\n  missing_one: x\n---\nname: c\nprompt: d\n");
    const { errors } = validateInterviewContent({ ...content, objectives });
    expect(errors.some((e) => e.includes('leads to "missing_one"'))).toBe(true);
  });
});

describe("settings.json", () => {
  it("defaults when absent and parses a full file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "preproom-settings-"));
    try {
      expect((await loadSettings(dir)).settings).toEqual(DEFAULT_SETTINGS);
      await writeFile(
        path.join(dir, "settings.json"),
        JSON.stringify({ greeting: "Hi!", interviewMinutes: 35, maxCallMinutes: 45, inCallDebrief: true, languages: ["en", "de"] }),
      );
      const { settings, raw } = await loadSettings(dir);
      expect(settings).toMatchObject({ greeting: "Hi!", maxCallMinutes: 45, inCallDebrief: true, languages: ["en", "de"], cvUpload: true });
      expect(raw).toContain("Hi!");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports unknown keys, bad values and invalid JSON with the file name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "preproom-settings-"));
    try {
      await writeFile(path.join(dir, "settings.json"), JSON.stringify({ greting: "typo" }));
      await expect(loadSettings(dir, "firm")).rejects.toThrow(/firm\/settings\.json: unknown setting "greting"/);
      await writeFile(path.join(dir, "settings.json"), JSON.stringify({ interviewMinutes: 50, maxCallMinutes: 40 }));
      await expect(loadSettings(dir, "firm")).rejects.toThrow(/maxCallMinutes must be >= interviewMinutes/);
      await writeFile(path.join(dir, "settings.json"), "{ nope");
      await expect(loadSettings(dir, "firm")).rejects.toThrow(/invalid JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the real firm folders", () => {
  it.each([
    ["consulting", "alixpartners-restructuring", "Markus Lehner"],
    ["consulting", "simon-kucher-pricing", "Katharina Brandt"],
    ["consulting", "bain-cdd", "Jonas Weber"],
    ["investment-banking", "houlihan-lokey-industrials", "Maximilian Roth"],
    ["investment-banking", "citi-power-infrastructure", "Sophie Lambert"],
    ["investment-banking", "goldman-sachs-tmt", "Alexander Kessler"],
    ["venture-capital", "verdane-pe", "Hannah Krüger"],
    ["venture-capital", "general-atlantic-growth", "Lukas Brenner"],
    ["venture-capital", "hv-capital-vc", "Clara Neumann"],
  ])("%s/%s loads, validates and inlines its knowledge", async (industry, slug, interviewer) => {
    const dir = path.join(process.cwd(), "interviews", industry, slug);
    const content = await loadInterviewFromDir(dir, { industry, slug });
    expect(validateInterviewContent(content, { featured: true }).errors).toEqual([]);
    expect(content.settings).toMatchObject({ inCallDebrief: true, languages: ["en", "de"] });
    expect(content.settings.maxCallMinutes).toBeGreaterThanOrEqual(content.settings.interviewMinutes + 10);
    expect(content.objectives.map((o) => o.name)).toEqual(expect.arrayContaining(["deliver_debrief", "end_early"]));
    expect(content.objectives[0].branches).toHaveProperty("end_early");
    expect(content.guardrails.some((g) => g.name.endsWith("_distress_handling"))).toBe(true);
    expect(content.knowledge).toHaveLength(1);
    expect(knowledgeMode(content, false)).toBe("inline");
    expect(extractInterviewerName(content.systemPrompt)).toBe(interviewer);
    // Emotion is expressed by the face automatically; prompts must not ask for literal tags.
    expect(content.systemPrompt).not.toMatch(/emotion tag/i);
  });
});
