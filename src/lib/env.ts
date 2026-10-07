/**
 * Server-side environment access. Never import this from a client component:
 * it reads secrets. (`npm run check:secrets` greps the client bundle to prove they don't leak.)
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function tavusApiKey(): string {
  const key = read("TAVUS_API_KEY");
  if (!key) throw new ConfigError("TAVUS_API_KEY is not set. Add it to .env.local (see .env.example).");
  return key;
}

export function anthropicConfigured(): boolean {
  return Boolean(read("ANTHROPIC_API_KEY"));
}

/**
 * The written scorecard (Claude scoring) runs only when an Anthropic key is configured.
 * Without it, interviews end on a completion screen and the interviewer's spoken debrief
 * is the feedback. Adding the key re-enables the scorecard; no code change needed.
 */
export function scoringEnabled(): boolean {
  return anthropicConfigured();
}

export function defaultFaceIdFromEnv(): string | undefined {
  return read("TAVUS_DEFAULT_REPLICA_ID");
}

export function webhookSecret(): string | undefined {
  return read("TAVUS_WEBHOOK_SECRET");
}

export function appBaseUrl(): string {
  return (read("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * True when Tavus can reach this app: https and not a loopback/private host.
 * Webhooks and knowledge documents are only registered in that case.
 */
export function isPubliclyReachable(base = appBaseUrl()): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "[::1]") return false;
  return true;
}

export const isDev = process.env.NODE_ENV !== "production";
