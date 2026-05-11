/** Runtime configuration loader and validator for all IRPG_* environment settings. */

import 'dotenv/config';
import { z } from 'zod';

/** Human-readable release id: CTCP VERSION, !ping, default GECOS, banter. Bump when shipping. */
export const IDLE_RPG_VERSION = 'IdleRPG V3.0 NetIRC';

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
  publicUrl: z.string().optional().default('').transform((s: string) => (s ?? '').trim()),
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
  /** Periodically refresh #channel TOPIC with live realm status (requires topic privileges). */
  ircTopicEnabled: z.boolean().default(true),
  ircTopicIntervalSec: z.coerce.number().int().min(30).max(3600).default(180),

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

  /** Master switch for V3 mechanics (daily trial + idle streak). */
  v3ModeEnabled: z.boolean().default(false),
  v3DailyTrialEnabled: z.boolean().default(false),
  v3DailyTrialCooldownSec: z.coerce.number().int().min(300).max(604_800).default(86_400),
  v3DailyTrialRewardSec: z.coerce.number().int().min(10).max(7200).default(180),
  v3DailyTrialPenaltySec: z.coerce.number().int().min(5).max(7200).default(90),
  v3StreakEnabled: z.boolean().default(false),
  v3StreakStepSec: z.coerce.number().int().min(60).max(86_400).default(1800),
  v3StreakRewardSec: z.coerce.number().int().min(1).max(1800).default(15),
  v3BountyEnabled: z.boolean().default(false),
  v3BountyTargetSec: z.coerce.number().int().min(300).max(86_400).default(5400),
  v3BountyRewardSec: z.coerce.number().int().min(10).max(7200).default(180),
  v3BountyQuietSec: z.coerce.number().int().min(0).max(3600).default(120),
  v3SeasonEnabled: z.boolean().default(true),
  v3SeasonEpochSec: z.coerce.number().int().min(0).default(1767225600),
  v3SeasonLengthDays: z.coerce.number().int().min(7).max(120).default(30),
  v3SeasonPassXpPerMinute: z.coerce.number().int().min(1).max(240).default(6),
  v3SeasonTierXp: z.coerce.number().int().min(30).max(100_000).default(600),
  v3WorldBossEnabled: z.boolean().default(true),
  v3WorldBossIntervalSec: z.coerce.number().int().min(600).max(604_800).default(21_600),
  v3WorldBossDurationSec: z.coerce.number().int().min(120).max(86_400).default(5_400),
  v3WorldBossHpPerLevel: z.coerce.number().int().min(1).max(20_000).default(140),
  v3WorldBossRewardSec: z.coerce.number().int().min(5).max(10_800).default(240),
  v3GuildEnabled: z.boolean().default(true),
  v3GuildIdleBonusPct: z.coerce.number().min(0).max(0.25).default(0.01),
  v3RelicEnabled: z.boolean().default(true),
  v3RelicQuestLevyReductionPct: z.coerce.number().min(0).max(0.3).default(0.08),
  v3RelicOmenLuckBonusPct: z.coerce.number().min(0).max(0.3).default(0.07),
  v3RelicStreakBonusPct: z.coerce.number().min(0).max(0.5).default(0.15),
  v3PrestigeEnabled: z.boolean().default(true),
  v3PrestigeMinLevel: z.coerce.number().int().min(20).max(500).default(60),
  v3PrestigeIdleRateBonusPct: z.coerce.number().min(0).max(0.05).default(0.01),
  v3QuestVariantsEnabled: z.boolean().default(true),
  webChronicleFiltersEnabled: z.boolean().default(true),

  /** Max private messages per IRC nick per sliding window; 0 = disable. */
  pmFloodMaxMessages: z.coerce.number().int().min(0).max(500).default(18),
  /** Sliding window (ms) for PM flood counting. */
  pmFloodWindowMs: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
  /** Grace window after likely netsplit QUIT: keep session_open for auto-resume; 0 = disabled. */
  netsplitGraceSec: z.coerce.number().int().min(0).max(21_600).default(0),
  /**
   * Comma- or space-separated IRC nicks (no #channel) allowed to use ADMIN by PM even without a logged-in character.
   * Status prefixes (~&@%+) are ignored when matching.
   */
  adminIrcNicks: z
    .string()
    .optional()
    .default('')
    .transform((s: string) => {
      const t = (s ?? '').trim();
      if (!t) return [] as string[];
      return t
        .split(/[,;\s]+/)
        .map((n) =>
          n
            .trim()
            .replace(/^[~&@%+]+/, '')
            .replace(/^\|/, ''),
        )
        .filter(Boolean);
    }),
  /** Require admin PM commands to come from a nick currently present in the game channel. */
  adminRequireInChannel: z.boolean().default(true),

  /** Optional AI lore integration via Groq (assistive only, never gameplay-critical). */
  aiEnabled: z.boolean().default(false),
  aiGrokApiKey: z.string().optional().default('').transform((s: string) => (s ?? '').trim()),
  aiGrokModel: z.string().default('llama-3.1-8b-instant'),
  aiTimeoutMs: z.coerce.number().int().min(1000).max(30000).default(8000),
  aiMaxTokens: z.coerce.number().int().min(32).max(512).default(120),
  aiLoreCooldownSec: z.coerce.number().int().min(0).max(3600).default(45),
  aiBanterCooldownSec: z.coerce.number().int().min(0).max(86_400).default(900),
});

function load() {
  const raw = {
    publicUrl: decr(process.env.IRPG_PUBLIC_URL) ?? '',
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
    ircTopicEnabled: bool(process.env.IRPG_IRC_TOPIC_ENABLED, true),
    ircTopicIntervalSec: decr(process.env.IRPG_IRC_TOPIC_INTERVAL_SEC),
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
    v3ModeEnabled: bool(process.env.IRPG_V3_MODE_ENABLED, false),
    v3DailyTrialEnabled: bool(process.env.IRPG_V3_DAILY_TRIAL_ENABLED, false),
    v3DailyTrialCooldownSec: decr(process.env.IRPG_V3_DAILY_TRIAL_COOLDOWN_SEC),
    v3DailyTrialRewardSec: decr(process.env.IRPG_V3_DAILY_TRIAL_REWARD_SEC),
    v3DailyTrialPenaltySec: decr(process.env.IRPG_V3_DAILY_TRIAL_PENALTY_SEC),
    v3StreakEnabled: bool(process.env.IRPG_V3_STREAK_ENABLED, false),
    v3StreakStepSec: decr(process.env.IRPG_V3_STREAK_STEP_SEC),
    v3StreakRewardSec: decr(process.env.IRPG_V3_STREAK_REWARD_SEC),
    v3BountyEnabled: bool(process.env.IRPG_V3_BOUNTY_ENABLED, false),
    v3BountyTargetSec: decr(process.env.IRPG_V3_BOUNTY_TARGET_SEC),
    v3BountyRewardSec: decr(process.env.IRPG_V3_BOUNTY_REWARD_SEC),
    v3BountyQuietSec: decr(process.env.IRPG_V3_BOUNTY_QUIET_SEC),
    v3SeasonEnabled: bool(process.env.IRPG_V3_SEASON_ENABLED, true),
    v3SeasonEpochSec: decr(process.env.IRPG_V3_SEASON_EPOCH_SEC),
    v3SeasonLengthDays: decr(process.env.IRPG_V3_SEASON_LENGTH_DAYS),
    v3SeasonPassXpPerMinute: decr(process.env.IRPG_V3_SEASON_PASS_XP_PER_MINUTE),
    v3SeasonTierXp: decr(process.env.IRPG_V3_SEASON_TIER_XP),
    v3WorldBossEnabled: bool(process.env.IRPG_V3_WORLD_BOSS_ENABLED, true),
    v3WorldBossIntervalSec: decr(process.env.IRPG_V3_WORLD_BOSS_INTERVAL_SEC),
    v3WorldBossDurationSec: decr(process.env.IRPG_V3_WORLD_BOSS_DURATION_SEC),
    v3WorldBossHpPerLevel: decr(process.env.IRPG_V3_WORLD_BOSS_HP_PER_LEVEL),
    v3WorldBossRewardSec: decr(process.env.IRPG_V3_WORLD_BOSS_REWARD_SEC),
    v3GuildEnabled: bool(process.env.IRPG_V3_GUILD_ENABLED, true),
    v3GuildIdleBonusPct: decr(process.env.IRPG_V3_GUILD_IDLE_BONUS_PCT),
    v3RelicEnabled: bool(process.env.IRPG_V3_RELIC_ENABLED, true),
    v3RelicQuestLevyReductionPct: decr(process.env.IRPG_V3_RELIC_QUEST_LEVY_REDUCTION_PCT),
    v3RelicOmenLuckBonusPct: decr(process.env.IRPG_V3_RELIC_OMEN_LUCK_BONUS_PCT),
    v3RelicStreakBonusPct: decr(process.env.IRPG_V3_RELIC_STREAK_BONUS_PCT),
    v3PrestigeEnabled: bool(process.env.IRPG_V3_PRESTIGE_ENABLED, true),
    v3PrestigeMinLevel: decr(process.env.IRPG_V3_PRESTIGE_MIN_LEVEL),
    v3PrestigeIdleRateBonusPct: decr(process.env.IRPG_V3_PRESTIGE_IDLE_RATE_BONUS_PCT),
    v3QuestVariantsEnabled: bool(process.env.IRPG_V3_QUEST_VARIANTS_ENABLED, true),
    webChronicleFiltersEnabled: bool(process.env.IRPG_WEB_CHRONICLE_FILTERS_ENABLED, true),
    pmFloodMaxMessages: decr(process.env.IRPG_PM_FLOOD_MAX),
    pmFloodWindowMs: decr(process.env.IRPG_PM_FLOOD_WINDOW_MS),
    netsplitGraceSec: decr(process.env.IRPG_NETSPLIT_GRACE_SEC),
    adminIrcNicks: decr(process.env.IRPG_ADMIN_IRC_NICKS) ?? '',
    adminRequireInChannel: bool(process.env.IRPG_ADMIN_REQUIRE_IN_CHANNEL, true),
    aiEnabled: bool(process.env.IRPG_AI_ENABLED, false),
    aiGrokApiKey:
      decr(process.env.IRPG_AI_GROQ_API_KEY) ??
      decr(process.env.GROQ_API_KEY) ??
      decr(process.env.IRPG_AI_GROK_API_KEY) ??
      '',
    aiGrokModel: decr(process.env.IRPG_AI_GROQ_MODEL) ?? decr(process.env.IRPG_AI_GROK_MODEL),
    aiTimeoutMs: decr(process.env.IRPG_AI_TIMEOUT_MS),
    aiMaxTokens: decr(process.env.IRPG_AI_MAX_TOKENS),
    aiLoreCooldownSec: decr(process.env.IRPG_AI_LORE_COOLDOWN_SEC),
    aiBanterCooldownSec: decr(process.env.IRPG_AI_BANTER_COOLDOWN_SEC),
  };
  return schema.parse(raw);
}

export type AppConfig = z.infer<typeof schema>;
export const config = load();
