/** IRC runtime wiring: command routing, delivery formatting, and connection lifecycle. */

import dns from 'node:dns';
import net from 'node:net';
import { Client } from 'irc-framework';
import { config, IDLE_RPG_VERSION } from '../config.js';
import { GameEngine } from '../game/engine.js';
import { MSG } from '../game/messages.js';
import { buildNickCandidates } from '../nick-candidates.js';
import { randomChannelBanter } from '../game/channel-banter.js';
import { askGrokBanter, askGrokLore } from '../ai/grok.js';
import { chanReplyPrefix, stripStatusPrefix, styleAmbientBanter, styleChannelLine, ircGreen, ircRed } from './channel-style.js';
import type { GameAnnouncement } from '../game/engine.js';

/** IRC user list for the game channel (must be present to earn idle time). */

const engine = new GameEngine(config);
const channel = config.ircChannel;
const channelKey = config.ircChannelKey;
const chanLower = channel.toLowerCase();

const namesInChannel = new Set<string>();

const nickCandidates = buildNickCandidates(config);
const primaryNick = nickCandidates[0] ?? config.ircNick;
/** Next index in nickCandidates to try on 433/436/437/432 (index 0 is used by initial connect). */
let nextNickIdx = 1;
/** Only while connecting: 433 etc. should try the next configured candidate. After registration, failed NICK is ignored (e.g. reclaiming primary still taken). */
let registrationNickFallbackActive = true;

/** Try to take IRPG_IRC_NICK again if we are on an alternate (interval in ms). */
const RECLAIM_PRIMARY_MS = 90_000;

let reclaimPrimaryTimer: ReturnType<typeof setInterval> | null = null;
let forceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastTopicSent = '';
let lastTopicRefreshAttemptMs = 0;
let lastTopicSignal = '';

function normNick(n: string): string {
  return stripStatusPrefix(n);
}

const bot = new Client();

function isPrivateToMe(target: string | undefined): boolean {
  if (!target) return false;
  const me = bot.user.nick;
  if (!me) return false;
  return bot.caseCompare(target, me);
}

/** Sliding-window PM rate limit per IRC nick (CTCP VERSION is excluded earlier). */
const pmFloodTimestamps = new Map<string, number[]>();
const loreLastByNick = new Map<string, number>();
let aiBanterLastAt = 0;
const aiBanterMentionLastByNick = new Map<string, number>();

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * Fairly rotate nick mentions for AI banter:
 * prefer channel nicks that were mentioned least recently.
 */
function pickAiBanterHeroes(channelNicks: Set<string>, botNick: string, max = 6): string[] {
  const candidates = [...channelNicks].filter((n) => !bot.caseCompare(n, botNick));
  if (!candidates.length) return [];
  shuffleInPlace(candidates);
  candidates.sort((a, b) => {
    const ta = aiBanterMentionLastByNick.get(a.toLowerCase()) ?? 0;
    const tb = aiBanterMentionLastByNick.get(b.toLowerCase()) ?? 0;
    return ta - tb;
  });
  const picked = candidates.slice(0, Math.max(1, max));
  const now = Date.now();
  for (const n of picked) {
    aiBanterMentionLastByNick.set(n.toLowerCase(), now);
  }
  return picked;
}

function allowPmFlood(fromNick: string): boolean {
  const max = config.pmFloodMaxMessages;
  if (max <= 0) return true;
  const windowMs = config.pmFloodWindowMs;
  const key = fromNick.toLowerCase();
  const now = Date.now();
  const cutoff = now - windowMs;
  const prev = pmFloodTimestamps.get(key) ?? [];
  const recent = prev.filter((t) => t >= cutoff);
  if (recent.length >= max) {
    pmFloodTimestamps.set(key, recent);
    return false;
  }
  recent.push(now);
  pmFloodTimestamps.set(key, recent);
  return true;
}

function loreCooldownLeftSec(nick: string): number {
  const cd = Math.max(0, config.aiLoreCooldownSec);
  if (cd <= 0) return 0;
  const key = nick.toLowerCase();
  const last = loreLastByNick.get(key) ?? 0;
  if (last <= 0) return 0;
  const left = cd - Math.floor((Date.now() - last) / 1000);
  return Math.max(0, left);
}

function markLoreCooldown(nick: string): void {
  loreLastByNick.set(nick.toLowerCase(), Date.now());
}

async function replyLore(fromNick: string, prompt: string, viaPm: boolean): Promise<void> {
  const left = loreCooldownLeftSec(fromNick);
  if (left > 0) {
    const msg = ircRed(`Lore cooldown active. Try again in ${left}s.`);
    if (viaPm) bot.notice(fromNick, msg);
    else bot.say(channel, `${chanReplyPrefix(fromNick)} ${msg}`);
    return;
  }
  markLoreCooldown(fromNick);
  const asked = prompt.trim() || 'the current realm';
  const out = await askGrokLore(config, asked);
  if (out.ok) {
    const line = styleChannelLine(`AI lore: ${out.text}`);
    if (viaPm) bot.notice(fromNick, line);
    else bot.say(channel, `${chanReplyPrefix(fromNick)} ${line}`);
    return;
  }
  const fallback = styleChannelLine(`AI unavailable right now. ${out.err}`);
  if (viaPm) bot.notice(fromNick, fallback);
  else bot.say(channel, `${chanReplyPrefix(fromNick)} ${fallback}`);
}

/** Server numerics that usually explain a failed JOIN (logged to stderr / bot.log). */
const JOIN_FAIL_NUMERICS = new Set([
  '403', '405', '407', '442', '471', '473', '474', '475', '476', '477', '478', '485',
]);

/** Try another nick when registration rejects the current one. */
const NICK_RETRY_NUMERICS = new Set(['432', '433', '436', '437']);

bot.on('connecting', () => {
  nextNickIdx = 1;
  registrationNickFallbackActive = true;
});

bot.on('raw', (event: { line?: string; from_server?: boolean }) => {
  const line = event.line ?? '';
  if (!event.from_server) return;
  const m = /^:[^ ]+ ([45][0-9][0-9]) /.exec(line);
  const num = m?.[1];
  if (!num) return;
  if (JOIN_FAIL_NUMERICS.has(num)) {
    console.error('[irc]', line);
    return;
  }
  if (NICK_RETRY_NUMERICS.has(num)) {
    console.warn('[irc]', line);
    if (!registrationNickFallbackActive) {
      return;
    }
    if (nextNickIdx >= nickCandidates.length) {
      console.error(`[irc] nick exhausted (${nickCandidates.length} candidates); not changing nick further`);
      return;
    }
    const next = nickCandidates[nextNickIdx]!;
    nextNickIdx += 1;
    console.warn(`[irc] trying nick: ${next}`);
    bot.changeNick(next);
  }
});

function joinGameChannel(): void {
  console.log(`[irc] JOIN ${channel}${channelKey ? ' +key' : ''}`);
  bot.join(channel, channelKey || undefined);
}

bot.on('connected', () => {
  registrationNickFallbackActive = false;
  if (config.ircConnectCmd.trim()) {
    bot.raw(config.ircConnectCmd.trim());
  }
  console.log(`[irc] registered as ${bot.user.nick}`);
  setTimeout(joinGameChannel, 500);
  engine.touchBotHeartbeat();
  if (config.ircTopicEnabled) {
    setTimeout(() => {
      lastTopicSignal = engine.channelTopicSignal();
      refreshChannelTopic(true);
    }, 2000);
  }

  if (!reclaimPrimaryTimer) {
    reclaimPrimaryTimer = setInterval(() => {
      const me = bot.user.nick;
      if (!me || !bot.connected) return;
      if (bot.caseCompare(me, primaryNick)) return;
      console.warn(`[irc] reclaiming primary nick: ${primaryNick}`);
      bot.changeNick(primaryNick);
    }, RECLAIM_PRIMARY_MS);
  }
});

function refreshChannelTopic(force: boolean): void {
  if (!config.ircTopicEnabled) return;
  if (!bot.connected) return;
  const now = Date.now();
  if (!force && now - lastTopicRefreshAttemptMs < 5000) return;
  lastTopicRefreshAttemptMs = now;
  const topic = engine.channelTopicLine();
  if (!topic || topic === lastTopicSent) return;
  lastTopicSent = topic;
  bot.raw(`TOPIC ${channel} :${topic}`);
}

function refreshTopicOnStateChange(): void {
  if (!config.ircTopicEnabled) return;
  const sig = engine.channelTopicSignal();
  if (sig === lastTopicSignal) return;
  lastTopicSignal = sig;
  refreshChannelTopic(true);
}

bot.on('reconnecting', (info: { attempt: number; max_retries: number; wait: number }) => {
  console.warn(`[irc] reconnecting attempt ${info.attempt}/${info.max_retries} in ${info.wait}ms`);
});

bot.on('socket error', (err: unknown) => {
  console.error('[irc] socket error', err);
});

bot.on('close', (hadError?: boolean) => {
  engine.clearBotHeartbeat();
  console.warn(`[irc] connection end${hadError ? ' (had error)' : ''}`);
  lastTopicSent = '';
  /* irc-framework skips auto-reconnect if the socket drops before ~5s after registration (e.g. immediate KILL). Schedule our own reconnect when the client is fully closed. */
  if (forceReconnectTimer) clearTimeout(forceReconnectTimer);
  forceReconnectTimer = setTimeout(() => {
    forceReconnectTimer = null;
    if (bot.connected) return;
    console.warn('[irc] forcing reconnect after close');
    bot.connect(connectOpts as Parameters<Client['connect']>[0]);
  }, 4000 + Math.floor(Math.random() * 2500));
});

/** Cooldown between join onboarding notices per IRC nick (anti-spam on flappy clients). */
const JOIN_ONBOARD_NOTICE_COOLDOWN_MS = 5 * 60 * 1000;
const joinOnboardNoticeLast = new Map<string, number>();

bot.on('join', (event) => {
  const chLower = event.channel.toLowerCase();
  const who = normNick(event.nick);
  const me = bot.user.nick;
  if (me && bot.caseCompare(who, me)) {
    if (chLower !== chanLower) {
      console.warn(`[irc] PART server-injected channel (not game channel): ${event.channel}`);
      setTimeout(() => bot.part(event.channel), 600);
    }
    return;
  }
  if (chLower !== chanLower) return;
  namesInChannel.add(who);
  const resumed = engine.resumeSuspendedSessionOnJoin(who);
  const onboarding = engine.joinOnboardingNotice(who, resumed);
  if (onboarding) {
    const key = who.toLowerCase();
    const now = Date.now();
    if (now - (joinOnboardNoticeLast.get(key) ?? 0) >= JOIN_ONBOARD_NOTICE_COOLDOWN_MS) {
      joinOnboardNoticeLast.set(key, now);
      bot.notice(who, onboarding);
    }
  }
});

bot.on('part', (event) => {
  if (event.channel.toLowerCase() !== chanLower) return;
  const who = normNick(event.nick);
  namesInChannel.delete(who);
  for (const a of engine.onPartQuit(who, 'part')) {
    deliver(a);
  }
});

bot.on('quit', (event) => {
  const who = normNick(event.nick);
  namesInChannel.delete(who);
  for (const a of engine.onPartQuit(who, 'quit')) {
    deliver(a);
  }
});

bot.on('nick', (event) => {
  const oldN = normNick(event.nick);
  const newN = normNick(event.new_nick);
  if (namesInChannel.has(oldN)) {
    namesInChannel.delete(oldN);
    namesInChannel.add(newN);
  }
  for (const a of engine.onNick(oldN, newN)) {
    deliver(a);
  }
});

bot.on('kick', (event) => {
  const chLower = event.channel.toLowerCase();
  const who = normNick(event.kicked);
  const me = bot.user.nick;
  const selfKicked = me && bot.caseCompare(who, me);

  if (chLower === chanLower) {
    namesInChannel.delete(who);
    for (const a of engine.onKick(who)) {
      deliver(a);
    }
  }

  if (selfKicked) {
    if (chLower === chanLower) {
      console.warn('[irc] bot kicked from game channel; rejoin in 5s');
      setTimeout(joinGameChannel, 5000);
    } else {
      console.warn(`[irc] bot kicked from ${event.channel}; leaving (not game channel)`);
    }
  }
});

bot.on('userlist', (event) => {
  if (event.channel.toLowerCase() !== chanLower) return;
  for (const m of event.users || []) {
    namesInChannel.add(normNick(m.nick));
  }
  const n = engine.reconcileOpenSessionsInChannel(namesInChannel, (a, b) => bot.caseCompare(a, b));
  if (n > 0) console.log(`[irc] restored ${n} open session(s) still in channel (bot reconnect)`);
});

/** Channel lines starting with ! — no idle penalty if recognized (interactive). */
function tryPublicChannelCommand(fromNick: string, text: string): boolean {
  const trimmed = text.trim();
  const m = /^!([a-z]+)(.*)$/i.exec(trimmed);
  if (!m) return false;
  engine.resumeSuspendedSessionOnJoin(fromNick);
  const sub = m[1]!.toLowerCase();
  const rest = (m[2] ?? '').trim();
  const replyPfx = chanReplyPrefix(fromNick);

  switch (sub) {
    case 'help':
      bot.say(channel, `${replyPfx} ${engine.helpChannel(1, fromNick)}`);
      return true;
    case 'cmds':
    case 'commands':
      bot.say(channel, `${replyPfx} ${engine.helpChannel(2, fromNick)}`);
      return true;
    case 'rules':
      bot.say(
        channel,
        `${replyPfx} ${styleChannelLine(
          `Idle to gain levels; normal channel chat adds to your level timer. Recognized public !commands do not add level-timer penalty. PM this bot REGISTER or LOGIN while your nick is in this channel. Quests, bounties, seasons, and world boss events start automatically when conditions are met.`,
        )}`,
      );
      return true;
    case 'top':
      bot.say(channel, `${replyPfx} ${engine.topN(3)}`);
      return true;
    case 'ping':
      bot.say(channel, `${replyPfx} ${styleChannelLine(`pong — ${IDLE_RPG_VERSION}`)}`);
      return true;
    case 'lore':
      void replyLore(fromNick, rest, false);
      return true;
    case 'time': {
      const nameArg = rest.split(/\s+/).filter(Boolean)[0];
      const s = engine.timeLeft(fromNick, nameArg);
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'whoami': {
      const s = engine.whoami(fromNick);
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'records':
      bot.say(channel, `${replyPfx} ${engine.recordsLine()}`);
      return true;
    case 'chronicle':
      bot.say(channel, `${replyPfx} ${engine.chronicleLine()}`);
      return true;
    case 'realm':
    case 'pulse':
      bot.say(channel, `${replyPfx} ${engine.realmPulseLine()}`);
      return true;
    case 'omen': {
      const o = engine.omenLine(fromNick, namesInChannel, (a, b) => bot.caseCompare(a, b));
      bot.say(channel, `${replyPfx} ${formatOmenChannel(o)}`);
      return true;
    }
    case 'duel': {
      const foe = rest.split(/\s+/).filter(Boolean)[0];
      if (!foe) {
        bot.say(
          channel,
          `${replyPfx} Usage: ${ircGreen('!duel')} <irc_nick> — both players must be logged in, present in channel, and within ${ircGreen('±11')} levels.`,
        );
        return true;
      }
      const r = engine.duelLine(fromNick, normNick(foe), namesInChannel);
      if ('err' in r) bot.say(channel, `${replyPfx} ${ircRed(r.err)}`);
      else for (const ann of r.announcements) deliver(ann);
      return true;
    }
    case 'gauntlet': {
      const r = engine.gauntletLine(fromNick, namesInChannel);
      if ('err' in r) bot.say(channel, `${replyPfx} ${ircRed(r.err)}`);
      else for (const ann of r.announcements) deliver(ann);
      return true;
    }
    case 'medals':
    case 'badges': {
      const who = rest.split(/\s+/).filter(Boolean)[0];
      const s = engine.medalsLine(fromNick, who);
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'quest':
      bot.say(channel, `${replyPfx} ${engine.questLine()}`);
      return true;
    case 'bounty': {
      const s = engine.bountyLine(fromNick);
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'season': {
      const s = engine.seasonLine(fromNick);
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'boss': {
      const s = engine.bossLine();
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'guild': {
      const s = engine.guildLine(fromNick, rest.split(/\s+/).filter(Boolean));
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'relic': {
      const s = engine.relicLine(fromNick, rest.split(/\s+/).filter(Boolean));
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'prestige': {
      const parts = rest.split(/\s+/).filter(Boolean);
      const s = engine.prestigeLine(fromNick, (parts[0] ?? '').toLowerCase() === 'now');
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    case 'stats': {
      const nameArg = rest.split(/\s+/).filter(Boolean)[0];
      const s = engine.stats(fromNick, nameArg);
      bot.say(channel, `${replyPfx} ${formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s)}`);
      return true;
    }
    default:
      return false;
  }
}

bot.on('message', (event) => {
  const target = event.target?.toLowerCase();
  const from = normNick(event.nick);
  const isChanMsg =
    target === chanLower &&
    (event.type === 'privmsg' || event.type === 'notice') &&
    !event.message.startsWith('\u0001');

  if (isChanMsg) {
    // Strict streak rule: any channel activity (including !commands) breaks idle streak.
    engine.noteChannelActivity(from);
    if (tryPublicChannelCommand(from, event.message)) return;
    for (const a of engine.onChannelMessage(from, event.message.length)) {
      deliver(a);
    }
    return;
  }

  if (!isPrivateToMe(event.target)) return;

  const raw = event.message.replace(/^\u0001|\u0001$/g, '').trim();
  if (raw.toLowerCase() === 'version') {
    bot.notice(from, `\u0001VERSION ${IDLE_RPG_VERSION}\u0001`);
    return;
  }

  if (!allowPmFlood(from)) {
    const wSec = Math.max(1, Math.round(config.pmFloodWindowMs / 1000));
    bot.notice(from, ircRed(`Slow down: too many private messages in the last ~${wSec}s. Try again shortly.`));
    return;
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  let cmd = (parts[0] ?? '').toLowerCase();
  cmd = cmd.replace(/^[.\\/]+/, '');
  const rest = parts.slice(1);

  const inChan = namesInChannel.has(from);
  const uh = `${event.nick}!${event.ident}@${event.hostname}`;

  if (cmd === 'cmds' || cmd === 'commands') {
    bot.notice(from, engine.helpPm(2));
    return;
  }

  if (cmd === 'help') {
    bot.notice(from, engine.helpPm(1));
    return;
  }

  if (cmd === 'admin') {
    const { notices, announcements, requestShutdown } = engine.adminCommand(from, parts, namesInChannel);
    for (const n of notices) bot.notice(from, formatAdminPmNotice(n));
    for (const a of announcements) deliver(a);
    if (requestShutdown) scheduleIrcShutdown();
    return;
  }

  if (cmd === 'ping') {
    bot.notice(from, `pong — ${IDLE_RPG_VERSION}`);
    return;
  }

  if (cmd === 'lore') {
    void replyLore(from, rest.join(' '), true);
    return;
  }

  if (cmd === 'register') {
    if (rest.length < 3) {
      bot.notice(
        from,
        'REGISTER — private message to me, while your nick is in the game channel. Format: REGISTER CharacterName Password ClassWords',
      );
      bot.notice(
        from,
        'Example: REGISTER Alice hunter123 Forest Ranger  (password must be a single word — no spaces)',
      );
      return;
    }
    const rName = rest[0]!;
    const rPass = rest[1]!;
    const pclass = rest.slice(2).join(' ').trim();
    const r = engine.register(from, uh, rName, rPass, pclass, inChan);
    if (!r.ok) bot.notice(from, ircRed(r.err));
    else for (const a of r.announcements) deliver(a);
    return;
  }

  if (cmd === 'login') {
    if (rest.length < 2) {
      bot.notice(
        from,
        'LOGIN — private message to me, while your nick is in the game channel. Format: LOGIN CharacterName Password',
      );
      bot.notice(from, 'Example: LOGIN Alice hunter123');
      return;
    }
    const [lName, lPass] = rest;
    const r = engine.login(from, uh, lName!, lPass!, inChan);
    if (!r.ok) bot.notice(from, ircRed(r.err));
    else for (const a of r.announcements) deliver(a);
    return;
  }

  if (cmd === 'logout') {
    const r = engine.logout(from);
    if (!r.ok) bot.notice(from, ircRed(r.err));
    else for (const a of r.announcements) deliver(a);
    return;
  }

  if (cmd === 'stats') {
    const who = rest[0];
    const s = engine.stats(from, who);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'top') {
    bot.notice(from, engine.top());
    return;
  }

  if (cmd === 'whoami') {
    const s = engine.whoami(from);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'time') {
    const who = rest[0];
    const s = engine.timeLeft(from, who);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'records') {
    bot.notice(from, engine.recordsLine());
    return;
  }

  if (cmd === 'chronicle') {
    bot.notice(from, engine.chronicleLine());
    return;
  }

  if (cmd === 'realm' || cmd === 'pulse') {
    bot.notice(from, engine.realmPulseLine());
    return;
  }

  if (cmd === 'omen') {
    if (!inChan) {
      bot.notice(
        from,
        ircRed(`OMEN requires your nick in ${channel}. Join the game channel, stay visible, then try again.`),
      );
      return;
    }
    const o = engine.omenLine(from, namesInChannel, (a, b) => bot.caseCompare(a, b));
    bot.notice(from, formatOmenChannel(o));
    return;
  }

  if (cmd === 'duel') {
    if (!inChan) {
      bot.notice(
        from,
        ircRed(`DUEL requires your nick in ${channel}. Join the game channel, stay visible, then try again.`),
      );
      return;
    }
    const foe = rest[0];
    if (!foe) {
      bot.notice(from, 'Usage: DUEL <irc_nick> — same rules as !duel in channel (logged in, present, ±11 levels).');
      return;
    }
    const r = engine.duelLine(from, normNick(foe), namesInChannel);
    if ('err' in r) bot.notice(from, ircRed(r.err));
    else for (const ann of r.announcements) deliver({ ...ann, target: 'notice', nick: from });
    return;
  }

  if (cmd === 'gauntlet') {
    if (!inChan) {
      bot.notice(
        from,
        ircRed(`GAUNTLET requires your nick in ${channel}. Join the game channel, stay visible, then try again.`),
      );
      return;
    }
    const r = engine.gauntletLine(from, namesInChannel);
    if ('err' in r) bot.notice(from, ircRed(r.err));
    else for (const ann of r.announcements) deliver({ ...ann, target: 'notice', nick: from });
    return;
  }

  if (cmd === 'medals' || cmd === 'badges') {
    const who = rest[0];
    const s = engine.medalsLine(from, who);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'quest') {
    bot.notice(from, engine.questLine());
    return;
  }

  if (cmd === 'bounty') {
    const s = engine.bountyLine(from);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'season') {
    const s = engine.seasonLine(from);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'boss') {
    const s = engine.bossLine();
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'guild') {
    const s = engine.guildLine(from, rest);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'relic') {
    const s = engine.relicLine(from, rest);
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  if (cmd === 'prestige') {
    const s = engine.prestigeLine(from, (rest[0] ?? '').toLowerCase() === 'now');
    bot.notice(from, formatEngineUserLine('err' in s ? s.err : s.text, 'err' in s));
    return;
  }

  bot.notice(from, ircRed(MSG.unknownPmCommand));
});

function formatAnnouncement(a: GameAnnouncement): string {
  if (a.preStyled) return a.text;
  if (a.tone === 'gain') return ircGreen(a.text);
  if (a.tone === 'loss') return ircRed(a.text);
  return styleChannelLine(a.text);
}

function formatOmenChannel(
  o: { err: string } | { text: string; tone?: 'gain' | 'loss' | 'neutral' },
): string {
  if ('err' in o) return ircRed(o.err);
  if (o.tone === 'gain') return ircGreen(o.text);
  if (o.tone === 'loss') return ircRed(o.text);
  return styleChannelLine(o.text);
}

/** User-facing engine copy: errors in red; normal replies get channel line styling (PM or #channel). */
function formatEngineUserLine(text: string, isErr: boolean): string {
  return isErr ? ircRed(text) : styleChannelLine(text);
}

/** PM replies for ADMIN: errors in red, clear successes in green, help text plain. */
function formatAdminPmNotice(text: string): string {
  if (
    text.startsWith('Admin: access denied') ||
    text.startsWith('Unknown ADMIN') ||
    text.startsWith('Usage:') ||
    text.startsWith('Password exceeds') ||
    text.startsWith('Character not found.') ||
    text.startsWith('Character not online.') ||
    text.startsWith('Not enough players') ||
    text.startsWith('Quests disabled') ||
    text.startsWith('A quest is already')
  ) {
    return ircRed(text);
  }
  if (
    text.startsWith('Deleted "') ||
    text.startsWith('Password reset for ') ||
    text.startsWith('Session closed for ') ||
    text === 'Quest started in channel.' ||
    text === 'Lucky hour announced in channel.' ||
    text === 'Message sent to channel.'
  ) {
    return ircGreen(text);
  }
  return text;
}

/** After ADMIN SHUTDOWN: one line in channel, QUIT, clear heartbeat, exit Node (restart via host / systemd / scripts). */
function scheduleIrcShutdown(): void {
  const quitReason = 'IdleRPG admin shutdown';
  try {
    if (bot.connected) {
      bot.say(
        channel,
        '⌛ IdleRPG is going offline (admin shutdown). Level timers pause until the bot is running again.',
      );
    }
  } catch {
    /* ignore */
  }
  engine.clearBotHeartbeat();
  setTimeout(() => {
    try {
      if (bot.connected) {
        const safe = quitReason.replace(/\r\n/g, ' ').replace(/\n/g, ' ').slice(0, 120);
        bot.raw(`QUIT :${safe}`);
      }
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 1500);
  }, 600);
}

function deliver(a: GameAnnouncement) {
  if (a.target === 'chan') {
    bot.say(channel, formatAnnouncement(a));
  } else if (a.nick) {
    bot.notice(a.nick, formatAnnouncement(a));
  }
}

setInterval(() => {
  for (const a of engine.tick(namesInChannel)) {
    deliver(a);
  }
  refreshTopicOnStateChange();
}, config.selfClockMs);

/** Site reads `meta.bot_last_seen_ms`; refresh while socket is up, clear on disconnect. */
const BOT_HEARTBEAT_MS = 30_000;
setInterval(() => {
  if (!bot.connected) return;
  engine.touchBotHeartbeat();
}, BOT_HEARTBEAT_MS);

if (config.ircChanBanterMs > 0) {
  setInterval(() => {
    if (!bot.connected) return;
    const me = bot.user.nick;
    if (!me) return;
    if (namesInChannel.size < 1) return;

    const hint = engine.channelHint(namesInChannel, (a, b) => bot.caseCompare(a, b), me);
    if (hint && Math.random() < 0.5) {
      bot.say(channel, `${chanReplyPrefix(hint.nick)} ${hint.body}`);
      return;
    }
    const now = Date.now();
    const aiReady =
      config.aiEnabled &&
      config.aiBanterCooldownSec > 0 &&
      now - aiBanterLastAt >= config.aiBanterCooldownSec * 1000 &&
      Math.random() < 0.35;
    if (aiReady) {
      aiBanterLastAt = now;
      const heroes = pickAiBanterHeroes(namesInChannel, me, 6);
      void askGrokBanter(config, heroes).then((out) => {
        if (out.ok) {
          bot.say(channel, styleAmbientBanter(out.text));
          return;
        }
        bot.say(channel, styleAmbientBanter(randomChannelBanter()));
      });
      return;
    }
    bot.say(channel, styleAmbientBanter(randomChannelBanter()));
  }, config.ircChanBanterMs);
}

/** Prefer the same address family as the bind IP so `localAddress` is honored (Node happy-eyeballs / dual-stack). */
if (config.ircBind) {
  if (net.isIPv4(config.ircBind)) {
    dns.setDefaultResultOrder('ipv4first');
  } else if (net.isIPv6(config.ircBind)) {
    dns.setDefaultResultOrder('ipv6first');
  }
  console.log(
    `[irc] IRPG_IRC_BIND=${config.ircBind} -> outgoing TCP/TLS sockets use this local IP. ` +
      `IRC still sees your public/WAN IP unless this host has that address on an interface (no NAT).`,
  );
}

const connectOpts: Record<string, unknown> = {
  host: config.ircHost,
  port: config.ircPort,
  tls: config.ircTls,
  password: config.ircPassword || undefined,
  nick: nickCandidates[0] ?? config.ircNick,
  username: config.ircUser,
  gecos: config.ircGecos,
  /** CTCP VERSION reply (irc-framework default is node.js irc-framework). */
  version: IDLE_RPG_VERSION,
  auto_reconnect: true,
  auto_reconnect_max_retries: 100,
  auto_reconnect_max_wait: 600_000,
  ping_interval: 45,
  ping_timeout: 300,
};

if (config.ircBind) {
  connectOpts.outgoing_addr = config.ircBind;
}
if (config.ircSaslAccount && config.ircSaslPassword) {
  connectOpts.account = {
    account: config.ircSaslAccount,
    password: config.ircSaslPassword,
  };
}

bot.connect(connectOpts as Parameters<Client['connect']>[0]);

const preview =
  nickCandidates.length <= 3
    ? nickCandidates.join(', ')
    : `${nickCandidates.slice(0, 3).join(', ')} ... (+${nickCandidates.length - 3})`;
const bindInfo = config.ircBind ? ` bind=${config.ircBind}` : '';
const saslInfo = config.ircSaslAccount && config.ircSaslPassword ? ' SASL' : '';
const banterInfo =
  config.ircChanBanterMs > 0 ? ` | banter every ${Math.round(config.ircChanBanterMs / 1000)}s` : '';
console.log(
  `idlerpg bot -> ${config.ircHost}:${config.ircPort} ${config.ircTls ? '(TLS)' : ''} -> ${channel} | nicks: ${preview}${bindInfo}${saslInfo}${banterInfo}`,
);
