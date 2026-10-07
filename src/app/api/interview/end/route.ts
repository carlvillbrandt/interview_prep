import { after } from "next/server";
import { errorResponse, jsonError } from "@/lib/api";
import { scoringEnabled, tavusApiKey } from "@/lib/env";
import { finalizeInterview } from "@/lib/finalize";
import { EndInterviewRequestSchema } from "@/lib/schemas";
import { resultStore } from "@/lib/storage";
import { tavus, TavusError } from "@/lib/tavus";

export const maxDuration = 300;

/**
 * Ends a conversation and kicks off scoring. Accepts JSON from fetch() and from
 * navigator.sendBeacon (which may arrive as text/plain), so it parses the raw text.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    let parsedBody: unknown = {};
    try {
      parsedBody = raw ? JSON.parse(raw) : {};
    } catch {
      return jsonError(400, "invalid_request", "Body must be JSON.", false);
    }
    const { conversationId, reason } = EndInterviewRequestSchema.parse(parsedBody);

    const store = resultStore();
    const record = await store.get(conversationId);
    // Only end conversations this app created.
    if (!record) return jsonError(404, "unknown_conversation", "We couldn't find that interview.", false);

    if (record.status === "active") {
      try {
        await tavus(tavusApiKey()).endConversation(conversationId);
      } catch (err) {
        // Already ended (by timeout or the interviewer) is fine: we still want the result.
        if (!(err instanceof TavusError && (err.kind === "bad_request" || err.kind === "not_found"))) {
          console.warn(`[end] ${conversationId}: end call failed: ${(err as Error).message}`);
        }
      }
      await store.update(conversationId, (r) =>
        r.status === "active"
          ? {
              ...r,
              // Without scoring the interview is finished now; the transcript is attached in the background.
              status: scoringEnabled() ? "processing" : "ended",
              endedAt: new Date().toISOString(),
              endReason: reason ?? "user",
            }
          : r,
      );
    }

    after(() => finalizeInterview(conversationId));
    return Response.json({ ok: true, conversationId }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
