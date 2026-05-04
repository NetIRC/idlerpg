import type Database from 'better-sqlite3';
import {
  findOnlineByNickCi,
  insertRealmEvent,
  metaGetInt,
  metaSetInt,
  recentRealmEvents,
} from '../db/index.js';
import { durationIt, formatRelativeAgoSec } from './duration.js';

/** Events packed into one IRC/PM line (also capped by CHRONICLE_IRC_MAX_CHARS). Same count as default web feed. */
export const CHRONICLE_IRC_MAX_EVENTS = 15;
export const CHRONICLE_IRC_MAX_CHARS = 480;

/**
 * Default / max rows for HTTP chronicle (PHP `api/chronicle.php`, Express `/api/chronicle`, dashboard).
 * Also used for per-hero `recentFinds` in `api/player.php` / `/api/player/:name`.
 * Keep PHP `irpg_chronicle_*()` in bootstrap in sync.
 */
export const CHRONICLE_API_DEFAULT_LIMIT = 15;
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
  admin_delete: 'Admin',
  admin_shutdown: 'Shutdown',
  lucky_hour_admin: 'Lucky',
  omen_rare: 'Rare omen',
  omen_boon: 'Omen+',
  omen_curse: 'Omen−',
  duel: 'Duel',
  medal: 'Medal',
  gauntlet_win: 'Gauntlet',
  gauntlet_lose: 'Gauntlet',
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
    return 'Chronicle empty — quests, Hand of God, duels, and records will add the first lines.';
  }
  const now = Math.floor(Date.now() / 1000);
  const parts = rows.map((r) => {
    const ago = Math.max(0, now - r.ts);
    const t = formatRelativeAgoSec(ago);
    const label = chronicleKindLabel(r.kind);
    const det = (r.detail || '').trim() || '—';
    return `${label} (${t}): ${det}`.slice(0, 100);
  });
  const prefix = `Chronicle · last ${rows.length} events: `;
  const budget = Math.max(80, CHRONICLE_IRC_MAX_CHARS - prefix.length);
  const joined = parts.join(' │ ');
  const body = joined.length <= budget ? joined : `${joined.slice(0, Math.max(0, budget - 1))}…`;
  return prefix + body;
}

export function consultOmen(
  db: Database,
  ircNick: string,
  channelNicks: Set<string>,
  nickEquals: (a: string, b: string) => boolean,
): { err: string } | { text: string; tone?: 'gain' | 'loss' | 'neutral' } {
  const p = findOnlineByNickCi(db, ircNick);
  if (!p) return { err: 'Log in via PM (LOGIN) before consulting the omen.' };
  const raw = (p.irc_nick || '').replace(/^@|%|\+/, '');
  let seen = false;
  for (const n of channelNicks) {
    if (nickEquals(n, raw)) {
      seen = true;
      break;
    }
  }
  if (!seen) {
    return { err: 'Join the game channel — the omen only reads players who are present.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const key = `${OMEN_META_PREFIX}${p.id}`;
  const last = metaGetInt(db, key) ?? 0;
  if (last > 0 && now - last < OMEN_COOLDOWN_SEC) {
    const wait = OMEN_COOLDOWN_SEC - (now - last);
    return { err: `Omen cooldown active. Next reading in ${durationIt(wait)}.` };
  }

  metaSetInt(db, key, now);

  const r = Math.random();
  if (r < 0.55) {
    const line = OMEN_FLUFF[Math.floor(Math.random() * OMEN_FLUFF.length)]!;
    return { text: `🜁 Omen (neutral): ${line}`, tone: 'neutral' };
  }
  if (r < 0.78) {
    const ns = Math.max(30, p.next_seconds * 0.998);
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, p.id);
    insertRealmEvent(db, 'omen_boon', p.character_name);
    return {
      text: `🜁 Omen (favorable): ${p.character_name}'s level timer is shortened. Next level in ${durationIt(ns)}.`,
      tone: 'gain',
    };
  }
  if (r < 0.93) {
    const ns = p.next_seconds * 1.004;
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, p.id);
    insertRealmEvent(db, 'omen_curse', p.character_name);
    return {
      text: `🜁 Omen (unfavorable): ${p.character_name}'s level timer is extended. Next level in ${durationIt(ns)}.`,
      tone: 'loss',
    };
  }
  insertRealmEvent(db, 'omen_rare', p.character_name);
  return {
    text: `🜁 Omen (rare): ${p.character_name} is inscribed in the realm chronicle.`,
    tone: 'gain',
  };
}

/** True if !omen would run (read-only; does not consume cooldown or roll). */
export function omenHintEligible(
  db: Database,
  ircNick: string,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
): boolean {
  const p = findOnlineByNickCi(db, ircNick);
  if (!p || !p.irc_nick) return false;
  const raw = p.irc_nick.replace(/^@|%|\+/, '');
  let seen = false;
  for (const n of channelNicks) {
    if (caseEq(n, raw)) {
      seen = true;
      break;
    }
  }
  if (!seen) return false;
  const now = Math.floor(Date.now() / 1000);
  const key = `${OMEN_META_PREFIX}${p.id}`;
  const last = metaGetInt(db, key) ?? 0;
  return !(last > 0 && now - last < OMEN_COOLDOWN_SEC);
}
