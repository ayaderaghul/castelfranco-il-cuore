// Database-backed store for outside-service caching and pause state,
// with a small in-memory copy in front so normal page loads don't hit the database.
import { query } from "./db.js";
import { createOutbound, BLOCKED_TEXT, SERVICES, type CacheRow, type ServiceId, type ServiceState, type Store } from "./outbound.js";

const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

export function dbStore(): Store {
  const states = new Map<string, ServiceState | null>();
  const cache = new Map<string, CacheRow | null>();
  return {
    async getState(s) {
      if (states.has(s)) return states.get(s) ? { ...states.get(s)! } : null;
      const rows = await query("SELECT * FROM service_state WHERE service = $1", [s]);
      const r = rows[0];
      const st: ServiceState | null = r
        ? {
            service: s,
            pausedUntil: ms(r.paused_until),
            reason: r.reason,
            failures: r.failures,
            blockedStage: r.blocked_stage,
            disabled: r.disabled,
          }
        : null;
      states.set(s, st);
      return st ? { ...st } : null;
    },
    async putState(st) {
      states.set(st.service, { ...st });
      await query(
        `INSERT INTO service_state (service, paused_until, reason, failures, blocked_stage, disabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (service) DO UPDATE SET paused_until = EXCLUDED.paused_until, reason = EXCLUDED.reason,
           failures = EXCLUDED.failures, blocked_stage = EXCLUDED.blocked_stage, disabled = EXCLUDED.disabled, updated_at = now()`,
        [st.service, st.pausedUntil ? new Date(st.pausedUntil) : null, st.reason, st.failures, st.blockedStage, st.disabled],
      );
    },
    async getCache(key) {
      if (cache.has(key)) return cache.get(key) ?? null;
      const rows = await query("SELECT * FROM http_cache WHERE key = $1", [key]);
      const r = rows[0];
      const row: CacheRow | null = r
        ? { key, body: r.body, etag: r.etag, lastModified: r.last_modified, expiresAt: ms(r.expires_at)!, fetchedAt: ms(r.fetched_at)! }
        : null;
      cache.set(key, row);
      return row;
    },
    async putCache(row) {
      cache.set(row.key, { ...row });
      await query(
        `INSERT INTO http_cache (key, body, etag, last_modified, expires_at, fetched_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified,
           expires_at = EXCLUDED.expires_at, fetched_at = EXCLUDED.fetched_at`,
        [row.key, row.body, row.etag, row.lastModified, new Date(row.expiresAt), new Date(row.fetchedAt)],
      );
    },
  };
}

// met.no asks for an identifying User-Agent with a way to contact the owner.
export const USER_AGENT = "castelfranco-il-cuore/1.0 (+https://github.com/ayaderaghul/castelfranco-il-cuore)";

export const outbound = createOutbound({ store: dbStore(), userAgent: USER_AGENT });
export type { ServiceId };

/** GET through the polite layer; the URL is the cache key. */
export async function fetchCached(service: ServiceId, url: string, opt: { minFreshMs: number; timeoutMs?: number }) {
  const r = await outbound.request(service, url, {
    cacheKey: url,
    minTtlMs: opt.minFreshMs,
    defaultTtlMs: Math.max(opt.minFreshMs, 30 * 60_000),
    timeoutMs: opt.timeoutMs,
  });
  return { body: r.body, stale: r.stale, fetchedAt: new Date(r.fetchedAt) };
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

/** One line per paused/blocked service, to show on screen. "you are blocked" is printed verbatim. */
export async function noticesFor(services: ServiceId[]): Promise<string[]> {
  const wanted = new Set(services);
  const out: string[] = [];
  for (const s of await outbound.statuses()) {
    if (!wanted.has(s.id) || s.status === "ok") continue;
    if (s.status === "stopped") out.push(`${s.name}: ${BLOCKED_TEXT} — non lo chiamo più finché non lo riattivi.`);
    else if (s.status === "blocked") out.push(`${s.name}: ${BLOCKED_TEXT} — riprovo dopo ${hhmm(s.until!)}.`);
    else out.push(`${s.name}: in pausa fino a ${hhmm(s.until!)} (${s.reason ?? "errore"}).`);
  }
  return out;
}

export const servicesOverview = () => outbound.statuses();
export const resetService = (s: ServiceId) => outbound.reset(s);
export { SERVICES };
