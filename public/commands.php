<?php
declare(strict_types=1);

/** SEO landing: command reference for public and private IdleRPG bot commands. */

$title = 'IdleRPG Commands List (IRC) | Public and PM Commands';
$description = 'Complete IdleRPG command reference for IRC: public !commands and private bot commands for register, login, progression, quest, season, and boss.';

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
$canonical = $publicBase !== '' ? $publicBase . '/commands.php' : '';

$jsonLd = [
    '@context' => 'https://schema.org',
    '@type' => 'ItemList',
    'name' => 'IdleRPG Commands',
    'itemListElement' => [
        ['@type' => 'ListItem', 'position' => 1, 'name' => '!help, !cmds, !rules'],
        ['@type' => 'ListItem', 'position' => 2, 'name' => '!time, !stats, !whoami'],
        ['@type' => 'ListItem', 'position' => 3, 'name' => '!quest, !season, !boss'],
        ['@type' => 'ListItem', 'position' => 4, 'name' => 'REGISTER, LOGIN, LOGOUT (PM)'],
    ],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></title>
  <meta name="description" content="<?= htmlspecialchars($description, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="theme-color" content="#05040a" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="IdleRPG" />
  <?php if ($canonical !== ''): ?>
  <link rel="canonical" href="<?= htmlspecialchars($canonical, ENT_QUOTES, 'UTF-8') ?>" />
  <?php endif; ?>
  <meta property="og:type" content="article" />
  <meta property="og:title" content="<?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?>" />
  <meta property="og:description" content="<?= htmlspecialchars($description, ENT_QUOTES, 'UTF-8') ?>" />
  <?php if ($canonical !== ''): ?>
  <meta property="og:url" content="<?= htmlspecialchars($canonical, ENT_QUOTES, 'UTF-8') ?>" />
  <?php endif; ?>
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json"><?= json_encode($jsonLd, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) ?></script>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="assets/app.css?v=<?= is_file(__DIR__ . '/assets/app.css') ? (string) filemtime(__DIR__ . '/assets/app.css') : '0' ?>" />
</head>
<body>
  <main class="inner" style="padding-top:2rem;padding-bottom:2rem;max-width:62rem;">
    <h1 class="h2" style="font-size:1.4rem;">IdleRPG Commands (IRC)</h1>
    <p>This page lists the core commands players use most often. For full live behavior, always treat the in-bot help as source of truth.</p>

    <h2 class="h2" style="font-size:1.05rem;">Public channel commands</h2>
    <p class="mono">!help !cmds !rules !ping !time !whoami !stats !records !quest !bounty !season !boss !guild !relic !prestige !realm !chronicle !omen !duel !gauntlet !medals !top !lore</p>
    <p>These command messages are recognized and do not apply normal chat penalty.</p>

    <h2 class="h2" style="font-size:1.05rem;">Private message commands</h2>
    <p class="mono">REGISTER &lt;name&gt; &lt;password&gt; &lt;class...&gt;</p>
    <p class="mono">LOGIN &lt;name&gt; &lt;password&gt;</p>
    <p class="mono">LOGOUT · HELP · CMDS · WHOAMI · STATS · TIME · QUEST · DUEL · GAUNTLET</p>

    <h2 class="h2" style="font-size:1.05rem;">Admin-only (private)</h2>
    <p class="mono">ADMIN HELP · FORCELOGOUT · RESETPASS · STARTQUEST · LUCKY · SAY · SHUTDOWN</p>

    <h2 class="h2" style="font-size:1.05rem;">Most useful progression commands</h2>
    <ul>
      <li><span class="mono">!time</span> - next level timer.</li>
      <li><span class="mono">!stats</span> - class, level, timers, extras.</li>
      <li><span class="mono">!quest</span> - active quest status.</li>
      <li><span class="mono">!season</span> - season progress and time left.</li>
      <li><span class="mono">!boss</span> - world boss status.</li>
    </ul>

    <p class="mono muted-strong">Also read: <a href="/how-to-play.php" style="color:inherit;">How to Play</a> · <a href="/faq.php" style="color:inherit;">FAQ</a></p>
  </main>
  <script src="assets/pwa.js" defer></script>
</body>
</html>
