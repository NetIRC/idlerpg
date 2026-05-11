<?php
declare(strict_types=1);
/** Hardened admin auth/session helpers for the web control panel. */

require_once __DIR__ . '/bootstrap.php';

/**
 * @return array{
 *   enabled: bool,
 *   password_hash: string,
 *   ip_allowlist: array<int, string>,
 *   require_https: bool,
 *   session_ttl_sec: int,
 *   totp_enabled: bool,
 *   totp_secret_base32: string,
 *   totp_issuer: string
 * }
 */
function irpg_admin_settings(): array
{
    global $IRPG;
    $raw = $IRPG['admin_panel'] ?? [];
    $enabled = is_array($raw) && !empty($raw['enabled']);
    $passwordHash = is_array($raw) && is_string($raw['password_hash'] ?? null) ? trim((string) $raw['password_hash']) : '';
    $ipAllow = [];
    if (is_array($raw) && isset($raw['ip_allowlist']) && is_array($raw['ip_allowlist'])) {
        foreach ($raw['ip_allowlist'] as $ip) {
            if (!is_string($ip)) {
                continue;
            }
            $v = trim($ip);
            if ($v !== '') {
                $ipAllow[] = $v;
            }
        }
    }
    if (count($ipAllow) === 0) {
        $ipAllow = ['127.0.0.1', '::1'];
    }
    $requireHttps = !(is_array($raw) && array_key_exists('require_https', $raw) && !$raw['require_https']);
    $ttl = 1800;
    if (is_array($raw) && isset($raw['session_ttl_sec'])) {
        $ttl = max(300, min(86_400, (int) $raw['session_ttl_sec']));
    }
    $totpEnabled = is_array($raw) && !empty($raw['totp_enabled']);
    $totpSecret = is_array($raw) && is_string($raw['totp_secret_base32'] ?? null)
        ? strtoupper(trim((string) $raw['totp_secret_base32']))
        : '';
    $totpIssuer = is_array($raw) && is_string($raw['totp_issuer'] ?? null)
        ? trim((string) $raw['totp_issuer'])
        : 'IdleRPG Admin';

    return [
        'enabled' => $enabled,
        'password_hash' => $passwordHash,
        'ip_allowlist' => $ipAllow,
        'require_https' => $requireHttps,
        'session_ttl_sec' => $ttl,
        'totp_enabled' => $totpEnabled,
        'totp_secret_base32' => $totpSecret,
        'totp_issuer' => $totpIssuer,
    ];
}

function irpg_admin_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    $proto = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    if ($proto === 'https') {
        return true;
    }
    $ssl = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_SSL'] ?? ''));
    if ($ssl === 'on') {
        return true;
    }
    return (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

function irpg_admin_client_ip(): string
{
    return trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
}

function irpg_admin_ip_match_cidr(string $ip, string $cidr): bool
{
    $parts = explode('/', $cidr, 2);
    if (count($parts) !== 2) {
        return false;
    }
    [$subnet, $prefixRaw] = $parts;
    $ipBin = @inet_pton($ip);
    $subnetBin = @inet_pton($subnet);
    if ($ipBin === false || $subnetBin === false || strlen($ipBin) !== strlen($subnetBin)) {
        return false;
    }
    $prefix = (int) $prefixRaw;
    $maxBits = strlen($ipBin) * 8;
    if ($prefix < 0 || $prefix > $maxBits) {
        return false;
    }
    $fullBytes = intdiv($prefix, 8);
    $remainingBits = $prefix % 8;
    if ($fullBytes > 0 && substr($ipBin, 0, $fullBytes) !== substr($subnetBin, 0, $fullBytes)) {
        return false;
    }
    if ($remainingBits === 0) {
        return true;
    }
    $mask = (0xFF << (8 - $remainingBits)) & 0xFF;
    $ipByte = ord($ipBin[$fullBytes]);
    $subnetByte = ord($subnetBin[$fullBytes]);
    return ($ipByte & $mask) === ($subnetByte & $mask);
}

function irpg_admin_ip_allowed(string $ip, array $allowlist): bool
{
    if ($ip === '') {
        return false;
    }
    foreach ($allowlist as $rule) {
        $r = trim($rule);
        if ($r === '') {
            continue;
        }
        if (strpos($r, '/') !== false) {
            if (irpg_admin_ip_match_cidr($ip, $r)) {
                return true;
            }
            continue;
        }
        if ($ip === $r) {
            return true;
        }
    }
    return false;
}

function irpg_admin_security_headers(): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self';");
}

function irpg_admin_start_session(array $settings): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = irpg_admin_is_https();
    session_name('IRPG_ADMIN_SESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    $now = time();
    if (!isset($_SESSION['admin_last_seen'])) {
        $_SESSION['admin_last_seen'] = $now;
    } else {
        $last = (int) $_SESSION['admin_last_seen'];
        if (($now - $last) > $settings['session_ttl_sec']) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        $_SESSION['admin_last_seen'] = $now;
    }
}

function irpg_admin_auth_cookie_name(): string
{
    return 'IRPG_ADMIN_AUTH';
}

function irpg_admin_csrf_cookie_name(): string
{
    return 'IRPG_ADMIN_CSRF';
}

function irpg_admin_set_cookie(string $value, int $expiresAt): void
{
    $secure = irpg_admin_is_https();
    setcookie(irpg_admin_auth_cookie_name(), $value, [
        'expires' => $expiresAt,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function irpg_admin_clear_auth_cookie(): void
{
    irpg_admin_set_cookie('', time() - 3600);
}

function irpg_admin_set_csrf_cookie(string $token, int $expiresAt): void
{
    $secure = irpg_admin_is_https();
    setcookie(irpg_admin_csrf_cookie_name(), $token, [
        'expires' => $expiresAt,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function irpg_admin_clear_csrf_cookie(): void
{
    irpg_admin_set_csrf_cookie('', time() - 3600);
}

function irpg_admin_valid_csrf_token_format(string $token): bool
{
    return (bool) preg_match('/^[a-f0-9]{64}$/', $token);
}

function irpg_admin_ensure_csrf_token(array $settings): string
{
    if (isset($_SESSION['admin_csrf']) && is_string($_SESSION['admin_csrf']) && irpg_admin_valid_csrf_token_format($_SESSION['admin_csrf'])) {
        return $_SESSION['admin_csrf'];
    }
    $cookieToken = (string) ($_COOKIE[irpg_admin_csrf_cookie_name()] ?? '');
    if (irpg_admin_valid_csrf_token_format($cookieToken)) {
        $_SESSION['admin_csrf'] = $cookieToken;
        return $cookieToken;
    }
    $token = bin2hex(random_bytes(32));
    $_SESSION['admin_csrf'] = $token;
    $ttl = max(300, min(86_400, (int) ($settings['session_ttl_sec'] ?? 1800)));
    irpg_admin_set_csrf_cookie($token, time() + $ttl);
    return $token;
}

function irpg_admin_issue_auth_cookie(array $settings): void
{
    $ttl = max(300, min(86_400, (int) ($settings['session_ttl_sec'] ?? 1800)));
    $exp = time() + $ttl;
    $uaHash = hash('sha256', (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $payloadArr = ['exp' => $exp, 'ua' => $uaHash];
    $payload = base64_encode(json_encode($payloadArr));
    $sig = hash_hmac('sha256', $payload, (string) ($settings['password_hash'] ?? ''));
    irpg_admin_set_cookie($payload . '.' . $sig, $exp);
}

function irpg_admin_cookie_valid(array $settings): bool
{
    $raw = (string) ($_COOKIE[irpg_admin_auth_cookie_name()] ?? '');
    if ($raw === '' || strpos($raw, '.') === false) {
        return false;
    }
    [$payload, $sig] = explode('.', $raw, 2);
    if ($payload === '' || $sig === '' || (string) ($settings['password_hash'] ?? '') === '') {
        return false;
    }
    $expect = hash_hmac('sha256', $payload, (string) $settings['password_hash']);
    if (!hash_equals($expect, $sig)) {
        return false;
    }
    $decoded = json_decode((string) base64_decode($payload, true), true);
    if (!is_array($decoded)) {
        return false;
    }
    $exp = (int) ($decoded['exp'] ?? 0);
    if ($exp <= time()) {
        return false;
    }
    $uaHash = (string) ($decoded['ua'] ?? '');
    $currentUaHash = hash('sha256', (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    return $uaHash !== '' && hash_equals($uaHash, $currentUaHash);
}

function irpg_admin_mark_authenticated(array $settings): void
{
    $_SESSION['admin_ok'] = true;
    $_SESSION['admin_last_seen'] = time();
    $token = bin2hex(random_bytes(32));
    $_SESSION['admin_csrf'] = $token;
    $ttl = max(300, min(86_400, (int) ($settings['session_ttl_sec'] ?? 1800)));
    irpg_admin_set_csrf_cookie($token, time() + $ttl);
    irpg_admin_issue_auth_cookie($settings);
}

function irpg_admin_restore_auth_from_cookie(array $settings): bool
{
    if (irpg_admin_is_authenticated()) {
        return true;
    }
    if (!irpg_admin_cookie_valid($settings)) {
        return false;
    }
    $_SESSION['admin_ok'] = true;
    $_SESSION['admin_last_seen'] = time();
    irpg_admin_ensure_csrf_token($settings);
    return true;
}

function irpg_admin_rate_limit_path(): string
{
    $base = sys_get_temp_dir();
    return rtrim($base, '/\\') . DIRECTORY_SEPARATOR . 'idlerpg-admin-rate.json';
}

function irpg_admin_rate_limited(string $ip, int $maxAttempts = 8, int $windowSec = 900): bool
{
    $path = irpg_admin_rate_limit_path();
    $now = time();
    $data = [];
    if (is_file($path)) {
        $raw = @file_get_contents($path);
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }
    }
    $bucket = isset($data[$ip]) && is_array($data[$ip]) ? $data[$ip] : [];
    $filtered = [];
    foreach ($bucket as $ts) {
        $t = (int) $ts;
        if (($now - $t) <= $windowSec) {
            $filtered[] = $t;
        }
    }
    $data[$ip] = $filtered;
    @file_put_contents($path, json_encode($data, JSON_THROW_ON_ERROR), LOCK_EX);
    return count($filtered) >= $maxAttempts;
}

function irpg_admin_note_failed_attempt(string $ip): void
{
    $path = irpg_admin_rate_limit_path();
    $now = time();
    $data = [];
    if (is_file($path)) {
        $raw = @file_get_contents($path);
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }
    }
    $bucket = isset($data[$ip]) && is_array($data[$ip]) ? $data[$ip] : [];
    $bucket[] = $now;
    $data[$ip] = $bucket;
    @file_put_contents($path, json_encode($data, JSON_THROW_ON_ERROR), LOCK_EX);
}

function irpg_admin_require_access(array $settings): void
{
    if (!$settings['enabled']) {
        http_response_code(404);
        echo 'Not found';
        exit;
    }
    if ($settings['require_https'] && !irpg_admin_is_https()) {
        http_response_code(403);
        echo 'Admin panel requires HTTPS.';
        exit;
    }
    $ip = irpg_admin_client_ip();
    if (!irpg_admin_ip_allowed($ip, $settings['ip_allowlist'])) {
        http_response_code(403);
        echo 'Access denied for this IP.';
        exit;
    }
}

function irpg_admin_csrf_token(): string
{
    return irpg_admin_ensure_csrf_token(irpg_admin_settings());
}

function irpg_admin_check_csrf(string $submitted): bool
{
    $known = irpg_admin_ensure_csrf_token(irpg_admin_settings());
    if ($known !== '' && hash_equals($known, $submitted)) {
        return true;
    }
    $cookieToken = (string) ($_COOKIE[irpg_admin_csrf_cookie_name()] ?? '');
    if (!irpg_admin_valid_csrf_token_format($cookieToken)) {
        return false;
    }
    return hash_equals($cookieToken, $submitted);
}

function irpg_admin_is_authenticated(): bool
{
    return !empty($_SESSION['admin_ok']) && $_SESSION['admin_ok'] === true;
}

function irpg_admin_base32_decode(string $input): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $clean = strtoupper(preg_replace('/[^A-Z2-7]/', '', $input) ?? '');
    if ($clean === '') {
        return '';
    }
    $bits = '';
    $len = strlen($clean);
    for ($i = 0; $i < $len; $i++) {
        $ch = $clean[$i];
        $pos = strpos($alphabet, $ch);
        if ($pos === false) {
            return '';
        }
        $bits .= str_pad(decbin((int) $pos), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    for ($i = 0; $i + 8 <= strlen($bits); $i += 8) {
        $out .= chr(bindec(substr($bits, $i, 8)));
    }
    return $out;
}

function irpg_admin_totp_code(string $secretRaw, int $counter): string
{
    $counterBytes = pack('N*', 0, $counter);
    $hmac = hash_hmac('sha1', $counterBytes, $secretRaw, true);
    $offset = ord(substr($hmac, -1)) & 0x0F;
    $part = substr($hmac, $offset, 4);
    $binary = unpack('N', $part);
    $num = ((int) ($binary[1] ?? 0)) & 0x7FFFFFFF;
    $otp = $num % 1_000_000;
    return str_pad((string) $otp, 6, '0', STR_PAD_LEFT);
}

function irpg_admin_verify_totp(string $submittedCode, string $secretBase32): bool
{
    $code = preg_replace('/\s+/', '', trim($submittedCode)) ?? '';
    if (!preg_match('/^[0-9]{6}$/', $code)) {
        return false;
    }
    $secret = irpg_admin_base32_decode($secretBase32);
    if ($secret === '') {
        return false;
    }
    $timeStep = 30;
    $counter = (int) floor(time() / $timeStep);
    for ($drift = -1; $drift <= 1; $drift++) {
        $expect = irpg_admin_totp_code($secret, $counter + $drift);
        if (hash_equals($expect, $code)) {
            return true;
        }
    }
    return false;
}

function irpg_admin_totp_uri(array $settings): ?string
{
    if (empty($settings['totp_secret_base32'])) {
        return null;
    }
    $issuer = rawurlencode((string) $settings['totp_issuer']);
    $label = rawurlencode((string) $settings['totp_issuer']);
    $secret = rawurlencode((string) $settings['totp_secret_base32']);
    return "otpauth://totp/{$label}?secret={$secret}&issuer={$issuer}&algorithm=SHA1&digits=6&period=30";
}

function irpg_admin_totp_qr_url(?string $totpUri): ?string
{
    if ($totpUri === null || trim($totpUri) === '') {
        return null;
    }
    return 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=' . rawurlencode($totpUri);
}

function irpg_admin_generate_totp_secret(int $bytes = 20): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $raw = random_bytes(max(10, min(64, $bytes)));
    $bits = '';
    $len = strlen($raw);
    for ($i = 0; $i < $len; $i++) {
        $bits .= str_pad(decbin(ord($raw[$i])), 8, '0', STR_PAD_LEFT);
    }
    $pad = (5 - (strlen($bits) % 5)) % 5;
    if ($pad > 0) {
        $bits .= str_repeat('0', $pad);
    }
    $out = '';
    for ($i = 0; $i < strlen($bits); $i += 5) {
        $chunk = substr($bits, $i, 5);
        $out .= $alphabet[(int) bindec($chunk)];
    }
    return $out;
}

function irpg_admin_totp_secret_valid(string $secret): bool
{
    $s = strtoupper(trim($secret));
    if ($s === '' || strlen($s) < 16 || strlen($s) > 128) {
        return false;
    }
    return (bool) preg_match('/^[A-Z2-7]+$/', $s);
}

function irpg_admin_replace_or_insert_scalar(string $contents, string $key, string $valueLiteral): array
{
    $pattern = "/'" . preg_quote($key, '/') . "'\\s*=>\\s*([^,\\n]+),?/";
    $updated = preg_replace($pattern, "'" . $key . "' => " . $valueLiteral . ',', $contents, 1, $count);
    if (!is_string($updated)) {
        return [false, $contents];
    }
    if ($count > 0) {
        return [true, $updated];
    }
    $adminPanelPattern = "/('admin_panel'\\s*=>\\s*\\[\\s*)/";
    $insert = "'" . $key . "' => " . $valueLiteral . ",\n        ";
    $withInsert = preg_replace($adminPanelPattern, '$1' . $insert, $contents, 1, $icount);
    if (!is_string($withInsert) || $icount === 0) {
        return [false, $contents];
    }
    return [true, $withInsert];
}

/**
 * Enable/disable and manage TOTP settings by rewriting site.config.php.
 * Returns [ok, message].
 */
function irpg_admin_update_totp_settings(
    bool $enabled,
    string $issuer,
    string $secretInput,
    bool $regenerateSecret,
    string $currentPassword,
    string $activationCode,
    array $settings
): array {
    if (!irpg_admin_is_authenticated()) {
        return [false, 'Authentication required.'];
    }
    if (!password_verify($currentPassword, (string) $settings['password_hash'])) {
        return [false, 'Current password is invalid.'];
    }

    $wasEnabled = !empty($settings['totp_enabled']);
    if ($enabled && $regenerateSecret) {
        return [false, 'Disable TOTP before regenerating the secret.'];
    }
    $secret = strtoupper(trim($secretInput));
    if ($regenerateSecret) {
        $secret = irpg_admin_generate_totp_secret();
    }
    if ($enabled && $secret === '') {
        $secret = strtoupper((string) ($settings['totp_secret_base32'] ?? ''));
        if ($secret === '') {
            $secret = irpg_admin_generate_totp_secret();
        }
    }
    if ($enabled && !irpg_admin_totp_secret_valid($secret)) {
        return [false, 'TOTP secret must be Base32 (A-Z2-7), length 16-128.'];
    }
    if ($enabled && !$wasEnabled) {
        if (!irpg_admin_verify_totp((string) $activationCode, $secret)) {
            return [false, 'TOTP verification code is invalid.'];
        }
    }
    if (!$enabled && $wasEnabled) {
        $currentSecret = (string) ($settings['totp_secret_base32'] ?? '');
        if ($currentSecret === '' || !irpg_admin_verify_totp((string) $activationCode, $currentSecret)) {
            return [false, 'TOTP verification code is invalid.'];
        }
    }

    $issuerClean = trim($issuer);
    if ($issuerClean === '') {
        $issuerClean = 'IdleRPG Admin';
    }
    if (strlen($issuerClean) > 80) {
        return [false, 'TOTP issuer is too long (max 80 chars).'];
    }

    $configPath = (string) ($GLOBALS['irpg_site_config_file'] ?? '');
    if ($configPath === '' || !is_file($configPath)) {
        return [false, 'site.config.php path is unavailable.'];
    }
    if (!is_writable($configPath)) {
        return [false, 'site.config.php is not writable by PHP user.'];
    }
    $contents = @file_get_contents($configPath);
    if (!is_string($contents) || $contents === '') {
        return [false, 'Failed to read site.config.php.'];
    }

    [$ok1, $c1] = irpg_admin_replace_or_insert_scalar($contents, 'totp_enabled', $enabled ? 'true' : 'false');
    if (!$ok1) {
        return [false, 'Unable to update totp_enabled in site.config.php.'];
    }
    [$ok2, $c2] = irpg_admin_replace_or_insert_scalar($c1, 'totp_secret_base32', "'" . $secret . "'");
    if (!$ok2) {
        return [false, 'Unable to update totp_secret_base32 in site.config.php.'];
    }
    [$ok3, $c3] = irpg_admin_replace_or_insert_scalar($c2, 'totp_issuer', "'" . str_replace("'", "\\'", $issuerClean) . "'");
    if (!$ok3) {
        return [false, 'Unable to update totp_issuer in site.config.php.'];
    }

    $written = @file_put_contents($configPath, $c3, LOCK_EX);
    if ($written === false) {
        return [false, 'Failed writing TOTP settings to site.config.php.'];
    }
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate($configPath, true);
    }

    if ($enabled) {
        return [true, $regenerateSecret ? 'TOTP enabled/updated. Secret regenerated.' : 'TOTP enabled/updated.'];
    }
    return [true, $regenerateSecret ? 'TOTP disabled. Secret regenerated.' : 'TOTP disabled.'];
}

function irpg_admin_login(string $password, ?string $totpCode, array $settings): bool
{
    if ($settings['password_hash'] === '') {
        return false;
    }
    if (!password_verify($password, $settings['password_hash'])) {
        return false;
    }
    if (!empty($settings['totp_enabled'])) {
        if (empty($settings['totp_secret_base32'])) {
            return false;
        }
        return irpg_admin_verify_totp((string) ($totpCode ?? ''), (string) $settings['totp_secret_base32']);
    }
    return true;
}

function irpg_admin_logout(): void
{
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['admin_csrf'] = bin2hex(random_bytes(32));
    $_SESSION['admin_last_seen'] = time();
    irpg_admin_clear_auth_cookie();
    irpg_admin_clear_csrf_cookie();
}

/**
 * Rotate admin password hash in site.config.php.
 * Returns [ok, message].
 */
function irpg_admin_rotate_password(string $currentPassword, string $newPassword, string $confirmPassword, array $settings): array
{
    if (!irpg_admin_is_authenticated()) {
        return [false, 'Authentication required.'];
    }
    if ($settings['password_hash'] === '') {
        return [false, 'Admin password hash is not configured.'];
    }
    if (!password_verify($currentPassword, $settings['password_hash'])) {
        return [false, 'Current password is invalid.'];
    }
    if ($newPassword !== $confirmPassword) {
        return [false, 'New password and confirmation do not match.'];
    }
    $len = strlen($newPassword);
    if ($len < 6 || $len > 128) {
        return [false, 'New password length must be between 6 and 128 characters.'];
    }
    $hasUpper = (bool) preg_match('/[A-Z]/', $newPassword);
    $hasSpecial = (bool) preg_match('/[^a-zA-Z0-9]/', $newPassword);
    if (!$hasUpper || !$hasSpecial) {
        return [false, 'New password must include at least one uppercase letter and one special character.'];
    }

    $configPath = (string) ($GLOBALS['irpg_site_config_file'] ?? '');
    if ($configPath === '' || !is_file($configPath)) {
        return [false, 'site.config.php path is unavailable.'];
    }
    if (!is_writable($configPath)) {
        return [false, 'site.config.php is not writable by PHP user.'];
    }
    $contents = @file_get_contents($configPath);
    if (!is_string($contents) || $contents === '') {
        return [false, 'Failed to read site.config.php.'];
    }
    if (!preg_match("/'password_hash'\\s*=>\\s*'[^']*'/", $contents)) {
        return [false, "Could not find 'password_hash' entry in site.config.php."];
    }
    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $updated = preg_replace_callback(
        "/'password_hash'\\s*=>\\s*'[^']*'/",
        static function () use ($newHash): string {
            return "'password_hash' => '" . $newHash . "'";
        },
        $contents,
        1
    );
    if (!is_string($updated) || $updated === '') {
        return [false, 'Failed to build updated site.config.php content.'];
    }
    $ok = @file_put_contents($configPath, $updated, LOCK_EX);
    if ($ok === false) {
        return [false, 'Failed writing new hash to site.config.php.'];
    }
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate($configPath, true);
    }

    return [true, 'Admin password updated successfully.'];
}

function irpg_admin_format_bytes(int $bytes): string
{
    if ($bytes < 1024) {
        return $bytes . ' B';
    }
    $units = ['KB', 'MB', 'GB', 'TB'];
    $value = (float) $bytes;
    $idx = -1;
    while ($value >= 1024.0 && $idx < count($units) - 1) {
        $value /= 1024.0;
        $idx++;
    }
    return number_format($value, 2) . ' ' . $units[max(0, $idx)];
}

/**
 * @return array{
 *   dbPath: string,
 *   dbSizeBytes: int,
 *   walSizeBytes: int,
 *   shmSizeBytes: int,
 *   pageSize: int,
 *   pageCount: int,
 *   freelistCount: int,
 *   freePct: float,
 *   integrityOk: bool,
 *   integrityMessage: string,
 *   recommendation: string
 * }
 */
function irpg_admin_db_health(PDO $pdo): array
{
    global $dbPath;
    $path = (string) $dbPath;
    $dbSize = (is_file($path) && is_readable($path)) ? (int) filesize($path) : 0;
    $walPath = $path . '-wal';
    $shmPath = $path . '-shm';
    $walSize = (is_file($walPath) && is_readable($walPath)) ? (int) filesize($walPath) : 0;
    $shmSize = (is_file($shmPath) && is_readable($shmPath)) ? (int) filesize($shmPath) : 0;

    $pageSize = 0;
    $pageCount = 0;
    $freelist = 0;
    $integrity = 'unknown';
    try {
        $pageSize = (int) ($pdo->query('PRAGMA page_size')->fetchColumn() ?: 0);
        $pageCount = (int) ($pdo->query('PRAGMA page_count')->fetchColumn() ?: 0);
        $freelist = (int) ($pdo->query('PRAGMA freelist_count')->fetchColumn() ?: 0);
        $integrityRaw = $pdo->query('PRAGMA integrity_check(1)')->fetchColumn();
        $integrity = is_string($integrityRaw) ? trim($integrityRaw) : 'unknown';
    } catch (Throwable) {
        // Keep panel resilient on older/odd SQLite builds.
    }

    $freePct = 0.0;
    if ($pageCount > 0 && $freelist > 0) {
        $freePct = ($freelist / $pageCount) * 100.0;
    }

    $integrityOk = strcasecmp($integrity, 'ok') === 0;
    $recommendation = 'No immediate optimization needed.';
    if (!$integrityOk) {
        $recommendation = 'Integrity check is not ok: stop writes and investigate before maintenance.';
    } elseif ($freePct >= 20.0) {
        $recommendation = 'Consider VACUUM during maintenance (bot offline) to reclaim free pages.';
    } elseif ($walSize > (64 * 1024 * 1024)) {
        $recommendation = 'Large WAL detected. Consider controlled checkpoint during maintenance.';
    }

    return [
        'dbPath' => $path,
        'dbSizeBytes' => $dbSize,
        'walSizeBytes' => $walSize,
        'shmSizeBytes' => $shmSize,
        'pageSize' => $pageSize,
        'pageCount' => $pageCount,
        'freelistCount' => $freelist,
        'freePct' => round($freePct, 2),
        'integrityOk' => $integrityOk,
        'integrityMessage' => $integrity,
        'recommendation' => $recommendation,
    ];
}

/**
 * Build a downloadable DB snapshot.
 * Prefers VACUUM INTO for consistency; falls back to raw copy.
 *
 * @return array{ok: bool, path?: string, error?: string}
 */
function irpg_admin_prepare_backup(PDO $pdo): array
{
    global $dbPath;
    $sourcePath = (string) $dbPath;
    if ($sourcePath === '' || !is_file($sourcePath) || !is_readable($sourcePath)) {
        return ['ok' => false, 'error' => 'Source DB is not readable.'];
    }
    $tmp = tempnam(sys_get_temp_dir(), 'irpg-backup-');
    if ($tmp === false) {
        return ['ok' => false, 'error' => 'Cannot create temporary backup file.'];
    }
    $target = $tmp . '.db';
    @unlink($tmp);

    try {
        $quoted = str_replace("'", "''", $target);
        $pdo->exec("VACUUM INTO '" . $quoted . "'");
        if (is_file($target) && filesize($target) !== false && (int) filesize($target) > 0) {
            return ['ok' => true, 'path' => $target];
        }
    } catch (Throwable) {
        // Fallback to copy below.
    }

    if (!@copy($sourcePath, $target)) {
        return ['ok' => false, 'error' => 'Backup copy failed.'];
    }
    return ['ok' => true, 'path' => $target];
}

function irpg_admin_stream_backup_file(string $path): void
{
    if (!is_file($path) || !is_readable($path)) {
        throw new RuntimeException('Backup file not readable.');
    }
    $size = (int) filesize($path);
    $name = 'idlerpg-backup-' . gmdate('Ymd-His') . '.db';
    header('Content-Type: application/x-sqlite3');
    header('Content-Length: ' . $size);
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('X-Content-Type-Options: nosniff');
    $fh = fopen($path, 'rb');
    if ($fh === false) {
        throw new RuntimeException('Unable to open backup stream.');
    }
    while (!feof($fh)) {
        $chunk = fread($fh, 8192);
        if ($chunk === false) {
            break;
        }
        echo $chunk;
    }
    fclose($fh);
}
