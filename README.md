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
- [Optional components](#optional-components)
- [License](#license)

---

## Architecture

| Layer | Responsibility |
|--------|----------------|
| **IRC bot** (`src/`) | Normal client connection (not server / P10). Registration, login, idle ticks, channel penalties, optional quests, lucky hour, Hand of God, alignment, charms. |
| **Web UI** (`public/`) | `index.php` leaderboard, detail pane, rules, bot online/offline banner. [`public/.htaccess`](public/.htaccess): HTTPS (non-local), security headers. |
| **HTTP API** | Read-only JSON: `/api/health.php`, `/api/leaderboard.php`, `/api/player.php?name=…`. |
| **Data** | Single SQLite file (e.g. `data/iodlerpg.db`). The bot and `site.config.php` must resolve to the **same path**. |

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

---

## Configuration

| Concern | File |
|---------|------|
| Bot: IRC, database path, timers, quests, lucky hour, owner account, … | [`.env`](.env.example) (copy from `.env.example`) |
| Site: database path, `debug` | `site.config.php` (copy from `site.config.php.example`) |

For production, set **`debug` ⇒ false** in `site.config.php`. Do not place the SQLite file under the public document root.

---

## IRC reference

**Game channel** is `IRPG_IRC_CHANNEL` (default `#IdleRPG`). For **REGISTER** and **LOGIN**, the user’s nick must be **in that channel** while they message the bot. Private commands are rate-limited per nick via `IRPG_PM_FLOOD_MAX` and `IRPG_PM_FLOOD_WINDOW_MS` (see `.env.example`; set max to `0` to disable). **CTCP VERSION** replies do not count toward that limit.

### Channel commands (no idle penalty if matched)

| Commands |
|----------|
| `!help` · `!cmds` · `!rules` · `!top` · `!ping` · `!stats` [name] · `!time` [name] · `!whoami` · `!records` · `!quest` · `!chronicle` · `!omen` · `!duel` `<irc_nick>` |

Alias: `!commands` (same as `!cmds`). **`!chronicle`** = scroll of recent **realm events** (IRC: **10** newest, one line ~480 chars). **Web / `api/chronicle.php`**: default **16** rows, **`?limit=`** up to **40**. **`!omen`** = personal prophecy (~8h cooldown). **`!duel nick`** = arena fight vs another logged-in nick **in channel** (±11 levels; pair cooldown ~20h; your challenge cooldown ~5h; winner trims timer ~0.8–1.5%, loser gains ~0.6–1.4%; ~1/10 critical). No gold, no items — pure spectacle + small TTL swing. Other channel text can add time penalties; recognized `!` lines do not.

### Private messages (to the bot)

| Topic | Commands |
|-------|----------|
| Account | `REGISTER name password class…` (password: one word) · `LOGIN` · `LOGOUT` |
| Information | `HELP` · `CMDS` · `STATS` [name] · `TOP` · `PING` · `WHOAMI` · `TIME` [name] · `RECORDS` · `QUEST` · `CHRONICLE` · `OMEN` · `DUEL` `<irc_nick>` |

### Staff (after login)

Eligible if the character is DB **`is_admin`** or matches **`IRPG_OWNER_ACCOUNT`** in `.env`. Message **`ADMIN HELP`** for syntax. Capabilities include: `FORCELOGOUT`, `RESETPASS`, `STARTQUEST`, `LUCKY`, `SAY` (channel line).

The site **Rules** panel summarizes the same flows for players.

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
