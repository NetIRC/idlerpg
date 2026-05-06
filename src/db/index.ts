/** SQLite schema, migrations, and data-access helpers shared by bot and APIs. */

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
  /** Total arena duel wins (PvP). */
  duel_wins: number;
  /** Shadow gauntlet victories (PvE). */
  gauntlet_wins: number;
  /** Continuous in-channel idle streak in seconds (V3 optional mechanic). */
  idle_streak_sec: number;
  /** Number of streak milestone rewards granted (for stats/telemetry). */
  streak_reward_count: number;
  /** Optional guild id for social systems. */
  guild_id: number | null;
  /** Prestige/rebirth rank (soft permanent progression). */
  prestige_rank: number;
  /** Prestige points spent/unspent ledger. */
  prestige_points: number;
};

let _db: Database.Database | null = null;

/** If only the legacy typo-named file exists, rename it (and -wal/-shm) to idlerpg.db. */
function migrateLegacyIodlerpgFilename(canonicalResolved: string): void {
  const typoPath = canonicalResolved.replace(/idlerpg\.db$/i, 'iodlerpg.db');
  if (typoPath === canonicalResolved) return;
  if (fs.existsSync(canonicalResolved)) return;
  if (!fs.existsSync(typoPath)) return;
  console.warn(`[db] Renaming legacy ${path.basename(typoPath)} -> ${path.basename(canonicalResolved)}`);
  fs.renameSync(typoPath, canonicalResolved);
  for (const suf of ['-wal', '-shm', '-journal'] as const) {
    const from = typoPath + suf;
    const to = canonicalResolved + suf;
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
  }
}

/**
 * If this process owns the DB file or WAL sidecars but mode lacks owner-write (e.g. 444 after a bad copy),
 * add u+w. Does not help when the file is owned by another user — fix with chown on the server.
 */
function ensureOwnerRwForSqliteTree(resolvedDbPath: string): void {
  if (typeof process.getuid !== 'function') return;
  const uid = process.getuid();
  const dir = path.dirname(resolvedDbPath);
  try {
    const dst = fs.statSync(dir);
    if (dst.uid === uid) {
      const dm = dst.mode & 0o777;
      if ((dm & 0o200) === 0 || (dm & 0o100) === 0) {
        fs.chmodSync(dir, dm | 0o700);
        console.warn(`[db] Set directory u+rwx on ${dir} (required to create WAL files)`);
      }
    }
  } catch {
    /* ignore */
  }
  const paths = [resolvedDbPath, `${resolvedDbPath}-wal`, `${resolvedDbPath}-shm`, `${resolvedDbPath}-journal`];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      const st = fs.statSync(p);
      if (st.uid !== uid) continue;
      const m = st.mode & 0o777;
      if ((m & 0o200) === 0) {
        fs.chmodSync(p, m | 0o200);
        console.warn(`[db] Set owner-write on ${path.basename(p)}`);
      }
    } catch {
      /* ignore */
    }
  }
}

function assertDbWritable(db: Database.Database, resolvedPath: string): void {
  const probeKey = '__irpg_rw_probe__';
  try {
    db.prepare(
      `INSERT INTO meta (key, int_value, text_value) VALUES (?, 0, NULL)
       ON CONFLICT(key) DO UPDATE SET int_value = int_value`,
    ).run(probeKey);
    db.prepare('DELETE FROM meta WHERE key = ?').run(probeKey);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'SQLITE_READONLY' || code === 'SQLITE_CANTOPEN') {
      const dir = path.dirname(resolvedPath);
      throw new Error(
        `[db] Cannot write SQLite at ${resolvedPath} (${code}). ` +
          `Run: ls -la ${dir} - owner UID must match the bot (check: id -u when the bot starts). ` +
          `WAL needs write on the directory and the database file. ` +
          `If the file is owned by another user (e.g. www-data from PHP), as root run e.g.: ` +
          `chown -R idlerpg:idlerpg ${dir} && chmod u+rwX ${dir} && chmod u+rw ${resolvedPath} ` +
          `(replace idlerpg with your bot user), or use a shared group: chown idlerpg:www-data ..., chmod 775 ${dir}, chmod 664 ${resolvedPath}.`,
      );
    }
    throw e;
  }
}

/** Open SQLite (WAL); creates tables. Shared path with site.config.php on the PHP host. */

export function getDb(config: AppConfig): Database.Database {
  if (_db) return _db;
  const resolved = path.resolve(config.dbPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `[db] Directory not writable: ${dir}. Create it or fix permissions (chmod/chown) before starting the bot.`,
    );
  }
  migrateLegacyIodlerpgFilename(resolved);
  ensureOwnerRwForSqliteTree(resolved);
  _db = new Database(resolved);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  assertDbWritable(_db, resolved);
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
      last_login INTEGER NOT NULL DEFAULT 0,
      guild_id INTEGER DEFAULT NULL,
      prestige_rank INTEGER NOT NULL DEFAULT 0,
      prestige_points INTEGER NOT NULL DEFAULT 0
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
  ensurePlayerMedalsTable(db);
  ensureCombatStatColumns(db);
  ensureV3Columns(db);
  ensureV3FeatureTables(db);
  normalizeIrcNickAssignments(db);
  ensureUniqueIrcNickIndex(db);
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
    CREATE INDEX IF NOT EXISTS idx_realm_events_kind ON realm_events(kind);
    CREATE INDEX IF NOT EXISTS idx_realm_events_kind_ts ON realm_events(kind, ts);
  `);
}

export function insertRealmEvent(db: Database.Database, kind: string, detail: string): void {
  db.prepare('INSERT INTO realm_events (ts, kind, detail) VALUES (?, ?, ?)').run(
    Math.floor(Date.now() / 1000),
    kind,
    detail.slice(0, 500),
  );
}

function ensurePlayerMedalsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_medals (
      player_id INTEGER NOT NULL,
      medal_key TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (player_id, medal_key)
    );
    CREATE INDEX IF NOT EXISTS idx_player_medals_player ON player_medals(player_id);
  `);
}

function ensureCombatStatColumns(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'duel_wins')) {
    db.exec('ALTER TABLE players ADD COLUMN duel_wins INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'gauntlet_wins')) {
    db.exec('ALTER TABLE players ADD COLUMN gauntlet_wins INTEGER NOT NULL DEFAULT 0');
  }
}

function ensureV3Columns(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'idle_streak_sec')) {
    db.exec('ALTER TABLE players ADD COLUMN idle_streak_sec INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'streak_reward_count')) {
    db.exec('ALTER TABLE players ADD COLUMN streak_reward_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'guild_id')) {
    db.exec('ALTER TABLE players ADD COLUMN guild_id INTEGER DEFAULT NULL');
  }
  if (!cols.some((c) => c.name === 'prestige_rank')) {
    db.exec('ALTER TABLE players ADD COLUMN prestige_rank INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'prestige_points')) {
    db.exec('ALTER TABLE players ADD COLUMN prestige_points INTEGER NOT NULL DEFAULT 0');
  }
}

function ensureV3FeatureTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      pass_tier_count INTEGER NOT NULL DEFAULT 20
    );
    CREATE INDEX IF NOT EXISTS idx_seasons_time ON seasons(starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS player_season_progress (
      player_id INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, season_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_season_progress_season ON player_season_progress(season_id, level, xp);

    CREATE TABLE IF NOT EXISTS season_rewards_claimed (
      player_id INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      tier INTEGER NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, season_id, tier)
    );

    CREATE TABLE IF NOT EXISTS world_boss_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL DEFAULT 0,
      boss_name TEXT NOT NULL,
      hp_max INTEGER NOT NULL,
      hp_left INTEGER NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      reward_sec INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_world_boss_runs_state ON world_boss_runs(state, ends_at);

    CREATE TABLE IF NOT EXISTS world_boss_contrib (
      run_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      damage INTEGER NOT NULL DEFAULT 0,
      last_hit_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (run_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_world_boss_contrib_damage ON world_boss_contrib(run_id, damage DESC);

    CREATE TABLE IF NOT EXISTS guilds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members(guild_id);

    CREATE TABLE IF NOT EXISTS player_relics (
      player_id INTEGER NOT NULL,
      relic_key TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, relic_key)
    );
    CREATE INDEX IF NOT EXISTS idx_player_relics_active ON player_relics(player_id, is_active);
  `);
}

/**
 * Legacy rows may contain duplicate IRC nick bindings.
 * Keep the best candidate and clear stale/conflicting bindings.
 */
function normalizeIrcNickAssignments(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT id, irc_nick, online, session_open, last_login
       FROM players
       WHERE TRIM(irc_nick) != ''
       ORDER BY online DESC, session_open DESC, last_login DESC, id DESC`,
    )
    .all() as { id: number; irc_nick: string; online: number; session_open: number; last_login: number }[];
  const seen = new Set<string>();
  const clear = db.prepare(`UPDATE players SET irc_nick = '', online = 0, session_open = 0 WHERE id = ?`);
  for (const r of rows) {
    const key = r.irc_nick.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      clear.run(r.id);
      continue;
    }
    seen.add(key);
  }
}

/** Enforce one IRC nick per account row (case-insensitive, blanks excluded). */
function ensureUniqueIrcNickIndex(db: Database.Database): void {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_players_irc_nick_unique_ci
    ON players(irc_nick COLLATE NOCASE)
    WHERE irc_nick != '';
  `);
}

/** Written by the IRC bot while connected; web tier treats stale rows as offline. */
export const META_KEY_BOT_LAST_SEEN_MS = 'bot_last_seen_ms';
/** Runtime AI flag mirrored by the IRC bot for web status rendering. */
export const META_KEY_AI_ENABLED = 'ai_enabled';

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

/** IRC nick match is case-insensitive (challenge / duel targets). */
export function findOnlineByNickCi(db: Database.Database, nick: string): PlayerRow | undefined {
  return db
    .prepare('SELECT * FROM players WHERE online = 1 AND irc_nick COLLATE NOCASE = ?')
    .get(nick) as PlayerRow | undefined;
}

/** Any row with this IRC nick (online or not) — used for admin checks after LOGOUT. */
export function findPlayerByIrcNickCi(db: Database.Database, nick: string): PlayerRow | undefined {
  return db
    .prepare(
      `SELECT * FROM players
       WHERE irc_nick != '' AND irc_nick COLLATE NOCASE = ?
       ORDER BY online DESC, session_open DESC, last_login DESC, id DESC
       LIMIT 1`,
    )
    .get(nick) as PlayerRow | undefined;
}

/** Last IRC nick on file but not logged in (e.g. after LOGOUT / PART) — for LOGIN reminders on join. */
export function findLoggedOutByIrcNickCi(db: Database.Database, nick: string): PlayerRow | undefined {
  return db
    .prepare(
      `SELECT * FROM players WHERE online = 0 AND session_open = 0 AND irc_nick != '' AND irc_nick COLLATE NOCASE = ? LIMIT 1`,
    )
    .get(nick) as PlayerRow | undefined;
}

/**
 * Ensure a nick is attached to at most one character row.
 * Conflicting rows are detached and forced offline.
 */
export function clearIrcNickConflicts(db: Database.Database, nick: string, keepPlayerId?: number): void {
  const n = nick.trim();
  if (!n) return;
  if (keepPlayerId == null) {
    db.prepare(`UPDATE players SET irc_nick = '', online = 0, session_open = 0 WHERE irc_nick COLLATE NOCASE = ?`).run(
      n,
    );
    return;
  }
  db.prepare(
    `UPDATE players
     SET irc_nick = '', online = 0, session_open = 0
     WHERE irc_nick COLLATE NOCASE = ? AND id != ?`,
  ).run(n, keepPlayerId);
}

export function leaderboard(db: Database.Database, limit = 50): PlayerRow[] {
  return db
    .prepare(
      `SELECT * FROM players ORDER BY level DESC, next_seconds ASC LIMIT ?`,
    )
    .all(limit) as PlayerRow[];
}

export type RealmEventRow = { ts: number; kind: string; detail: string };

/** Recent rows from `realm_events` (newest first). */
export function recentRealmEvents(db: Database.Database, limit: number): RealmEventRow[] {
  return db
    .prepare(`SELECT ts, kind, detail FROM realm_events ORDER BY id DESC LIMIT ?`)
    .all(limit) as RealmEventRow[];
}

/**
 * Events that mention a hero in `detail` (omens store the character name alone;
 * medals use "Name: medal label"). Space-prefix matches realm records (`Name L10`), HoG, gauntlet, etc.
 */
export function recentRealmEventsForCharacter(
  db: Database.Database,
  characterName: string,
  limit: number,
): RealmEventRow[] {
  const lim = Math.min(40, Math.max(1, limit));
  const name = characterName.trim();
  if (!name) return [];
  const likeColon = `${name}:%`;
  const likeSpace = `${name} %`;
  return db
    .prepare(
      `SELECT ts, kind, detail FROM realm_events
       WHERE detail COLLATE NOCASE = ?
          OR detail COLLATE NOCASE LIKE ?
          OR detail COLLATE NOCASE LIKE ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(name, likeColon, likeSpace, lim) as RealmEventRow[];
}
