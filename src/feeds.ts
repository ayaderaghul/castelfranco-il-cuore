// Weather and news. Every outbound request goes through outbound.ts, which keeps a
// persistent HTTP cache (Expires / If-Modified-Since / ETag) and pauses a service
// after failures instead of retrying it. Nothing here runs unless a page asks for it.
import { ServiceError, SERVICES, type ServiceId } from "./outbound.js";
import { fetchCached, noticesFor } from "./outboundStore.js";

interface Attempt<T> {
  service: ServiceId;
  name: string;
  load: () => Promise<{ value: T; stale: boolean; fetchedAt: Date }>;
}

/**
 * Tries each source in order and returns the first that works. Paused services are
 * skipped without a request. Notices explain any paused/blocked service on screen.
 */
async function firstWorking<T>(label: string, attempts: Attempt<T>[], ok: (v: T) => boolean) {
  const errors: string[] = [];
  let staleFallback: { value: T; stale: boolean; fetchedAt: Date; source: string } | null = null;
  for (const a of attempts) {
    try {
      const r = await a.load();
      if (!ok(r.value)) {
        errors.push(`${a.name}: vuoto`);
        continue;
      }
      if (!r.stale) return { ...r, source: a.name };
      staleFallback ??= { ...r, source: a.name }; // keep looking for something fresh first
    } catch (err) {
      if (err instanceof ServiceError) errors.push(err.message);
      else errors.push(`${a.name}: ${(err as Error).message}`);
    }
  }
  if (staleFallback) return staleFallback;
  throw new Error(`${label} — ${errors.join("; ")}`);
}

// ---------------- weather ----------------

const CITIES = [
  { key: "castelfranco", name: "Castelfranco", lat: 45.6719, lon: 11.9269, tz: "Europe/Rome" },
  { key: "haiphong", name: "Hải Phòng", lat: 20.8449, lon: 106.6881, tz: "Asia/Ho_Chi_Minh" },
];
type City = (typeof CITIES)[number];

/** met.no symbol_code ("lightrain_showers_day", "clearsky_night"…) → a WMO-style code the app understands. */
export function symbolToCode(symbol: string | undefined): number | null {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (s.includes("thunder")) return 95;
  if (s.includes("snow") || s.includes("sleet")) return 71;
  if (s.includes("rainshowers")) return 80;
  if (s.includes("rain")) return 61;
  if (s === "fog") return 45;
  if (s === "clearsky") return 0;
  if (s === "fair") return 1;
  if (s === "partlycloudy") return 2;
  if (s === "cloudy") return 3;
  return null;
}

/** Extracts "now" from a met.no locationforecast response, picking the time step closest to now. */
export function parseMetNo(j: any, now = new Date()) {
  const series: any[] = j?.properties?.timeseries ?? [];
  if (!series.length) throw new Error("met.no senza dati");
  let cur = series[0];
  for (const t of series) {
    if (Date.parse(t.time) <= now.getTime()) cur = t;
    else break;
  }
  const next = cur.data?.next_1_hours ?? cur.data?.next_6_hours;
  const startIdx = series.indexOf(cur);
  const temps = series
    .slice(startIdx, startIdx + 24)
    .map((t) => t.data?.instant?.details?.air_temperature)
    .filter((x) => typeof x === "number");
  const wind = cur.data?.instant?.details?.wind_speed;
  return {
    temp: cur.data?.instant?.details?.air_temperature ?? null,
    code: symbolToCode(next?.summary?.symbol_code),
    precipitation: next?.details?.precipitation_amount ?? null,
    wind: typeof wind === "number" ? Math.round(wind * 3.6) : null,
    max: temps.length ? Math.max(...temps) : null,
    min: temps.length ? Math.min(...temps) : null,
  };
}

function weatherAttempts(c: City): Attempt<any>[] {
  return [
    {
      service: "metno",
      name: "MET Norway",
      load: async () => {
        // met.no terms: identify the app, max 4 decimals, respect Expires / If-Modified-Since (done in fetchCached).
        const r = await fetchCached(
          "metno",
          `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`,
          { minFreshMs: 10 * 60_000 },
        );
        return { value: { ...parseMetNo(JSON.parse(r.body)), source: "metno" }, stale: r.stale, fetchedAt: r.fetchedAt };
      },
    },
    {
      service: "open-meteo",
      name: "Open-Meteo",
      load: async () => {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
          `&current=temperature_2m,weather_code,precipitation,wind_speed_10m` +
          `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=${encodeURIComponent(c.tz)}`;
        const r = await fetchCached("open-meteo", url, { minFreshMs: 30 * 60_000 });
        const j: any = JSON.parse(r.body);
        return {
          value: {
            temp: j.current?.temperature_2m ?? null,
            code: j.current?.weather_code ?? null,
            precipitation: j.current?.precipitation ?? null,
            wind: j.current?.wind_speed_10m ?? null,
            max: j.daily?.temperature_2m_max?.[0] ?? null,
            min: j.daily?.temperature_2m_min?.[0] ?? null,
            source: "open-meteo",
          },
          stale: r.stale,
          fetchedAt: r.fetchedAt,
        };
      },
    },
  ];
}

export async function getWeather() {
  const cities = [];
  for (const c of CITIES) {
    try {
      const r = await firstWorking(`meteo ${c.name}`, weatherAttempts(c), (w: any) => w.temp !== null);
      cities.push({ key: c.key, name: c.name, tz: c.tz, ...r.value, stale: r.stale, updatedAt: r.fetchedAt });
    } catch (err) {
      console.warn((err as Error).message);
      cities.push({ key: c.key, name: c.name, tz: c.tz, temp: null, code: null, stale: true, updatedAt: null, source: null });
    }
  }
  const used = new Set(cities.map((c: any) => c.source).filter(Boolean));
  return {
    cities,
    notices: await noticesFor(["metno", "open-meteo"]),
    attribution: [...used].map((s) => SERVICES[s as ServiceId].credit).filter(Boolean),
  };
}

// ---------------- news ----------------

export const NEWS_TABS = ["mondo", "vietnam", "italia", "europa", "veneto"] as const;
export type NewsTab = (typeof NEWS_TABS)[number];

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  date: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

const safeLink = (l: string) => (/^https?:\/\//.test(l) ? l : "");

/** Parses an RSS feed into headline items. */
export function parseRss(xml: string, fallbackSource: string): NewsItem[] {
  return [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)].map((m) => {
    const block = m[1];
    const source = tag(block, "source") || fallbackSource;
    let title = tag(block, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, source, link: safeLink(tag(block, "link")), date: tag(block, "pubDate") };
  });
}

/** Parses a GDELT DOC 2.0 ArtList JSON response. */
export function parseGdelt(j: any): NewsItem[] {
  return (j?.articles ?? []).map((a: any) => ({
    title: String(a.title ?? "").trim(),
    source: String(a.domain ?? ""),
    link: safeLink(String(a.url ?? "")),
    date: String(a.seendate ?? ""),
  }));
}

const NEWS_FRESH = 30 * 60_000; // never re-ask a feed more than every 30 minutes

function rss(service: ServiceId, name: string, url: string, source: string, keep?: (i: NewsItem) => boolean): Attempt<NewsItem[]> {
  return {
    service,
    name,
    load: async () => {
      const r = await fetchCached(service, url, { minFreshMs: NEWS_FRESH });
      const items = parseRss(r.body, source).filter((i) => i.title);
      return { value: keep ? items.filter(keep) : items, stale: r.stale, fetchedAt: r.fetchedAt };
    },
  };
}

function gdelt(q: string): Attempt<NewsItem[]> {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=15&sort=DateDesc&timespan=7d&query=" +
    encodeURIComponent(q);
  return {
    service: "gdelt",
    name: "GDELT",
    load: async () => {
      const r = await fetchCached("gdelt", url, { minFreshMs: 60 * 60_000, timeoutMs: 12_000 });
      let j: unknown;
      try {
        j = JSON.parse(r.body);
      } catch {
        throw new Error("risposta non JSON");
      }
      return { value: parseGdelt(j).filter((i) => i.title), stale: r.stale, fetchedAt: r.fetchedAt };
    },
  };
}

const ANSA = "https://www.ansa.it";
const mentionsVietnam = (i: NewsItem) => /vietnam|hanoi|hà nội|ho chi minh|hai ?phong/i.test(i.title);

const SOURCES: Record<NewsTab, Attempt<NewsItem[]>[]> = {
  mondo: [rss("ansa", "ANSA mondo", `${ANSA}/sito/notizie/mondo/mondo_rss.xml`, "ANSA")],
  italia: [rss("ansa", "ANSA", `${ANSA}/sito/notizie/topnews/topnews_rss.xml`, "ANSA")],
  europa: [rss("ansa", "ANSA Europa", `${ANSA}/europa/notizie/rss.xml`, "ANSA Europa")],
  veneto: [rss("ansa", "ANSA Veneto", `${ANSA}/veneto/notizie/veneto_rss.xml`, "ANSA Veneto")],
  vietnam: [
    rss("vnexpress", "VnExpress thời sự", "https://vnexpress.net/rss/thoi-su.rss", "VnExpress"),
    rss("vnexpress", "VnExpress tin mới", "https://vnexpress.net/rss/tin-moi-nhat.rss", "VnExpress"),
    gdelt("vietnam sourcelang:italian"),
    rss("ansa", "ANSA mondo", `${ANSA}/sito/notizie/mondo/mondo_rss.xml`, "ANSA", mentionsVietnam),
  ],
};

export async function getNews(tab: NewsTab) {
  const attempts = SOURCES[tab];
  const notices = () => noticesFor(attempts.map((a) => a.service));
  try {
    const r = await firstWorking(`notizie ${tab}`, attempts, (v) => v.length > 0);
    const seen = new Set<string>();
    const unique = r.value.filter((i) => {
      const k = i.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { tab, items: unique.slice(0, 8), stale: r.stale, updatedAt: r.fetchedAt, notices: await notices() };
  } catch (err) {
    console.warn((err as Error).message);
    return { tab, items: [], stale: true, updatedAt: null, notices: await notices() };
  }
}
