<?php
declare(strict_types=1);

/**
 * Loads site.config.php outside the document root.
 *
 * Layout A — DocumentRoot = .../project/public → config in .../project/
 * Layout B — only public/ in ~/public_html → config in ~/idlerpg/site.config.php
 * Layout C — copy public/includes/local-root.php.example → local-root.php returning absolute path
 *   to the folder that contains site.config.php (first path tried).
 */

$bootstrapDir = __DIR__;
$publicParent = dirname($bootstrapDir, 2);

$bases = [];
$localRootFile = $bootstrapDir . '/local-root.php';
if (is_file($localRootFile)) {
    $extra = require $localRootFile;
    if (is_string($extra) && $extra !== '') {
        $bases[] = rtrim(str_replace('\\', '/', $extra), '/');
    }
}
$bases[] = $publicParent;
$bases[] = $publicParent . '/idlerpg';

$configFile = null;
foreach ($bases as $base) {
    $f = $base . '/site.config.php';
    if (is_file($f)) {
        $configFile = $f;
        break;
    }
}
if ($configFile === null) {
    foreach ($bases as $base) {
        $f = $base . '/site.config.php.example';
        if (is_file($f)) {
            $configFile = $f;
            break;
        }
    }
}

if ($configFile === null) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'missing_config',
        'hint' => 'No site.config.php found. Copy site.config.php.example next to public/, under ~/idlerpg/, or add public/includes/local-root.php that returns the absolute path to the folder containing site.config.php.',
        'searched' => $bases,
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

/** Project root for resolving relative db_path (same folder as the loaded config). */
$ROOT = dirname($configFile);

/** @var array{db_path: string, case_sensitive_names: bool, debug?: bool} $IRPG */
$IRPG = require $configFile;

$dbPath = $IRPG['db_path'];
if ($dbPath === '' || ($dbPath[0] !== '/' && !preg_match('#^[A-Za-z]:[\\\\/]#', $dbPath))) {
    $dbPath = $ROOT . '/' . ltrim(str_replace('\\', '/', $dbPath), '/');
}

function irpg_duration_it(float $totalSec): string
{
    if (!is_finite($totalSec) || $totalSec < 0) {
        return 'n/a (' . $totalSec . ')';
    }
    $s = (int) floor($totalSec);
    $days = intdiv($s, 86400);
    $h = intdiv($s % 86400, 3600);
    $m = intdiv($s % 3600, 60);
    $sec = $s % 60;
    $dayWord = $days === 1 ? 'day' : 'days';

    return sprintf('%d %s, %02d:%02d:%02d', $days, $dayWord, $h, $m, $sec);
}

/**
 * Realm chronicle JSON API — keep defaults in sync with src/game/chronicle-omen.ts
 * (CHRONICLE_API_DEFAULT_LIMIT, CHRONICLE_API_MAX_LIMIT).
 */
function irpg_chronicle_default_limit(): int
{
    return 16;
}

function irpg_chronicle_max_limit(): int
{
    return 40;
}

function irpg_pdo(): PDO
{
    global $dbPath;
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    if (!extension_loaded('pdo_sqlite') && !in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('irpg_pdo_no_sqlite');
    }
    if (!is_file($dbPath)) {
        throw new RuntimeException('irpg_db_missing:' . $dbPath);
    }
    if (!is_readable($dbPath)) {
        throw new RuntimeException('irpg_db_unreadable:' . $dbPath);
    }
    try {
        $pdo = new PDO('sqlite:' . $dbPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
    } catch (PDOException $e) {
        throw new RuntimeException('irpg_db_open:' . $e->getMessage(), 0, $e);
    }

    return $pdo;
}

/**
 * IRC bot liveness for the web UI (same semantics as Node `botPresenceFromDb`).
 * @return array{botOnline: bool, botLastSeenMs: int|null}
 */
function irpg_bot_presence(PDO $pdo): array
{
    /** @var int Must match src/db/index.ts BOT_HEARTBEAT_STALE_MS */
    $staleMs = 120_000;
    /** @var string Must match src/db/index.ts META_KEY_BOT_LAST_SEEN_MS */
    $key = 'bot_last_seen_ms';
    try {
        $st = $pdo->prepare('SELECT int_value FROM meta WHERE key = ? LIMIT 1');
        $st->execute([$key]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return ['botOnline' => false, 'botLastSeenMs' => null];
        }
        $last = (int) $row['int_value'];
        if ($last <= 0) {
            return ['botOnline' => false, 'botLastSeenMs' => null];
        }
        $nowMs = (int) round(microtime(true) * 1000);
        $age = $nowMs - $last;
        if ($age < 0) {
            return ['botOnline' => false, 'botLastSeenMs' => $last];
        }

        return [
            'botOnline' => $age <= $staleMs,
            'botLastSeenMs' => $last,
        ];
    } catch (Throwable) {
        return ['botOnline' => false, 'botLastSeenMs' => null];
    }
}

function irpg_json_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
}

/**
 * JSON error response for API scripts (structured hint for the dashboard + optional debug).
 */
function irpg_server_error(Throwable $e): void
{
    global $IRPG;
    $debug = !empty($IRPG['debug']);
    $m = $e->getMessage();

    if ($m === 'irpg_pdo_no_sqlite' || stripos($m, 'could not find driver') !== false) {
        http_response_code(503);
        irpg_json_headers();
        echo json_encode([
            'error' => 'pdo_sqlite_missing',
            'hint' => 'PHP is missing the PDO SQLite driver (pdo_sqlite). Install it for your PHP version, then restart php-fpm/Apache. Examples: Debian/Ubuntu: sudo apt install php-sqlite3 (or php8.2-sqlite3). RHEL/Alma: sudo dnf install php-pdo sqlite. Ensure php.ini loads extension=pdo_sqlite (some distros enable it automatically). Verify: php -m | grep -i sqlite. Shared hosting: enable "PDO SQLite" / pdo_sqlite in the control panel or ask the provider.',
            'message' => $m === 'irpg_pdo_no_sqlite' ? 'could not find driver' : substr($m, 0, 400),
        ], JSON_THROW_ON_ERROR);
        return;
    }

    if (str_starts_with($m, 'irpg_db_missing:')) {
        $p = substr($m, strlen('irpg_db_missing:'));
        http_response_code(503);
        irpg_json_headers();
        echo json_encode([
            'error' => 'db_missing',
            'hint' => 'SQLite file not found. In site.config.php set db_path to the same absolute path as IRPG_DB_PATH in the bot .env (e.g. /home/you/idlerpg/data/iodlerpg.db). Run the bot once to create the file.',
            'path' => $debug ? $p : null,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return;
    }

    if (str_starts_with($m, 'irpg_db_unreadable:')) {
        $p = substr($m, strlen('irpg_db_unreadable:'));
        http_response_code(503);
        irpg_json_headers();
        echo json_encode([
            'error' => 'db_unreadable',
            'hint' => 'PHP cannot read the SQLite file. Fix permissions: group-read for the web user (e.g. chgrp apache data && chmod 640 iodlerpg.db && chmod 711 data) or chmod o+r on the .db (see DEPLOY.md).',
            'path' => $debug ? $p : null,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return;
    }

    if (str_starts_with($m, 'irpg_db_open:')) {
        $inner = substr($m, strlen('irpg_db_open:'));
        $safeMsg = $inner !== '' ? substr($inner, 0, 400) : '';
        http_response_code(503);
        irpg_json_headers();
        echo json_encode([
            'error' => 'db_open',
            'hint' => 'SQLite/PDO could not open the database file. Check open_basedir (PHP), SELinux (see DEPLOY.md), directory permissions along the path, and that the file is not corrupt. The driver message below usually tells whether it is access denied vs path.',
            'message' => $safeMsg !== '' ? $safeMsg : null,
        ], JSON_THROW_ON_ERROR);
        return;
    }

    http_response_code(500);
    irpg_json_headers();
    $out = [
        'error' => 'server',
        'hint' => 'Unexpected database error. Set debug => true in site.config.php to see details.',
    ];
    if ($debug) {
        $out['message'] = $m;
    }
    echo json_encode($out, JSON_THROW_ON_ERROR);
}
