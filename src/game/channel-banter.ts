/** Occasional ambient lines in the game channel (IdleRPG / NetIRC vibe). */

const LINES = [
  'The ledger ticks. Only silence compounds interest here.',
  'In this realm, every spoken word taxes destiny. !rules for the quiet path.',
  'NetIRC watches. Idle heroes, your timers are running.',
  'Shh. Someone out there is about to level.',
  'The bot remembers every penalty and every patient second. Stay sharp — or stay silent.',
  '!help · !top · !stats — free whispers in channel. Normal lines cost time.',
  'Classic IdleRPG energy: less chat, more legend.',
  'Hand of God might bless you. Or roast your ping. Such is life on IRC.',
  'REGISTER / LOGIN in private. The channel is for the grind, not the signup desk.',
  'Silence isn’t empty — it’s the main quest.',
  'The scoreboard at idlerpg.netirc.eu reads the same SQLite the bot does.',
  'Part the channel while logged in? The timer feels that. So does your pride.',
  'Level caps are for other games. Here, the ceiling is your patience.',
  'One day you’ll explain to a normie that typing less was how you won.',
  'IRC never died. It leveled up in the shadows.',
  'Whisper LOGIN to me if you dare return to the idle throne.',
  'Even forests and rangers need to shut up sometimes. Especially rangers.',
  'The realm hums on port 6667. The drama runs on pure quiet.',
  'Penalties are temporary. Levels are… also temporary. But cooler.',
  'Your next level is a stack of seconds. No microtransactions. Just time.',
  'IdleRPG V1.0 NetIRC — where AFK is a competitive sport.',
  'Someone just tallied another idle minute. Was it you?',
  'The channel topic is optional. The timer is not.',
  'Quest logs are out. Timer logs are in.',
];

export function randomChannelBanter(): string {
  return LINES[Math.floor(Math.random() * LINES.length)]!;
}
