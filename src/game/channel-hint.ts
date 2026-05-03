import type Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import type { PlayerRow } from '../db/index.js';
import { findLoggedOutByIrcNickCi, findOnlineByNickCi } from '../db/index.js';
import { omenHintEligible } from './chronicle-omen.js';
import { pickDuelHintFoe } from './duel.js';
import { gauntletHintEligible } from './gauntlet.js';

function visibleInChannel(
  p: PlayerRow,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
): boolean {
  if (!p.irc_nick) return false;
  const raw = p.irc_nick.replace(/^@|%|\+/, '');
  for (const n of channelNicks) {
    if (caseEq(n, raw)) return true;
  }
  return false;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

const GENERIC_TIPS = [
  '!time — next level countdown (commands skip idle tax).',
  '!whoami — who you are logged in as.',
  '!stats [name] — levels and timers.',
  '!realm — quest, lucky hour, heroes online.',
  '!chronicle — recent realm drama.',
  '!records — standings and highs.',
  '!quest — party quest status.',
  '!medals — arena and gauntlet badges.',
  '!top — leaderboard snippet.',
] as const;

function randomOnlineTipBody(
  db: Database,
  nick: string,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
): string {
  const tips: string[] = [...GENERIC_TIPS];
  if (omenHintEligible(db, nick, channelNicks, caseEq)) {
    tips.push('!omen — consult fate (long cooldown; may shift your timer).');
  }
  if (gauntletHintEligible(db, nick, channelNicks, caseEq)) {
    tips.push('!gauntlet — solo shadow run (long cooldown afterwards).');
  }
  const foe = pickDuelHintFoe(db, nick, channelNicks, caseEq);
  if (foe) {
    tips.push(`!duel ${foe} — in range and off cooldowns; both of you are here.`);
  }
  return tips[Math.floor(Math.random() * tips.length)]!;
}

/**
 * Picks someone in channel (not the bot) and a tip they can act on right now.
 * Returns null if nobody qualifies (e.g. only the bot is present).
 */
export function pickChannelHint(
  db: Database,
  cfg: AppConfig,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
  botIrcNick: string,
): { nick: string; body: string } | null {
  const pool = [...channelNicks].filter((n) => !caseEq(n, botIrcNick));
  if (pool.length === 0) return null;
  shuffleInPlace(pool);

  for (const nick of pool) {
    const online = findOnlineByNickCi(db, nick);
    const loggedOut = online ? undefined : findLoggedOutByIrcNickCi(db, nick);

    if (!online && loggedOut) {
      const ch = cfg.ircChannel;
      return {
        nick,
        body: `Character "${loggedOut.character_name}" matches this nick — PM me LOGIN ${loggedOut.character_name} <password> while you stay in ${ch}.`,
      };
    }

    if (!online && !loggedOut) {
      const susp = db
        .prepare(
          `SELECT 1 AS x FROM players WHERE session_open = 1 AND online = 0 AND irc_nick COLLATE NOCASE = ?`,
        )
        .get(nick) as { x: number } | undefined;
      if (susp) continue;
      return {
        nick,
        body: `No hero on this nick — PM me REGISTER <name> <password> <class…> from here (!rules). !commands never cost idle time.`,
      };
    }

    if (online && visibleInChannel(online, channelNicks, caseEq)) {
      return { nick, body: randomOnlineTipBody(db, nick, channelNicks, caseEq) };
    }
  }

  return null;
}
