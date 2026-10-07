import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";
import { InterviewParseError } from "@/lib/interviewLoader";
import { TavusError } from "@/lib/tavus";

/** Uniform JSON error responses with human-readable copy for the UI. */

export function jsonError(status: number, code: string, message: string, retryable = true, headers?: HeadersInit) {
  return Response.json({ error: { code, message, retryable } }, { status, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return jsonError(400, "invalid_request", `Invalid request: ${issue.path.join(".") || "body"} ${issue.message}`, false);
  }
  if (err instanceof ConfigError) {
    return jsonError(503, "not_configured", "The interview service isn't configured yet. Add your API keys and restart the server.", false);
  }
  if (err instanceof InterviewParseError) {
    console.error("[interview files]", err.message);
    return jsonError(500, "interview_files_invalid", "This firm's interview files are invalid. Run `npm run validate:interviews` for details.", false);
  }
  if (err instanceof TavusError) {
    console.error(`[tavus] ${err.kind} (${err.status ?? "-"}): ${err.message}`);
    switch (err.kind) {
      case "concurrency_limit":
        return jsonError(429, "concurrency_limit", "Too many interviews are running on this account right now. End any open interview tabs, wait a minute, then try again.");
      case "credits_exhausted":
        return jsonError(402, "credits_exhausted", "The video interview account is out of conversation minutes. Top up Tavus credits, then retry.", false);
      case "rate_limited":
        return jsonError(429, "rate_limited", "The video service is busy. Give it a few seconds and try again.");
      case "unauthorized":
        return jsonError(503, "not_configured", "The video service rejected our credentials. Check TAVUS_API_KEY.", false);
      case "timeout":
      case "network":
        return jsonError(504, "upstream_timeout", "We couldn't reach the video service in time. Check your connection and try again.");
      default:
        return jsonError(502, "upstream_error", "The video service returned an error while setting up your interview. Please try again.");
    }
  }
  console.error("[api] unexpected error", err);
  return jsonError(500, "internal_error", "Something went wrong on our side. Please try again.");
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/* ------------------------------------------------------------------ */
/* In-memory sliding-window rate limiter                               */
/* ------------------------------------------------------------------ */

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 if allowed (and records the hit), else ms until the next slot frees up. */
  check(key: string): number {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return this.windowMs - (t - recent[0]);
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (!v.some((h) => t - h < this.windowMs)) this.hits.delete(k);
    }
    return 0;
  }
}
