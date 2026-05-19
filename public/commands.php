<?php
declare(strict_types=1);

/** SEO landing: command reference for public and private IdleRPG bot commands. */

require_once __DIR__ . '/includes/guide-init.php';
guide_init();

$title = 'IdleRPG Commands List (IRC) | Public and PM Commands';
$description = 'Complete IdleRPG command reference for IRC: public !commands and private bot commands with explanations for register, login, progression, quest, season, boss, and V3 systems.';

$jsonLd = [
    '@context' => 'https://schema.org',
    '@type' => 'ItemList',
    'name' => 'IdleRPG Commands',
    'description' => $description,
    'itemListElement' => [
        ['@type' => 'ListItem', 'position' => 1, 'name' => 'Channel commands (!help, !time, !stats, …)'],
        ['@type' => 'ListItem', 'position' => 2, 'name' => 'PM commands (REGISTER, LOGIN, LOGOUT, …)'],
        ['@type' => 'ListItem', 'position' => 3, 'name' => 'Admin PM commands'],
    ],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <?php guide_render_head($title, $description, '/commands.php', 'article', $jsonLd); ?>
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
  <main class="inner guide-page" style="padding-top:2rem;padding-bottom:2rem;max-width:62rem;">
    <h1 class="h2" style="font-size:1.4rem;">IdleRPG Commands (IRC)</h1>
    <p class="guide-lead">Use commands in <strong>#IdleRPG</strong> on NetIRC. Channel syntax is <span class="mono">!command</span>; account commands are sent by <strong>private message</strong> to the bot without <span class="mono">!</span>.</p>

    <p class="guide-note">Recognized public <span class="mono">!commands</span> do not add normal chat penalty. Unknown <span class="mono">!something</span> lines are treated as regular speech. Commands are case-insensitive on the token (<span class="mono">!TIME</span> = <span class="mono">!time</span>).</p>

    <h2 class="h2" style="font-size:1.05rem;">Public channel commands</h2>
    <?php guide_render_command_table(guide_channel_commands()); ?>

    <h2 class="h2" style="font-size:1.05rem;">Private message commands</h2>
    <p class="guide-note">Send these to the bot in PM while your nick is visible in the game channel (required for REGISTER and LOGIN).</p>
    <?php guide_render_command_table(guide_pm_commands()); ?>

    <h2 class="h2" style="font-size:1.05rem;">Admin-only (private message)</h2>
    <p class="guide-note">Authorized admin IRC nicks or admin-flagged characters only. By default you must also be in the game channel.</p>
    <?php
    $adminRows = [];
    foreach (guide_admin_commands() as $a) {
        $adminRows[] = ['cmd' => $a['cmd'], 'args' => $a['args'], 'desc' => $a['desc']];
    }
    guide_render_command_table($adminRows);
    ?>

    <?php guide_render_shard_tuning(guide_runtime_config()); ?>

    <h2 class="h2" style="font-size:1.05rem;">Session quick reference</h2>
    <ul class="rules-list">
      <li><strong>PART</strong> or <strong>QUIT IRC</strong> — session suspended; rejoin channel to resume (no LOGIN).</li>
      <li><strong>LOGOUT</strong> (PM) — session closed; LOGIN required.</li>
      <li><strong>KICK</strong> — session closed; rejoin and LOGIN.</li>
    </ul>

    <p class="guide-footer-links">Also read: <a href="/how-to-play.php">How to Play</a> · <a href="/faq.php">FAQ</a></p>
  </main>
  <script src="assets/pwa.js" defer></script>
</body>
</html>
