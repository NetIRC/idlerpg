<?php
declare(strict_types=1);

/** Shared SEO head tags for public guide landing pages. */

function guide_public_base(): string
{
    $envPublic = getenv('IRPG_PUBLIC_URL');
    if (is_string($envPublic) && trim($envPublic) !== '') {
        return rtrim(trim($envPublic), '/');
    }
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (!is_string($host) || $host === '') {
        return '';
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
    return ($https ? 'https' : 'http') . '://' . $host;
}

function guide_og_image_url(string $publicBase): string
{
    if ($publicBase === '') {
        return '';
    }
    $assetsDir = dirname(__DIR__) . '/assets';
    foreach (['realm-atlas-top.png', 'realm-atlas-bg.png'] as $file) {
        $path = $assetsDir . '/' . $file;
        if (!is_file($path)) {
            continue;
        }
        return $publicBase . '/assets/' . $file . '?v=' . rawurlencode((string) filemtime($path));
    }
    return $publicBase . '/favicon.svg';
}

/**
 * @param array<string, mixed>|list<mixed> $jsonLd
 */
function guide_render_head(string $title, string $description, string $path, string $ogType, array $jsonLd): void
{
    $publicBase = guide_public_base();
    $canonical = $publicBase !== '' ? $publicBase . $path : '';
    $ogImage = guide_og_image_url($publicBase);
    $titleEsc = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $descEsc = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');
    $ogTypeEsc = htmlspecialchars($ogType, ENT_QUOTES, 'UTF-8');

    echo "  <title>{$titleEsc}</title>\n";
    echo "  <meta name=\"description\" content=\"{$descEsc}\" />\n";
    echo "  <meta name=\"robots\" content=\"index,follow,max-image-preview:large\" />\n";
    if ($canonical !== '') {
        $canEsc = htmlspecialchars($canonical, ENT_QUOTES, 'UTF-8');
        echo "  <link rel=\"canonical\" href=\"{$canEsc}\" />\n";
        echo "  <link rel=\"alternate\" hreflang=\"en\" href=\"{$canEsc}\" />\n";
        echo "  <link rel=\"alternate\" hreflang=\"x-default\" href=\"{$canEsc}\" />\n";
    }
    echo "  <meta property=\"og:type\" content=\"{$ogTypeEsc}\" />\n";
    echo "  <meta property=\"og:site_name\" content=\"IdleRPG Live Realm\" />\n";
    echo "  <meta property=\"og:title\" content=\"{$titleEsc}\" />\n";
    echo "  <meta property=\"og:description\" content=\"{$descEsc}\" />\n";
    echo "  <meta property=\"og:locale\" content=\"en_US\" />\n";
    if ($canonical !== '') {
        echo '  <meta property="og:url" content="' . htmlspecialchars($canonical, ENT_QUOTES, 'UTF-8') . "\" />\n";
    }
    if ($ogImage !== '') {
        echo '  <meta property="og:image" content="' . htmlspecialchars($ogImage, ENT_QUOTES, 'UTF-8') . "\" />\n";
        echo "  <meta property=\"og:image:alt\" content=\"IdleRPG realm atlas and guides\" />\n";
    }
    echo "  <meta name=\"twitter:card\" content=\"summary_large_image\" />\n";
    echo "  <meta name=\"twitter:title\" content=\"{$titleEsc}\" />\n";
    echo "  <meta name=\"twitter:description\" content=\"{$descEsc}\" />\n";
    if ($ogImage !== '') {
        echo '  <meta name="twitter:image" content="' . htmlspecialchars($ogImage, ENT_QUOTES, 'UTF-8') . "\" />\n";
    }
    $json = json_encode($jsonLd, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    echo '  <script type="application/ld+json">' . $json . "</script>\n";
}
