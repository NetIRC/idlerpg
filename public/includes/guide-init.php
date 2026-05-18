<?php
declare(strict_types=1);

/** Bootstrap for public guide pages (how-to-play, commands, FAQ) — safe on public_html-only deploys. */

function guide_fail(string $message): void
{
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/html; charset=utf-8');
    }
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />';
    echo '<title>Guide unavailable</title>';
    echo '<style>body{font-family:system-ui,sans-serif;background:#0c0a14;color:#e3daf0;padding:2rem;line-height:1.5}</style></head><body>';
    echo '<h1>Guide unavailable</h1><p>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</p>';
    echo '<p><a href="/" style="color:#00e5c7">Back to IdleRPG</a></p></body></html>';
    exit;
}

function guide_init(): void
{
    $includesDir = __DIR__;
    foreach (['guide-env.php', 'guide-data.php', 'guide-styles.php', 'guide-seo.php'] as $file) {
        if (!is_file($includesDir . '/' . $file)) {
            guide_fail(
                'Guide files are incomplete on the server. Upload includes/guide-env.php, guide-data.php, guide-styles.php, and guide-seo.php into public_html/includes/.',
            );
        }
    }
    require_once $includesDir . '/guide-env.php';
    require_once $includesDir . '/guide-data.php';
    require_once $includesDir . '/guide-styles.php';
    require_once $includesDir . '/guide-seo.php';
}
