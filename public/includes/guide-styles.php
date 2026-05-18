<?php
declare(strict_types=1);

/** Stylesheets for public guide pages (iframe + standalone). */

function guide_asset_href(string $relative): string
{
    $rel = ltrim(str_replace('\\', '/', $relative), '/');
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $base = str_replace('\\', '/', dirname(is_string($script) ? $script : ''));
    if ($base === '/' || $base === '.' || $base === '') {
        return $rel;
    }
    return rtrim($base, '/') . '/' . $rel;
}

function guide_stylesheet_links(): void
{
    $cssDir = dirname(__DIR__) . '/assets';
    $appCss = $cssDir . '/app.css';
    $guideCss = $cssDir . '/guide.css';
    $appV = is_file($appCss) ? (string) filemtime($appCss) : '0';
    $appHref = htmlspecialchars(guide_asset_href('assets/app.css?v=' . $appV), ENT_QUOTES, 'UTF-8');
    echo '<link rel="stylesheet" href="' . $appHref . '" />' . "\n";
    if (is_file($guideCss)) {
        $guideV = (string) filemtime($guideCss);
        $guideHref = htmlspecialchars(guide_asset_href('assets/guide.css?v=' . $guideV), ENT_QUOTES, 'UTF-8');
        echo '  <link rel="stylesheet" href="' . $guideHref . '" />' . "\n";
    }
}
