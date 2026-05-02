<?php
declare(strict_types=1);
$appCssPath = __DIR__ . '/assets/app.css';
$appCssVer = is_file($appCssPath) ? (string) filemtime($appCssPath) : '0';
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>IdleRPG &mdash; Live realm</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Orbitron:wght@700;900&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="assets/app.css?v=<?= $appCssVer ?>" />
</head>
<body>
  <div id="app" class="shell">
    <div class="bg-gradient" aria-hidden="true"></div>
    <div class="noise" aria-hidden="true"></div>
    <div class="orb orb-1" aria-hidden="true"></div>
    <div class="orb orb-2" aria-hidden="true"></div>

    <div class="status-bar inner">
      <span class="status-led" id="bot-status-led" aria-hidden="true"></span>
      <span class="status-text mono">SQLite stream</span>
      <span class="status-divider"></span>
      <span class="status-text mono muted-strong">HTTP API: leaderboard &amp; chronicle</span>
      <span class="status-divider"></span>
      <span class="status-text mono status-bot-line" id="bot-status-text">IRC bot: …</span>
    </div>

    <div id="bot-offline-banner" class="bot-offline-banner hidden" role="alert" aria-live="assertive">
      <div class="bot-offline-banner-inner inner">
        <span class="bot-offline-banner-glyph" aria-hidden="true">!</span>
        <div class="bot-offline-banner-copy">
          <strong class="bot-offline-banner-title">IRC bot is offline</strong>
          <p class="bot-offline-banner-detail mono" id="bot-offline-banner-detail"></p>
        </div>
      </div>
    </div>

    <header class="header">
      <div class="inner header-grid">
        <div class="hero">
          <p class="eyebrow"><span class="eyebrow-accent"></span> Live leaderboard</p>
          <h1 class="title-block">
            <span class="title-word title-idle">Idle</span><span class="title-word title-rpg">RPG</span>
          </h1>
          <p class="tagline mono">Stay silent &middot; climb levels &middot; own the timer</p>
          <p class="lead lead-wow">
            <span class="lead-punch">Silence is the only currency that compounds.</span>
            This realm-board updates in real time: who out-idles the room, which class they wear,
            how many heartbeats separate them from the next level&mdash;and who is online while the channel holds its breath.
          </p>
          <p class="lead-sub mono">
            The leaderboard and stat sheet read from the same live ledger the IRC bot keeps&mdash;no extra app server required for this page.
          </p>
        </div>
        <aside class="header-rules panel section-rise" aria-label="Game rules">
          <p class="rules-eyebrow mono">NetIRC &middot; in-channel play</p>
          <h2 class="rules-title">Rules</h2>
          <ul class="rules-list">
            <li><strong>Stay idle</strong> in the game channel to shrink your level timer. Silence levels you up.</li>
            <li><strong>Talking in the channel</strong> adds a time penalty (length matters). Lines starting with <span class="rules-cmd">!</span> (see below) are free.</li>
            <li><strong>In-channel (no penalty):</strong> <span class="rules-cmd">!help</span> &middot; <span class="rules-cmd">!cmds</span> (extra) &middot; <span class="rules-cmd">!rules</span> &middot; <span class="rules-cmd">!top</span> &middot; <span class="rules-cmd">!ping</span> &middot; <span class="rules-cmd">!stats</span> [name] &middot; <span class="rules-cmd">!time</span> [name] &middot; <span class="rules-cmd">!whoami</span> &middot; <span class="rules-cmd">!records</span> &middot; <span class="rules-cmd">!quest</span> &middot; <span class="rules-cmd">!chronicle</span> &middot; <span class="rules-cmd">!omen</span> &middot; <span class="rules-cmd">!duel</span> <span class="mono muted-strong">&lt;irc_nick&gt;</span>.</li>
            <li><strong>Private message</strong> the bot (from IRC) while <strong>your nick is in the game channel</strong>: <span class="rules-cmd mono">REGISTER Name Password Class…</span> &mdash; password one word; class can be several words. <span class="rules-cmd mono">LOGIN Name Password</span> to return. Also: <span class="rules-cmd mono">LOGOUT</span>, <span class="rules-cmd mono">STATS</span>, <span class="rules-cmd mono">TOP</span>, <span class="rules-cmd mono">HELP</span>, <span class="rules-cmd mono">CMDS</span>, etc.</li>
          </ul>
        </aside>
      </div>
    </header>

    <main class="inner">
      <div class="main-grid">
      <section class="section-rise">
        <div class="section-head section-head-row">
          <div>
            <h2 class="h2"><span class="h2-mark" aria-hidden="true"></span> Leaderboard</h2>
            <p id="lb-meta" class="lb-meta mono" aria-live="polite">
              <span id="last-updated" class="lb-meta-updated">—</span>
              <span class="lb-meta-divider">&middot;</span>
              <span class="lb-meta-refresh">Next sync in <span id="refresh-countdown" class="refresh-countdown">30</span>s</span>
            </p>
          </div>
          <input type="search" id="q" class="search" placeholder="Filter by name or class..." autocomplete="off" />
        </div>
        <p id="err" class="alert hidden" role="alert"></p>
        <div class="panel panel-table table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Lv</th>
                <th class="hide-sm">Class</th>
                <th>Timer</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
      </section>
      <aside class="section-rise">
        <div class="section-head">
          <h2 class="h2"><span class="h2-mark h2-mark-ember" aria-hidden="true"></span> Hero sheet</h2>
        </div>
        <div class="panel panel-detail detail" id="detail">
          <p class="muted">Select a row to open the stat sheet.</p>
        </div>
      </aside>
      </div>

      <section class="section-rise chronicle-section" aria-label="Realm chronicle">
        <div class="section-head section-head-row chronicle-head">
          <div>
            <h2 class="h2"><span class="h2-mark h2-mark-ember chronicle-h2-mark" aria-hidden="true"></span> Realm chronicle</h2>
            <p class="lb-meta mono chronicle-sub">Duels, quests, omens, HoG — same SQLite stream as IRC <span class="rules-cmd">!chronicle</span></p>
          </div>
        </div>
        <div class="panel chronicle-panel" id="chronicle-root">
          <p class="muted" id="chronicle-placeholder">Pulling realm_events…</p>
          <ul class="chronicle-list hidden" id="chronicle-list"></ul>
        </div>
      </section>
    </main>

    <footer class="footer inner">
      <p class="footer-credit mono">
        By <strong>TheDavid</strong> &middot; NetIRC IRC NetWork
        <span class="footer-irc">&middot; IRC <strong>irc.netirc.eu:6667</strong> <strong>#IdleRPG</strong></span>
      </p>
    </footer>
  </div>
  <script src="assets/app.js" defer></script>
</body>
</html>
