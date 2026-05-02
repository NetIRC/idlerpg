<?php
declare(strict_types=1);

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
    ? 'SELECT character_name, class, level, next_seconds, idled, online, alignment, irc_nick,
              pen_mesg, pen_nick, pen_part, pen_quit, pen_kick, pen_quest, pen_logout, trinket
       FROM players WHERE character_name = ? LIMIT 1'
    : 'SELECT character_name, class, level, next_seconds, idled, online, alignment, irc_nick,
              pen_mesg, pen_nick, pen_part, pen_quit, pen_kick, pen_quest, pen_logout, trinket
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
    $next = (float) $r['next_seconds'];
    $online = (bool) $r['online'];
    echo json_encode([
        'name' => $r['character_name'],
        'level' => (int) $r['level'],
        'class' => $r['class'],
        'nextSeconds' => $next,
        'nextHuman' => irpg_duration_it($next),
        'online' => $online,
        'alignment' => $r['alignment'],
        'trinket' => isset($r['trinket']) && (string) $r['trinket'] !== '' ? (string) $r['trinket'] : null,
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
        ],
    ], JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    irpg_server_error($e);
}
