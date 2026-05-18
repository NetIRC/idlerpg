<?php
declare(strict_types=1);

/** SEO landing: how to play IdleRPG on IRC with practical onboarding steps. */

require_once __DIR__ . '/includes/guide-init.php';
guide_init();

$title = 'How to Play IdleRPG on IRC | NetIRC Beginner Guide';
$description = 'Learn how to start playing IdleRPG on IRC: register, login, stay in channel, avoid penalties, session rules, and core commands to level efficiently.';

$jsonLd = [
    '@context' => 'https://schema.org',
    '@type' => 'HowTo',
    'name' => 'How to play IdleRPG on IRC',
    'description' => $description,
    'step' => [
        ['@type' => 'HowToStep', 'name' => 'Join the game channel', 'text' => 'Connect to NetIRC and join #IdleRPG.'],
        ['@type' => 'HowToStep', 'name' => 'Register your character', 'text' => 'Private message the bot: REGISTER <name> <password> <class...>.'],
        ['@type' => 'HowToStep', 'name' => 'Login in later sessions', 'text' => 'Private message the bot: LOGIN <name> <password> after LOGOUT or session close.'],
        ['@type' => 'HowToStep', 'name' => 'Stay idle to level', 'text' => 'Keep your nick visible in channel; idle time advances your level timer.'],
        ['@type' => 'HowToStep', 'name' => 'Use commands wisely', 'text' => 'Use !time, !stats, !whoami and other recognized !commands without chat penalty.'],
    ],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <?php guide_render_head($title, $description, '/how-to-play.php', 'article', $jsonLd); ?>
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
  <main class="inner" style="padding-top:2rem;padding-bottom:2rem;max-width:56rem;">
    <h1 class="h2" style="font-size:1.4rem;">How to Play IdleRPG on IRC</h1>
    <p class="guide-lead">IdleRPG rewards silence. The less you talk in channel, the faster your level timer reaches the next level. Stay in <strong>#IdleRPG</strong> on NetIRC while logged in.</p>

    <?php $guideCfg = guide_runtime_config(); ?>
    <h2 class="h2" style="font-size:1.05rem;">1) Connect and join the game channel</h2>
    <p>Your nick must stay visible in <strong><?= htmlspecialchars((string) $guideCfg['ircChannel'], ENT_QUOTES, 'UTF-8') ?></strong> (<span class="mono"><?= htmlspecialchars((string) $guideCfg['ircHost'], ENT_QUOTES, 'UTF-8') ?>:<?= (int) $guideCfg['ircPort'] ?></span>). Idle progress stops if you leave the channel, log out, or the bot is offline.</p>

    <h2 class="h2" style="font-size:1.05rem;">2) Register your hero once</h2>
    <p>Private message the bot:</p>
    <p class="mono">REGISTER &lt;CharacterName&gt; &lt;password&gt; &lt;class...&gt;</p>
    <p>Password must be one word. Class can contain spaces. You must be in the game channel when you register.</p>

    <h2 class="h2" style="font-size:1.05rem;">3) Login when your session was closed</h2>
    <p>Private message the bot:</p>
    <p class="mono">LOGIN &lt;CharacterName&gt; &lt;password&gt;</p>
    <p class="guide-note"><strong>PART</strong> (leave channel) and <strong>QUIT</strong> (disconnect IRC) only <em>suspend</em> your session — rejoin the channel and you resume automatically. Use <strong>LOGIN</strong> again only after <strong>LOGOUT</strong> in PM, kick, admin reset, or expired netsplit grace. Check status with <span class="mono">!whoami</span>.</p>

    <h2 class="h2" style="font-size:1.05rem;">4) Level efficiently</h2>
    <ul class="rules-list">
      <li>Stay idle in channel as much as possible.</li>
      <li>Normal channel chat adds level-timer penalty.</li>
      <li>Recognized <span class="mono">!commands</span> (see below) do not add that speech penalty.</li>
      <li>Unrecognized <span class="mono">!something</span> lines count as normal chat.</li>
    </ul>

    <h2 class="h2" style="font-size:1.05rem;">5) Essential commands</h2>
    <?php
    $essentials = array_filter(
        guide_channel_commands(),
        static fn(array $r): bool => in_array(
            $r['cmd'],
            ['!help', '!cmds', '!rules', '!whoami', '!time', '!stats', '!quest', '!bounty', '!season', '!boss', '!realm', '!chronicle'],
            true,
        ),
    );
    guide_render_command_table(array_values($essentials));
    ?>

    <h2 class="h2" style="font-size:1.05rem;">6) Optional actions &amp; V3 systems</h2>
    <p>Use <span class="mono">!omen</span>, <span class="mono">!duel &lt;nick&gt;</span>, and <span class="mono">!gauntlet</span> for cooldown-based actions. Guilds, relics, bounty, season, boss, and prestige use <span class="mono">!guild</span>, <span class="mono">!relic</span>, etc.</p>

    <?php guide_render_shard_tuning($guideCfg); ?>

    <p class="guide-footer-links">Full reference: <a href="/commands.php">IdleRPG Commands</a> · <a href="/faq.php">FAQ</a></p>
  </main>
  <script src="assets/pwa.js" defer></script>
</body>
</html>
