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

/**
 * Use the first readable SQLite file among the config path, standard data/ locations,
 * and IRPG_DB_PATH — fixes mismatches when site.config.php lives in a different tree than
 * the bot cwd (e.g. db under web project root but db_path resolved next to config only).
 *
 * @return array{0: string, 1: list<string>} chosen path (may still be missing), paths tried in order
 */
function irpg_pick_readable_sqlite(string $resolvedPrimary, string $configRoot, string $webProjectRoot): array
{
    $norm = static function (string $p): string {
        return str_replace('\\', '/', $p);
    };
    /** @var list<string> $candidates */
    $candidates = [];
    $add = static function (string $p) use (&$candidates, $norm): void {
        $p = trim($norm($p));
        if ($p === '') {
            return;
        }
        $candidates[] = $p;
    };

    $add($resolvedPrimary);
    $add($configRoot . '/data/idlerpg.db');
    $add($webProjectRoot . '/data/idlerpg.db');
    $parentWeb = dirname(rtrim($norm($webProjectRoot), '/'));
    if ($parentWeb !== '' && $parentWeb !== '/' && $parentWeb !== $norm($webProjectRoot)) {
        $add($parentWeb . '/data/idlerpg.db');
    }

    $env = getenv('IRPG_DB_PATH');
    if ($env !== false && ($env = trim($env)) !== '') {
        $ev = $norm($env);
        if ($ev !== '' && ($ev[0] === '/' || preg_match('#^[A-Za-z]:/#', $ev))) {
            $add($ev);
        } else {
            $add(rtrim($webProjectRoot, '/') . '/' . ltrim($ev, '/'));
            $add(rtrim($configRoot, '/') . '/' . ltrim($ev, '/'));
        }
    }

    /** @var list<string> $tried */
    $tried = [];
    foreach ($candidates as $c) {
        if (in_array($c, $tried, true)) {
            continue;
        }
        $tried[] = $c;
        if (is_file($c) && is_readable($c)) {
            return [$c, $tried];
        }
    }

    return [$resolvedPrimary, $tried];
}

[$dbPath, $GLOBALS['irpg_db_tried_paths']] = irpg_pick_readable_sqlite($dbPath, $ROOT, $publicParent);

function irpg_duration_it(float $totalSec): string
{
    if (!is_finite($totalSec) || $totalSec < 0) {
        return 'n/a (' . $totalSec . ')';
    }
    $s = (int) floor($totalSec);
    if ($s < 60) {
        return sprintf('%ds', $s);
    }
    $days = intdiv($s, 86400);
    $h = intdiv($s % 86400, 3600);
    $m = intdiv($s % 3600, 60);
    $sec = $s % 60;
    if ($days === 0 && $h === 0) {
        if ($sec === 0) {
            return sprintf('%dm', $m);
        }

        return sprintf('%dm %ds', $m, $sec);
    }
    $clock = sprintf('%d:%02d:%02d', $h, $m, $sec);
    if ($days === 0) {
        return $clock;
    }
    $dayWord = $days === 1 ? 'day' : 'days';

    return sprintf('%d %s, %s', $days, $dayWord, $clock);
}

/** Display labels for `player_medals.medal_key` — keep in sync with `src/game/medals.ts` MEDAL_DEF. */
function irpg_medal_label(string $key): string
{
    static $map = [
        'quest_crest' => 'Quest Crest',
        'first_duel' => 'First Blood',
        'duel_blade_5' => 'Fivefold Blade',
        'duel_blade_15' => 'Fifteen Strikes',
        'gauntlet_shade' => 'Shade Walker',
        'gauntlet_void' => 'Void Dancer',
        'ascendant_10' => 'Ascendant X',
        'storm_25' => 'Storm of Stillness',
        'myth_idle_50' => 'Myth-Idle',
        'century_100' => 'Century Mark',
    ];

    return $map[$key] ?? $key;
}

/** Tier for medal chip styling — keep in sync with `src/game/medals.ts` MEDAL_DEF.tier */
function irpg_medal_tier(string $key): string
{
    static $map = [
        'quest_crest' => 'silver',
        'first_duel' => 'bronze',
        'duel_blade_5' => 'silver',
        'duel_blade_15' => 'gold',
        'gauntlet_shade' => 'bronze',
        'gauntlet_void' => 'gold',
        'ascendant_10' => 'bronze',
        'storm_25' => 'silver',
        'myth_idle_50' => 'gold',
        'century_100' => 'mythic',
    ];

    return $map[$key] ?? 'bronze';
}

/**
 * Apply additive schema for production DBs that predate medals / combat stats.
 * Idempotent; safe with existing rows (new columns default to 0). Keep in sync with
 * `ensurePlayerMedalsTable` + `ensureCombatStatColumns` in src/db/index.ts.
 */
function irpg_ensure_db_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS player_medals (
            player_id INTEGER NOT NULL,
            medal_key TEXT NOT NULL,
            ts INTEGER NOT NULL,
            PRIMARY KEY (player_id, medal_key)
        );
        CREATE INDEX IF NOT EXISTS idx_player_medals_player ON player_medals(player_id);'
    );

    $stmt = $pdo->query('PRAGMA table_info(players)');
    if ($stmt === false) {
        return;
    }
    /** @var list<array{name?: string}> $cols */
    $cols = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $names = [];
    foreach ($cols as $c) {
        if (isset($c['name'])) {
            $names[(string) $c['name']] = true;
        }
    }
    if (!isset($names['duel_wins'])) {
        $pdo->exec('ALTER TABLE players ADD COLUMN duel_wins INTEGER NOT NULL DEFAULT 0');
    }
    if (!isset($names['gauntlet_wins'])) {
        $pdo->exec('ALTER TABLE players ADD COLUMN gauntlet_wins INTEGER NOT NULL DEFAULT 0');
    }
}

/**
 * Realm chronicle JSON API — keep defaults in sync with src/game/chronicle-omen.ts
 * (CHRONICLE_API_DEFAULT_LIMIT, CHRONICLE_API_MAX_LIMIT).
 */
function irpg_chronicle_default_limit(): int
{
    return 15;
}

function irpg_chronicle_max_limit(): int
{
    return 40;
}

/** Meta int helper for realm pulse (same keys as Node `realm.ts`). */
function irpg_meta_int(PDO $pdo, string $key): ?int
{
    $st = $pdo->prepare('SELECT int_value FROM meta WHERE key = ? LIMIT 1');
    $st->execute([$key]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        return null;
    }

    return (int) $row['int_value'];
}

/**
 * Realm snapshot for dashboard / IRC !realm — keep strings in line with src/game/realm.ts realmPulseData.
 *
 * @return array{display: string, onlineHeroes: int, questActive: bool, questShort: ?string, luckySecondsLeft: int, recordName: ?string, recordLevel: ?int}
 */
function irpg_realm_pulse(PDO $pdo): array
{
    $stmt = $pdo->query('SELECT COUNT(*) FROM players WHERE online = 1');
    $onlineHeroes = (int) $stmt->fetchColumn();
    $now = time();
    $qActive = irpg_meta_int($pdo, 'quest_active') === 1;
    $questShort = null;
    if ($qActive) {
        $ends = irpg_meta_int($pdo, 'quest_ends_at') ?? 0;
        $left = max(0, $ends - $now);
        $s0 = irpg_meta_int($pdo, 'quest_t0') ?? 0;
        $s1 = irpg_meta_int($pdo, 'quest_t1') ?? 0;
        $questShort = 'Sunbound ' . $s0 . ' vs Moonveil ' . $s1 . ' · ' . irpg_duration_it((float) $left);
    }
    $luckyUntil = irpg_meta_int($pdo, 'lucky_until') ?? 0;
    $luckyLeft = max(0, $luckyUntil - $now);
    $recLv = irpg_meta_int($pdo, 'realm_record_level');
    $st = $pdo->prepare('SELECT text_value FROM meta WHERE key = ? LIMIT 1');
    $st->execute(['realm_record_name']);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $recName = null;
    if ($row !== false && $row['text_value'] !== null && $row['text_value'] !== '') {
        $recName = (string) $row['text_value'];
    }

    $segments = [];
    $segments[] = $onlineHeroes . ' hero' . ($onlineHeroes !== 1 ? 'es' : '') . ' online';
    $segments[] = $qActive && $questShort !== null ? ('Quest live: ' . $questShort) : 'Quest dormant';
    if ($luckyLeft > 0) {
        $segments[] = 'Lucky hour ' . irpg_duration_it((float) $luckyLeft);
    } else {
        $segments[] = 'Lucky quiet';
    }
    if ($recName !== null && $recLv !== null && $recLv > 0) {
        $segments[] = 'Peak ' . $recName . ' L' . $recLv;
    } else {
        $segments[] = 'No realm peak yet';
    }
    $display = '◆ ' . implode(' · ', $segments);

    return [
        'onlineHeroes' => $onlineHeroes,
        'questActive' => $qActive,
        'questShort' => $questShort,
        'luckySecondsLeft' => $luckyLeft,
        'recordName' => $recName,
        'recordLevel' => $recLv,
        'display' => $display,
    ];
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
        irpg_ensure_db_schema($pdo);
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
            'hint' => 'SQLite file not found. Set db_path in site.config.php to the real file (same as the bot’s IRPG_DB_PATH / .env), or place idlerpg.db in projectRoot/data/. If the bot runs with another cwd, use an absolute path for both. Run the bot once to create the database.',
            'path' => $p,
            'tried' => $GLOBALS['irpg_db_tried_paths'] ?? [],
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return;
    }

    if (str_starts_with($m, 'irpg_db_unreadable:')) {
        $p = substr($m, strlen('irpg_db_unreadable:'));
        http_response_code(503);
        irpg_json_headers();
        echo json_encode([
            'error' => 'db_unreadable',
            'hint' => 'PHP cannot read the SQLite file. Fix permissions: group-read for the web user (e.g. chgrp apache data && chmod 640 idlerpg.db && chmod 711 data) or chmod o+r on the .db (see DEPLOY.md).',
            'path' => $p,
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
