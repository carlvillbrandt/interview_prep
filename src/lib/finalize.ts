import { getCompany, type Company } from "@/data/catalog";
import { scoringEnabled, tavusApiKey } from "@/lib/env";
import { loadInterview } from "@/lib/interviewLoader";
import type { InterviewRecord, TranscriptTurn } from "@/lib/schemas";
import { scoreInterview, ScoringError } from "@/lib/scoring";
import { resultStore } from "@/lib/storage";
import { tavus, TavusError } from "@/lib/tavus";
import { artifactsFromConversation } from "@/lib/transcript";

/**
 * Turns an ended conversation into a stored result. Idempotent and single-flight per
 * conversation, so the /end route, the webhook and the results page can all call it safely.
 */

const TRANSCRIPT_WAIT_MS = 90_000;
const PERCEPTION_GRACE_MS = 8_000;

const inflight = new Map<string, Promise<void>>();

export interface FinalizeOptions {
  /** Transcript delivered by webhook; skips polling. */
  transcript?: TranscriptTurn[];
  perception?: string;
  /** Re-run a previously failed finalisation. */
  retryFailed?: boolean;
}

export function isFinalizing(conversationId: string): boolean {
  return inflight.has(conversationId);
}

export function finalizeInterview(conversationId: string, opts: FinalizeOptions = {}): Promise<void> {
  const existing = inflight.get(conversationId);
  if (existing) return existing;
  const run = doFinalize(conversationId, opts)
    .catch((err) => console.error(`[finalize] ${conversationId}:`, err))
    .finally(() => inflight.delete(conversationId));
  inflight.set(conversationId, run);
  return run;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pollTranscript(
  conversationId: string,
): Promise<{ transcript: TranscriptTurn[] | null; perception?: string }> {
  const client = tavus(tavusApiKey());
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  let delay = 1500;
  let transcriptSeenAt: number | null = null;
  let latest: { transcript: TranscriptTurn[] | null; perception?: string } = { transcript: null };

  while (Date.now() < deadline) {
    try {
      const conv = await client.getConversation(conversationId, { verbose: true });
      const a = artifactsFromConversation(conv);
      latest = { transcript: a.transcript, perception: a.perception };
      if (a.transcript) {
        transcriptSeenAt ??= Date.now();
        // Perception analysis can land a few seconds after the transcript; wait briefly for it.
        if (a.perceptionSettled || Date.now() - transcriptSeenAt > PERCEPTION_GRACE_MS) return latest;
      }
    } catch (err) {
      if (err instanceof TavusError && (err.kind === "unauthorized" || err.kind === "not_found")) throw err;
      console.warn(`[finalize] ${conversationId}: poll failed, retrying: ${(err as Error).message}`);
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 8000);
  }
  return latest;
}

function companyFor(record: InterviewRecord): Company {
  return (
    getCompany(record.industry, record.company) ?? {
      industry: record.industry,
      slug: record.company,
      name: record.companyName,
      tagline: "",
      featured: false,
      interviewStyle: "Mixed",
    }
  );
}

/**
 * Scoring disabled: the interview is already "ended" for the candidate. Fetch the transcript
 * so it can be shown (and scored later if a key is added), but never mark the record failed.
 */
async function attachTranscriptOnly(conversationId: string, opts: FinalizeOptions): Promise<void> {
  const store = resultStore();
  const record = await store.get(conversationId);
  if (!record || record.transcript || record.completedAt) return;
  await store.update(conversationId, (r) => ({ ...r, status: "ended", endedAt: r.endedAt ?? new Date().toISOString() }));
  let transcript = opts.transcript ?? null;
  let perception = opts.perception;
  if (!transcript) {
    try {
      const polled = await pollTranscript(conversationId);
      transcript = polled.transcript;
      perception ??= polled.perception;
    } catch (err) {
      console.warn(`[finalize] ${conversationId}: transcript unavailable: ${(err as Error).message}`);
    }
  }
  await store.update(conversationId, (r) => ({
    ...r,
    status: "ended",
    transcript: transcript ?? r.transcript,
    perception: perception ?? r.perception,
    perceptionAvailable: Boolean(perception ?? r.perception),
    completedAt: new Date().toISOString(),
  }));
}

async function doFinalize(conversationId: string, opts: FinalizeOptions): Promise<void> {
  const store = resultStore();
  const record = await store.get(conversationId);
  if (!record) return;
  if (record.status === "complete" || record.status === "insufficient_data") return;
  if (record.status === "failed" && !opts.retryFailed) return;
  if (!scoringEnabled()) return attachTranscriptOnly(conversationId, opts);

  const fail = (message: string) =>
    store.update(conversationId, (r) => ({ ...r, status: "failed", message, completedAt: new Date().toISOString() }));

  await store.update(conversationId, (r) => ({
    ...r,
    status: "processing",
    message: undefined,
    endedAt: r.endedAt ?? new Date().toISOString(),
  }));

  // 1. Transcript: webhook payload > previously stored > poll Tavus.
  let transcript = opts.transcript ?? record.transcript ?? null;
  let perception = opts.perception ?? record.perception;
  if (!transcript) {
    try {
      const polled = await pollTranscript(conversationId);
      transcript = polled.transcript;
      perception ??= polled.perception;
    } catch (err) {
      await fail(`We couldn't retrieve the transcript from Tavus (${(err as Error).message}).`);
      return;
    }
  }
  if (!transcript) {
    await fail(
      "Tavus hasn't delivered a transcript for this call yet. This can happen right after very short calls. Retry in a minute.",
    );
    return;
  }

  await store.update(conversationId, (r) => ({
    ...r,
    transcript: transcript ?? undefined,
    perception,
    perceptionAvailable: Boolean(perception),
  }));

  // 2. Score.
  try {
    const company = companyFor(record);
    let objectivesText = "(objectives file unavailable)";
    let firmReference: string | undefined;
    try {
      const content = await loadInterview(company.industry, company.slug);
      objectivesText = content.objectivesText;
      if (content.knowledge.length) firmReference = content.knowledge.map((k) => k.content).join("\n\n").slice(0, 60_000);
    } catch {
      // Score without firm reference material rather than failing.
    }
    const outcome = await scoreInterview({
      company,
      level: record.level,
      focus: record.focus,
      transcript,
      objectivesText,
      perception,
      firmReference,
    });
    const completedAt = new Date().toISOString();
    if (outcome.kind === "insufficient_data") {
      await store.update(conversationId, (r) => ({
        ...r,
        status: "insufficient_data",
        message: outcome.message,
        completedAt,
      }));
    } else {
      await store.update(conversationId, (r) => ({
        ...r,
        status: "complete",
        scoring: outcome.scoring,
        scoringModel: outcome.model,
        message: undefined,
        completedAt,
      }));
    }
  } catch (err) {
    const msg =
      err instanceof ScoringError
        ? err.message
        : `Scoring failed: ${(err as Error).message ?? "unknown error"}.`;
    console.error(`[finalize] ${conversationId}: scoring error`, err);
    await fail(msg);
  }
}
