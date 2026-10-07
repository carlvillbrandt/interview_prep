import type { TranscriptTurn } from "@/lib/schemas";
import type { Conversation, ConversationEvent } from "@/lib/tavus";

/**
 * Helpers for the verbose conversation payload (`GET /v2/conversations/{id}?verbose=true`)
 * and webhook events. Event names come from the spec:
 *   application.transcription_ready   → properties.transcript[] { role, content, seconds_from_start }
 *   application.perception_analysis   → final visual analysis of the user
 *   application.perception_unavailable
 *   system.shutdown                   → properties.reason
 */

export const EVENT_TRANSCRIPT = "application.transcription_ready";
export const EVENT_PERCEPTION = "application.perception_analysis";
export const EVENT_PERCEPTION_UNAVAILABLE = "application.perception_unavailable";
export const EVENT_SHUTDOWN = "system.shutdown";

interface RawTurn {
  role?: unknown;
  content?: unknown;
  seconds_from_start?: unknown;
}

/** Normalises Tavus transcript entries: keeps user/assistant turns, drops system/tool. */
export function normalizeTranscript(raw: unknown): TranscriptTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: TranscriptTurn[] = [];
  for (const entry of raw as RawTurn[]) {
    if (!entry || typeof entry.content !== "string") continue;
    const content = entry.content.trim();
    if (!content) continue;
    let role: TranscriptTurn["role"] | null = null;
    if (entry.role === "user") role = "candidate";
    else if (entry.role === "assistant" || entry.role === "pal" || entry.role === "replica") role = "interviewer";
    if (!role) continue;
    const secondsFromStart = typeof entry.seconds_from_start === "number" ? entry.seconds_from_start : undefined;
    // Merge consecutive fragments from the same speaker into one turn.
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.content = `${prev.content} ${content}`;
    else turns.push({ role, content, ...(secondsFromStart !== undefined ? { secondsFromStart } : {}) });
  }
  return turns;
}

export function findEvent(events: ConversationEvent[] | null | undefined, type: string): ConversationEvent | undefined {
  return events?.find((e) => e.event_type === type);
}

export function transcriptFromEvent(event: Pick<ConversationEvent, "properties"> | undefined): TranscriptTurn[] | null {
  return normalizeTranscript(event?.properties?.transcript);
}

export function perceptionFromEvent(event: Pick<ConversationEvent, "properties"> | undefined): string | undefined {
  const props = event?.properties;
  if (!props) return undefined;
  for (const key of ["analysis", "perception_analysis", "summary", "visual_analysis"]) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const text = JSON.stringify(props);
  return text.length > 2 ? text.slice(0, 8000) : undefined;
}

export interface ConversationArtifacts {
  transcript: TranscriptTurn[] | null;
  perception?: string;
  /** True once Tavus has reported whether perception is available (either event). */
  perceptionSettled: boolean;
  ended: boolean;
}

export function artifactsFromConversation(conv: Conversation): ConversationArtifacts {
  const events = conv.events ?? [];
  const perceptionEvent = findEvent(events, EVENT_PERCEPTION);
  return {
    transcript: transcriptFromEvent(findEvent(events, EVENT_TRANSCRIPT)),
    perception: perceptionFromEvent(perceptionEvent),
    perceptionSettled: Boolean(perceptionEvent || findEvent(events, EVENT_PERCEPTION_UNAVAILABLE)),
    ended: conv.status === "ended" || Boolean(findEvent(events, EVENT_SHUTDOWN)),
  };
}

/* ------------------------------------------------------------------ */
/* Evidence helpers used by scoring                                    */
/* ------------------------------------------------------------------ */

export const MIN_SUBSTANTIVE_TURNS = 3;
export const MIN_SUBSTANTIVE_WORDS = 6;

export function substantiveCandidateTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  return turns.filter(
    (t) => t.role === "candidate" && t.content.split(/\s+/).filter(Boolean).length >= MIN_SUBSTANTIVE_WORDS,
  );
}

export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `quote` appears verbatim (modulo case/punctuation/whitespace) in a candidate turn. */
export function quoteInCandidateTurns(quote: string, turns: TranscriptTurn[]): boolean {
  const q = normalizeForQuote(quote.replace(/^\s*(\.\.\.|…)|(\.\.\.|…)\s*$/g, ""));
  if (q.length < 3) return false;
  return turns.some((t) => t.role === "candidate" && normalizeForQuote(t.content).includes(q));
}

export function formatTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((t, i) => `[${i + 1}] ${t.role === "candidate" ? "CANDIDATE" : "INTERVIEWER"}: ${t.content}`)
    .join("\n");
}
