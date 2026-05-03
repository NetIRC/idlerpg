# Deploy (GitHub → your server)

Templates committed to the repo (safe to share):

| File | Action on your machine |
|------|-------------------------|
| `.env.example` | Copy to **`.env`** next to `package.json` (never commit `.env`). |
| `site.config.php.example` | Copy to **`site.config.php`** in the **project root** (same folder as `public/`). Never commit real `site.config.php` if it has private paths. |

The dashboard shows the API **hint** text when something breaks. Typical fixes: **`site.config.php`** `db_path` (absolute path = bot `IRPG_DB_PATH`), **`public/includes/local-root.php`** if config is not found, run the bot once so **`data/idlerpg.db`** exists, and **readable** by the web user (`chmod` / `chgrp` — see DEPLOY). Open **`/api/health.php`** and **`/api/leaderboard.php`** in the browser to see JSON errors directly. If the JSON shows **`pdo_sqlite_missing`** / “could not find driver”, install **`php-sqlite3`** / **`pdo_sqlite`** for the **same** PHP version Apache uses. If it shows **`db_open`**, read **§ SQLite `db_open`** below.

If **`php -m`** on the server shows **`pdo_sqlite`** but the site still says **could not find driver**, the **web** PHP is often different from **CLI**. Use **`/api/php-diag.php`** (see **§ HTTPS / hardening** below — that endpoint is blocked by default in production). When enabled, the JSON must list **`extension_pdo_sqlite: true`** and **`pdo_drivers`** containing **`sqlite`**. If not, enable **`pdo_sqlite`** for that PHP version in Virtualmin / FPM pool / `php.ini`, then restart **`php-fpm`** and **`apache2`**. Compare **`php_version`** and **`ini_loaded`** from the JSON with CLI: `php -v` and `php --ini`.

### HTTPS and `public/.htaccess` (production)

The repo ships **`public/.htaccess`**, which: redirects **HTTP → HTTPS** (except **`localhost` / `127.0.0.1`** for local XAMPP), honours **`X-Forwarded-Proto`** (reverse proxies), sets **HSTS** and common **security headers**, denies **directory listings**, blocks **`includes/`** and **`*.db`**-style filenames under document root, and returns **403** for **`/api/php-diag.php`** by default. Comment out the `php-diag` **RewriteRule** line in **`.htaccess`** while debugging PHP modules, then restore it.

Ensure the vhost’s **DocumentRoot** is **`public/`**, and that Apache allows overrides, e.g. **`AllowOverride All`** (or at least **`FileInfo`**, **`Limit`**, **`AuthConfig`**, **`Indexes`** as required) for that directory. **Nginx** does not read `.htaccess`; configure TLS redirect and headers there instead.

### SQLite `db_open` (SELinux / open_basedir / corrupt file)

1. **PDO driver**  
   If **`message`** is **could not find driver**, PHP has no **`pdo_sqlite`** — see the **`pdo_sqlite_missing`** hint in the API JSON and install the extension (this is not a file-permission issue).

2. **`open_basedir` (shared hosting / Virtualmin / php.ini)**  
   If PHP is jailed to e.g. `…/public_html:/tmp`, opening **`/home/you/idlerpg/data/idlerpg.db`** is **blocked** even if the file exists. Fix one of:
   - Add the bot project (or at least **`…/idlerpg/data`**) to **`open_basedir`** in the domain’s PHP configuration / **php.ini** / pool file (e.g. `php_admin_value[open_basedir] = ...:/home/you/idlerpg/data`).
   - Or move/read the DB from a path already allowed (less ideal: duplicating the file).

3. **SELinux (AlmaLinux, RHEL, CentOS, Fedora with enforcing)**  
   Apache may be denied access to home dirs or custom paths. Check denials: **`ausearch -m avc -ts recent`** (as root) or **`getenforce`**. Common mitigations (pick what matches your policy):
   - Allow Apache to read user home content: **`setsebool -P httpd_read_user_content 1`** (broad; use with care).
   - Or label your project tree so httpd may read it, e.g.:  
     **`chcon -R -t httpd_sys_content_t /home/you/idlerpg`**  
     (exact label may vary; **`semanage fcontext`** + **`restorecon`** is the persistent fix — consult your distro’s httpd + PHP SELinux guide.)

4. **Permissions**  
   **`open_basedir`** is independent of mode bits: ensure the web user can **traverse** every parent directory (`x` on dirs) and **read** the `.db` file.

5. **Corrupt or empty file**  
   On the server: **`sqlite3 /path/to/idlerpg.db ".tables"`** (package **`sqlite3`**). If it errors, stop the bot, back up the file, delete it, restart the bot to recreate a fresh DB (players lost unless you restore backup).

6. **Other PDO errors**  
   Set **`'debug' => true`** in **`site.config.php`** temporarily to see the raw PDO message, then turn it off again.

---

## Start the IRC bot (Node.js)

Needs **Node 20+** and **npm** on the machine that stays connected to IRC.

### 1) Install dependencies

`npm` must run in the **repository root** — the folder that contains **`package.json`**. Your shell user may be `idlerpg` on `/home/idlerpg`, but that home directory is **not** the app until you clone or upload the project **into** it.

```bash
cd ~
git clone https://github.com/NetIRC/idlerpg.git idlerpg
cd idlerpg               # must contain package.json (ls should show it)
npm install
```

If you see **`ENOENT` … `package.json`**, you are still one level too high (e.g. only `~` without `cd` into the clone).

### 2) Environment (recommended)

```bash
cp .env.example .env
# Edit .env if you do not use the defaults (NetIRC: chat.netirc.eu:6667, #IdleRPG).
```

If you **skip** `.env`, the bot still starts using built-in defaults (`chat.netirc.eu`, `#IdleRPG`, etc.) from `src/config.ts`.

### 3) Run

```bash
npm start
```

Same as `npm run bot`. For development with auto-restart on file changes: `npm run dev:bot`.

**Shell helper (Linux / macOS):** from repo root, after `chmod +x scripts/idlerpg.sh` once:

```bash
./scripts/idlerpg.sh start      # background (default)
./scripts/idlerpg.sh stop
./scripts/idlerpg.sh restart
./scripts/idlerpg.sh start -f   # foreground (e.g. tmux)
```

`./scripts/idlerpg.sh start` installs `node_modules` if missing; background run uses **`data/bot.log`** and **`data/bot.pid`**.

If **`/usr/bin/env: 'bash\r': No such file`**, fix CRLF once from repo root:

```bash
sed -i 's/\r//g' scripts/idlerpg.sh
chmod +x scripts/idlerpg.sh
```

### Keep the bot online (Linux)

- **Ping timeout** on IRC means the TCP link stalled or lag was too high; the bot already uses **auto-reconnect** with extended retries. Prefer **systemd** with **`Restart=always`** so the process comes back even after repeated failures.
- **systemd**: run `npm start` (or `tsx`) as a service with `Restart=always`.
- **PM2**: `npx pm2 start npm --name idlerpg -- start` (or `run bot`).
- **screen** / **tmux**: run `npm start` inside a persistent session.

---

## PHP site — https://idlerpg.netirc.eu

1. **DNS:** point **`idlerpg.netirc.eu`** (A/AAAA) to your server’s public IP.
2. **Repo on server:** clone/upload. **DocumentRoot = `public/`** (e.g. `/var/www/idlerpg/public`).  

   **Virtualmin / `public_html`:** you may copy only the **contents of `public/`** into `~/public_html`. Leave the bot, `node_modules`, and **`site.config.php`** under **`~/idlerpg/`** (same folder as `.env`). PHP will load **`~/idlerpg/site.config.php`** automatically. Set **`db_path`** there to the real DB (e.g. `/home/youruser/idlerpg/data/idlerpg.db`).
3. **`site.config.php`:** copy from `site.config.php.example`; set **`db_path`** to the **same absolute path** as **`IRPG_DB_PATH`** in the bot’s `.env`. If the dashboard says **missing_config**, either copy `site.config.php` to one of the searched paths or add **`public/includes/local-root.php`** (see `local-root.php.example`) returning the folder that contains `site.config.php`.
4. **SQLite permissions:** the web server user must **read** `idlerpg.db` (and usually **execute** permission on each parent directory). Example:  
   `chmod 640 data/idlerpg.db && chmod 711 data`  
   and either put the web user in the bot user’s group and `chgrp` the file, or use ACL/`chmod o+r` on the `.db` only (narrowest fix). Test: `sudo -u www-data cat /path/to/idlerpg.db | head -c 1` (adjust user).
5. **TLS (Let’s Encrypt):**

   ```bash
   sudo certbot --apache -d idlerpg.netirc.eu
   ```

6. **Apache virtual host (HTTPS example):**

   ```apache
   <VirtualHost *:443>
       ServerName idlerpg.netirc.eu
       DocumentRoot /var/www/idlerpg/public

       SSLEngine on
       SSLCertificateFile /etc/letsencrypt/live/idlerpg.netirc.eu/fullchain.pem
       SSLCertificateKeyFile /etc/letsencrypt/live/idlerpg.netirc.eu/privkey.pem

       <Directory /var/www/idlerpg/public>
           AllowOverride All
           Require all granted
       </Directory>
   </VirtualHost>

   <VirtualHost *:80>
       ServerName idlerpg.netirc.eu
       Redirect permanent / https://idlerpg.netirc.eu/
   </VirtualHost>
   ```

---

## PHP website (generic hosting)

Same steps as above without a fixed hostname: DocumentRoot → **`public/`**, **`site.config.php`** `db_path` aligned with the bot, web user can read the database.

---

## Quick start — bot (summary)

1. Install **Node.js 20+** and **npm**.
2. In the project directory: `npm install`.
3. Copy **`.env.example`** to **`.env`** (optional: defaults are already NetIRC `chat.netirc.eu` port **6667**, channel **`#IdleRPG`**).
4. Start with **`npm start`** or **`./scripts/idlerpg.sh start`** (after `chmod +x scripts/idlerpg.sh`). Stop / restart: **`./scripts/idlerpg.sh stop`**, **`./scripts/idlerpg.sh restart`**. Log: **`data/bot.log`**. Foreground: **`./scripts/idlerpg.sh start -f`**.
5. With the script in the background, stop with **`./scripts/idlerpg.sh stop`**. Foreground: **Ctrl+C**.

The PHP site runs separately: after the bot has created **`data/idlerpg.db`**, set **`site.config.php`** `db_path` to that same file.

---

## What not to commit

- `.env`
- `site.config.php` (if it contains local-only paths you care about)
- `public/includes/local-root.php` (if you use path override)
- `data/*.db`

Example files **`.env.example`** and **`site.config.php.example`** are meant for GitHub and distribution.
