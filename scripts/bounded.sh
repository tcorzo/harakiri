#!/usr/bin/env bash
# Runs a command in its own scope under harakiri.slice so the kernel enforces a memory cap.
# usage: scripts/bounded.sh <name> <memory-max> -- <command...>
set -euo pipefail
name="$1" max="$2"
shift 2
[ "${1:-}" = "--" ] && shift
if ! command -v systemd-run >/dev/null || ! systemctl --user show-environment >/dev/null 2>&1; then
	echo "bounded.sh: no systemd user manager here, running $name without a memory cap" >&2
	exec "$@"
fi
slice_max="${HARAKIRI_SLICE_MAX:-7G}"
slice_high="${HARAKIRI_SLICE_HIGH:-6G}"
systemctl --user set-property --runtime harakiri.slice "MemoryMax=$slice_max" "MemoryHigh=$slice_high" MemorySwapMax=0 >/dev/null 2>&1 || true
exec systemd-run --user --scope --quiet --collect \
	--slice=harakiri.slice \
	--unit="harakiri-$name-$$" \
	-p "MemoryMax=$max" -p MemorySwapMax=0 -p CPUWeight=50 \
	-- "$@"
