import dns from 'node:dns';
import net from 'node:net';
import { Client } from 'irc-framework';
import { config } from '../config.js';
import { GameEngine } from '../game/engine.js';
import { buildNickCandidates } from '../nick-candidates.js';
import { randomChannelBanter } from '../game/channel-banter.js';

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

function normNick(n: string): string {
  return n.replace(/^@|%|\+/, '');
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

bot.on('reconnecting', (info: { attempt: number; max_retries: number; wait: number }) => {
  console.warn(`[irc] reconnecting attempt ${info.attempt}/${info.max_retries} in ${info.wait}ms`);
});

bot.on('socket error', (err: unknown) => {
  console.error('[irc] socket error', err);
});

bot.on('close', (hadError?: boolean) => {
  engine.clearBotHeartbeat();
  console.warn(`[irc] connection end${hadError ? ' (had error)' : ''}`);
  /* irc-framework skips auto-reconnect if the socket drops before ~5s after registration (e.g. immediate KILL). Schedule our own reconnect when the client is fully closed. */
  if (forceReconnectTimer) clearTimeout(forceReconnectTimer);
  forceReconnectTimer = setTimeout(() => {
    forceReconnectTimer = null;
    if (bot.connected) return;
    console.warn('[irc] forcing reconnect after close');
    bot.connect(connectOpts as Parameters<Client['connect']>[0]);
  }, 4000 + Math.floor(Math.random() * 2500));
});

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
});

bot.on('part', (event) => {
  if (event.channel.toLowerCase() !== chanLower) return;
  namesInChannel.delete(normNick(event.nick));
  for (const a of engine.onPartQuit(normNick(event.nick), 'part')) {
    deliver(a);
  }
});

bot.on('quit', (event) => {
  namesInChannel.delete(normNick(event.nick));
  for (const a of engine.onPartQuit(normNick(event.nick), 'quit')) {
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
  const sub = m[1]!.toLowerCase();
  const rest = (m[2] ?? '').trim();
  const echo = `${fromNick}:`;

  switch (sub) {
    case 'help':
      bot.say(channel, `${echo} ${engine.helpChannel(1)}`);
      return true;
    case 'cmds':
    case 'commands':
      bot.say(channel, `${echo} ${engine.helpChannel(2)}`);
      return true;
    case 'rules':
      bot.say(
        channel,
        `${echo} Idle to level; talking costs time. PM bot REGISTER/LOGIN. Quests & Lucky Hours fire automatically with enough players.`,
      );
      return true;
    case 'top':
      bot.say(channel, `${echo} ${engine.topN(3)}`);
      return true;
    case 'ping':
      bot.say(channel, `${echo} pong — IdleRPG V1.0 NetIRC`);
      return true;
    case 'time': {
      const nameArg = rest.split(/\s+/).filter(Boolean)[0];
      const s = engine.timeLeft(fromNick, nameArg);
      const line = 'err' in s ? s.err : s.text;
      bot.say(channel, `${echo} ${line}`);
      return true;
    }
    case 'whoami': {
      const s = engine.whoami(fromNick);
      const line = 'err' in s ? s.err : s.text;
      bot.say(channel, `${echo} ${line}`);
      return true;
    }
    case 'records':
      bot.say(channel, `${echo} ${engine.recordsLine()}`);
      return true;
    case 'chronicle':
      bot.say(channel, `${echo} ${engine.chronicleLine()}`);
      return true;
    case 'omen': {
      const o = engine.omenLine(fromNick, namesInChannel);
      bot.say(channel, `${echo} ${'err' in o ? o.err : o.text}`);
      return true;
    }
    case 'duel': {
      const foe = rest.split(/\s+/).filter(Boolean)[0];
      if (!foe) {
        bot.say(
          channel,
          `${echo} Usage: !duel <irc_nick> — arena duel (both logged in, in channel, within ±11 levels).`,
        );
        return true;
      }
      const r = engine.duelLine(fromNick, normNick(foe), namesInChannel);
      if ('err' in r) bot.say(channel, `${echo} ${r.err}`);
      else for (const line of r.lines) bot.say(channel, line);
      return true;
    }
    case 'quest':
      bot.say(channel, `${echo} ${engine.questLine()}`);
      return true;
    case 'stats': {
      const nameArg = rest.split(/\s+/).filter(Boolean)[0];
      const s = engine.stats(fromNick, nameArg);
      const line = 'err' in s ? s.err : s.text;
      bot.say(channel, `${echo} ${line}`);
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
    if (tryPublicChannelCommand(from, event.message)) return;
    for (const a of engine.onChannelMessage(from, event.message.length)) {
      deliver(a);
    }
    return;
  }

  if (!isPrivateToMe(event.target)) return;

  const raw = event.message.replace(/^\u0001|\u0001$/g, '').trim();
  if (raw.toLowerCase() === 'version') {
    bot.notice(from, `\u0001VERSION IdleRPG V1.0 NetIRC\u0001`);
    return;
  }

  if (!allowPmFlood(from)) {
    const wSec = Math.max(1, Math.round(config.pmFloodWindowMs / 1000));
    bot.notice(from, `Slow down: too many private messages in the last ~${wSec}s. Try again shortly.`);
    return;
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const cmd = (parts[0] ?? '').toLowerCase();
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
    const { notices, announcements } = engine.adminCommand(from, parts, namesInChannel);
    for (const n of notices) bot.notice(from, n);
    for (const a of announcements) deliver(a);
    return;
  }

  if (cmd === 'ping') {
    bot.notice(from, 'pong — IdleRPG V1.0 NetIRC');
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
    if (!r.ok) bot.notice(from, r.err);
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
    if (!r.ok) bot.notice(from, r.err);
    else for (const a of r.announcements) deliver(a);
    return;
  }

  if (cmd === 'logout') {
    const r = engine.logout(from);
    if (!r.ok) bot.notice(from, r.err);
    else for (const a of r.announcements) deliver(a);
    return;
  }

  if (cmd === 'stats') {
    const who = rest[0];
    const s = engine.stats(from, who);
    if ('err' in s) bot.notice(from, s.err);
    else bot.notice(from, s.text);
    return;
  }

  if (cmd === 'top') {
    bot.notice(from, engine.top());
    return;
  }

  if (cmd === 'whoami') {
    const s = engine.whoami(from);
    if ('err' in s) bot.notice(from, s.err);
    else bot.notice(from, s.text);
    return;
  }

  if (cmd === 'time') {
    const who = rest[0];
    const s = engine.timeLeft(from, who);
    if ('err' in s) bot.notice(from, s.err);
    else bot.notice(from, s.text);
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

  if (cmd === 'omen') {
    if (!inChan) {
      bot.notice(from, 'OMEN only works while your nick is in the game channel.');
      return;
    }
    const o = engine.omenLine(from, namesInChannel);
    bot.notice(from, 'err' in o ? o.err : o.text);
    return;
  }

  if (cmd === 'duel') {
    if (!inChan) {
      bot.notice(from, 'DUEL only works while your nick is in the game channel.');
      return;
    }
    const foe = rest[0];
    if (!foe) {
      bot.notice(from, 'Usage: DUEL <irc_nick> — same as !duel in channel.');
      return;
    }
    const r = engine.duelLine(from, normNick(foe), namesInChannel);
    if ('err' in r) bot.notice(from, r.err);
    else for (const line of r.lines) bot.notice(from, line);
    return;
  }

  if (cmd === 'quest') {
    bot.notice(from, engine.questLine());
    return;
  }

  bot.notice(from, 'Unknown command. Type HELP or CMDS.');
});

function deliver(a: { target: 'chan' | 'notice'; nick?: string; text: string }) {
  if (a.target === 'chan') {
    bot.say(channel, a.text);
  } else if (a.nick) {
    bot.notice(a.nick, a.text);
  }
}

setInterval(() => {
  for (const a of engine.tick(namesInChannel)) {
    deliver(a);
  }
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
    bot.say(channel, randomChannelBanter());
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
    `[irc] IRPG_IRC_BIND=${config.ircBind} → outgoing TCP/TLS sockets use this local IP. ` +
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
  version: 'IdleRPG V1.0 NetIRC',
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
    : `${nickCandidates.slice(0, 3).join(', ')} … (+${nickCandidates.length - 3})`;
const bindInfo = config.ircBind ? ` bind=${config.ircBind}` : '';
const saslInfo = config.ircSaslAccount && config.ircSaslPassword ? ' SASL' : '';
const banterInfo =
  config.ircChanBanterMs > 0 ? ` | banter every ${Math.round(config.ircChanBanterMs / 1000)}s` : '';
console.log(
  `iodlerpg bot → ${config.ircHost}:${config.ircPort} ${config.ircTls ? '(TLS)' : ''} → ${channel} | nicks: ${preview}${bindInfo}${saslInfo}${banterInfo}`,
);
