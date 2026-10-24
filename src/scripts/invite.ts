// Creates a one-time invite code and prints it once. Only its hash is stored.
// Usage: DATABASE_URL=... npm run invite
import crypto from "node:crypto";
import { migrate, pool, query } from "../db.js";
import { sha256 } from "../auth.js";

const code = crypto.randomBytes(12).toString("base64url");
await migrate();
await query("INSERT INTO invites (code_hash) VALUES ($1)", [sha256(code)]);
console.log(`Invite code (single use): ${code}`);
await pool.end();
