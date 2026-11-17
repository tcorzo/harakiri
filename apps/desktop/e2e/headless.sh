#!/usr/bin/env bash
# Runs the Playwright e2e inside a nested virtual KWin so no window reaches the user's desktop.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f out/main/index.js ]] || { echo "No built app in out/: run 'bun run build' first" >&2; exit 1; }

socket="harakiri-e2e-$$"
kwin_wayland --virtual --no-lockscreen --socket "$socket" --width 1920 --height 1080 >/dev/null 2>&1 &
kwin=$!
trap 'kill "$kwin" 2>/dev/null; wait "$kwin" 2>/dev/null || true' EXIT

for _ in $(seq 50); do
  [[ -S "$XDG_RUNTIME_DIR/$socket" ]] && break
  sleep 0.1
done
[[ -S "$XDG_RUNTIME_DIR/$socket" ]] || { echo "kwin_wayland did not create $socket" >&2; exit 1; }

WAYLAND_DISPLAY="$socket" bun x playwright test --workers=1 "$@"
