<?php
declare(strict_types=1);

/** Player detail endpoint with stats, medals, and recent realm chronicle events. */

require_once dirname(__DIR__) . '/includes/bootstrap.php';

global $IRPG;

irpg_json_headers();

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
    ? 'SELECT id, character_name, class, level, next_seconds, idled, online, alignment, irc_nick,
              pen_mesg, pen_nick, pen_part, pen_quit, pen_kick, pen_quest, pen_logout, trinket,
              COALESCE(duel_wins, 0) AS duel_wins, COALESCE(gauntlet_wins, 0) AS gauntlet_wins,
              COALESCE(idle_streak_sec, 0) AS idle_streak_sec, COALESCE(streak_reward_count, 0) AS streak_reward_count
       FROM players WHERE character_name = ? LIMIT 1'
    : 'SELECT id, character_name, class, level, next_seconds, idled, online, alignment, irc_nick,
              pen_mesg, pen_nick, pen_part, pen_quit, pen_kick, pen_quest, pen_logout, trinket,
              COALESCE(duel_wins, 0) AS duel_wins, COALESCE(gauntlet_wins, 0) AS gauntlet_wins,
              COALESCE(idle_streak_sec, 0) AS idle_streak_sec, COALESCE(streak_reward_count, 0) AS streak_reward_count
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
        $likeColon = $charName . ':%';
        $likeSpace = $charName . ' %';
        $ledgerLim = irpg_chronicle_default_limit();
        $fstmt = $pdo->prepare(
            'SELECT ts, kind, detail FROM realm_events
             WHERE detail COLLATE NOCASE = ?
                OR detail COLLATE NOCASE LIKE ?
                OR detail COLLATE NOCASE LIKE ?
             ORDER BY id DESC LIMIT ?',
        );
        $fstmt->execute([$charName, $likeColon, $likeSpace, $ledgerLim]);
        $rows = $fstmt->fetchAll(PDO::FETCH_ASSOC);
        if (is_array($rows)) {
            foreach ($rows as $row) {
                $recentFinds[] = [
                    'ts' => (int) $row['ts'],
                    'kind' => (string) $row['kind'],
                    'detail' => (string) $row['detail'],
                ];
            }
        }
    } catch (Throwable $ignore) {
        $recentFinds = [];
    }
    echo json_encode([
        'id' => $pid,
        'name' => $r['character_name'],
        'level' => (int) $r['level'],
        'class' => $r['class'],
        'nextSeconds' => $next,
        'nextHuman' => irpg_duration_it($next),
        'online' => $online,
        'alignment' => $r['alignment'],
        'trinket' => isset($r['trinket']) && (string) $r['trinket'] !== '' ? (string) $r['trinket'] : null,
        'duelWins' => (int) $r['duel_wins'],
        'gauntletWins' => (int) $r['gauntlet_wins'],
        'idleStreakSec' => (int) $r['idle_streak_sec'],
        'streakRewardCount' => (int) $r['streak_reward_count'],
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
