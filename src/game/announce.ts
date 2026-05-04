/** Bot output: channel vs PM, optional IRC coloring (mIRC 3/4). */

export type GameAnnouncement = {
  target: 'chan' | 'notice';
  nick?: string;
  text: string;
  /** Whole line green (gain) or red (loss) before other styling. */
  tone?: 'gain' | 'loss' | 'neutral';
  /** Text already contains IRC color codes — skip styleChannelLine. */
  preStyled?: boolean;
};
