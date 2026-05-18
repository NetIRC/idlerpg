<?php
declare(strict_types=1);

/** Load IRPG_* values from getenv and project .env for public guide pages (defaults match src/config.ts). */

/** @var array<string, string>|null */
$GLOBALS['guide_env_file'] = null;

/** @var string|null */
$GLOBALS['guide_env_loaded_path'] = null;

function guide_str_starts_with(string $haystack, string $needle): bool
{
    if ($needle === '') {
        return true;
    }
    return strncmp($haystack, $needle, strlen($needle)) === 0;
}

function guide_str_ends_with(string $haystack, string $needle): bool
{
    if ($needle === '') {
        return true;
    }
    $len = strlen($needle);
    if ($len === 0) {
        return true;
    }
    return substr($haystack, -$len) === $needle;
}

/**
 * @return list<string>
 */
function guide_project_roots(): array
{
    $includes = __DIR__;
    $public = dirname($includes);
    $publicParent = dirname($public);
    $roots = [];
    $localRootFile = $includes . '/local-root.php';
    if (is_file($localRootFile)) {
        $extra = require $localRootFile;
        if (is_string($extra) && $extra !== '') {
            $roots[] = rtrim(str_replace('\\', '/', $extra), '/');
        }
    }
    $parent = rtrim(str_replace('\\', '/', $publicParent), '/');
    $roots[] = $parent;
    $roots[] = $parent . '/idlerpg';
    $roots[] = dirname($parent) . '/idlerpg';
    $unique = [];
    foreach ($roots as $root) {
        if ($root !== '' && !in_array($root, $unique, true)) {
            $unique[] = $root;
        }
    }
    return $unique;
}

function guide_env_load_file(): void
{
    if ($GLOBALS['guide_env_file'] !== null) {
        return;
    }
    /** @var array<string, string> $map */
    $map = [];
    $loadedPath = null;
    foreach (guide_project_roots() as $root) {
        $path = $root . '/.env';
        if (!is_readable($path)) {
            continue;
        }
        $lines = file($path, FILE_IGNORE_NEW_LINES);
        if ($lines === false) {
            continue;
        }
        foreach ($lines as $line) {
            $line = trim(str_replace("\r", '', (string) $line));
            if ($line === '' || guide_str_starts_with($line, '#')) {
                continue;
            }
            if (guide_str_starts_with($line, 'export ')) {
                $line = trim(substr($line, 7));
            }
            if (!preg_match('/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/', $line, $m)) {
                continue;
            }
            $val = trim($m[2]);
            $val = trim(preg_replace('/\s+#.*$/', '', $val) ?? $val);
            if (
                (guide_str_starts_with($val, '"') && guide_str_ends_with($val, '"'))
                || (guide_str_starts_with($val, "'") && guide_str_ends_with($val, "'"))
            ) {
                $val = substr($val, 1, -1);
            }
            $map[$m[1]] = str_replace("\r", '', $val);
        }
        $loadedPath = $path;
        break;
    }
    $GLOBALS['guide_env_file'] = $map;
    $GLOBALS['guide_env_loaded_path'] = $loadedPath;
}

function guide_env_raw(string $key): ?string
{
    guide_env_load_file();
    /** @var array<string, string> $file */
    $file = $GLOBALS['guide_env_file'];
    if (array_key_exists($key, $file)) {
        $t = trim(str_replace("\r", '', $file[$key]));
        if ($t !== '') {
            return $t;
        }
    }
    $fromOs = getenv($key);
    if ($fromOs !== false) {
        $t = trim(str_replace("\r", '', (string) $fromOs));
        if ($t !== '') {
            return $t;
        }
    }
    return null;
}

function guide_env_loaded_path(): ?string
{
    guide_env_load_file();
    /** @var string|null $path */
    $path = $GLOBALS['guide_env_loaded_path'] ?? null;
    return $path;
}

function guide_detect_v3_from_db(): bool
{
    foreach (guide_project_roots() as $root) {
        $candidates = [
            $root . '/data/idlerpg.db',
            dirname($root) . '/data/idlerpg.db',
        ];
        foreach ($candidates as $dbPath) {
            if (!is_readable($dbPath)) {
                continue;
            }
            try {
                $pdo = new PDO('sqlite:' . $dbPath, null, null, [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]);
                $season = $pdo->query(
                    "SELECT text_value FROM meta WHERE key = 'v3_season_label' LIMIT 1",
                )->fetch();
                if (is_array($season) && trim((string) ($season['text_value'] ?? '')) !== '') {
                    return true;
                }
                $wb = $pdo->query(
                    "SELECT int_value FROM meta WHERE key = 'v3_world_boss_next' LIMIT 1",
                )->fetch();
                if (is_array($wb) && (int) ($wb['int_value'] ?? 0) > 0) {
                    return true;
                }
                $trial = $pdo->query(
                    "SELECT int_value FROM meta WHERE key = 'v3_daily_trial_next' LIMIT 1",
                )->fetch();
                if (is_array($trial) && (int) ($trial['int_value'] ?? 0) > 0) {
                    return true;
                }
            } catch (Throwable $e) {
                continue;
            }
        }
    }
    return false;
}

function guide_resolve_v3_mode_enabled(): bool
{
    if (guide_env_bool('IRPG_V3_MODE_ENABLED', false)) {
        return true;
    }
    $featureFlags = [
        'IRPG_V3_DAILY_TRIAL_ENABLED',
        'IRPG_V3_STREAK_ENABLED',
        'IRPG_V3_BOUNTY_ENABLED',
        'IRPG_V3_SEASON_ENABLED',
        'IRPG_V3_WORLD_BOSS_ENABLED',
        'IRPG_V3_GUILD_ENABLED',
        'IRPG_V3_RELIC_ENABLED',
        'IRPG_V3_PRESTIGE_ENABLED',
    ];
    foreach ($featureFlags as $flag) {
        if (guide_env_raw($flag) !== null && guide_env_bool($flag, false)) {
            return true;
        }
    }
    return guide_detect_v3_from_db();
}

function guide_env_bool(string $key, bool $default): bool
{
    $raw = guide_env_raw($key);
    if ($raw === null || $raw === '') {
        return $default;
    }
    return in_array(strtolower($raw), ['1', 'true', 'yes', 'on'], true);
}

function guide_env_int(string $key, int $default, ?int $min = null, ?int $max = null): int
{
    $raw = guide_env_raw($key);
    if ($raw === null || $raw === '' || !is_numeric($raw)) {
        $v = $default;
    } else {
        $v = (int) $raw;
    }
    if ($min !== null) {
        $v = max($min, $v);
    }
    if ($max !== null) {
        $v = min($max, $v);
    }
    return $v;
}

function guide_env_float(string $key, float $default, ?float $min = null, ?float $max = null): float
{
    $raw = guide_env_raw($key);
    if ($raw === null || $raw === '' || !is_numeric($raw)) {
        $v = $default;
    } else {
        $v = (float) $raw;
    }
    if ($min !== null) {
        $v = max($min, $v);
    }
    if ($max !== null) {
        $v = min($max, $v);
    }
    return $v;
}

function guide_format_pct(float $ratio, int $decimals = 1): string
{
    $pct = round($ratio * 100, $decimals);
    if (abs($pct - round($pct)) < 0.05) {
        return (string) (int) round($pct) . '%';
    }
    return rtrim(rtrim(number_format($pct, $decimals, '.', ''), '0'), '.') . '%';
}

function guide_format_duration(int $sec): string
{
    $s = max(0, $sec);
    if ($s < 60) {
        return $s . 's';
    }
    $days = intdiv($s, 86400);
    $h = intdiv($s % 86400, 3600);
    $m = intdiv($s % 3600, 60);
    if ($days > 0) {
        return $days . 'd ' . $h . 'h';
    }
    if ($h > 0 && $m > 0) {
        return $h . 'h ' . $m . 'm';
    }
    if ($h > 0) {
        return $h . 'h';
    }
    return $m . 'm';
}

function guide_normalize_channel(string $raw, string $fallback): string
{
    $t = trim($raw);
    if ($t === '') {
        return $fallback;
    }
    if (preg_match('/^[#&+!]/', $t)) {
        return $t;
    }
    return '#' . $t;
}

/**
 * Runtime tuning snapshot for guides — keep defaults aligned with src/config.ts.
 *
 * @return array<string, mixed>
 */
function guide_runtime_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }

    $channel = guide_normalize_channel((string) (guide_env_raw('IRPG_IRC_CHANNEL') ?? ''), '#IdleRPG');
    $guildPct = guide_env_float('IRPG_V3_GUILD_IDLE_BONUS_PCT', 0.01, 0.0, 0.25);
    $prestigePct = guide_env_float('IRPG_V3_PRESTIGE_IDLE_RATE_BONUS_PCT', 0.01, 0.0, 0.05);
    $relicQuestPct = guide_env_float('IRPG_V3_RELIC_QUEST_LEVY_REDUCTION_PCT', 0.08, 0.0, 0.3);
    $relicOmenPct = guide_env_float('IRPG_V3_RELIC_OMEN_LUCK_BONUS_PCT', 0.07, 0.0, 0.3);
    $relicStreakPct = guide_env_float('IRPG_V3_RELIC_STREAK_BONUS_PCT', 0.15, 0.0, 0.5);
    $luckyChance = guide_env_float('IRPG_LUCKY_HOUR_CHANCE', 0.1, 0.0, 1.0);
    $hogChance = guide_env_float('IRPG_HOG_CHANCE', 0.0008, 0.0, 1.0);
    $questStartChance = guide_env_float('IRPG_QUEST_START_CHANCE', 0.00035, 0.0, 1.0);

    $v3Mode = guide_resolve_v3_mode_enabled();
    $v3ModeFlag = guide_env_bool('IRPG_V3_MODE_ENABLED', false);
    $cfg = [
        'envLoadedPath' => guide_env_loaded_path(),
        'v3ModeFlag' => $v3ModeFlag,
        'ircChannel' => $channel,
        'ircHost' => trim((string) (guide_env_raw('IRPG_IRC_HOST') ?? 'chat.netirc.eu')),
        'ircPort' => guide_env_int('IRPG_IRC_PORT', 6667, 1, 65535),
        'rpbase' => guide_env_int('IRPG_RPBASE', 600, 60, 86_400),
        'rpstep' => guide_env_float('IRPG_RPSTEP', 1.16, 1.0, 3.0),
        'rppenstep' => guide_env_float('IRPG_RPPENSTEP', 1.14, 1.0, 3.0),
        'caseSensitiveNames' => guide_env_bool('IRPG_CASE_SENSITIVE_NAMES', true),
        'netsplitGraceSec' => guide_env_int('IRPG_NETSPLIT_GRACE_SEC', 0, 0, 21_600),

        'penPartMult' => 200,
        'penQuitMult' => 20,
        'penLogoutMult' => 20,
        'duelMaxLevelGap' => 11,
        'duelCooldownSec' => 5 * 3600,
        'duelPairCooldownSec' => 20 * 3600,
        'omenCooldownSec' => 8 * 3600,
        'gauntletCooldownSec' => 16 * 3600,

        'questEnabled' => guide_env_bool('IRPG_QUEST_ENABLED', true),
        'questMinPlayers' => guide_env_int('IRPG_QUEST_MIN_PLAYERS', 4, 2, 40),
        'questDurationSec' => guide_env_int('IRPG_QUEST_DURATION_SEC', 600, 120, 86_400),
        'questCooldownSec' => guide_env_int('IRPG_QUEST_COOLDOWN_SEC', 2700, 300, 1_209_600),
        'questStartChancePct' => guide_format_pct($questStartChance, 3),
        'questWinnerMult' => guide_env_float('IRPG_QUEST_WINNER_MULT', 3.5, 0.5, 20.0),
        'questLoserMult' => guide_env_float('IRPG_QUEST_LOSER_MULT', 2.0, 0.5, 20.0),

        'luckyHourEnabled' => guide_env_bool('IRPG_LUCKY_HOUR_ENABLED', true),
        'luckyHourDurationSec' => guide_env_int('IRPG_LUCKY_HOUR_DURATION_SEC', 540, 120, 7200),
        'luckyHourChancePct' => guide_format_pct($luckyChance, 1),
        'hogChancePct' => guide_format_pct($hogChance, 2),

        'v3ModeEnabled' => $v3Mode,
        'v3ModeInferred' => $v3Mode && !$v3ModeFlag,
        'v3DailyTrialEnabled' => guide_env_bool('IRPG_V3_DAILY_TRIAL_ENABLED', false),
        'v3DailyTrialCooldownSec' => guide_env_int('IRPG_V3_DAILY_TRIAL_COOLDOWN_SEC', 86_400, 300, 604_800),
        'v3DailyTrialRewardSec' => guide_env_int('IRPG_V3_DAILY_TRIAL_REWARD_SEC', 180, 10, 7200),
        'v3DailyTrialPenaltySec' => guide_env_int('IRPG_V3_DAILY_TRIAL_PENALTY_SEC', 90, 5, 7200),
        'v3StreakEnabled' => guide_env_bool('IRPG_V3_STREAK_ENABLED', false),
        'v3StreakStepSec' => guide_env_int('IRPG_V3_STREAK_STEP_SEC', 1800, 60, 86_400),
        'v3StreakRewardSec' => guide_env_int('IRPG_V3_STREAK_REWARD_SEC', 15, 1, 1800),
        'v3BountyEnabled' => guide_env_bool('IRPG_V3_BOUNTY_ENABLED', false),
        'v3BountyTargetSec' => guide_env_int('IRPG_V3_BOUNTY_TARGET_SEC', 5400, 300, 86_400),
        'v3BountyRewardSec' => guide_env_int('IRPG_V3_BOUNTY_REWARD_SEC', 180, 10, 7200),
        'v3BountyQuietSec' => guide_env_int('IRPG_V3_BOUNTY_QUIET_SEC', 120, 0, 3600),
        'v3SeasonEnabled' => guide_env_bool('IRPG_V3_SEASON_ENABLED', true),
        'v3SeasonLengthDays' => guide_env_int('IRPG_V3_SEASON_LENGTH_DAYS', 30, 7, 120),
        'v3SeasonPassXpPerMinute' => guide_env_int('IRPG_V3_SEASON_PASS_XP_PER_MINUTE', 6, 1, 240),
        'v3SeasonTierXp' => guide_env_int('IRPG_V3_SEASON_TIER_XP', 600, 30, 100_000),
        'v3WorldBossEnabled' => guide_env_bool('IRPG_V3_WORLD_BOSS_ENABLED', true),
        'v3WorldBossIntervalSec' => guide_env_int('IRPG_V3_WORLD_BOSS_INTERVAL_SEC', 21_600, 600, 604_800),
        'v3WorldBossDurationSec' => guide_env_int('IRPG_V3_WORLD_BOSS_DURATION_SEC', 5400, 120, 86_400),
        'v3WorldBossRewardSec' => guide_env_int('IRPG_V3_WORLD_BOSS_REWARD_SEC', 240, 5, 10_800),
        'v3GuildEnabled' => guide_env_bool('IRPG_V3_GUILD_ENABLED', true),
        'v3GuildIdleBonusPct' => guide_format_pct($guildPct),
        'v3RelicEnabled' => guide_env_bool('IRPG_V3_RELIC_ENABLED', true),
        'v3RelicQuestLevyPct' => guide_format_pct($relicQuestPct),
        'v3RelicOmenLuckPct' => guide_format_pct($relicOmenPct),
        'v3RelicStreakPct' => guide_format_pct($relicStreakPct),
        'v3PrestigeEnabled' => guide_env_bool('IRPG_V3_PRESTIGE_ENABLED', true),
        'v3PrestigeMinLevel' => guide_env_int('IRPG_V3_PRESTIGE_MIN_LEVEL', 60, 20, 500),
        'v3PrestigeIdleBonusPct' => guide_format_pct($prestigePct),
    ];

    $cfg['v3BountyEnabledLive'] = $v3Mode && $cfg['v3BountyEnabled'];
    $cfg['v3SeasonEnabledLive'] = $v3Mode && $cfg['v3SeasonEnabled'];
    $cfg['v3WorldBossEnabledLive'] = $v3Mode && $cfg['v3WorldBossEnabled'];
    $cfg['v3GuildEnabledLive'] = $v3Mode && $cfg['v3GuildEnabled'];
    $cfg['v3RelicEnabledLive'] = $v3Mode && $cfg['v3RelicEnabled'];
    $cfg['v3PrestigeEnabledLive'] = $v3Mode && $cfg['v3PrestigeEnabled'];
    $cfg['v3DailyTrialEnabledLive'] = $v3Mode && $cfg['v3DailyTrialEnabled'];
    $cfg['v3StreakEnabledLive'] = $v3Mode && $cfg['v3StreakEnabled'];

    return $cfg;
}

/**
 * @param list<array{label: string, value: string}> $rows
 */
function guide_render_tuning_table(string $title, array $rows): void
{
    if ($rows === []) {
        return;
    }
    echo '<h3 class="cmd-ref-group">' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h3>';
    echo '<table class="cmd-ref cmd-ref--settings"><colgroup><col class="cmd-ref-col-label" /><col class="cmd-ref-col-value" /></colgroup><thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead><tbody>';
    foreach ($rows as $row) {
        $label = htmlspecialchars($row['label'], ENT_QUOTES, 'UTF-8');
        $value = htmlspecialchars($row['value'], ENT_QUOTES, 'UTF-8');
        echo "<tr><td>{$label}</td><td class=\"mono\">{$value}</td></tr>";
    }
    echo '</tbody></table>';
}

/** @param array<string, mixed> $cfg */
function guide_render_shard_tuning(array $cfg): void
{
    echo '<h2 class="h2" style="font-size:1.05rem;">Realm settings</h2>';
    echo '<div class="cmd-ref-wrap cmd-ref-wrap--settings">';

    guide_render_tuning_table('IRC & core', [
        ['label' => 'Game channel', 'value' => (string) $cfg['ircChannel']],
        ['label' => 'IRC server', 'value' => (string) $cfg['ircHost'] . ':' . (string) $cfg['ircPort']],
        ['label' => 'Base level timer (rpbase)', 'value' => guide_format_duration((int) $cfg['rpbase'])],
        ['label' => 'Level timer growth (rpstep)', 'value' => (string) $cfg['rpstep']],
        ['label' => 'Penalty growth (rppenstep)', 'value' => (string) $cfg['rppenstep']],
        ['label' => 'Character names case-sensitive', 'value' => ($cfg['caseSensitiveNames'] ?? false) ? 'yes' : 'no'],
        ['label' => 'Netsplit grace', 'value' => ((int) $cfg['netsplitGraceSec']) > 0
            ? guide_format_duration((int) $cfg['netsplitGraceSec'])
            : 'off'],
    ]);

    guide_render_tuning_table('Leaving & logout', [
        ['label' => 'PART multiplier', 'value' => (string) $cfg['penPartMult'] . '× base penalty'],
        ['label' => 'QUIT IRC multiplier', 'value' => (string) $cfg['penQuitMult'] . '× base penalty'],
        ['label' => 'LOGOUT multiplier', 'value' => (string) $cfg['penLogoutMult'] . '× base penalty'],
    ]);

    guide_render_tuning_table('Action cooldowns', [
        ['label' => '!duel level gap', 'value' => '±' . (string) $cfg['duelMaxLevelGap'] . ' levels'],
        ['label' => '!duel cooldown', 'value' => guide_format_duration((int) $cfg['duelCooldownSec'])],
        ['label' => '!omen cooldown', 'value' => guide_format_duration((int) $cfg['omenCooldownSec'])],
        ['label' => '!gauntlet cooldown', 'value' => guide_format_duration((int) $cfg['gauntletCooldownSec'])],
    ]);

    if ($cfg['questEnabled'] ?? false) {
        guide_render_tuning_table('Quests', [
            ['label' => 'Min players online', 'value' => (string) $cfg['questMinPlayers']],
            ['label' => 'Campaign duration', 'value' => guide_format_duration((int) $cfg['questDurationSec'])],
            ['label' => 'Cooldown between quests', 'value' => guide_format_duration((int) $cfg['questCooldownSec'])],
            ['label' => 'Auto-start roll chance', 'value' => (string) $cfg['questStartChancePct'] . ' per tick'],
            ['label' => 'Winner timer bonus', 'value' => '≈ rpbase × ' . (string) $cfg['questWinnerMult']],
            ['label' => 'Loser timer penalty', 'value' => '≈ rpbase × ' . (string) $cfg['questLoserMult']],
        ]);
    }

    if ($cfg['luckyHourEnabled'] ?? false) {
        guide_render_tuning_table('Lucky hour', [
            ['label' => 'Duration', 'value' => guide_format_duration((int) $cfg['luckyHourDurationSec'])],
            ['label' => 'Roll chance', 'value' => (string) $cfg['luckyHourChancePct']],
        ]);
    }

    guide_render_tuning_table('Realm events', [
        ['label' => 'Hand of God chance', 'value' => (string) $cfg['hogChancePct'] . ' per tick'],
    ]);

    if (!($cfg['v3ModeEnabled'] ?? false)) {
        guide_render_tuning_table('Extended features', [
            ['label' => 'Status', 'value' => 'off on this realm'],
        ]);
        return;
    }

    if ($cfg['v3DailyTrialEnabledLive'] ?? false) {
        guide_render_tuning_table('Daily trial', [
            ['label' => 'Cooldown', 'value' => guide_format_duration((int) $cfg['v3DailyTrialCooldownSec'])],
            ['label' => 'Success reward', 'value' => '-' . guide_format_duration((int) $cfg['v3DailyTrialRewardSec']) . ' timer'],
            ['label' => 'Failure penalty', 'value' => '+' . guide_format_duration((int) $cfg['v3DailyTrialPenaltySec']) . ' timer'],
        ]);
    }

    if ($cfg['v3StreakEnabledLive'] ?? false) {
        guide_render_tuning_table('Idle streak', [
            ['label' => 'Step every', 'value' => guide_format_duration((int) $cfg['v3StreakStepSec'])],
            ['label' => 'Reward per step', 'value' => '-' . guide_format_duration((int) $cfg['v3StreakRewardSec']) . ' timer'],
        ]);
    }

    if ($cfg['v3BountyEnabledLive'] ?? false) {
        guide_render_tuning_table('Bounty board', [
            ['label' => 'Daily idle target', 'value' => guide_format_duration((int) $cfg['v3BountyTargetSec'])],
            ['label' => 'Completion reward', 'value' => '-' . guide_format_duration((int) $cfg['v3BountyRewardSec']) . ' timer'],
            ['label' => 'Quiet period after claim', 'value' => guide_format_duration((int) $cfg['v3BountyQuietSec'])],
        ]);
    }

    if ($cfg['v3SeasonEnabledLive'] ?? false) {
        guide_render_tuning_table('Season pass', [
            ['label' => 'Season length', 'value' => (string) $cfg['v3SeasonLengthDays'] . ' days'],
            ['label' => 'XP per idle minute', 'value' => (string) $cfg['v3SeasonPassXpPerMinute']],
            ['label' => 'XP per tier', 'value' => (string) $cfg['v3SeasonTierXp']],
        ]);
    }

    if ($cfg['v3WorldBossEnabledLive'] ?? false) {
        guide_render_tuning_table('World boss', [
            ['label' => 'Spawn interval', 'value' => guide_format_duration((int) $cfg['v3WorldBossIntervalSec'])],
            ['label' => 'Fight window', 'value' => guide_format_duration((int) $cfg['v3WorldBossDurationSec'])],
            ['label' => 'Participation reward', 'value' => '-' . guide_format_duration((int) $cfg['v3WorldBossRewardSec']) . ' timer'],
        ]);
    }

    if ($cfg['v3GuildEnabledLive'] ?? false) {
        guide_render_tuning_table('Guilds', [
            ['label' => 'Passive idle bonus', 'value' => (string) $cfg['v3GuildIdleBonusPct']],
        ]);
    }

    if ($cfg['v3RelicEnabledLive'] ?? false) {
        guide_render_tuning_table('Relics (active relic perks)', [
            ['label' => 'Quest levy reduction', 'value' => (string) $cfg['v3RelicQuestLevyPct']],
            ['label' => 'Omen luck bonus', 'value' => (string) $cfg['v3RelicOmenLuckPct']],
            ['label' => 'Streak bonus', 'value' => (string) $cfg['v3RelicStreakPct']],
        ]);
    }

    if ($cfg['v3PrestigeEnabledLive'] ?? false) {
        guide_render_tuning_table('Prestige', [
            ['label' => 'Minimum level to rebirth', 'value' => 'L' . (string) $cfg['v3PrestigeMinLevel']],
            ['label' => 'Idle-rate bonus per rank', 'value' => (string) $cfg['v3PrestigeIdleBonusPct']],
        ]);
    }

    echo '</div>';
}
