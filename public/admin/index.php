<?php
declare(strict_types=1);
/** Hardened admin operations panel (auth + diagnostics + maintenance). */

require_once dirname(__DIR__) . '/includes/admin-auth.php';

$adminCssPath = dirname(__DIR__) . '/assets/admin.css';
$adminCssVer = is_file($adminCssPath) ? (string) filemtime($adminCssPath) : '0';
$adminJsPath = dirname(__DIR__) . '/assets/admin.js';
$adminJsVer = is_file($adminJsPath) ? (string) filemtime($adminJsPath) : '0';

$settings = irpg_admin_settings();
$totpEnabledUi = !empty($settings['totp_enabled']);
irpg_admin_security_headers();
irpg_admin_require_access($settings);
irpg_admin_start_session($settings);
irpg_admin_restore_auth_from_cookie($settings);

$ip = irpg_admin_client_ip();
$errors = isset($_SESSION['admin_flash_errors']) && is_array($_SESSION['admin_flash_errors']) ? $_SESSION['admin_flash_errors'] : [];
$notices = isset($_SESSION['admin_flash_notices']) && is_array($_SESSION['admin_flash_notices']) ? $_SESSION['admin_flash_notices'] : [];
/** @var array<string, string> $inlineErrors */
$inlineErrors = [
    'login_password' => '',
    'login_totp' => '',
    'totp_secret' => '',
    'totp_current_password' => '',
    'totp_activation_code' => '',
    'pass_current_password' => '',
    'pass_new_password' => '',
    'pass_confirm_password' => '',
    'pass_complexity' => '',
];
/** @var array<string, string> $inlineNotices */
$inlineNotices = [
    'totp_secret' => '',
    'totp_general' => '',
];
unset($_SESSION['admin_flash_errors'], $_SESSION['admin_flash_notices']);
$pendingBackupDownload = false;
$isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
if (isset($_GET['signed_out']) && (string) $_GET['signed_out'] === '1') {
    $notices[] = 'Signed out.';
}
if (isset($_GET['login_error'])) {
    $code = (string) $_GET['login_error'];
    if ($code === 'rate_limited') {
        $errors[] = 'Too many failed attempts. Try again later.';
    } elseif ($code === 'invalid_credentials') {
        $errors[] = 'Invalid credentials.';
        $inlineErrors['login_password'] = 'Password or authenticator code is incorrect.';
        $inlineErrors['login_totp'] = 'Password or authenticator code is incorrect.';
    }
}
if (isset($_GET['totp_status'])) {
    $code = (string) $_GET['totp_status'];
    if ($code === 'bad_password') {
        $errors[] = 'Current password is invalid.';
        $inlineErrors['totp_current_password'] = 'Current password is invalid.';
    } elseif ($code === 'invalid_secret') {
        $errors[] = 'TOTP secret must be Base32 (A-Z2-7), length 16-128.';
        $inlineErrors['totp_secret'] = 'Use Base32 characters (A-Z, 2-7), 16-128 chars.';
    } elseif ($code === 'bad_token') {
        $errors[] = 'TOTP verification code is invalid.';
        $inlineErrors['totp_activation_code'] = 'Enter a valid 6-digit code from your authenticator app.';
    } elseif ($code === 'regen_requires_disable') {
        $errors[] = 'Disable TOTP before regenerating the secret.';
        $inlineErrors['totp_secret'] = 'Disable TOTP first, then regenerate the secret.';
    } elseif ($code === 'write_failed') {
        $errors[] = 'Failed writing TOTP settings. Check site.config.php permissions.';
        $inlineErrors['totp_secret'] = 'Save failed. Check file permissions and try again.';
    } elseif ($code === 'ok_enabled') {
        $notices[] = 'TOTP enabled/updated.';
        $inlineNotices['totp_general'] = 'TOTP enabled/updated.';
        $totpEnabledUi = true;
    } elseif ($code === 'ok_regenerated') {
        $notices[] = 'TOTP disabled. Secret regenerated.';
        $inlineNotices['totp_secret'] = 'New secret generated and saved.';
        $inlineNotices['totp_general'] = 'TOTP disabled. Secret regenerated.';
        $totpEnabledUi = false;
    } elseif ($code === 'ok_disabled') {
        $notices[] = 'TOTP disabled.';
        $inlineNotices['totp_general'] = 'TOTP disabled.';
        $totpEnabledUi = false;
    }
}
if (isset($_GET['pass_status'])) {
    $code = (string) $_GET['pass_status'];
    if ($code === 'ok') {
        $notices[] = 'Admin password updated successfully.';
    } elseif ($code === 'bad_current') {
        $errors[] = 'Current password is invalid.';
        $inlineErrors['pass_current_password'] = 'Current password is invalid.';
    } elseif ($code === 'mismatch') {
        $errors[] = 'New password and confirmation do not match.';
        $inlineErrors['pass_new_password'] = 'Passwords do not match.';
        $inlineErrors['pass_confirm_password'] = 'Passwords do not match.';
    } elseif ($code === 'length') {
        $errors[] = 'New password length must be between 6 and 128 characters.';
        $inlineErrors['pass_new_password'] = 'Use at least 6 characters.';
    } elseif ($code === 'complexity') {
        $errors[] = 'New password must include at least one uppercase letter and one special character.';
        $inlineErrors['pass_new_password'] = 'Include at least one uppercase letter and one special character.';
    } elseif ($code === 'write_failed') {
        $errors[] = 'Failed to update password. Check site.config.php permissions.';
    }
}
if (isset($_GET['admin_error'])) {
    $code = (string) $_GET['admin_error'];
    if ($code === 'session_expired') {
        $errors[] = 'Session expired. Sign in again.';
    } elseif ($code === 'csrf') {
        $errors[] = 'Security token expired. Reload the page and try again.';
    }
}

if ($isPost) {
    $action = (string) ($_POST['action'] ?? '');
    $csrf = (string) ($_POST['csrf'] ?? '');
    if ($action === 'login') {
        if (irpg_admin_rate_limited($ip)) {
            header('Location: /admin/index.php?login_error=rate_limited', true, 303);
            exit;
        } else {
            $password = (string) ($_POST['password'] ?? '');
            $totpCode = (string) ($_POST['totp_code'] ?? '');
            if (!irpg_admin_login($password, $totpCode, $settings)) {
                irpg_admin_note_failed_attempt($ip);
                header('Location: /admin/index.php?login_error=invalid_credentials', true, 303);
                exit;
            } else {
                session_regenerate_id(true);
                irpg_admin_mark_authenticated($settings);
            }
        }
    } else {
        if (!irpg_admin_is_authenticated()) {
            header('Location: /admin/index.php?admin_error=session_expired', true, 303);
            exit;
        } elseif (!irpg_admin_check_csrf($csrf)) {
            header('Location: /admin/index.php?admin_error=csrf', true, 303);
            exit;
        } elseif ($action === 'change_password') {
            $currentPassword = (string) ($_POST['current_password'] ?? '');
            $newPassword = (string) ($_POST['new_password'] ?? '');
            $confirmPassword = (string) ($_POST['confirm_password'] ?? '');
            [$ok, $msg] = irpg_admin_rotate_password($currentPassword, $newPassword, $confirmPassword, $settings);
            if ($ok) {
                header('Location: /admin/index.php?pass_status=ok#password-settings', true, 303);
                exit;
            } else {
                if ($msg === 'Current password is invalid.') {
                    header('Location: /admin/index.php?pass_status=bad_current#password-settings', true, 303);
                } elseif ($msg === 'New password and confirmation do not match.') {
                    header('Location: /admin/index.php?pass_status=mismatch#password-settings', true, 303);
                } elseif ($msg === 'New password length must be between 6 and 128 characters.') {
                    header('Location: /admin/index.php?pass_status=length#password-settings', true, 303);
                } elseif ($msg === 'New password must include at least one uppercase letter and one special character.') {
                    header('Location: /admin/index.php?pass_status=complexity#password-settings', true, 303);
                } else {
                    header('Location: /admin/index.php?pass_status=write_failed#password-settings', true, 303);
                }
                exit;
            }
        } elseif ($action === 'set_totp') {
            $totpEnabled = !empty($_POST['totp_enabled']);
            $totpIssuer = (string) ($_POST['totp_issuer'] ?? '');
            $totpSecret = (string) ($_POST['totp_secret_base32'] ?? '');
            $regenerate = !empty($_POST['totp_regenerate']);
            if ($totpEnabled) {
                $regenerate = false;
            }
            $currentPassword = (string) ($_POST['current_password_for_totp'] ?? '');
            $totpActivationCode = (string) ($_POST['totp_activation_code'] ?? '');
            [$ok, $msg] = irpg_admin_update_totp_settings(
                $totpEnabled,
                $totpIssuer,
                $totpSecret,
                $regenerate,
                $currentPassword,
                $totpActivationCode,
                $settings
            );
            if ($ok) {
                if ($regenerate) {
                    header('Location: /admin/index.php?totp_status=ok_regenerated#totp-settings', true, 303);
                } elseif ($totpEnabled) {
                    header('Location: /admin/index.php?totp_status=ok_enabled#totp-settings', true, 303);
                } else {
                    header('Location: /admin/index.php?totp_status=ok_disabled#totp-settings', true, 303);
                }
                exit;
            } else {
                if ($msg === 'Current password is invalid.') {
                    header('Location: /admin/index.php?totp_status=bad_password#totp-settings', true, 303);
                } elseif ($msg === 'TOTP secret must be Base32 (A-Z2-7), length 16-128.') {
                    header('Location: /admin/index.php?totp_status=invalid_secret#totp-settings', true, 303);
                } elseif ($msg === 'TOTP verification code is invalid.') {
                    header('Location: /admin/index.php?totp_status=bad_token#totp-settings', true, 303);
                } elseif ($msg === 'Disable TOTP before regenerating the secret.') {
                    header('Location: /admin/index.php?totp_status=regen_requires_disable#totp-settings', true, 303);
                } else {
                    $errors[] = $msg;
                    $_SESSION['admin_flash_errors'] = $errors;
                    $_SESSION['admin_flash_notices'] = $notices;
                    header('Location: /admin/index.php?totp_status=write_failed#totp-settings', true, 303);
                }
                exit;
            }
        } elseif ($action === 'download_backup') {
            $pendingBackupDownload = true;
        } elseif ($action === 'logout') {
            irpg_admin_logout();
            header('Location: /admin/index.php?signed_out=1', true, 303);
            exit;
        }
    }
}

$isAuthed = irpg_admin_is_authenticated();
$bot = ['botOnline' => false, 'botLastSeenMs' => null];
$realm = null;
$dbPathForUi = '';
$dbHealth = 'unknown';
$dbStats = null;
$events = [];
$serverNowTs = time();
$serverClock = gmdate('Y-m-d H:i:s', $serverNowTs) . ' UTC';
$botLastSeenLabel = 'n/a';
$formatAgo = static function (int $deltaSec): string {
    if ($deltaSec < 60) {
        return $deltaSec . 's ago';
    }
    if ($deltaSec < 3600) {
        $m = (int) floor($deltaSec / 60);
        return $m . 'm ago';
    }
    if ($deltaSec < 86400) {
        $h = (int) floor($deltaSec / 3600);
        $m = (int) floor(($deltaSec % 3600) / 60);
        return $h . 'h ' . $m . 'm ago';
    }
    $d = (int) floor($deltaSec / 86400);
    $h = (int) floor(($deltaSec % 86400) / 3600);
    return $d . 'd ' . $h . 'h ago';
};
$totpUri = irpg_admin_totp_uri($settings);
$totpQrUrl = irpg_admin_totp_qr_url($totpUri);

if ($isAuthed) {
    try {
        $pdo = irpg_pdo();
        $bot = irpg_bot_presence($pdo);
        if ($bot['botLastSeenMs'] !== null) {
            $lastSeenMs = (int) $bot['botLastSeenMs'];
            if ($lastSeenMs > 0) {
                $lastSeenTs = (int) floor($lastSeenMs / 1000);
                $ago = $formatAgo(max(0, $serverNowTs - $lastSeenTs));
                $botLastSeenLabel = $ago . ' · ' . gmdate('Y-m-d H:i:s', $lastSeenTs) . ' UTC';
            }
        }
        $realm = irpg_realm_pulse($pdo);
        $dbStats = irpg_admin_db_health($pdo);
        $dbHealth = 'ok';
        if ($pendingBackupDownload) {
            $backup = irpg_admin_prepare_backup($pdo);
            if (!$backup['ok']) {
                $errors[] = (string) ($backup['error'] ?? 'Backup preparation failed.');
            } else {
                try {
                    irpg_admin_stream_backup_file((string) $backup['path']);
                    @unlink((string) $backup['path']);
                    exit;
                } catch (Throwable $e) {
                    @unlink((string) $backup['path']);
                    $errors[] = 'Backup streaming failed.';
                }
            }
        }
        $stmt = $pdo->prepare(
            "SELECT id, ts, kind, detail
             FROM realm_events
             WHERE kind LIKE 'admin_%' OR kind IN ('lucky_hour_admin')
             ORDER BY id DESC
             LIMIT 40"
        );
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $r) {
            $events[] = [
                'id' => (int) $r['id'],
                'ts' => (int) $r['ts'],
                'kind' => (string) $r['kind'],
                'detail' => (string) $r['detail'],
            ];
        }
    } catch (Throwable $e) {
        $dbHealth = 'error';
        $errors[] = 'Database access failed. Verify db path and permissions.';
    }
    global $dbPath;
    $dbPathForUi = (string) $dbPath;
}

if ($isPost) {
    $_SESSION['admin_flash_errors'] = $errors;
    $_SESSION['admin_flash_notices'] = $notices;
    header('Location: /admin/index.php', true, 303);
    exit;
}

$title = 'IdleRPG Admin Panel';
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <title><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></title>
  <link rel="stylesheet" href="/assets/admin.css?v=<?= rawurlencode($adminCssVer) ?>-toolsfix" />
</head>
<body>
  <div class="bg-glow bg-glow-a" aria-hidden="true"></div>
  <div class="bg-glow bg-glow-b" aria-hidden="true"></div>
  <main class="shell">
    <header class="top">
      <p class="eyebrow">IdleRPG Control Surface</p>
      <h1 class="brand-title"><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></h1>
      <p class="muted">Secure operations dashboard for diagnostics, auditing, and controlled maintenance actions.</p>
    </header>

    <?php foreach ($errors as $err): ?>
      <div class="flash flash-err"><?= htmlspecialchars($err, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endforeach; ?>
    <?php foreach ($notices as $note): ?>
      <div class="flash flash-ok"><?= htmlspecialchars($note, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endforeach; ?>

    <?php if (!$isAuthed): ?>
      <section class="login-layout">
        <article class="panel login-card">
          <h2>Sign in</h2>
          <p class="muted">Restricted entry point for authorized shard operators only.</p>
          <form method="post" action="/admin/index.php" autocomplete="off" class="admin-form">
            <input type="hidden" name="action" value="login" />
            <input type="hidden" name="csrf" value="<?= htmlspecialchars(irpg_admin_csrf_token(), ENT_QUOTES, 'UTF-8') ?>" />
            <label for="password">Admin password</label>
            <input id="password" name="password" type="password" required />
            <?php if ($inlineErrors['login_password'] !== ''): ?>
              <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['login_password'], ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>
            <?php if (!empty($settings['totp_enabled'])): ?>
              <label for="totp_code">Authenticator code (TOTP)</label>
              <input id="totp_code" name="totp_code" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required />
              <?php if ($inlineErrors['login_totp'] !== ''): ?>
                <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['login_totp'], ENT_QUOTES, 'UTF-8') ?></p>
              <?php endif; ?>
            <?php endif; ?>
            <button type="submit">Sign in</button>
          </form>
        </article>
      </section>
    <?php else: ?>
      <section class="panel actions top-actions">
        <div class="chip-row">
          <span class="chip">DB: <?= htmlspecialchars($dbHealth, ENT_QUOTES, 'UTF-8') ?></span>
          <span class="chip">Bot: <?= $bot['botOnline'] ? 'online' : 'offline' ?></span>
          <span class="chip">2FA: <?= $totpEnabledUi ? 'enabled' : 'disabled' ?></span>
        </div>
        <form method="post" action="/admin/index.php" class="admin-form inline-form">
          <input type="hidden" name="action" value="logout" />
          <input type="hidden" name="csrf" value="<?= htmlspecialchars(irpg_admin_csrf_token(), ENT_QUOTES, 'UTF-8') ?>" />
          <button type="submit" class="danger">Sign out</button>
        </form>
      </section>

      <section class="grid">
        <article class="panel stat-panel">
          <h2>Runtime health</h2>
          <ul class="kv-list">
            <li><strong>DB:</strong> <?= htmlspecialchars($dbHealth, ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>DB path:</strong> <code><?= htmlspecialchars($dbPathForUi, ENT_QUOTES, 'UTF-8') ?></code></li>
            <li><strong>Bot online:</strong> <?= $bot['botOnline'] ? 'yes' : 'no' ?></li>
            <li><strong>Bot last seen:</strong> <?= htmlspecialchars($botLastSeenLabel, ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>Server time (UTC):</strong> <?= htmlspecialchars($serverClock, ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>Client IP:</strong> <?= htmlspecialchars($ip, ENT_QUOTES, 'UTF-8') ?></li>
          </ul>
        </article>

        <article class="panel stat-panel">
          <h2>Realm snapshot</h2>
          <?php if ($realm === null): ?>
            <p class="muted">No realm snapshot is currently available.</p>
          <?php else: ?>
            <ul class="kv-list">
              <li><strong>Online heroes:</strong> <?= (int) $realm['onlineHeroes'] ?></li>
              <li><strong>Quest active:</strong> <?= !empty($realm['questActive']) ? 'yes' : 'no' ?></li>
              <li><strong>Season:</strong> <?= htmlspecialchars((string) ($realm['seasonLabel'] ?? 'n/a'), ENT_QUOTES, 'UTF-8') ?></li>
              <li><strong>World boss:</strong> <?= htmlspecialchars((string) ($realm['worldBoss'] ?? 'n/a'), ENT_QUOTES, 'UTF-8') ?></li>
            </ul>
            <p class="mono pulse"><?= htmlspecialchars((string) $realm['display'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
        </article>
      </section>

      <section class="panel maintenance-panel">
        <h2>Database health and maintenance</h2>
        <?php if ($dbStats === null): ?>
          <p class="muted">Database statistics are currently unavailable.</p>
        <?php else: ?>
          <ul class="kv-list">
            <li><strong>Integrity check:</strong> <?= $dbStats['integrityOk'] ? 'ok' : htmlspecialchars($dbStats['integrityMessage'], ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>Main DB size:</strong> <?= htmlspecialchars(irpg_admin_format_bytes((int) $dbStats['dbSizeBytes']), ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>WAL size:</strong> <?= htmlspecialchars(irpg_admin_format_bytes((int) $dbStats['walSizeBytes']), ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>SHM size:</strong> <?= htmlspecialchars(irpg_admin_format_bytes((int) $dbStats['shmSizeBytes']), ENT_QUOTES, 'UTF-8') ?></li>
            <li><strong>Page size:</strong> <?= (int) $dbStats['pageSize'] ?> bytes</li>
            <li><strong>Page count:</strong> <?= (int) $dbStats['pageCount'] ?></li>
            <li><strong>Free pages:</strong> <?= (int) $dbStats['freelistCount'] ?> (<?= number_format((float) $dbStats['freePct'], 2) ?>%)</li>
          </ul>
          <p class="mono pulse"><?= htmlspecialchars((string) $dbStats['recommendation'], ENT_QUOTES, 'UTF-8') ?></p>
          <form method="post" action="/admin/index.php" class="admin-form inline-form cta-row download-form" target="_blank">
            <input type="hidden" name="action" value="download_backup" />
            <input type="hidden" name="csrf" value="<?= htmlspecialchars(irpg_admin_csrf_token(), ENT_QUOTES, 'UTF-8') ?>" />
            <button type="submit">Download DB backup</button>
          </form>
          <p class="muted">Backup is generated as a point-in-time snapshot (`VACUUM INTO` when available) and streamed as a `.db` file.</p>
        <?php endif; ?>
      </section>

      <section class="panel audit-panel">
        <h2>Admin audit trail</h2>
        <p class="muted">Most recent administrative events from `realm_events`.</p>
        <?php if (count($events) === 0): ?>
          <p class="muted">No administrative events recorded yet.</p>
        <?php else: ?>
          <div class="table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>When (UTC)</th>
                  <th>Kind</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                <?php foreach ($events as $ev): ?>
                  <tr>
                    <td><?= (int) $ev['id'] ?></td>
                    <td><?= htmlspecialchars(gmdate('Y-m-d H:i:s', (int) $ev['ts']), ENT_QUOTES, 'UTF-8') ?></td>
                    <td><code><?= htmlspecialchars((string) $ev['kind'], ENT_QUOTES, 'UTF-8') ?></code></td>
                    <td><?= htmlspecialchars((string) $ev['detail'], ENT_QUOTES, 'UTF-8') ?></td>
                  </tr>
                <?php endforeach; ?>
              </tbody>
            </table>
          </div>
        <?php endif; ?>
      </section>

      <section class="grid tools-grid">
      <section class="panel">
        <h2>Operational notes</h2>
        <ul class="kv-list">
          <li>Use IRC `ADMIN RESTART` for controlled bot recycle when watchdog or supervisor is active.</li>
          <li>Use IRC `ADMIN SHUTDOWN` for planned maintenance stop.</li>
          <li>Keep this panel behind a private network and a strict IP allowlist in addition to password authentication.</li>
          <li>2FA TOTP is <?= $totpEnabledUi ? 'enabled' : 'disabled' ?>.</li>
        </ul>
      </section>

      <section class="panel tool-panel" id="totp-settings">
        <h2>TOTP settings</h2>
        <p class="muted">Manage TOTP state, issuer, and secret (current password required).</p>
        <?php if ($totpUri !== null && $totpQrUrl !== null): ?>
          <div class="totp-qr-wrap">
            <img class="totp-qr" src="<?= htmlspecialchars($totpQrUrl, ENT_QUOTES, 'UTF-8') ?>" alt="TOTP QR code for authenticator app setup" loading="lazy" />
            <div class="totp-qr-meta">
              <p class="muted">Scan using Google Authenticator, Authy, or 1Password.</p>
              <p class="muted">Provisioning URI (manual fallback):</p>
              <div class="totp-uri-box mono" title="<?= htmlspecialchars($totpUri, ENT_QUOTES, 'UTF-8') ?>">
                <?= htmlspecialchars($totpUri, ENT_QUOTES, 'UTF-8') ?>
              </div>
              <div class="copy-row">
                <button type="button" class="copy-btn" data-copy-value="<?= htmlspecialchars((string) ($settings['totp_secret_base32'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">Copy secret</button>
                <button type="button" class="copy-btn" data-copy-value="<?= htmlspecialchars($totpUri, ENT_QUOTES, 'UTF-8') ?>">Copy URI</button>
              </div>
            </div>
          </div>
        <?php endif; ?>
        <form method="post" action="/admin/index.php" autocomplete="off" class="admin-form totp-form">
          <input type="hidden" name="action" value="set_totp" />
          <input type="hidden" name="csrf" value="<?= htmlspecialchars(irpg_admin_csrf_token(), ENT_QUOTES, 'UTF-8') ?>" />
          <label>
            <input id="totp_enabled_toggle" type="checkbox" name="totp_enabled" value="1" <?= $totpEnabledUi ? 'checked' : '' ?> />
            Enable/disable TOTP second factor
          </label>
          <label for="totp_issuer_cfg">TOTP issuer</label>
          <input id="totp_issuer_cfg" name="totp_issuer" type="text" maxlength="80" value="<?= htmlspecialchars((string) ($settings['totp_issuer'] ?? 'IdleRPG Admin'), ENT_QUOTES, 'UTF-8') ?>" />
          <label for="totp_secret_base32_cfg">TOTP secret (Base32 A-Z2-7)</label>
          <input id="totp_secret_base32_cfg" name="totp_secret_base32" type="text" maxlength="128" value="<?= htmlspecialchars((string) ($settings['totp_secret_base32'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" />
          <?php if ($inlineNotices['totp_secret'] !== ''): ?>
            <p class="field-msg field-msg-ok"><?= htmlspecialchars($inlineNotices['totp_secret'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <?php if ($inlineErrors['totp_secret'] !== ''): ?>
            <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['totp_secret'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <label>
            <input id="totp_regenerate_toggle" type="checkbox" name="totp_regenerate" value="1" />
            Regenerate secret automatically
          </label>
          <p class="muted">Secret regeneration is available only while TOTP is disabled. Step order: disable TOTP, enable regeneration, then save.</p>
          <label for="current_password_for_totp">Current password (confirm change)</label>
          <input id="current_password_for_totp" name="current_password_for_totp" type="password" required />
          <?php if ($inlineErrors['totp_current_password'] !== ''): ?>
            <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['totp_current_password'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <label for="totp_activation_code">Verification code (required when enabling or disabling)</label>
          <input id="totp_activation_code" name="totp_activation_code" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" />
          <?php if ($inlineErrors['totp_activation_code'] !== ''): ?>
            <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['totp_activation_code'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <?php if ($inlineNotices['totp_general'] !== ''): ?>
            <p class="field-msg field-msg-ok"><?= htmlspecialchars($inlineNotices['totp_general'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <button type="submit">Save TOTP settings</button>
        </form>
      </section>

      <section class="panel tool-panel" id="password-settings">
        <h2>Rotate admin password</h2>
        <p class="muted">Applies immediately by writing a new password hash to `site.config.php`.</p>
        <form method="post" action="/admin/index.php" autocomplete="off" class="admin-form">
          <input type="hidden" name="action" value="change_password" />
          <input type="hidden" name="csrf" value="<?= htmlspecialchars(irpg_admin_csrf_token(), ENT_QUOTES, 'UTF-8') ?>" />
          <label for="current_password">Current password</label>
          <input id="current_password" name="current_password" type="password" required />
          <?php if ($inlineErrors['pass_current_password'] !== ''): ?>
            <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['pass_current_password'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <label for="new_password">New password (min 6, include uppercase and special character)</label>
          <input id="new_password" name="new_password" type="password" minlength="6" maxlength="128" required />
          <?php if ($inlineErrors['pass_new_password'] !== ''): ?>
            <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['pass_new_password'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <label for="confirm_password">Confirm new password</label>
          <input id="confirm_password" name="confirm_password" type="password" minlength="6" maxlength="128" required />
          <?php if ($inlineErrors['pass_confirm_password'] !== ''): ?>
            <p class="field-msg field-msg-err"><?= htmlspecialchars($inlineErrors['pass_confirm_password'], ENT_QUOTES, 'UTF-8') ?></p>
          <?php endif; ?>
          <button type="submit">Update password</button>
        </form>
      </section>
      </section>
    <?php endif; ?>
  </main>
  <script src="/assets/admin.js?v=<?= rawurlencode($adminJsVer) ?>" defer></script>
</body>
</html>
