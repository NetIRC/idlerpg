import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';

/** One row from the players table (same schema as the PHP site reads). */

export type PlayerRow = {
  id: number;
  character_name: string;
  password_hash: string;
  class: string;
  level: number;
  next_seconds: number;
  idled: number;
  online: number;
  /** 1 after LOGIN/REGISTER until LOGOUT / PART / QUIT / KICK — used to restore `online` after bot reconnect if still in channel. */
  session_open: number;
  irc_nick: string;
  userhost: string;
  alignment: string;
  pen_mesg: number;
  pen_nick: number;
  pen_part: number;
  pen_quit: number;
  pen_kick: number;
  pen_quest: number;
  pen_logout: number;
  is_admin: number;
  created_at: number;
  last_login: number;
  /** Cosmetic charm; tiny idle bonus when set. */
  trinket: string;
};

let _db: Database.Database | null = null;

/** Open SQLite (WAL); creates tables. Shared path with site.config.php on the PHP host. */

export function getDb(config: AppConfig): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(path.resolve(config.dbPath));
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      class TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      next_seconds REAL NOT NULL,
      idled INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 0,
      session_open INTEGER NOT NULL DEFAULT 0,
      irc_nick TEXT NOT NULL DEFAULT '',
      userhost TEXT NOT NULL DEFAULT '',
      alignment TEXT NOT NULL DEFAULT 'n',
      pen_mesg INTEGER NOT NULL DEFAULT 0,
      pen_nick INTEGER NOT NULL DEFAULT 0,
      pen_part INTEGER NOT NULL DEFAULT 0,
      pen_quit INTEGER NOT NULL DEFAULT 0,
      pen_kick INTEGER NOT NULL DEFAULT 0,
      pen_quest INTEGER NOT NULL DEFAULT 0,
      pen_logout INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_players_nick ON players(irc_nick);
    CREATE INDEX IF NOT EXISTS idx_players_online ON players(online);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      int_value INTEGER NOT NULL DEFAULT 0,
      text_value TEXT
    );
  `);
  ensureSessionOpenColumn(db);
  ensureMetaTextColumn(db);
  ensureTrinketColumn(db);
  ensureRealmEventsTable(db);
}

export function metaGetInt(db: Database.Database, key: string): number | null {
  const row = db.prepare('SELECT int_value FROM meta WHERE key = ?').get(key) as { int_value: number } | undefined;
  return row ? row.int_value : null;
}

export function metaSetInt(db: Database.Database, key: string, val: number): void {
  db.prepare(
    `INSERT INTO meta (key, int_value, text_value) VALUES (?, ?, NULL)
     ON CONFLICT(key) DO UPDATE SET int_value = excluded.int_value`,
  ).run(key, val);
}

export function metaGetText(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT text_value FROM meta WHERE key = ?').get(key) as { text_value: string | null } | undefined;
  if (!row) return null;
  return row.text_value ?? null;
}

export function metaSetText(db: Database.Database, key: string, val: string | null): void {
  if (val === null) {
    db.prepare('UPDATE meta SET text_value = NULL WHERE key = ?').run(key);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, int_value, text_value) VALUES (?, 0, ?)
     ON CONFLICT(key) DO UPDATE SET text_value = excluded.text_value`,
  ).run(key, val);
}

function ensureMetaTextColumn(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(meta)').all() as { name: string }[];
  if (cols.some((c) => c.name === 'text_value')) return;
  db.exec('ALTER TABLE meta ADD COLUMN text_value TEXT');
}

function ensureTrinketColumn(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
  if (cols.some((c) => c.name === 'trinket')) return;
  db.exec(`ALTER TABLE players ADD COLUMN trinket TEXT NOT NULL DEFAULT ''`);
}

function ensureRealmEventsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS realm_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_realm_events_ts ON realm_events(ts);
  `);
}

export function insertRealmEvent(db: Database.Database, kind: string, detail: string): void {
  db.prepare('INSERT INTO realm_events (ts, kind, detail) VALUES (?, ?, ?)').run(
    Math.floor(Date.now() / 1000),
    kind,
    detail.slice(0, 500),
  );
}

/** Written by the IRC bot while connected; web tier treats stale rows as offline. */
export const META_KEY_BOT_LAST_SEEN_MS = 'bot_last_seen_ms';

/** Heartbeat older than this (ms) ⇒ site shows bot offline (crashed / stopped). */
export const BOT_HEARTBEAT_STALE_MS = 120_000;

export function touchBotHeartbeat(db: Database.Database): void {
  const ms = Date.now();
  db.prepare(
    `INSERT INTO meta (key, int_value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET int_value = excluded.int_value`,
  ).run(META_KEY_BOT_LAST_SEEN_MS, ms);
}

export function clearBotHeartbeat(db: Database.Database): void {
  db.prepare(`DELETE FROM meta WHERE key = ?`).run(META_KEY_BOT_LAST_SEEN_MS);
}

export function botPresenceFromDb(db: Database.Database): { botOnline: boolean; botLastSeenMs: number | null } {
  const row = db
    .prepare(`SELECT int_value FROM meta WHERE key = ?`)
    .get(META_KEY_BOT_LAST_SEEN_MS) as { int_value: number } | undefined;
  if (!row?.int_value) return { botOnline: false, botLastSeenMs: null };
  const age = Date.now() - row.int_value;
  if (age < 0) return { botOnline: false, botLastSeenMs: row.int_value };
  return {
    botOnline: age <= BOT_HEARTBEAT_STALE_MS,
    botLastSeenMs: row.int_value,
  };
}

function ensureSessionOpenColumn(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
  if (cols.some((c) => c.name === 'session_open')) return;
  db.exec('ALTER TABLE players ADD COLUMN session_open INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE players SET session_open = online');
}

export function findByCharacter(db: Database.Database, name: string, caseSensitive: boolean): PlayerRow | undefined {
  const sql = caseSensitive
    ? 'SELECT * FROM players WHERE character_name = ?'
    : 'SELECT * FROM players WHERE character_name COLLATE NOCASE = ?';
  return db.prepare(sql).get(name) as PlayerRow | undefined;
}

export function findOnlineByNick(db: Database.Database, nick: string): PlayerRow | undefined {
  return db
    .prepare('SELECT * FROM players WHERE online = 1 AND irc_nick = ?')
    .get(nick) as PlayerRow | undefined;
}

export function leaderboard(db: Database.Database, limit = 50): PlayerRow[] {
  return db
    .prepare(
      `SELECT * FROM players ORDER BY level DESC, next_seconds ASC LIMIT ?`,
    )
    .all(limit) as PlayerRow[];
}
