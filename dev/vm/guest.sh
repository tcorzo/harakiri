#!/usr/bin/env bash
# The dev/vm guest: a Fedora 44 smolvm microVM that runs platform checks and e2e off the developer's
# desktop. This script is the only entry point to it.
# Usage: dev/vm/guest.sh up | down | exec [--cwd <repo-relative dir>] -- <command...>
#
#   up    downloads smolvm when it is missing, recreates and provisions the guest when the recipe
#         changed, and starts it.
#   down  stops the guest and keeps its provisioned disk.
#   exec  runs <command> as the guest user (the host's uid and gid) in /workspace/<dir>, through
#         dev/vm/session.sh, and exits with its status. A guest that exec started, exec stops.
#
# Each checkout has its own guest: the state lives in <repo>/.cache/vm, and the machine and its
# systemd scope are named after a hash of the checkout's path.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
# shellcheck source-path=SCRIPTDIR source=versions.env
. "$HERE/versions.env"

die() {
  echo "guest.sh: $*" >&2
  exit 1
}

usage() { die "usage: dev/vm/guest.sh up | down | exec [--cwd <repo-relative dir>] -- <command...>"; }

KVM="${HARAKIRI_KVM_DEVICE:-/dev/kvm}"
[ -r "$KVM" ] && [ -w "$KVM" ] || die "$KVM is missing or not read-write for this user. The guest needs KVM: add yourself to the kvm group, or on a GitHub runner install the udev rule that makes /dev/kvm 0666."

BUN_DIR="$(cd "$REPO" && mise where bun)"
NODE_DIR="$(cd "$REPO" && mise where node)"
# The checkout id, which also names this checkout's e2e Jellyfin (packages/harness/src/checkout.ts).
ID="$("$BUN_DIR/bin/bun" "$REPO/packages/harness/src/checkout-cli.ts" id)"
NAME="harakiri-guest-$ID"
SCOPE="vm-$ID"
STATE="$REPO/.cache/vm"
SMOLVM="$STATE/smolvm-$SMOLVM_VERSION-linux-x86_64/smolvm"

sv() { "$SMOLVM" --state-dir "$STATE" "$@"; }

fetch() {
  [ -x "$SMOLVM" ] && return
  local tarball="$STATE/smolvm-$SMOLVM_VERSION-linux-x86_64.tar.gz"
  mkdir -p "$STATE"
  echo "guest.sh: downloading smolvm $SMOLVM_VERSION into $STATE" >&2
  curl -fL --proto '=https' -o "$tarball" \
    "https://github.com/smol-machines/smolvm/releases/download/v$SMOLVM_VERSION/smolvm-$SMOLVM_VERSION-linux-x86_64.tar.gz"
  if ! echo "$SMOLVM_SHA256  $tarball" | sha256sum -c --quiet -; then
    rm -f "$tarball"
    die "the smolvm $SMOLVM_VERSION tarball does not match SMOLVM_SHA256 in dev/vm/versions.env"
  fi
  tar -xzf "$tarball" -C "$STATE"
  rm -f "$tarball"
}

# Everything the provisioned disk depends on. A change to any of it recreates the guest.
# session.sh is not part of it: every exec runs it from the mounted repo.
recipe() {
  {
    (cd "$HERE" && sha256sum versions.env Smolfile provision.sh asoundrc pipewire/fake-spdif.conf)
    printf '%s\n' "$REPO" "$BUN_DIR" "$NODE_DIR" "$(id -u):$(id -g)"
  } | sha256sum | cut -d' ' -f1
}

running() { sv machine exec --name "$NAME" --timeout 5s -- true >/dev/null 2>&1; }

# The guest reaches the host's loopback over TCP only with this grant, which machine create rejects.
start() {
  SMOLVM_ALLOW_HOST_LOOPBACK=1 "$REPO/scripts/bounded.sh" "$SCOPE" 3G -- \
    "$SMOLVM" --state-dir "$STATE" machine start --name "$NAME" 9>&-
}

up() {
  fetch
  local want started=0
  want="$(recipe)"
  if [ "$(cat "$STATE/provisioned" 2>/dev/null)" != "$want" ]; then
    echo "guest.sh: recipe changed; recreating the guest"
    rm -f "$STATE/provisioned"
    sv machine delete --name "$NAME" --force >/dev/null 2>&1 || true
    sv machine create --name "$NAME" --smolfile "$HERE/Smolfile" --image "$GUEST_IMAGE" \
      -v "$REPO:/workspace" -v "$BUN_DIR:/opt/harakiri/bun:ro" -v "$NODE_DIR:/opt/harakiri/node:ro"
    start
    if ! sv machine exec --name "$NAME" --stream -e "HOST_UID=$(id -u)" -e "HOST_GID=$(id -g)" -- \
      bash /workspace/dev/vm/provision.sh; then
      down
      die "provisioning failed; the guest is stopped, and the next up recreates it"
    fi
    echo "$want" >"$STATE/provisioned"
    started=1
  elif ! running; then
    start
    started=1
  fi
  if [ "$started" = 1 ]; then
    # Once per boot: this call started the guest, fresh or already provisioned, and it is
    # provisioned now (the pad daemon needs python3-evdev). Root steps that every boot needs go here.
    sv machine exec --name "$NAME" -- bash /workspace/dev/vm/boot.sh
    sv machine exec --name "$NAME" -- test -S /run/harakiri/pad.sock ||
      sv machine exec --name "$NAME" -d -- python3 /workspace/dev/vm/pad.py serve /run/harakiri/pad.sock
  fi
}

# Without smolvm, or when its stop fails, stopping this checkout's scope stops the VM.
down() {
  [ -x "$SMOLVM" ] && sv machine stop --name "$NAME" && return
  systemctl --user stop "harakiri-$SCOPE-*.scope"
}

# A host directory that a guest command reads by path must be inside the mounted repo. Prints the
# path the guest sees.
guest_path() {
  local var="$1" abs
  [ -n "${!var}" ] || die "$var is set but empty. Unset it, or point it at a directory inside this checkout."
  abs="$(realpath -m -- "${!var}")"
  case "$abs" in
    "$REPO") echo /workspace ;;
    "$REPO"/*) echo "/workspace/${abs#"$REPO"/}" ;;
    *) die "$var=${!var} is outside this checkout, and the guest sees only the checkout (at /workspace). Put it under the repo, or unset it." ;;
  esac
}

cmd_exec() {
  local cwd=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --cwd)
        [ $# -ge 2 ] || usage
        cwd="$2"
        shift 2
        ;;
      --)
        shift
        break
        ;;
      *) usage ;;
    esac
  done
  [ $# -gt 0 ] || usage
  case "$cwd" in
    /* | .. | ../* | */.. | */../*) die "--cwd takes a directory inside the repo, relative to its root: $cwd" ;;
  esac
  [ -d "$REPO/$cwd" ] || die "--cwd $cwd is not a directory in the repo"

  # The repo is /workspace in the guest, so the guest learns which e2e Jellyfin is this
  # checkout's from the host's checkout id.
  local pass=(-e "HARAKIRI_CHECKOUT_ID=$ID") var
  for var in CI HARAKIRI_E2E_SERVER HARAKIRI_E2E_USER HARAKIRI_E2E_DISCOVERY_ADDRESS HARAKIRI_E2E_PORT; do
    [ -n "${!var+set}" ] && pass+=(-e "$var=${!var}")
  done
  for var in HARAKIRI_CORPUS_DIR HARAKIRI_FATE_DIR; do
    [ -n "${!var+set}" ] && pass+=(-e "$var=$(guest_path "$var")")
  done
  # smolvm reads a secret from its own environment, so it never appears in an argv.
  for var in HARAKIRI_E2E_PASSWORD JELLYFIN_DEV_PASSWORD; do
    [ -n "${!var+set}" ] && pass+=(--secret-env "$var=$var")
  done

  # One exec at a time per checkout: a second one would share the guest, and the first to finish
  # would stop it under the other. The guest's own processes do not inherit the lock (start closes
  # fd 9), so a guest left running after a killed exec does not hold it.
  mkdir -p "$STATE"
  exec 9>"$STATE/lock"
  flock -n 9 || die "this checkout's guest is busy with another exec. Wait for it to finish; if none is running, $STATE/lock is held by a leftover process (fuser -v $STATE/lock)."

  # A signal stops the command and, through the EXIT trap, the guest this exec started. The command
  # runs in the background so that the traps run at once instead of after it ends. Background jobs
  # ignore SIGINT in a non-interactive shell, so the command gets SIGTERM for both.
  local child="" status=0
  trap '[ -z "$child" ] || kill -TERM "$child" 2>/dev/null; exit 130' INT
  trap '[ -z "$child" ] || kill -TERM "$child" 2>/dev/null; exit 143' TERM
  if ! running; then
    trap 'down >&2' EXIT
  fi
  # Always: a changed recipe recreates even a running guest.
  up >&2

  # <&0: a background job's stdin would otherwise be /dev/null.
  sv machine exec --name "$NAME" --stream --user "$(id -u):$(id -g)" -w "/workspace${cwd:+/$cwd}" \
    "${pass[@]}" -- /workspace/dev/vm/session.sh "$@" <&0 &
  child=$!
  wait "$child" || status=$?
  exit "$status"
}

case "${1:-}" in
  up)
    [ $# -eq 1 ] || usage
    up
    ;;
  down)
    [ $# -eq 1 ] || usage
    down
    ;;
  exec)
    shift
    cmd_exec "$@"
    ;;
  *) usage ;;
esac
