import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, tx } from "./db.js";
import {
  AXES,
  CHORES,
  HABITS,
  HEART_WEIGHT,
  WARMTH_AXES,
  WHEN_KINDS,
  addDays,
  approxDate,
  computePeriods,
  diffDays,
  monthAdherence,
  monthBounds,
  periodStatus,
  todayRome,
  warmth,
  yearSummary,
  type Chore,
  type Habit,
  type Period,
} from "./logic.js";
import { getNews, getWeather, NEWS_TABS } from "./feeds.js";
import { askClaudeToScore, autoScoringEnabled } from "./claude.js";

export const SPRITES = [
  "macchiato", "cornetto", "piatto", "miele", "costine", "pho", "spritz", "monte", "scarpa",
  "giornale", "chiacchiera", "gnomo", "regalo", "loto", "sole", "libro", "pianta", "stella",
  "pizza", "tiramisu", "manzo_ananas", "maiale_mango", "involtini",
  "rosa", "palestra", "fiume", "fiore", "dottore", "soldi",
] as const;

type Handler = (req: Request, res: Response) => Promise<void>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function uid(req: Request): number {
  if (!req.userId) throw new HttpError(401, "Devi accedere.");
  return req.userId;
}

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new HttpError(400, i ? `${i.path.join(".") || "dati"}: ${i.message}` : "Dati non validi.");
  }
  return r.data;
}

const idParam = z.coerce.number().int().positive();

async function trackingStart(userId: number): Promise<string> {
  const rows = await query<{ d: string }>(
    "SELECT to_char(created_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS d FROM users WHERE id = $1",
    [userId],
  );
  return rows[0]?.d ?? todayRome();
}

/** Returns only the ids that really belong to this user (guards against IDOR). */
async function ownedIds(c: PoolClient | null, table: "people" | "items", userId: number, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const sql = `SELECT id FROM ${table} WHERE user_id = $1 AND id = ANY($2::int[])`;
  const rows = c ? (await c.query(sql, [userId, ids])).rows : await query(sql, [userId, ids]);
  return rows.map((r: { id: number }) => r.id);
}

/** personId null = collected alone ("da sola"). */
async function collect(c: PoolClient, itemId: number, personId: number | null, day: string, eventId: number | null): Promise<void> {
  await c.query("INSERT INTO item_collects (item_id, person_id, event_id, collected_on) VALUES ($1, $2, $3, $4)", [
    itemId,
    personId,
    eventId,
    day,
  ]);
  if (personId !== null) {
    await c.query("UPDATE suggestions SET done = true WHERE item_id = $1 AND person_id = $2 AND done = false", [itemId, personId]);
  }
}

// ---------- goals (hygiene + chores) ----------

async function goalSummary<K extends string>(
  table: "hygiene_logs" | "chore_logs",
  column: "habit" | "chore",
  rules: Record<K, { periodDays: number; base: number; label: string }>,
  userId: number,
  month: string,
) {
  const today = todayRome();
  const start = await trackingStart(userId);
  const { first, last } = monthBounds(month);
  const rows = await query<{ day: string; k: string; n: number }>(
    `SELECT day, ${column} AS k, count(*)::int AS n FROM ${table} WHERE user_id = $1 AND day >= $2 AND day <= $3 GROUP BY day, ${column}`,
    [userId, start, today],
  );
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rules) as K[]) {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.k === key) counts.set(r.day, r.n);
    const rule = rules[key];
    const all = computePeriods(rule, counts, start, today);
    const current = all[all.length - 1];
    // Walk from the tracking start (so carry-over is right) to the end of the month;
    // periods after today come out with status "future".
    const monthPeriods: Period[] = diffDays(last, start) >= 0 ? computePeriods(rule, counts, start, last) : [];
    const inMonth = monthPeriods
      .filter((p) => diffDays(p.end, first) >= 0 && diffDays(p.start, last) <= 0)
      .map((p) => ({ ...p, status: periodStatus(p, today, start) }));
    const days: Record<string, number> = {};
    for (const [d, n] of counts) if (diffDays(d, addDays(first, -7)) >= 0 && diffDays(d, addDays(last, 7)) <= 0) days[d] = n;
    out[key] = {
      label: rule.label,
      rule: (rule as { rule?: string }).rule ?? null,
      current: current ? { ...current, status: periodStatus(current, today, start) } : null,
      periods: inMonth,
      adherence: monthAdherence(monthPeriods, month, today, start),
      days,
    };
  }
  return { today, month, trackingStart: start, goals: out };
}

async function goalYear<K extends string>(
  table: "hygiene_logs" | "chore_logs",
  column: "habit" | "chore",
  rules: Record<K, { periodDays: number; base: number; label: string }>,
  userId: number,
  year: number,
) {
  const today = todayRome();
  const start = await trackingStart(userId);
  const yearEnd = `${year}-12-31`;
  const rows = await query<{ day: string; k: string; n: number }>(
    `SELECT day, ${column} AS k, count(*)::int AS n FROM ${table} WHERE user_id = $1 AND day >= $2 AND day <= $3 GROUP BY day, ${column}`,
    [userId, start, yearEnd],
  );
  const periodsByKey: Record<string, Period[]> = {};
  const labels: Record<string, string> = {};
  for (const key of Object.keys(rules) as K[]) {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.k === key) counts.set(r.day, r.n);
    periodsByKey[key] = diffDays(yearEnd, start) >= 0 ? computePeriods(rules[key], counts, start, yearEnd) : [];
    labels[key] = rules[key].label;
  }
  return { today, trackingStart: start, labels, ...yearSummary(periodsByKey, year, today, start) };
}

const monthQ = z.string().regex(/^\d{4}-\d{2}$/);
const yearQ = z.coerce.number().int().min(2020).max(2100);

// ---------- scoring (shared by manual JSON import and automatic Claude API scoring) ----------

const scoredEvent = z.object({
  id: z.number().int().positive(),
  punti: z.record(z.string(), z.number()).default({}),
  motivi: z.record(z.string(), z.string()).default({}),
  oggetti_raccolti: z
    .array(
      z.object({
        nome: z.string().min(1).max(60),
        categoria: z.string().max(40).default("Altro"),
        sprite: z.string().max(30).default("stella"),
        persone: z.array(z.string().max(60)).max(30).default([]),
      }),
    )
    .max(30)
    .default([]),
  suggerimenti: z
    .array(
      z.object({
        persona: z.string().max(60),
        oggetto: z.string().min(1).max(60),
        categoria: z.string().max(40).default("Altro"),
        sprite: z.string().max(30).default("stella"),
        consiglio: z.string().max(500).default(""),
      }),
    )
    .max(30)
    .default([]),
});
type ScoredEvent = z.output<typeof scoredEvent>;
const importBody = z.object({ eventi: z.array(scoredEvent).max(200) });

/**
 * Writes one event's points (the 9 axes) inside a transaction, replacing an earlier
 * scoring of the same event. Claude only scores: the items collected and the ideas
 * picked in the event form are the user's choice and are never touched here.
 * Returns null if the event isn't the user's.
 */
async function applyScore(c: PoolClient, userId: number, ev: ScoredEvent) {
  const own = await c.query("SELECT id FROM events WHERE id=$1 AND user_id=$2", [ev.id, userId]);
  if (!own.rows[0]) return null;
  let points = 0;
  await c.query("DELETE FROM event_points WHERE event_id=$1", [ev.id]);
  for (const [axis, rawDelta] of Object.entries(ev.punti)) {
    if (!(AXES as readonly string[]).includes(axis)) continue;
    const delta = Math.max(-5, Math.min(5, Math.round(rawDelta)));
    if (delta === 0) continue;
    await c.query("INSERT INTO event_points (event_id, axis, delta, reason) VALUES ($1,$2,$3,$4)", [
      ev.id,
      axis,
      delta,
      (ev.motivi[axis] ?? "").slice(0, 300),
    ]);
    points += delta;
  }
  await c.query("UPDATE events SET scored_at = now(), score_error = NULL WHERE id=$1", [ev.id]);
  return { points, collected: 0, suggestions: 0 };
}

// A small per-user cap so a bug or a stuck loop can't run up the API bill.
const scoreCalls = new Map<number, number[]>();
function underScoreLimit(userId: number): boolean {
  const now = Date.now();
  const recent = (scoreCalls.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 60) return false;
  recent.push(now);
  scoreCalls.set(userId, recent);
  return true;
}

/** Sends one event to Claude and applies the result. Records the error on the event if it fails. */
export async function scoreEvent(userId: number, eventId: number, includePrivate: boolean) {
  const rows = await query<any>(
    `SELECT e.id, e.event_date, e.when_kind, e.what, e.positive, e.idea, e.is_private,
       COALESCE((SELECT json_agg(p.name ORDER BY p.name) FROM event_people ep JOIN people p ON p.id = ep.person_id
         WHERE ep.event_id = e.id), '[]') AS persone
     FROM events e WHERE e.id = $1 AND e.user_id = $2`,
    [eventId, userId],
  );
  const e = rows[0];
  if (!e) throw new HttpError(404, "Evento non trovato.");
  if (e.is_private && !includePrivate) throw new HttpError(400, "Evento privato: confermi di volerlo inviare a Claude?");
  if (!underScoreLimit(userId)) throw new HttpError(429, "Troppe valutazioni in un'ora, riprova più tardi.");
  try {
    const people = await query(
      "SELECT name AS nome, category AS categoria, city AS citta, role AS ruolo FROM people WHERE user_id=$1",
      [userId],
    );
    const result = await askClaudeToScore({
      persone: people,
      assi: AXES,
      evento: {
        id: e.id,
        data: e.event_date,
        data_approssimativa: !["esatta", "oggi", "ieri"].includes(e.when_kind),
        persone: e.persone,
        cosa: e.what,
        positivo: e.positive,
        idea: e.idea,
      },
    });
    const parsed = scoredEvent.safeParse({ ...(result as object), id: e.id });
    if (!parsed.success) throw new Error("risposta di Claude non valida");
    const summary = await tx((c) => applyScore(c, userId, parsed.data));
    return { id: e.id, ...summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query("UPDATE events SET score_error = $2 WHERE id = $1", [eventId, msg.slice(0, 300)]);
    throw new HttpError(502, `Claude non ha potuto valutare: ${msg}`);
  }
}

export function apiRouter(): Router {
  const r = express.Router();

  // ---------- dashboard ----------
  r.get(
    "/dashboard",
    h(async (req, res) => {
      const userId = uid(req);
      const axes = await query<{ axis: string; total: number }>(
        `SELECT pt.axis, sum(pt.delta)::int AS total FROM event_points pt JOIN events e ON e.id = pt.event_id
         WHERE e.user_id = $1 GROUP BY pt.axis`,
        [userId],
      );
      const totals: Record<string, number> = Object.fromEntries(AXES.map((a) => [a, 0]));
      for (const a of axes) if (a.axis in totals) totals[a.axis] = a.total;
      const counts = await query<{ events: number; unscored: number; people: number }>(
        `SELECT (SELECT count(*)::int FROM events WHERE user_id = $1) AS events,
                (SELECT count(*)::int FROM events WHERE user_id = $1 AND scored_at IS NULL) AS unscored,
                (SELECT count(*)::int FROM people WHERE user_id = $1) AS people`,
        [userId],
      );
      const month = todayRome().slice(0, 7);
      const hy = await goalSummary("hygiene_logs", "habit", HABITS, userId, month);
      const ch = await goalSummary("chore_logs", "chore", CHORES, userId, month);
      const sum = (g: Record<string, any>) =>
        Object.values(g).reduce(
          (acc: { done: number; target: number }, x: any) => ({
            done: acc.done + Math.min(x.current?.done ?? 0, x.current?.target ?? 0),
            target: acc.target + (x.current?.target ?? 0),
          }),
          { done: 0, target: 0 },
        );
      const solo = await query(
        `SELECT i.id, i.name, i.sprite, count(*)::int AS n FROM item_collects ic JOIN items i ON i.id = ic.item_id
         WHERE i.user_id = $1 AND ic.person_id IS NULL GROUP BY i.id, i.name, i.sprite ORDER BY count(*) DESC, i.name`,
        [userId],
      );
      res.json({ today: todayRome(), axes: totals, ...counts[0], hygiene: sum(hy.goals), chores: sum(ch.goals), solo });
    }),
  );

  // ---------- people ----------
  const personBody = z.object({
    name: z.string().trim().min(1).max(60),
    category: z.enum(["amici", "famiglia", "pro"]),
    city: z.string().trim().max(60).default("Castelfranco"),
    role: z.string().trim().max(80).default(""),
    level: z.string().trim().max(40).default("conoscente"),
    notes: z.string().max(2000).default(""),
  });

  r.get(
    "/people",
    h(async (req, res) => {
      const userId = uid(req);
      const today = todayRome();
      const people = await query(
        "SELECT id, name, category, city, role, level, notes, next_note FROM people WHERE user_id = $1 ORDER BY lower(name)",
        [userId],
      );
      const last = await query<{ person_id: number; event_date: string; when_kind: string }>(
        `SELECT DISTINCT ON (ep.person_id) ep.person_id, e.event_date, e.when_kind
         FROM event_people ep JOIN events e ON e.id = ep.event_id
         WHERE e.user_id = $1 ORDER BY ep.person_id, e.event_date DESC, e.id DESC`,
        [userId],
      );
      const warm = await query<{ person_id: number; event_date: string; delta: number }>(
        `SELECT ep.person_id, e.event_date, sum(pt.delta)::int AS delta
         FROM event_people ep JOIN events e ON e.id = ep.event_id JOIN event_points pt ON pt.event_id = e.id
         WHERE e.user_id = $1 AND pt.axis = ANY($2::text[]) AND e.event_date > $3
         GROUP BY ep.person_id, e.event_date`,
        [userId, WARMTH_AXES, addDays(today, -31)],
      );
      const collected = await query<{ person_id: number; item_id: number; name: string; sprite: string; n: number }>(
        `SELECT ic.person_id, i.id AS item_id, i.name, i.sprite, count(*)::int AS n
         FROM item_collects ic JOIN items i ON i.id = ic.item_id
         WHERE i.user_id = $1 GROUP BY ic.person_id, i.id, i.name, i.sprite ORDER BY i.name`,
        [userId],
      );
      const sugg = await query<{ id: number; person_id: number; item_id: number; name: string; sprite: string; tip: string }>(
        `SELECT s.id, s.person_id, i.id AS item_id, i.name, i.sprite, s.tip
         FROM suggestions s JOIN items i ON i.id = s.item_id
         WHERE s.user_id = $1 AND s.done = false ORDER BY s.created_at`,
        [userId],
      );
      res.json({
        today,
        people: people.map((p: any) => {
          const l = last.find((x) => x.person_id === p.id);
          return {
            ...p,
            last: l ? { date: l.event_date, approx: l.when_kind !== "esatta" && l.when_kind !== "oggi" && l.when_kind !== "ieri" } : null,
            warmth: warmth(
              warm.filter((w) => w.person_id === p.id),
              today,
              HEART_WEIGHT[p.category] ?? 1,
            ),
            collected: collected.filter((c) => c.person_id === p.id).map(({ person_id, ...rest }) => rest),
            suggestions: sugg.filter((s) => s.person_id === p.id).map(({ person_id, ...rest }) => rest),
          };
        }),
      });
    }),
  );

  r.post(
    "/people",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(personBody, req.body);
      const rows = await query(
        "INSERT INTO people (user_id, name, category, city, role, level, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [userId, b.name, b.category, b.city || "Castelfranco", b.role, b.level, b.notes],
      );
      res.json({ id: rows[0].id });
    }),
  );

  r.put(
    "/people/:id",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const b = parse(personBody, req.body);
      const rows = await query(
        `UPDATE people SET name=$3, category=$4, city=$5, role=$6, level=$7, notes=$8 WHERE id=$1 AND user_id=$2 RETURNING id`,
        [id, userId, b.name, b.category, b.city || "Castelfranco", b.role, b.level, b.notes],
      );
      if (!rows[0]) throw new HttpError(404, "Persona non trovata.");
      res.json({ ok: true });
    }),
  );

  // The "prossima volta" note on a person's card, edited in place.
  r.put(
    "/people/:id/note",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const b = parse(z.object({ note: z.string().max(2000) }), req.body);
      const rows = await query("UPDATE people SET next_note=$3 WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId, b.note.trim()]);
      if (!rows[0]) throw new HttpError(404, "Persona non trovata.");
      res.json({ ok: true });
    }),
  );

  r.delete(
    "/people/:id",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const rows = await query("DELETE FROM people WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId]);
      if (!rows[0]) throw new HttpError(404, "Persona non trovata.");
      res.json({ ok: true });
    }),
  );

  // ---------- events ----------
  const eventBody = z.object({
    personIds: z.array(z.number().int().positive()).max(30).default([]),
    when_kind: z.enum(WHEN_KINDS),
    exact: z.string().optional(),
    what: z.string().max(5000).default(""),
    positive: z.string().max(3000).default(""),
    idea: z.string().max(2000).default(""),
    is_private: z.boolean().default(false),
    itemIds: z.array(z.number().int().positive()).max(30).default([]),
    ideaItemIds: z.array(z.number().int().positive()).max(30).default([]),
  });

  r.get(
    "/events",
    h(async (req, res) => {
      const userId = uid(req);
      const events = await query(
        `SELECT e.id, e.when_kind, e.event_date, e.what, e.positive, e.idea, e.is_private, e.scored_at, e.score_error, e.created_at,
           COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'category', p.category) ORDER BY p.name)
             FROM event_people ep JOIN people p ON p.id = ep.person_id WHERE ep.event_id = e.id), '[]') AS people,
           COALESCE((SELECT json_agg(json_build_object('axis', pt.axis, 'delta', pt.delta, 'reason', pt.reason))
             FROM event_points pt WHERE pt.event_id = e.id), '[]') AS points,
           (SELECT count(*)::int FROM item_collects ic WHERE ic.event_id = e.id) AS collected,
           (SELECT count(*)::int FROM suggestions s WHERE s.event_id = e.id AND s.done = false) AS suggestions
         FROM events e WHERE e.user_id = $1 ORDER BY e.event_date DESC, e.id DESC LIMIT 300`,
        [userId],
      );
      res.json({ events, autoScoring: autoScoringEnabled() });
    }),
  );

  r.post(
    "/events",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(eventBody, req.body);
      let date: string;
      try {
        date = approxDate(b.when_kind, todayRome(), b.exact);
      } catch {
        throw new HttpError(400, "Data non valida.");
      }
      if (diffDays(date, todayRome()) > 0) throw new HttpError(400, "La data è nel futuro.");
      const id = await tx(async (c) => {
        const people = await ownedIds(c, "people", userId, b.personIds);
        const items = await ownedIds(c, "items", userId, b.itemIds);
        const ideas = await ownedIds(c, "items", userId, b.ideaItemIds);
        // Keep a readable text of the picked ideas on the event (shown in the list and sent to Claude).
        const ideaNames = ideas.length
          ? ((await c.query("SELECT name FROM items WHERE id = ANY($1::int[]) ORDER BY name", [ideas])).rows as { name: string }[]).map(
              (r) => r.name,
            )
          : [];
        const ideaText = [ideaNames.length ? `Da fare insieme: ${ideaNames.join(", ")}` : "", b.idea].filter(Boolean).join("\n");
        const ins = await c.query(
          `INSERT INTO events (user_id, when_kind, event_date, what, positive, idea, is_private)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [userId, b.when_kind, date, b.what, b.positive, ideaText, b.is_private],
        );
        const eventId: number = ins.rows[0].id;
        for (const p of people) await c.query("INSERT INTO event_people (event_id, person_id) VALUES ($1,$2)", [eventId, p]);
        // Each picked idea becomes a "da raccogliere" item on every person of the event.
        for (const it of ideas)
          for (const p of people) {
            const dup = await c.query("SELECT 1 FROM suggestions WHERE person_id=$1 AND item_id=$2 AND done=false", [p, it]);
            if (dup.rows[0]) continue;
            await c.query(
              "INSERT INTO suggestions (user_id, person_id, item_id, tip, event_id, source) VALUES ($1,$2,$3,'',$4,'idea')",
              [userId, p, it, eventId],
            );
          }
        // With people: collected together with each of them. With nobody: collected alone.
        for (const it of items) {
          if (people.length === 0) await collect(c, it, null, date, eventId);
          else for (const p of people) await collect(c, it, p, date, eventId);
        }
        return eventId;
      });
      // Score in the background so saving stays instant; private events are never sent automatically.
      const scoring = autoScoringEnabled() && !b.is_private;
      if (scoring) {
        scoreEvent(userId, id, false).catch((err) => console.warn(`auto-score event ${id} failed:`, err.message));
      }
      res.json({ id, scoring });
    }),
  );

  r.delete(
    "/events/:id",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      await tx(async (c) => {
        const own = await c.query("SELECT id FROM events WHERE id=$1 AND user_id=$2", [id, userId]);
        if (!own.rows[0]) throw new HttpError(404, "Evento non trovato.");
        // Points, people links and Claude's suggestions cascade with the event;
        // items collected in it are removed explicitly (their FK is SET NULL).
        await c.query("DELETE FROM item_collects WHERE event_id = $1", [id]);
        await c.query("DELETE FROM suggestions WHERE event_id = $1 AND done = false", [id]);
        await c.query("DELETE FROM events WHERE id = $1", [id]);
      });
      res.json({ ok: true });
    }),
  );

  // ---------- collection ----------
  r.get(
    "/collection",
    h(async (req, res) => {
      const userId = uid(req);
      const cats = await query("SELECT id, name, color FROM item_categories WHERE user_id=$1 ORDER BY id", [userId]);
      const items = await query("SELECT id, category_id, name, sprite FROM items WHERE user_id=$1 ORDER BY id", [userId]);
      // person_id NULL rows are things collected alone: shown as "Tu".
      const collects = await query<{ item_id: number; person_id: number | null; name: string; category: string | null; n: number }>(
        `SELECT ic.item_id, p.id AS person_id, COALESCE(p.name, 'Tu') AS name, p.category, count(*)::int AS n
         FROM item_collects ic LEFT JOIN people p ON p.id = ic.person_id JOIN items i ON i.id = ic.item_id
         WHERE i.user_id = $1 GROUP BY ic.item_id, p.id, p.name, p.category ORDER BY p.id NULLS FIRST, p.name`,
        [userId],
      );
      const plans = await query<{ id: number; item_id: number; person_id: number; name: string; tip: string }>(
        `SELECT s.id, s.item_id, p.id AS person_id, p.name, s.tip FROM suggestions s JOIN people p ON p.id = s.person_id
         WHERE s.user_id = $1 AND s.done = false`,
        [userId],
      );
      res.json({
        sprites: SPRITES,
        categories: cats.map((c: any) => ({
          ...c,
          items: items
            .filter((i: any) => i.category_id === c.id)
            .map((i: any) => ({
              ...i,
              collected: collects.filter((x) => x.item_id === i.id),
              planned: plans.filter((x) => x.item_id === i.id),
            })),
        })),
      });
    }),
  );

  r.post(
    "/categories",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() }), req.body);
      const rows = await query(
        `INSERT INTO item_categories (user_id, name, color) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, name) DO UPDATE SET color = EXCLUDED.color RETURNING id`,
        [userId, b.name, b.color ?? "#F2C14E"],
      );
      res.json({ id: rows[0].id });
    }),
  );

  r.delete(
    "/categories/:id",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const rows = await query("DELETE FROM item_categories WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId]);
      if (!rows[0]) throw new HttpError(404, "Categoria non trovata.");
      res.json({ ok: true });
    }),
  );

  r.post(
    "/items",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(
        z.object({ name: z.string().trim().min(1).max(60), categoryId: z.number().int().positive(), sprite: z.enum(SPRITES) }),
        req.body,
      );
      const cat = await query("SELECT id FROM item_categories WHERE id=$1 AND user_id=$2", [b.categoryId, userId]);
      if (!cat[0]) throw new HttpError(404, "Categoria non trovata.");
      const dup = await query("SELECT id FROM items WHERE user_id=$1 AND lower(name)=lower($2)", [userId, b.name]);
      if (dup[0]) throw new HttpError(400, "Hai già un oggetto con questo nome.");
      const rows = await query("INSERT INTO items (user_id, category_id, name, sprite) VALUES ($1,$2,$3,$4) RETURNING id", [
        userId,
        b.categoryId,
        b.name,
        b.sprite,
      ]);
      res.json({ id: rows[0].id });
    }),
  );

  r.delete(
    "/items/:id",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const rows = await query("DELETE FROM items WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId]);
      if (!rows[0]) throw new HttpError(404, "Oggetto non trovato.");
      res.json({ ok: true });
    }),
  );

  r.post(
    "/items/:id/collect",
    h(async (req, res) => {
      const userId = uid(req);
      const itemId = parse(idParam, req.params.id);
      // personId null = collected alone today.
      const b = parse(z.object({ personId: z.number().int().positive().nullable() }), req.body);
      await tx(async (c) => {
        const [it] = await ownedIds(c, "items", userId, [itemId]);
        if (!it) throw new HttpError(404, "Non trovato.");
        if (b.personId === null) return collect(c, it, null, todayRome(), null);
        const [p] = await ownedIds(c, "people", userId, [b.personId]);
        if (!p) throw new HttpError(404, "Non trovato.");
        await collect(c, it, p, todayRome(), null);
      });
      res.json({ ok: true });
    }),
  );

  r.post(
    "/suggestions",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(
        z.object({ personId: z.number().int().positive(), itemId: z.number().int().positive(), tip: z.string().max(500).default("") }),
        req.body,
      );
      const [it] = await ownedIds(null, "items", userId, [b.itemId]);
      const [p] = await ownedIds(null, "people", userId, [b.personId]);
      if (!it || !p) throw new HttpError(404, "Non trovato.");
      const rows = await query(
        "INSERT INTO suggestions (user_id, person_id, item_id, tip) VALUES ($1,$2,$3,$4) RETURNING id",
        [userId, p, it, b.tip],
      );
      res.json({ id: rows[0].id });
    }),
  );

  r.post(
    "/suggestions/:id/done",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      await tx(async (c) => {
        const s = await c.query("SELECT item_id, person_id FROM suggestions WHERE id=$1 AND user_id=$2 AND done=false", [id, userId]);
        if (!s.rows[0]) throw new HttpError(404, "Suggerimento non trovato.");
        await collect(c, s.rows[0].item_id, s.rows[0].person_id, todayRome(), null);
      });
      res.json({ ok: true });
    }),
  );

  r.delete(
    "/suggestions/:id",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const rows = await query("DELETE FROM suggestions WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId]);
      if (!rows[0]) throw new HttpError(404, "Suggerimento non trovato.");
      res.json({ ok: true });
    }),
  );

  // ---------- Claude round trip ----------
  r.get(
    "/claude/export",
    h(async (req, res) => {
      const userId = uid(req);
      const includePrivate = req.query.private === "1";
      const events = await query<any>(
        `SELECT e.id, e.event_date, e.when_kind, e.what, e.positive, e.idea, e.is_private,
           COALESCE((SELECT json_agg(p.name ORDER BY p.name) FROM event_people ep JOIN people p ON p.id = ep.person_id
             WHERE ep.event_id = e.id), '[]') AS persone
         FROM events e WHERE e.user_id = $1 AND e.scored_at IS NULL ${includePrivate ? "" : "AND e.is_private = false"}
         ORDER BY e.event_date, e.id`,
        [userId],
      );
      const people = await query("SELECT name AS nome, category AS categoria, city AS citta, role AS ruolo FROM people WHERE user_id=$1", [userId]);
      res.json({
        app: "castelfranco-il-cuore",
        versione: 2,
        generato_il: todayRome(),
        assi: AXES,
        persone: people,
        eventi: events.map((e) => ({
          id: e.id,
          data: e.event_date,
          data_approssimativa: !["esatta", "oggi", "ieri"].includes(e.when_kind),
          persone: e.persone,
          cosa: e.what,
          positivo: e.positive,
          idea: e.idea,
        })),
      });
    }),
  );

  r.post(
    "/claude/import",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(importBody, req.body);
      const summary = await tx(async (c) => {
        const total = { events: 0, points: 0, collected: 0, suggestions: 0, skipped: [] as number[] };
        for (const ev of b.eventi) {
          const r1 = await applyScore(c, userId, ev);
          if (!r1) {
            total.skipped.push(ev.id);
            continue;
          }
          total.events += 1;
          total.points += r1.points;
          total.collected += r1.collected;
          total.suggestions += r1.suggestions;
        }
        return total;
      });
      res.json(summary);
    }),
  );

  // Automatic scoring with the Claude API (needs ANTHROPIC_API_KEY on the server).
  r.get(
    "/config",
    h(async (_req, res) => {
      res.json({ autoScoring: autoScoringEnabled() });
    }),
  );

  r.post(
    "/events/:id/score",
    h(async (req, res) => {
      const userId = uid(req);
      const id = parse(idParam, req.params.id);
      const b = parse(z.object({ includePrivate: z.boolean().default(false) }), req.body ?? {});
      if (!autoScoringEnabled()) throw new HttpError(400, "La valutazione automatica non è attiva (manca la chiave API).");
      const result = await scoreEvent(userId, id, b.includePrivate);
      res.json(result);
    }),
  );

  // ---------- hygiene ----------
  r.get(
    "/hygiene",
    h(async (req, res) => {
      const userId = uid(req);
      const month = parse(monthQ.optional(), req.query.month) ?? todayRome().slice(0, 7);
      res.json(await goalSummary("hygiene_logs", "habit", HABITS, userId, month));
    }),
  );

  r.get(
    "/hygiene/year",
    h(async (req, res) => {
      const userId = uid(req);
      const year = parse(yearQ.optional(), req.query.year) ?? Number(todayRome().slice(0, 4));
      res.json(await goalYear("hygiene_logs", "habit", HABITS, userId, year));
    }),
  );

  r.post(
    "/hygiene",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(z.object({ habit: z.enum(Object.keys(HABITS) as [Habit, ...Habit[]]) }), req.body);
      await query("INSERT INTO hygiene_logs (user_id, day, habit) VALUES ($1,$2,$3)", [userId, todayRome(), b.habit]);
      res.json({ ok: true });
    }),
  );

  r.post(
    "/hygiene/undo",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(z.object({ habit: z.enum(Object.keys(HABITS) as [Habit, ...Habit[]]) }), req.body);
      await query(
        `DELETE FROM hygiene_logs WHERE id = (SELECT id FROM hygiene_logs WHERE user_id=$1 AND habit=$2 AND day=$3 ORDER BY id DESC LIMIT 1)`,
        [userId, b.habit, todayRome()],
      );
      res.json({ ok: true });
    }),
  );

  // ---------- chores ----------
  r.get(
    "/chores",
    h(async (req, res) => {
      const userId = uid(req);
      const month = parse(monthQ.optional(), req.query.month) ?? todayRome().slice(0, 7);
      res.json(await goalSummary("chore_logs", "chore", CHORES, userId, month));
    }),
  );

  r.get(
    "/chores/year",
    h(async (req, res) => {
      const userId = uid(req);
      const year = parse(yearQ.optional(), req.query.year) ?? Number(todayRome().slice(0, 4));
      res.json(await goalYear("chore_logs", "chore", CHORES, userId, year));
    }),
  );

  r.post(
    "/chores",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(z.object({ chore: z.enum(Object.keys(CHORES) as [Chore, ...Chore[]]) }), req.body);
      await query("INSERT INTO chore_logs (user_id, day, chore) VALUES ($1,$2,$3)", [userId, todayRome(), b.chore]);
      res.json({ ok: true });
    }),
  );

  r.post(
    "/chores/undo",
    h(async (req, res) => {
      const userId = uid(req);
      const b = parse(z.object({ chore: z.enum(Object.keys(CHORES) as [Chore, ...Chore[]]) }), req.body);
      await query(
        `DELETE FROM chore_logs WHERE id = (SELECT id FROM chore_logs WHERE user_id=$1 AND chore=$2 AND day=$3 ORDER BY id DESC LIMIT 1)`,
        [userId, b.chore, todayRome()],
      );
      res.json({ ok: true });
    }),
  );

  // ---------- feeds ----------
  r.get(
    "/weather",
    h(async (_req, res) => {
      try {
        res.json(await getWeather());
      } catch (err) {
        console.warn("weather unavailable:", (err as Error).message);
        res.status(502).json({ error: "Meteo non disponibile." });
      }
    }),
  );

  r.get(
    "/news",
    h(async (req, res) => {
      const tab = parse(z.enum(NEWS_TABS), req.query.tab ?? "vietnam");
      try {
        res.json(await getNews(tab));
      } catch (err) {
        console.warn("news unavailable:", (err as Error).message);
        res.status(502).json({ error: "Notizie non disponibili." });
      }
    }),
  );

  // ---------- errors ----------
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Errore del server." });
  });

  return r;
}
