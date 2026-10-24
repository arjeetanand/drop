#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
PORT=4004
NEXT_BIN="$ROOT/node_modules/next/dist/bin/next"
LOG_FILE="${TMPDIR:-/tmp}/drop-4004.log"

listening_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

process_executable() {
  lsof -a -p "$1" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

is_drop_server() {
  local pid="$1"
  local cwd executable
  cwd="$(process_cwd "$pid")"
  executable="$(process_executable "$pid")"
  [[ "$cwd" == "$ROOT" && "$executable" == */node ]]
}

stop_existing() {
  local pids pid
  pids="$(listening_pids)"
  [[ -n "$pids" ]] || return 0

  while IFS= read -r pid; do
    if ! is_drop_server "$pid"; then
      echo "Port $PORT is held by PID $pid outside this Drop project; leaving it alone." >&2
      return 1
    fi
  done <<< "$pids"

  while IFS= read -r pid; do
    kill -TERM "$pid"
  done <<< "$pids"

  for _ in {1..30}; do
    pids="$(listening_pids)"
    [[ -z "$pids" ]] && return 0
    sleep 1
  done

  echo "Drop did not release port $PORT after a graceful stop. Check $LOG_FILE." >&2
  return 1
}

case "${1:-restart}" in
  stop)
    stop_existing
    echo "Drop stopped on port $PORT."
    exit 0
    ;;
  restart|start)
    stop_existing
    ;;
  *)
    echo "Usage: ./run.sh [restart|start|stop]" >&2
    exit 2
    ;;
esac

if [[ ! -f "$NEXT_BIN" ]]; then
  echo "Drop dependencies are missing. Install the locked dependencies with npm ci, then run ./run.sh." >&2
  exit 1
fi

echo "Starting Drop on http://localhost:$PORT"
echo "Server output: $LOG_FILE"
WATCHPACK_POLLING=true npm run dev -- --hostname 127.0.0.1 --port "$PORT" >"$LOG_FILE" 2>&1
