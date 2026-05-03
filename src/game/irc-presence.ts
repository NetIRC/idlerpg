/**
 * True if stored `irc_nick` matches someone in the live NAMES set (strip @%+).
 * Falls back to ASCII case-insensitive compare when exact string differs (LOGIN vs NAMES casing).
 */
export function ircNickInChannel(nick: string | undefined | null, channelNicks: Set<string>): boolean {
  if (!nick) return false;
  const raw = nick.replace(/^@|%|\+/, '');
  if (channelNicks.has(raw)) return true;
  const low = raw.toLowerCase();
  for (const n of channelNicks) {
    if (n.toLowerCase() === low) return true;
  }
  return false;
}
