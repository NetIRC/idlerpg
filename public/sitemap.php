<?php
declare(strict_types=1);

/** XML sitemap for the public IdleRPG web surface and SEO landings. */

$publicBase = '';
$envPublic = getenv('IRPG_PUBLIC_URL');
if (is_string($envPublic) && trim($envPublic) !== '') {
    $publicBase = rtrim(trim($envPublic), '/');
} else {
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (is_string($host) && $host !== '') {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
        $publicBase = ($https ? 'https' : 'http') . '://' . $host;
    }
}
if ($publicBase === '') {
    $publicBase = 'https://idlerpg.netirc.eu';
}

$pages = [
    '/' => ['file' => __DIR__ . '/index.php', 'changefreq' => 'hourly', 'priority' => '1.0'],
    '/how-to-play.php' => ['file' => __DIR__ . '/how-to-play.php', 'changefreq' => 'weekly', 'priority' => '0.8'],
    '/commands.php' => ['file' => __DIR__ . '/commands.php', 'changefreq' => 'weekly', 'priority' => '0.8'],
    '/faq.php' => ['file' => __DIR__ . '/faq.php', 'changefreq' => 'weekly', 'priority' => '0.8'],
];
header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');
header('X-Robots-Tag: noindex');
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<?php foreach ($pages as $path => $meta): ?>
<?php
    $loc = $publicBase . $path;
    $lastMod = gmdate('Y-m-d');
    $f = $meta['file'];
if (is_file($f)) {
    $mtime = filemtime($f);
    if (is_int($mtime) && $mtime > 0) {
        $lastMod = gmdate('Y-m-d', $mtime);
    }
}
?>
  <url>
    <loc><?= htmlspecialchars($loc, ENT_QUOTES, 'UTF-8') ?></loc>
    <lastmod><?= htmlspecialchars($lastMod, ENT_QUOTES, 'UTF-8') ?></lastmod>
    <changefreq><?= htmlspecialchars((string) $meta['changefreq'], ENT_QUOTES, 'UTF-8') ?></changefreq>
    <priority><?= htmlspecialchars((string) $meta['priority'], ENT_QUOTES, 'UTF-8') ?></priority>
  </url>
<?php endforeach; ?>
</urlset>
