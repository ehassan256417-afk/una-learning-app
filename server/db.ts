import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The platform database: accounts, each student's saved learning data,
 * measured activity, AI usage, settings and the audit log.
 *
 * SQLite through Node's built-in driver: one file, no extra service and no
 * extra dependency, which fits a beta of a few dozen students on one server.
 * Every query in the platform goes through prepared statements with bound
 * values; nothing is built by joining strings with user input.
 */

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    status TEXT NOT NULL DEFAULT 'active',
    beta INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER,
    login_count INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER,
    invite_code TEXT,
    note TEXT NOT NULL DEFAULT ''
  ) STRICT;

  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

  CREATE TABLE reset_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  ) STRICT;

  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  ) STRICT;

  CREATE TABLE progress (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rev INTEGER NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE courses (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    document_name TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL DEFAULT 'pdf',
    lessons_ready INTEGER NOT NULL DEFAULT 0,
    lessons_planned INTEGER NOT NULL DEFAULT 0,
    lessons_failed INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL,
    json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    hidden_reason TEXT,
    PRIMARY KEY (user_id, id)
  ) STRICT;

  CREATE TABLE visits (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    user_id TEXT,
    started_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    day TEXT NOT NULL,
    active_ms INTEGER NOT NULL DEFAULT 0,
    study_ms INTEGER NOT NULL DEFAULT 0,
    page_views INTEGER NOT NULL DEFAULT 0,
    entry_path TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT ''
  ) STRICT;
  CREATE INDEX visits_day ON visits(day);
  CREATE INDEX visits_visitor ON visits(visitor_id);
  CREATE INDEX visits_user ON visits(user_id);

  CREATE TABLE activity (
    day TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    user_key TEXT NOT NULL DEFAULT '',
    active_ms INTEGER NOT NULL DEFAULT 0,
    study_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, visitor_id, user_key)
  ) STRICT;
  CREATE INDEX activity_user ON activity(user_key, day);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    visit_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    prev_path TEXT NOT NULL DEFAULT '',
    value INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX events_day_type ON events(day, type);
  CREATE INDEX events_user ON events(user_id, type);
  CREATE INDEX events_visitor ON events(visitor_id);

  CREATE TABLE ai_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    user_id TEXT,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    tokens_estimated INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    cached INTEGER NOT NULL DEFAULT 0,
    document_id TEXT NOT NULL DEFAULT '',
    lesson_title TEXT NOT NULL DEFAULT '',
    resolved_at INTEGER
  ) STRICT;
  CREATE INDEX ai_requests_day ON ai_requests(day);
  CREATE INDEX ai_requests_user ON ai_requests(user_id, day);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  ) STRICT;
  `,
];

/** Opens (and if needed creates or upgrades) the database. `:memory:` is used by tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** Runs `work` in one transaction: all of it is saved, or none of it. */
export function inTransaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** UTC calendar day, the unit all daily statistics are counted in. */
export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
