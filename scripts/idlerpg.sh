#!/usr/bin/env bash
# IdleRPG bot — start | stop | restart (Linux / macOS). Repo root = parent of scripts/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/data/bot.log"
PIDFILE="$ROOT/data/bot.pid"
cd "$ROOT"

usage() {
  echo "usage: $(basename "$0") {start|stop|restart} [--foreground|-f]" >&2
  exit 1
}

ensure_deps() {
  if [[ ! -f package.json ]]; then
    echo "error: package.json not found (expected idlerpg repo root)" >&2
    exit 1
  fi
  if [[ ! -d node_modules ]]; then
    echo "Installing npm dependencies..."
    npm install
  fi
}

do_start() {
  local foreground=false
  for arg in "$@"; do
    case "$arg" in
      --foreground|-f) foreground=true ;;
    esac
  done

  ensure_deps

  local bot_runner=()
  if [[ -f "$ROOT/node_modules/tsx/dist/cli.mjs" ]]; then
    bot_runner=(node "$ROOT/node_modules/tsx/dist/cli.mjs")
  elif [[ -f "$ROOT/node_modules/.bin/tsx" ]]; then
    bot_runner=("$ROOT/node_modules/.bin/tsx")
  else
    echo "error: tsx not found under $ROOT/node_modules — run npm install" >&2
    exit 1
  fi

  if [[ "$foreground" == true ]]; then
    exec "${bot_runner[@]}" src/irc/bot.ts
  fi

  mkdir -p "$ROOT/data"
  if [[ -f "$PIDFILE" ]]; then
    local oldpid
    oldpid="$(<"$PIDFILE")"
    if kill -0 "$oldpid" 2>/dev/null; then
      echo "error: bot already running (pid $oldpid). Stop: $(basename "$0") stop" >&2
      exit 1
    fi
    rm -f "$PIDFILE"
  fi

  nohup "${bot_runner[@]}" src/irc/bot.ts >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 2
  if ! kill -0 "$(<"$PIDFILE")" 2>/dev/null; then
    echo "error: bot process exited right away — check $LOG (often: Zod .env parse, DB path, or IRC connect)." >&2
    rm -f "$PIDFILE"
    exit 1
  fi
  echo "idlerpg bot started in background (pid $(<"$PIDFILE")), log: $LOG"
}

stop_bot() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(<"$PIDFILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      local i
      for ((i = 0; i < 25; i++)); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PIDFILE"
  fi

  if [[ -d /proc ]]; then
    local pid cwd
    for pid in $(pgrep -f 'src/irc/bot.ts' 2>/dev/null || true); do
      cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      if [[ "$cwd" == "$ROOT" ]]; then
        kill "$pid" 2>/dev/null || true
        local j
        for ((j = 0; j < 15; j++)); do
          kill -0 "$pid" 2>/dev/null || break
          sleep 0.15
        done
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      fi
    done
  else
    pkill -f 'src/irc/bot.ts' 2>/dev/null || true
  fi
  echo "idlerpg bot stopped"
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage
shift

case "$cmd" in
  start) do_start "$@" ;;
  stop) stop_bot ;;
  restart)
    stop_bot || true
    sleep 1
    do_start "$@"
    ;;
  *) usage ;;
esac
