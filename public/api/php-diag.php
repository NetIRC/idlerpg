<?php
declare(strict_types=1);
/**
 * Web SAPI diagnostics (which PHP Apache/FPM actually uses). No DB.
 * If CLI shows pdo_sqlite but this JSON does not, the site uses a different PHP binary/INI.
 * Runtime guard: local-only unless IRPG_PHP_DIAG_ENABLED=true.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$isLocal = in_array($remote, ['127.0.0.1', '::1'], true);
$raw = getenv('IRPG_PHP_DIAG_ENABLED');
$diagEnabled = $raw !== false && in_array(strtolower(trim((string) $raw)), ['1', 'true', 'yes', 'on'], true);
if (!$diagEnabled && !$isLocal) {
    http_response_code(403);
    echo json_encode([
        'error' => 'forbidden',
        'hint' => 'php-diag is disabled for non-local requests. Set IRPG_PHP_DIAG_ENABLED=true temporarily if needed.',
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

$hasPdo = class_exists(PDO::class, false);
echo json_encode([
    'sapi' => PHP_SAPI,
    'php_version' => PHP_VERSION,
    'ini_loaded' => php_ini_loaded_file() ?: null,
    'extension_pdo' => extension_loaded('pdo'),
    'extension_pdo_sqlite' => extension_loaded('pdo_sqlite'),
    'extension_sqlite3' => extension_loaded('sqlite3'),
    'pdo_drivers' => $hasPdo ? PDO::getAvailableDrivers() : [],
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
