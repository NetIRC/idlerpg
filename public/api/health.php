<?php
declare(strict_types=1);

/** Health endpoint for bot/site runtime checks and DB reachability. */

require_once dirname(__DIR__) . '/includes/bootstrap.php';

irpg_json_headers();

try {
    irpg_pdo()->query('SELECT 1');
    $db = true;
} catch (Throwable $e) {
    irpg_server_error($e);
    return;
}

echo json_encode(['ok' => true, 'name' => 'idlerpg', 'db' => $db], JSON_THROW_ON_ERROR);
