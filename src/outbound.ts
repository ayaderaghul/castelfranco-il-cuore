// Every request the server makes to an outside service goes through here.
//
// Politeness rules (per service, persisted in the database so a restart doesn't reset them):
// - Cached responses are reused until they expire (the service's Expires / Cache-Control,
//   clamped to our own minimum), and refreshed with If-Modified-Since / If-None-Match.
// - A daily-quota refusal pauses the service until just after midnight UTC.
// - A Retry-After header is respected, up to one day.
// - 403 ("you are blocked"): pause 1 hour; if blocked again, pause 1 day; if blocked a
//   third time, stop calling it until someone resets it.
// - Server errors, timeouts and network failures back off 1, 2, 4, … up to 60 minutes.
// - A bad request for one resource (400/404/410/422) or a bad key (401) does not pause the service.

export type ServiceId = "metno" | "open-meteo" | "ansa" | "vnexpress" | "gdelt" | "anthropic";

export interface ServiceInfo {
  id: ServiceId;
  name: string;
  purpose: string;
  terms: string;
  credit?: string;
}

export const SERVICES: Record<ServiceId, ServiceInfo> = {
  metno: {
    id: "metno",
    name: "MET Norway (api.met.no)",
    purpose: "meteo di Castelfranco e Hải Phòng",
    terms: "https://api.met.no/doc/TermsOfService",
    credit: "Dati meteo: MET Norway (CC BY 4.0)",
  },
  "open-meteo": {
    id: "open-meteo",
    name: "Open-Meteo",
    purpose: "meteo di riserva, se MET Norway non risponde",
    terms: "https://open-meteo.com/en/terms",
    credit: "Weather data by Open-Meteo.com (CC BY 4.0)",
  },
  ansa: {
    id: "ansa",
    name: "ANSA (feed RSS)",
    purpose: "notizie: mondo, Italia, Europa, Veneto",
    terms: "https://www.ansa.it",
    credit: "Notizie: ANSA",
  },
  vnexpress: {
    id: "vnexpress",
    name: "VnExpress (feed RSS)",
    purpose: "notizie dal Vietnam",
    terms: "https://vnexpress.net",
    credit: "Tin tức: VnExpress",
  },
  gdelt: {
    id: "gdelt",
    name: "GDELT Project",
    purpose: "notizie sul Vietnam di riserva",
    terms: "https://www.gdeltproject.org/about.html#termsofuse",
    credit: "Notizie: GDELT Project",
  },
  anthropic: {
    id: "anthropic",
    name: "Claude API (Anthropic)",
    purpose: "punteggio automatico degli eventi (solo se c'è la chiave)",
    terms: "https://www.anthropic.com/legal/commercial-terms",
  },
};

export interface ServiceState {
  service: ServiceId;
  pausedUntil: number | null; // epoch ms
  reason: string | null;
  failures: number; // consecutive server/network failures (for exponential backoff)
  blockedStage: number; // consecutive 403s: 1 → 1h, 2 → 1 day, 3 → stopped
  disabled: boolean;
}

export interface CacheRow {
  key: string;
  body: string;
  etag: string | null;
  lastModified: string | null;
  expiresAt: number; // epoch ms
  fetchedAt: number;
}

export interface Store {
  getState(s: ServiceId): Promise<ServiceState | null>;
  putState(st: ServiceState): Promise<void>;
  getCache(key: string): Promise<CacheRow | null>;
  putCache(row: CacheRow): Promise<void>;
}

export type FailureKind = "paused" | "blocked" | "stopped" | "bad-request" | "failed";

export class ServiceError extends Error {
  constructor(
    public service: ServiceId,
    public kind: FailureKind,
    message: string,
    public until: number | null = null,
  ) {
    super(message);
  }
}

export const BLOCKED_TEXT = "you are blocked";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface FetchOptions {
  cacheKey: string;
  minTtlMs: number; // never refetch sooner than this, whatever the server says
  defaultTtlMs: number; // when the server gives no Expires / max-age
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  /** POSTs (like the Claude API) aren't cached; they only go through the pause rules. */
  cache?: boolean;
}

export interface Fetched {
  body: string;
  status: number;
  stale: boolean; // true = old copy served because the service is paused or failing
  fromCache: boolean;
  fetchedAt: number; // when this body was last confirmed by the service
}

const fresh = (s: ServiceId): ServiceState => ({
  service: s,
  pausedUntil: null,
  reason: null,
  failures: 0,
  blockedStage: 0,
  disabled: false,
});

/** Seconds or an HTTP date → milliseconds from now (null if missing/invalid). */
export function parseRetryAfter(v: string | null, now: number): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/** When the response may be reused until, from Cache-Control max-age or Expires. */
export function expiryFrom(headers: Headers, now: number, minTtl: number, defTtl: number): number {
  let ttl: number | null = null;
  const cc = headers.get("cache-control");
  const m = cc?.match(/max-age=(\d+)/);
  if (m) ttl = Number(m[1]) * 1000;
  else {
    const exp = headers.get("expires");
    const t = exp ? Date.parse(exp) : NaN;
    if (!Number.isNaN(t)) ttl = t - now;
  }
  if (ttl === null) ttl = defTtl;
  return now + Math.min(DAY, Math.max(minTtl, ttl));
}

/** Just after the next midnight UTC, when daily quotas reset. */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5, 0);
}

const backoffMs = (failures: number) => Math.min(60, 2 ** Math.max(0, failures - 1)) * MIN;

export function createOutbound(deps: {
  store: Store;
  fetchImpl?: typeof fetch;
  now?: () => number;
  userAgent: string;
  log?: (msg: string) => void;
}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));

  async function state(s: ServiceId): Promise<ServiceState> {
    return (await deps.store.getState(s)) ?? fresh(s);
  }

  async function onSuccess(st: ServiceState) {
    if (st.failures || st.blockedStage || st.pausedUntil || st.reason) {
      log(`[${st.service}] di nuovo ok`);
      await deps.store.putState(fresh(st.service));
    }
  }

  async function pause(st: ServiceState, ms: number, reason: string) {
    st.pausedUntil = now() + ms;
    st.reason = reason;
    await deps.store.putState(st);
    log(`[${st.service}] in pausa fino a ${new Date(st.pausedUntil).toISOString()}: ${reason}`);
  }

  /** Decides the pause after a failed response. Returns the error to raise. */
  async function handleFailure(st: ServiceState, res: Response | null, bodyText: string, netErr?: Error): Promise<ServiceError> {
    const s = st.service;
    if (res) {
      const code = res.status;
      if ([400, 401, 404, 410, 422].includes(code)) {
        return new ServiceError(s, "bad-request", `${SERVICES[s].name}: richiesta non valida (${code})`);
      }
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now());
      if (code === 403) {
        st.blockedStage += 1;
        st.failures = 0;
        if (st.blockedStage >= 3) {
          st.disabled = true;
          st.pausedUntil = null;
          st.reason = BLOCKED_TEXT;
          await deps.store.putState(st);
          log(`[${s}] bloccato per la terza volta: smetto di chiamarlo`);
          return new ServiceError(s, "stopped", `${SERVICES[s].name}: ${BLOCKED_TEXT}`);
        }
        await pause(st, st.blockedStage === 1 ? HOUR : DAY, BLOCKED_TEXT);
        return new ServiceError(s, "blocked", `${SERVICES[s].name}: ${BLOCKED_TEXT}`, st.pausedUntil);
      }
      if (code === 429 && /daily|per day|tomorrow|giornalier/i.test(bodyText)) {
        await pause(st, nextUtcMidnight(now()) - now(), "quota giornaliera esaurita");
        return new ServiceError(s, "paused", `${SERVICES[s].name}: quota giornaliera esaurita`, st.pausedUntil);
      }
      if (retryAfter !== null && (code === 429 || code === 503 || code >= 500)) {
        await pause(st, Math.min(DAY, retryAfter), `chiede di riprovare più tardi (${code})`);
        return new ServiceError(s, "paused", `${SERVICES[s].name}: chiede di aspettare`, st.pausedUntil);
      }
      // 429 without a hint, any 5xx and other unexpected codes: exponential backoff.
      st.failures += 1;
      await pause(st, backoffMs(st.failures), `errore ${code}`);
      return new ServiceError(s, "failed", `${SERVICES[s].name}: errore ${code}`, st.pausedUntil);
    }
    st.failures += 1;
    const what = netErr?.name === "AbortError" ? "tempo scaduto" : "rete non raggiungibile";
    await pause(st, backoffMs(st.failures), what);
    return new ServiceError(s, "failed", `${SERVICES[s].name}: ${what}`, st.pausedUntil);
  }

  /** Throws a ServiceError if the service must not be called right now. */
  async function assertCallable(st: ServiceState) {
    const s = st.service;
    if (st.disabled) throw new ServiceError(s, "stopped", `${SERVICES[s].name}: ${BLOCKED_TEXT}`);
    if (st.pausedUntil && st.pausedUntil > now()) {
      const kind: FailureKind = st.reason === BLOCKED_TEXT ? "blocked" : "paused";
      const msg = kind === "blocked" ? `${SERVICES[s].name}: ${BLOCKED_TEXT}` : `${SERVICES[s].name}: in pausa (${st.reason})`;
      throw new ServiceError(s, kind, msg, st.pausedUntil);
    }
  }

  async function request(service: ServiceId, url: string, opt: FetchOptions): Promise<Fetched> {
    const useCache = opt.cache !== false && (opt.method ?? "GET") === "GET";
    const cached = useCache ? await deps.store.getCache(opt.cacheKey) : null;
    if (cached && cached.expiresAt > now()) return { body: cached.body, status: 200, stale: false, fromCache: true, fetchedAt: cached.fetchedAt };

    const st = await state(service);
    try {
      await assertCallable(st);
    } catch (err) {
      if (cached) return { body: cached.body, status: 200, stale: true, fromCache: true, fetchedAt: cached.fetchedAt };
      throw err;
    }

    const headers: Record<string, string> = { "User-Agent": deps.userAgent, Accept: "*/*", ...(opt.headers ?? {}) };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opt.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await fetchImpl(url, { method: opt.method ?? "GET", headers, body: opt.body, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const e = await handleFailure(st, null, "", err as Error);
      if (cached) return { body: cached.body, status: 200, stale: true, fromCache: true, fetchedAt: cached.fetchedAt };
      throw e;
    }
    clearTimeout(timer);

    if (res.status === 304 && cached) {
      await deps.store.putCache({
        ...cached,
        expiresAt: expiryFrom(res.headers, now(), opt.minTtlMs, opt.defaultTtlMs),
        lastModified: res.headers.get("last-modified") ?? cached.lastModified,
        etag: res.headers.get("etag") ?? cached.etag,
        fetchedAt: now(),
      });
      await onSuccess(st);
      return { body: cached.body, status: 304, stale: false, fromCache: true, fetchedAt: now() };
    }

    const text = await res.text().catch(() => "");
    if (res.ok) {
      if (useCache) {
        await deps.store.putCache({
          key: opt.cacheKey,
          body: text,
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          expiresAt: expiryFrom(res.headers, now(), opt.minTtlMs, opt.defaultTtlMs),
          fetchedAt: now(),
        });
      }
      await onSuccess(st);
      return { body: text, status: res.status, stale: false, fromCache: false, fetchedAt: now() };
    }

    const e = await handleFailure(st, res, text);
    if (cached && e.kind !== "bad-request") return { body: cached.body, status: 200, stale: true, fromCache: true, fetchedAt: cached.fetchedAt };
    // Callers that need the error body (e.g. the Claude API message) can read it here.
    (e as ServiceError & { status?: number; responseBody?: string }).status = res.status;
    (e as ServiceError & { status?: number; responseBody?: string }).responseBody = text;
    throw e;
  }

  async function statuses() {
    const out = [];
    for (const s of Object.keys(SERVICES) as ServiceId[]) {
      const st = await state(s);
      const paused = st.pausedUntil !== null && st.pausedUntil > now();
      out.push({
        ...SERVICES[s],
        status: st.disabled ? "stopped" : paused ? (st.reason === BLOCKED_TEXT ? "blocked" : "paused") : "ok",
        until: paused ? new Date(st.pausedUntil!).toISOString() : null,
        reason: st.disabled || paused ? st.reason : null,
      });
    }
    return out;
  }

  async function reset(s: ServiceId) {
    await deps.store.putState(fresh(s));
    log(`[${s}] riattivato a mano`);
  }

  return { request, statuses, reset };
}

/** In-memory store (used by the tests). */
export function memoryStore(): Store {
  const states = new Map<string, ServiceState>();
  const cache = new Map<string, CacheRow>();
  return {
    getState: async (s) => (states.has(s) ? { ...states.get(s)! } : null),
    putState: async (st) => void states.set(st.service, { ...st }),
    getCache: async (k) => cache.get(k) ?? null,
    putCache: async (r) => void cache.set(r.key, { ...r }),
  };
}
