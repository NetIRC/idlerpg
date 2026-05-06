/** Contextual channel tips for register/login and available gameplay commands. */

import type Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import type { PlayerRow } from '../db/index.js';
import { findLoggedOutByIrcNickCi, findOnlineByNickCi } from '../db/index.js';
import { omenHintEligible } from './chronicle-omen.js';
import { pickDuelHintFoe } from './duel.js';
import { gauntletHintEligible } from './gauntlet.js';
import { ircNickInChannelWithCase } from './irc-presence.js';

function visibleInChannel(
  p: PlayerRow,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
): boolean {
  return ircNickInChannelWithCase(p.irc_nick, channelNicks, caseEq);
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

const GENERIC_TIPS = [
  '!time — next level countdown (!commands skip level-timer penalty).',
  '!whoami — active character on this IRC nick.',
  '!stats [name] — level, class, alignment, level timer.',
  '!realm — online count, quest, lucky hour, realm peak.',
  '!chronicle — latest realm events.',
  '!records — standings and realm record.',
  '!quest — party quest status.',
  '!medals — duel, quest, gauntlet, milestone badges.',
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
    tips.push('!omen — long cooldown; may change your level timer.');
  }
  if (gauntletHintEligible(db, nick, channelNicks, caseEq)) {
    tips.push('!gauntlet — solo trial (long cooldown after a run).');
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
        body: `Character "${loggedOut.character_name}" is linked to this nick. Stay in ${ch} and PM LOGIN ${loggedOut.character_name} <password>.`,
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
        body: `No character linked to this nick. While in ${cfg.ircChannel}, PM REGISTER <name> <password> <class...>. See !rules. Public !commands never add level-timer penalty.`,
      };
    }

    if (online && visibleInChannel(online, channelNicks, caseEq)) {
      return { nick, body: randomOnlineTipBody(db, nick, channelNicks, caseEq) };
    }
  }

  return null;
}
