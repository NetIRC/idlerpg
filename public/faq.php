<?php
declare(strict_types=1);

/** SEO landing: FAQ for IdleRPG gameplay, sessions, penalties, and realm systems. */

$title = 'IdleRPG FAQ | Sessions, Penalties, Quests, Boss, and Seasons';
$description = 'IdleRPG FAQ: answers about register/login, idle leveling, channel penalties, quests, world boss, season ladder, and session behavior on IRC.';

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
$canonical = $publicBase !== '' ? $publicBase . '/faq.php' : '';

$faqEntities = [
    ['q' => 'How do I start playing IdleRPG?', 'a' => 'Join the game channel, then private message the bot with REGISTER <name> <password> <class...>.'],
    ['q' => 'Why am I not leveling up?', 'a' => 'Your nick must be visible in the game channel and your session must be logged in.'],
    ['q' => 'Do chat messages slow me down?', 'a' => 'Normal channel chat adds timer penalty. Recognized command lines are exempt.'],
    ['q' => 'What happens if I leave the channel?', 'a' => 'PART or QUIT suspends your session; rejoin the game channel to resume. Only LOGOUT closes it immediately.'],
    ['q' => 'How do quests and world boss work?', 'a' => 'They run automatically when enabled. Use !quest and !boss to see live status and outcomes.'],
];
$faqJson = [
    '@context' => 'https://schema.org',
    '@type' => 'FAQPage',
    'mainEntity' => array_map(
        static fn(array $row): array => [
            '@type' => 'Question',
            'name' => $row['q'],
            'acceptedAnswer' => ['@type' => 'Answer', 'text' => $row['a']],
        ],
        $faqEntities
    ),
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
  <script type="application/ld+json"><?= json_encode($faqJson, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) ?></script>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="assets/app.css?v=<?= is_file(__DIR__ . '/assets/app.css') ? (string) filemtime(__DIR__ . '/assets/app.css') : '0' ?>" />
</head>
<body>
  <main class="inner" style="padding-top:2rem;padding-bottom:2rem;max-width:58rem;">
    <h1 class="h2" style="font-size:1.4rem;">IdleRPG FAQ</h1>
    <p>Common gameplay questions from new and returning players on NetIRC.</p>

    <?php foreach ($faqEntities as $item): ?>
      <section style="margin-bottom:1.25rem;">
        <h2 class="h2" style="font-size:1.02rem;"><?= htmlspecialchars($item['q'], ENT_QUOTES, 'UTF-8') ?></h2>
        <p><?= htmlspecialchars($item['a'], ENT_QUOTES, 'UTF-8') ?></p>
      </section>
    <?php endforeach; ?>

    <p class="mono muted-strong">Need command details? <a href="/commands.php" style="color:inherit;">Open command reference</a>.</p>
  </main>
  <script src="assets/pwa.js" defer></script>
</body>
</html>
