// Weather (Open-Meteo, no API key) and news headlines (Google News RSS), cached in memory.

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

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "castelfranco-il-cuore/1.0" } });
  } finally {
    clearTimeout(t);
  }
}

const CITIES = [
  { key: "castelfranco", name: "Castelfranco", lat: 45.6719, lon: 11.9269, tz: "Europe/Rome" },
  { key: "haiphong", name: "Hải Phòng", lat: 20.8449, lon: 106.6881, tz: "Asia/Ho_Chi_Minh" },
];

export async function getWeather() {
  return cached("weather", 15 * 60 * 1000, async () => {
    const out = [];
    for (const c of CITIES) {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
        `&current=temperature_2m,weather_code,precipitation,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=2&timezone=${encodeURIComponent(c.tz)}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const j: any = await res.json();
      out.push({
        key: c.key,
        name: c.name,
        tz: c.tz,
        temp: j.current?.temperature_2m ?? null,
        code: j.current?.weather_code ?? null,
        precipitation: j.current?.precipitation ?? null,
        wind: j.current?.wind_speed_10m ?? null,
        max: j.daily?.temperature_2m_max?.[0] ?? null,
        min: j.daily?.temperature_2m_min?.[0] ?? null,
        tomorrowCode: j.daily?.weather_code?.[1] ?? null,
      });
    }
    return { cities: out };
  });
}

export const NEWS_TABS = ["mondo", "vietnam", "italia", "europa", "castelfranco"] as const;
export type NewsTab = (typeof NEWS_TABS)[number];

const NEWS_URLS: Record<NewsTab, string> = {
  mondo: "https://news.google.com/rss/headlines/section/topic/WORLD?hl=it&gl=IT&ceid=IT:it",
  vietnam: "https://news.google.com/rss/search?q=Vietnam&hl=it&gl=IT&ceid=IT:it",
  italia: "https://news.google.com/rss/headlines/section/topic/NATION?hl=it&gl=IT&ceid=IT:it",
  europa: "https://news.google.com/rss/search?q=%22Unione+europea%22+OR+Europa&hl=it&gl=IT&ceid=IT:it",
  castelfranco: "https://news.google.com/rss/search?q=%22Castelfranco+Veneto%22&hl=it&gl=IT&ceid=IT:it",
};

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

export async function getNews(tab: NewsTab) {
  return cached(`news:${tab}`, 30 * 60 * 1000, async () => {
    const res = await fetchWithTimeout(NEWS_URLS[tab]);
    if (!res.ok) throw new Error(`news ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => {
      const block = m[1];
      const source = tag(block, "source");
      let title = tag(block, "title");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const link = tag(block, "link");
      return {
        title,
        source,
        link: /^https?:\/\//.test(link) ? link : "",
        date: tag(block, "pubDate"),
      };
    });
    return { tab, items };
  });
}
