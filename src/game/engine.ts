import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import {
  clearBotHeartbeat as dbClearBotHeartbeat,
  findByCharacter,
  findLoggedOutByIrcNickCi,
  findOnlineByNickCi,
  getDb,
  insertRealmEvent,
  touchBotHeartbeat as dbTouchBotHeartbeat,
  type PlayerRow,
} from '../db/index.js';
import type { AppConfig } from '../config.js';
import { reservedBotNicksLower } from '../nick-candidates.js';
import { alignmentIdleHint, alignmentIdleRate, alignmentLabel } from './alignment.js';
import { durationIt } from './duration.js';
import { penttl, ttl } from './math.js';
import { consultOmen, formatChronicleLine } from './chronicle-omen.js';
import { pickChannelHint } from './channel-hint.js';
import { ircNickInChannel } from './irc-presence.js';
import { runDuel } from './duel.js';
import { runGauntlet } from './gauntlet.js';
import { medalsDisplayLine, medalsForLevel } from './medals.js';
import {
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

/** Game logic: timers, penalties, and tick aligned with classic IdleRPG / bot.pl. */

export type GameAnnouncement = { target: 'chan' | 'notice'; nick?: string; text: string };

export class GameEngine {
  private lastTick = 0;
  private readonly reservedBotNicks: Set<string>;

  constructor(private cfg: AppConfig) {
    this.reservedBotNicks = reservedBotNicksLower(cfg);
  }

  get db() {
    return getDb(this.cfg);
  }

  /** Persist IRC bot liveness for the public site (SQLite `meta` row). */
  touchBotHeartbeat(): void {
    dbTouchBotHeartbeat(this.db);
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
    if (!inChannel)
      return {
        ok: false,
        err: `REGISTER only works while your nick is in ${this.cfg.ircChannel}. Join that channel, then send REGISTER again here (private message to this bot).`,
      };
    if (findOnlineByNickCi(this.db, ircNick))
      return {
        ok: false,
        err: 'This IRC nick already has a character logged in. Send LOGOUT first, then REGISTER a different account or use another nick.',
      };
    const name = this.resolveNameLookup(charName.trim());
    const pass = password.trim();
    const cls = pclass.trim();
    if (name.length < 1 || name.length > 16) return { ok: false, err: 'Character name must be 1–16 characters.' };
    if (name.startsWith('#')) return { ok: false, err: 'Name cannot start with #.' };
    if (this.reservedBotNicks.has(name.toLowerCase())) return { ok: false, err: 'Invalid name.' };
    if (cls.length < 1 || cls.length > 30) return { ok: false, err: 'Class must be 1–30 characters.' };
    if (pass.length < 1) return { ok: false, err: 'Password is required.' };

    if (findByCharacter(this.db, name, this.cfg.caseSensitiveNames)) return { ok: false, err: 'That name is already taken.' };

    const hash = bcrypt.hashSync(pass, 10);
    const now = Math.floor(Date.now() / 1000);
    const isOwner =
      this.cfg.ownerAccount && this.caseName(name) === this.caseName(this.cfg.ownerAccount) ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO players (character_name, password_hash, class, level, next_seconds, idled, online, session_open, irc_nick, userhost, created_at, last_login, is_admin)
         VALUES (?, ?, ?, 0, ?, 0, 1, 1, ?, ?, ?, ?, ?)`,
      )
      .run(name, hash, cls, this.cfg.rpbase, ircNick, userhost, now, now, isOwner);

    insertRealmEvent(this.db, 'register', name);
    const ann: GameAnnouncement[] = [
      {
        target: 'chan',
        text: pickRegisterWelcome(ircNick, name, cls, this.cfg.rpbase),
      },
      {
        target: 'notice',
        nick: ircNick,
        text: [
          `OK — character "${name}" is created and you are logged in as your IRC nick (${ircNick}).`,
          `Stay in ${this.cfg.ircChannel} (visible in the user list) or the idle timer will not run.`,
          `Silence in channel counts toward levels. Lines starting with ! are free; other chat adds penalty time.`,
          `First goal: ${durationIt(this.cfg.rpbase)} idling (level 0→1). PM HELP for commands. LOGOUT when you are done.`,
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
    if (!inChannel)
      return {
        ok: false,
        err: `LOGIN only works while your nick is in ${this.cfg.ircChannel}. Join the channel, then send LOGIN again (private message to this bot).`,
      };
    if (findOnlineByNickCi(this.db, ircNick))
      return {
        ok: false,
        err: 'Already logged in on this IRC nick. Send LOGOUT first if you want to switch character.',
      };
    const p = findByCharacter(this.db, this.resolveNameLookup(charName.trim()), this.cfg.caseSensitiveNames);
    if (!p || !bcrypt.compareSync(password.trim(), p.password_hash)) {
      const hint = this.cfg.caseSensitiveNames ? ' Character names are case-sensitive.' : '';
      return {
        ok: false,
        err: `LOGIN failed: check character name and password.${hint} New player? REGISTER first. Forgot password? Ask a game admin in the channel — they can reset it for you.`,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(`UPDATE players SET online = 1, session_open = 1, irc_nick = ?, userhost = ?, last_login = ? WHERE id = ?`)
      .run(ircNick, userhost, now, p.id);

    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(p.id) as PlayerRow;
    this.ensureOwner(row);
    insertRealmEvent(this.db, 'login', row.character_name);
    const ann: GameAnnouncement[] = [
      {
        target: 'chan',
        text: pickLoginWelcome(ircNick, row.character_name, row.level, row.class, row.next_seconds),
      },
      { target: 'notice', nick: ircNick, text: loginSuccessNotice(this.cfg.ircChannel, row) },
    ];
    return { ok: true, announcements: ann };
  }

  logout(ircNick: string): { ok: true; announcements: GameAnnouncement[] } | { ok: false; err: string } {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { ok: false, err: 'Not logged in — send LOGIN CharacterName Password first.' };
    insertRealmEvent(this.db, 'logout', p.character_name);
    const pen = this.applyPenaltyAmount(p, 20);
    this.db
      .prepare(
        `UPDATE players SET online = 0, session_open = 0, pen_logout = pen_logout + ?, next_seconds = next_seconds + ? WHERE id = ?`,
      )
      .run(pen, pen, p.id);
    return {
      ok: true,
      announcements: [
        {
          target: 'notice',
          nick: ircNick,
          text: `Logged out from "${p.character_name}". Logout penalty: +${durationIt(pen)} on your timer. LOGIN again next time.`,
        },
      ],
    };
  }

  /**
   * NOTICE when someone joins with a stored IRC nick but is fully logged out (LOGOUT / QUIT / KICK / etc.).
   */
  joinLoginReminderNotice(ircNick: string): string | null {
    const nick = ircNick.replace(/^@|%|\+/, '');
    if (!nick || this.reservedBotNicks.has(nick.toLowerCase())) return null;
    const p = findLoggedOutByIrcNickCi(this.db, nick);
    if (!p) return null;
    const name = p.character_name;
    const ch = this.cfg.ircChannel;
    const caseHint = this.cfg.caseSensitiveNames ? ' Character name must match exactly (case-sensitive).' : '';
    return (
      `IdleRPG — "${name}" is not logged in.${caseHint} Stay in ${ch}, then PM me: LOGIN ${name} YourPassword (one word, no spaces). ` +
      `Forgot password? Ask a game admin in ${ch} — they will help you recover your account. PM HELP for other commands.`
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
      if (!p) return { err: 'Player not found.' };
    } else {
      p = findOnlineByNickCi(this.db, ircNick);
      if (!p) return { err: 'Not logged in; use STATS <name>.' };
    }
    const idleH = (p.idled / 3600).toFixed(1);
    const charm = (p.trinket ?? '').trim();
    const charmS = charm ? ` · charm ${charm} (~0.3% faster idle)` : '';
    const text = `${p.character_name} · lv.${p.level} ${p.class} · next level in ${durationIt(p.next_seconds)} · total idle ~${idleH}h · ${alignmentIdleHint(p.alignment)}${charmS}`;
    return { text };
  }

  whoami(ircNick: string): { text: string } | { err: string } {
    const p = findOnlineByNickCi(this.db, ircNick);
    if (!p) return { err: 'Not logged in.' };
    return {
      text: `You are ${p.character_name}, level ${p.level} ${p.class} (${alignmentLabel(p.alignment)}). Next level in ${durationIt(p.next_seconds)}.`,
    };
  }

  timeLeft(ircNick: string, who?: string): { text: string } | { err: string } {
    let p: PlayerRow | undefined;
    if (who) {
      p = findByCharacter(this.db, this.resolveNameLookup(who), this.cfg.caseSensitiveNames);
      if (!p) return { err: 'Player not found.' };
    } else {
      p = findOnlineByNickCi(this.db, ircNick);
      if (!p) return { err: 'Not logged in; use STATS <name>.' };
    }
    return {
      text: `${p.character_name}: next level in ${durationIt(p.next_seconds)} (lv.${p.level} ${p.class}).`,
    };
  }

  helpPm(page: number): string {
    if (page >= 2) {
      return 'More: STATS [name] TOP PING. Channel: !time !whoami !records !quest !realm !chronicle !omen !duel !gauntlet !medals (no penalty). !realm = live realm pulse. ADMIN: FORCELOGOUT | RESETPASS char newpass | STARTQUEST | LUCKY | SAY';
    }
    return 'REGISTER <name> <password> <class…> — PM this bot only; password = one word (no spaces); class can be several words. LOGIN <name> <password> — same. You must be in the game channel. Forgot password? Ask a game admin in the channel. Then: LOGOUT STATS TOP HELP CMDS REALM CHRONICLE OMEN DUEL …';
  }

  helpChannel(page: number, viewerIrcNick?: string): string {
    if (page >= 2) {
      return 'Also: !time !whoami !records !quest !realm !chronicle !omen !duel !gauntlet !medals (no penalty). !realm = heartbeat of the shard (online, quest, lucky, peak).';
    }
    const viewer = viewerIrcNick?.trim();
    if (viewer) {
      const p = findOnlineByNickCi(this.db, viewer);
      if (p) {
        return (
          `You are logged in as ${p.character_name} (lv.${p.level} ${p.class}). ` +
          `Channel (no idle penalty): !time !whoami !stats !records !quest !realm !chronicle !omen !duel !gauntlet !medals !top — ` +
          `!help 2 for the full line. PM HELP for LOGOUT, TOP, account help. To onboard someone else: PM this bot REGISTER or LOGIN.`
        );
      }
      const loggedOut = findLoggedOutByIrcNickCi(this.db, viewer);
      if (loggedOut) {
        const ch = this.cfg.ircChannel;
        return (
          `You are not logged in. This nick matches "${loggedOut.character_name}" — PM me LOGIN ${loggedOut.character_name} <password> while you stay in ${ch}. ` +
          `New player instead? PM REGISTER <name> <password> <class> (password = one word). Then !help.`
        );
      }
    }
    return 'New here? PM this bot: REGISTER YourName yourpassword Your Class — you must be in the game channel; password = one word. Back again? LOGIN YourName password. Then !help in channel.';
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

  /** Realm omen: flavour + rare tiny timer nudge; cooldown in consultOmen. */
  omenLine(
    ircNick: string,
    channelNicks: Set<string>,
    nickEquals: (a: string, b: string) => boolean,
  ): { err: string } | { text: string } {
    return consultOmen(this.db, ircNick, channelNicks, nickEquals);
  }

  /** In-channel duel vs another IRC nick (both logged in, present, level gap limited). */
  duelLine(ircNick: string, targetIrcNick: string, channelNicks: Set<string>): { err: string } | { lines: string[] } {
    return runDuel(this.db, ircNick, targetIrcNick, channelNicks);
  }

  /** Shadow gauntlet (PvE); long cooldown; must be in channel. */
  gauntletLine(
    ircNick: string,
    channelNicks: Set<string>,
  ): { err: string } | { lines: string[] } {
    return runGauntlet(this.db, ircNick, channelNicks);
  }

  /** Medals / arena & gauntlet win counts (self or named character). */
  medalsLine(ircNick: string, who?: string): { text: string } | { err: string } {
    let p: PlayerRow | undefined;
    if (who) {
      p = findByCharacter(this.db, this.resolveNameLookup(who), this.cfg.caseSensitiveNames);
      if (!p) return { err: 'Player not found.' };
    } else {
      p = findOnlineByNickCi(this.db, ircNick);
      if (!p) return { err: 'Not logged in; use MEDALS <name>.' };
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
    const p = findOnlineByNickCi(this.db, ircNick);
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
  ): { notices: string[]; announcements: GameAnnouncement[] } {
    const notices: string[] = [];
    const announcements: GameAnnouncement[] = [];
    if (!this.canAdmin(ircNick)) {
      return { notices: ['Denied.'], announcements: [] };
    }
    const sub = (parts[1] ?? '').toLowerCase();
    if (!sub || sub === 'help') {
      notices.push('ADMIN: FORCELOGOUT char | RESETPASS char newpassword | STARTQUEST | LUCKY | SAY …');
      return { notices, announcements };
    }
    if (sub === 'forcelogout') {
      const name = parts.slice(2).join(' ').trim();
      if (!name) {
        notices.push('Usage: ADMIN FORCELOGOUT CharacterName');
        return { notices, announcements };
      }
      const r = adminForceLogout(this.db, name, this.cfg.caseSensitiveNames);
      notices.push('err' in r ? r.err : `Forced logout: ${name}.`);
      return { notices, announcements };
    }
    if (sub === 'resetpass' || sub === 'setpass') {
      const charName = parts[2]?.trim();
      const newPass = parts.slice(3).join(' ');
      if (!charName || !newPass.trim()) {
        notices.push('Usage: ADMIN RESETPASS CharacterName newpassword');
        return { notices, announcements };
      }
      const pass = newPass.trim();
      if (pass.length > 128) {
        notices.push('Password too long (max 128).');
        return { notices, announcements };
      }
      const p = findByCharacter(this.db, this.resolveNameLookup(charName), this.cfg.caseSensitiveNames);
      if (!p) {
        notices.push('No such character.');
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
      notices.push('err' in r ? r.err : 'Quest pushed to channel.');
      return { notices, announcements };
    }
    if (sub === 'lucky') {
      adminForceLucky(this.db, this.cfg, announcements);
      notices.push('Lucky hour broadcast.');
      return { notices, announcements };
    }
    if (sub === 'say') {
      const msg = parts.slice(2).join(' ').trim();
      if (!msg) {
        notices.push('Usage: ADMIN SAY …');
        return { notices, announcements };
      }
      announcements.push({ target: 'chan', text: msg });
      notices.push('Sent.');
      return { notices, announcements };
    }
    notices.push('Unknown ADMIN. Try ADMIN HELP.');
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
    if (!rows.length) return 'No players yet.';
    return rows
      .map(
        (r, i) =>
          `#${i + 1} ${r.character_name} lv.${r.level} ${r.class} (${durationIt(r.next_seconds)})`,
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
    return [
      {
        target: 'notice',
        nick: ircNick,
        text: `Penalty ${durationIt(pen)} for speaking in the channel (${msgLen} characters).`,
      },
    ];
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
    return [{ target: 'notice', nick: newNick, text: `Penalty ${durationIt(pen)} for nick change.` }];
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
    } else {
      this.db
        .prepare(
          `UPDATE players SET online = 0, session_open = 0, ${col} = ${col} + ?, next_seconds = next_seconds + ? WHERE id = ?`,
        )
        .run(pen, pen, p.id);
    }
    return [];
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
    return [];
  }

  private applyPenaltyAmount(p: PlayerRow, mult: number): number {
    return this.capPen(Math.floor((mult * penttl(p.level, this.cfg)) / this.cfg.rpbase));
  }

  private capPen(pen: number): number {
    if (this.cfg.limitpen <= 0) return pen;
    return Math.min(pen, this.cfg.limitpen);
  }

  tick(channelNicks: Set<string>): GameAnnouncement[] {
    const now = Math.floor(Date.now() / 1000);
    if (this.lastTick === 0) {
      this.lastTick = now;
      return [];
    }
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (dt <= 0) return [];

    const online = this.db.prepare(`SELECT * FROM players WHERE online = 1`).all() as PlayerRow[];

    const announcements: GameAnnouncement[] = [];

    realmTick(this.db, this.cfg, channelNicks, now, announcements);

    const hogMult = hogChanceMultiplier(this.db, now);

    for (const p of online) {
      if (!p.irc_nick || !ircNickInChannel(p.irc_nick, channelNicks)) continue;

      const rate =
        alignmentIdleRate(p.alignment) * ((p.trinket ?? '').trim() ? 1.003 : 1);
      let next = p.next_seconds - dt * rate;
      let level = p.level;
      const idled = p.idled + dt;

      while (next < 1) {
        const add = Math.floor(ttl(level, this.cfg));
        level += 1;
        next += add;
        const line = levelUpLine(p.character_name, p.class, level, add);
        announcements.push({
          target: 'chan',
          text: line,
        });
        if (isMilestoneLevel(level)) {
          const t = grantMilestoneTrinket(this.db, p.id);
          if (t && p.irc_nick) {
            announcements.push({
              target: 'notice',
              nick: p.irc_nick,
              text: `Charm attuned: ${t} — small idle boost while kept.`,
            });
          }
        }
        checkNewRealmRecord(this.db, p.character_name, level, p.id, announcements);
        for (const mline of medalsForLevel(this.db, p, level)) {
          announcements.push({ target: 'chan', text: mline });
        }
      }

      this.db
        .prepare(`UPDATE players SET level = ?, next_seconds = ?, idled = ? WHERE id = ?`)
        .run(level, next, idled, p.id);
    }

    maybeHandOfGod(this.db, this.cfg, channelNicks, announcements, hogMult);

    return announcements;
  }
}

function loginSuccessNotice(channel: string, row: PlayerRow): string {
  const d = durationIt(row.next_seconds);
  return [
    `OK — you are logged in as character "${row.character_name}" (level ${row.level} ${row.class}).`,
    `Stay in ${channel} so the idle timer runs. Next level in ${d}.`,
    `PM HELP for commands. LOGOUT when you are done (adds a small penalty).`,
  ].join(' ');
}

function pickRegisterWelcome(ircNick: string, name: string, cls: string, rpbase: number): string {
  const d = durationIt(rpbase);
  const o = [
    `✦ A new name hits the ledger: ${ircNick} → ${name}, the ${cls}! First milestone in ${d}.`,
    `Welcome ${ircNick}! ${name} (${cls}) joins the idle war. Next level: ${d}.`,
    `The realm whispers: ${name}, a ${cls}, walks in behind ${ircNick}. Timer: ${d}.`,
  ];
  return o[Math.floor(Math.random() * o.length)]!;
}

function pickLoginWelcome(ircNick: string, charName: string, level: number, cls: string, nextSec: number): string {
  const d = durationIt(nextSec);
  const o = [
    `◇ ${charName} (lv.${level} ${cls}) slips back into the grind via ${ircNick}. Next: ${d}.`,
    `Back in session: ${charName}, the ${cls}, level ${level} — courtesy of ${ircNick}. ${d} to go.`,
    `${ircNick} carries ${charName} online again. ${cls}, level ${level}. Clock: ${d}.`,
  ];
  return o[Math.floor(Math.random() * o.length)]!;
}

function levelUpLine(charName: string, cls: string, level: number, nextSec: number): string {
  const tail = `Next level in ${durationIt(nextSec)}.`;
  if (isMilestoneLevel(level)) {
    const flair = milestoneFlair(level);
    const forms = [
      `◆ ${flair} ◆ ${charName}, the ${cls}, BREACHES LEVEL ${level}! ${tail}`,
      `── ✧ LEVEL ${level} ✧ ── ${charName} (${cls}) breaks through! ${tail}`,
      `⚡ MILESTONE: ${charName} · ${cls} · L${level}. The realm applauds in whispers. ${tail}`,
      `▸ ${charName} ascends to ${level} as a ${cls}! ${flair} ${tail}`,
    ];
    return forms[Math.floor(Math.random() * forms.length)]!;
  }
  const roll = Math.floor(Math.random() * 10);
  if (roll === 0) return `★ ${charName}, the ${cls}, claims level ${level}! ${tail}`;
  if (roll === 1) return `⚔ ${charName} (${cls}) forges onward — now level ${level}. ${tail}`;
  if (roll === 2) return `The idle flame grows: ${charName} is level ${level} ${cls}. ${tail}`;
  if (roll === 3) return `⌛ ${charName} out-waits the clock: level ${level} ${cls}. ${tail}`;
  if (roll === 4) return `Echoes spread: ${charName} has reached level ${level} as ${cls}. ${tail}`;
  if (roll === 5) return `✦ ${charName} · ${cls} · L${level} — another rung on the endless ladder. ${tail}`;
  if (roll === 6) return `Steady. ${charName} (${cls}) hits level ${level} without breaking silence. ${tail}`;
  if (roll === 7) return `Legend update: ${charName}, ${cls}, level ${level}. ${tail}`;
  if (roll === 8) return `${charName} levels up! (${cls}, ${level}) ${tail}`;
  return `${charName}, the ${cls}, reaches level ${level}! ${tail}`;
}

function isMilestoneLevel(level: number): boolean {
  if ([5, 25, 50, 75, 69, 100].includes(level)) return true;
  if (level >= 10 && level < 100 && level % 10 === 0) return true;
  if (level > 100 && level % 25 === 0) return true;
  return false;
}

function milestoneFlair(level: number): string {
  if (level >= 100) return 'MYTHIC';
  if (level >= 75) return 'LEGENDARY QUIET';
  if (level >= 50) return 'VETERAN OF SILENCE';
  if (level >= 25) return 'STORM OF STILLNESS';
  if (level >= 10) return 'ASCENDANT';
  if (level === 69) return 'NICE.';
  return 'AWAKENED';
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
    db.prepare(`UPDATE players SET next_seconds = ? WHERE id = ?`).run(nn, p.id);
    const lines = [
      `★ HoG: the heavens shorten the road for ${p.character_name} (-${durationIt(delta)}).`,
      `★ HoG: luck smiles on ${p.character_name} — timer cut by ${durationIt(delta)}.`,
      `✧ HoG: cosmic lag compensation! ${p.character_name} shaves ${durationIt(delta)} off the wait.`,
      `◆ HoG: the RNG gods smile — ${p.character_name} gains ${durationIt(delta)} of borrowed time back.`,
      `⚡ HoG: ${p.character_name} catches a tailwind (-${durationIt(delta)}).`,
    ];
    announcements.push({
      target: 'chan',
      text: lines[Math.floor(Math.random() * lines.length)]!,
    });
    insertRealmEvent(db, 'hog_win', `${p.character_name} -${durationIt(delta)}`);
    nudgeAlignmentAfterHog(db, p, true);
  } else {
    const nn = p.next_seconds + delta;
    db.prepare(`UPDATE players SET next_seconds = ? WHERE id = ?`).run(nn, p.id);
    const lines = [
      `★ HoG: ${p.character_name} trips on lag (+${durationIt(delta)}).`,
      `★ HoG: the net hiccups; ${p.character_name} waits longer (+${durationIt(delta)}).`,
      `☄ HoG: ${p.character_name} drew the short straw (+${durationIt(delta)}).`,
      `▸ HoG: entropy wins today — ${p.character_name} +${durationIt(delta)}.`,
      `🌩 HoG: rude awakening for ${p.character_name} (+${durationIt(delta)}).`,
    ];
    announcements.push({
      target: 'chan',
      text: lines[Math.floor(Math.random() * lines.length)]!,
    });
    insertRealmEvent(db, 'hog_lose', `${p.character_name} +${durationIt(delta)}`);
    nudgeAlignmentAfterHog(db, p, false);
  }
}
