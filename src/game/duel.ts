import type Database from 'better-sqlite3';
import type { PlayerRow } from '../db/index.js';
import { findOnlineByNickCi, insertRealmEvent, metaGetInt, metaSetInt } from '../db/index.js';
import { durationIt } from './duration.js';
import { ircNickInChannel } from './irc-presence.js';
import { medalsAfterDuelWin } from './medals.js';

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
  const wShort = winner.class.trim().split(/\s+/)[0] || 'hero';
  const lShort = loser.class.trim().split(/\s+/)[0] || 'hero';
  const critTag = crit ? 'CRITICAL STRIKE — ' : '';
  const pool = [
    `⚔ REALM ARENA · ${critTag}the idle ether tears — ${W} (${wShort} L${winner.level}) uncorks silence like a weapon against ${L} (${lShort} L${loser.level}). The log remembers.`,
    `⚔ REALM ARENA · ${critTag}${W} (${wShort}) slips past ${L}'s guard without a single public line — aura wins.`,
    `⚔ CLASH · ${critTag}${W} (L${winner.level}) out-idles ${L} (L${loser.level}): fought in breath, not keystrokes.`,
    `⚔ ARENA · ${critTag}${L} overextends; ${W} (${wShort}) collects the moment — stillness vs RNG.`,
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
): { err: string } | { lines: string[] } {
  const ini = findOnlineByNickCi(db, initiatorIrcNick);
  const tgt = findOnlineByNickCi(db, targetIrcNick.trim());
  if (!ini) return { err: 'You must be logged in to throw a challenge.' };
  if (!tgt) return { err: 'No logged-in hero holds that IRC nick — check spelling or they are away.' };
  if (ini.id === tgt.id) return { err: 'You cannot duel yourself.' };

  const ircSeen = (p: PlayerRow) => ircNickInChannel(p.irc_nick, channelNicks);

  if (!ircSeen(ini)) return { err: 'Stay visible in the game channel to fight.' };
  if (!ircSeen(tgt)) return { err: 'Your rival must stand in this channel (idle presence, real nick).' };

  const now = Math.floor(Date.now() / 1000);
  const lastInit = metaGetInt(db, `duel_cd_${ini.id}`) ?? 0;
  if (lastInit > 0 && now - lastInit < DUEL_INITIATOR_COOLDOWN_SEC) {
    return {
      err: `You challenged someone recently. Next opening in ${durationIt(DUEL_INITIATOR_COOLDOWN_SEC - (now - lastInit))}.`,
    };
  }
  const pk = duelPairMetaKey(ini.id, tgt.id);
  const lastPair = metaGetInt(db, pk) ?? 0;
  if (lastPair > 0 && now - lastPair < DUEL_PAIR_COOLDOWN_SEC) {
    return {
      err: `This pairing needs more cooldown — ${durationIt(DUEL_PAIR_COOLDOWN_SEC - (now - lastPair))} left.`,
    };
  }

  if (Math.abs(ini.level - tgt.level) > DUEL_MAX_LEVEL_GAP) {
    return { err: `Level gap too cruel — pick someone within ±${DUEL_MAX_LEVEL_GAP} levels.` };
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
  db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(wNs, winner.id);
  db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(lNs, loser.id);

  insertRealmEvent(
    db,
    'duel',
    `${winner.character_name} defeated ${loser.character_name}${crit ? ' (critical)' : ''}`,
  );

  const line1 = pickEpic(winner, loser, crit);
  const line2 = `⚡ Fates: ${winner.character_name} trims the clock (~${durationIt(wNs)}); ${loser.character_name} eats dust (~${durationIt(lNs)}).`;
  const medalLines = medalsAfterDuelWin(db, winner);

  return { lines: [line1, line2, ...medalLines] };
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

  const seen = (p: PlayerRow) => {
    if (!p.irc_nick) return false;
    const raw = p.irc_nick.replace(/^@|%|\+/, '');
    for (const n of channelNicks) {
      if (caseEq(n, raw)) return true;
    }
    return false;
  };

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
