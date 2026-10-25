import pg from "pg";

// Keep DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (avoids timezone shifts).
pg.types.setTypeParser(1082, (v: string) => v);

// The pool connects lazily, so pure modules (and unit tests) can import this file without a database.
const connectionString = process.env.DATABASE_URL;

export const pool = new pg.Pool({ connectionString, max: 5 });

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/** Runs fn inside a transaction on a single client, always releasing it. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY,
  code_hash TEXT UNIQUE NOT NULL,
  used_by INT REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('amici','famiglia','pro')),
  city TEXT NOT NULL DEFAULT 'Castelfranco',
  role TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'conoscente',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_user_idx ON people(user_id);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  when_kind TEXT NOT NULL,
  event_date DATE NOT NULL,
  what TEXT NOT NULL DEFAULT '',
  positive TEXT NOT NULL DEFAULT '',
  idea TEXT NOT NULL DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT false,
  scored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id, event_date);
CREATE TABLE IF NOT EXISTS event_people (
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id INT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, person_id)
);
CREATE TABLE IF NOT EXISTS event_points (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  axis TEXT NOT NULL,
  delta INT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS event_points_event_idx ON event_points(event_id);
CREATE TABLE IF NOT EXISTS item_categories (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#F2C14E',
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES item_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sprite TEXT NOT NULL DEFAULT 'stella',
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS item_collects (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person_id INT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event_id INT REFERENCES events(id) ON DELETE SET NULL,
  collected_on DATE NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tip TEXT NOT NULL DEFAULT '',
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Suggestions created by a Claude import belong to that event and disappear with it.
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS event_id INT REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS score_error TEXT;
-- 'claude' = proposed by Claude (replaced on re-scoring); 'idea' = picked by me in the event form.
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'claude';
-- An item collected with nobody (person_id NULL) was collected alone ("da sola").
ALTER TABLE item_collects ALTER COLUMN person_id DROP NOT NULL;
-- What to remember for the next meeting with this person (shown on the card).
ALTER TABLE people ADD COLUMN IF NOT EXISTS next_note TEXT NOT NULL DEFAULT '';
-- Outside services: cached responses (with Expires / Last-Modified / ETag) and the pause
-- state of each service, kept here so a restart doesn't forget them.
-- (An early draft used other column names; these are only caches, so rebuild them if so.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='http_cache' AND column_name='url') THEN
    DROP TABLE http_cache;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='service_state' AND column_name='block_stage') THEN
    DROP TABLE service_state;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_state (
  service TEXT PRIMARY KEY,
  paused_until TIMESTAMPTZ,
  reason TEXT,
  failures INT NOT NULL DEFAULT 0,
  blocked_stage INT NOT NULL DEFAULT 0,
  disabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hygiene_logs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  habit TEXT NOT NULL CHECK (habit IN ('doccia','capelli','denti')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hygiene_user_day_idx ON hygiene_logs(user_id, day);
CREATE TABLE IF NOT EXISTS chore_logs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  chore TEXT NOT NULL CHECK (chore IN ('scopa','mocio','piante','bagno')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chore_user_day_idx ON chore_logs(user_id, day);
`;

export async function migrate(): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  await pool.query(SCHEMA);
}
