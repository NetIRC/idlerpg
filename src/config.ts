import 'dotenv/config';
import { z } from 'zod';

/** Human-readable release id: CTCP VERSION, !ping, default GECOS, banter. Bump when shipping. */
export const IDLE_RPG_VERSION = 'IdleRPG V2.0 NetIRC';

/** Environment loaded from process.env (IRPG_*), validated with zod. */

/** Strip CR from values (Windows CRLF in `.env` breaks hostnames, numbers, booleans on Linux). */
function decr(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.replace(/\r/g, '');
}

const bool = (v: string | undefined, d: boolean) => {
  const t = decr(v);
  return t === undefined || t === '' ? d : ['1', 'true', 'yes', 'on'].includes(t.toLowerCase());
};

/** Ensure #chan (or &); many .env typos omit # so JOIN never hits a real channel. */
function normalizeIrcChannel(raw: string, fallback: string): string {
  const t = raw.trim();
  if (!t) return fallback;
  if (/^[#&+!]/.test(t)) return t;
  return `#${t}`;
}

/** Strip [ ] around IPv6 literals for Node.js net (host / bind). */
function normalizeIpcBracket(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('[') && t.endsWith(']') && t.length > 2) {
    return t.slice(1, -1);
  }
  return t;
}

/** Legacy typo in DB filename: iodlerpg.db → idlerpg.db. */
function normalizeSqliteDbFilename(p: string): string {
  const t = p.trim();
  if (t === '') return t;
  const fixed = t.replace(/iodlerpg\.db$/i, 'idlerpg.db');
  if (fixed !== t) {
    console.warn(
      '[config] IRPG_DB_PATH used legacy filename "iodlerpg.db"; using idlerpg.db. Update .env when convenient.',
    );
  }
  return fixed;
}

const schema = z.object({
  ircHost: z
    .string()
    .default('chat.netirc.eu')
    .transform((s: string) => normalizeIpcBracket(s)),
  ircPort: z.coerce.number().default(6667),
  ircTls: z.boolean().default(false),
  ircPassword: z.string().optional().default(''),
  /** Local address to bind the outbound IRC socket (IPv4, IPv6, or [IPv6]). Empty = OS chooses. */
  ircBind: z
    .string()
    .optional()
    .default('')
    .transform((s: string) => {
      const t = (s ?? '').trim();
      return t === '' ? '' : normalizeIpcBracket(t);
    }),
  /** SASL PLAIN: services account + password. Both set → SASL login (e.g. registered bot nick). */
  ircSaslAccount: z.string().optional().default('').transform((s: string) => (s ?? '').trim()),
  ircSaslPassword: z.string().optional().default('').transform((s: string) => (s ?? '').trim()),
  ircNick: z.string().default('IdleRPG'),
  /** Comma-separated nicks to try if the primary is taken (before auto Primary_1, _2, …). */
  ircAltNicks: z.string().optional().default('').transform((s: string) => s ?? ''),
  /** How many auto suffix nicks to generate: Nick_1 … Nick_N (after explicit alts). */
  ircNickSuffixMax: z.coerce.number().min(0).max(50).default(12),
  /** Truncate generated / configured nicks to this length (network limit is often ~30). */
  ircNickMaxLen: z.coerce.number().min(9).max(32).default(27),
  ircUser: z.string().default('idle'),
  ircGecos: z.string().default(IDLE_RPG_VERSION),
  ircChannel: z
    .string()
    .default('#IdleRPG')
    .transform((s: string) => normalizeIrcChannel(s, '#IdleRPG')),
  ircChannelKey: z
    .string()
    .optional()
    .default('')
    .transform((s: string) => (s ?? '').trim()),
  ircConnectCmd: z.string().optional().default(''),
  rpbase: z.coerce.number().default(600),
  rpstep: z.coerce.number().default(1.16),
  rppenstep: z.coerce.number().default(1.14),
  limitpen: z.coerce.number().default(604800),
  selfClockMs: z.coerce.number().default(1000),
  caseSensitiveNames: z.boolean().default(true),
  dbPath: z
    .string()
    .default('./data/idlerpg.db')
    .transform((s: string) => normalizeSqliteDbFilename(s)),
  apiPort: z.coerce.number().default(3847),
  apiHost: z.string().default('127.0.0.1'),
  corsOrigin: z.string().default('http://localhost:5173'),
  ownerAccount: z.string().optional().default(''),
  hogChance: z.coerce.number().min(0).max(1).default(0.0008),
  /** Milliseconds between optional ambient lines in the game channel; 0 = disabled. */
  ircChanBanterMs: z.coerce.number().min(0).max(3_600_000).default(420_000),

  questEnabled: z.boolean().default(true),
  questMinPlayers: z.coerce.number().min(2).max(40).default(4),
  questDurationSec: z.coerce.number().min(120).max(86_400).default(600),
  questCooldownSec: z.coerce.number().min(300).max(1_209_600).default(2700),
  /** Per-tick probability to start a quest once `quest_next_at` has passed (typ. 0.0001–0.001). */
  questStartChance: z.coerce.number().min(0).max(1).default(0.00035),
  /** Winner reward ≈ `rpbase * questWinnerBonusMult` seconds shaved (capped by limitpen). */
  questWinnerBonusMult: z.coerce.number().min(0.5).max(20).default(3.5),
  questLoserPenaltyMult: z.coerce.number().min(0.5).max(20).default(2),

  luckyHourEnabled: z.boolean().default(true),
  luckyHourDurationSec: z.coerce.number().min(120).max(7200).default(540),
  /** Rolled roughly every ~100s; typical 0.05–0.15. */
  luckyHourRollChance: z.coerce.number().min(0).max(1).default(0.1),

  /** Max private messages per IRC nick per sliding window; 0 = disable. */
  pmFloodMaxMessages: z.coerce.number().int().min(0).max(500).default(18),
  /** Sliding window (ms) for PM flood counting. */
  pmFloodWindowMs: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
});

function load() {
  const raw = {
    ircHost: decr(process.env.IRPG_IRC_HOST),
    ircPort: decr(process.env.IRPG_IRC_PORT),
    ircTls: bool(process.env.IRPG_IRC_TLS, false),
    ircPassword: decr(process.env.IRPG_IRC_PASSWORD) ?? '',
    ircBind: decr(process.env.IRPG_IRC_BIND) ?? '',
    ircSaslAccount: decr(process.env.IRPG_IRC_SASL_ACCOUNT) ?? '',
    ircSaslPassword: decr(process.env.IRPG_IRC_SASL_PASSWORD) ?? '',
    ircNick: decr(process.env.IRPG_IRC_NICK),
    ircAltNicks: decr(process.env.IRPG_IRC_ALT_NICKS) ?? '',
    ircNickSuffixMax: decr(process.env.IRPG_IRC_NICK_SUFFIX_MAX),
    ircNickMaxLen: decr(process.env.IRPG_IRC_NICK_MAX_LEN),
    ircUser: decr(process.env.IRPG_IRC_USER),
    ircGecos: decr(process.env.IRPG_IRC_GECOS),
    ircChannel: decr(process.env.IRPG_IRC_CHANNEL),
    ircChannelKey: decr(process.env.IRPG_IRC_CHANNEL_KEY) ?? '',
    ircConnectCmd: decr(process.env.IRPG_IRC_CONNECT_CMD) ?? '',
    rpbase: decr(process.env.IRPG_RPBASE),
    rpstep: decr(process.env.IRPG_RPSTEP),
    rppenstep: decr(process.env.IRPG_RPPENSTEP),
    limitpen: decr(process.env.IRPG_LIMITPEN),
    selfClockMs: decr(process.env.IRPG_SELF_CLOCK_MS),
    caseSensitiveNames: bool(process.env.IRPG_CASE_SENSITIVE_NAMES, true),
    dbPath: decr(process.env.IRPG_DB_PATH),
    apiPort: decr(process.env.IRPG_API_PORT),
    apiHost: decr(process.env.IRPG_API_HOST),
    corsOrigin: decr(process.env.IRPG_CORS_ORIGIN),
    ownerAccount: decr(process.env.IRPG_OWNER_ACCOUNT) ?? '',
    hogChance: decr(process.env.IRPG_HOG_CHANCE),
    ircChanBanterMs: decr(process.env.IRPG_IRC_CHAN_BANTER_MS),
    questEnabled: bool(process.env.IRPG_QUEST_ENABLED, true),
    questMinPlayers: decr(process.env.IRPG_QUEST_MIN_PLAYERS),
    questDurationSec: decr(process.env.IRPG_QUEST_DURATION_SEC),
    questCooldownSec: decr(process.env.IRPG_QUEST_COOLDOWN_SEC),
    questStartChance: decr(process.env.IRPG_QUEST_START_CHANCE),
    questWinnerBonusMult: decr(process.env.IRPG_QUEST_WINNER_MULT),
    questLoserPenaltyMult: decr(process.env.IRPG_QUEST_LOSER_MULT),
    luckyHourEnabled: bool(process.env.IRPG_LUCKY_HOUR_ENABLED, true),
    luckyHourDurationSec: decr(process.env.IRPG_LUCKY_HOUR_DURATION_SEC),
    luckyHourRollChance: decr(process.env.IRPG_LUCKY_HOUR_CHANCE),
    pmFloodMaxMessages: decr(process.env.IRPG_PM_FLOOD_MAX),
    pmFloodWindowMs: decr(process.env.IRPG_PM_FLOOD_WINDOW_MS),
  };
  return schema.parse(raw);
}

export type AppConfig = z.infer<typeof schema>;
export const config = load();
