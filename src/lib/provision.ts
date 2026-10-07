import { createHash } from "node:crypto";
import type { Company } from "@/data/catalog";
import { appBaseUrl, defaultFaceIdFromEnv, isDev, isPubliclyReachable } from "@/lib/env";
import {
  buildPalSystemPrompt,
  extractInterviewerName,
  loadInterview,
  renderForPal,
  type InterviewContent,
} from "@/lib/interviewLoader";
import { provisionCache, type ProvisionCacheStore, type ProvisionEntry } from "@/lib/storage";
import {
  TavusError,
  type CreatePalRequest,
  type Face,
  type JsonPatchOp,
  type PalLayers,
  type TavusClient,
} from "@/lib/tavus";

/**
 * Bump when the PAL configuration produced by this file changes (layers, naming, prompt
 * assembly). Part of the content hash, so every company re-provisions on next start.
 */
export const PROVISION_VERSION = 1;

/** Low-latency pipeline per the spec's recommended defaults (see DECISIONS.md §1). */
export function palLayers(companyName: string): PalLayers {
  return {
    llm: { model: "tavus-gemma-4", speculative_inference: true },
    stt: {
      stt_engine: "tavus-auto",
      hotwords: `${companyName} is the firm being interviewed for. Common terms: EBITDA, DCF, LBO, IRR, enterprise value, market sizing, TAM, MECE, hypothesis.`,
    },
    tts: { tts_engine: "tavus-auto" },
    conversational_flow: {
      turn_detection_model: "sparrow-2",
      turn_taking_patience: "medium",
      pal_interruptibility: "medium",
      // Gently re-engages after long silences (a frozen candidate or a dropped mic).
      idle_engagement: "patient",
    },
    perception: {
      perception_model: "raven-1",
      emotion_recognition: "auto",
      visual_awareness_queries: [
        "Is the candidate looking toward the camera and engaged?",
        "Does the candidate appear nervous, distressed or uncomfortable?",
        "Is the candidate reading from notes or another screen?",
      ],
      audio_awareness_queries: [
        "Does the candidate sound confident or hesitant?",
        "Is the candidate speaking very quickly or rambling?",
      ],
    },
  };
}

export interface ProvisionResult extends ProvisionEntry {
  reused: boolean;
  interviewerName?: string;
}

export interface ProvisionDeps {
  client: TavusClient;
  cache?: ProvisionCacheStore;
  load?: (industry: string, slug: string) => Promise<InterviewContent>;
  log?: (msg: string) => void;
  /** Document readiness polling; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

export function computeContentHash(content: InterviewContent, companyName: string, faceId: string): string {
  const h = createHash("sha256");
  const part = (label: string, value: string) => {
    h.update(label);
    h.update("\0");
    h.update(value);
    h.update("\0");
  };
  part("version", String(PROVISION_VERSION));
  part("company", companyName);
  part("face", faceId);
  part("systemprompt", content.systemPrompt);
  part("capabilities", content.capabilities);
  part("guardrails", content.guardrailsText);
  part("objectives", content.objectivesText);
  for (const k of content.knowledge) part(`knowledge:${k.name}`, k.content);
  return h.digest("hex");
}

/* ------------------------------------------------------------------ */
/* Face (replica) selection                                            */
/* ------------------------------------------------------------------ */

const MODEL_PREFERENCE = ["phoenix-4.5", "phoenix-4", "phoenix-3"];

export function pickStockFace(faces: Face[]): Face | undefined {
  const usable = faces.filter((f) => !f.status || f.status === "completed");
  return [...usable].sort((a, b) => rank(a) - rank(b))[0];
  function rank(f: Face) {
    const i = MODEL_PREFERENCE.indexOf(f.model_name ?? "");
    return i === -1 ? MODEL_PREFERENCE.length : i;
  }
}

export async function resolveFaceId(client: TavusClient, cache: ProvisionCacheStore): Promise<string> {
  const fromEnv = defaultFaceIdFromEnv();
  if (fromEnv) return fromEnv;
  const cached = await cache.getDefaultFaceId();
  if (cached) return cached;
  const list = await client.listFaces({ face_type: "system", verbose: true, limit: 100 });
  const face = pickStockFace(list.data);
  if (!face) {
    throw new TavusError(
      "bad_request",
      "No stock Tavus face is available on this account. Set TAVUS_DEFAULT_REPLICA_ID to a face id.",
    );
  }
  await cache.setDefaultFaceId(face.face_id);
  return face.face_id;
}

/* ------------------------------------------------------------------ */
/* Provisioning                                                        */
/* ------------------------------------------------------------------ */

const inflight = new Map<string, Promise<ProvisionResult>>();

export function cacheKey(company: Pick<Company, "industry" | "slug">): string {
  return `${company.industry}/${company.slug}`;
}

/** Provision (or reuse) the Tavus resources for a company. Concurrent calls share one run. */
export function provisionCompany(company: Company, deps: ProvisionDeps): Promise<ProvisionResult> {
  const key = cacheKey(company);
  const existing = inflight.get(key);
  if (existing) return existing;
  const run = doProvision(company, deps).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function doProvision(company: Company, deps: ProvisionDeps): Promise<ProvisionResult> {
  const { client } = deps;
  const cache = deps.cache ?? provisionCache();
  const load = deps.load ?? loadInterview;
  const log = deps.log ?? ((m: string) => isDev && console.info(`[provision] ${m}`));
  const key = cacheKey(company);

  const content = await load(company.industry, company.slug);
  const interviewerName = extractInterviewerName(content.systemPrompt);
  const faceId = await resolveFaceId(client, cache);
  const hash = computeContentHash(content, company.name, faceId);

  const cached = await cache.get(key);
  if (cached && cached.hash === hash) {
    log(`${key}: content unchanged (hash ${hash.slice(0, 10)}), reusing PAL ${cached.palId}`);
    return { ...cached, reused: true, interviewerName };
  }
  log(`${key}: ${cached ? "content changed" : "first provision"}, hash ${hash.slice(0, 10)}`);

  const shortHash = hash.slice(0, 8);
  const slugId = company.slug.replace(/-/g, "_");

  // 1. Objectives (one set, ordered via next_required_objective)
  const objectives = await client.createObjectives(
    content.objectives.map((o) => ({
      objective_name: o.name,
      objective_prompt: renderForPal(o.prompt, company.name),
      confirmation_mode: o.confirmation_mode ?? "auto",
      ...(o.next ? { next_required_objective: o.next } : {}),
      ...(o.modality ? { modality: o.modality } : {}),
      ...(o.output_variables ? { output_variables: o.output_variables } : {}),
    })),
  );
  log(`${key}: objectives ${objectives.objectives_id} (${content.objectives.length} stages)`);

  // 2. Guardrails (individual resources; attached via guardrail_ids)
  const guardrailIds: string[] = [];
  for (const g of content.guardrails) {
    const created = await client.createGuardrail({
      guardrail_name: `${slugId}_${g.name}`.slice(0, 91) + `_${shortHash}`,
      guardrail_prompt: renderForPal(g.prompt, company.name),
      modality: g.modality ?? "verbal",
      tags: ["preproom", `preproom_${slugId}`.slice(0, 64)],
    });
    guardrailIds.push(created.uuid);
  }
  log(`${key}: ${guardrailIds.length} guardrails`);

  // 3. Knowledge documents (only if Tavus can fetch them from us)
  const documentIds = await provisionKnowledge(company, content, shortHash, deps, log);

  // 4. PAL — patch the existing one if we have it, otherwise create.
  const palBody: CreatePalRequest = {
    pal_name: `PrepRoom · ${company.name}`,
    system_prompt: buildPalSystemPrompt(content, company.name),
    pipeline_mode: "full",
    default_face_id: faceId,
    languages: ["en"],
    objectives_id: objectives.objectives_id,
    guardrail_ids: guardrailIds,
    document_ids: documentIds,
    layers: palLayers(company.name),
  };

  let palId: string | null = null;
  if (cached?.palId) {
    try {
      await patchPal(client, cached.palId, palBody);
      palId = cached.palId;
      log(`${key}: patched PAL ${palId}`);
    } catch (err) {
      if (!(err instanceof TavusError && (err.kind === "not_found" || err.status === 400))) throw err;
      log(`${key}: existing PAL ${cached.palId} unusable (${err.message}); creating a new one`);
    }
  }
  if (!palId) {
    palId = (await client.createPal(palBody)).pal_id;
    log(`${key}: created PAL ${palId}`);
  }

  const entry: ProvisionEntry = {
    hash,
    palId,
    objectivesId: objectives.objectives_id,
    guardrailIds,
    documentIds,
    faceId,
    provisionedAt: new Date().toISOString(),
  };
  await cache.set(key, entry);

  if (isDev) {
    // Dev-mode proof that the PAL really carries this company's files.
    verifyProvisioning(client, entry, palBody.system_prompt)
      .then((r) => log(`${key}: verification ${r.ok ? "OK" : "MISMATCH"} ${JSON.stringify(r.checks)}`))
      .catch((e) => log(`${key}: verification failed: ${(e as Error).message}`));
  }
  return { ...entry, reused: false, interviewerName };
}

async function patchPal(client: TavusClient, palId: string, body: CreatePalRequest): Promise<void> {
  // "add" on an object member replaces it if present (RFC 6902 §4.1), so it works
  // whether or not the field currently exists on the PAL.
  const ops: JsonPatchOp[] = [
    { op: "add", path: "/pal_name", value: body.pal_name },
    { op: "add", path: "/system_prompt", value: body.system_prompt },
    { op: "add", path: "/default_face_id", value: body.default_face_id },
    { op: "add", path: "/objectives_id", value: body.objectives_id },
    { op: "add", path: "/guardrail_ids", value: body.guardrail_ids },
    { op: "add", path: "/document_ids", value: body.document_ids ?? [] },
    { op: "add", path: "/languages", value: body.languages },
    { op: "add", path: "/layers/llm", value: body.layers?.llm },
    { op: "add", path: "/layers/stt", value: body.layers?.stt },
    { op: "add", path: "/layers/tts", value: body.layers?.tts },
    { op: "add", path: "/layers/conversational_flow", value: body.layers?.conversational_flow },
    { op: "add", path: "/layers/perception", value: body.layers?.perception },
  ];
  try {
    await client.patchPal(palId, ops);
  } catch (err) {
    // 409: the PAL has unpublished PAL-Maker edits. Our files are the source of truth.
    if (err instanceof TavusError && err.kind === "conflict") {
      await client.patchPal(palId, ops, { force: true });
      return;
    }
    throw err;
  }
}

async function provisionKnowledge(
  company: Company,
  content: InterviewContent,
  shortHash: string,
  deps: ProvisionDeps,
  log: (m: string) => void,
): Promise<string[]> {
  if (content.knowledge.length === 0) return [];
  if (!isPubliclyReachable()) {
    log(
      `${cacheKey(company)}: skipping ${content.knowledge.length} knowledge file(s): Tavus can only ingest documents by public URL and APP_BASE_URL is not public`,
    );
    return [];
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = appBaseUrl();
  const created: string[] = [];
  for (const k of content.knowledge) {
    const fileTxt = k.name.replace(/\.md$/i, ".txt");
    const doc = await deps.client.createDocument({
      document_url: `${base}/api/knowledge/${company.industry}/${company.slug}/${encodeURIComponent(fileTxt)}?v=${shortHash}`,
      document_name: `${company.name} — ${k.name}`,
      tags: ["preproom", `preproom_${company.slug.replace(/-/g, "_")}`],
    });
    created.push(doc.document_id);
  }
  // Documents process asynchronously; only attach those that become ready in time.
  const ready = new Set<string>();
  const deadline = Date.now() + 60_000;
  while (ready.size < created.length && Date.now() < deadline) {
    for (const id of created) {
      if (ready.has(id)) continue;
      const d = await deps.client.getDocument(id);
      if (d.status === "ready") ready.add(id);
      if (d.status === "error") {
        log(`${cacheKey(company)}: document ${id} failed: ${d.error_message ?? "unknown"}`);
        created.splice(created.indexOf(id), 1);
      }
    }
    if (ready.size < created.length) await sleep(3000);
  }
  if (ready.size < created.length) {
    log(`${cacheKey(company)}: ${created.length - ready.size} document(s) not ready within 60 s; attaching ready ones only`);
  }
  return [...ready];
}

/* ------------------------------------------------------------------ */
/* Verification (dev + `npm run provision -- --verify`)                */
/* ------------------------------------------------------------------ */

export interface VerificationReport {
  ok: boolean;
  checks: Record<string, "ok" | "mismatch" | "not_returned">;
}

export async function verifyProvisioning(
  client: TavusClient,
  entry: ProvisionEntry,
  expectedSystemPrompt: string,
): Promise<VerificationReport> {
  const pal = await client.getPal(entry.palId);
  const checks: VerificationReport["checks"] = {};
  const cmp = (name: string, actual: unknown, expected: unknown) => {
    if (actual === undefined || actual === null) checks[name] = "not_returned";
    else checks[name] = JSON.stringify(actual) === JSON.stringify(expected) ? "ok" : "mismatch";
  };
  cmp("system_prompt", pal.system_prompt?.trim(), expectedSystemPrompt.trim());
  cmp("default_face_id", pal.default_face_id, entry.faceId);
  cmp("objectives_id", pal.objectives_id, entry.objectivesId);
  cmp(
    "guardrail_ids",
    pal.guardrail_ids ? [...pal.guardrail_ids].sort() : pal.guardrail_ids,
    [...entry.guardrailIds].sort(),
  );
  // Cross-check the referenced resources exist with the expected content.
  try {
    await client.getObjectives(entry.objectivesId);
    checks.objectives_resource = "ok";
  } catch {
    checks.objectives_resource = "mismatch";
  }
  try {
    await Promise.all(entry.guardrailIds.map((id) => client.getGuardrail(id)));
    checks.guardrail_resources = "ok";
  } catch {
    checks.guardrail_resources = "mismatch";
  }
  return { ok: !Object.values(checks).includes("mismatch"), checks };
}
