import { after } from "next/server";
import { errorResponse, jsonError } from "@/lib/api";
import { finalizeInterview, isFinalizing } from "@/lib/finalize";
import { ConversationIdSchema, type PublicInterviewResult } from "@/lib/schemas";
import { resultStore } from "@/lib/storage";

export const maxDuration = 300;

/**
 * 200 with the result once complete / insufficient_data / failed; 202 while processing.
 * `?retry=1` re-runs a failed finalisation. A `processing` record with no in-flight
 * job (e.g. the server restarted mid-scoring) is re-kicked automatically.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const parsed = ConversationIdSchema.safeParse(id);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid interview id.", false);

    const record = await resultStore().get(parsed.data);
    if (!record) return jsonError(404, "not_found", "We couldn't find that interview.", false);

    const retry = new URL(req.url).searchParams.get("retry") === "1";
    if (record.status === "failed" && retry) {
      after(() => finalizeInterview(record.conversationId, { retryFailed: true }));
      return Response.json(toPublic({ ...record, status: "processing", message: undefined }), { status: 202 });
    }
    const orphaned =
      (record.status === "processing" || (record.status === "ended" && !record.transcript && !record.completedAt)) &&
      !isFinalizing(record.conversationId);
    if (orphaned) after(() => finalizeInterview(record.conversationId));

    const pending = record.status === "active" || record.status === "processing";
    return Response.json(toPublic(record), {
      status: pending ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function toPublic(record: PublicInterviewResult & { perception?: string }): PublicInterviewResult {
  // Raw perception text stays server-side; the client only needs the availability flag.
  const { perception: _perception, ...rest } = record;
  void _perception;
  return rest;
}
