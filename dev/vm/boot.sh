#!/usr/bin/env bash
# The guest's per-boot root step. guest.sh runs it once after it starts the guest, and running it
# twice changes nothing. It gives the guest a /dev/uinput and a /dev/input that shows the nodes
# uinput creates (the guest's own devtmpfs does not), as research 13.4 check 3 found.
set -euo pipefail

[ -e /dev/uinput ] || mknod -m 0600 /dev/uinput c 10 223
mountpoint -q /run/harakiri/dev || {
  mkdir -p /run/harakiri/dev
  mount -t devtmpfs devtmpfs /run/harakiri/dev
}
ln -sfn /run/harakiri/dev/input /dev/input
