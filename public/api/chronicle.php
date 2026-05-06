<?php
declare(strict_types=1);

/** Chronicle feed endpoint for recent realm events. */

require_once dirname(__DIR__) . '/includes/bootstrap.php';

global $IRPG;

irpg_json_headers();

try {
    $pdo = irpg_pdo();
    $lim = isset($_GET['limit']) ? (int) $_GET['limit'] : irpg_chronicle_default_limit();
    if ($lim < 1) {
        $lim = 1;
    }
    $max = irpg_chronicle_max_limit();
    if ($lim > $max) {
        $lim = $max;
    }

    $where = [];
    $params = [];
    $kind = isset($_GET['kind']) ? trim((string) $_GET['kind']) : '';
    if ($kind !== '' && preg_match('/^[a-z0-9_]+$/i', $kind)) {
        $where[] = 'kind = ?';
        $params[] = $kind;
    }
    $search = isset($_GET['search']) ? trim((string) $_GET['search']) : '';
    if ($search !== '') {
        $where[] = 'detail LIKE ?';
        $params[] = '%' . $search . '%';
    }
    $since = isset($_GET['since']) ? (int) $_GET['since'] : 0;
    if ($since > 0) {
        $where[] = 'ts >= ?';
        $params[] = $since;
    }
    $until = isset($_GET['until']) ? (int) $_GET['until'] : 0;
    if ($until > 0) {
        $where[] = 'ts <= ?';
        $params[] = $until;
    }
    $beforeId = isset($_GET['before_id']) ? (int) $_GET['before_id'] : 0;
    if ($beforeId > 0) {
        $where[] = 'id < ?';
        $params[] = $beforeId;
    }
    $sql = 'SELECT id, ts, kind, detail FROM realm_events';
    if (!empty($where)) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY id DESC LIMIT ?';
    $stmt = $pdo->prepare($sql);
    $bindPos = 1;
    foreach ($params as $p) {
        $stmt->bindValue($bindPos++, $p, is_int($p) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    $stmt->bindValue($bindPos, $lim, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $events = [];
    $nextCursor = null;
    foreach ($rows as $r) {
        $events[] = [
            'id' => (int) $r['id'],
            'ts' => (int) $r['ts'],
            'kind' => (string) $r['kind'],
            'detail' => (string) $r['detail'],
        ];
        $nextCursor = (int) $r['id'];
    }

    echo json_encode(
        [
            'events' => $events,
            'nextBeforeId' => $nextCursor,
            'generatedAt' => gmdate('c'),
        ],
        JSON_THROW_ON_ERROR,
    );
} catch (Throwable $e) {
    irpg_server_error($e);
}
