/** Medal definitions and helpers for level/duel/gauntlet/quest achievements. */

import type Database from 'better-sqlite3';
import { insertRealmEvent } from '../db/index.js';
import type { PlayerRow } from '../db/index.js';

/** Cosmetic medals + light progression hooks (SQLite `player_medals`). */
export const MEDAL_DEF: Record<
  string,
  { label: string; tier: string; fanfare: string }
> = {
  quest_crest: {
    label: 'Quest Crest',
    tier: 'silver',
    fanfare: 'etched a Quest Crest — their band claimed the skirmish.',
  },
  first_duel: {
    label: 'First Blood',
    tier: 'bronze',
    fanfare: 'earned First Blood in the arena.',
  },
  duel_blade_5: {
    label: 'Fivefold Blade',
    tier: 'silver',
    fanfare: 'was awarded Fivefold Blade — five duel victories.',
  },
  duel_blade_15: {
    label: 'Fifteen Strikes',
    tier: 'gold',
    fanfare: 'unlocks Fifteen Strikes — duel dominance recognized.',
  },
  gauntlet_shade: {
    label: 'Shade Walker',
    tier: 'bronze',
    fanfare: 'claims the Shade Walker medal (first shadow trial survived).',
  },
  gauntlet_void: {
    label: 'Void Dancer',
    tier: 'gold',
    fanfare: 'mastered ten shadow trials — Void Dancer.',
  },
  ascendant_10: { label: 'Ascendant X', tier: 'bronze', fanfare: 'rose past level 10.' },
  storm_25: { label: 'Storm of Stillness', tier: 'silver', fanfare: 'broke level 25.' },
  myth_idle_50: { label: 'Myth-Idle', tier: 'gold', fanfare: 'crossed level 50 — Myth-Idle.' },
  century_100: { label: 'Century Mark', tier: 'mythic', fanfare: 'hit level 100 — Century Mark.' },
};

/** Optional: level medals use this so a late DB row (already past the tier) doesn’t sound like “you are level 10”. */
export type GrantMedalOpts = {
  milestoneAt?: number;
  levelNow?: number;
};

export function grantMedal(
  db: Database,
  playerId: number,
  key: string,
  charName: string,
  opts?: GrantMedalOpts,
): string[] {
  const def = MEDAL_DEF[key];
  if (!def) return [];
  const now = Math.floor(Date.now() / 1000);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO player_medals (player_id, medal_key, ts) VALUES (?, ?, ?)`,
  );
  const info = ins.run(playerId, key, now);
  if (info.changes === 0) return [];
  insertRealmEvent(db, 'medal', `${charName}: ${def.label}`);
  const milestoneAt = opts?.milestoneAt;
  const levelNow = opts?.levelNow;
  const late =
    milestoneAt != null && levelNow != null && levelNow > milestoneAt;
  if (late) {
    return [
      `🏅 ${charName} earned ${def.label} — milestone for passing level ${milestoneAt} (recorded now at L${levelNow}).`,
    ];
  }
  return [`🏅 ${charName} ${def.fanfare}`];
}

export function listMedalKeys(db: Database, playerId: number): string[] {
  const rows = db
    .prepare(
      `SELECT medal_key FROM player_medals WHERE player_id = ? ORDER BY ts ASC`,
    )
    .all(playerId) as { medal_key: string }[];
  return rows.map((r) => r.medal_key);
}

export function medalsDisplayLine(db: Database, p: PlayerRow): string {
  const keys = listMedalKeys(db, p.id);
  if (!keys.length)
    return `${p.character_name}: no medals yet — duels, quests, gauntlet, and level milestones fill this list.`;
  const labels = keys.map((k) => MEDAL_DEF[k]?.label ?? k).join(' · ');
  const dw = p.duel_wins ?? 0;
  const gw = p.gauntlet_wins ?? 0;
  return `${p.character_name}: ${keys.length} medal(s) · ${labels} · duel wins ${dw} · gauntlet ${gw}`;
}

/** After any level-up step (may fire multiple times per tick). */
export function medalsForLevel(db: Database, p: PlayerRow, newLevel: number): string[] {
  const lines: string[] = [];
  if (newLevel >= 10)
    lines.push(
      ...grantMedal(db, p.id, 'ascendant_10', p.character_name, { milestoneAt: 10, levelNow: newLevel }),
    );
  if (newLevel >= 25)
    lines.push(
      ...grantMedal(db, p.id, 'storm_25', p.character_name, { milestoneAt: 25, levelNow: newLevel }),
    );
  if (newLevel >= 50)
    lines.push(
      ...grantMedal(db, p.id, 'myth_idle_50', p.character_name, { milestoneAt: 50, levelNow: newLevel }),
    );
  if (newLevel >= 100)
    lines.push(
      ...grantMedal(db, p.id, 'century_100', p.character_name, { milestoneAt: 100, levelNow: newLevel }),
    );
  return lines;
}

export function medalsAfterDuelWin(db: Database, winner: PlayerRow): string[] {
  const cur =
    (db.prepare('SELECT duel_wins FROM players WHERE id = ?').get(winner.id) as { duel_wins: number })
      ?.duel_wins ?? 0;
  const next = cur + 1;
  db.prepare('UPDATE players SET duel_wins = ? WHERE id = ?').run(next, winner.id);
  const lines: string[] = [];
  if (next === 1) lines.push(...grantMedal(db, winner.id, 'first_duel', winner.character_name));
  if (next >= 5) lines.push(...grantMedal(db, winner.id, 'duel_blade_5', winner.character_name));
  if (next >= 15) lines.push(...grantMedal(db, winner.id, 'duel_blade_15', winner.character_name));
  return lines;
}

export function grantQuestCrest(db: Database, playerId: number, charName: string): string[] {
  return grantMedal(db, playerId, 'quest_crest', charName);
}
