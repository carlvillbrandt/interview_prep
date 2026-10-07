import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { webhookSecret } from "@/lib/env";
import { finalizeInterview } from "@/lib/finalize";
import { ConversationIdSchema } from "@/lib/schemas";
import { resultStore } from "@/lib/storage";
import {
  EVENT_PERCEPTION,
  EVENT_SHUTDOWN,
  EVENT_TRANSCRIPT,
  perceptionFromEvent,
  transcriptFromEvent,
} from "@/lib/transcript";

export const maxDuration = 300;

const WebhookSchema = z.looseObject({
  conversation_id: ConversationIdSchema,
  event_type: z.string(),
  message_type: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).nullish(),
});

function tokenValid(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Tavus conversation callbacks. Tavus does not sign these, so when TAVUS_WEBHOOK_SECRET
 * is set we require it as ?token= on the callback URL we registered (DECISIONS.md §1).
 */
export async function POST(req: Request) {
  const secret = webhookSecret();
  if (secret && !tokenValid(new URL(req.url).searchParams.get("token"), secret)) {
    return jsonError(401, "unauthorized", "Invalid webhook token.", false);
  }

  const parsed = WebhookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid_request", "Unrecognised webhook payload.", false);
  const event = parsed.data;

  const store = resultStore();
  const record = await store.get(event.conversation_id);
  // Acknowledge unknown conversations so Tavus doesn't retry forever.
  if (!record) return Response.json({ ok: true, ignored: true });

  switch (event.event_type) {
    case EVENT_SHUTDOWN: {
      await store.update(record.conversationId, (r) =>
        r.status === "active"
          ? {
              ...r,
              status: "processing",
              endedAt: new Date().toISOString(),
              endReason: typeof event.properties?.reason === "string" ? event.properties.reason : "shutdown",
            }
          : r,
      );
      break;
    }
    case EVENT_PERCEPTION: {
      const perception = perceptionFromEvent(event);
      if (perception) {
        await store.update(record.conversationId, (r) => ({ ...r, perception, perceptionAvailable: true }));
      }
      break;
    }
    case EVENT_TRANSCRIPT: {
      const transcript = transcriptFromEvent(event);
      if (transcript) {
        // Give a perception event arriving right after the transcript a moment to land.
        after(async () => {
          await new Promise((r) => setTimeout(r, 4000));
          const latest = await store.get(record.conversationId);
          await finalizeInterview(record.conversationId, { transcript, perception: latest?.perception });
        });
      }
      break;
    }
    default:
      break;
  }
  return Response.json({ ok: true });
}
