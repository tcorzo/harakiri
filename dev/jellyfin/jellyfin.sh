#!/usr/bin/env bash
# Local Jellyfin dev server for harakiri. Rootless podman, idempotent.
# Usage: dev/jellyfin/jellyfin.sh up|down|reset|status|logs
#
# One setting picks the library, JELLYFIN_DEV_LIBRARY (mise loads it from the gitignored .env):
#   corpus (default)  the generated synthetic corpus in .cache/corpus (mise run media:gen)
#   own               your own library: JELLYFIN_DEV_MOVIES and JELLYFIN_DEV_SERIES must be set
# Each library has its own container and state dir, so switching never rescans either one.
# Only one runs at a time: they share the port. `up` stops the other one first.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# Digest-pinned; the same manifest is published on ghcr.io and docker.io. Override the
# registry (a mirror, say) with JELLYFIN_IMAGE, keeping the digest.
DIGEST=sha256:7da5184caa38c553f219f6772476540081f392a68049e2b68c923f6daf877f8e
IMAGE="${JELLYFIN_IMAGE:-ghcr.io/jellyfin/jellyfin:12.4@$DIGEST}"
PORT="${JELLYFIN_DEV_PORT:-8096}"
DISCOVERY_PORT="${JELLYFIN_DEV_DISCOVERY_PORT:-7359}"
# Any loopback address works: the e2e server answers discovery on 127.0.0.3:7359, beside a dev
# server on 127.0.0.1:7359.
DISCOVERY_ADDRESS="${JELLYFIN_DEV_DISCOVERY_ADDRESS:-127.0.0.1}"
MEMORY="${JELLYFIN_DEV_MEMORY:-3g}"
LIBRARY="${JELLYFIN_DEV_LIBRARY:-corpus}"
CORPUS="${HARAKIRI_CORPUS_DIR:-$REPO/.cache/corpus}"

case "$LIBRARY" in
  corpus)
    MOVIES="$CORPUS/movies"
    SERIES="$CORPUS/shows"
    DEFAULT_NAME=harakiri-jellyfin-corpus
    DEFAULT_STATE="$HERE/.state-corpus"
    OTHER_NAME=harakiri-jellyfin
    ;;
  own)
    MOVIES="${JELLYFIN_DEV_MOVIES:?JELLYFIN_DEV_LIBRARY=own needs JELLYFIN_DEV_MOVIES (set it in .env)}"
    SERIES="${JELLYFIN_DEV_SERIES:?JELLYFIN_DEV_LIBRARY=own needs JELLYFIN_DEV_SERIES (set it in .env)}"
    # The names the own-library server always had, so an existing scan is reused.
    DEFAULT_NAME=harakiri-jellyfin
    DEFAULT_STATE="$HERE/.state"
    OTHER_NAME=harakiri-jellyfin-corpus
    ;;
  *) echo "JELLYFIN_DEV_LIBRARY must be corpus or own, not '$LIBRARY'" >&2; exit 2 ;;
esac
NAME="${JELLYFIN_DEV_NAME:-$DEFAULT_NAME}"
STATE="${JELLYFIN_DEV_STATE:-$DEFAULT_STATE}"

exists() { podman container exists "$1"; }
running() { [ "$(podman container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }

up() {
  # The other library's server holds the same port; stop it (its state stays).
  if [ -z "${JELLYFIN_DEV_NAME:-}" ] && running "$OTHER_NAME"; then
    podman stop -t 20 "$OTHER_NAME" >/dev/null
    echo "$OTHER_NAME stopped (its state is kept)"
  fi
  if running "$NAME"; then echo "$NAME already running on 127.0.0.1:$PORT ($LIBRARY library)"; return; fi
  if exists "$NAME"; then podman start "$NAME" >/dev/null; echo "$NAME started on 127.0.0.1:$PORT ($LIBRARY library)"; return; fi
  for d in "$MOVIES" "$SERIES"; do
    if [ ! -d "$d" ]; then
      if [ "$LIBRARY" = corpus ]; then
        echo "media dir missing: $d (generate it with: mise run media:gen)" >&2
      else
        echo "media dir missing: $d (check JELLYFIN_DEV_MOVIES / JELLYFIN_DEV_SERIES)" >&2
      fi
      exit 1
    fi
  done
  mkdir -p "$STATE/config" "$STATE/cache"
  # label=disable: an own library may be a CIFS or NFS mount, where relabeling (:z) is wrong.
  # Media is mounted read-only. Rootless: container root maps to the invoking host user.
  podman run -d --name "$NAME" \
    --security-opt label=disable \
    --memory "$MEMORY" --memory-swap "$MEMORY" \
    -p "127.0.0.1:$PORT:8096" \
    -p "${DISCOVERY_ADDRESS}:${DISCOVERY_PORT}:7359/udp" \
    -v "$STATE/config:/config" \
    -v "$STATE/cache:/cache" \
    -v "$MOVIES:/media/movies:ro" \
    -v "$SERIES:/media/series:ro" \
    -e JELLYFIN_PublishedServerUrl="http://127.0.0.1:$PORT" \
    "$IMAGE" >/dev/null
  echo "$NAME created on 127.0.0.1:$PORT ($LIBRARY library, state in $STATE)"
}

down() { if exists "$NAME"; then podman stop -t 20 "$NAME" >/dev/null && podman rm "$NAME" >/dev/null; fi; echo "$NAME removed (state kept in $STATE)"; }

reset() {
  down
  # Files under the state dir may be owned by subuids; remove them inside the user namespace.
  if [ -d "$STATE" ]; then podman unshare rm -rf "$STATE"; fi
  echo "state wiped: $STATE"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  reset) reset ;;
  status) podman ps -a --filter "name=^$NAME\$" --format '{{.Names}} {{.Status}} {{.Ports}}' ;;
  logs) podman logs --tail "${2:-100}" "$NAME" ;;
  *) echo "usage: $0 up|down|reset|status|logs" >&2; exit 2 ;;
esac
