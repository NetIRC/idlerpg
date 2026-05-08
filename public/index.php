<?php
declare(strict_types=1);

/** Public web dashboard shell for leaderboard, hero detail, atlas, and chronicle. */
$appCssPath = __DIR__ . '/assets/app.css';
$appCssVer = is_file($appCssPath) ? (string) filemtime($appCssPath) : '0';
$atlasTopPath = __DIR__ . '/assets/realm-atlas-top.png';
$atlasBgPath = __DIR__ . '/assets/realm-atlas-bg.png';
$atlasMapUsesZenith = is_file($atlasTopPath);
$atlasMapFsPath = $atlasMapUsesZenith ? $atlasTopPath : $atlasBgPath;
$atlasMapImgHref = 'assets/' . ($atlasMapUsesZenith ? 'realm-atlas-top.png' : 'realm-atlas-bg.png');
if (is_file($atlasMapFsPath)) {
    $atlasMapImgHref .= '?v=' . rawurlencode((string) filemtime($atlasMapFsPath));
}
/** Must match CHRONICLE_API_DEFAULT_LIMIT in src/game/chronicle-omen.ts */
$irpgChronicleUiLimit = 15;

$seoTitle = 'IdleRPG — Live IRC idle game leaderboard & realm map | NetIRC';
$seoDescription = 'Live IdleRPG leaderboard linked to the IRC bot: idle timers, levels, classes, medals, charms, realm atlas, and realm chronicle. '
    . 'Silence levels you up in channel — play on NetIRC with the same SQLite ledger this page reads.';

$publicBase = '';
$envPublic = getenv('IRPG_PUBLIC_URL');
if (is_string($envPublic) && $envPublic !== '') {
    $publicBase = rtrim(trim($envPublic), '/');
} else {
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($host !== '') {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
        $publicBase = ($https ? 'https' : 'http') . '://' . $host;
    }
}
$requestPath = '/';
if (!empty($_SERVER['REQUEST_URI'])) {
    $path = parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (is_string($path) && $path !== '') {
        $requestPath = $path;
    }
}
$canonicalUrl = $publicBase !== '' ? $publicBase . $requestPath : '';
$ogMapAsset = 'assets/' . ($atlasMapUsesZenith ? 'realm-atlas-top.png' : 'realm-atlas-bg.png');
$ogImageUrl = '';
if ($publicBase !== '' && is_file($atlasMapFsPath)) {
    $ogImageUrl = $publicBase . '/' . $ogMapAsset . '?v=' . rawurlencode((string) filemtime($atlasMapFsPath));
}
if ($ogImageUrl === '' && $publicBase !== '') {
    $ogImageUrl = $publicBase . '/favicon.svg';
}

$webSiteLd = [
    '@type' => 'WebSite',
    'name' => 'IdleRPG Live Realm',
    'description' => $seoDescription,
    'inLanguage' => 'en',
];
if ($canonicalUrl !== '') {
    $webSiteLd['url'] = $canonicalUrl;
}
$jsonLd = [
    '@context' => 'https://schema.org',
    '@graph' => [
        $webSiteLd,
        [
            '@type' => 'VideoGame',
            'name' => 'IdleRPG',
            'gamePlatform' => 'IRC',
            'applicationCategory' => 'Game',
            'description' => $seoDescription,
        ],
    ],
];
$jsonLdScript = json_encode($jsonLd, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title><?= htmlspecialchars($seoTitle, ENT_QUOTES, 'UTF-8') ?></title>
  <meta name="description" content="<?= htmlspecialchars($seoDescription, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta name="theme-color" content="#05040a" />
  <meta name="author" content="NetIRC IdleRPG" />
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <?php if ($canonicalUrl !== ''): ?>
  <link rel="canonical" href="<?= htmlspecialchars($canonicalUrl, ENT_QUOTES, 'UTF-8') ?>" />
  <?php endif; ?>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="<?= htmlspecialchars($seoTitle, ENT_QUOTES, 'UTF-8') ?>" />
  <meta property="og:description" content="<?= htmlspecialchars($seoDescription, ENT_QUOTES, 'UTF-8') ?>" />
  <meta property="og:locale" content="en_US" />
  <?php if ($canonicalUrl !== ''): ?>
  <meta property="og:url" content="<?= htmlspecialchars($canonicalUrl, ENT_QUOTES, 'UTF-8') ?>" />
  <?php endif; ?>
  <?php if ($ogImageUrl !== ''): ?>
  <meta property="og:image" content="<?= htmlspecialchars($ogImageUrl, ENT_QUOTES, 'UTF-8') ?>" />
  <?php endif; ?>
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="<?= htmlspecialchars($seoTitle, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="twitter:description" content="<?= htmlspecialchars($seoDescription, ENT_QUOTES, 'UTF-8') ?>" />
  <?php if ($ogImageUrl !== ''): ?>
  <meta name="twitter:image" content="<?= htmlspecialchars($ogImageUrl, ENT_QUOTES, 'UTF-8') ?>" />
  <?php endif; ?>
  <script type="application/ld+json"><?= $jsonLdScript ?></script>
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

    <div class="realm-pulse-bar inner" aria-label="Realm pulse">
      <p class="realm-pulse mono" id="realm-pulse">Syncing realm pulse…</p>
    </div>
    <div class="realm-pulse-bar inner" aria-label="Season and world boss">
      <p class="realm-pulse mono"><span id="season-banner">Season status unavailable</span> · <span id="world-boss-banner">World Boss scouting</span></p>
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
            This realm-board updates in real time: who out-idles the room, which class they carry,
            how many heartbeats remain until the next level, and exactly who is online while the channel holds its breath.
            One shared ledger drives both IRC gameplay and this web surface, so every rank shift and timer swing is visible without delay.
          </p>
          <p class="lead-sub mono">
            The leaderboard and stat sheet read from the same live ledger the IRC bot keeps&mdash;no extra app server required for this page.
          </p>
          <p class="lead-sub mono">
            Live shard intelligence: seasonal ladder pressure, world-boss windows, chronicle trails, and guild momentum&mdash;all in one operational view.
          </p>
        </div>
        <aside class="header-rules panel section-rise" aria-label="Game rules">
          <p class="rules-eyebrow mono">NetIRC &middot; in-channel play</p>
          <h2 class="rules-title">Rules</h2>
          <ul class="rules-list">
            <li><strong>Stay idle</strong> in the game channel to shrink your level timer. Silence levels you up.</li>
            <li><strong>Talking in the channel</strong> adds a time penalty (length matters). Lines starting with <span class="rules-cmd">!</span> (see below) are free.</li>
            <li><strong>In-channel (no penalty):</strong> <span class="rules-cmd">!help</span> &middot; <span class="rules-cmd">!cmds</span> (extra) &middot; <span class="rules-cmd">!rules</span> &middot; <span class="rules-cmd">!top</span> &middot; <span class="rules-cmd">!ping</span> &middot; <span class="rules-cmd">!stats</span> [name] &middot; <span class="rules-cmd">!time</span> [name] &middot; <span class="rules-cmd">!whoami</span> &middot; <span class="rules-cmd">!records</span> &middot; <span class="rules-cmd">!quest</span> &middot; <span class="rules-cmd">!bounty</span> &middot; <span class="rules-cmd">!season</span> &middot; <span class="rules-cmd">!boss</span> &middot; <span class="rules-cmd">!guild</span> &middot; <span class="rules-cmd">!relic</span> &middot; <span class="rules-cmd">!prestige</span> &middot; <span class="rules-cmd">!realm</span> &middot; <span class="rules-cmd">!chronicle</span> &middot; <span class="rules-cmd">!lore</span> <span class="mono muted-strong">(if enabled)</span> &middot; <span class="rules-cmd">!omen</span> &middot; <span class="rules-cmd">!duel</span> <span class="mono muted-strong">&lt;irc_nick&gt;</span> &middot; <span class="rules-cmd">!gauntlet</span> &middot; <span class="rules-cmd">!medals</span> [name].</li>
            <li><strong>Daily trial (V3)</strong> runs automatically for eligible online heroes and can reduce or increase the level timer. Status appears in <span class="rules-cmd">!realm</span>.</li>
            <li><strong>Bounty board (V3)</strong> tracks daily idle progress and grants a one-time timer reward when the contract is completed. Check status with <span class="rules-cmd">!bounty</span>.</li>
            <li><strong>Season Pass (V3)</strong> grants seasonal XP while idling and stores monthly seasonal tiers separately from base progression (<span class="rules-cmd">!season</span>).</li>
            <li><strong>World Boss (V3)</strong> spawns on cadence; all online idlers contribute passive damage and share reward on kill (<span class="rules-cmd">!boss</span>).</li>
            <li><strong>Guild / Relic / Prestige (V3)</strong> add social buffs and soft meta-progression: <span class="rules-cmd">!guild</span>, <span class="rules-cmd">!relic</span>, <span class="rules-cmd">!prestige</span>.</li>
            <li><strong>Idle streak (V3)</strong> grants small periodic timer reductions while you remain online and silent in the game channel; any channel activity (including <span class="rules-cmd">!</span> commands), penalties, or combat outcomes reset streak progress.</li>
            <li><strong>Private message</strong> the bot (from IRC) while <strong>your nick is in the game channel</strong>: <span class="rules-cmd mono">REGISTER Name Password Class…</span> &mdash; password one word; class can be several words. <span class="rules-cmd mono">LOGIN Name Password</span> to return. Also: <span class="rules-cmd mono">LOGOUT</span>, <span class="rules-cmd mono">STATS</span>, <span class="rules-cmd mono">TOP</span>, <span class="rules-cmd mono">HELP</span>, <span class="rules-cmd mono">CMDS</span>, etc.</li>
          </ul>
        </aside>
      </div>
    </header>

    <main class="inner">
      <div class="main-grid">
      <header class="main-grid-header-lb">
        <div class="section-head section-head-row">
          <div>
            <h2 class="h2"><span class="h2-mark" aria-hidden="true"></span> Leaderboard</h2>
            <p id="lb-meta" class="lb-meta mono" aria-live="polite">
              <span id="last-updated" class="lb-meta-updated">—</span>
            </p>
          </div>
          <input type="search" id="q" class="search" placeholder="Filter by name or class..." autocomplete="off" />
        </div>
      </header>
      <section class="section-rise main-grid-body-lb">
        <p id="err" class="alert hidden" role="alert"></p>
        <div class="panel panel-table table-wrap" id="lb-table-panel">
          <table class="table">
            <thead>
              <tr>
                <th scope="col" title="Rank">#</th>
                <th scope="col">Player</th>
                <th scope="col" title="Level">L</th>
                <th scope="col" class="hide-sm">Class</th>
                <th scope="col" title="Time to next level">Timer</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
          <div id="lb-ledger-loading" class="ledger-sync-overlay" aria-hidden="false">
            <div class="detail-loading-inner">
              <div class="detail-spinner" role="status" aria-label="Loading leaderboard"></div>
              <p class="detail-loading-text mono">Syncing ledger…</p>
            </div>
          </div>
        </div>
      </section>
      <header class="main-grid-header-hero">
        <div class="section-head">
          <h2 class="h2"><span class="h2-mark h2-mark-ember" aria-hidden="true"></span> Hero sheet</h2>
        </div>
      </header>
      <aside class="section-rise main-grid-body-hero">
        <div class="panel panel-detail detail" id="detail">
          <div class="detail-content" id="detail-content">
            <div class="detail-empty">
              <div class="detail-empty-frame" aria-hidden="true">
                <span class="detail-empty-glyph"></span>
              </div>
              <p class="detail-empty-eyebrow mono">Live ledger</p>
              <h3 class="detail-empty-title">Summon a hero</h3>
              <p class="detail-empty-lead">
                Choose a name on the leaderboard &mdash; this panel fills with level, timer, alignment,
                <strong>medals</strong>, <strong>charm</strong>, and your personal <strong>ledger strip</strong>.
              </p>
              <p class="detail-empty-hint mono">Click a row &middot; silence compounds</p>
            </div>
          </div>
          <div id="detail-loading" class="detail-loading-overlay hidden" aria-hidden="true">
            <div class="detail-loading-inner">
              <div class="detail-spinner" role="status" aria-label="Loading hero"></div>
              <p class="detail-loading-text mono">Syncing hero…</p>
            </div>
          </div>
        </div>
      </aside>
      </div>

      <section class="section-rise realm-atlas-section" id="realm-atlas" aria-label="Interactive realm map">
        <div class="section-head section-head-row atlas-section-head">
          <div>
            <h2 class="h2"><span class="h2-mark h2-mark-ember" aria-hidden="true"></span> Realm atlas</h2>
            <p class="lb-meta mono atlas-sub">
              The realm forgets noise but remembers altitude: <strong>silence lifts you toward the pole</strong>, where the oldest idlers loom like constellations.
              Drift the parchment with the pointer; <strong>linger on a name</strong> and the ledger whispers back. <strong>Cyan halos</strong> mark who still breathes in-channel.
            </p>
          </div>
        </div>
        <div class="panel realm-atlas-panel" id="realm-atlas-root">
          <div class="atlas-svg-frame" id="atlas-svg-frame">
            <svg
              id="realm-atlas-svg"
              class="realm-atlas-svg"
              viewBox="0 0 1000 600"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="Realm map of heroes: north is higher level, south is lower level"
            >
              <defs id="atlas-defs"></defs>
              <g id="atlas-world">
                <g id="atlas-scenery">
                  <image
                    id="atlas-map-photo"
                    class="<?= $atlasMapUsesZenith ? 'atlas-map-photo atlas-map-photo--zenith' : 'atlas-map-photo' ?>"
                    href="<?= htmlspecialchars($atlasMapImgHref, ENT_QUOTES, 'UTF-8') ?>"
                    x="-397"
                    y="-367"
                    width="1794"
                    height="1334"
                    preserveAspectRatio="xMidYMax slice"
                    pointer-events="none"
                  />
                  <g class="realm-atlas-stars" aria-hidden="true">
                    <circle class="atlas-star" cx="118" cy="48" r="2.6" />
                    <circle class="atlas-star" cx="247" cy="112" r="2.1" />
                    <circle class="atlas-star" cx="412" cy="36" r="2.9" />
                    <circle class="atlas-star" cx="588" cy="78" r="2.2" />
                    <circle class="atlas-star" cx="721" cy="42" r="2.5" />
                    <circle class="atlas-star" cx="862" cy="118" r="2" />
                    <circle class="atlas-star" cx="94" cy="198" r="2.4" />
                    <circle class="atlas-star" cx="318" cy="256" r="2.2" />
                    <circle class="atlas-star" cx="501" cy="168" r="3" />
                    <circle class="atlas-star" cx="668" cy="228" r="1.9" />
                    <circle class="atlas-star" cx="928" cy="268" r="2.5" />
                    <circle class="atlas-star" cx="156" cy="348" r="2.2" />
                    <circle class="atlas-star" cx="834" cy="382" r="2.4" />
                    <circle class="atlas-star" cx="455" cy="428" r="1.8" />
                    <circle class="atlas-star" cx="602" cy="486" r="2.3" />
                  </g>
                  <g id="atlas-routes" aria-hidden="true"></g>
                  <g id="atlas-regions"></g>
                  <g id="atlas-quest-layer"></g>
                </g>
                <g id="atlas-legend" class="realm-atlas-legend" aria-hidden="true">
                  <text x="500" y="20" class="atlas-legend-ns" text-anchor="middle">N · higher level</text>
                  <text x="500" y="596" class="atlas-legend-ns" text-anchor="middle">S · lower level</text>
                </g>
                <g id="atlas-markers"></g>
              </g>
            </svg>
            <div class="atlas-fx" aria-hidden="true">
              <span class="atlas-fx-aurora"></span>
              <span class="atlas-fx-shimmer"></span>
              <span class="atlas-fx-vignette"></span>
            </div>
          </div>
          <div id="atlas-ledger-loading" class="ledger-sync-overlay" aria-hidden="false">
            <div class="detail-loading-inner">
              <div class="detail-spinner" role="status" aria-label="Loading realm map"></div>
              <p class="detail-loading-text mono">Syncing map…</p>
            </div>
          </div>
          <div id="atlas-tooltip" class="atlas-tooltip hidden" role="tooltip" hidden></div>
        </div>
      </section>

      <section class="section-rise treasures-section" aria-label="Treasures and omen">
        <div class="section-head section-head-row treasures-head">
          <div>
            <h2 class="h2"><span class="h2-mark h2-mark-omen" aria-hidden="true"></span> Treasures &amp; omen</h2>
            <p class="lb-meta mono treasures-sub">
              <strong>Medals</strong> are permanent badges (quest crests, duel streaks, gauntlet, level milestones).
              <strong>Charm</strong> is a rare trinket on your hero: tiny idle boost while equipped.
              <strong>Omen</strong> is the IRC command <span class="rules-cmd">!omen</span> (or <span class="rules-cmd mono">OMEN</span> in PM)&mdash;read below.
            </p>
          </div>
        </div>
        <div class="panel treasures-panel">
          <div class="treasures-grid">
            <div class="treasure-card treasure-card--omen">
              <h3 class="treasure-h3">Quick command guide</h3>
              <div class="treasure-guide" aria-label="Gameplay quick command guide">
                <details class="treasure-rule" open>
                  <summary>How <span class="mono">!omen</span> works</summary>
                  <ul class="treasure-list">
                    <li>Requires a logged-in hero currently in the game channel.</li>
                    <li><strong>Cooldown:</strong> 8 hours per hero.</li>
                    <li><strong class="omen-odds omen-odds--fluff">~55%</strong> mood text only (no timer change).</li>
                    <li><strong class="omen-odds omen-odds--boon">~23%</strong> small timer gain (shorter wait).</li>
                    <li><strong class="omen-odds omen-odds--curse">~15%</strong> small timer loss (longer wait).</li>
                    <li><strong class="omen-odds omen-odds--rare">~7%</strong> rare chronicle event line.</li>
                  </ul>
                </details>
                <details class="treasure-rule">
                  <summary>How <span class="mono">!boss</span> works</summary>
                  <p>World Boss starts on cadence. Logged-in heroes online in channel contribute passive damage while idling. On slay, reward is shared as timer reduction.</p>
                </details>
                <details class="treasure-rule">
                  <summary>How <span class="mono">!season</span> works</summary>
                  <p>Season XP is earned while idling. Monthly season ladder resets tiers and rewards, while base hero progression remains intact.</p>
                </details>
                <details class="treasure-rule">
                  <summary>How <span class="mono">!guild</span> / <span class="mono">!relic</span> / <span class="mono">!prestige</span> work</summary>
                  <p>Guild gives light social bonuses, relic grants one active perk, and prestige unlocks soft permanent scaling at higher levels.</p>
                </details>
              </div>
              <p class="treasure-foot mono muted-strong">Major actions also write chronicle lines so the shard can audit results live.</p>
            </div>
            <div class="treasure-card treasure-card--finds">
              <h3 class="treasure-h3">Realm finds on this site</h3>
              <p class="treasure-p">
                Open a hero on the leaderboard: the side panel shows <strong>medal vault</strong> (tiered chips), <strong>charm</strong> if any, and a
                <strong>recent chronicle</strong> strip of ledger lines for that character (omens, medals, gauntlet, etc.).
              </p>
              <p class="treasure-p mono muted-strong">Every player&rsquo;s story compounds in the scroll &mdash; check the chronicle for live drops.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section-rise chronicle-section" aria-label="Realm chronicle">
        <div class="section-head section-head-row chronicle-head">
          <div>
            <h2 class="h2"><span class="h2-mark h2-mark-ember chronicle-h2-mark" aria-hidden="true"></span> Realm chronicle</h2>
            <p class="lb-meta mono chronicle-sub">Live feed from the bot&rsquo;s ledger &mdash; last <?= (int) $irpgChronicleUiLimit ?> lines. In IRC, <span class="rules-cmd">!chronicle</span> is a shorter one-liner.</p>
          </div>
        </div>
        <div class="panel chronicle-panel" id="chronicle-root" data-chronicle-limit="<?= (int) $irpgChronicleUiLimit ?>">
          <div class="chronicle-filters">
            <select id="chronicle-kind-filter" class="search">
              <option value="">All kinds</option>
              <option value="quest_start">Quest start</option>
              <option value="quest_end">Quest end</option>
              <option value="quest_win">Quest win</option>
              <option value="quest_lose">Quest lose</option>
              <option value="duel_win">Duel win</option>
              <option value="duel_lose">Duel lose</option>
              <option value="world_boss_start">World boss</option>
              <option value="world_boss_slay">World boss slain</option>
              <option value="world_boss_reward">World boss reward</option>
              <option value="prestige">Prestige</option>
              <option value="bounty_claim">Bounty</option>
            </select>
            <input id="chronicle-search" class="search" type="search" placeholder="Search player/event..." />
            <input id="chronicle-since" class="search" type="datetime-local" />
            <input id="chronicle-until" class="search" type="datetime-local" />
            <button id="chronicle-apply" class="search" type="button">Apply filters</button>
          </div>
          <p class="muted" id="chronicle-placeholder">Pulling realm_events…</p>
          <div id="chronicle-collapsible" class="chronicle-collapsible hidden">
            <button
              type="button"
              class="chronicle-strip-toggle finds-strip-toggle"
              aria-expanded="false"
              aria-controls="chronicle-list-wrap"
            >
              <span class="finds-chevron" aria-hidden="true"></span>
              <span class="finds-strip-label">Ledger feed <span class="finds-strip-scope">(last <?= (int) $irpgChronicleUiLimit ?>)</span></span>
              <span class="finds-count mono" id="chronicle-count">0</span>
            </button>
            <div class="finds-list-wrap chronicle-list-outer" id="chronicle-list-wrap" hidden>
              <ul class="chronicle-list" id="chronicle-list"></ul>
            </div>
          </div>
        </div>
      </section>

      <section class="section-rise treasures-section" aria-label="Guild standings">
        <div class="section-head section-head-row treasures-head">
          <div>
            <h2 class="h2"><span class="h2-mark h2-mark-omen" aria-hidden="true"></span> Guild standings</h2>
            <p class="lb-meta mono treasures-sub">Top guilds by member count (live from the same shard ledger).</p>
          </div>
        </div>
        <div class="panel treasures-panel">
          <ul id="guild-preview" class="rules-list"><li class="muted">Loading guilds…</li></ul>
        </div>
      </section>

      <section class="section-rise treasures-section" aria-label="Season standings">
        <div class="section-head section-head-row treasures-head">
          <div>
            <h2 class="h2"><span class="h2-mark h2-mark-omen" aria-hidden="true"></span> Season standings</h2>
            <p id="season-preview-meta" class="lb-meta mono treasures-sub">Top heroes by current season XP and tier progress.</p>
          </div>
        </div>
        <div class="panel treasures-panel">
          <div class="finds-strip">
            <button
              type="button"
              id="season-preview-toggle"
              class="finds-strip-toggle hidden"
              aria-expanded="false"
              aria-controls="season-preview-wrap"
            >
              <span class="finds-chevron" aria-hidden="true"></span>
              <span class="finds-strip-label">Season ladder <span class="finds-strip-scope">(top 3 / expand all)</span></span>
              <span class="finds-count mono" id="season-preview-count">0</span>
            </button>
            <div id="season-preview-wrap" class="finds-list-wrap">
              <ul id="season-preview" class="rules-list"><li class="muted">Loading season ladder…</li></ul>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer inner">
      <p class="footer-title mono">&copy; <?= date('Y') ?> IdleRPG &middot; NetIRC IRC NetWork</p>
      <p class="footer-meta mono">
        Operated by <strong>TheDavid</strong> &middot; IRC <strong>irc.netirc.eu:6667</strong> &middot; <strong>#IdleRPG</strong>
      </p>
    </footer>
  </div>
  <button id="refresh-fab" class="refresh-fab mono" type="button" aria-label="Refresh leaderboard now">
    <span class="refresh-fab-prefix">Next sync in</span><span id="refresh-fab-count" class="refresh-countdown">60</span><span>s</span>
  </button>
  <script src="assets/app.js" defer></script>
</body>
</html>
