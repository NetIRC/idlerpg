/** Centralized user-facing copy for consistent professional tone (V3). */

export const MSG = {
  unknownPmCommand: 'Unknown command. Send HELP or CMDS for the command list.',
  activeSessionRequired: 'No active session. PM LOGIN <CharacterName> <Password> while in the game channel.',
  notLoggedInStats: 'Not logged in. Use !stats <character_name> to look up another player.',
  notLoggedInTime: 'Not logged in. Use !time <character_name> to query another player.',
  notLoggedInMedals: 'Not logged in. Use !medals <character_name> to view another player.',
  nickAlreadyLinked:
    'This IRC nick is already linked to another character. Log in with that character or switch IRC nick before REGISTER.',
} as const;
