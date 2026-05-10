<?php
declare(strict_types=1);

/** Player detail endpoint with stats, medals, recent events, and season history. */

require_once dirname(__DIR__) . '/includes/bootstrap.php';

global $IRPG;

irpg_json_headers();

/**
 * Extract timer delta for the selected hero from a realm event detail line.
 * Returns signed "progress seconds": positive means timer reduced, negative means timer increased.
 */
function irpg_hero_effect_sec_from_detail(string $detail, string $heroName, bool $caseSensitive): int
{
    $src = trim($detail);
    $hero = trim($heroName);
    if ($src === '' || $hero === '') {
        return 0;
    }
    $flags = $caseSensitive ? 'u' : 'iu';
    $re = '/(^|[^[:alnum:]_])' . preg_quote($hero, '/') . '([^[:alnum:]_]|$)\s*([+-])\s*'
        . '(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/' . $flags;
    if (preg_match($re, $src, $m) !== 1) {
        return 0;
    }
    $days = isset($m[4]) ? (int) $m[4] : 0;
    $hours = isset($m[5]) ? (int) $m[5] : 0;
    $mins = isset($m[6]) ? (int) $m[6] : 0;
    $secs = isset($m[7]) ? (int) $m[7] : 0;
    $total = ($days * 86400) + ($hours * 3600) + ($mins * 60) + $secs;
    if ($total <= 0) {
        return 0;
    }
    return ($m[3] === '-') ? $total : -$total;
}

$name = isset($_GET['name']) ? (string) $_GET['name'] : '';
$name = trim($name);
if ($name === '') {
    http_response_code(400);
    echo json_encode(['error' => 'missing_name'], JSON_THROW_ON_ERROR);
    exit;
}
if (strlen($name) > 32) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_name'], JSON_THROW_ON_ERROR);
    exit;
}

$case = !empty($IRPG['case_sensitive_names']);
$sql = $case
    ? 'SELECT id, character_name, class, level, next_seconds, idled, online, alignment, irc_nick, created_at,
              pen_mesg, pen_nick, pen_part, pen_quit, pen_kick, pen_quest, pen_logout, trinket,
              COALESCE(duel_wins, 0) AS duel_wins, COALESCE(gauntlet_wins, 0) AS gauntlet_wins,
              COALESCE(idle_streak_sec, 0) AS idle_streak_sec, COALESCE(streak_reward_count, 0) AS streak_reward_count,
              COALESCE(guild_id, 0) AS guild_id, COALESCE(prestige_rank, 0) AS prestige_rank, COALESCE(prestige_points, 0) AS prestige_points
       FROM players WHERE character_name = ? LIMIT 1'
    : 'SELECT id, character_name, class, level, next_seconds, idled, online, alignment, irc_nick, created_at,
              pen_mesg, pen_nick, pen_part, pen_quit, pen_kick, pen_quest, pen_logout, trinket,
              COALESCE(duel_wins, 0) AS duel_wins, COALESCE(gauntlet_wins, 0) AS gauntlet_wins,
              COALESCE(idle_streak_sec, 0) AS idle_streak_sec, COALESCE(streak_reward_count, 0) AS streak_reward_count,
              COALESCE(guild_id, 0) AS guild_id, COALESCE(prestige_rank, 0) AS prestige_rank, COALESCE(prestige_points, 0) AS prestige_points
       FROM players WHERE character_name COLLATE NOCASE = ? LIMIT 1';

try {
    $pdo = irpg_pdo();
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$name]);
    $r = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$r) {
        http_response_code(404);
        echo json_encode(['error' => 'not_found'], JSON_THROW_ON_ERROR);
        exit;
    }
    $charName = (string) $r['character_name'];
    $next = (float) $r['next_seconds'];
    $online = (bool) $r['online'];
    $pid = (int) $r['id'];
    $medals = [];
    $recentFinds = [];
    $guild = null;
    $relics = [];
    $activeRelic = null;
    $season = null;
    $seasonHistory = [];
    $systems = [
        'features' => [
            'v3Mode' => irpg_env_bool('IRPG_V3_MODE_ENABLED', true),
            'dailyTrialEnabled' => irpg_env_bool('IRPG_V3_DAILY_TRIAL_ENABLED', true),
            'streakEnabled' => irpg_env_bool('IRPG_V3_STREAK_ENABLED', false),
            'bountyEnabled' => irpg_env_bool('IRPG_V3_BOUNTY_ENABLED', true),
            'seasonEnabled' => irpg_env_bool('IRPG_V3_SEASON_ENABLED', true),
            'worldBossEnabled' => irpg_env_bool('IRPG_V3_WORLD_BOSS_ENABLED', true),
            'guildEnabled' => irpg_env_bool('IRPG_V3_GUILD_ENABLED', true),
            'relicEnabled' => irpg_env_bool('IRPG_V3_RELIC_ENABLED', true),
            'prestigeEnabled' => irpg_env_bool('IRPG_V3_PRESTIGE_ENABLED', true),
        ],
        'cooldowns' => [],
        'bounty' => null,
    ];
    try {
        $mstmt = $pdo->prepare('SELECT medal_key FROM player_medals WHERE player_id = ? ORDER BY ts ASC');
        $mstmt->execute([$pid]);
        $medals = $mstmt->fetchAll(PDO::FETCH_COLUMN);
        if (!is_array($medals)) {
            $medals = [];
        }
    } catch (Throwable $ignore) {
        $medals = [];
    }
    try {
        $dayStartTs = strtotime('today');
        $ledgerLim = 1200;
        $fstmt = $pdo->prepare(
            'SELECT ts, kind, detail FROM realm_events
             WHERE ts >= ?
             ORDER BY id DESC LIMIT ?',
        );
        $fstmt->execute([(int) $dayStartTs, $ledgerLim]);
        $rows = $fstmt->fetchAll(PDO::FETCH_ASSOC);
        if (is_array($rows)) {
            $nameRegex = '/(^|[^[:alnum:]_])' . preg_quote($charName, '/') . '([^[:alnum:]_]|$)/' . ($case ? 'u' : 'iu');
            foreach ($rows as $row) {
                $detail = (string) ($row['detail'] ?? '');
                if ($detail === '' || preg_match($nameRegex, $detail) !== 1) {
                    continue;
                }
                $recentFinds[] = [
                    'ts' => (int) $row['ts'],
                    'kind' => (string) $row['kind'],
                    'detail' => $detail,
                    'heroEffectSec' => irpg_hero_effect_sec_from_detail($detail, $charName, $case),
                ];
            }
        }
    } catch (Throwable $ignore) {
        $recentFinds = [];
    }
    try {
        if ((int) $r['guild_id'] > 0) {
            $gstmt = $pdo->prepare('SELECT tag, name FROM guilds WHERE id = ? LIMIT 1');
            $gstmt->execute([(int) $r['guild_id']]);
            $g = $gstmt->fetch(PDO::FETCH_ASSOC);
            if ($g) {
                $guild = [
                    'id' => (int) $r['guild_id'],
                    'tag' => (string) $g['tag'],
                    'name' => (string) $g['name'],
                ];
            }
        }
    } catch (Throwable $ignore) {
        $guild = null;
    }
    try {
        $rst = $pdo->prepare('SELECT relic_key, is_active FROM player_relics WHERE player_id = ? ORDER BY acquired_at ASC');
        $rst->execute([$pid]);
        $rows = $rst->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $rr) {
            $key = (string) ($rr['relic_key'] ?? '');
            if ($key === '') {
                continue;
            }
            $relics[] = $key;
            if ((int) ($rr['is_active'] ?? 0) === 1) {
                $activeRelic = $key;
            }
        }
    } catch (Throwable $ignore) {
        $relics = [];
        $activeRelic = null;
    }
    try {
        $sst = $pdo->prepare(
            'SELECT s.id, s.label, s.ends_at, COALESCE(psp.xp, 0) AS xp, COALESCE(psp.level, 0) AS level
             FROM seasons s
             LEFT JOIN player_season_progress psp
               ON psp.season_id = s.id AND psp.player_id = ?
             WHERE s.ends_at >= ?
             ORDER BY s.id DESC
             LIMIT 1'
        );
        $sst->execute([$pid, time()]);
        $sr = $sst->fetch(PDO::FETCH_ASSOC);
        if ($sr) {
            $season = [
                'id' => (int) $sr['id'],
                'label' => (string) $sr['label'],
                'endsAt' => (int) $sr['ends_at'],
                'xp' => (int) $sr['xp'],
                'level' => (int) $sr['level'],
            ];
        }
    } catch (Throwable $ignore) {
        $season = null;
    }
    try {
        $shst = $pdo->prepare(
            'SELECT s.id, s.label, s.ends_at, COALESCE(psp.xp, 0) AS xp, COALESCE(psp.level, 0) AS level
             FROM player_season_progress psp
             INNER JOIN seasons s ON s.id = psp.season_id
             WHERE psp.player_id = ? AND s.ends_at < ?
             ORDER BY s.ends_at DESC, s.id DESC
             LIMIT 8'
        );
        $shst->execute([$pid, time()]);
        $rows = $shst->fetchAll(PDO::FETCH_ASSOC);
        if (is_array($rows)) {
            foreach ($rows as $sr) {
                $seasonHistory[] = [
                    'id' => (int) ($sr['id'] ?? 0),
                    'label' => (string) ($sr['label'] ?? ''),
                    'endsAt' => (int) ($sr['ends_at'] ?? 0),
                    'xp' => (int) ($sr['xp'] ?? 0),
                    'level' => (int) ($sr['level'] ?? 0),
                ];
            }
        }
    } catch (Throwable $ignore) {
        $seasonHistory = [];
    }
    $now = time();
    $omenCd = 8 * 3600;
    $duelCd = 5 * 3600;
    $gauntletCd = 16 * 3600;
    $omenLast = irpg_meta_int($pdo, 'omen_cd_' . $pid) ?? 0;
    $duelLast = irpg_meta_int($pdo, 'duel_cd_' . $pid) ?? 0;
    $gauntletLast = irpg_meta_int($pdo, 'gauntlet_cd_' . $pid) ?? 0;
    $systems['cooldowns'] = [
        'omenLeftSec' => max(0, $omenCd - max(0, $now - $omenLast)),
        'duelLeftSec' => max(0, $duelCd - max(0, $now - $duelLast)),
        'gauntletLeftSec' => max(0, $gauntletCd - max(0, $now - $gauntletLast)),
    ];
    if ($systems['features']['bountyEnabled']) {
        $targetSec = max(1, (int) getenv('IRPG_V3_BOUNTY_TARGET_SEC') ?: 5400);
        $rewardSec = max(1, (int) getenv('IRPG_V3_BOUNTY_REWARD_SEC') ?: 180);
        $quietSec = max(0, (int) getenv('IRPG_V3_BOUNTY_QUIET_SEC') ?: 0);
        $dayNow = (int) floor($now / 86400);
        $daySaved = irpg_meta_int($pdo, 'bounty_day_' . $pid);
        $progressSaved = max(0, irpg_meta_int($pdo, 'bounty_idle_sec_' . $pid) ?? 0);
        $claimedSaved = max(0, irpg_meta_int($pdo, 'bounty_claimed_' . $pid) ?? 0);
        $lastActivity = max(0, irpg_meta_int($pdo, 'last_chan_activity_' . $pid) ?? 0);
        $progress = $daySaved === null || $daySaved !== $dayNow ? 0 : min($targetSec, $progressSaved);
        $claimedToday = $daySaved === null || $daySaved !== $dayNow ? false : $claimedSaved > 0;
        $quietLeftSec = $quietSec > 0 ? max(0, ($lastActivity + $quietSec) - $now) : 0;
        $ready = !$claimedToday && $progress >= $targetSec && $quietLeftSec <= 0;
        $state = $claimedToday ? 'claimed_today' : ($ready ? 'ready' : 'in_progress');
        $systems['bounty'] = [
            'targetSec' => $targetSec,
            'rewardSec' => $rewardSec,
            'progressSec' => $progress,
            'claimedToday' => $claimedToday,
            'quietLeftSec' => $quietLeftSec,
            'state' => $state,
        ];
    }
    echo json_encode([
        'id' => $pid,
        'name' => $r['character_name'],
        'level' => (int) $r['level'],
        'class' => $r['class'],
        'createdAt' => (int) ($r['created_at'] ?? 0),
        'nextSeconds' => $next,
        'nextHuman' => irpg_duration_it($next),
        'online' => $online,
        'alignment' => $r['alignment'],
        'trinket' => isset($r['trinket']) && (string) $r['trinket'] !== '' ? (string) $r['trinket'] : null,
        'duelWins' => (int) $r['duel_wins'],
        'gauntletWins' => (int) $r['gauntlet_wins'],
        'idleStreakSec' => (int) $r['idle_streak_sec'],
        'streakRewardCount' => (int) $r['streak_reward_count'],
        'guild' => $guild,
        'prestigeRank' => (int) $r['prestige_rank'],
        'prestigePoints' => (int) $r['prestige_points'],
        'relics' => $relics,
        'activeRelic' => $activeRelic,
        'season' => $season,
        'seasonHistory' => $seasonHistory,
        'systems' => $systems,
        'medals' => array_map(static function ($key) {
            return [
                'key' => (string) $key,
                'label' => irpg_medal_label((string) $key),
                'tier' => irpg_medal_tier((string) $key),
            ];
        }, $medals),
        'recentFinds' => $recentFinds,
        'idledHours' => round(((int) $r['idled'] / 3600) * 10) / 10,
        'ircNick' => $online ? $r['irc_nick'] : null,
        'stats' => [
            'penMesg' => (int) $r['pen_mesg'],
            'penNick' => (int) $r['pen_nick'],
            'penPart' => (int) $r['pen_part'],
            'penQuit' => (int) $r['pen_quit'],
            'penKick' => (int) $r['pen_kick'],
            'penQuest' => (int) $r['pen_quest'],
            'penLogout' => (int) $r['pen_logout'],
            'idleStreakSec' => (int) $r['idle_streak_sec'],
            'streakRewardCount' => (int) $r['streak_reward_count'],
        ],
    ], JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    irpg_server_error($e);
}
