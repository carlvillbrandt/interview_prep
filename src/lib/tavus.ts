import { z } from "zod";

/**
 * Typed Tavus API client (https://tavusapi.com, spec: https://docs.tavus.io/openapi.yaml).
 *
 * - Auth: `x-api-key` header (components.securitySchemes.apiKey).
 * - Retries with exponential backoff + jitter on 429 (always) and on 5xx / network errors
 *   for idempotent requests. Non-idempotent POSTs only retry when the server provably did
 *   not process them (429, 502, 503, 504) so we never create duplicate billed conversations.
 * - 15 s timeout per attempt.
 * Server-only: never import from client components.
 */

export const TAVUS_BASE_URL = "https://tavusapi.com";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type TavusErrorKind =
  | "unauthorized"
  | "concurrency_limit"
  | "credits_exhausted"
  | "rate_limited"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "server"
  | "timeout"
  | "network"
  | "invalid_response";

export class TavusError extends Error {
  constructor(
    public readonly kind: TavusErrorKind,
    message: string,
    public readonly status: number | null = null,
    public readonly body: unknown = null,
  ) {
    super(message);
    this.name = "TavusError";
  }
}

export function classifyTavusError(status: number, message: string): TavusErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "credits_exhausted";
  if (/concurrent/i.test(message)) return "concurrency_limit";
  if (/credit|balance|quota|out of (minutes|conversation)|insufficient funds|billing|upgrade your plan/i.test(message)) {
    return "credits_exhausted";
  }
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status >= 500) return "server";
  return "bad_request";
}

/* ------------------------------------------------------------------ */
/* Response schemas (loose: unknown fields pass through)               */
/* ------------------------------------------------------------------ */

export const CreateConversationResponseSchema = z.looseObject({
  conversation_id: z.string(),
  conversation_url: z.string(),
  status: z.string().optional(),
  meeting_token: z.string().optional(),
});
export type CreateConversationResponse = z.infer<typeof CreateConversationResponseSchema>;

export const ConversationEventSchema = z.looseObject({
  event_type: z.string(),
  timestamp: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).nullish(),
});
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;

export const ConversationSchema = z.looseObject({
  conversation_id: z.string(),
  conversation_name: z.string().optional(),
  conversation_url: z.string().optional(),
  status: z.string().optional(),
  pal_id: z.string().optional(),
  face_id: z.string().optional(),
  created_at: z.string().optional(),
  events: z.array(ConversationEventSchema).nullish(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationListSchema = z.looseObject({
  data: z.array(ConversationSchema),
  total_count: z.number().optional(),
});

export const CreatePalResponseSchema = z.looseObject({ pal_id: z.string() });

export const PalSchema = z.looseObject({
  pal_id: z.string(),
  pal_name: z.string().optional(),
  system_prompt: z.string().nullish(),
  default_face_id: z.string().nullish(),
  objectives_id: z.string().nullish(),
  guardrail_ids: z.array(z.string()).nullish(),
  document_ids: z.array(z.string()).nullish(),
  layers: z.record(z.string(), z.unknown()).nullish(),
});
export type Pal = z.infer<typeof PalSchema>;

export const CreateObjectivesResponseSchema = z.looseObject({ objectives_id: z.string() });
export const ObjectivesSchema = z.looseObject({
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]),
});

export const GuardrailSchema = z.looseObject({
  uuid: z.string(),
  guardrail_name: z.string().optional(),
  guardrail_prompt: z.string().optional(),
});

export const DocumentSchema = z.looseObject({
  document_id: z.string(),
  status: z.string().optional(),
  error_message: z.string().nullish(),
});

export const FaceSchema = z.looseObject({
  face_id: z.string(),
  face_name: z.string().nullish(),
  status: z.string().nullish(),
  model_name: z.string().nullish(),
  face_type: z.string().nullish(),
});
export type Face = z.infer<typeof FaceSchema>;
export const FaceListSchema = z.looseObject({
  data: z.array(FaceSchema),
  total_count: z.number().optional(),
});

/* ------------------------------------------------------------------ */
/* Request types (only the fields PrepRoom uses; names per the spec)   */
/* ------------------------------------------------------------------ */

export interface CreateConversationRequest {
  pal_id: string;
  face_id?: string;
  conversation_name?: string;
  conversational_context?: string;
  custom_greeting?: string;
  callback_url?: string;
  test_mode?: boolean;
  properties?: {
    max_call_duration?: number;
    participant_left_timeout?: number;
    participant_absent_timeout?: number;
    enable_recording?: boolean;
    enable_closed_captions?: boolean;
    languages?: string[];
  };
}

export interface PalLayers {
  llm?: { model?: string; speculative_inference?: boolean; extra_body?: Record<string, unknown> };
  stt?: { stt_engine?: string; hotwords?: string };
  tts?: { tts_engine?: string };
  conversational_flow?: {
    turn_detection_model?: string;
    turn_taking_patience?: "low" | "medium" | "high";
    pal_interruptibility?: "low" | "medium" | "high";
    idle_engagement?: "off" | "patient" | "eager";
  };
  perception?: {
    perception_model?: "raven-1" | "raven-0" | "off";
    emotion_recognition?: "full" | "limited" | "auto";
    visual_awareness_queries?: string[];
    audio_awareness_queries?: string[];
  };
}

export interface CreatePalRequest {
  pal_name: string;
  system_prompt: string;
  pipeline_mode?: "full" | "echo";
  default_face_id: string;
  languages?: string[];
  document_ids?: string[];
  objectives_id?: string;
  guardrail_ids?: string[];
  layers?: PalLayers;
}

export interface ObjectiveInput {
  objective_name: string;
  objective_prompt: string;
  confirmation_mode?: "auto" | "manual";
  next_required_objective?: string;
  next_conditional_objectives?: Record<string, string>;
  modality?: "verbal" | "visual";
  output_variables?: string[];
}

export interface GuardrailInput {
  guardrail_name: string;
  guardrail_prompt: string;
  modality?: "verbal" | "visual";
  tags?: string[];
}

export type JsonPatchOp = { op: "add" | "replace" | "remove"; path: string; value?: unknown };

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface TavusClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
  /** Base backoff in ms (doubles per attempt). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOpts<T> {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema?: z.ZodType<T>;
  /** Treat these statuses as success with no body (e.g. 304 from PATCH PAL). */
  okStatuses?: number[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TavusClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: TavusClientOptions) {
    if (!opts.apiKey) throw new TavusError("unauthorized", "Missing Tavus API key");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? TAVUS_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.backoffMs = opts.backoffMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private shouldRetry(method: Method, status: number | null): boolean {
    if (status === 429) return true;
    const idempotent = method !== "POST";
    if (status === null) return idempotent; // network error / timeout
    if (status === 502 || status === 503 || status === 504) return true;
    return idempotent && status >= 500;
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 20_000);
    }
    const base = this.backoffMs * 2 ** attempt;
    return base + Math.floor(Math.random() * this.backoffMs);
  }

  async request<T = unknown>(method: Method, path: string, opts: RequestOpts<T> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let lastError: TavusError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            "x-api-key": this.apiKey,
            accept: "application/json",
            ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (err) {
        clearTimeout(timer);
        const aborted = (err as Error).name === "AbortError";
        lastError = new TavusError(
          aborted ? "timeout" : "network",
          aborted
            ? `Tavus ${method} ${path} timed out after ${this.timeoutMs} ms`
            : `Tavus ${method} ${path} failed: ${(err as Error).message}`,
        );
        if (attempt < this.maxRetries && this.shouldRetry(method, null)) {
          await this.sleep(this.backoff(attempt, null));
          continue;
        }
        throw lastError;
      }
      clearTimeout(timer);

      const text = await res.text().catch(() => "");
      let json: unknown = undefined;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }
      }

      if (res.ok || opts.okStatuses?.includes(res.status)) {
        if (!opts.schema) return json as T;
        if (json === undefined) return undefined as T;
        const parsed = opts.schema.safeParse(json);
        if (!parsed.success) {
          throw new TavusError(
            "invalid_response",
            `Unexpected Tavus response for ${method} ${path}: ${parsed.error.issues[0]?.message}`,
            res.status,
            json,
          );
        }
        return parsed.data;
      }

      const message = extractMessage(json) ?? `HTTP ${res.status}`;
      lastError = new TavusError(classifyTavusError(res.status, message), message, res.status, json);
      // Concurrency/credit problems won't fix themselves within a retry window.
      const permanent = lastError.kind === "concurrency_limit" || lastError.kind === "credits_exhausted";
      if (!permanent && attempt < this.maxRetries && this.shouldRetry(method, res.status)) {
        await this.sleep(this.backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      throw lastError;
    }
    throw lastError ?? new TavusError("network", "Tavus request failed");
  }

  /* ---------------- Conversations ---------------- */

  createConversation(body: CreateConversationRequest) {
    return this.request("POST", "/v2/conversations", { body, schema: CreateConversationResponseSchema });
  }

  getConversation(conversationId: string, opts: { verbose?: boolean } = {}) {
    return this.request("GET", `/v2/conversations/${encodeURIComponent(conversationId)}`, {
      query: { verbose: opts.verbose ? "true" : undefined },
      schema: ConversationSchema,
    });
  }

  listConversations(query: { limit?: number; page?: number; status?: string } = {}) {
    return this.request("GET", "/v2/conversations", { query, schema: ConversationListSchema });
  }

  async endConversation(conversationId: string): Promise<void> {
    // POST /end is idempotent in effect, but keep POST retry semantics conservative.
    await this.request("POST", `/v2/conversations/${encodeURIComponent(conversationId)}/end`);
  }

  /* ---------------- PALs (formerly personas) ---------------- */

  createPal(body: CreatePalRequest) {
    return this.request("POST", "/v2/pals", { body, schema: CreatePalResponseSchema });
  }

  getPal(palId: string) {
    return this.request("GET", `/v2/pals/${encodeURIComponent(palId)}`, { schema: PalSchema });
  }

  async patchPal(palId: string, ops: JsonPatchOp[], opts: { force?: boolean } = {}): Promise<void> {
    await this.request("PATCH", `/v2/pals/${encodeURIComponent(palId)}`, {
      body: ops,
      query: { force: opts.force ? "true" : undefined },
      okStatuses: [304],
    });
  }

  /* ---------------- Objectives / Guardrails ---------------- */

  createObjectives(data: ObjectiveInput[]) {
    return this.request("POST", "/v2/objectives", { body: { data }, schema: CreateObjectivesResponseSchema });
  }

  getObjectives(objectivesId: string) {
    return this.request("GET", `/v2/objectives/${encodeURIComponent(objectivesId)}`, { schema: ObjectivesSchema });
  }

  createGuardrail(body: GuardrailInput) {
    return this.request("POST", "/v2/guardrails", { body, schema: GuardrailSchema });
  }

  getGuardrail(guardrailId: string) {
    return this.request("GET", `/v2/guardrails/${encodeURIComponent(guardrailId)}`, { schema: GuardrailSchema });
  }

  /* ---------------- Documents (knowledge base) ---------------- */

  createDocument(body: { document_url: string; document_name?: string; tags?: string[] }) {
    return this.request("POST", "/v2/documents", { body, schema: DocumentSchema });
  }

  getDocument(documentId: string) {
    return this.request("GET", `/v2/documents/${encodeURIComponent(documentId)}`, { schema: DocumentSchema });
  }

  /* ---------------- Faces (formerly replicas) ---------------- */

  listFaces(query: { face_type?: "user" | "system"; limit?: number; page?: number; verbose?: boolean } = {}) {
    return this.request("GET", "/v2/faces", { query, schema: FaceListSchema });
  }
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.slice(0, 300);
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const k of ["message", "error", "detail"]) {
      if (typeof b[k] === "string") return b[k] as string;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Default instance                                                    */
/* ------------------------------------------------------------------ */

let defaultClient: TavusClient | null = null;
let defaultClientKey: string | null = null;

export function tavus(apiKey: string): TavusClient {
  if (!defaultClient || defaultClientKey !== apiKey) {
    defaultClient = new TavusClient({ apiKey });
    defaultClientKey = apiKey;
  }
  return defaultClient;
}
