<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/includes/bootstrap.php';

global $IRPG;

irpg_json_headers();

try {
    $pdo = irpg_pdo();
    $lim = isset($_GET['limit']) ? (int) $_GET['limit'] : 14;
    if ($lim < 1) {
        $lim = 1;
    }
    if ($lim > 40) {
        $lim = 40;
    }

    $stmt = $pdo->prepare('SELECT ts, kind, detail FROM realm_events ORDER BY id DESC LIMIT ?');
    $stmt->bindValue(1, $lim, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $events = [];
    foreach ($rows as $r) {
        $events[] = [
            'ts' => (int) $r['ts'],
            'kind' => (string) $r['kind'],
            'detail' => (string) $r['detail'],
        ];
    }

    echo json_encode(
        [
            'events' => $events,
            'generatedAt' => gmdate('c'),
        ],
        JSON_THROW_ON_ERROR,
    );
} catch (Throwable $e) {
    irpg_server_error($e);
}
