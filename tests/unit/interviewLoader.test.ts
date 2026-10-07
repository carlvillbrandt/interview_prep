import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPalSystemPrompt,
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
      objectives: [{ name: "only", prompt: "x", next: "ghost", output_variables: undefined }],
    };
    const { errors } = validateInterviewContent(broken, { featured: true });
    expect(errors.some((e) => e.includes("expected 5–7 objectives"))).toBe(true);
    expect(errors.some((e) => e.includes('next "ghost"'))).toBe(true);
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
  });

  it("extracts the interviewer name from the opening line", () => {
    expect(extractInterviewerName("You are Daniel Whitfield, a Vice President…")).toBe("Daniel Whitfield");
    expect(extractInterviewerName("You are an interviewer.")).toBeUndefined();
  });
});
