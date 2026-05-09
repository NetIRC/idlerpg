# idlerpg

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PHP](https://img.shields.io/badge/PHP-%3E%3D8.0-777BB4?logo=php&logoColor=white)](https://www.php.net/)

**IdleRPG-style IRC game:** a **Node.js** bot runs timers, penalties, and quests in your channel and persists state to **SQLite**. A **PHP** dashboard under `public/` reads the same database for a live leaderboard and player API—**no Node runtime on the web server**.

|  |  |
|--|--|
| **Live demo** | [idlerpg.netirc.eu](https://idlerpg.netirc.eu) |
| **Concept** | [IdleRPG](http://idlerpg.net) · implementations this work echoes: [falsovsky/idlerpg](https://github.com/falsovsky/idlerpg), [idlerpg-site-ng](https://github.com/falsovsky/idlerpg-site-ng) |

**Further reading:** [DEPLOY.md](DEPLOY.md) (hosting, SQLite permissions, troubleshooting) · [SECURITY.md](SECURITY.md) · [LICENSE](LICENSE)

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [IRC reference](#irc-reference)
  - [Game rules](#game-rules)
  - [Channel commands](#channel-commands-)
  - [Private messages (PM)](#private-messages-to-the-bot)
  - [Staff (ADMIN)](#staff-admin-over-pm)
- [Optional components](#optional-components)
- [License](#license)

---

## Architecture

| Layer | Responsibility |
|--------|----------------|
| **IRC bot** (`src/`) | Normal client connection (not server / P10). Registration, login, idle ticks, channel penalties, optional quests, lucky hour, Hand of God, alignment, charms, season pass, world boss, guild/relic/prestige systems. |
| **Web UI** (`public/`) | `index.php` leaderboard, hero detail pane (created date + today timer trend), realm chronicle, guild standings (with creation dates), season standings, rules, bot online/offline banner. [`public/.htaccess`](public/.htaccess): HTTPS (non-local), security headers. |
| **HTTP API** | Read-only JSON: [`/api/health.php`](public/api/health.php), [`/api/leaderboard.php`](public/api/leaderboard.php), [`/api/player.php`](public/api/player.php) (`?name=…`), [`/api/chronicle.php`](public/api/chronicle.php) (`limit`, `kind`, `search`, `since`, `until`). |
| **Data** | Single SQLite file (e.g. `data/idlerpg.db`). The bot and `site.config.php` must use the **same** path. |

---

## Prerequisites

| Component | Version / notes |
|-----------|-----------------|
| **Runtime (bot)** | Node.js **20+**, npm |
| **Runtime (site)** | PHP **8+** with **PDO** and **pdo_sqlite** |
| **HTTP server** | Apache: `DocumentRoot` → `public/`, `AllowOverride` for `.htaccess`. Or Nginx with equivalent TLS and routing. |

---

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/NetIRC/idlerpg.git
cd idlerpg
```

### 2. Install and run the bot

```bash
npm install
cp .env.example .env
```

Edit `.env`: IRC host, channel, `IRPG_DB_PATH`, and any network options (see comments in [`.env.example`](.env.example)).

```bash
npm start
```

**Linux / macOS — background process** (optional):

```bash
chmod +x scripts/idlerpg.sh
./scripts/idlerpg.sh start     # logs: data/bot.log
./scripts/idlerpg.sh stop
./scripts/idlerpg.sh restart
./scripts/idlerpg.sh start -f  # foreground for debugging
```

### 3. Install and serve the website

```bash
cp site.config.php.example site.config.php
```

Edit `site.config.php`:

- **`db_path`**: same database file as `IRPG_DB_PATH` in `.env` (absolute path recommended on servers).
- **`case_sensitive_names`**: must match `IRPG_CASE_SENSITIVE_NAMES` in `.env`.
- If `site.config.php` cannot live next to `public/`, copy [`public/includes/local-root.php.example`](public/includes/local-root.php.example) to `local-root.php` and return the directory that contains `site.config.php`.

Point the virtual host **document root** at **`public/`**. Enable **mod_rewrite** and **mod_headers** so [`public/.htaccess`](public/.htaccess) applies.

### 3.1 SEO and PWA (web)

The public dashboard ships with production SEO + PWA basics:

- **Canonical + social tags + JSON-LD** on [`public/index.php`](public/index.php)
- **Editorial landing pages**:
  - [`public/how-to-play.php`](public/how-to-play.php)
  - [`public/commands.php`](public/commands.php)
  - [`public/faq.php`](public/faq.php)
- **Sitemap**: [`public/sitemap.php`](public/sitemap.php)
- **Robots policy**: [`public/robots.txt`](public/robots.txt) (blocks `/api/`)
- **API noindex** headers from [`public/includes/bootstrap.php`](public/includes/bootstrap.php) (`X-Robots-Tag`)
- **PWA shell**:
  - manifest: [`public/manifest.webmanifest`](public/manifest.webmanifest)
  - service worker: [`public/sw.js`](public/sw.js)
  - offline fallback: [`public/offline.html`](public/offline.html)
  - registration helper: [`public/assets/pwa.js`](public/assets/pwa.js)

Post-deploy checklist:

1. Set `IRPG_PUBLIC_URL` to the final HTTPS domain.
2. Open `/sitemap.php` and confirm valid XML output.
3. Submit sitemap in Google Search Console and Bing Webmaster Tools.
4. Request indexing for `/`, `/how-to-play.php`, `/commands.php`, `/faq.php`.

### 4. Verify

| Check | Expected result |
|--------|-----------------|
| `GET /api/health.php` | JSON with `"ok": true` |
| `GET /api/leaderboard.php` | JSON including `players`, realm pulse, guild preview (+ `createdAt`), season preview rows, and current season window metadata (`seasonMeta`) |
| `GET /api/player.php?name=...` | JSON hero detail including `createdAt`, season info, medals, and `recentFinds` (today rows for that hero) |
| `GET /api/chronicle.php` | JSON with an `events` array (realm log; default limit matches IRC `!chronicle`) |

---

## Configuration

| Concern | File |
|---------|------|
| Bot: IRC, database path, timers, quests, lucky hour, owner account, … | [`.env.example`](.env.example) → copy to `.env` (the real `.env` is not in the repo). |
| Site: database path, `debug` | `site.config.php` (copy from `site.config.php.example`) |
| Optional AI lore/banter (`!lore` / `LORE`) | Set `IRPG_AI_*` in `.env` (`IRPG_AI_ENABLED=true`, Groq key/model/timeout/cooldowns). Default model is `llama-3.1-8b-instant` for low-cost/free-friendly usage. |

**Release branding:** `IDLE_RPG_VERSION` in [`src/config.ts`](src/config.ts) drives CTCP `VERSION`, channel `!ping`, and the default `IRPG_IRC_GECOS` real name. Keep it in step with `.env` / [`.env.example`](.env.example) and bump [`package.json`](package.json) `version` when you tag a release.

Keep your AI API key only in your local `.env` (gitignored). Preferred variable is `IRPG_AI_GROQ_API_KEY` (or `GROQ_API_KEY`); never paste or commit real API keys to the repository.

For production, set **`debug` ⇒ false** in `site.config.php`. Do not place the SQLite file under the public document root.

---

## IRC reference

**Game channel** is `IRPG_IRC_CHANNEL` (default `#IdleRPG`). For **REGISTER** and **LOGIN**, your IRC nick must be **in that channel** while you message the bot.

Private commands are rate-limited per nick via `IRPG_PM_FLOOD_MAX` and `IRPG_PM_FLOOD_WINDOW_MS` (see `.env.example`; set max to `0` to disable). **CTCP VERSION** does not count toward that limit.

**Durations (timers, lucky hour, penalties):** the bot and PHP API use the same human-readable rules: under **1 minute** as `45s`; under **1 hour** as `13m 5s` or `10m`; under **1 day** as `14h 18m 29s`; **1+ days** as `2d 14h 18m 29s`. Chronicle / site “time ago” uses compact `s` / `m` / `h` / `d`.

If **`IRPG_IRC_CHAN_BANTER_MS`** is set **`> 0`**, the bot also posts occasional ambient lines and **contextual tips** (REGISTER / LOGIN / `!` commands you can actually use right then). Set to **`0`** to disable.
If **`IRPG_IRC_TOPIC_ENABLED=true`**, the bot updates the channel **TOPIC** only on key state changes (season rollover or world-boss state change) using a low-noise format. The bot needs topic privileges (+o / +h depending on network mode policy).

---

### Game rules

| Topic | Detail |
|-------|--------|
| **Goal** | Gain **levels** by idling: your **next level timer** (`next_seconds`) counts down while you are **logged in** and your nick is **present in the game channel**. |
| **Silence** | Staying quiet in channel is the main loop; the bot ticks once per `IRPG_SELF_CLOCK_MS` (default 1s). |
| **Talking in channel** | Normal channel lines add a **time penalty** when you are logged in: scales roughly with **message length** and level (via `penttl` / `rpbase`). You get a **NOTICE** with the penalty amount. |
| **`!` commands** | Recognized lines that start with `!` (commands below) **do not** add that speaking penalty. Unrecognized `!foo` still counts as normal speech. |
| **Alignment** | `n` / `g` / `e` affects idle rate slightly and duel power; **Hand of God** events can nudge alignment. |
| **Charm / trinket** | Milestone levels may grant a cosmetic trinket (~0.3% faster idle while set). |
| **Quests** | If enabled, party quests start automatically when enough heroes are online (see `IRPG_QUEST_*` in `.env`). |
| **Lucky hour** | If enabled, random windows where Hand-of-God odds are boosted. |
| **V3 daily trial** | Optional shard event (`IRPG_V3_*`): one online hero gets a timed challenge with bounded timer reward/penalty and chronicle log. |
| **V3 bounty board** | Optional daily idle contract (`!bounty`): stay quiet/present to fill progress and auto-claim one timer reduction when target is reached. |
| **V3 season pass** | Optional monthly season ladder with separate seasonal XP/tier progression (`!season`) and no reset of base hero progression. |
Season numbering is anchored by `IRPG_V3_SEASON_EPOCH_SEC` (Unix seconds) plus `IRPG_V3_SEASON_LENGTH_DAYS`, so you can keep human-friendly season counts across shards.

| **V3 world boss** | Optional cooperative periodic event: online idlers contribute passive damage and share timer reward on kill (`!boss`). |
| **V3 guilds / relics / prestige** | Optional social and meta loops: guild tags + bonus (`!guild`), one active relic perk (`!relic`), rebirth for soft permanent bonus (`!prestige`). |
| **V3 idle streak** | Optional reward loop: uninterrupted in-channel idle grants periodic timer reductions. In strict mode, **any channel activity** (including `!` commands) breaks the streak; penalties/combat outcomes also reset it. |
| **Level-up action window** | After a level-up, the hero gets a **5-minute hint window** (notice) suggesting currently available `!duel` / `!omen` / `!gauntlet`; one reminder appears at half-window. This is informational only and does **not** bypass cooldowns. |
| **REGISTER** | PM the bot: one-word **password**; **class** can be multiple words. **Character name** must be unique in the database. |
| **LOGIN / LOGOUT** | **LOGIN** / **LOGOUT** via PM. **LOGOUT** applies a **logout penalty** (timer increase). |
| **PART** (leave channel) while logged in | **Suspended session:** `online` clears and **PART penalty** applies; **`session_open` stays 1**. **Rejoin the channel** → session resumes (**no second LOGIN**). Idle time did not advance while you were gone. |
| **QUIT** (leave IRC) while logged in | Default: **session ends** (`session_open = 0`) with **QUIT penalty**; you must **LOGIN** again next time. Optional netsplit grace: set `IRPG_NETSPLIT_GRACE_SEC > 0` to keep likely split quits suspended (no penalty) for auto-resume during that window. |
| **KICK** | Logged-out + **kick** penalty (strong). |
| **NICK change** while logged in | Penalty + DB `irc_nick` updated to the new nick. |
| **Not in channel** | If you are logged in but your nick is not in the game channel, **idle time does not advance** for that character. |
| **Bot offline** | Timers do not advance while the bot is disconnected. |
| **Password recovery** | No self-service reset: ask a **game admin** (see [Staff](#staff-admin-over-pm)). |
| **Privacy** | Do not paste passwords in the channel; use **PM** only. |

The site sidebar **Rules** panel is a short summary; this section matches the bot behaviour in code.

### Gameplay mechanics reference (code-accurate)

This section is the fast operator reference for balancing and live tuning. Values below reflect defaults in `src/game/*` + `src/config.ts`.

| System | Core logic | Default tuning |
|--------|------------|----------------|
| **Hand of God** | Randomly selects one online hero in channel and applies a timer swing. | Trigger chance per tick: `IRPG_HOG_CHANCE` (`0.0008`). During Lucky Hour: `x3` chance. Outcome split: `80%` gain / `20%` loss. Delta size: random `5%..75%` of current `next_seconds`. |
| **Omen** (`!omen`) | Personal cooldown action with flavor/boon/curse/rare branches. | Cooldown: `8h`. Buckets: `55%` neutral flavor, `23%` boon (`next_seconds * 0.998`), `15%` curse (`next_seconds * 1.004`), `7%` rare chronicle inscription. Relic `omen_eye` adds luck via `IRPG_V3_RELIC_OMEN_LUCK_BONUS_PCT`. |
| **Duel** (`!duel`) | PvP roll with level-gap constraints, pair cooldown, optional crit branch. | Initiator cooldown: `5h`. Pair cooldown: `20h`. Max gap: `+-11` levels. Crit chance: `10%`. Base multipliers: winner `0.992`, loser `1.006`; crit: winner `0.985`, loser `1.014`. |
| **Gauntlet** (`!gauntlet`) | PvE challenge against shadow power with epic branch and long cooldown. | Cooldown: `16h`. Epic chance: `1/8` (`12.5%`). Win path: `0.99` (epic `0.982`). Loss path: `1.005` (epic `1.012`). Epic fallback win rescue chance: `35%`. |

**V3 baseline defaults (when enabled):**

| Subsystem | Defaults |
|-----------|----------|
| **Daily trial** | reward `180s`, penalty `90s` |
| **Idle streak** | step `1800s` (`30m`), reward `15s` per step |
| **Bounty board** | target `5400s` (`90m`), reward `180s` |
| **Season pass** | baseline gain `6 XP/min` while idling online in channel |

**Implementation note:** if README text and runtime differ, runtime is authoritative. Verify in `src/game/chronicle-omen.ts`, `src/game/duel.ts`, `src/game/gauntlet.ts`, `src/game/engine.ts`, and `src/game/realm.ts`.

---

### Channel commands (`!…`, no idle penalty if matched)

All commands are case-insensitive on the `!word` token (e.g. `!HELP`). Optional arguments are in `[brackets]`; literals in `⟨angle brackets⟩`.

| Command | Arguments | Description |
|---------|-----------|-------------|
| **!help** | — | Short help (registration / login); use **!cmds** for the full channel list. |
| **!cmds** | — | Longer list of channel commands. Alias: **!commands**. |
| **!rules** | — | One-line summary (idle, penalties, PM register/login, quests/lucky). |
| **!ping** | — | Bot check (`pong — IdleRPG V3.0 NetIRC`). |
| **!top** | — | Top **3** heroes (name, level, class, time to level). |
| **!stats** | `[character name]` | Your stats if omitted; otherwise lookup by character name (may be case-sensitive; see `IRPG_CASE_SENSITIVE_NAMES`). |
| **!time** | `[character name]` | Time to next level (self or named character). |
| **!whoami** | — | Logged-in identity + cooldown summary (omen/duel/gauntlet/daily trial) and, when active, remaining level-up hint window time. |
| **!records** | — | Realm records / highs (same source as the site). |
| **!quest** | — | Quest status line (team quest window, etc.). |
| **!bounty** | — | Daily idle contract progress/reward status (V3 optional). Shows progress, reward size, and quiet-gate countdown when active. |
| **!season** | — | Current season label, your season XP/tier, and time left before rollover. |
| **!boss** | — | Current world boss status (HP/time) or next spawn timer. |
| **!guild** | `[status/create/join/leave ...]` | Minimal clan system: create tag/name, join/leave guild, and status. |
| **!relic** | `[status/list/equip key]` | Show/equip your single active relic perk. |
| **!prestige** | `[now]` | Show prestige rank/bonus; with `now`, rebirth at min level and gain permanent soft bonus. |
| **!realm** | — | One-line **realm pulse**: heroes online, quest, lucky hour, peak level. Alias: **!pulse**. |
| **!chronicle** | — | Recent **realm events** on one IRC line (newest **15** events, same default count as the web feed; ~480 chars max). |
| **!omen** | — | Personal omen (~**8h** cooldown); must be **logged in** and in channel; **can change your timer** (boon/curse/rare). |
| **!duel** | `⟨irc_nick⟩` | Arena **PvP** vs another **logged-in** hero **in channel**; **±11** levels; initiator cooldown ~**5h**; challenger→target pairing cooldown ~**20h**; timer shifts + flair; medals possible. |
| **!gauntlet** | — | **PvE** shadow trial; **~16h** cooldown after a run; timer swing + medals at milestones. |
| **!lore** | `[topic]` | Optional AI flavor line (Groq) with cooldown and local fallback. Replies show `AI lore:` on successful API output, otherwise `AI unavailable...` + local lore fallback. When AI is enabled, ambient channel banter may also become hero-aware. |
| **!medals** | `[character name]` | Medal rack + duel/gauntlet win counts (self if omitted; otherwise by **character** look‑up). Alias: **!badges**. |

---

### Private messages (to the bot)

Send as **PM** (private message) to the bot nick. For **REGISTER**, **LOGIN**, and combat-read commands, you must be **in the game channel** on that IRC session (the bot checks `namesInChannel`).

| Command | Arguments | Description |
|---------|-----------|-------------|
| **HELP** | — | Page 1: register/login syntax, recovery note. |
| **CMDS** | — | Page 2: extra commands + ADMIN summary. Aliases: **COMMANDS**. |
| **REGISTER** | `Name Password Class…` | Create account; password = **one word**; class phrase allowed. |
| **LOGIN** | `Name Password` | Start session (must be in game channel). |
| **LOGOUT** | — | End session + logout penalty. |
| **PING** | — | Bot check (same build id as **!ping** / CTCP **VERSION**). |
| **STATS** | `[name]` | Same idea as **!stats**. |
| **TOP** | — | Top **5** (PM uses wider list than **!top**). |
| **WHOAMI** | — | Same as **!whoami** (includes cooldown summary and level-up hint window status when active). |
| **TIME** | `[name]` | Same as **!time**. |
| **RECORDS** | — | Same as **!records**. |
| **QUEST** | — | Same as **!quest**. |
| **BOUNTY** | — | Same as **!bounty** (daily contract status). |
| **SEASON** | — | Same as **!season**. |
| **BOSS** | — | Same as **!boss**. |
| **GUILD** | `status/create/join/leave ...` | Same as **!guild**. |
| **RELIC** | `status/list/equip key` | Same as **!relic**. |
| **PRESTIGE** | `[now]` | Same as **!prestige**. |
| **REALM** / **PULSE** | — | Same as **!realm**. |
| **CHRONICLE** | — | Same as **!chronicle**. |
| **OMEN** | — | Same as **!omen** (must be in game channel). |
| **DUEL** | `irc_nick` | Same rules as **!duel** (must be in game channel). |
| **GAUNTLET** | — | Same as **!gauntlet** (must be in game channel). |
| **LORE** | `[topic]` | Optional AI lore line via Groq (assistive flavor only, no gameplay impact). Same source labels as `!lore` (`AI lore:` vs `AI unavailable...` fallback). |
| **MEDALS** / **BADGES** | `[name]` | Same as **!medals**. |
| **ADMIN** | `subcommand …` | [Staff](#staff-admin-over-pm) only. Try **`ADMIN HELP`**. |

When you **join the game channel**, the bot sends a throttled onboarding **NOTICE**: if your prior session was suspended after `PART`, it confirms automatic resume; if your nick is registered but logged out, it prompts **LOGIN**; otherwise it shows a welcome with **REGISTER** syntax.

---

### Staff (ADMIN over PM)

Who may use **`ADMIN`**:

| Eligibility | Detail |
|-------------|--------|
| **`IRPG_ADMIN_IRC_NICKS`** | Comma-separated **IRC nicks** in `.env` (see [`.env.example`](.env.example)): can **`ADMIN`** by PM **without** a logged-in game character. Status prefixes (`~&@%+`) are ignored when matching. |
| **Logged-out / online** | A player row whose **`irc_nick`** matches yours may **`ADMIN`** if **`is_admin`** is set **or** the character name matches **`IRPG_OWNER_ACCOUNT`** — **even when `online = 0`** (e.g. after **LOGOUT**), as long as the nick is still stored on that row. |
| **In channel** | Not required for **`ADMIN`** itself (PM only). Subcommands that need channel state (**STARTQUEST**, etc.) still use the bot’s live presence list. |

Message the bot in **PM**: **`ADMIN HELP`**

| ADMIN subcommand | Syntax | Effect |
|------------------|--------|--------|
| **FORCELOGOUT** | `ADMIN FORCELOGOUT CharacterName` | Clears **online** session for that character. |
| **DELETEUSER** | `ADMIN DELETEUSER CharacterName` | **Permanently deletes** the character from **`players`**, their **`player_medals`**, and clears **realm peak** metadata if it was theirs. **Irreversible.** Alias: **`ADMIN DELETE`** (same arguments). |
| **RESETPASS** | `ADMIN RESETPASS CharacterName newpassword` | Sets a new password (max 128 chars), clears session; player must **LOGIN** again. Alias: **SETPASS**. |
| **STARTQUEST** | `ADMIN STARTQUEST` | Force-start a quest (if configuration allows and enough players are in channel). |
| **LUCKY** | `ADMIN LUCKY` | Broadcast staff **lucky hour** window. |
| **SAY** | `ADMIN SAY …text…` | Bot sends the text as a normal message in the **game channel**. |
| **SHUTDOWN** | `ADMIN SHUTDOWN` optional note | Writes **`admin_shutdown`** to the realm chronicle, posts a short line in channel, sends **QUIT**, clears bot heartbeat, then **exits the Node process** (`process.exit(0)`). **Restart** the bot on the host (e.g. `./scripts/idlerpg.sh start`, **systemd**, or your supervisor). Optional words after **`SHUTDOWN`** are stored in the chronicle detail for logging. **Does not stop PHP** or your web server — only the bot process. |

**Security:** treat **`IRPG_ADMIN_IRC_NICKS`** and owner account like root access. Do **not** publish full admin syntax publicly for password resets; players should ask staff in channel.

### Development

```bash
npm run dev:bot   # bot with file watcher
```

Game time is stored in SQLite (`next_seconds`). Timers do not advance while the bot is disconnected.

---

## Optional components

| Path | Purpose |
|------|---------|
| `web/` | React + Vite front-end for local experiments: `cd web && npm install && npm run dev`. Not required for the PHP dashboard. |
| `npm run api` | Express API for local development; production can rely on `public/api/*.php` only. |

---

## License

[MIT](LICENSE). Original IdleRPG concept: [idlerpg.net](http://idlerpg.net).
