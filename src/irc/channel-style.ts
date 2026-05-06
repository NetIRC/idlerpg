/** mIRC-style color and bold formatting for public channel PRIVMSG.
 *  Palette: only “dark” mIRC codes (02–06) — navy, green, red, brown, purple.
 *  Avoids 08 yellow and light/high codes 09–15 so lines stay readable and non-glaring.
 */

const RESET = '\x0f';
const BOLD = '\x02';

/** mIRC foreground: 02 blue, 03 green, 04 red, 05 brown, 06 purple */
function color(fg: number, text: string): string {
  return `\x03${fg}${text}${RESET}`;
}

/** Favorable outcomes (timer reduced, level up, wins) — mIRC 03 green. */
export function ircGreen(text: string): string {
  return color(3, text);
}

/** Penalties, timer extensions, defeats — mIRC 04 red. */
export function ircRed(text: string): string {
  return color(4, text);
}

/** Quest result: one line, two colored clauses (preStyled for PRIVMSG). */
export function formatQuestEndLine(
  winTeam: string,
  loseTeam: string,
  s0: number,
  s1: number,
  bonusLabel: string,
  penaltyLabel: string,
  winnersApplied: number,
  losersApplied: number,
): string {
  return (
    `⚔ Quest result: ${winTeam} wins (${s0}–${s1}) over ${loseTeam}. ` +
    `${ircGreen(`Each winner: level timer reduced by -${bonusLabel} (${winnersApplied} applied).`)} ` +
    `${ircRed(`Each loser: level timer increased by +${penaltyLabel} (quest levy, ${losersApplied} applied).`)}`
  );
}

/** Duel: timer snapshot after fight (preStyled). */
export function formatDuelTimers(
  winnerName: string,
  loserName: string,
  winnerDeltaLabel: string,
  loserDeltaLabel: string,
  winnerNextLabel: string,
  loserNextLabel: string,
): string {
  return (
    `${ircGreen(`${winnerName}: -${winnerDeltaLabel}, next level in ${winnerNextLabel}.`)} ` +
    `${ircRed(`${loserName}: +${loserDeltaLabel}, next level in ${loserNextLabel}.`)}`
  );
}

/** Strip channel status prefix from NAMES / PRIVMSG source. */
export function stripStatusPrefix(nick: string): string {
  return nick.replace(/^[~&@%+]+/, '').replace(/^\|/, '');
}

/** Colored "Nick:" before public !command replies; identical styling for every nick. */
export function chanReplyPrefix(nickNorm: string): string {
  return `${color(2, nickNorm)}:`;
}

export function styleChannelLine(text: string): string {
  if (text.length > 450) return text;
  const first = text[0];
  if (!first) return text;

  const leadColors: Record<string, number> = {
    '⚔': 5,
    '◇': 6,
    '✦': 2,
    '◆': 4,
    '⚡': 5,
    '★': 5,
    '⌛': 3,
    '▸': 3,
    '─': 6,
    '✧': 6,
    '▪': 2,
    '⟡': 5,
  };
  const fg = leadColors[first];
  if (fg === undefined) {
    if (text.startsWith('IdleRPG') || text.startsWith('The ledger') || text.startsWith('NetIRC')) {
      return `${color(2, text.slice(0, 1))}${color(6, text.slice(1))}`;
    }
    return text;
  }
  return `\x03${fg}${BOLD}${first}${RESET}\x03${fg}${text.slice(1)}${RESET}`;
}

export function styleAmbientBanter(text: string): string {
  return `${color(5, '»')}${RESET} ${color(3, text)}`;
}
