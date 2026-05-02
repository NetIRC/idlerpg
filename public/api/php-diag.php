<?php
declare(strict_types=1);
/**
 * Web SAPI diagnostics (which PHP Apache/FPM actually uses). No DB.
 * If CLI shows pdo_sqlite but this JSON does not, the site uses a different PHP binary/INI.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

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
