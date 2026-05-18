# idlerpg

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PHP](https://img.shields.io/badge/PHP-%3E%3D8.0-777BB4?logo=php&logoColor=white)](https://www.php.net/)

IdleRPG-style IRC game platform with two runtime surfaces:

- A Node.js bot (`src/`) that owns gameplay, timers, penalties, and state updates.
- A PHP dashboard/API (`public/`) that reads the same SQLite file for leaderboard and live views.

The web stack is read-only against game state. The bot is authoritative.

|  |  |
|--|--|
| Live demo | [idlerpg.netirc.eu](https://idlerpg.netirc.eu) |
| Concept | [IdleRPG](http://idlerpg.net) |
| Related implementations | [falsovsky/idlerpg](https://github.com/falsovsky/idlerpg), [idlerpg-site-ng](https://github.com/falsovsky/idlerpg-site-ng) |

Additional docs: [DEPLOY.md](DEPLOY.md), [SECURITY.md](SECURITY.md), [LICENSE](LICENSE)

---

## Table of contents

- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration guide](#configuration-guide)
- [Operations and verification](#operations-and-verification)
- [Gameplay reference](#gameplay-reference)
  - [Core rules](#core-rules)
  - [Detailed mechanics and default tuning](#detailed-mechanics-and-default-tuning)
  - [Prestige explained clearly](#prestige-explained-clearly)
- [IRC command reference](#irc-command-reference)
  - [Channel commands (`!`)](#channel-commands-)
  - [PM commands](#pm-commands)
  - [Admin commands (`ADMIN` over PM)](#admin-commands-admin-over-pm)
- [HTTP API reference](#http-api-reference)
- [Web/SEO/PWA notes](#webseopwa-notes)
- [Development](#development)
- [Optional components](#optional-components)
- [Troubleshooting checklist](#troubleshooting-checklist)
- [License](#license)

---

## Architecture

| Layer | Responsibility |
|---|---|
| `src/` IRC bot | Gameplay engine, session handling, level ticks, penalties, events, optional V3 systems, chronicle writes. |
| `public/` PHP UI | Leaderboard, player details, realm chronicle feed, guild standings, season standings, SEO guide pages, PWA shell. |
| `public/api/*.php` | Read-only JSON endpoints for health, leaderboard, player detail, chronicle feed. |
| SQLite DB | Shared source of truth. Bot writes state; website reads state. |

Important: bot and site must point to the same database file path.

---

## Requirements

| Component | Required version / note |
|---|---|
| Node.js | 20+ |
| npm | bundled with Node.js |
| PHP | 8+ |
| PHP extensions | `pdo`, `pdo_sqlite` |
| HTTP server | Apache (recommended) or Nginx equivalent config |

Apache notes:

- VirtualHost `DocumentRoot` should target `public/`.
- Enable `AllowOverride` so `public/.htaccess` can apply rewrite/security headers.
- Enable `mod_rewrite` and `mod_headers`.

---

## Quick start

### 1) Clone

```bash
git clone https://github.com/NetIRC/idlerpg.git
cd idlerpg
```

### 2) Bot install and run

```bash
npm install
cp .env.example .env
npm start
```

Edit `.env` before first production run:

- IRC connection values
- `IRPG_DB_PATH`
- channel and policy settings
- optional V3 and AI settings

### 3) Website install and serve

```bash
cp site.config.php.example site.config.php
```

Edit `site.config.php`:

- `db_path`: must match `IRPG_DB_PATH`
- `case_sensitive_names`: must match `IRPG_CASE_SENSITIVE_NAMES`
- `debug`: `false` in production

If `site.config.php` is stored outside project root, copy
`public/includes/local-root.php.example` to `public/includes/local-root.php`
and return the path that contains `site.config.php`.

### 4) Linux/macOS helper script (optional)

```bash
chmod +x scripts/idlerpg.sh
chmod +x scripts/idlerpg-watchdog.sh
./scripts/idlerpg.sh start
./scripts/idlerpg.sh stop
./scripts/idlerpg.sh restart
./scripts/idlerpg.sh start -f
./scripts/idlerpg.sh watch
./scripts/idlerpg.sh start --watch
./scripts/idlerpg-watchdog.sh
```

### 5) Windows helper script (optional)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\idlerpg-watchdog.ps1
```

---

## Configuration guide

| Concern | Location |
|---|---|
| Bot runtime, gameplay, V3 toggles, IRC, rate limits | `.env` (from `.env.example`) |
| Web runtime values | `site.config.php` (from `site.config.php.example`) |
| Build/release version branding | `src/config.ts` (`IDLE_RPG_VERSION`) and `package.json` |

### High-impact settings to keep synchronized

- Bot DB path and web DB path must be identical.
- Name case sensitivity must match in bot and web.
- Keep V3 feature flags (`IRPG_V3_*`) aligned between bot and web runtime environments.
- If you run multiple shards/environments, isolate each DB path.

### AI settings (`!lore` / `LORE`)

Use `IRPG_AI_*` in `.env`.
Keep API keys only in local secrets (`.env` is gitignored).
Never commit real keys.

### Security baselines

- Keep SQLite database outside web document root.
- Use HTTPS in production.
- Set `debug` to `false` in production web config.
- Treat admin identity config as privileged access.

---

## Operations and verification

After deploy/startup, verify:

| Check | Expected result |
|---|---|
| `GET /api/health.php` | JSON includes `"ok": true` |
| `GET /api/leaderboard.php` | JSON includes leaderboard rows and realm/season previews |
| `GET /api/player.php?name=<hero>` | JSON includes hero detail, medals, recent activity, and offline/session cause fields |
| `GET /api/chronicle.php` | JSON includes `events` array |

Runtime notes:

- Bot heartbeat controls whether web shows online/offline state.
- Timers do not progress while bot is offline/disconnected.
- Hero sheet status is cause-aware (`part`, `quit`, `netsplit`, `logout`, `kick`, admin actions).

---

## Gameplay reference

### Core rules

| Topic | Behavior |
|---|---|
| Main goal | Gain levels by idling while logged in and present in game channel. |
| Timer model | `next_seconds` counts down while eligible. |
| Speaking in channel | Adds penalty based on level and message characteristics. |
| Recognized `!commands` | No speech penalty if command is valid. |
| Unrecognized `!something` | Treated as normal speech and can be penalized. |
| Login requirement | Register/login via PM while your nick is in game channel. |
| PART while logged in | Session is suspended; resume on rejoin. |
| QUIT while logged in | Session is suspended with quit penalty; rejoin resumes without a new LOGIN. |
| LOGOUT while logged in | Session is closed immediately; LOGIN is required to reopen. |
| Not in channel | No idle progression. |
| Bot offline | No idle progression. |

### Detailed mechanics and default tuning

Defaults reflect current code paths in `src/game/*` and config defaults in `src/config.ts`.

| System | Default behavior (high level) |
|---|---|
| Hand of God | Random timer swing event; chance increases during lucky hour. |
| Omen | Personal cooldown action with neutral/boon/curse/rare branches. |
| Duel | PvP action with level-gap limit, cooldowns, and timer swing outcomes. |
| Gauntlet | PvE trial with cooldown, risk/reward timer outcomes, possible epic branch. |
| Daily trial (V3) | Timed challenge with bounded reward/penalty. |
| Idle streak (V3) | Periodic timer reductions for uninterrupted idle presence. |
| Bounty board (V3) | Daily progress objective with one timer reward on completion. |
| Season pass (V3) | Separate seasonal progression with no base hero reset. |
| World boss (V3) | Cooperative passive-damage event with shared rewards. |
| Guilds/relics (V3) | Social bonus and one active relic perk. |

If README text and runtime differ, runtime is authoritative.

### Prestige explained clearly

`!prestige` has two modes:

- `!prestige`: shows your current prestige rank, idle bonus, and required level for rebirth.
- `!prestige now`: performs rebirth only if your level is at least `IRPG_V3_PRESTIGE_MIN_LEVEL` (default `60`).

When rebirth succeeds, current code does this:

- sets hero level to `0`
- resets level timer to base (`rpbase`)
- increases `prestige_rank` by `1`
- increments prestige points
- resets idle streak seconds
- keeps your account/hero identity and grants permanent idle-rate bonus from rank

This is intentional "reset progress now, gain permanent meta-speed later" behavior.

---

## IRC command reference

General command notes:

- Commands are case-insensitive on command token (`!HELP`, `!help` both valid).
- Channel command syntax uses `!`.
- PM command syntax uses plain words without `!`.

### Channel commands (`!`)

| Command | Args | Description |
|---|---|---|
| `!help` | - | Short help. |
| `!cmds` / `!commands` | - | Extended public command list. |
| `!rules` | - | One-line rules summary. |
| `!ping` | - | Bot liveness/version ping. |
| `!top` | - | Top 3 heroes snapshot. |
| `!stats` | `[name]` | Hero profile summary. |
| `!time` | `[name]` | Time to next level. |
| `!whoami` | - | Identity plus cooldown summary. |
| `!records` | - | Realm highs/records. |
| `!quest` | - | Quest status. |
| `!bounty` | - | V3 daily contract status. |
| `!season` | - | Season label, XP/tier, time left. |
| `!boss` | - | World boss active/next status. |
| `!guild` | `status/create/join/leave ...` | Guild operations. |
| `!relic` | `status/list/equip <key>` | Relic operations. |
| `!prestige` | `[now]` | Prestige status or rebirth action. |
| `!realm` / `!pulse` | - | Realm pulse line. |
| `!chronicle` | - | Recent realm events summary line (includes session events such as `part`, `quit`, `netsplit`). |
| `!omen` | - | Personal omen action (cooldown). |
| `!duel` | `<irc_nick>` | PvP duel action. |
| `!gauntlet` | - | PvE gauntlet action. |
| `!lore` | `[topic]` | Optional AI flavor text. |
| `!medals` / `!badges` | `[name]` | Medal rack summary. |

### PM commands

PM commands map to channel equivalents plus account/admin actions:

| PM Command | Args | Description |
|---|---|---|
| `HELP` / `CMDS` | - | PM help pages. |
| `REGISTER` | `Name Password Class...` | Create hero/account. |
| `LOGIN` | `Name Password` | Open game session. |
| `LOGOUT` | - | Close session with logout penalty. |
| `PING` | - | Liveness/version ping. |
| `STATS`, `TOP`, `WHOAMI`, `TIME`, `RECORDS`, `QUEST` | optional args | Same purpose as channel forms. |
| `BOUNTY`, `SEASON`, `BOSS`, `GUILD`, `RELIC`, `PRESTIGE` | optional args | Same purpose as channel forms. |
| `REALM` / `PULSE` | - | Same as `!realm`. |
| `CHRONICLE` | - | Same as `!chronicle`. |
| `OMEN`, `DUEL`, `GAUNTLET` | optional args | Same gameplay checks as channel forms. |
| `LORE` | `[topic]` | Same as `!lore`. |
| `MEDALS` / `BADGES` | `[name]` | Same as `!medals`. |
| `ADMIN` | `subcommand` | Admin-only control commands. |

### Admin commands (`ADMIN` over PM)

Eligibility is controlled by configured admin nicks and/or admin player identity.
By default, admin PM commands also require your nick to be present in the game channel (`IRPG_ADMIN_REQUIRE_IN_CHANNEL=true`).

Use `ADMIN HELP` in PM.

| Subcommand | Syntax | Effect |
|---|---|---|
| `FORCELOGOUT` | `ADMIN FORCELOGOUT <CharacterName>` | Clears active session for that hero. |
| `DELETEUSER` / `DELETE` | `ADMIN DELETEUSER <CharacterName>` | Permanent hero deletion and related cleanup. |
| `RESETPASS` / `SETPASS` | `ADMIN RESETPASS <CharacterName> <newpassword>` | Set new password and clear session. |
| `STARTQUEST` | `ADMIN STARTQUEST` | Force start quest (subject to runtime checks). |
| `LUCKY` | `ADMIN LUCKY` | Force lucky-hour style broadcast. |
| `SAY` | `ADMIN SAY <text...>` | Send bot message to game channel. |
| `SHUTDOWN` | `ADMIN SHUTDOWN [note...]` | Broadcast/log shutdown and exit bot process. |
| `RESTART` | `ADMIN RESTART [note...]` | Broadcast/log restart and exit bot process (for supervisor auto-restart). |

Treat admin credentials as root-equivalent access.

---

## HTTP API reference

All API responses are JSON.

| Endpoint | Purpose | Notes |
|---|---|---|
| `/api/health.php` | Service health check | Includes `"ok": true` when healthy. |
| `/api/leaderboard.php` | Public leaderboard + realm/season slices | Used by web home dashboard. |
| `/api/player.php?name=...` | Hero detail lookup | Returns hero profile by character name, including `sessionOpen`, `offlineSinceTs`, and `offlineReason`. |
| `/api/chronicle.php` | Realm event feed | Supports filters such as `limit`, `kind`, `search`, `since`, `until` (includes `part`, `quit`, `netsplit` kinds). |
| `/api/php-diag.php` | PHP runtime diagnostics | Local-only by default; non-local access requires explicit `IRPG_PHP_DIAG_ENABLED=true`. |

Public `robots.txt` blocks indexing of `/api/`, `/includes/`, and `/admin/`; API endpoints emit noindex headers. `/admin/` also gets `X-Robots-Tag: noindex` via `.htaccess`.

---

## Admin panel (hardened)

A hardened read-only operations panel is available at `/admin/index.php`.

Security controls implemented:

- explicit enable flag in `site.config.php` (`admin_panel.enabled`)
- password hash verification (`password_hash`/`password_verify`)
- optional TOTP second factor (`totp_enabled`, `totp_secret_base32`)
- strict session cookie flags + session rotation + idle TTL
- CSRF token validation on authenticated state-changing posts (logout/password rotation/TOTP settings/backup download)
- login attempt rate limiting by source IP
- IP allowlist with exact IP or CIDR (`ip_allowlist`)
- optional HTTPS enforcement (`require_https`)
- no-store cache headers + CSP + frame denial + noindex
- in-panel password rotation form (current password + confirmation + secure hash rewrite)
- password rotation rewrite is regex-safe for bcrypt hashes and invalidates PHP opcache for immediate effect
- DB health diagnostics (integrity check, DB/WAL sizes, free-page ratio, maintenance recommendation)
- authenticated backup download (CSRF-protected snapshot stream)
- in-panel TOTP management (enable/disable, issuer/secret update, optional secret regeneration)
- `Regenerate secret automatically` rotates TOTP secret even when TOTP is currently disabled
- deterministic PRG feedback for login/TOTP/password/session/CSRF outcomes (banner + inline field hints)

Example `site.config.php` block:

```php
'admin_panel' => [
    'enabled' => true,
    'password_hash' => '$2y$10$replace_with_password_hash',
    'totp_enabled' => true,
    'totp_secret_base32' => 'BASE32SECRET',
    'totp_issuer' => 'IdleRPG Admin',
    'ip_allowlist' => ['127.0.0.1', '::1', '10.0.0.0/24'],
    'require_https' => true,
    'session_ttl_sec' => 1800,
],
```

Generate a password hash:

```bash
php -r "echo password_hash('StrongPassHere', PASSWORD_DEFAULT), PHP_EOL;"
```

---

## Web/SEO/PWA notes

The web layer includes:

- canonical/social tags and JSON-LD metadata on the home dashboard and guide pages
- SEO landing pages: `/how-to-play.php`, `/commands.php`, `/faq.php`
- footer **guide modal** on the home page (iframe); guide footers link only to each other (no link back to `/` inside the iframe)
- XML sitemap at `/sitemap.php` (lists home + the three guides; served with `X-Robots-Tag: noindex`)
- `robots.txt` with `Sitemap:` URL (update the host in that file if your public domain differs)
- web app manifest + service worker + offline fallback

### Guide pages (`public/`)

Shared PHP under `public/includes/`:

| File | Role |
|---|---|
| `guide-init.php` | Bootstrap; friendly error if includes are missing on the server |
| `guide-env.php` | Reads gameplay tuning from project `.env` / `IRPG_*` (server-side only; not exposed to the browser) |
| `guide-data.php` | Command tables, FAQ copy, HTML render helpers |
| `guide-seo.php` | Shared `<head>` SEO tags (canonical, Open Graph, Twitter, JSON-LD) |
| `guide-styles.php` | Loads `assets/app.css` (and optional `assets/guide.css`) |

Guide pages show a **Realm settings** section with live values from the same defaults as the bot (`src/config.ts`). Keep `.env` outside the web document root; use `public/includes/local-root.php` when `site.config.php` and `.env` live beside the bot, not under `public_html`.

**`public_html`-only deploy:** upload the three guide `.php` files, `includes/guide-*.php`, and `assets/app.css` (plus optional `assets/guide.css`). Do not upload `.env` into the web root.

Post-deploy checklist:

1. Set `IRPG_PUBLIC_URL` to final HTTPS domain (canonical URLs, sitemap, Open Graph).
2. Validate `/how-to-play.php`, `/commands.php`, and `/faq.php` (not a blank page).
3. Validate `/sitemap.php` lists four URLs with your domain.
4. Confirm `https://your-domain/.env` returns 403/404.
5. Submit sitemap to search consoles; request indexing for home and guide URLs.
6. Hard-refresh or bump service worker cache after CSS changes.

---

## Development

```bash
npm run dev:bot
```

Windows production-friendly watchdog (auto-restart on crash or `ADMIN RESTART`):

```powershell
npm run start:watchdog
```

Linux/macOS watchdog options:

```bash
chmod +x scripts/idlerpg-watchdog.sh
./scripts/idlerpg-watchdog.sh                 # foreground watchdog
./scripts/idlerpg.sh start --watch            # background watchdog
./scripts/idlerpg.sh stop
```

Behavior:

- exit code `0` (used by `ADMIN SHUTDOWN`) stops the watchdog
- non-zero exit codes (including `ADMIN RESTART`) trigger automatic restart

Useful principles during development:

- gameplay state is persisted in SQLite
- if bot is disconnected, time does not advance
- for balancing, inspect `src/game/*` and `src/config.ts`

---

## Optional components

| Path / command | Purpose |
|---|---|
| `web/` | React + Vite sandbox front-end for local experiments. |
| `npm run api` | Optional Express API for local development workflows. |

Production can run entirely on `public/api/*.php` plus bot process.

---

## Troubleshooting checklist

If something looks wrong, check in this order:

1. Bot process is running and connected to IRC.
2. Bot and web point to the exact same SQLite file path.
3. PHP has `pdo_sqlite` enabled and DB file permissions are valid.
4. Hero is logged in and currently present in game channel.
5. `site.config.php` and `.env` case-sensitivity settings match.
6. For prestige confusion: confirm `IRPG_V3_PRESTIGE_MIN_LEVEL` and use `!prestige` to inspect current threshold.

For deployment/server-specific deep troubleshooting, use [DEPLOY.md](DEPLOY.md).

---

## License

[MIT](LICENSE).
Original IdleRPG concept: [idlerpg.net](http://idlerpg.net).
