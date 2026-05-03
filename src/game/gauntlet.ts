import type Database from 'better-sqlite3';
import type { PlayerRow } from '../db/index.js';
import { findOnlineByNickCi, insertRealmEvent, metaGetInt, metaSetInt } from '../db/index.js';
import { durationIt } from './duration.js';
import { ircNickInChannel } from './irc-presence.js';
import { grantMedal } from './medals.js';

export const GAUNTLET_COOLDOWN_SEC = 16 * 3600;

function shadowPower(level: number): number {
  return level * 13 + 18 + Math.random() * 40;
}

function heroGauntletPower(p: PlayerRow): number {
  let x = p.level * 12 + 24;
  const a = (p.alignment || 'n').trim().toLowerCase();
  if (a === 'e') x *= 1.07;
  else if (a === 'g') x *= 1.05;
  else x *= 1.03;
  if ((p.trinket ?? '').trim()) x *= 1.04;
  return x * (0.9 + Math.random() * 0.22);
}

export function runGauntlet(
  db: Database,
  ircNick: string,
  channelNicks: Set<string>,
): { err: string } | { lines: string[] } {
  const p = findOnlineByNickCi(db, ircNick);
  if (!p) return { err: 'Log in first — the Gauntlet demands a named hero.' };
  const seen = ircNickInChannel(p.irc_nick, channelNicks);
  if (!seen) return { err: 'Stand in the game channel — the shadow only manifests there.' };

  const now = Math.floor(Date.now() / 1000);
  const cdKey = `gauntlet_cd_${p.id}`;
  const last = metaGetInt(db, cdKey) ?? 0;
  if (last > 0 && now - last < GAUNTLET_COOLDOWN_SEC) {
    return {
      err: `The veil reforms slowly. Gauntlet again in ${durationIt(GAUNTLET_COOLDOWN_SEC - (now - last))}.`,
    };
  }
  metaSetInt(db, cdKey, now);

  const sh = shadowPower(p.level);
  const h = heroGauntletPower(p);
  const epic = Math.random() < 1 / 8;
  const win = h >= sh || (epic && Math.random() < 0.35);

  const lines: string[] = [];
  const name = p.character_name;
  const cls = p.class.trim().split(/\s+/)[0] || 'hero';

  if (win) {
    const mult = epic ? 0.982 : 0.99;
    const ns = Math.max(40, p.next_seconds * mult);
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, p.id);
    const gw =
      (
        db.prepare('SELECT gauntlet_wins FROM players WHERE id = ?').get(p.id) as {
          gauntlet_wins: number;
        }
      )?.gauntlet_wins ?? 0;
    const gnext = gw + 1;
    db.prepare('UPDATE players SET gauntlet_wins = ? WHERE id = ?').run(gnext, p.id);

    lines.push(
      `◇ GAUNTLET · ${name} (${cls} L${p.level}) strikes the Shadow of the Realm — silence answers violence. ${epic ? 'MYTHIC RIPOSTE! ' : ''}The clock yields.`,
    );
    lines.push(`⚡ ${name} cuts toward next level (~${durationIt(ns)}). Gauntlet wins: ${gnext}.`);
    insertRealmEvent(db, 'gauntlet_win', `${name}${epic ? ' (epic)' : ''}`);
    lines.push(...grantMedal(db, p.id, 'gauntlet_shade', name));
    if (gnext >= 10) lines.push(...grantMedal(db, p.id, 'gauntlet_void', name));
  } else {
    const mult = epic ? 1.012 : 1.005;
    const ns = p.next_seconds * mult;
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, p.id);
    lines.push(
      `◇ GAUNTLET · The Shadow overwhelms ${name} (${cls}) — a lesson in hubris etched in lag.`,
    );
    lines.push(`⚡ ${name} staggers (~${durationIt(ns)} to next level). Train silence; return.`);
    insertRealmEvent(db, 'gauntlet_lose', name);
  }

  return { lines };
}

/** True if !gauntlet would start (read-only; does not set cooldown). */
export function gauntletHintEligible(
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
  const last = metaGetInt(db, `gauntlet_cd_${p.id}`) ?? 0;
  return !(last > 0 && now - last < GAUNTLET_COOLDOWN_SEC);
}
