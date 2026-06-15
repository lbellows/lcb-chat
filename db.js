import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Where the SQLite file lives. In Docker this is a mounted volume so messages
// survive container rebuilds/updates.
const DB_PATH = process.env.DB_PATH || "./data/chat.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT    NOT NULL,
    text     TEXT    NOT NULL,
    ts       INTEGER NOT NULL
  );
`);

const insertStmt = db.prepare(
  "INSERT INTO messages (username, text, ts) VALUES (?, ?, ?)"
);

// Most recent `limit` messages, optionally those with id < `before` (for
// lazy-loading older history as the user scrolls up). Returned oldest-first.
const recentStmt = db.prepare(`
  SELECT id, username, text, ts FROM messages
  ORDER BY id DESC
  LIMIT ?
`);

const beforeStmt = db.prepare(`
  SELECT id, username, text, ts FROM messages
  WHERE id < ?
  ORDER BY id DESC
  LIMIT ?
`);

export function saveMessage({ username, text, ts }) {
  const info = insertStmt.run(username, text, ts);
  return { id: info.lastInsertRowid, username, text, ts };
}

export function getMessages({ before, limit = 50 } = {}) {
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = before
    ? beforeStmt.all(Number(before), limit)
    : recentStmt.all(limit);
  return rows.reverse(); // oldest-first for display
}

export default db;
