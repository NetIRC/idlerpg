# Security

## Reporting

If you find a vulnerability, please open a **private** security advisory on GitHub (**Security → Advisories**) or contact the repository maintainers privately. Do not open a public issue for undisclosed security bugs.

## What this project expects you to protect

| Item | Why |
|------|-----|
| **`.env`** | IRC passwords, SASL, connect commands, optional API secrets. |
| **`site.config.php`** | Paths to the SQLite file on disk; `debug => true` can leak internals in JSON. |
| **`public/includes/local-root.php`** | May contain absolute paths on the server. |
| **`data/*.db`** | Full game database (players, hashes, meta). Keep **outside** the web root; restrict file permissions. |

Never commit the files above; they are listed in **`.gitignore`**.

**Committed templates** (no secrets): **`.env.example`** (names ↔ `src/config.ts`), **`site.config.php.example`** (keys ↔ `bootstrap.php`), **`local-root.php.example`**. Copy them to the real filenames locally; keep templates updated when you add env keys or PHP config fields.

## Surface area

- **PHP API** (`public/api/*.php`): read-only stats via prepared/fixed SQL; no password material in JSON by design.
- **`public/.htaccess`**: HTTPS redirect (except localhost), security headers, blocks `includes/`, blocks `php-diag` by default, denies common sensitive extensions under `public/`.
- **Bot**: connects as a normal IRC client; treat server credentials like any production secret.

## Hardening checklist (production)

1. TLS enabled for the site; `AllowOverride` so `.htaccess` applies (or replicate rules in Nginx).
2. `site.config.php`: `debug => false`.
3. SQLite file readable by the web user, **not** world-writable; bot user can write.
4. Re-enable **`/api/php-diag.php`** only briefly when debugging PHP extensions; block it again afterward (see `public/.htaccess`).
