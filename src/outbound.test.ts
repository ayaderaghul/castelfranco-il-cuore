import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutbound, memoryStore, nextUtcMidnight, BLOCKED_TEXT, ServiceError } from "./outbound.js";

const MIN = 60_000;

/** A fake service: each call takes the next queued response. Counts calls and records headers. */
function fakeServer(responses: (() => Response)[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function setup(responses: (() => Response)[]) {
  let t = Date.parse("2026-10-25T10:00:00Z");
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const server = fakeServer(responses);
  const out = createOutbound({ store: memoryStore(), fetchImpl: server.fetchImpl, now: clock.now, userAgent: "test", log: () => {} });
  return { out, clock, server };
}

const opt = { cacheKey: "k", minTtlMs: 10 * MIN, defaultTtlMs: 30 * MIN };
const ok = (body = "ok", headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers });
const status = (code: number, body = "", headers: Record<string, string> = {}) => () =>
  new Response(code === 304 ? null : body, { status: code, headers });

test("fresh cache is reused without calling the service; then If-Modified-Since → 304", async () => {
  const { out, clock, server } = setup([
    ok("weather v1", { "last-modified": "Sat, 25 Oct 2026 09:00:00 GMT", expires: "Sun, 25 Oct 2026 10:40:00 GMT" }),
    status(304, "", { expires: "Sun, 25 Oct 2026 11:40:00 GMT" }),
  ]);
  assert.equal((await out.request("metno", "u", opt)).body, "weather v1");
  clock.advance(20 * MIN);
  assert.equal((await out.request("metno", "u", opt)).fromCache, true);
  assert.equal(server.calls.length, 1); // still within Expires
  clock.advance(25 * MIN);
  const r = await out.request("metno", "u", opt);
  assert.equal(r.status, 304);
  assert.equal(r.body, "weather v1");
  assert.equal(server.calls[1].headers["If-Modified-Since"], "Sat, 25 Oct 2026 09:00:00 GMT");
});

test("daily quota refusal pauses until just after midnight UTC", async () => {
  const { out, clock, server } = setup([status(429, '{"error":true,"reason":"Daily API request limit exceeded. Please try again tomorrow."}')]);
  await assert.rejects(out.request("open-meteo", "u", opt), (e: ServiceError) => e.kind === "paused");
  clock.advance(5 * 60 * MIN);
  await assert.rejects(out.request("open-meteo", "u", opt), (e: ServiceError) => e.until === nextUtcMidnight(Date.parse("2026-10-25T10:00:00Z")));
  assert.equal(server.calls.length, 1); // no second call while paused
});

test("Retry-After is respected, capped at one day", async () => {
  const { out, clock, server } = setup([status(503, "", { "retry-after": "120" }), ok("back")]);
  await assert.rejects(out.request("ansa", "u", opt));
  clock.advance(60_000);
  await assert.rejects(out.request("ansa", "u", opt), (e: ServiceError) => e.kind === "paused");
  clock.advance(61_000);
  assert.equal((await out.request("ansa", "u", opt)).body, "back");
  assert.equal(server.calls.length, 2);

  const s2 = setup([status(429, "", { "retry-after": String(5 * 24 * 3600) })]);
  await assert.rejects(s2.out.request("gdelt", "u", opt), (e: ServiceError) => e.until === s2.clock.now() + 24 * 60 * MIN);
});

test("403: 'you are blocked', 1 hour, then 1 day, then stop calling", async () => {
  const { out, clock, server } = setup([status(403), status(403), status(403)]);
  await assert.rejects(out.request("metno", "u", opt), (e: ServiceError) => e.kind === "blocked" && e.message.includes(BLOCKED_TEXT));
  clock.advance(30 * MIN);
  await assert.rejects(out.request("metno", "u", opt)); // still paused, no call
  assert.equal(server.calls.length, 1);
  clock.advance(31 * MIN);
  await assert.rejects(out.request("metno", "u", opt), (e: ServiceError) => e.until === clock.now() + 24 * 60 * MIN);
  clock.advance(24 * 60 * MIN + MIN);
  await assert.rejects(out.request("metno", "u", opt), (e: ServiceError) => e.kind === "stopped");
  clock.advance(7 * 24 * 60 * MIN);
  await assert.rejects(out.request("metno", "u", opt), (e: ServiceError) => e.kind === "stopped");
  assert.equal(server.calls.length, 3);
  const st = (await out.statuses()).find((s) => s.id === "metno")!;
  assert.equal(st.status, "stopped");
});

test("server errors and timeouts back off 1, 2, 4 … 60 minutes; success resets", async () => {
  const fails = Array.from({ length: 8 }, () => status(500));
  const { out, clock } = setup([...fails, ok("fine"), status(500)]);
  const waits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const e = (await out.request("vnexpress", "u", opt).catch((x) => x)) as ServiceError;
    waits.push((e.until! - clock.now()) / MIN);
    clock.advance(e.until! - clock.now() + 1);
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 16, 32, 60, 60]);
  assert.equal((await out.request("vnexpress", "u", opt)).body, "fine");
  clock.advance(31 * MIN);
  const e = (await out.request("vnexpress", "u", { ...opt, cacheKey: "other" }).catch((x) => x)) as ServiceError;
  assert.equal((e.until! - clock.now()) / MIN, 1); // counter was reset by the success
});

test("400/404 for one resource does not pause the service", async () => {
  const { out } = setup([status(404), ok("other place")]);
  await assert.rejects(out.request("gdelt", "u", opt), (e: ServiceError) => e.kind === "bad-request");
  assert.equal((await out.request("gdelt", "u2", { ...opt, cacheKey: "k2" })).body, "other place");
});

test("while paused, an old cached copy is served instead of calling", async () => {
  const { out, clock, server } = setup([ok("old news"), status(502)]);
  await out.request("ansa", "u", opt);
  clock.advance(31 * MIN);
  const r = await out.request("ansa", "u", opt); // 502 → paused, stale copy returned
  assert.equal(r.stale, true);
  assert.equal(r.body, "old news");
  const r2 = await out.request("ansa", "u", opt);
  assert.equal(r2.stale, true);
  assert.equal(server.calls.length, 2);
});
