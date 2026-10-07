import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@/data/catalog";
import { loadInterviewFromDir, type InterviewContent } from "@/lib/interviewLoader";
import { computeContentHash, pickStockFace, provisionCompany } from "@/lib/provision";
import { FileProvisionCacheStore } from "@/lib/storage";
import { TavusClient, TavusError } from "@/lib/tavus";

const FIXTURE = path.join(process.cwd(), "tests/fixtures/interviews/consulting/e2e-test-firm");
const company: Company = {
  industry: "consulting",
  slug: "e2e-test-firm",
  name: "Meridian Test Partners",
  tagline: "",
  featured: true,
  interviewStyle: "Case + Fit",
};

let tmp: string;
let content: InterviewContent;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "preproom-"));
  content = await loadInterviewFromDir(FIXTURE, { industry: "consulting", slug: "e2e-test-firm" });
  vi.stubEnv("TAVUS_DEFAULT_REPLICA_ID", "");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

function fakeClient() {
  const client = new TavusClient({ apiKey: "test" });
  let n = 0;
  const spies = {
    listFaces: vi.spyOn(client, "listFaces").mockResolvedValue({
      data: [
        { face_id: "f_old", status: "completed", model_name: "phoenix-3" },
        { face_id: "f_training", status: "started", model_name: "phoenix-4.5" },
        { face_id: "f_best", status: "completed", model_name: "phoenix-4.5" },
      ],
    }),
    createObjectives: vi.spyOn(client, "createObjectives").mockImplementation(async () => ({ objectives_id: `o${++n}` })),
    createGuardrail: vi.spyOn(client, "createGuardrail").mockImplementation(async () => ({ uuid: `g${++n}` })),
    createPal: vi.spyOn(client, "createPal").mockImplementation(async () => ({ pal_id: `p${++n}` })),
    patchPal: vi.spyOn(client, "patchPal").mockResolvedValue(undefined),
    createDocument: vi.spyOn(client, "createDocument"),
    getPal: vi.spyOn(client, "getPal").mockResolvedValue({ pal_id: "p" }),
    getObjectives: vi.spyOn(client, "getObjectives").mockResolvedValue({ data: {} }),
    getGuardrail: vi.spyOn(client, "getGuardrail").mockResolvedValue({ uuid: "g" }),
  };
  return { client, spies };
}

describe("computeContentHash", () => {
  it("is stable for identical content and changes with any file, the company name or the face", () => {
    const base = computeContentHash(content, company.name, "f1");
    expect(computeContentHash({ ...content }, company.name, "f1")).toBe(base);
    expect(computeContentHash({ ...content, systemPrompt: content.systemPrompt + "!" }, company.name, "f1")).not.toBe(base);
    expect(computeContentHash({ ...content, guardrailsText: content.guardrailsText + "\n" }, company.name, "f1")).not.toBe(base);
    expect(computeContentHash({ ...content, knowledge: [] }, company.name, "f1")).not.toBe(base);
    expect(computeContentHash(content, "Other", "f1")).not.toBe(base);
    expect(computeContentHash(content, company.name, "f2")).not.toBe(base);
  });
});

describe("pickStockFace", () => {
  it("prefers completed faces on the newest Phoenix model", () => {
    expect(
      pickStockFace([
        { face_id: "a", status: "completed", model_name: "phoenix-3" },
        { face_id: "b", status: "error", model_name: "phoenix-4.5" },
        { face_id: "c", status: "completed", model_name: "phoenix-4" },
      ])?.face_id,
    ).toBe("c");
    expect(pickStockFace([])).toBeUndefined();
  });
});

describe("provisionCompany (content-hash cache)", () => {
  it("creates resources on first run, then reuses them while files are unchanged", async () => {
    const cache = new FileProvisionCacheStore(path.join(tmp, "cache.json"));
    const { client, spies } = fakeClient();
    const load = vi.fn(async () => content);

    const first = await provisionCompany(company, { client, cache, load, log: () => {} });
    expect(first.reused).toBe(false);
    expect(first.faceId).toBe("f_best");
    expect(spies.createObjectives).toHaveBeenCalledTimes(1);
    expect(spies.createGuardrail).toHaveBeenCalledTimes(content.guardrails.length);
    expect(spies.createPal).toHaveBeenCalledTimes(1);
    // Knowledge isn't uploaded when the app isn't publicly reachable.
    expect(spies.createDocument).not.toHaveBeenCalled();

    const palBody = spies.createPal.mock.calls[0][0];
    expect(palBody.objectives_id).toBe(first.objectivesId);
    expect(palBody.guardrail_ids).toEqual(first.guardrailIds);
    expect(palBody.default_face_id).toBe("f_best");
    expect(palBody.system_prompt).toContain("Meridian Test Partners");
    expect(palBody.system_prompt).toContain("## Capabilities");
    const guardrailNames = spies.createGuardrail.mock.calls.map(([g]) => g.guardrail_name);
    expect(guardrailNames.every((n) => /^[A-Za-z0-9_]{1,100}$/.test(n))).toBe(true);

    const second = await provisionCompany(company, { client, cache, load, log: () => {} });
    expect(second.reused).toBe(true);
    expect(second.palId).toBe(first.palId);
    expect(spies.createPal).toHaveBeenCalledTimes(1);
    expect(spies.createObjectives).toHaveBeenCalledTimes(1);
    expect(spies.listFaces).toHaveBeenCalledTimes(1); // face choice is cached too
  });

  it("patches the existing PAL when a file changes", async () => {
    const cache = new FileProvisionCacheStore(path.join(tmp, "cache.json"));
    const { client, spies } = fakeClient();
    const first = await provisionCompany(company, { client, cache, load: async () => content, log: () => {} });

    const edited = { ...content, objectivesText: content.objectivesText + "\n# tweak" };
    const second = await provisionCompany(company, { client, cache, load: async () => edited, log: () => {} });
    expect(second.reused).toBe(false);
    expect(second.palId).toBe(first.palId);
    expect(spies.createPal).toHaveBeenCalledTimes(1);
    expect(spies.patchPal).toHaveBeenCalledTimes(1);
    const ops = spies.patchPal.mock.calls[0][1];
    expect(ops).toContainEqual({ op: "add", path: "/objectives_id", value: second.objectivesId });
    expect((await cache.get("consulting/e2e-test-firm"))?.hash).toBe(second.hash);
  });

  it("creates a fresh PAL if the cached one was deleted in Tavus", async () => {
    const cache = new FileProvisionCacheStore(path.join(tmp, "cache.json"));
    const { client, spies } = fakeClient();
    await provisionCompany(company, { client, cache, load: async () => content, log: () => {} });
    spies.patchPal.mockRejectedValueOnce(new TavusError("not_found", "gone", 404));
    const edited = { ...content, capabilities: content.capabilities + " More." };
    const r = await provisionCompany(company, { client, cache, load: async () => edited, log: () => {} });
    expect(spies.createPal).toHaveBeenCalledTimes(2);
    expect(r.palId).not.toBe("p");
  });

  it("shares one in-flight provisioning run between concurrent callers", async () => {
    const cache = new FileProvisionCacheStore(path.join(tmp, "cache.json"));
    const { client, spies } = fakeClient();
    const [a, b] = await Promise.all([
      provisionCompany(company, { client, cache, load: async () => content, log: () => {} }),
      provisionCompany(company, { client, cache, load: async () => content, log: () => {} }),
    ]);
    expect(a.palId).toBe(b.palId);
    expect(spies.createPal).toHaveBeenCalledTimes(1);
  });
});

describe("provisioning a real firm folder (AlixPartners)", () => {
  it("sends branches, languages, perception queries and the inlined knowledge base", async () => {
    const cache = new FileProvisionCacheStore(path.join(tmp, "cache.json"));
    const { client, spies } = fakeClient();
    const alix: Company = {
      industry: "consulting",
      slug: "alixpartners-restructuring",
      name: "AlixPartners",
      tagline: "",
      featured: true,
      interviewStyle: "Turnaround case + Fit",
    };
    const dir = path.join(process.cwd(), "interviews/consulting/alixpartners-restructuring");
    const r = await provisionCompany(alix, {
      client,
      cache,
      load: () => loadInterviewFromDir(dir, { industry: "consulting", slug: alix.slug }),
      log: () => {},
    });

    expect(r.interviewerName).toBe("Markus Lehner");
    const objectives = spies.createObjectives.mock.calls[0][0];
    expect(objectives[0].next_conditional_objectives).toEqual({
      end_early: "Only when the candidate explicitly asks to stop, end, or leave.",
      deliver_debrief:
        "Only when the interview portion including the candidate's questions is complete, or the candidate asks for the debrief.",
    });
    expect(objectives[1].next_required_objective).toBe("offer_redo_and_close");
    expect(spies.createGuardrail).toHaveBeenCalledTimes(13); // 12 supplied + distress_handling

    const pal = spies.createPal.mock.calls[0][0];
    expect(pal.languages).toEqual(["en", "de"]);
    expect(pal.document_ids).toEqual([]);
    expect(pal.layers?.perception?.visual_awareness_queries).toContain(
      "Is the candidate writing or calculating on paper during numerical questions?",
    );
    expect(pal.system_prompt).toContain("You are Markus Lehner");
    expect(pal.system_prompt).toContain("## Knowledge base");
    expect(pal.system_prompt).toContain("CASE 1 — RHEINGUSS AUTOMOTIVE");
    expect(pal.system_prompt).not.toContain("Runtime variables");
    expect(spies.createDocument).not.toHaveBeenCalled();
  });
});
