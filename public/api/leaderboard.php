<?php
declare(strict_types=1);

/** Leaderboard endpoint consumed by PHP/JS web UIs. */

require_once dirname(__DIR__) . '/includes/bootstrap.php';

global $IRPG;

irpg_json_headers();

try {
    $pdo = irpg_pdo();
    $presence = irpg_bot_presence($pdo);
    $pulse = irpg_realm_pulse($pdo);
    $stmt = $pdo->query(
        'SELECT character_name, class, level, next_seconds, idled, online
         FROM players
         ORDER BY level DESC, next_seconds ASC
         LIMIT 100',
    );
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $players = [];
    foreach ($rows as $p) {
        $next = (float) $p['next_seconds'];
        $players[] = [
            'name' => $p['character_name'],
            'level' => (int) $p['level'],
            'class' => $p['class'],
            'nextSeconds' => $next,
            'nextHuman' => irpg_duration_it($next),
            'online' => (bool) $p['online'],
            'idledHours' => round(((int) $p['idled'] / 3600) * 10) / 10,
        ];
    }
    // UTC ISO-8601: snapshot time for the web UI (timers reflect DB at this moment).
    echo json_encode(
        [
            'players' => $players,
            'generatedAt' => gmdate('c'),
            'botOnline' => $presence['botOnline'],
            'botLastSeenMs' => $presence['botLastSeenMs'],
            'aiEnabled' => irpg_ai_enabled($pdo),
            'realmPulse' => $pulse,
        ],
        JSON_THROW_ON_ERROR,
    );
} catch (Throwable $e) {
    irpg_server_error($e);
}
