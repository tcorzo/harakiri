#!/usr/bin/env bash
# Starts or stops impeccable's live helper for the desktop renderer (mise run live, live:stop).
#
# While the helper runs, the dev server (mise run dev) puts impeccable's live widget into every page
# it serves, through apps/desktop/dev/impeccable-live.ts. Nothing is written into index.html.
#
# The helper ships with the impeccable Claude Code plugin; IMPECCABLE_BIN names another copy.
set -euo pipefail

app="$(cd "$(dirname "$0")/../apps/desktop" && pwd)"
server="$app/.impeccable/live/server.json"

bin="${IMPECCABLE_BIN:-}"
if [ -z "$bin" ]; then
  bin="$(find "$HOME/.claude/plugins/cache/impeccable" -path '*/skills/impeccable/scripts/impeccable' -type f 2>/dev/null | sort -V | tail -n 1)"
fi

if [ -z "$bin" ] || [ ! -x "$bin" ]; then
  echo "impeccable not found: install the impeccable Claude Code plugin, or set IMPECCABLE_BIN to its scripts/impeccable" >&2
  exit 1
fi

cd "$app"

case "${1:-}" in
  start)
    # The connection JSON carries the session token; keep it out of the terminal.
    "$bin" live-server --background >/dev/null
    port="$(bun -e "console.log(JSON.parse(await Bun.file('$server').text()).port)")"
    echo "impeccable live helper on port $port; the dev app shows its widget (mise run live:stop to end)"
    ;;
  stop)
    "$bin" live-server stop
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 2
    ;;
esac
