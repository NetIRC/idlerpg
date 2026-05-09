/** PvE gauntlet trial flow, rewards/penalties, and eligibility helpers. */

import type Database from 'better-sqlite3';
import type { PlayerRow } from '../db/index.js';
import { findOnlineByNickCi, insertRealmEvent, metaGetInt, metaSetInt } from '../db/index.js';
import { durationIt } from './duration.js';
import { ircNickInChannel, ircNickInChannelWithCase } from './irc-presence.js';
import { grantMedal } from './medals.js';
import type { GameAnnouncement } from './announce.js';

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
): { err: string } | { announcements: GameAnnouncement[] } {
  const p = findOnlineByNickCi(db, ircNick);
  if (!p) return { err: 'Log in first. The Gauntlet requires an active session.' };
  const seen = ircNickInChannel(p.irc_nick, channelNicks);
  if (!seen) return { err: 'Stand in the game channel; the Gauntlet only runs while you are present.' };

  const now = Math.floor(Date.now() / 1000);
  const cdKey = `gauntlet_cd_${p.id}`;
  const last = metaGetInt(db, cdKey) ?? 0;
  if (last > 0 && now - last < GAUNTLET_COOLDOWN_SEC) {
    return {
      err: `Gauntlet on cooldown. Available again in ${durationIt(GAUNTLET_COOLDOWN_SEC - (now - last))}.`,
    };
  }
  metaSetInt(db, cdKey, now);

  const sh = shadowPower(p.level);
  const h = heroGauntletPower(p);
  const epic = Math.random() < 1 / 8;
  const win = h >= sh || (epic && Math.random() < 0.35);

  const announcements: GameAnnouncement[] = [];
  const name = p.character_name;
  const cls = p.class.trim() || 'hero';

  if (win) {
    const mult = epic ? 0.982 : 0.99;
    const ns = Math.max(40, p.next_seconds * mult);
    const gain = Math.max(0, p.next_seconds - ns);
    db.prepare('UPDATE players SET next_seconds = ?, idle_streak_sec = 0 WHERE id = ?').run(ns, p.id);
    const gw =
      (
        db.prepare('SELECT gauntlet_wins FROM players WHERE id = ?').get(p.id) as {
          gauntlet_wins: number;
        }
      )?.gauntlet_wins ?? 0;
    const gnext = gw + 1;
    db.prepare('UPDATE players SET gauntlet_wins = ? WHERE id = ?').run(gnext, p.id);

    announcements.push({
      target: 'chan',
      text:
        `◇ Gauntlet — ${name} (${cls}, L${p.level}) clears the trial.` +
        `${epic ? ' Exceptional performance.' : ''} ` +
        `Level timer shortened (-${durationIt(gain)} effective gain) · ` +
        `next level in ${durationIt(ns)} · Gauntlet victories: ${gnext}.`,
      tone: 'gain',
    });
    insertRealmEvent(db, 'gauntlet_win', `${name}${epic ? ' (epic)' : ''}`);
    for (const t of grantMedal(db, p.id, 'gauntlet_shade', name)) {
      announcements.push({ target: 'chan', text: t, tone: 'gain' });
    }
    if (gnext >= 10) {
      for (const t of grantMedal(db, p.id, 'gauntlet_void', name)) {
        announcements.push({ target: 'chan', text: t, tone: 'gain' });
      }
    }
  } else {
    const mult = epic ? 1.012 : 1.005;
    const ns = p.next_seconds * mult;
    const loss = Math.max(0, ns - p.next_seconds);
    db.prepare('UPDATE players SET next_seconds = ?, idle_streak_sec = 0 WHERE id = ?').run(ns, p.id);
    announcements.push({
      target: 'chan',
      text:
        `◇ Gauntlet — ${name} (${cls}) fails the trial. ` +
        `Level timer extended (+${durationIt(loss)} effective loss) · ` +
        `next level in ${durationIt(ns)}. Cooldown active; try again later.`,
      tone: 'loss',
    });
    insertRealmEvent(db, 'gauntlet_lose', name);
  }

  return { announcements };
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
  if (!ircNickInChannelWithCase(p.irc_nick, channelNicks, caseEq)) return false;
  const now = Math.floor(Date.now() / 1000);
  const last = metaGetInt(db, `gauntlet_cd_${p.id}`) ?? 0;
  return !(last > 0 && now - last < GAUNTLET_COOLDOWN_SEC);
}
