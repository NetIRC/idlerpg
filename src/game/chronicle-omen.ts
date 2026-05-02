import type Database from 'better-sqlite3';
import { findOnlineByNick, insertRealmEvent, metaGetInt, metaSetInt, recentRealmEvents } from '../db/index.js';
import { durationIt } from './duration.js';

/** Events packed into one IRC/PM line (also capped by CHRONICLE_IRC_MAX_CHARS). */
export const CHRONICLE_IRC_MAX_EVENTS = 10;
export const CHRONICLE_IRC_MAX_CHARS = 480;

/**
 * Default / max rows for HTTP chronicle (PHP `api/chronicle.php`, Express `/api/chronicle`, dashboard).
 * Keep PHP `irpg_chronicle_*()` in bootstrap in sync.
 */
export const CHRONICLE_API_DEFAULT_LIMIT = 16;
export const CHRONICLE_API_MAX_LIMIT = 40;

const OMEN_COOLDOWN_SEC = 8 * 3600;
const OMEN_META_PREFIX = 'omen_cd_';

const CHRONICLE_KIND_LABEL: Record<string, string> = {
  quest_start: 'Quest',
  quest_end: 'Quest end',
  lucky_hour: 'Lucky hr',
  realm_record: 'Record',
  hog_win: 'HoG+',
  hog_lose: 'HoG−',
  register: 'Join',
  login: 'Login',
  logout: 'Logout',
  admin_resetpass: 'Admin',
  admin_forcelogout: 'Admin',
  lucky_hour_admin: 'Lucky',
  omen_rare: 'Rare omen',
  omen_boon: 'Omen+',
  omen_curse: 'Omen−',
  duel: 'Duel',
};

const OMEN_FLUFF = [
  'The channel holds its breath; your next line is not yet written.',
  'A ghost of lag circles your timer — then disperses without landing.',
  'Three nets dream the same route; only silence answers.',
  'Cold checksums rattle behind the mask of your nick.',
  'The realm flips a bit you cannot see; it changes nothing. Or everything.',
  'Idle depth is measured in heartbeats the room forgets to count.',
  'Stars over the server farm align for someone else tonight.',
];

function chronicleKindLabel(kind: string): string {
  return CHRONICLE_KIND_LABEL[kind] ?? kind;
}

/** One line for IRC / PM: recent drama from `realm_events` (shorter than web; see CHRONICLE_IRC_*). */
export function formatChronicleLine(db: Database): string {
  const rows = recentRealmEvents(db, CHRONICLE_IRC_MAX_EVENTS);
  if (!rows.length) {
    return 'The chronicle is blank — quests, Hand of God, and records will write the first lines.';
  }
  const now = Math.floor(Date.now() / 1000);
  const parts = rows.map((r) => {
    const ago = Math.max(0, now - r.ts);
    const t = ago < 3600 ? `${Math.max(1, Math.floor(ago / 60))}m` : `${Math.floor(ago / 3600)}h`;
    const label = chronicleKindLabel(r.kind);
    const det = (r.detail || '').trim() || '—';
    return `${label} (${t}): ${det}`.slice(0, 100);
  });
  const suffix = ` — web/api: last ${CHRONICLE_API_DEFAULT_LIMIT} (max ${CHRONICLE_API_MAX_LIMIT} ?limit=)`;
  const prefix = `📜 Chronicle (IRC ${rows.length}/${CHRONICLE_IRC_MAX_EVENTS}): `;
  const budget = Math.max(80, CHRONICLE_IRC_MAX_CHARS - prefix.length - suffix.length);
  const joined = parts.join(' │ ');
  const body = joined.length <= budget ? joined : `${joined.slice(0, Math.max(0, budget - 1))}…`;
  return prefix + body + suffix;
}

export function consultOmen(
  db: Database,
  ircNick: string,
  channelNicks: Set<string>,
): { err: string } | { text: string } {
  const p = findOnlineByNick(db, ircNick);
  if (!p) return { err: 'Log in (LOGIN via PM) before consulting the omen.' };
  if (!p.irc_nick || !channelNicks.has(p.irc_nick)) {
    return { err: 'Stand in the game channel — the omen reads who is present.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const key = `${OMEN_META_PREFIX}${p.id}`;
  const last = metaGetInt(db, key) ?? 0;
  if (last > 0 && now - last < OMEN_COOLDOWN_SEC) {
    const wait = OMEN_COOLDOWN_SEC - (now - last);
    return { err: `The veil is quiet. Another omen in ${durationIt(wait)}.` };
  }

  metaSetInt(db, key, now);

  const r = Math.random();
  if (r < 0.55) {
    const line = OMEN_FLUFF[Math.floor(Math.random() * OMEN_FLUFF.length)]!;
    return { text: `🜁 ${line}` };
  }
  if (r < 0.78) {
    const ns = Math.max(30, p.next_seconds * 0.998);
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, p.id);
    insertRealmEvent(db, 'omen_boon', p.character_name);
    return { text: `🜁 A kind omen — time thins toward your next level (~${durationIt(ns)}).` };
  }
  if (r < 0.93) {
    const ns = p.next_seconds * 1.004;
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, p.id);
    insertRealmEvent(db, 'omen_curse', p.character_name);
    return { text: `🜁 A heavy omen — the clock swells (~${durationIt(ns)}).` };
  }
  insertRealmEvent(db, 'omen_rare', p.character_name);
  return {
    text: `🜁 Rare omen — ${p.character_name} is etched into the chronicle. The realm notices.`,
  };
}
