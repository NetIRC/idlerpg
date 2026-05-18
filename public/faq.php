<?php
declare(strict_types=1);

/** SEO landing: FAQ for IdleRPG gameplay, sessions, penalties, and realm systems. */

require_once __DIR__ . '/includes/guide-init.php';
guide_init();

$title = 'IdleRPG FAQ | Sessions, Penalties, Quests, Boss, and Seasons';
$description = 'IdleRPG FAQ: answers about register/login, PART vs QUIT vs LOGOUT, idle leveling, channel penalties, quests, world boss, season ladder, and session behavior on IRC.';

$faqEntities = guide_faq_entities();
$jsonLd = [
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
  <?php guide_render_head($title, $description, '/faq.php', 'article', $jsonLd); ?>
  <meta name="theme-color" content="#05040a" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="IdleRPG" />
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="favicon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <?php guide_stylesheet_links(); ?>
</head>
<body>
  <main class="inner" style="padding-top:2rem;padding-bottom:2rem;max-width:58rem;">
    <h1 class="h2" style="font-size:1.4rem;">IdleRPG FAQ</h1>
    <p class="guide-lead">Common gameplay questions from new and returning players on NetIRC. For every command and argument, open the <a href="/commands.php">command reference</a>.</p>

    <?php
    $guideCfg = guide_runtime_config();
    foreach ($faqEntities as $item):
    ?>
      <section style="margin-bottom:1.25rem;">
        <h2 class="h2" style="font-size:1.02rem;"><?= htmlspecialchars($item['q'], ENT_QUOTES, 'UTF-8') ?></h2>
        <p><?= htmlspecialchars($item['a'], ENT_QUOTES, 'UTF-8') ?></p>
      </section>
    <?php endforeach; ?>

    <h2 class="h2" style="font-size:1.02rem;">Quick command reminders</h2>
    <ul class="rules-list">
      <li><span class="mono">!time</span> — countdown to next level (base timer <?= htmlspecialchars(guide_format_duration((int) $guideCfg['rpbase']), ENT_QUOTES, 'UTF-8') ?> at L0).</li>
      <li><span class="mono">!whoami</span> — who you are logged in as and cooldowns.</li>
      <li><span class="mono">!quest</span> / <span class="mono">!boss</span> / <span class="mono">!season</span> — live event status when enabled.</li>
      <li><span class="mono">LOGIN</span> / <span class="mono">LOGOUT</span> — private message only; not channel commands.</li>
    </ul>

    <?php guide_render_shard_tuning($guideCfg); ?>

    <p class="guide-footer-links"><a href="/how-to-play.php">How to Play</a> · <a href="/commands.php">Full command list</a></p>
  </main>
  <script src="assets/pwa.js" defer></script>
</body>
</html>
