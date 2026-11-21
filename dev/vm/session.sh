#!/usr/bin/env bash
# Runs one command as the guest user in a fresh session: a D-Bus session bus, PipeWire, WirePlumber
# and pipewire-pulse, with fake-spdif as the default sink. Exits with the command's status.
# guest.sh exec runs it inside the guest: /workspace/dev/vm/session.sh <command...>
set -euo pipefail

export HOME=/var/lib/harakiri
export PATH=/opt/harakiri/bun/bin:/opt/harakiri/node/bin:/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin
# The guest has no udev, so SDL finds pads by scanning /dev/input.
export SDL_JOYSTICK_DISABLE_UDEV=1
# The guest's /tmp is in the VM's memory, not the host's.
XDG_RUNTIME_DIR="$(mktemp -d /tmp/harakiri-run.XXXXXX)"
export XDG_RUNTIME_DIR

exec dbus-run-session -- bash -c '
  set -uo pipefail
  log="$XDG_RUNTIME_DIR/audio.log"
  pipewire >>"$log" 2>&1 &
  wireplumber >>"$log" 2>&1 &
  pipewire-pulse >>"$log" 2>&1 &
  stop_audio() {
    kill $(jobs -p) 2>/dev/null
    wait
    rm -rf "$XDG_RUNTIME_DIR"
  }
  # set-default-sink answers "Not supported" until WirePlumber has created the default metadata, so
  # it is retried with the listing.
  ready=0
  for _ in $(seq 50); do
    if pactl list short sinks 2>/dev/null | grep -qw fake-spdif && pactl set-default-sink fake-spdif 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.1
  done
  if [ "$ready" = 0 ]; then
    echo "session.sh: PipeWire did not list the fake-spdif sink and make it the default within 5 s. Its log:" >&2
    cat "$log" >&2
    stop_audio
    exit 1
  fi
  "$@"
  status=$?
  stop_audio
  exit "$status"
' session "$@"
