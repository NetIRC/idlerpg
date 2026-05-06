import { stripStatusPrefix } from '../irc/channel-style.js';

/** Normalize IRC nick from NAMES/user prefixes before comparison. */
export function normalizeIrcNick(nick: string | undefined | null): string {
  if (!nick) return '';
  return stripStatusPrefix(nick.trim());
}

/**
 * True if stored `irc_nick` matches someone in the live NAMES set.
 * Falls back to ASCII case-insensitive compare when exact string differs.
 */
export function ircNickInChannel(nick: string | undefined | null, channelNicks: Set<string>): boolean {
  const raw = normalizeIrcNick(nick);
  if (!raw) return false;
  if (channelNicks.has(raw)) return true;
  const low = raw.toLowerCase();
  for (const n of channelNicks) {
    if (normalizeIrcNick(n).toLowerCase() === low) return true;
  }
  return false;
}

/** Case-aware helper used by modules that already have an IRC equality callback. */
export function ircNickInChannelWithCase(
  nick: string | undefined | null,
  channelNicks: Set<string>,
  caseEq: (a: string, b: string) => boolean,
): boolean {
  const raw = normalizeIrcNick(nick);
  if (!raw) return false;
  for (const n of channelNicks) {
    if (caseEq(normalizeIrcNick(n), raw)) return true;
  }
  return false;
}
