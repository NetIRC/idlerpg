#!/usr/bin/env bash
# IdleRPG bot watchdog (Linux/macOS): restart on crash/admin restart, stop on admin shutdown.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/data/bot.log"
WLOG="$ROOT/data/bot-watchdog.log"
cd "$ROOT"

RESTART_DELAY_SEC="${IRPG_WATCHDOG_RESTART_DELAY_SEC:-2}"
MAX_BACKOFF_SEC="${IRPG_WATCHDOG_MAX_BACKOFF_SEC:-30}"

mkdir -p "$ROOT/data"

if [[ ! -f "$ROOT/package.json" ]]; then
  echo "error: package.json not found in $ROOT" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

if [[ -f "$ROOT/node_modules/tsx/dist/cli.mjs" ]]; then
  BOT_RUNNER=(node "$ROOT/node_modules/tsx/dist/cli.mjs")
elif [[ -f "$ROOT/node_modules/.bin/tsx" ]]; then
  BOT_RUNNER=("$ROOT/node_modules/.bin/tsx")
else
  echo "error: tsx not found under node_modules" >&2
  exit 1
fi

log_watchdog() {
  local msg="$1"
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $msg"
  echo "$line" | tee -a "$WLOG"
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  log_watchdog "starting bot (attempt $attempt)"
  set +e
  "${BOT_RUNNER[@]}" src/irc/bot.ts >>"$LOG" 2>&1
  code=$?
  set -e

  if [[ "$code" -eq 0 ]]; then
    log_watchdog "bot exited with code 0 (shutdown). watchdog stopping."
    exit 0
  fi

  delay=$((RESTART_DELAY_SEC + attempt / 3))
  if (( delay > MAX_BACKOFF_SEC )); then
    delay="$MAX_BACKOFF_SEC"
  fi
  log_watchdog "bot exited with code $code. restarting in ${delay}s..."
  sleep "$delay"
done
