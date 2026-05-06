/** PvP duel resolution, cooldown enforcement, and duel hint targeting. */

import type Database from 'better-sqlite3';
import { formatDuelTimers } from '../irc/channel-style.js';
import type { PlayerRow } from '../db/index.js';
import { findOnlineByNickCi, insertRealmEvent, metaGetInt, metaSetInt } from '../db/index.js';
import { durationIt } from './duration.js';
import { ircNickInChannel, ircNickInChannelWithCase } from './irc-presence.js';
import { medalsAfterDuelWin } from './medals.js';
import type { GameAnnouncement } from './announce.js';

/** Challenger cooldown (seconds). */
export const DUEL_INITIATOR_COOLDOWN_SEC = 5 * 3600;
/** Same pair cannot duel again this soon. */
export const DUEL_PAIR_COOLDOWN_SEC = 20 * 3600;
export const DUEL_MAX_LEVEL_GAP = 11;

export function duelPairMetaKey(idA: number, idB: number): string {
  const lo = Math.min(idA, idB);
  const hi = Math.max(idA, idB);
  return `duel_pair_${lo}_${hi}`;
}

function combatPower(p: PlayerRow): number {
  let x = p.level * 11 + 22;
  const a = (p.alignment || 'n').trim().toLowerCase();
  if (a === 'e') x *= 1.09;
  else if (a === 'g') x *= 1.06;
  else x *= 1.04;
  if ((p.trinket ?? '').trim()) x *= 1.035;
  return x * (0.88 + Math.random() * 0.26);
}

function pickEpic(winner: PlayerRow, loser: PlayerRow, crit: boolean): string {
  const W = winner.character_name;
  const L = loser.character_name;
  const wClass = winner.class.trim() || 'hero';
  const lClass = loser.class.trim() || 'hero';
  const critNote = crit ? 'Critical strike — ' : '';
  const pool = [
    `⚔ Duel — ${critNote}${W} (${wClass}, L${winner.level}) defeats ${L} (${lClass}, L${loser.level}) in the arena.`,
    `⚔ Duel — ${critNote}${W} (${wClass}) prevails over ${L} (L${loser.level}). Outcome applied to level timers.`,
    `⚔ Duel — ${critNote}${W}, L${winner.level}, outlasts ${L}, L${loser.level}. ${wClass} vs ${lClass}.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * In-channel duel: both logged in, both nicks present in channel.
 * Initiator pays cooldown; pair shares longer debuff.
 */
export function runDuel(
  db: Database,
  initiatorIrcNick: string,
  targetIrcNick: string,
  channelNicks: Set<string>,
): { err: string } | { announcements: GameAnnouncement[] } {
  const ini = findOnlineByNickCi(db, initiatorIrcNick);
  const tgt = findOnlineByNickCi(db, targetIrcNick.trim());
  if (!ini) return { err: 'You must be logged in to issue a duel challenge.' };
  if (!tgt)
    return { err: 'No logged-in character matches that IRC nick. Check spelling or try when they are present.' };
  if (ini.id === tgt.id) return { err: 'You cannot duel your own character.' };

  const ircSeen = (p: PlayerRow) => ircNickInChannel(p.irc_nick, channelNicks);

  if (!ircSeen(ini)) return { err: 'Remain in the game channel with visible presence to use the duel command.' };
  if (!ircSeen(tgt)) return { err: 'Your opponent must be in this channel with visible presence (logged in).' };

  const now = Math.floor(Date.now() / 1000);
  const lastInit = metaGetInt(db, `duel_cd_${ini.id}`) ?? 0;
  if (lastInit > 0 && now - lastInit < DUEL_INITIATOR_COOLDOWN_SEC) {
    return {
      err: `You are on duel cooldown. Next challenge allowed in ${durationIt(DUEL_INITIATOR_COOLDOWN_SEC - (now - lastInit))}.`,
    };
  }
  const pk = duelPairMetaKey(ini.id, tgt.id);
  const lastPair = metaGetInt(db, pk) ?? 0;
  if (lastPair > 0 && now - lastPair < DUEL_PAIR_COOLDOWN_SEC) {
    return {
      err: `This pairing is on cooldown. Try again in ${durationIt(DUEL_PAIR_COOLDOWN_SEC - (now - lastPair))}.`,
    };
  }

  if (Math.abs(ini.level - tgt.level) > DUEL_MAX_LEVEL_GAP) {
    return {
      err: `Level difference too large. Choose an opponent within ±${DUEL_MAX_LEVEL_GAP} levels of your character.`,
    };
  }

  let a = combatPower(ini);
  let b = combatPower(tgt);
  if (Math.abs(a - b) < 1) {
    a = combatPower(ini);
    b = combatPower(tgt);
  }

  const crit = Math.random() < 1 / 10;
  let winner: PlayerRow;
  let loser: PlayerRow;
  if (a >= b) {
    winner = ini;
    loser = tgt;
  } else {
    winner = tgt;
    loser = ini;
  }

  metaSetInt(db, `duel_cd_${ini.id}`, now);
  metaSetInt(db, pk, now);

  let winMult = 0.992;
  let loseMult = 1.006;
  if (crit) {
    winMult = 0.985;
    loseMult = 1.014;
  }

  const wNs = Math.max(45, winner.next_seconds * winMult);
  const lNs = Math.max(45, loser.next_seconds * loseMult);
  const winDelta = Math.max(0, winner.next_seconds - wNs);
  const loseDelta = Math.max(0, lNs - loser.next_seconds);
  db.prepare('UPDATE players SET next_seconds = ?, idle_streak_sec = 0 WHERE id = ?').run(wNs, winner.id);
  db.prepare('UPDATE players SET next_seconds = ?, idle_streak_sec = 0 WHERE id = ?').run(lNs, loser.id);

  insertRealmEvent(
    db,
    'duel',
    `${winner.character_name} defeated ${loser.character_name}${crit ? ' (critical)' : ''}`,
  );

  const line1 = pickEpic(winner, loser, crit);
  const line2 = formatDuelTimers(
    winner.character_name,
    loser.character_name,
    durationIt(winDelta),
    durationIt(loseDelta),
    durationIt(wNs),
    durationIt(lNs),
  );
  const medalLines = medalsAfterDuelWin(db, winner);

  const announcements: GameAnnouncement[] = [
    { target: 'chan', text: line1 },
    { target: 'chan', text: line2, preStyled: true },
    ...medalLines.map((text) => ({ target: 'chan' as const, text, tone: 'gain' as const })),
  ];

  return { announcements };
}

/**
 * If a duel suggestion is valid right now, return a foe's IRC nick (read-only; does not run a duel).
 */
export function pickDuelHintFoe(
  db: Database,
  initiatorIrcNick: string,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
): string | null {
  const ini = findOnlineByNickCi(db, initiatorIrcNick);
  if (!ini) return null;

  const seen = (p: PlayerRow) => ircNickInChannelWithCase(p.irc_nick, channelNicks, caseEq);

  if (!seen(ini)) return null;

  const now = Math.floor(Date.now() / 1000);
  const lastInit = metaGetInt(db, `duel_cd_${ini.id}`) ?? 0;
  if (lastInit > 0 && now - lastInit < DUEL_INITIATOR_COOLDOWN_SEC) return null;

  const others = db.prepare(`SELECT * FROM players WHERE online = 1 AND id != ?`).all(ini.id) as PlayerRow[];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j]!, others[i]!];
  }

  for (const tgt of others) {
    if (!seen(tgt) || !tgt.irc_nick) continue;
    if (Math.abs(ini.level - tgt.level) > DUEL_MAX_LEVEL_GAP) continue;
    const pk = duelPairMetaKey(ini.id, tgt.id);
    const lastPair = metaGetInt(db, pk) ?? 0;
    if (lastPair > 0 && now - lastPair < DUEL_PAIR_COOLDOWN_SEC) continue;
    return tgt.irc_nick;
  }
  return null;
}
