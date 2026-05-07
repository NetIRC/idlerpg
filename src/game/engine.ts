/** Core gameplay engine: sessions, penalties, progression, commands, and tick loop. */

import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import {
  clearIrcNickConflicts,
  clearBotHeartbeat as dbClearBotHeartbeat,
  findByCharacter,
  findLoggedOutByIrcNickCi,
  findOnlineByNickCi,
  findPlayerByIrcNickCi,
  getDb,
  insertRealmEvent,
  META_KEY_AI_ENABLED,
  metaGetInt,
  metaSetInt,
  touchBotHeartbeat as dbTouchBotHeartbeat,
  type PlayerRow,
} from '../db/index.js';
import type { AppConfig } from '../config.js';
import { stripStatusPrefix } from '../irc/channel-style.js';
import { reservedBotNicksLower } from '../nick-candidates.js';
import { alignmentIdleHint, alignmentIdleRate, alignmentLabel } from './alignment.js';
import { durationIt } from './duration.js';
import { penttl, ttl } from './math.js';
import { MSG } from './messages.js';
import { consultOmen, formatChronicleLine, OMEN_COOLDOWN_SEC, omenHintEligible } from './chronicle-omen.js';
import { pickChannelHint } from './channel-hint.js';
import { ircNickInChannel, normalizeIrcNick } from './irc-presence.js';
import { DUEL_INITIATOR_COOLDOWN_SEC, pickDuelHintFoe, runDuel } from './duel.js';
import { GAUNTLET_COOLDOWN_SEC, gauntletHintEligible, runGauntlet } from './gauntlet.js';
import { medalsDisplayLine, medalsForLevel } from './medals.js';
import {
  adminDeleteCharacter,
  adminForceLogout,
  adminForceLucky,
  adminForceStartQuest,
  checkNewRealmRecord,
  grantMilestoneTrinket,
  hogChanceMultiplier,
  nudgeAlignmentAfterHog,
  questPublicLine,
  realmPulseLine as computeRealmPulseLine,
  realmRecordsLine,
  realmTick,
} from './realm.js';

import type { GameAnnouncement } from './announce.js';
export type { GameAnnouncement } from './announce.js';

export class GameEngine {
  private lastTick = 0;
  private readonly reservedBotNicks: Set<string>;
  private static readonly MAX_TICK_DELTA_SEC = 30;
  private static readonly MAX_LEVELUPS_PER_TICK = 8;
  private static readonly LEVEL_ACTION_WINDOW_SEC = 5 * 60;
  private static readonly LEVEL_ACTION_REMINDER_AFTER_SEC = Math.floor(GameEngine.LEVEL_ACTION_WINDOW_SEC / 2);
  private static readonly STREAK_NOTICE_MIN_GAP_SEC = 20 * 60;

  constructor(private cfg: AppConfig) {
    this.reservedBotNicks = reservedBotNicksLower(cfg);
  }

  get db() {
    return getDb(this.cfg);
  }

  /** Persist IRC bot liveness for the public site (SQLite `meta` row). */
  touchBotHeartbeat(): void {
    dbTouchBotHeartbeat(this.db);
    // Mirror runtime AI toggle so the PHP site can show true status without separate config.
    metaSetInt(this.db, META_KEY_AI_ENABLED, this.cfg.aiEnabled ? 1 : 0);
  }

  clearBotHeartbeat(): void {
    dbClearBotHeartbeat(this.db);
  }

  caseName(name: string): string {
    return this.cfg.caseSensitiveNames ? name : name.toLowerCase();
  }

  resolveNameLookup(name: string): string {
    const t = name.trim();
    return this.cfg.caseSensitiveNames ? t : t.toLowerCase();
  }

  ensureOwner(p: PlayerRow): PlayerRow {
    if (this.cfg.ownerAccount && this.caseName(p.character_name) === this.caseName(this.cfg.ownerAccount)) {
      if (!p.is_admin) {
        this.db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(p.id);
        p.is_admin = 1;
      }
    }
    return p;
  }

  register(
    ircNick: string,
    userhost: string,
    charName: string,
    password: string,
    pclass: string,
    inChannel: boolean,
  ): { ok: true; announcements: GameAnnouncement[] } | { ok: false; err: string } {
    const nick = normalizeIrcNick(ircNick) || ircNick.trim();
    if (!inChannel)
      return {
        ok: false,
        err: `REGISTER requires your nick in ${this.cfg.ircChannel}. Join, stay visible, then send REGISTER again by PM to this bot.`,
      };
    if (findPlayerByIrcNickCi(this.db, nick))
      return {
        ok: false,
        err: MSG.nickAlreadyLinked,
      };
    const name = this.resolveNameLookup(charName.trim());
    const pass = password.trim();
    const cls = pclass.trim();
    if (name.length < 1 || name.length > 16) return { ok: false, err: 'Character name: use 1–16 characters.' };
    if (name.startsWith('#')) return { ok: false, err: 'Character name cannot start with #.' };
    if (this.reservedBotNicks.has(name.toLowerCase())) return { ok: false, err: 'That character name is not allowed.' };
    if (cls.length < 1 || cls.length > 30) return { ok: false, err: 'Class: use 1–30 characters.' };
    if (pass.length < 1) return { ok: false, err: 'Password is required (single word, no spaces).' };

    if (findByCharacter(this.db, name, this.cfg.caseSensitiveNames)) return { ok: false, err: 'That character name is already registered.' };

    const hash = bcrypt.hashSync(pass, 10);
    const now = Math.floor(Date.now() / 1000);
    const isOwner =
      this.cfg.ownerAccount && this.caseName(name) === this.caseName(this.cfg.ownerAccount) ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO players (character_name, password_hash, class, level, next_seconds, idled, online, session_open, irc_nick, userhost, created_at, last_login, is_admin)
         VALUES (?, ?, ?, 0, ?, 0, 1, 1, ?, ?, ?, ?, ?)`,
      )
      .run(name, hash, cls, this.cfg.rpbase, nick, userhost, now, now, isOwner);
    insertRealmEvent(this.db, 'register', name);
    const ann: GameAnnouncement[] = [
      {
        target: 'chan',
        text: pickRegisterWelcome(nick, name, cls, this.cfg.rpbase),
        tone: 'gain',
      },
      {
        target: 'notice',
        nick,
        text: [
          `Session opened: character "${name}" is linked to ${nick}.`,
          `Remain in ${this.cfg.ircChannel} (visible in /names) or your level timer will not advance.`,
          `Idling in channel counts toward the next level. Lines starting with ! are free; normal chat adds time to your level timer.`,
          `First milestone: ~${durationIt(this.cfg.rpbase)} to level 1. PM HELP for commands. LOGOUT applies a small timer cost.`,
        ].join(' '),
      },
    ];
    return { ok: true, announcements: ann };
  }

  login(
    ircNick: string,
    userhost: string,
    charName: string,
    password: string,
    inChannel: boolean,
  ): { ok: true; announcements: GameAnnouncement[] } | { ok: false; err: string } {
    const nick = normalizeIrcNick(ircNick) || ircNick.trim();
    if (!inChannel)
      return {
        ok: false,
        err: `LOGIN requires your nick in ${this.cfg.ircChannel}. Join, stay visible, then send LOGIN again by PM.`,
      };
    if (findOnlineByNickCi(this.db, nick))
      return {
        ok: false,
        err: 'This nick already has an open session. Send LOGOUT first to switch character.',
      };
    const p = findByCharacter(this.db, this.resolveNameLookup(charName.trim()), this.cfg.caseSensitiveNames);
    if (!p || !bcrypt.compareSync(password.trim(), p.password_hash)) {
      const hint = this.cfg.caseSensitiveNames ? ' Character names are case-sensitive.' : '';
      return {
        ok: false,
        err: `LOGIN failed: verify character name and password.${hint} New player: REGISTER by PM. Lost password: ask a channel admin for a reset.`,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(`UPDATE players SET online = 1, session_open = 1, irc_nick = ?, userhost = ?, last_login = ? WHERE id = ?`)
      .run(nick, userhost, now, p.id);
    clearIrcNickConflicts(this.db, nick, p.id);

    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(p.id) as PlayerRow;
    this.ensureOwner(row);
    insertRealmEvent(this.db, 'login', row.character_name);
    const ann: GameAnnouncement[] = [
      {
        target: 'chan',
        text: pickLoginWelcome(nick, row.character_name, row.level, row.class, row.next_seconds),
        tone: 'gain',
      },
      { target: 'notice', nick, text: loginSuccessNotice(this.cfg.ircChannel, row) },
    ];
    return { ok: true, announcements: ann };
  }

  logout(ircNick: string): { ok: true; announcements: GameAnnouncement[] } | { ok: false; err: string } {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { ok: false, err: MSG.activeSessionRequired };
    insertRealmEvent(this.db, 'logout', p.character_name);
    const pen = this.applyPenaltyAmount(p, 20);
    this.db
      .prepare(
        `UPDATE players SET online = 0, session_open = 0, pen_logout = pen_logout + ?, next_seconds = next_seconds + ? WHERE id = ?`,
      )
      .run(pen, pen, p.id);
    this.resetIdleStreak(p.id);
    return {
      ok: true,
      announcements: [
        {
          target: 'notice',
          nick: ircNick,
          text: `Logged out from "${p.character_name}". Logout cost: +${durationIt(pen)} on your level timer. Use LOGIN when you return.`,
          tone: 'loss',
        },
      ],
    };
  }

  /**
   * JOIN onboarding notice.
   * - Resumed session (after PART): confirm automatic resume
   * - Registered but logged out: guide LOGIN
   * - Unknown nick: guide REGISTER
   */
  joinOnboardingNotice(ircNick: string, resumedSession: boolean): string | null {
    const nick = normalizeIrcNick(ircNick);
    if (!nick || this.reservedBotNicks.has(nick.toLowerCase())) return null;
    const ch = this.cfg.ircChannel;
    if (resumedSession) {
      const active = findOnlineByNickCi(this.db, nick);
      if (!active) return null;
      return (
        `Welcome back: your session for "${active.character_name}" resumed automatically after rejoining ${ch}. ` +
        `Need status? Use !whoami or !time.`
      );
    }
    const p = findLoggedOutByIrcNickCi(this.db, nick);
    if (p) {
      const name = p.character_name;
      const caseHint = this.cfg.caseSensitiveNames ? ' Character name must match exactly (case-sensitive).' : '';
      return (
        `Welcome back. Character "${name}" is registered but not logged in.${caseHint} ` +
        `From this nick in ${ch}, PM this bot: LOGIN ${name} <password> (password = one word). ` +
        `Need help? PM HELP.`
      );
    }
    return (
      `Welcome to IdleRPG. To create your hero from this nick in ${ch}, PM this bot: ` +
      `REGISTER <name> <password> <class...> (password = one word). PM HELP for examples.`
    );
  }

  /**
   * After bot reconnect and NAMES: restore `online` for players who still have LOGIN session
   * (`session_open`) and are present in the game channel — no second LOGIN required.
   * Same state is used when a player PARTed the channel (session suspended, not ended).
   * LOGOUT / QUIT / KICK / explicit closes clear `session_open`, so those are not revived.
   */
  reconcileOpenSessionsInChannel(channelNicks: Set<string>, nickEquals: (a: string, b: string) => boolean): number {
    const rows = this.db
      .prepare(
        `SELECT id, irc_nick FROM players WHERE session_open = 1 AND online = 0 AND irc_nick != ''`,
      )
      .all() as { id: number; irc_nick: string }[];
    const upd = this.db.prepare('UPDATE players SET online = 1, irc_nick = ? WHERE id = ?');
    let restored = 0;
    for (const r of rows) {
      for (const inChan of channelNicks) {
        if (nickEquals(r.irc_nick, inChan)) {
          upd.run(inChan, r.id);
          restored += 1;
          break;
        }
      }
    }
    return restored;
  }

  /**
   * When a player rejoins the game channel after PART: restore `online` if their session was only suspended.
   */
  resumeSuspendedSessionOnJoin(ircNick: string): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM players WHERE session_open = 1 AND online = 0 AND irc_nick != '' AND irc_nick COLLATE NOCASE = ?`,
      )
      .get(ircNick) as { id: number } | undefined;
    if (!row) return false;
    this.db.prepare(`UPDATE players SET online = 1, irc_nick = ? WHERE id = ?`).run(ircNick, row.id);
    return true;
  }

  stats(ircNick: string, who?: string): { text: string } | { err: string } {
    let p: PlayerRow | undefined;
    if (who) {
      p = findByCharacter(this.db, this.resolveNameLookup(who), this.cfg.caseSensitiveNames);
      if (!p) return { err: 'No character matches that name.' };
    } else {
      p = findOnlineByNickCi(this.db, ircNick);
      if (!p) return { err: MSG.notLoggedInStats };
    }
    const idleH = (p.idled / 3600).toFixed(1);
    const charm = (p.trinket ?? '').trim();
    const charmS = charm ? ` · charm: ${charm} (~0.3% faster idle rate)` : '';
    const streakS =
      this.cfg.v3ModeEnabled && this.cfg.v3StreakEnabled
        ? ` · streak: ${durationIt(p.idle_streak_sec ?? 0)}`
        : '';
    const guildTag =
      p.guild_id && p.guild_id > 0
        ? (() => {
            const g = this.db.prepare('SELECT tag FROM guilds WHERE id = ? LIMIT 1').get(p.guild_id) as
              | { tag: string }
              | undefined;
            return g?.tag ? ` · guild: [${g.tag}]` : '';
          })()
        : '';
    const text = `${p.character_name} · L${p.level} ${p.class} · next level in ${durationIt(p.next_seconds)} · idle logged ~${idleH}h · ${alignmentIdleHint(p.alignment)}${streakS}${charmS}${guildTag}`;
    const prestige = this.cfg.v3ModeEnabled && this.cfg.v3PrestigeEnabled ? ` · prestige: R${Math.max(0, p.prestige_rank ?? 0)}` : '';
    const guildS = this.cfg.v3ModeEnabled && this.cfg.v3GuildEnabled && p.guild_id ? ` · guild #${p.guild_id}` : '';
    const relicS =
      this.cfg.v3ModeEnabled && this.cfg.v3RelicEnabled
        ? (() => {
            const key = this.activeRelicKey(p.id);
            return key ? ` · relic: ${key}` : '';
          })()
        : '';
    return { text: text + prestige + guildS + relicS };
  }

  whoami(ircNick: string): { text: string } | { err: string } {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'No session on this nick. PM LOGIN while in the game channel, or use REGISTER to create a character.' };
    const now = Math.floor(Date.now() / 1000);
    const cooldowns: string[] = [];

    const omenLast = metaGetInt(this.db, `omen_cd_${p.id}`) ?? 0;
    const omenLeft = Math.max(0, OMEN_COOLDOWN_SEC - (now - omenLast));
    cooldowns.push(omenLeft > 0 ? `omen in ${durationIt(omenLeft)}` : 'omen ready');

    const duelLast = metaGetInt(this.db, `duel_cd_${p.id}`) ?? 0;
    const duelLeft = Math.max(0, DUEL_INITIATOR_COOLDOWN_SEC - (now - duelLast));
    cooldowns.push(duelLeft > 0 ? `duel in ${durationIt(duelLeft)}` : 'duel ready');

    const gauntletLast = metaGetInt(this.db, `gauntlet_cd_${p.id}`) ?? 0;
    const gauntletLeft = Math.max(0, GAUNTLET_COOLDOWN_SEC - (now - gauntletLast));
    cooldowns.push(gauntletLeft > 0 ? `gauntlet in ${durationIt(gauntletLeft)}` : 'gauntlet ready');

    if (this.cfg.v3ModeEnabled && this.cfg.v3DailyTrialEnabled) {
      const trialNext = metaGetInt(this.db, 'v3_daily_trial_next') ?? 0;
      const trialLeft = Math.max(0, trialNext - now);
      cooldowns.push(trialLeft > 0 ? `daily trial in ${durationIt(trialLeft)}` : 'daily trial ready');
    }
    const levelActionWindowUntil = metaGetInt(this.db, `lvl_action_window_until_${p.id}`) ?? 0;
    const levelActionWindowLeft = Math.max(0, levelActionWindowUntil - now);
    if (levelActionWindowLeft > 0) {
      cooldowns.push(`level-up hint window in ${durationIt(levelActionWindowLeft)}`);
    }
    if (this.cfg.v3ModeEnabled && this.cfg.v3SeasonEnabled) {
      const season = this.currentSeasonWindow(now);
      cooldowns.push(`season rollover in ${durationIt(Math.max(0, season.endAt - now))}`);
    }

    return {
      text:
        `Session: ${p.character_name} · L${p.level} ${p.class} · alignment: ${alignmentLabel(p.alignment)} · next level in ${durationIt(p.next_seconds)}.\n` +
        `Cooldowns: ${cooldowns.join(' · ')}.`,
    };
  }

  timeLeft(ircNick: string, who?: string): { text: string } | { err: string } {
    let p: PlayerRow | undefined;
    if (who) {
      p = findByCharacter(this.db, this.resolveNameLookup(who), this.cfg.caseSensitiveNames);
      if (!p) return { err: 'No character matches that name.' };
    } else {
      p = findOnlineByNickCi(this.db, ircNick);
      if (!p) return { err: MSG.notLoggedInTime };
    }
    return {
      text: `${p.character_name}: next level in ${durationIt(p.next_seconds)} · L${p.level} ${p.class}.`,
    };
  }

  bountyLine(ircNick: string): { text: string } | { err: string } {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3BountyEnabled) {
      return { err: 'Bounty board is disabled on this shard.' };
    }
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'Log in first to view your bounty progress.' };
    const now = Math.floor(Date.now() / 1000);
    const st = this.getBountyState(p.id, now, true);
    const target = Math.max(1, this.cfg.v3BountyTargetSec);
    const progress = Math.min(target, st.progressSec);
    const quietLeft =
      this.cfg.v3BountyQuietSec > 0 ? Math.max(0, st.lastActivitySec + this.cfg.v3BountyQuietSec - now) : 0;
    const state = st.claimedToday
      ? 'claimed today'
      : progress >= target
        ? 'ready'
        : `in progress (${durationIt(target - progress)} left)`;
    const quiet = quietLeft > 0 ? ` · quiet gate ${durationIt(quietLeft)}` : '';
    return {
      text:
        `Bounty: ${durationIt(progress)} / ${durationIt(target)} idle today · reward -${durationIt(this.cfg.v3BountyRewardSec)} · ${state}${quiet}.`,
    };
  }

  seasonLine(ircNick: string): { text: string } | { err: string } {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3SeasonEnabled) return { err: 'Season pass is disabled on this shard.' };
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'Log in first to view season progress.' };
    const now = Math.floor(Date.now() / 1000);
    const season = this.currentSeasonWindow(now);
    const seasonId = season.id;
    const seasonEnd = season.endAt;
    const row = this.db
      .prepare(
        `SELECT xp, level FROM player_season_progress
         WHERE player_id = ? AND season_id = ?`,
      )
      .get(p.id, seasonId) as { xp: number; level: number } | undefined;
    const xp = Math.max(0, row?.xp ?? 0);
    const tier = Math.max(0, Math.floor(xp / Math.max(1, this.cfg.v3SeasonTierXp)));
    const nextTierIn = Math.max(0, this.cfg.v3SeasonTierXp - (xp % Math.max(1, this.cfg.v3SeasonTierXp)));
    return {
      text:
        `Season ${seasonId}: tier ${tier} · XP ${xp}. ` +
        `Next tier in ${nextTierIn} XP · ends in ${durationIt(Math.max(0, seasonEnd - now))}.`,
    };
  }

  bossLine(): { text: string } | { err: string } {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3WorldBossEnabled) return { err: 'World Boss is disabled on this shard.' };
    const active = this.db
      .prepare(
        `SELECT boss_name, hp_left, hp_max, ends_at FROM world_boss_runs
         WHERE state = 'active'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get() as { boss_name: string; hp_left: number; hp_max: number; ends_at: number } | undefined;
    const now = Math.floor(Date.now() / 1000);
    if (!active) {
      const nextAt = metaGetInt(this.db, 'v3_world_boss_next') ?? 0;
      const left = Math.max(0, nextAt - now);
      return { text: left > 0 ? `World Boss: next spawn in ${durationIt(left)}.` : 'World Boss: scouting the realm.' };
    }
    const pct = active.hp_max > 0 ? Math.max(0, Math.floor((active.hp_left / active.hp_max) * 100)) : 0;
    return {
      text: `World Boss: ${active.boss_name} · ${active.hp_left}/${active.hp_max} HP (${pct}%) · ${durationIt(Math.max(0, active.ends_at - now))} left.`,
    };
  }

  guildLine(ircNick: string, parts: string[]): { text: string } | { err: string } {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3GuildEnabled) return { err: 'Guilds are disabled on this shard.' };
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'Log in first to manage guilds.' };
    const sub = (parts[0] ?? '').toLowerCase();
    if (!sub || sub === 'status') {
      if (!p.guild_id) return { text: 'Guild: none. Use !guild create <TAG> <Name> or !guild join <TAG>.' };
      const g = this.db
        .prepare('SELECT id, tag, name FROM guilds WHERE id = ? LIMIT 1')
        .get(p.guild_id) as { id: number; tag: string; name: string } | undefined;
      if (!g) return { text: 'Guild link stale. Use !guild leave then join/create again.' };
      const members = this.db
        .prepare('SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ?')
        .get(g.id) as { c: number };
      return { text: `Guild [${g.tag}] ${g.name} · members ${members.c} · passive idle bonus ${Math.round(this.cfg.v3GuildIdleBonusPct * 100)}%.` };
    }
    if (sub === 'create') {
      const tag = (parts[1] ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
      const name = parts.slice(2).join(' ').trim().slice(0, 40);
      if (!tag || !name) return { err: 'Usage: !guild create <TAG> <Guild Name>' };
      if (p.guild_id) return { err: 'Leave your current guild first with !guild leave.' };
      try {
        const now = Math.floor(Date.now() / 1000);
        this.db.prepare(`INSERT INTO guilds (tag, name, created_at) VALUES (?, ?, ?)`).run(tag, name, now);
        const g = this.db.prepare(`SELECT id FROM guilds WHERE tag = ?`).get(tag) as { id: number } | undefined;
        if (!g) return { err: 'Guild creation failed. Try again.' };
        this.db.prepare(`INSERT OR REPLACE INTO guild_members (guild_id, player_id, role, joined_at) VALUES (?, ?, 'leader', ?)`).run(g.id, p.id, now);
        this.db.prepare(`UPDATE players SET guild_id = ? WHERE id = ?`).run(g.id, p.id);
        insertRealmEvent(this.db, 'guild_create', `${p.character_name} [${tag}] ${name}`);
        return { text: `Guild created: [${tag}] ${name}.` };
      } catch {
        return { err: 'Guild tag or name already exists.' };
      }
    }
    if (sub === 'join') {
      const tag = (parts[1] ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
      if (!tag) return { err: 'Usage: !guild join <TAG>' };
      if (p.guild_id) return { err: 'Leave your current guild first with !guild leave.' };
      const g = this.db
        .prepare('SELECT id, name FROM guilds WHERE tag = ? LIMIT 1')
        .get(tag) as { id: number; name: string } | undefined;
      if (!g) return { err: 'Guild not found.' };
      const now = Math.floor(Date.now() / 1000);
      this.db.prepare(`INSERT OR REPLACE INTO guild_members (guild_id, player_id, role, joined_at) VALUES (?, ?, 'member', ?)`).run(g.id, p.id, now);
      this.db.prepare('UPDATE players SET guild_id = ? WHERE id = ?').run(g.id, p.id);
      insertRealmEvent(this.db, 'guild_join', `${p.character_name} [${tag}]`);
      return { text: `Joined guild [${tag}] ${g.name}.` };
    }
    if (sub === 'leave') {
      if (!p.guild_id) return { err: 'You are not in a guild.' };
      this.db.prepare('DELETE FROM guild_members WHERE player_id = ?').run(p.id);
      this.db.prepare('UPDATE players SET guild_id = NULL WHERE id = ?').run(p.id);
      insertRealmEvent(this.db, 'guild_leave', p.character_name);
      return { text: 'You left your guild.' };
    }
    return { err: 'Guild commands: !guild status | create | join | leave' };
  }

  relicLine(ircNick: string, parts: string[]): { text: string } | { err: string } {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3RelicEnabled) return { err: 'Relics are disabled on this shard.' };
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'Log in first to manage relics.' };
    const sub = (parts[0] ?? '').toLowerCase();
    const all = this.db
      .prepare(`SELECT relic_key, is_active FROM player_relics WHERE player_id = ? ORDER BY acquired_at ASC`)
      .all(p.id) as { relic_key: string; is_active: number }[];
    if (!sub || sub === 'status' || sub === 'list') {
      if (!all.length) return { text: 'Relics: none. Keep idling and leveling to discover one.' };
      const items = all.map((r) => `${r.is_active ? '*' : ''}${r.relic_key}`).join(', ');
      return { text: `Relics: ${items}. Use !relic equip <key>.` };
    }
    if (sub === 'equip') {
      const key = (parts[1] ?? '').trim().toLowerCase();
      if (!key) return { err: 'Usage: !relic equip <key>' };
      const owned = all.find((r) => r.relic_key.toLowerCase() === key);
      if (!owned) return { err: 'You do not own that relic key.' };
      this.db.prepare('UPDATE player_relics SET is_active = 0 WHERE player_id = ?').run(p.id);
      this.db.prepare('UPDATE player_relics SET is_active = 1 WHERE player_id = ? AND relic_key = ?').run(p.id, owned.relic_key);
      insertRealmEvent(this.db, 'relic_equip', `${p.character_name} ${owned.relic_key}`);
      return { text: `Active relic set to ${owned.relic_key}.` };
    }
    return { err: 'Relic commands: !relic status | list | equip <key>' };
  }

  prestigeLine(ircNick: string, forceNow: boolean): { text: string } | { err: string } {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3PrestigeEnabled) return { err: 'Prestige is disabled on this shard.' };
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'Log in first to use prestige.' };
    const rank = Math.max(0, p.prestige_rank ?? 0);
    const bonusPct = Math.round(rank * this.cfg.v3PrestigeIdleRateBonusPct * 1000) / 10;
    if (!forceNow) {
      return {
        text:
          `Prestige rank ${rank} · idle-rate bonus +${bonusPct}%. ` +
          `Next rebirth at L${this.cfg.v3PrestigeMinLevel} (use !prestige now).`,
      };
    }
    if (p.level < this.cfg.v3PrestigeMinLevel) {
      return { err: `Prestige requires at least level ${this.cfg.v3PrestigeMinLevel}.` };
    }
    const newRank = rank + 1;
    this.db
      .prepare(
        `UPDATE players
         SET level = 0, next_seconds = ?, prestige_rank = ?, prestige_points = COALESCE(prestige_points, 0) + 1, idle_streak_sec = 0
         WHERE id = ?`,
      )
      .run(this.cfg.rpbase, newRank, p.id);
    insertRealmEvent(this.db, 'prestige', `${p.character_name} rank ${newRank}`);
    return {
      text:
        `Prestige complete: rank ${newRank}. Level reset to 0 with permanent idle bonus +${Math.round(newRank * this.cfg.v3PrestigeIdleRateBonusPct * 1000) / 10}%.`,
    };
  }

  helpPm(page: number): string {
    if (page >= 2) {
      return (
        'PM: HELP, CMDS, PING, STATS [name], TIME [name], WHOAMI, TOP, RECORDS, QUEST, BOUNTY, SEASON, BOSS, GUILD, RELIC, PRESTIGE, REALM, CHRONICLE, OMEN, DUEL <irc_nick>, GAUNTLET, MEDALS [name], LORE [topic], LOGOUT. ' +
        'Channel (no timer cost): !help !cmds !rules !ping !time !whoami !stats !records !quest !bounty !season !boss !guild !relic !prestige !realm !chronicle !omen !duel !gauntlet !medals !top !lore. ' +
        'Admin (if authorized): ADMIN HELP — FORCELOGOUT, DELETEUSER, RESETPASS, STARTQUEST, LUCKY, SAY, SHUTDOWN.'
      );
    }
    return (
      'PM only, from your nick in the game channel. REGISTER <CharacterName> <password> <class…> — password = one word; class may be multiple words. ' +
      'LOGIN <CharacterName> <password>. LOGOUT ends session (small level-timer cost). Forgot password: ask a channel admin. CMDS for page 2.'
    );
  }

  helpChannel(page: number, viewerIrcNick?: string): string {
    if (page >= 2) {
      return (
        'Commands here do not add level-timer penalty: !help !cmds !rules !ping !time !whoami !stats !records !quest !bounty !season !boss !guild !relic !prestige !realm !chronicle !omen !duel !gauntlet !medals !top !lore. ' +
        '!realm — snapshot: online count, quest, lucky hour, daily trial, realm peak level.'
      );
    }
    const viewer = viewerIrcNick?.trim();
    if (viewer) {
      const p = findOnlineByNickCi(this.db, viewer);
      if (p) {
        return (
          `Logged in as ${p.character_name} (L${p.level} ${p.class}). ` +
          `Try !time, !stats, !bounty, !season, !boss, !guild, !relic, !prestige, !realm, !top — use !cmds for the full public command list. Account changes: PM this bot (HELP).`
        );
      }
      const loggedOut = findLoggedOutByIrcNickCi(this.db, viewer);
      if (loggedOut) {
        const ch = this.cfg.ircChannel;
        return (
          `Not logged in. This nick is tied to "${loggedOut.character_name}" — PM this bot LOGIN ${loggedOut.character_name} <password> while in ${ch}. ` +
          'New player: PM REGISTER <name> <password> <class>.'
        );
      }
    }
    return (
      'Welcome: create a character by PM — REGISTER <name> <password> <class> — while your nick is in this channel (password = one word). ' +
      'Returning: LOGIN <name> <password>. Then use !cmds for commands.'
    );
  }

  questLine(): string {
    return questPublicLine(this.db, this.cfg);
  }

  recordsLine(): string {
    return realmRecordsLine(this.db);
  }

  chronicleLine(): string {
    return formatChronicleLine(this.db);
  }

  /** One-line realm snapshot (heroes online, quest, lucky, peak level). */
  realmPulseLine(): string {
    return computeRealmPulseLine(this.db, this.cfg);
  }

  seasonStatusLine(): string {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3SeasonEnabled) return 'Season off';
    const now = Math.floor(Date.now() / 1000);
    const season = this.currentSeasonWindow(now);
    return `Season ${season.id} · rollover in ${durationIt(Math.max(0, season.endAt - now))}`;
  }

  /** Coarse ETA for channel topic to avoid noisy per-second topic churn. */
  private topicEta(secLeft: number): string {
    const s = Math.max(0, Math.floor(secLeft));
    if (s >= 2 * 86400) {
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      return `${d}d ${h}h`;
    }
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const m5 = Math.floor(m / 5) * 5;
      return m5 > 0 ? `${h}h ${m5}m` : `${h}h`;
    }
    const m = Math.max(1, Math.floor(s / 60));
    if (m >= 10) {
      const m5 = Math.floor(m / 5) * 5;
      return `${Math.max(5, m5)}m`;
    }
    return `${m}m`;
  }

  /** Stable topic-refresh signal: update only on season or boss state changes. */
  channelTopicSignal(): string {
    const now = Math.floor(Date.now() / 1000);
    const seasonId = this.currentSeasonWindow(now).id;
    const activeBoss = this.db
      .prepare(
        `SELECT id FROM world_boss_runs
         WHERE state = 'active'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    const bossState = activeBoss ? `active:${activeBoss.id}` : 'idle';
    return `season:${seasonId}|boss:${bossState}`;
  }

  channelTopicLine(): string {
    const now = Math.floor(Date.now() / 1000);
    const seasonW = this.currentSeasonWindow(now);
    const seasonLabel = `Season ${seasonW.id} · ends in ${this.topicEta(Math.max(0, seasonW.endAt - now))}`;

    const activeBoss = this.db
      .prepare(
        `SELECT boss_name, ends_at FROM world_boss_runs
         WHERE state = 'active'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get() as { boss_name: string; ends_at: number } | undefined;
    const nextBossAt = Math.max(0, metaGetInt(this.db, 'v3_world_boss_next') ?? 0);
    const bossShort = activeBoss
      ? `World Boss active · ${activeBoss.boss_name} · ${this.topicEta(Math.max(0, activeBoss.ends_at - now))} left`
      : nextBossAt > now
        ? `World Boss standby · next in ${this.topicEta(nextBossAt - now)}`
        : 'World Boss scouting';

    const parts = [
      `\x0310Realm Status\x03`,
      `\x0312${seasonLabel}\x03`,
      `\x0304${bossShort}\x03`,
    ];
    if (this.cfg.publicUrl) {
      parts.push(`\x0311Web\x03: ${this.cfg.publicUrl}`);
    }
    const topic = parts.join(' | ');
    return topic.length > 420 ? `${topic.slice(0, 417)}...` : topic;
  }

  /** Realm omen: flavour + rare tiny timer nudge; cooldown in consultOmen. */
  omenLine(
    ircNick: string,
    channelNicks: Set<string>,
    nickEquals: (a: string, b: string) => boolean,
  ): { err: string } | { text: string; tone?: 'gain' | 'loss' | 'neutral' } {
    return consultOmen(this.db, ircNick, channelNicks, nickEquals);
  }

  /** In-channel duel vs another IRC nick (both logged in, present, level gap limited). */
  duelLine(ircNick: string, targetIrcNick: string, channelNicks: Set<string>) {
    return runDuel(this.db, ircNick, targetIrcNick, channelNicks);
  }

  /** Shadow gauntlet (PvE); long cooldown; must be in channel. */
  gauntletLine(ircNick: string, channelNicks: Set<string>) {
    return runGauntlet(this.db, ircNick, channelNicks);
  }

  /** Medals / arena & gauntlet win counts (self or named character). */
  medalsLine(ircNick: string, who?: string): { text: string } | { err: string } {
    let p: PlayerRow | undefined;
    if (who) {
      p = findByCharacter(this.db, this.resolveNameLookup(who), this.cfg.caseSensitiveNames);
      if (!p) return { err: 'No character matches that name.' };
    } else {
      p = findOnlineByNickCi(this.db, ircNick);
      if (!p) return { err: MSG.notLoggedInMedals };
    }
    return { text: medalsDisplayLine(this.db, p) };
  }

  /** Targeted channel tip (REGISTER / LOGIN / !commands) only when it applies to that nick. */
  channelHint(
    channelNicks: Set<string>,
    ircCaseEqual: (a: string, b: string) => boolean,
    botIrcNick: string,
  ): { nick: string; body: string } | null {
    return pickChannelHint(this.db, this.cfg, channelNicks, ircCaseEqual, botIrcNick);
  }

  canAdmin(ircNick: string): boolean {
    const nick = stripStatusPrefix(ircNick);
    if (this.cfg.adminIrcNicks.length > 0) {
      const needle = nick.toLowerCase();
      for (const a of this.cfg.adminIrcNicks) {
        if (a.toLowerCase() === needle) return true;
      }
    }
    const p = findPlayerByIrcNickCi(this.db, nick);
    if (!p) return false;
    if (p.is_admin) return true;
    if (this.cfg.ownerAccount && this.caseName(p.character_name) === this.caseName(this.cfg.ownerAccount)) {
      return true;
    }
    return false;
  }

  adminCommand(
    ircNick: string,
    parts: string[],
    channelNicks: Set<string>,
  ): { notices: string[]; announcements: GameAnnouncement[]; requestShutdown?: boolean } {
    const notices: string[] = [];
    const announcements: GameAnnouncement[] = [];
    if (!this.canAdmin(ircNick)) {
      return { notices: ['Admin: access denied for this nick.'], announcements: [] };
    }
    const sub = (parts[1] ?? '').toLowerCase();
    if (!sub || sub === 'help') {
      notices.push(
        'ADMIN: FORCELOGOUT ⟨name⟩ | DELETEUSER ⟨name⟩ | RESETPASS ⟨name⟩ ⟨pass⟩ | STARTQUEST | LUCKY | SAY ⟨text⟩ | SHUTDOWN [note]',
      );
      return { notices, announcements };
    }
    if (sub === 'deleteuser' || sub === 'delete') {
      const name = parts.slice(2).join(' ').trim();
      if (!name) {
        notices.push('Usage: ADMIN DELETEUSER <CharacterName> — permanently removes the character from the database.');
        return { notices, announcements };
      }
      const r = adminDeleteCharacter(this.db, name, this.cfg.caseSensitiveNames);
      notices.push(
        'err' in r
          ? r.err
          : `Deleted "${r.name}" from the database (medals removed). Realm peak cleared if it belonged to them.`,
      );
      return { notices, announcements };
    }
    if (sub === 'forcelogout') {
      const name = parts.slice(2).join(' ').trim();
      if (!name) {
        notices.push('Usage: ADMIN FORCELOGOUT <CharacterName>');
        return { notices, announcements };
      }
      const r = adminForceLogout(this.db, name, this.cfg.caseSensitiveNames);
      notices.push('err' in r ? r.err : `Session closed for ${name}.`);
      return { notices, announcements };
    }
    if (sub === 'resetpass' || sub === 'setpass') {
      const charName = parts[2]?.trim();
      const newPass = parts.slice(3).join(' ');
      if (!charName || !newPass.trim()) {
        notices.push('Usage: ADMIN RESETPASS <CharacterName> <newpassword>');
        return { notices, announcements };
      }
      const pass = newPass.trim();
      if (pass.length > 128) {
        notices.push('Password exceeds maximum length (128 characters).');
        return { notices, announcements };
      }
      const p = findByCharacter(this.db, this.resolveNameLookup(charName), this.cfg.caseSensitiveNames);
      if (!p) {
        notices.push('Character not found.');
        return { notices, announcements };
      }
      const hash = bcrypt.hashSync(pass, 10);
      this.db
        .prepare('UPDATE players SET password_hash = ?, online = 0, session_open = 0 WHERE id = ?')
        .run(hash, p.id);
      insertRealmEvent(this.db, 'admin_resetpass', p.character_name);
      notices.push(
        `Password reset for ${p.character_name}. They must LOGIN again (session cleared).`,
      );
      return { notices, announcements };
    }
    if (sub === 'startquest') {
      const r = adminForceStartQuest(this.db, this.cfg, channelNicks, announcements);
      notices.push('err' in r ? r.err : 'Quest started in channel.');
      return { notices, announcements };
    }
    if (sub === 'lucky') {
      adminForceLucky(this.db, this.cfg, announcements);
      notices.push('Lucky hour announced in channel.');
      return { notices, announcements };
    }
    if (sub === 'say') {
      const msg = parts.slice(2).join(' ').trim();
      if (!msg) {
        notices.push('Usage: ADMIN SAY <channel message>');
        return { notices, announcements };
      }
      announcements.push({ target: 'chan', text: msg });
      notices.push('Message sent to channel.');
      return { notices, announcements };
    }
    if (sub === 'shutdown') {
      const note = parts.slice(2).join(' ').trim();
      const summary = note ? `${stripStatusPrefix(ircNick)}: ${note}` : `${stripStatusPrefix(ircNick)}: shutdown`;
      insertRealmEvent(this.db, 'admin_shutdown', summary.slice(0, 500));
      notices.push(
        'Shutting down: the bot will QUIT IRC and exit this process. Start it again on the host (or use your process manager).',
      );
      return { notices, announcements, requestShutdown: true };
    }
    notices.push('Unknown ADMIN subcommand. Send: ADMIN HELP');
    return { notices, announcements };
  }

  top(): string {
    return this.topN(5);
  }

  /** Short leaderboard for channel lines (IRC length). */
  topN(limit: number): string {
    const n = Math.max(1, Math.min(10, limit));
    const rows = this.db
      .prepare(
        `SELECT character_name, level, class, next_seconds FROM players ORDER BY level DESC, next_seconds ASC LIMIT ?`,
      )
      .all(n) as { character_name: string; level: number; class: string; next_seconds: number }[];
    if (!rows.length) return 'Leaderboard is empty — no characters registered yet.';
    return rows
      .map(
        (r, i) =>
          `#${i + 1} ${r.character_name} · L${r.level} ${r.class} · next level ${durationIt(r.next_seconds)}`,
      )
      .join(' · ');
  }

  onChannelMessage(ircNick: string, msgLen: number): GameAnnouncement[] {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p || msgLen <= 0) return [];
    const pen = this.capPen(Math.floor((msgLen * penttl(p.level, this.cfg)) / this.cfg.rpbase));
    if (pen <= 0) return [];
    this.db
      .prepare(`UPDATE players SET pen_mesg = pen_mesg + ?, next_seconds = next_seconds + ? WHERE id = ?`)
      .run(pen, pen, p.id);
    this.resetIdleStreak(p.id);
    return [
      {
        target: 'notice',
        nick: ircNick,
        text: `Channel penalty: +${durationIt(pen)} on your level timer (${msgLen} characters sent). Recognized !commands are exempt.`,
        tone: 'loss',
      },
    ];
  }

  /**
   * Strict streak mode: any channel activity from the logged-in player breaks the idle streak,
   * including `!` commands (which remain penalty-free but no longer streak-free).
   */
  noteChannelActivity(ircNick: string): void {
    if (!this.cfg.v3ModeEnabled) return;
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return;
    if (this.cfg.v3StreakEnabled) {
      this.resetIdleStreak(p.id);
    }
    if (this.cfg.v3BountyEnabled) {
      metaSetInt(this.db, `last_chan_activity_${p.id}`, Math.floor(Date.now() / 1000));
    }
  }

  onNick(oldNick: string, newNick: string): GameAnnouncement[] {
    const p = findOnlineByNickCi(this.db, oldNick);
    if (!p) return [];
    const pen = this.applyPenaltyAmount(p, 30);
    const uh = p.userhost ? p.userhost.replace(/^[^!]+/, newNick) : '';
    this.db
      .prepare(
        `UPDATE players SET pen_nick = pen_nick + ?, next_seconds = next_seconds + ?, irc_nick = ?, userhost = ? WHERE id = ?`,
      )
      .run(pen, pen, newNick, uh, p.id);
    this.resetIdleStreak(p.id);
    return [{ target: 'notice', nick: newNick, text: `Nick change penalty: +${durationIt(pen)} on your level timer.`, tone: 'loss' }];
  }

  onPartQuit(ircNick: string, kind: 'part' | 'quit'): GameAnnouncement[] {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return [];
    const mult = kind === 'part' ? 200 : 20;
    const pen = this.applyPenaltyAmount(p, mult);
    const col = kind === 'part' ? 'pen_part' : 'pen_quit';
    if (kind === 'part') {
      this.db
        .prepare(
          `UPDATE players SET online = 0, session_open = 1, ${col} = ${col} + ?, next_seconds = next_seconds + ? WHERE id = ?`,
        )
        .run(pen, pen, p.id);
      this.resetIdleStreak(p.id);
      const ch = this.cfg.ircChannel;
      return [
        {
          target: 'notice',
          nick: ircNick,
          text: `You left ${ch}: session suspended; level timer +${durationIt(pen)}. Rejoin ${ch} to resume the same session (no second LOGIN).`,
          tone: 'loss',
        },
      ];
    } else {
      this.db
        .prepare(
          `UPDATE players SET online = 0, session_open = 0, ${col} = ${col} + ?, next_seconds = next_seconds + ? WHERE id = ?`,
        )
        .run(pen, pen, p.id);
      this.resetIdleStreak(p.id);
      return [
        {
          target: 'notice',
          nick: ircNick,
          text: `IRC disconnect: session closed; level timer +${durationIt(pen)}. LOGIN again when you return.`,
          tone: 'loss',
        },
      ];
    }
  }

  onKick(ircNick: string): GameAnnouncement[] {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return [];
    const pen = this.applyPenaltyAmount(p, 250);
    this.db
      .prepare(
        `UPDATE players SET online = 0, session_open = 0, pen_kick = pen_kick + ?, next_seconds = next_seconds + ? WHERE id = ?`,
      )
      .run(pen, pen, p.id);
    this.resetIdleStreak(p.id);
    return [
      {
        target: 'notice',
        nick: ircNick,
        text: `Kicked from ${this.cfg.ircChannel}. Session closed; level timer +${durationIt(pen)}.`,
        tone: 'loss',
      },
    ];
  }

  private applyPenaltyAmount(p: PlayerRow, mult: number): number {
    return this.capPen(Math.floor((mult * penttl(p.level, this.cfg)) / this.cfg.rpbase));
  }

  private capPen(pen: number): number {
    if (this.cfg.limitpen <= 0) return pen;
    return Math.min(pen, this.cfg.limitpen);
  }

  private resetIdleStreak(playerId: number): void {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3StreakEnabled) return;
    this.db.prepare('UPDATE players SET idle_streak_sec = 0 WHERE id = ?').run(playerId);
    metaSetInt(this.db, `streak_notice_pending_${playerId}`, 0);
    metaSetInt(this.db, `streak_notice_next_at_${playerId}`, 0);
  }

  private bountyDayIndex(nowSec: number): number {
    return Math.floor(nowSec / 86400);
  }

  private getBountyState(
    playerId: number,
    nowSec: number,
    writeRollover: boolean,
  ): { progressSec: number; claimedToday: boolean; lastActivitySec: number } {
    const day = this.bountyDayIndex(nowSec);
    const dayKey = `bounty_day_${playerId}`;
    const progressKey = `bounty_idle_sec_${playerId}`;
    const claimedKey = `bounty_claimed_${playerId}`;
    const activityKey = `last_chan_activity_${playerId}`;
    let curDay = metaGetInt(this.db, dayKey) ?? day;
    let progress = Math.max(0, metaGetInt(this.db, progressKey) ?? 0);
    let claimed = Math.max(0, metaGetInt(this.db, claimedKey) ?? 0);
    const lastActivity = Math.max(0, metaGetInt(this.db, activityKey) ?? 0);
    if (curDay !== day) {
      curDay = day;
      progress = 0;
      claimed = 0;
      if (writeRollover) {
        metaSetInt(this.db, dayKey, day);
        metaSetInt(this.db, progressKey, 0);
        metaSetInt(this.db, claimedKey, 0);
      }
    }
    return { progressSec: progress, claimedToday: claimed > 0, lastActivitySec: lastActivity };
  }

  private levelActionOptions(player: PlayerRow, channelNicks: Set<string>): string[] {
    if (!player.irc_nick) return [];

    const caseEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const actions: string[] = [];
    const foe = pickDuelHintFoe(this.db, player.irc_nick, channelNicks, caseEq);
    if (foe) actions.push(`!duel ${foe}`);
    if (omenHintEligible(this.db, player.irc_nick, channelNicks, caseEq)) actions.push('!omen');
    if (gauntletHintEligible(this.db, player.irc_nick, channelNicks, caseEq)) actions.push('!gauntlet');
    return actions;
  }

  private levelActionHint(player: PlayerRow, channelNicks: Set<string>): string | null {
    const actions = this.levelActionOptions(player, channelNicks);
    if (!actions.length) return null;
    return `Level-up window active for ${durationIt(GameEngine.LEVEL_ACTION_WINDOW_SEC)}: try ${actions.join(', ')}.`;
  }

  private levelActionReminder(player: PlayerRow, channelNicks: Set<string>, leftSec: number): string {
    const actions = this.levelActionOptions(player, channelNicks);
    if (actions.length) {
      return `Level-up window reminder (${durationIt(leftSec)} left): try ${actions.join(', ')}.`;
    }
    return `Level-up window reminder (${durationIt(leftSec)} left): check !whoami for live cooldowns.`;
  }

  private currentSeasonWindow(now: number): { id: number; startAt: number; endAt: number } {
    const seasonLenSec = Math.max(7, this.cfg.v3SeasonLengthDays) * 86400;
    const epoch = Math.max(0, this.cfg.v3SeasonEpochSec);
    const rel = Math.max(0, now - epoch);
    const seasonId = Math.floor(rel / seasonLenSec) + 1;
    const startAt = epoch + (seasonId - 1) * seasonLenSec;
    const endAt = startAt + seasonLenSec;
    return { id: seasonId, startAt, endAt };
  }

  private activeRelicKey(playerId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT relic_key FROM player_relics
         WHERE player_id = ? AND is_active = 1
         ORDER BY acquired_at DESC
         LIMIT 1`,
      )
      .get(playerId) as { relic_key: string } | undefined;
    const key = row?.relic_key?.trim() ?? '';
    return key || null;
  }

  private maybeGrantRelicOnLevel(playerId: number): string | null {
    if (!this.cfg.v3ModeEnabled || !this.cfg.v3RelicEnabled) return null;
    if (Math.random() > 0.18) return null;
    const current = this.db.prepare(`SELECT COUNT(*) AS c FROM player_relics WHERE player_id = ?`).get(playerId) as { c: number };
    if ((current.c ?? 0) >= 5) return null;
    const pool = ['omen_eye', 'levy_guard', 'streak_core'];
    const existing = this.db
      .prepare(`SELECT relic_key FROM player_relics WHERE player_id = ?`)
      .all(playerId) as { relic_key: string }[];
    const owned = new Set(existing.map((r) => r.relic_key));
    const candidates = pool.filter((k) => !owned.has(k));
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`INSERT INTO player_relics (player_id, relic_key, is_active, acquired_at) VALUES (?, ?, 0, ?)`).run(playerId, pick, now);
    return pick;
  }

  tick(channelNicks: Set<string>): GameAnnouncement[] {
    const now = Math.floor(Date.now() / 1000);
    if (this.lastTick === 0) {
      this.lastTick = now;
      return [];
    }
    const dtRaw = now - this.lastTick;
    this.lastTick = now;
    if (dtRaw <= 0) return [];
    const dt = Math.min(dtRaw, GameEngine.MAX_TICK_DELTA_SEC);

    const announcements: GameAnnouncement[] = [];

    realmTick(this.db, this.cfg, channelNicks, now, announcements);

    // Re-read online players after realm systems (quest/trial/boss) so their
    // timer adjustments are not overwritten by stale pre-realm snapshot values.
    const online = this.db.prepare(`SELECT * FROM players WHERE online = 1`).all() as PlayerRow[];
    const guildOnlineCounts = new Map<number, number>();
    for (const p of online) {
      if (!p.guild_id) continue;
      if (!p.irc_nick || !ircNickInChannel(p.irc_nick, channelNicks)) continue;
      guildOnlineCounts.set(p.guild_id, (guildOnlineCounts.get(p.guild_id) ?? 0) + 1);
    }
    const seasonId =
      this.cfg.v3ModeEnabled && this.cfg.v3SeasonEnabled ? this.currentSeasonWindow(now).id : 0;

    const hogMult = hogChanceMultiplier(this.db, now);

    for (const p of online) {
      if (!p.irc_nick || !ircNickInChannel(p.irc_nick, channelNicks)) continue;

      const rate =
        alignmentIdleRate(p.alignment) * ((p.trinket ?? '').trim() ? 1.003 : 1);
      const prestigeRank = Math.max(0, p.prestige_rank ?? 0);
      const prestigeRateMult =
        this.cfg.v3ModeEnabled && this.cfg.v3PrestigeEnabled
          ? 1 + prestigeRank * this.cfg.v3PrestigeIdleRateBonusPct
          : 1;
      const guildRateMult =
        this.cfg.v3ModeEnabled && this.cfg.v3GuildEnabled && p.guild_id && (guildOnlineCounts.get(p.guild_id) ?? 0) >= 2
          ? 1 + this.cfg.v3GuildIdleBonusPct
          : 1;
      const effectiveRate = rate * prestigeRateMult * guildRateMult;
      let next = p.next_seconds - dt * effectiveRate;
      let level = p.level;
      const prevLevel = p.level;
      const idled = p.idled + dt;
      let streakSec = p.idle_streak_sec ?? 0;
      let streakRewards = p.streak_reward_count ?? 0;

      if (this.cfg.v3ModeEnabled && this.cfg.v3StreakEnabled) {
        const step = Math.max(1, this.cfg.v3StreakStepSec);
        const relic = this.activeRelicKey(p.id);
        const streakBonusPct =
          this.cfg.v3RelicEnabled && relic === 'streak_core' ? Math.max(0, this.cfg.v3RelicStreakBonusPct) : 0;
        const reward = Math.max(1, Math.floor(this.cfg.v3StreakRewardSec * (1 + streakBonusPct)));
        const beforeBand = Math.floor(streakSec / step);
        streakSec += dt;
        const afterBand = Math.floor(streakSec / step);
        const gainedBands = Math.max(0, afterBand - beforeBand);
        if (gainedBands > 0) {
          const bonus = gainedBands * reward;
          next = Math.max(1, next - bonus);
          streakRewards += gainedBands;
          // Aggregate streak notices to avoid spammy fixed-interval messaging.
          const pendingKey = `streak_notice_pending_${p.id}`;
          const nextNoticeKey = `streak_notice_next_at_${p.id}`;
          const pending = Math.max(0, metaGetInt(this.db, pendingKey) ?? 0) + bonus;
          const nextNoticeAt = Math.max(0, metaGetInt(this.db, nextNoticeKey) ?? 0);
          const noticeGapBase = Math.max(
            GameEngine.STREAK_NOTICE_MIN_GAP_SEC,
            Math.floor(step * 1.75),
          );
          const noticeJitter = p.id % 91;
          if (p.irc_nick && (nextNoticeAt === 0 || now >= nextNoticeAt)) {
            announcements.push({
              target: 'notice',
              nick: p.irc_nick,
              text: `Idle streak momentum: -${durationIt(pending)} total from your level timer.`,
              tone: 'gain',
            });
            metaSetInt(this.db, pendingKey, 0);
            metaSetInt(this.db, nextNoticeKey, now + noticeGapBase + noticeJitter);
          } else {
            metaSetInt(this.db, pendingKey, pending);
          }
        }
      }

      if (this.cfg.v3ModeEnabled && this.cfg.v3BountyEnabled) {
        const target = Math.max(1, this.cfg.v3BountyTargetSec);
        const quietSec = Math.max(0, this.cfg.v3BountyQuietSec);
        const reward = Math.max(1, this.cfg.v3BountyRewardSec);
        const day = this.bountyDayIndex(now);
        const dayKey = `bounty_day_${p.id}`;
        const progressKey = `bounty_idle_sec_${p.id}`;
        const claimedKey = `bounty_claimed_${p.id}`;

        const st = this.getBountyState(p.id, now, true);
        let progress = st.progressSec;
        const claimedToday = st.claimedToday;
        const quietOk = quietSec <= 0 || now - st.lastActivitySec >= quietSec;
        if (!claimedToday && quietOk && progress < target) {
          progress = Math.min(target, progress + dt);
          metaSetInt(this.db, progressKey, progress);
        }
        if (!claimedToday && progress >= target) {
          next = Math.max(1, next - reward);
          metaSetInt(this.db, dayKey, day);
          metaSetInt(this.db, claimedKey, 1);
          metaSetInt(this.db, progressKey, target);
          if (p.irc_nick) {
            announcements.push({
              target: 'notice',
              nick: p.irc_nick,
              text: `Bounty complete: -${durationIt(reward)} from your level timer (daily idle contract).`,
              tone: 'gain',
            });
          }
          insertRealmEvent(this.db, 'bounty_claim', `${p.character_name} -${durationIt(reward)}`);
        }
      }

      let lvlsThisTick = 0;
      while (next < 1) {
        if (lvlsThisTick >= GameEngine.MAX_LEVELUPS_PER_TICK) {
          next = 1;
          if (p.irc_nick) {
            announcements.push({
              target: 'notice',
              nick: p.irc_nick,
              text: 'Catch-up safety cap reached for this tick. Remaining level updates will continue automatically.',
              tone: 'neutral',
            });
          }
          break;
        }
        lvlsThisTick += 1;
        const add = Math.floor(ttl(level, this.cfg));
        level += 1;
        next += add;
        const line = levelUpLine(p.character_name, p.class, level, add);
        announcements.push({
          target: 'chan',
          text: line,
          tone: 'gain',
        });
        if (isMilestoneLevel(level)) {
          const t = grantMilestoneTrinket(this.db, p.id);
          if (t && p.irc_nick) {
            announcements.push({
              target: 'notice',
              nick: p.irc_nick,
              text: `Charm attuned: ${t} — small idle boost while kept.`,
              tone: 'gain',
            });
          }
        }
        const relicDrop = this.maybeGrantRelicOnLevel(p.id);
        if (relicDrop && p.irc_nick) {
          announcements.push({
            target: 'notice',
            nick: p.irc_nick,
            text: `Relic discovered: ${relicDrop}. Use !relic list and !relic equip ${relicDrop}.`,
            tone: 'gain',
          });
          insertRealmEvent(this.db, 'relic_found', `${p.character_name} ${relicDrop}`);
        }
        checkNewRealmRecord(this.db, p.character_name, level, p.id, announcements);
        for (const mline of medalsForLevel(this.db, p, level)) {
          announcements.push({ target: 'chan', text: mline, tone: 'gain' });
        }
      }

      this.db
        .prepare(
          `UPDATE players SET level = ?, next_seconds = ?, idled = ?, idle_streak_sec = ?, streak_reward_count = ? WHERE id = ?`,
        )
        .run(level, next, idled, streakSec, streakRewards, p.id);

      if (seasonId > 0) {
        const seasonXpGain = Math.max(1, Math.floor((dt * Math.max(1, this.cfg.v3SeasonPassXpPerMinute)) / 60));
        this.db.prepare(
          `INSERT INTO player_season_progress (player_id, season_id, xp, level, updated_at)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(player_id, season_id) DO UPDATE SET
             xp = xp + excluded.xp,
             level = (xp + excluded.xp) / ?,
             updated_at = excluded.updated_at`,
        ).run(p.id, seasonId, seasonXpGain, now, Math.max(1, this.cfg.v3SeasonTierXp));
      }

      if (level > prevLevel && p.irc_nick) {
        metaSetInt(this.db, `lvl_action_window_until_${p.id}`, now + GameEngine.LEVEL_ACTION_WINDOW_SEC);
        metaSetInt(this.db, `lvl_action_window_reminder_at_${p.id}`, now + GameEngine.LEVEL_ACTION_REMINDER_AFTER_SEC);
        metaSetInt(this.db, `lvl_action_window_reminder_sent_${p.id}`, 0);
        const hint = this.levelActionHint(p, channelNicks);
        if (hint) {
          announcements.push({
            target: 'notice',
            nick: p.irc_nick,
            text: hint,
            tone: 'neutral',
          });
        }
      }

      if (p.irc_nick) {
        const windowUntil = metaGetInt(this.db, `lvl_action_window_until_${p.id}`) ?? 0;
        if (windowUntil > now) {
          const reminderAt = metaGetInt(this.db, `lvl_action_window_reminder_at_${p.id}`) ?? 0;
          const reminderSent = metaGetInt(this.db, `lvl_action_window_reminder_sent_${p.id}`) ?? 0;
          if (reminderSent === 0 && reminderAt > 0 && now >= reminderAt) {
            const leftSec = Math.max(1, windowUntil - now);
            announcements.push({
              target: 'notice',
              nick: p.irc_nick,
              text: this.levelActionReminder(p, channelNicks, leftSec),
              tone: 'neutral',
            });
            metaSetInt(this.db, `lvl_action_window_reminder_sent_${p.id}`, 1);
          }
        }
      }
    }

    maybeHandOfGod(this.db, this.cfg, channelNicks, announcements, hogMult);

    return announcements;
  }
}

function loginSuccessNotice(channel: string, row: PlayerRow): string {
  const d = durationIt(row.next_seconds);
  return [
    `Session open: "${row.character_name}" · L${row.level} ${row.class}.`,
    `Stay in ${channel} so your level timer advances. Next level in ${d}.`,
    `PM HELP for commands. LOGOUT applies a small level-timer cost.`,
  ].join(' ');
}

function pickRegisterWelcome(ircNick: string, name: string, cls: string, rpbase: number): string {
  const d = durationIt(rpbase);
  const o = [
    `Registered: ${ircNick} linked to ${name} (${cls}). Next level in ${d}.`,
    `Welcome ${name} (${cls}). Session opened for ${ircNick}; next level in ${d}.`,
    `Account created: ${name} (${cls}) is now active on ${ircNick}. Next level in ${d}.`,
  ];
  return o[Math.floor(Math.random() * o.length)]!;
}

function pickLoginWelcome(ircNick: string, charName: string, level: number, cls: string, nextSec: number): string {
  const d = durationIt(nextSec);
  const o = [
    `Login: ${charName} (L${level} ${cls}) is active on ${ircNick}. Next level in ${d}.`,
    `${charName} returned on ${ircNick} · L${level} ${cls} · next level in ${d}.`,
    `Session resumed for ${charName} (${cls}, L${level}) on ${ircNick}. Next level in ${d}.`,
  ];
  return o[Math.floor(Math.random() * o.length)]!;
}

function levelUpLine(charName: string, cls: string, level: number, nextSec: number): string {
  const tail = `Next level in ${durationIt(nextSec)}.`;
  if (isMilestoneLevel(level)) {
    const forms = [
      `Milestone reached: ${charName} (${cls}) is now level ${level}. ${tail}`,
      `${charName} advanced to milestone level ${level} (${cls}). ${tail}`,
      `Level ${level} milestone for ${charName} (${cls}). ${tail}`,
    ];
    return forms[Math.floor(Math.random() * forms.length)]!;
  }
  return `${charName} (${cls}) reached level ${level}. ${tail}`;
}

function isMilestoneLevel(level: number): boolean {
  if ([5, 25, 50, 75, 69, 100].includes(level)) return true;
  if (level >= 10 && level < 100 && level % 10 === 0) return true;
  if (level > 100 && level % 25 === 0) return true;
  return false;
}

function maybeHandOfGod(
  db: Database,
  cfg: AppConfig,
  channelNicks: Set<string>,
  announcements: GameAnnouncement[],
  hogChanceMult: number,
) {
  if (Math.random() > cfg.hogChance * hogChanceMult) return;
  const online = db.prepare(`SELECT * FROM players WHERE online = 1`).all() as PlayerRow[];
  const inChan = online.filter((p) => p.irc_nick && ircNickInChannel(p.irc_nick, channelNicks));
  if (!inChan.length) return;
  const p = inChan[Math.floor(Math.random() * inChan.length)]!;
  const win = Math.random() < 0.8;
  const frac = (5 + Math.floor(Math.random() * 71)) / 100;
  const delta = Math.floor(frac * p.next_seconds);
  if (win) {
    const nn = Math.max(1, p.next_seconds - delta);
    const gainLabel = `-${durationIt(delta)}`;
    db.prepare(`UPDATE players SET next_seconds = ? WHERE id = ?`).run(nn, p.id);
    const lines = [
      `★ Hand of God: ${p.character_name}'s level timer is reduced (${gainLabel} effective gain).`,
      `★ Hand of God: ${p.character_name} gains ${gainLabel} toward the next level (timer shortened).`,
      `★ Hand of God: fortune favors ${p.character_name} — wait until next level cut by ${gainLabel}.`,
    ];
    announcements.push({
      target: 'chan',
      text: lines[Math.floor(Math.random() * lines.length)]!,
      tone: 'gain',
    });
    insertRealmEvent(db, 'hog_win', `${p.character_name} -${durationIt(delta)}`);
    nudgeAlignmentAfterHog(db, p, true);
  } else {
    const nn = p.next_seconds + delta;
    const lossLabel = `+${durationIt(delta)}`;
    db.prepare(`UPDATE players SET next_seconds = ? WHERE id = ?`).run(nn, p.id);
    const lines = [
      `★ Hand of God: ${p.character_name}'s level timer increases (${lossLabel} effective loss).`,
      `★ Hand of God: ${p.character_name} loses ${lossLabel} of progress toward the next level.`,
      `★ Hand of God: harsh roll for ${p.character_name} — extra ${lossLabel} on the level timer.`,
    ];
    announcements.push({
      target: 'chan',
      text: lines[Math.floor(Math.random() * lines.length)]!,
      tone: 'loss',
    });
    insertRealmEvent(db, 'hog_lose', `${p.character_name} +${durationIt(delta)}`);
    nudgeAlignmentAfterHog(db, p, false);
  }
}
