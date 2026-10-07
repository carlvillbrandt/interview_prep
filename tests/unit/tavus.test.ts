import { describe, expect, it, vi } from "vitest";
import { classifyTavusError, TavusClient, TavusError } from "@/lib/tavus";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof TavusClient>[0]> = {}) {
  const sleep = vi.fn(async () => {});
  return { c: new TavusClient({ apiKey: "k_test", fetchImpl, sleep, maxRetries: 3, backoffMs: 100, ...extra }), sleep };
}

const conversation = { conversation_id: "c1", conversation_url: "https://tavus.daily.co/c1", status: "active" };

describe("TavusClient requests", () => {
  it("sends the x-api-key header and JSON body to the spec'd path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(200, conversation));
    const { c } = client(fetchImpl);
    const res = await c.createConversation({ pal_id: "p1", conversational_context: "ctx" });
    expect(res.conversation_url).toBe("https://tavus.daily.co/c1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://tavusapi.com/v2/conversations");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("k_test");
    expect(JSON.parse(String(init?.body))).toEqual({ pal_id: "p1", conversational_context: "ctx" });
  });

  it("passes verbose=true when fetching a conversation transcript", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(200, { ...conversation, events: [] }));
    const { c } = client(fetchImpl);
    await c.getConversation("c1", { verbose: true });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://tavusapi.com/v2/conversations/c1?verbose=true");
  });

  it("treats 304 from PATCH PAL as success", async () => {
    const { c } = client(vi.fn<typeof fetch>(async () => new Response(null, { status: 304 })));
    await expect(c.patchPal("p1", [{ op: "replace", path: "/system_prompt", value: "x" }])).resolves.toBeUndefined();
  });
});

describe("TavusClient retry logic", () => {
  it("retries 429 with Retry-After, then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(429, { message: "Too many requests" }, { "retry-after": "2" }))
      .mockResolvedValueOnce(json(200, conversation));
    const { c, sleep } = client(fetchImpl);
    await c.createConversation({ pal_id: "p1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries 5xx on GET with exponential backoff", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(500, { error: "boom" }))
      .mockResolvedValueOnce(json(502, { error: "bad gateway" }))
      .mockResolvedValueOnce(json(200, { pal_id: "p1" }));
    const { c, sleep } = client(fetchImpl);
    await expect(c.getPal("p1")).resolves.toMatchObject({ pal_id: "p1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [first, second] = sleep.mock.calls.map((args) => (args as unknown as [number])[0]);
    expect(first).toBeGreaterThanOrEqual(100);
    expect(first).toBeLessThan(200);
    expect(second).toBeGreaterThanOrEqual(200);
    expect(second).toBeLessThan(300);
  });

  it("does NOT retry a POST that got a 500 (it may have created a billed conversation)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(500, { error: "internal" }));
    const { c } = client(fetchImpl);
    await expect(c.createConversation({ pal_id: "p1" })).rejects.toMatchObject({ kind: "server", status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does retry a POST that got 503 (not processed)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(503, { error: "unavailable" }))
      .mockResolvedValueOnce(json(200, conversation));
    const { c } = client(fetchImpl);
    await c.createConversation({ pal_id: "p1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and throws a typed error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(503, { error: "down" }));
    const { c } = client(fetchImpl, { maxRetries: 2 });
    const err = await c.getPal("p1").catch((e) => e);
    expect(err).toBeInstanceOf(TavusError);
    expect(err.kind).toBe("server");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never retries concurrency-limit or credit errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(400, { message: "User has reached maximum concurrent conversations" }));
    const { c } = client(fetchImpl);
    await expect(c.createConversation({ pal_id: "p1" })).rejects.toMatchObject({ kind: "concurrency_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry 4xx client errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(400, { error: "Invalid pal_id" }));
    const { c } = client(fetchImpl);
    await expect(c.getPal("bad")).rejects.toMatchObject({ kind: "bad_request", message: "Invalid pal_id" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out a hung request and retries idempotent calls", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(hang).mockResolvedValueOnce(json(200, { pal_id: "p1" }));
    const { c } = client(fetchImpl, { timeoutMs: 20 });
    await expect(c.getPal("p1")).resolves.toMatchObject({ pal_id: "p1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a timed-out POST", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const fetchImpl = vi.fn<typeof fetch>(hang);
    const { c } = client(fetchImpl, { timeoutMs: 20 });
    await expect(c.createConversation({ pal_id: "p1" })).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects responses that don't match the expected schema", async () => {
    const { c } = client(vi.fn<typeof fetch>(async () => json(200, { unexpected: true })));
    await expect(c.createConversation({ pal_id: "p1" })).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("classifyTavusError", () => {
  it.each([
    [401, "Invalid access token", "unauthorized"],
    [402, "Payment required", "credits_exhausted"],
    [400, "User has reached maximum concurrent conversations", "concurrency_limit"],
    [400, "Insufficient credits remaining", "credits_exhausted"],
    [429, "slow down", "rate_limited"],
    [404, "not found", "not_found"],
    [409, "maker changes", "conflict"],
    [503, "unavailable", "server"],
    [422, "Invalid JSON patch format", "bad_request"],
  ] as const)("%i %s → %s", (status, msg, kind) => expect(classifyTavusError(status, msg)).toBe(kind));
});
