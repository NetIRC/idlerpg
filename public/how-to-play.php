<?php
declare(strict_types=1);

/** SEO landing: how to play IdleRPG on IRC with practical onboarding steps. */

$title = 'How to Play IdleRPG on IRC | NetIRC Beginner Guide';
$description = 'Learn how to start playing IdleRPG on IRC: register, login, stay in channel, avoid penalties, and use core commands to level efficiently.';

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
$canonical = $publicBase !== '' ? $publicBase . '/how-to-play.php' : '';

$jsonLd = [
    '@context' => 'https://schema.org',
    '@type' => 'HowTo',
    'name' => 'How to play IdleRPG on IRC',
    'description' => $description,
    'step' => [
        ['@type' => 'HowToStep', 'name' => 'Join the game channel', 'text' => 'Connect to NetIRC and join #IdleRPG.'],
        ['@type' => 'HowToStep', 'name' => 'Register your character', 'text' => 'Private message the bot: REGISTER <name> <password> <class...>.'],
        ['@type' => 'HowToStep', 'name' => 'Login in later sessions', 'text' => 'Private message the bot: LOGIN <name> <password>.'],
        ['@type' => 'HowToStep', 'name' => 'Stay idle to level', 'text' => 'Keep your nick visible in channel; idle time advances your level timer.'],
        ['@type' => 'HowToStep', 'name' => 'Use commands wisely', 'text' => 'Use !time, !stats, !quest, !season, and !boss for live status without chat penalty.'],
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
  <meta name="twitter:title" content="<?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="twitter:description" content="<?= htmlspecialchars($description, ENT_QUOTES, 'UTF-8') ?>" />
  <script type="application/ld+json"><?= json_encode($jsonLd, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) ?></script>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="assets/app.css?v=<?= is_file(__DIR__ . '/assets/app.css') ? (string) filemtime(__DIR__ . '/assets/app.css') : '0' ?>" />
</head>
<body>
  <main class="inner" style="padding-top:2rem;padding-bottom:2rem;max-width:56rem;">
    <h1 class="h2" style="font-size:1.4rem;">How to Play IdleRPG on IRC</h1>
    <p>IdleRPG rewards silence. The less you talk in channel, the faster your timer reaches the next level. This quick guide helps new players start correctly and avoid common mistakes.</p>

    <h2 class="h2" style="font-size:1.05rem;">1) Connect and join the game channel</h2>
    <p>Join the NetIRC network and enter <strong>#IdleRPG</strong>. Your nick must stay visible in the game channel for idle progress to count.</p>

    <h2 class="h2" style="font-size:1.05rem;">2) Register your hero once</h2>
    <p>Private message the bot:</p>
    <p class="mono">REGISTER &lt;CharacterName&gt; &lt;password&gt; &lt;class...&gt;</p>
    <p>Password must be one word. Class can contain spaces.</p>

    <h2 class="h2" style="font-size:1.05rem;">3) Login when you return</h2>
    <p>Private message the bot:</p>
    <p class="mono">LOGIN &lt;CharacterName&gt; &lt;password&gt;</p>
    <p>If you leave IRC, your session may close. When in doubt, use <span class="mono">!whoami</span> or PM <span class="mono">WHOAMI</span>.</p>

    <h2 class="h2" style="font-size:1.05rem;">4) Level efficiently</h2>
    <ul>
      <li>Stay idle in channel as much as possible.</li>
      <li>Normal channel chat adds timer penalty.</li>
      <li>Use status commands to plan your next action.</li>
    </ul>

    <h2 class="h2" style="font-size:1.05rem;">5) Track live systems</h2>
    <p>Use <span class="mono">!quest</span>, <span class="mono">!season</span>, <span class="mono">!boss</span>, and <span class="mono">!chronicle</span> to follow ongoing realm events.</p>

    <p class="mono muted-strong">Also read: <a href="/commands.php" style="color:inherit;">IdleRPG Commands</a> · <a href="/faq.php" style="color:inherit;">IdleRPG FAQ</a></p>
  </main>
  <script src="assets/pwa.js" defer></script>
</body>
</html>
