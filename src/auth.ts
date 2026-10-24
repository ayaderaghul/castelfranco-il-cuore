import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction, Router } from "express";
import express from "express";
import { z } from "zod";
import { query, tx } from "./db.js";

const COOKIE = "cuore_sid";
const SESSION_DAYS = 30;
const isProd = process.env.NODE_ENV === "production";

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Used so a login for an unknown username costs the same time as a real one.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

async function createSession(res: Response, userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)", [
    sha256(token),
    userId,
    `${SESSION_DAYS} days`,
  ]);
  setSessionCookie(res, token);
}

/** Loads the session if there is one. Never trusts anything but the hashed token in the DB. */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readCookie(req, COOKIE);
    if (token) {
      const rows = await query<{ user_id: number }>(
        "SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
        [sha256(token)],
      );
      if (rows[0]) req.userId = rows[0].user_id;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Fail closed: no valid session, no access. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "Devi accedere." });
    return;
  }
  next();
}

/**
 * State-changing API calls must carry a custom header. Browsers can't add it
 * cross-site without a CORS preflight (which we never allow), so this blocks CSRF.
 */
export function requireAppHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.get("X-Cuore") !== "1") {
    res.status(403).json({ error: "Richiesta non valida." });
    return;
  }
  next();
}

// Very small in-memory limiter for login/signup attempts (single instance app).
const attempts = new Map<string, { n: number; until: number }>();
function tooMany(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) {
    attempts.set(key, { n: 1, until: now + 15 * 60 * 1000 });
    return false;
  }
  a.n += 1;
  return a.n > 10;
}

const credentials = z.object({
  username: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}._-]+$/u, "Solo lettere, numeri, . _ -"),
  password: z.string().min(10, "Almeno 10 caratteri").max(200),
});

export function authRouter(): Router {
  const r = express.Router();

  r.post("/signup", async (req, res, next) => {
    try {
      if (tooMany(`signup:${req.ip}`)) return void res.status(429).json({ error: "Troppi tentativi, riprova più tardi." });
      const body = credentials.extend({ invite: z.string().trim().min(8).max(100) }).safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message ?? "Dati non validi." });
      const { username, password, invite } = body.data;
      const hash = await bcrypt.hash(password, 12);
      const userId = await tx(async (c) => {
        const inv = await c.query(
          "SELECT id FROM invites WHERE code_hash = $1 AND used_by IS NULL FOR UPDATE",
          [sha256(invite)],
        );
        if (!inv.rows[0]) return null;
        const exists = await c.query("SELECT 1 FROM users WHERE lower(username) = lower($1)", [username]);
        if (exists.rows[0]) return "taken" as const;
        const u = await c.query("INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id", [username, hash]);
        await c.query("UPDATE invites SET used_by = $1, used_at = now() WHERE id = $2", [u.rows[0].id, inv.rows[0].id]);
        return u.rows[0].id as number;
      });
      if (userId === null) return void res.status(400).json({ error: "Codice d'invito non valido o già usato." });
      if (userId === "taken") return void res.status(400).json({ error: "Nome utente già in uso." });
      await createSession(res, userId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.post("/login", async (req, res, next) => {
    try {
      if (tooMany(`login:${req.ip}`)) return void res.status(429).json({ error: "Troppi tentativi, riprova più tardi." });
      const body = z.object({ username: z.string().max(40), password: z.string().max(200) }).safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "Dati non validi." });
      const rows = await query<{ id: number; password_hash: string }>(
        "SELECT id, password_hash FROM users WHERE lower(username) = lower($1)",
        [body.data.username.trim()],
      );
      const ok = await bcrypt.compare(body.data.password, rows[0]?.password_hash ?? DUMMY_HASH);
      if (!rows[0] || !ok) return void res.status(401).json({ error: "Nome utente o password sbagliati." });
      await createSession(res, rows[0].id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.post("/logout", async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE);
      if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
      res.clearCookie(COOKIE, { path: "/" });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.get("/me", async (req, res, next) => {
    try {
      if (!req.userId) return void res.json({ user: null });
      const rows = await query("SELECT id, username FROM users WHERE id = $1", [req.userId]);
      res.json({ user: rows[0] ?? null });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
