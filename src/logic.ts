// Pure logic: dates (Europe/Rome), habit/chore goals with carry-over, warmth hearts.
// No database access here, so it can be unit tested.

export const AXES = [
  "outrovert",
  "cuisine",
  "intimate",
  "vulnerability",
  "integration",
  "brightness",
  "be_seen",
  "rooted_italy",
  "rooted_vietnam",
  "integrity",
] as const;
export type Axis = (typeof AXES)[number];

/** Axes that count toward a person's warmth (hearts on the map). */
export const WARMTH_AXES: readonly Axis[] = ["outrovert", "intimate", "cuisine"];
export const HEART_LIFETIME_DAYS = 30;
export const HEART_FADING_AFTER_DAYS = 23;

// ---------- dates (all as 'YYYY-MM-DD' strings) ----------

const romeFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayRome(now: Date = new Date()): string {
  return romeFmt.format(now);
}

function toUtc(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * 86400000);
}

/** a - b in days */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86400000);
}

export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return fromUtc(toUtc(d)) === d;
}

export function monthBounds(month: string): { first: string; last: string } {
  // month = 'YYYY-MM'
  const [y, m] = month.split("-").map(Number);
  const first = fromUtc(Date.UTC(y, m - 1, 1));
  const last = fromUtc(Date.UTC(y, m, 0));
  return { first, last };
}

export const WHEN_KINDS = ["oggi", "ieri", "giorni", "settimane", "tempo_fa", "esatta"] as const;
export type WhenKind = (typeof WHEN_KINDS)[number];

/** Turns an approximate "when" into a concrete date we can sort and expire hearts with. */
export function approxDate(kind: WhenKind, today: string, exact?: string): string {
  switch (kind) {
    case "oggi":
      return today;
    case "ieri":
      return addDays(today, -1);
    case "giorni":
      return addDays(today, -3);
    case "settimane":
      return addDays(today, -14);
    case "tempo_fa":
      return addDays(today, -45);
    case "esatta":
      if (!exact || !isValidDate(exact)) throw new Error("data non valida");
      return exact;
  }
}

// ---------- goals with carry-over ----------

/** Monday used to align multi-day periods (hair every 2 days, weekly chores). */
export const EPOCH = "2026-01-05";

export interface PeriodRule {
  periodDays: number; // 1 = daily, 3 = every three days, 7 = weekly
  base: number; // how many times per period
}

export interface Period {
  start: string;
  end: string;
  base: number;
  carry: number; // missed amount brought in from the previous period (max = base)
  target: number;
  done: number;
}

export function periodStart(d: string, periodDays: number): string {
  const idx = Math.floor(diffDays(d, EPOCH) / periodDays);
  return addDays(EPOCH, idx * periodDays);
}

/**
 * Walks periods from the one containing `from` to the one containing `to`.
 * Whatever is missed in a period is added to the next one, capped at one
 * period's worth so a bad week doesn't snowball forever.
 */
export function computePeriods(rule: PeriodRule, counts: Map<string, number>, from: string, to: string): Period[] {
  const out: Period[] = [];
  let start = periodStart(from, rule.periodDays);
  let carry = 0;
  while (diffDays(start, to) <= 0) {
    const end = addDays(start, rule.periodDays - 1);
    let done = 0;
    for (let i = 0; i < rule.periodDays; i++) done += counts.get(addDays(start, i)) ?? 0;
    const target = rule.base + carry;
    out.push({ start, end, base: rule.base, carry, target, done });
    carry = Math.min(rule.base, Math.max(0, target - done));
    start = addDays(start, rule.periodDays);
  }
  return out;
}

export type PeriodStatus = "met" | "missed" | "pending" | "future" | "before";

export function periodStatus(p: Period, today: string, trackingStart: string): PeriodStatus {
  if (diffDays(p.end, trackingStart) < 0) return "before";
  if (diffDays(p.start, today) > 0) return "future";
  if (p.done >= p.target) return "met";
  if (diffDays(p.end, today) >= 0) return "pending"; // still running
  return "missed";
}

/**
 * Share of the goal achieved in a month: sum(min(done, target)) / sum(target)
 * over periods that end in the month. A period still running only counts once it's met.
 */
export function monthTotals(periods: Period[], month: string, today: string, trackingStart: string): { got: number; need: number } {
  const { first, last } = monthBounds(month);
  let got = 0;
  let need = 0;
  for (const p of periods) {
    if (diffDays(p.end, first) < 0 || diffDays(p.end, last) > 0) continue;
    const st = periodStatus(p, today, trackingStart);
    if (st === "before" || st === "future" || st === "pending") continue;
    got += Math.min(p.done, p.target);
    need += p.target;
  }
  return { got, need };
}

export function monthAdherence(periods: Period[], month: string, today: string, trackingStart: string): number | null {
  const { got, need } = monthTotals(periods, month, today, trackingStart);
  return need === 0 ? null : got / need;
}

/**
 * One row per month of the year: adherence per goal and all goals together.
 * Months with nothing to measure yet (before tracking, or in the future) are null.
 */
export function yearSummary(
  periodsByKey: Record<string, Period[]>,
  year: number,
  today: string,
  trackingStart: string,
) {
  const keys = Object.keys(periodsByKey);
  const yearSum: Record<string, { got: number; need: number }> = Object.fromEntries(keys.map((k) => [k, { got: 0, need: 0 }]));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    const per: Record<string, number | null> = {};
    let got = 0;
    let need = 0;
    for (const k of keys) {
      const t = monthTotals(periodsByKey[k], month, today, trackingStart);
      per[k] = t.need ? t.got / t.need : null;
      got += t.got;
      need += t.need;
      yearSum[k].got += t.got;
      yearSum[k].need += t.need;
    }
    months.push({ month, perGoal: per, total: need ? got / need : null });
  }
  const perGoalYear = Object.fromEntries(keys.map((k) => [k, yearSum[k].need ? yearSum[k].got / yearSum[k].need : null]));
  const all = keys.reduce((a, k) => ({ got: a.got + yearSum[k].got, need: a.need + yearSum[k].need }), { got: 0, need: 0 });
  return { year, months, perGoalYear, total: all.need ? all.got / all.need : null };
}

export const HABITS = {
  doccia: { periodDays: 1, base: 1, label: "Doccia", rule: "1 al giorno" },
  capelli: { periodDays: 3, base: 1, label: "Capelli", rule: "1 ogni 3 giorni" },
  denti: { periodDays: 1, base: 3, label: "Denti", rule: "3 al giorno" },
} as const;
export type Habit = keyof typeof HABITS;

export const CHORES = {
  scopa: { periodDays: 7, base: 1, label: "Passo la scopa" },
  mocio: { periodDays: 7, base: 1, label: "Passo il mocio" },
  piante: { periodDays: 7, base: 1, label: "Annaffio le piante" },
  bagno: { periodDays: 7, base: 1, label: "Pulisco il bagno" },
} as const;
export type Chore = keyof typeof CHORES;

// ---------- warmth ----------

export interface WarmthInput {
  event_date: string;
  delta: number;
}

export interface Warmth {
  hearts: number; // 0..5 active hearts
  fading: number; // how many of those expire within a week
  expiresOn: string | null; // when the oldest active heart disappears
}

/**
 * How many hearts one warmth point is worth, by relationship.
 * Family fills up fast (one dinner together ≈ full hearts); friends and
 * professionals need several meetings (one coffee ≈ 2 hearts).
 */
export const HEART_WEIGHT: Record<string, number> = { famiglia: 1.25, amici: 0.5, pro: 0.5 };

export function warmth(rows: WarmthInput[], today: string, weight = 1): Warmth {
  let active = 0;
  let fading = 0;
  let oldest: string | null = null;
  for (const r of rows) {
    const age = diffDays(today, r.event_date);
    if (age < 0 || age >= HEART_LIFETIME_DAYS || r.delta <= 0) continue;
    active += r.delta;
    if (age >= HEART_FADING_AFTER_DAYS) fading += r.delta;
    if (oldest === null || diffDays(r.event_date, oldest) < 0) oldest = r.event_date;
  }
  const hearts = Math.min(5, Math.round(active * weight));
  return {
    hearts,
    fading: Math.min(hearts, Math.round(fading * weight)),
    expiresOn: hearts > 0 && oldest ? addDays(oldest, HEART_LIFETIME_DAYS) : null,
  };
}
