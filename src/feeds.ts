// Weather and news headlines, cached in memory.
// Shared cloud servers (like Render's) are often blocked or rate-limited by
// Google News and Open-Meteo, so each feed tries several sources in order.

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (hit) return hit.value; // serve stale data rather than nothing
    throw err;
  }
}

// met.no asks for an identifying User-Agent with a contact.
const UA = "castelfranco-il-cuore/1.0 (+https://github.com/ayaderaghul/castelfranco-il-cuore)";

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "*/*" } });
  } finally {
    clearTimeout(t);
  }
}

/** Tries each loader in turn; returns the first that succeeds with a usable result. */
async function firstWorking<T>(label: string, loaders: { name: string; load: () => Promise<T> }[], ok: (v: T) => boolean): Promise<T> {
  const errors: string[] = [];
  for (const l of loaders) {
    try {
      const v = await l.load();
      if (ok(v)) {
        console.log(`${label}: ok da ${l.name}${errors.length ? ` (prima: ${errors.join("; ")})` : ""}`);
        return v;
      }
      errors.push(`${l.name}: vuoto`);
    } catch (err) {
      errors.push(`${l.name}: ${(err as Error).message}`);
    }
  }
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

async function metNo(c: City) {
  const res = await fetchWithTimeout(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`,
  );
  if (!res.ok) throw new Error(`met.no ${res.status}`);
  const j: any = await res.json();
  const series: any[] = j.properties?.timeseries ?? [];
  const now = series[0];
  if (!now) throw new Error("met.no senza dati");
  const next = now.data?.next_1_hours ?? now.data?.next_6_hours;
  // Rough min/max over the next 24 hours.
  const temps = series.slice(0, 24).map((t) => t.data?.instant?.details?.air_temperature).filter((x) => typeof x === "number");
  return {
    key: c.key,
    name: c.name,
    tz: c.tz,
    temp: now.data?.instant?.details?.air_temperature ?? null,
    code: symbolToCode(next?.summary?.symbol_code),
    precipitation: next?.details?.precipitation_amount ?? null,
    wind: now.data?.instant?.details?.wind_speed != null ? Math.round(now.data.instant.details.wind_speed * 3.6) : null,
    max: temps.length ? Math.max(...temps) : null,
    min: temps.length ? Math.min(...temps) : null,
    source: "met.no",
  };
}

async function openMeteo(c: City) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
    `&current=temperature_2m,weather_code,precipitation,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=${encodeURIComponent(c.tz)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j: any = await res.json();
  return {
    key: c.key,
    name: c.name,
    tz: c.tz,
    temp: j.current?.temperature_2m ?? null,
    code: j.current?.weather_code ?? null,
    precipitation: j.current?.precipitation ?? null,
    wind: j.current?.wind_speed_10m ?? null,
    max: j.daily?.temperature_2m_max?.[0] ?? null,
    min: j.daily?.temperature_2m_min?.[0] ?? null,
    source: "open-meteo",
  };
}

export async function getWeather() {
  return cached("weather", 30 * 60 * 1000, async () => {
    const cities = [];
    for (const c of CITIES) {
      cities.push(
        await firstWorking(
          `meteo ${c.name}`,
          [
            { name: "met.no", load: () => metNo(c) },
            { name: "open-meteo", load: () => openMeteo(c) },
          ],
          (w) => w.temp !== null,
        ),
      );
    }
    return { cities };
  });
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

async function rss(url: string, source: string, keep?: (i: NewsItem) => boolean) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${res.status}`);
  const items = parseRss(await res.text(), source).filter((i) => i.title);
  return keep ? items.filter(keep) : items;
}

async function gdelt(query: string) {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=15&sort=DateDesc&timespan=7d&query=" +
    encodeURIComponent(query);
  const res = await fetchWithTimeout(url, 12000);
  if (!res.ok) throw new Error(`${res.status}`);
  const text = await res.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("risposta non JSON");
  }
  return parseGdelt(j).filter((i) => i.title);
}

const ANSA = "https://www.ansa.it";
const googleNews = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=it&gl=IT&ceid=IT:it`;
const mentionsVietnam = (i: NewsItem) => /vietnam|hanoi|hà nội|ho chi minh|hai ?phong/i.test(i.title);

const SOURCES: Record<NewsTab, { name: string; load: () => Promise<NewsItem[]> }[]> = {
  mondo: [
    { name: "ANSA mondo", load: () => rss(`${ANSA}/sito/notizie/mondo/mondo_rss.xml`, "ANSA") },
    { name: "Google News", load: () => rss("https://news.google.com/rss/headlines/section/topic/WORLD?hl=it&gl=IT&ceid=IT:it", "") },
  ],
  italia: [
    { name: "ANSA", load: () => rss(`${ANSA}/sito/notizie/topnews/topnews_rss.xml`, "ANSA") },
    { name: "Google News", load: () => rss("https://news.google.com/rss/headlines/section/topic/NATION?hl=it&gl=IT&ceid=IT:it", "") },
  ],
  europa: [
    { name: "ANSA Europa", load: () => rss(`${ANSA}/europa/notizie/rss.xml`, "ANSA Europa") },
    { name: "Google News", load: () => rss(googleNews('"Unione europea"'), "") },
  ],
  veneto: [
    { name: "ANSA Veneto", load: () => rss(`${ANSA}/veneto/notizie/veneto_rss.xml`, "ANSA Veneto") },
    { name: "Google News", load: () => rss(googleNews('"Castelfranco Veneto"'), "") },
  ],
  vietnam: [
    // VnExpress publishes plain RSS that servers can read; GDELT/Google often refuse cloud IPs.
    { name: "VnExpress thời sự", load: () => rss("https://vnexpress.net/rss/thoi-su.rss", "VnExpress") },
    { name: "VnExpress tin mới", load: () => rss("https://vnexpress.net/rss/tin-moi-nhat.rss", "VnExpress") },
    { name: "GDELT", load: () => gdelt("vietnam sourcelang:italian") },
    { name: "ANSA mondo", load: () => rss(`${ANSA}/sito/notizie/mondo/mondo_rss.xml`, "ANSA", mentionsVietnam) },
  ],
};

export async function getNews(tab: NewsTab) {
  return cached(`news:${tab}`, 30 * 60 * 1000, async () => {
    const items = await firstWorking(`notizie ${tab}`, SOURCES[tab], (v) => v.length > 0);
    // Drop duplicate titles, keep the newest 8.
    const seen = new Set<string>();
    const unique = items.filter((i) => {
      const k = i.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { tab, items: unique.slice(0, 8) };
  });
}

/** Fetches every feed once (at startup) so the first page is quick and the logs show which sources work. */
export async function warmFeeds(): Promise<void> {
  try {
    await getWeather();
  } catch (err) {
    console.warn("warm-up:", (err as Error).message);
  }
  for (const tab of NEWS_TABS) {
    try {
      await getNews(tab);
    } catch (err) {
      console.warn("warm-up:", (err as Error).message);
    }
  }
}
