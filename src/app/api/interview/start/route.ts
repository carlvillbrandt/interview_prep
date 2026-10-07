import { getCompany } from "@/data/catalog";
import { clientIp, errorResponse, jsonError, RateLimiter } from "@/lib/api";
import { appBaseUrl, isDev, isPubliclyReachable, scoringEnabled, tavusApiKey, webhookSecret } from "@/lib/env";
import { provisionCompany } from "@/lib/provision";
import { StartInterviewRequestSchema, type StartInterviewResponse } from "@/lib/schemas";
import { buildConversationalContext, buildGreeting, maxCallSeconds } from "@/lib/session";
import { resultStore } from "@/lib/storage";
import { tavus } from "@/lib/tavus";

export const maxDuration = 120;

const g = globalThis as unknown as { __preproomStartLimiter?: RateLimiter };
const limiter = (g.__preproomStartLimiter ??= new RateLimiter(5, 10 * 60_000));

export async function POST(req: Request) {
  const wait = limiter.check(clientIp(req));
  if (wait > 0) {
    const secs = Math.ceil(wait / 1000);
    return jsonError(
      429,
      "rate_limited",
      `You've started several interviews in a short time. Please wait ${secs > 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`} before starting another.`,
      true,
      { "retry-after": String(secs) },
    );
  }

  try {
    const body = StartInterviewRequestSchema.parse(await req.json().catch(() => ({})));
    const company = getCompany(body.industry, body.company);
    if (!company) return jsonError(404, "unknown_company", "That firm isn't in the PrepRoom catalog.", false);

    const client = tavus(tavusApiKey());
    const provisioned = await provisionCompany(company, { client });
    const { settings } = provisioned.content;
    const maxDurationSeconds = maxCallSeconds(settings);

    const callbackBase = isPubliclyReachable() ? `${appBaseUrl()}/api/webhooks/tavus` : undefined;
    const secret = webhookSecret();
    const callbackUrl = callbackBase && secret ? `${callbackBase}?token=${encodeURIComponent(secret)}` : callbackBase;

    const conversation = await client.createConversation({
      pal_id: provisioned.palId,
      conversation_name: `PrepRoom · ${company.name} · ${body.level} · ${body.focus}`.slice(0, 120),
      conversational_context: buildConversationalContext({
        company,
        level: body.level,
        focus: body.focus,
        candidateName: body.candidateName,
        settings,
        cvText: body.cvText,
        writtenScorecard: scoringEnabled(),
      }),
      custom_greeting: buildGreeting({
        company,
        interviewerName: provisioned.interviewerName,
        candidateName: body.candidateName,
        settings,
      }),
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      properties: {
        max_call_duration: maxDurationSeconds,
        participant_left_timeout: 10,
        participant_absent_timeout: 120,
        enable_closed_captions: true,
        enable_recording: false,
        languages: settings.languages,
      },
    });

    await resultStore().put({
      conversationId: conversation.conversation_id,
      industry: company.industry,
      company: company.slug,
      companyName: company.name,
      level: body.level,
      focus: body.focus,
      candidateName: body.candidateName,
      status: "active",
      createdAt: new Date().toISOString(),
      perceptionAvailable: false,
    });

    if (isDev) {
      console.info(
        `[start] ${company.slug}: conversation ${conversation.conversation_id} on PAL ${provisioned.palId} ` +
          `(objectives ${provisioned.objectivesId}, ${provisioned.guardrailIds.length} guardrails, ` +
          `${provisioned.reused ? "cached" : "freshly provisioned"}, ${settings.maxCallMinutes} min, ${settings.languages.join("/")}` +
          `${body.cvText ? ", CV attached" : ""})${callbackUrl ? "" : " (webhook disabled: polling fallback)"}`,
      );
    }

    const response: StartInterviewResponse = {
      conversationId: conversation.conversation_id,
      conversationUrl: conversation.meeting_token
        ? `${conversation.conversation_url}?t=${conversation.meeting_token}`
        : conversation.conversation_url,
      maxDurationSeconds,
      interviewerName: provisioned.interviewerName,
    };
    return Response.json(response, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
