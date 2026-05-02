import type Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import type { PlayerRow } from '../db/index.js';
import { insertRealmEvent, metaGetInt, metaGetText, metaSetInt, metaSetText } from '../db/index.js';
import { durationIt } from './duration.js';

type Ann = { target: 'chan' | 'notice'; nick?: string; text: string };

const MK_QUEST_ACTIVE = 'quest_active';
const MK_QUEST_ENDS = 'quest_ends_at';
const MK_QUEST_T0 = 'quest_t0';
const MK_QUEST_T1 = 'quest_t1';
const MK_QUEST_TEAMS = 'quest_teams_json';
const MK_QUEST_NEXT = 'quest_next_at';
const MK_LUCKY_UNTIL = 'lucky_until';
const MK_LUCKY_CHECK = 'lucky_check_at';

const TEAM_NAMES = ['Sunbound', 'Moonveil'];

export function hogChanceMultiplier(db: Database, nowSec: number): number {
  const until = metaGetInt(db, MK_LUCKY_UNTIL) ?? 0;
  return nowSec < until ? 3 : 1;
}

export function realmTick(db: Database, cfg: AppConfig, channelNicks: Set<string>, now: number, an: Ann[]): void {
  if (cfg.questEnabled) {
    const active = (metaGetInt(db, MK_QUEST_ACTIVE) ?? 0) === 1;
    if (active) {
      const ends = metaGetInt(db, MK_QUEST_ENDS) ?? 0;
      if (now >= ends) {
        finishQuest(db, cfg, channelNicks, an);
      } else {
        tickQuestScores(db, channelNicks);
      }
    } else {
      tryStartQuest(db, cfg, channelNicks, now, an, false);
    }
  }
  if (cfg.luckyHourEnabled) {
    maybeLuckyHour(db, cfg, now, an);
  }
}

function questActive(db: Database): boolean {
  return (metaGetInt(db, MK_QUEST_ACTIVE) ?? 0) === 1;
}

function tickQuestScores(db: Database, channelNicks: Set<string>): void {
  const raw = metaGetText(db, MK_QUEST_TEAMS);
  if (!raw) return;
  let teams: Record<string, number>;
  try {
    teams = JSON.parse(raw) as Record<string, number>;
  } catch {
    return;
  }
  const online = db.prepare('SELECT * FROM players WHERE online = 1').all() as PlayerRow[];
  for (const p of online) {
    if (!p.irc_nick || !channelNicks.has(p.irc_nick)) continue;
    const t = teams[p.character_name];
    if (t !== 0 && t !== 1) continue;
    const key = t === 0 ? MK_QUEST_T0 : MK_QUEST_T1;
    const cur = metaGetInt(db, key) ?? 0;
    metaSetInt(db, key, cur + Math.max(1, p.level));
  }
}

function tryStartQuest(
  db: Database,
  cfg: AppConfig,
  channelNicks: Set<string>,
  now: number,
  an: Ann[],
  force: boolean,
): void {
  if (questActive(db)) return;
  if (!force) {
    let nextAt = metaGetInt(db, MK_QUEST_NEXT);
    if (nextAt === null || nextAt === 0) {
      nextAt = now + 90 + Math.floor(Math.random() * 120);
      metaSetInt(db, MK_QUEST_NEXT, nextAt);
    }
    if (now < nextAt) return;
    if (Math.random() > cfg.questStartChance) return;
  }

  const candidates = (
    db.prepare('SELECT * FROM players WHERE online = 1').all() as PlayerRow[]
  ).filter((p) => p.irc_nick && channelNicks.has(p.irc_nick));
  if (candidates.length < cfg.questMinPlayers) {
    if (!force) {
      metaSetInt(db, MK_QUEST_NEXT, now + Math.min(600, Math.floor(cfg.questCooldownSec / 3)));
    }
    return;
  }

  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const teams: Record<string, number> = {};
  shuffled.forEach((p, i) => {
    teams[p.character_name] = i < Math.ceil(shuffled.length / 2) ? 0 : 1;
  });

  metaSetInt(db, MK_QUEST_T0, 0);
  metaSetInt(db, MK_QUEST_T1, 0);
  metaSetText(db, MK_QUEST_TEAMS, JSON.stringify(teams));
  metaSetInt(db, MK_QUEST_ENDS, now + cfg.questDurationSec);
  metaSetInt(db, MK_QUEST_ACTIVE, 1);

  const n0 = shuffled.filter((p) => teams[p.character_name] === 0).map((p) => p.character_name);
  const n1 = shuffled.filter((p) => teams[p.character_name] === 1).map((p) => p.character_name);
  const d = durationIt(cfg.questDurationSec);
  an.push({
    target: 'chan',
    text: `⚔ QUEST: ${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]} — ${n0.join(', ')} |vs| ${n1.join(', ')}. Scores grow from levels while you idle in channel. Ends in ${d}.`,
  });
  insertRealmEvent(db, 'quest_start', `${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]}`);
}

function finishQuest(db: Database, cfg: AppConfig, channelNicks: Set<string>, an: Ann[]): void {
  const raw = metaGetText(db, MK_QUEST_TEAMS);
  let teams: Record<string, number> = {};
  if (raw) {
    try {
      teams = JSON.parse(raw) as Record<string, number>;
    } catch {
      teams = {};
    }
  }
  const s0 = metaGetInt(db, MK_QUEST_T0) ?? 0;
  const s1 = metaGetInt(db, MK_QUEST_T1) ?? 0;
  const winner = s0 === s1 ? (Math.random() < 0.5 ? 0 : 1) : s0 > s1 ? 0 : 1;

  const bonusWin = Math.min(
    cfg.limitpen > 0 ? cfg.limitpen : Number.MAX_SAFE_INTEGER,
    Math.max(30, Math.floor(cfg.rpbase * cfg.questWinnerBonusMult)),
  );
  const penLose = Math.max(20, Math.floor(cfg.rpbase * cfg.questLoserPenaltyMult));

  const winners: string[] = [];
  const losers: string[] = [];
  for (const [charName, team] of Object.entries(teams)) {
    const p = findByCharacterName(db, charName, cfg.caseSensitiveNames);
    if (!p || !p.online) continue;
    if (!p.irc_nick || !channelNicks.has(p.irc_nick)) continue;
    if (team === winner) winners.push(charName);
    else losers.push(charName);
  }

  const winName = TEAM_NAMES[winner];
  const loseName = TEAM_NAMES[1 - winner];

  for (const name of winners) {
    const p = findByCharacterName(db, name, cfg.caseSensitiveNames);
    if (!p) continue;
    const nn = Math.max(1, p.next_seconds - bonusWin);
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(nn, p.id);
  }
  for (const name of losers) {
    const p = findByCharacterName(db, name, cfg.caseSensitiveNames);
    if (!p) continue;
    db.prepare('UPDATE players SET pen_quest = pen_quest + ?, next_seconds = next_seconds + ? WHERE id = ?').run(
      penLose,
      penLose,
      p.id,
    );
  }

  an.push({
    target: 'chan',
    text: `⚔ QUEST END: ${winName} wins (${s0} vs ${s1}) over ${loseName}. Winners −${durationIt(bonusWin)}; losers +${durationIt(penLose)} quest tax.`,
  });
  insertRealmEvent(db, 'quest_end', `${winName} wins ${s0}-${s1}`);

  metaSetInt(db, MK_QUEST_ACTIVE, 0);
  metaSetText(db, MK_QUEST_TEAMS, null);
  metaSetInt(db, MK_QUEST_T0, 0);
  metaSetInt(db, MK_QUEST_T1, 0);
  const now = Math.floor(Date.now() / 1000);
  metaSetInt(
    db,
    MK_QUEST_NEXT,
    now + cfg.questCooldownSec + Math.floor(Math.random() * 420),
  );
}

function findByCharacterName(db: Database, name: string, caseSensitive: boolean): PlayerRow | undefined {
  const sql = caseSensitive
    ? 'SELECT * FROM players WHERE character_name = ?'
    : 'SELECT * FROM players WHERE character_name COLLATE NOCASE = ?';
  return db.prepare(sql).get(name) as PlayerRow | undefined;
}

function maybeLuckyHour(db: Database, cfg: AppConfig, now: number, an: Ann[]): void {
  const last = metaGetInt(db, MK_LUCKY_CHECK) ?? 0;
  if (now - last < 100) return;
  metaSetInt(db, MK_LUCKY_CHECK, now);
  const until = metaGetInt(db, MK_LUCKY_UNTIL) ?? 0;
  if (now < until) return;
  if (Math.random() > cfg.luckyHourRollChance) return;
  const dur = cfg.luckyHourDurationSec + Math.floor(Math.random() * 240);
  metaSetInt(db, MK_LUCKY_UNTIL, now + dur);
  an.push({
    target: 'chan',
    text: `✦ LUCKY HOUR: the realm hums — Hand-of-God odds triple for ${durationIt(dur)}.`,
  });
  insertRealmEvent(db, 'lucky_hour', `duration ${dur}s`);
}

export function questPublicLine(db: Database, cfg: AppConfig): string {
  if (!(metaGetInt(db, MK_QUEST_ACTIVE) ?? 0)) {
    return 'No quest in progress. Skirmishes start when enough players idle in channel.';
  }
  const ends = metaGetInt(db, MK_QUEST_ENDS) ?? 0;
  const now = Math.floor(Date.now() / 1000);
  const left = Math.max(0, ends - now);
  const s0 = metaGetInt(db, MK_QUEST_T0) ?? 0;
  const s1 = metaGetInt(db, MK_QUEST_T1) ?? 0;
  return `Quest: ${TEAM_NAMES[0]} ${s0} vs ${TEAM_NAMES[1]} ${s1} — ${durationIt(left)} left. Idle in channel to score for your band.`;
}

export function realmRecordsLine(db: Database): string {
  const lv = metaGetInt(db, 'realm_record_level');
  const name = metaGetText(db, 'realm_record_name');
  if (!lv || !name) return 'No realm record set yet — first to climb highest wins the mural.';
  return `Realm record: ${name} reached level ${lv} (all-time high).`;
}

export function checkNewRealmRecord(
  db: Database,
  charName: string,
  level: number,
  playerId: number,
  an: { target: 'chan' | 'notice'; nick?: string; text: string }[],
): void {
  const maxOther = db
    .prepare('SELECT MAX(level) AS m FROM players WHERE id != ?')
    .get(playerId) as { m: number | null };
  const prevMax = maxOther?.m ?? 0;
  if (level <= prevMax) return;
  if (prevMax < 1 && level < 5) return;
  metaSetInt(db, 'realm_record_level', level);
  metaSetText(db, 'realm_record_name', charName);
  an.push({
    target: 'chan',
    text: `◆ REALM RECORD: ${charName} is now the highest level in the realm at ${level}.`,
  });
  insertRealmEvent(db, 'realm_record', `${charName} L${level}`);
}

export function grantMilestoneTrinket(db: Database, playerId: number): string | null {
  if (Math.random() > 0.4) return null;
  const row = db.prepare('SELECT trinket FROM players WHERE id = ?').get(playerId) as { trinket: string } | undefined;
  if (!row) return null;
  if (row.trinket) return null;
  const pool = [
    'Copper Pocketwatch',
    'Ivory Dice',
    'Echo Shard',
    'Quiet Coin',
    'Lagward Charm',
    'Stillstone Ring',
    'Wire-Bent Luck',
    'Dusty Medallion',
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  db.prepare(`UPDATE players SET trinket = ? WHERE id = ? AND (trinket = '' OR trinket IS NULL)`).run(pick, playerId);
  const verify = db.prepare('SELECT trinket FROM players WHERE id = ?').get(playerId) as { trinket: string };
  return verify?.trinket === pick ? pick : null;
}

export function nudgeAlignmentAfterHog(db: Database, p: PlayerRow, won: boolean): void {
  if (Math.random() > 0.22) return;
  let a = (p.alignment || 'n').trim().toLowerCase();
  if (won) {
    if (a === 'e') a = 'n';
    else if (a === 'n') a = 'g';
  } else {
    if (a === 'g') a = 'n';
    else if (a === 'n') a = 'e';
  }
  db.prepare('UPDATE players SET alignment = ? WHERE id = ?').run(a, p.id);
}

export function adminForceLogout(db: Database, characterName: string, caseSensitive: boolean): { ok: true } | { err: string } {
  const p = findByCharacterName(db, characterName.trim(), caseSensitive);
  if (!p) return { err: 'No such character.' };
  if (!p.online) return { err: 'Character not online.' };
  db.prepare('UPDATE players SET online = 0, session_open = 0 WHERE id = ?').run(p.id);
  insertRealmEvent(db, 'admin_forcelogout', characterName.trim());
  return { ok: true };
}

export function adminForceStartQuest(
  db: Database,
  cfg: AppConfig,
  channelNicks: Set<string>,
  an: Ann[],
): { ok: true } | { err: string } {
  if (!cfg.questEnabled) return { err: 'Quests disabled in config.' };
  if ((metaGetInt(db, MK_QUEST_ACTIVE) ?? 0) === 1) return { err: 'A quest is already running.' };
  const now = Math.floor(Date.now() / 1000);
  tryStartQuest(db, cfg, channelNicks, now, an, true);
  if ((metaGetInt(db, MK_QUEST_ACTIVE) ?? 0) !== 1) {
    return { err: 'Not enough players in channel for a quest.' };
  }
  return { ok: true };
}

export function adminForceLucky(db: Database, cfg: AppConfig, an: Ann[]): void {
  if (!cfg.luckyHourEnabled) return;
  const now = Math.floor(Date.now() / 1000);
  metaSetInt(db, MK_LUCKY_UNTIL, now + cfg.luckyHourDurationSec);
  an.push({
    target: 'chan',
    text: `✦ LUCKY HOUR (staff): Hand-of-God odds triple for ${durationIt(cfg.luckyHourDurationSec)}.`,
  });
  insertRealmEvent(db, 'lucky_hour_admin', '');
}
