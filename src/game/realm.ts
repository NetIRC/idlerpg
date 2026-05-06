/** Realm systems: quests, lucky hour, pulse snapshots, and V3 daily trial. */

import type Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import type { PlayerRow } from '../db/index.js';
import { insertRealmEvent, metaGetInt, metaGetText, metaSetInt, metaSetText } from '../db/index.js';
import { formatQuestEndLine } from '../irc/channel-style.js';
import { durationIt } from './duration.js';
import { ircNickInChannel } from './irc-presence.js';
import { grantQuestCrest } from './medals.js';
import type { GameAnnouncement } from './announce.js';

const MK_QUEST_ACTIVE = 'quest_active';
const MK_QUEST_ENDS = 'quest_ends_at';
const MK_QUEST_T0 = 'quest_t0';
const MK_QUEST_T1 = 'quest_t1';
const MK_QUEST_TEAMS = 'quest_teams_json';
const MK_QUEST_NEXT = 'quest_next_at';
const MK_LUCKY_UNTIL = 'lucky_until';
const MK_LUCKY_CHECK = 'lucky_check_at';
const MK_V3_DAILY_TRIAL_NEXT = 'v3_daily_trial_next';

const TEAM_NAMES = ['Sunbound', 'Moonveil'];

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

export function hogChanceMultiplier(db: Database, nowSec: number): number {
  const until = metaGetInt(db, MK_LUCKY_UNTIL) ?? 0;
  return nowSec < until ? 3 : 1;
}

export function realmTick(db: Database, cfg: AppConfig, channelNicks: Set<string>, now: number, an: GameAnnouncement[]): void {
  const active = (metaGetInt(db, MK_QUEST_ACTIVE) ?? 0) === 1;
  if (!cfg.questEnabled && active) {
    clearQuestState(db, now);
    insertRealmEvent(db, 'quest_end', 'Quest canceled (feature disabled).');
  } else if (cfg.questEnabled) {
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
  if (cfg.v3ModeEnabled && cfg.v3DailyTrialEnabled) {
    maybeDailyTrial(db, cfg, now, channelNicks, an);
  }
}

function clearQuestState(db: Database, now: number): void {
  metaSetInt(db, MK_QUEST_ACTIVE, 0);
  metaSetText(db, MK_QUEST_TEAMS, null);
  metaSetInt(db, MK_QUEST_T0, 0);
  metaSetInt(db, MK_QUEST_T1, 0);
  metaSetInt(db, MK_QUEST_ENDS, 0);
  metaSetInt(db, MK_QUEST_NEXT, now + 600);
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
    if (!p.irc_nick || !ircNickInChannel(p.irc_nick, channelNicks)) continue;
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
  an: GameAnnouncement[],
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
  ).filter((p) => p.irc_nick && ircNickInChannel(p.irc_nick, channelNicks));
  if (candidates.length < cfg.questMinPlayers) {
    if (!force) {
      metaSetInt(db, MK_QUEST_NEXT, now + Math.min(600, Math.floor(cfg.questCooldownSec / 3)));
    }
    return;
  }

  const shuffled = [...candidates];
  shuffleInPlace(shuffled);
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
    text: `⚔ Quest started: ${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]} — ${n0.join(', ')} vs ${n1.join(', ')}. Scoring uses your level while idling in channel. Duration: ${d}.`,
  });
  insertRealmEvent(db, 'quest_start', `${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]}`);
}

function finishQuest(db: Database, cfg: AppConfig, channelNicks: Set<string>, an: GameAnnouncement[]): void {
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
    if (!p.irc_nick || !ircNickInChannel(p.irc_nick, channelNicks)) continue;
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
    for (const line of grantQuestCrest(db, p.id, p.character_name)) {
      an.push({ target: 'chan', text: line, tone: 'gain' });
    }
  }
  for (const name of losers) {
    const p = findByCharacterName(db, name, cfg.caseSensitiveNames);
    if (!p) continue;
    db.prepare(
      'UPDATE players SET pen_quest = pen_quest + ?, next_seconds = next_seconds + ?, idle_streak_sec = 0 WHERE id = ?',
    ).run(
      penLose,
      penLose,
      p.id,
    );
  }

  an.push({
    target: 'chan',
    text: formatQuestEndLine(
      winName,
      loseName,
      s0,
      s1,
      durationIt(bonusWin),
      durationIt(penLose),
    ),
    preStyled: true,
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

function maybeLuckyHour(db: Database, cfg: AppConfig, now: number, an: GameAnnouncement[]): void {
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
    text: `✦ Lucky hour: Hand-of-God chance is tripled for ${durationIt(dur)}.`,
    tone: 'gain',
  });
  insertRealmEvent(db, 'lucky_hour', `duration ${dur}s`);
}

function maybeDailyTrial(
  db: Database,
  cfg: AppConfig,
  now: number,
  channelNicks: Set<string>,
  an: GameAnnouncement[],
): void {
  const nextAt = metaGetInt(db, MK_V3_DAILY_TRIAL_NEXT) ?? 0;
  if (nextAt > now) return;
  const online = db.prepare('SELECT * FROM players WHERE online = 1').all() as PlayerRow[];
  const eligible = online.filter((p) => p.irc_nick && ircNickInChannel(p.irc_nick, channelNicks));
  if (eligible.length < 1) {
    metaSetInt(db, MK_V3_DAILY_TRIAL_NEXT, now + 900);
    return;
  }
  const pick = eligible[Math.floor(Math.random() * eligible.length)]!;
  const align = (pick.alignment || 'n').trim().toLowerCase();
  let winChance = 0.56;
  if (align === 'g') winChance += 0.04;
  if (align === 'e') winChance -= 0.03;
  if ((pick.trinket ?? '').trim()) winChance += 0.02;
  const won = Math.random() < Math.min(0.85, Math.max(0.2, winChance));
  if (won) {
    const delta = Math.max(1, cfg.v3DailyTrialRewardSec);
    const ns = Math.max(1, pick.next_seconds - delta);
    db.prepare('UPDATE players SET next_seconds = ? WHERE id = ?').run(ns, pick.id);
    an.push({
      target: 'chan',
      text: `V3 Daily Trial: ${pick.character_name} clears the trial. Level timer reduced by -${durationIt(delta)} (effective gain).`,
      tone: 'gain',
    });
    insertRealmEvent(db, 'daily_trial_win', `${pick.character_name} -${durationIt(delta)}`);
  } else {
    const delta = Math.max(1, cfg.v3DailyTrialPenaltySec);
    const ns = pick.next_seconds + delta;
    db.prepare('UPDATE players SET next_seconds = ?, idle_streak_sec = 0 WHERE id = ?').run(ns, pick.id);
    an.push({
      target: 'chan',
      text: `V3 Daily Trial: ${pick.character_name} fails the trial. Level timer increased by +${durationIt(delta)} (effective loss).`,
      tone: 'loss',
    });
    insertRealmEvent(db, 'daily_trial_lose', `${pick.character_name} +${durationIt(delta)}`);
  }
  metaSetInt(db, MK_V3_DAILY_TRIAL_NEXT, now + cfg.v3DailyTrialCooldownSec);
}

export function questPublicLine(db: Database, cfg: AppConfig): string {
  const v3Hints: string[] = [];
  if (cfg.v3ModeEnabled && cfg.v3DailyTrialEnabled) {
    const now = Math.floor(Date.now() / 1000);
    const left = Math.max(0, (metaGetInt(db, MK_V3_DAILY_TRIAL_NEXT) ?? 0) - now);
    v3Hints.push(left > 0 ? `daily trial in ${durationIt(left)}` : 'daily trial ready');
  }
  if (cfg.v3ModeEnabled && cfg.v3StreakEnabled) {
    v3Hints.push(`idle streak rewards active`);
  }
  const suffix = v3Hints.length ? ` · V3: ${v3Hints.join(' · ')}` : '';
  if (!(metaGetInt(db, MK_QUEST_ACTIVE) ?? 0)) {
    return `No quest active — party skirmishes start when enough logged-in players idle in channel.${suffix}`;
  }
  const ends = metaGetInt(db, MK_QUEST_ENDS) ?? 0;
  const now = Math.floor(Date.now() / 1000);
  const left = Math.max(0, ends - now);
  const s0 = metaGetInt(db, MK_QUEST_T0) ?? 0;
  const s1 = metaGetInt(db, MK_QUEST_T1) ?? 0;
  return `Quest: ${TEAM_NAMES[0]} ${s0} vs ${TEAM_NAMES[1]} ${s1} · ${durationIt(left)} left. Idle in channel to score for your band.${suffix}`;
}

export function realmRecordsLine(db: Database): string {
  const lv = metaGetInt(db, 'realm_record_level');
  const name = metaGetText(db, 'realm_record_name');
  if (!lv || !name) return 'No realm record yet — the highest level on this shard will claim it first.';
  return `Realm record: ${name} · L${lv} (all-time high on this shard).`;
}

export function checkNewRealmRecord(
  db: Database,
  charName: string,
  level: number,
  playerId: number,
  an: GameAnnouncement[],
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
    text: `◆ Realm record: ${charName} is now highest level in the shard (${level}).`,
    tone: 'gain',
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
  if (!p) return { err: 'Character not found.' };
  if (!p.online) return { err: 'Character not online.' };
  db.prepare('UPDATE players SET online = 0, session_open = 0 WHERE id = ?').run(p.id);
  insertRealmEvent(db, 'admin_forcelogout', characterName.trim());
  return { ok: true };
}

/** Permanently remove a character, medals, and realm record name if it matches. */
export function adminDeleteCharacter(
  db: Database,
  characterName: string,
  caseSensitive: boolean,
): { ok: true; name: string } | { err: string } {
  const p = findByCharacterName(db, characterName.trim(), caseSensitive);
  if (!p) return { err: 'Character not found.' };
  const id = p.id;
  const name = p.character_name;
  db.prepare('DELETE FROM player_medals WHERE player_id = ?').run(id);
  db.prepare('DELETE FROM players WHERE id = ?').run(id);
  const recName = metaGetText(db, 'realm_record_name');
  const recLv = metaGetInt(db, 'realm_record_level');
  if (
    recName &&
    name.trim().toLowerCase() === recName.trim().toLowerCase() &&
    recLv != null &&
    recLv > 0
  ) {
    metaSetInt(db, 'realm_record_level', 0);
    metaSetText(db, 'realm_record_name', null);
  }
  insertRealmEvent(db, 'admin_delete', name);
  return { ok: true, name };
}

export function adminForceStartQuest(
  db: Database,
  cfg: AppConfig,
  channelNicks: Set<string>,
  an: GameAnnouncement[],
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

export function adminForceLucky(db: Database, cfg: AppConfig, an: GameAnnouncement[]): void {
  if (!cfg.luckyHourEnabled) return;
  const now = Math.floor(Date.now() / 1000);
  metaSetInt(db, MK_LUCKY_UNTIL, now + cfg.luckyHourDurationSec);
  an.push({
    target: 'chan',
    text: `✦ Lucky hour (staff): Hand-of-God chance tripled for ${durationIt(cfg.luckyHourDurationSec)}.`,
    tone: 'gain',
  });
  insertRealmEvent(db, 'lucky_hour_admin', '');
}

/** Snapshot for IRC `!realm`, API, and dashboard — same math everywhere. */
export type RealmPulseJson = {
  onlineHeroes: number;
  questActive: boolean;
  questShort: string | null;
  luckySecondsLeft: number;
  recordName: string | null;
  recordLevel: number | null;
  /** Single headline line (already includes ◆). */
  display: string;
};

export function realmPulseData(db: Database, cfg: AppConfig): RealmPulseJson {
  const onlineRow = db.prepare('SELECT COUNT(*) AS c FROM players WHERE online = 1').get() as { c: number };
  const onlineHeroes = Number(onlineRow.c ?? 0);
  const now = Math.floor(Date.now() / 1000);

  let questActive = cfg.questEnabled && (metaGetInt(db, MK_QUEST_ACTIVE) ?? 0) === 1;
  let questShort: string | null = null;
  if (cfg.questEnabled && questActive) {
    const ends = metaGetInt(db, MK_QUEST_ENDS) ?? 0;
    const left = Math.max(0, ends - now);
    const s0 = metaGetInt(db, MK_QUEST_T0) ?? 0;
    const s1 = metaGetInt(db, MK_QUEST_T1) ?? 0;
    questShort = `${TEAM_NAMES[0]} ${s0} vs ${TEAM_NAMES[1]} ${s1} · ${durationIt(left)}`;
  }

  const luckyUntil = metaGetInt(db, MK_LUCKY_UNTIL) ?? 0;
  const luckySecondsLeft = cfg.luckyHourEnabled ? Math.max(0, luckyUntil - now) : 0;
  const trialNextAt =
    cfg.v3ModeEnabled && cfg.v3DailyTrialEnabled ? metaGetInt(db, MK_V3_DAILY_TRIAL_NEXT) ?? 0 : 0;
  const trialCooldownLeft = Math.max(0, trialNextAt - now);

  const recLv = metaGetInt(db, 'realm_record_level');
  const recNameRaw = metaGetText(db, 'realm_record_name');
  const recordLevel = recLv != null && recLv > 0 ? recLv : null;
  const recordName = recNameRaw?.trim() ? recNameRaw.trim() : null;

  const segments: string[] = [];
  segments.push(`${onlineHeroes} hero${onlineHeroes !== 1 ? 'es' : ''} with open session`);
  if (cfg.questEnabled) {
    segments.push(questActive && questShort ? `Quest live · ${questShort}` : `Quest idle — awaiting next start roll`);
  }
  if (cfg.luckyHourEnabled) {
    segments.push(
      luckySecondsLeft > 0 ? `Lucky hour · ${durationIt(luckySecondsLeft)} left` : `Lucky hour inactive`,
    );
  }
  if (cfg.v3ModeEnabled && cfg.v3DailyTrialEnabled) {
    segments.push(trialCooldownLeft > 0 ? `Daily trial in ${durationIt(trialCooldownLeft)}` : 'Daily trial ready');
  }
  if (cfg.v3ModeEnabled && cfg.v3StreakEnabled) {
    segments.push('Idle streak rewards active');
  }
  if (recordName && recordLevel) {
    segments.push(`Realm peak · ${recordName} L${recordLevel}`);
  } else {
    segments.push(`Realm peak · none yet`);
  }

  const display = `◆ ${segments.join(' · ')}`;

  return {
    onlineHeroes,
    questActive,
    questShort,
    luckySecondsLeft,
    recordName,
    recordLevel,
    display,
  };
}

export function realmPulseLine(db: Database, cfg: AppConfig): string {
  return realmPulseData(db, cfg).display;
}
