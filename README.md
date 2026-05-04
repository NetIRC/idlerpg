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
| **IRC bot** (`src/`) | Normal client connection (not server / P10). Registration, login, idle ticks, channel penalties, optional quests, lucky hour, Hand of God, alignment, charms. |
| **Web UI** (`public/`) | `index.php` leaderboard, detail pane, rules, bot online/offline banner. [`public/.htaccess`](public/.htaccess): HTTPS (non-local), security headers. |
| **HTTP API** | Read-only JSON: [`/api/health.php`](public/api/health.php), [`/api/leaderboard.php`](public/api/leaderboard.php), [`/api/player.php`](public/api/player.php) (`?name=…`), [`/api/chronicle.php`](public/api/chronicle.php) (optional `limit`). |
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

### 4. Verify

| Check | Expected result |
|--------|-----------------|
| `GET /api/health.php` | JSON with `"ok": true` |
| `GET /api/leaderboard.php` | JSON including a `players` array |
| `GET /api/chronicle.php` | JSON with an `events` array (realm log; default limit matches IRC `!chronicle`) |

---

## Configuration

| Concern | File |
|---------|------|
| Bot: IRC, database path, timers, quests, lucky hour, owner account, … | [`.env.example`](.env.example) → copy to `.env` (the real `.env` is not in the repo). |
| Site: database path, `debug` | `site.config.php` (copy from `site.config.php.example`) |

**Release branding:** `IDLE_RPG_VERSION` in [`src/config.ts`](src/config.ts) drives CTCP `VERSION`, channel `!ping`, and the default `IRPG_IRC_GECOS` real name. Keep it in step with `.env` / [`.env.example`](.env.example) and bump [`package.json`](package.json) `version` when you tag a release.

For production, set **`debug` ⇒ false** in `site.config.php`. Do not place the SQLite file under the public document root.

---

## IRC reference

**Game channel** is `IRPG_IRC_CHANNEL` (default `#IdleRPG`). For **REGISTER** and **LOGIN**, your IRC nick must be **in that channel** while you message the bot.

Private commands are rate-limited per nick via `IRPG_PM_FLOOD_MAX` and `IRPG_PM_FLOOD_WINDOW_MS` (see `.env.example`; set max to `0` to disable). **CTCP VERSION** does not count toward that limit.

**Durations (timers, lucky hour, penalties):** the bot and PHP API use the same human-readable rules: under **1 minute** as `45s`; under **1 hour** as `13m 5s` or `10m` (minutes, not clock digits); under **1 day** as `H:MM:SS`; **1+ days** as `N day(s), H:MM:SS`. Chronicle / site “time ago” uses compact `s` / `m` / `h` / `d`.

If **`IRPG_IRC_CHAN_BANTER_MS`** is set **`> 0`**, the bot also posts occasional ambient lines and **contextual tips** (REGISTER / LOGIN / `!` commands you can actually use right then). Set to **`0`** to disable.

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
| **REGISTER** | PM the bot: one-word **password**; **class** can be multiple words. **Character name** must be unique in the database. |
| **LOGIN / LOGOUT** | **LOGIN** / **LOGOUT** via PM. **LOGOUT** applies a **logout penalty** (timer increase). |
| **PART** (leave channel) while logged in | **Suspended session:** `online` clears and **PART penalty** applies; **`session_open` stays 1**. **Rejoin the channel** → session resumes (**no second LOGIN**). Idle time did not advance while you were gone. |
| **QUIT** (leave IRC) while logged in | **Session ends** (`session_open = 0`); **QUIT penalty**; you must **LOGIN** again next time. |
| **KICK** | Logged-out + **kick** penalty (strong). |
| **NICK change** while logged in | Penalty + DB `irc_nick` updated to the new nick. |
| **Not in channel** | If you are logged in but your nick is not in the game channel, **idle time does not advance** for that character. |
| **Bot offline** | Timers do not advance while the bot is disconnected. |
| **Password recovery** | No self-service reset: ask a **game admin** (see [Staff](#staff-admin-over-pm)). |
| **Privacy** | Do not paste passwords in the channel; use **PM** only. |

The site sidebar **Rules** panel is a short summary; this section matches the bot behaviour in code.

---

### Channel commands (`!…`, no idle penalty if matched)

All commands are case-insensitive on the `!word` token (e.g. `!HELP`). Optional arguments are in `[brackets]`; literals in `⟨angle brackets⟩`.

| Command | Arguments | Description |
|---------|-----------|-------------|
| **!help** | — | Short help (registration / login); use **!cmds** for the full channel list. |
| **!cmds** | — | Longer list of channel commands. Alias: **!commands**. |
| **!rules** | — | One-line summary (idle, penalties, PM register/login, quests/lucky). |
| **!ping** | — | Bot check (`pong — IdleRPG V2.0 NetIRC`). |
| **!top** | — | Top **3** heroes (name, level, class, time to level). |
| **!stats** | `[character name]` | Your stats if omitted; otherwise lookup by character name (may be case-sensitive; see `IRPG_CASE_SENSITIVE_NAMES`). |
| **!time** | `[character name]` | Time to next level (self or named character). |
| **!whoami** | — | Logged-in identity: character, level, class, alignment, timer. |
| **!records** | — | Realm records / highs (same source as the site). |
| **!quest** | — | Quest status line (team quest window, etc.). |
| **!realm** | — | One-line **realm pulse**: heroes online, quest, lucky hour, peak level. Alias: **!pulse**. |
| **!chronicle** | — | Recent **realm events** on one IRC line (newest **15** events, same default count as the web feed; ~480 chars max). |
| **!omen** | — | Personal omen (~**8h** cooldown); must be **logged in** and in channel; **can change your timer** (boon/curse/rare). |
| **!duel** | `⟨irc_nick⟩` | Arena **PvP** vs another **logged-in** hero **in channel**; **±11** levels; initiator cooldown ~**5h**; same pair ~**20h**; timer shifts + flair; medals possible. |
| **!gauntlet** | — | **PvE** shadow trial; **~16h** cooldown after a run; timer swing + medals at milestones. |
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
| **WHOAMI** | — | Same as **!whoami**. |
| **TIME** | `[name]` | Same as **!time**. |
| **RECORDS** | — | Same as **!records**. |
| **QUEST** | — | Same as **!quest**. |
| **REALM** / **PULSE** | — | Same as **!realm**. |
| **CHRONICLE** | — | Same as **!chronicle**. |
| **OMEN** | — | Same as **!omen** (must be in game channel). |
| **DUEL** | `irc_nick` | Same rules as **!duel** (must be in game channel). |
| **GAUNTLET** | — | Same as **!gauntlet** (must be in game channel). |
| **MEDALS** / **BADGES** | `[name]` | Same as **!medals**. |
| **ADMIN** | `subcommand …` | [Staff](#staff-admin-over-pm) only. Try **`ADMIN HELP`**. |

When you **join the game channel** logged out but your IRC nick is still tied to a hero on file, the bot may send a **NOTICE** reminding you to **LOGIN** (throttled).

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
