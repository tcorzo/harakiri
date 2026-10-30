#!/usr/bin/env bash
# Prints a line when harakiri's memory state changes, not on every poll.
# Under low headroom or memory pressure it acts only when harakiri is a real share of the
# problem: it SIGKILLs the largest scope in harakiri.slice (never anything outside it), or
# restarts the dev Jellyfin container when that is the larger consumer, then backs off.
set -uo pipefail
interval="${WATCHDOG_INTERVAL:-15}"
floor_mb="${WATCHDOG_FLOOR_MB:-1500}"
psi_limit="${WATCHDOG_PSI_FULL:-25}"
min_share_mb="${WATCHDOG_MIN_SHARE_MB:-1024}"
backoff="${WATCHDOG_BACKOFF:-60}"
# The dev Jellyfin runs as harakiri-jellyfin (own library) or harakiri-jellyfin-corpus.
container="${WATCHDOG_CONTAINER:-}"
cg="/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/harakiri.slice"

read_mb() {
	local bytes
	bytes=$(cat "$1" 2>/dev/null) || return 1
	[[ $bytes =~ ^[0-9]+$ ]] || return 1
	echo $((bytes / 1048576))
}

running_container() {
	if [ -n "$container" ]; then echo "$container"; return; fi
	podman ps --filter name='^harakiri-jellyfin' --format '{{.Names}}' 2>/dev/null | head -n1
}

container_mb() {
	local name="$1"
	[ -n "$name" ] || return 0
	podman stats --no-stream --format '{{.MemUsage}}' "$name" 2>/dev/null |
		awk '{v=$1; u=v; gsub(/[0-9.]/,"",u); gsub(/[A-Za-z]/,"",v); f["kB"]=1/1024; f["KiB"]=1/1024; f["MB"]=1; f["MiB"]=1; f["GB"]=1024; f["GiB"]=1024; f["B"]=1/1048576; print int(v*((u in f)?f[u]:1))}'
}

[ -r /proc/pressure/memory ] || { echo "WATCHDOG CANNOT RUN: /proc/pressure/memory is unreadable (PSI disabled)"; exit 1; }
last_state="ok"
quiet_until=0
while true; do
	avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
	psi=$(awk '/^full/ {split($2,a,"="); print int(a[2])}' /proc/pressure/memory)
	slice_mb=$(read_mb "$cg/memory.current") || slice_mb=0
	jf_name=$(running_container)
	jf_mb=$(container_mb "$jf_name")
	[[ ${jf_mb:-} =~ ^[0-9]+$ ]] || jf_mb=0
	summary="avail=${avail_mb}MB psi_full=${psi} slice=${slice_mb}MB jellyfin=${jf_mb}MB"
	now=$(date +%s)

	if [ "$avail_mb" -lt "$floor_mb" ] || [ "$psi" -ge "$psi_limit" ]; then
		top=""
		top_mb=0
		for scope in "$cg"/*.scope; do
			mb=$(read_mb "$scope/memory.current") || continue
			if [ "$mb" -gt "$top_mb" ]; then top_mb=$mb; top=$(basename "$scope"); fi
		done
		if [ "$now" -lt "$quiet_until" ]; then
			:
		elif [ -n "$top" ] && [ "$top_mb" -ge "$min_share_mb" ] && [ "$top_mb" -ge "$jf_mb" ]; then
			systemctl --user kill --signal=SIGKILL "$top" 2>/dev/null
			echo "WATCHDOG KILLED $top (${top_mb}MB) $summary"
			last_state="acted"
			quiet_until=$((now + backoff))
		elif [ "$jf_mb" -ge "$min_share_mb" ]; then
			podman restart --time 5 "$jf_name" >/dev/null 2>&1 &
			echo "WATCHDOG RESTARTED $jf_name (${jf_mb}MB) $summary"
			last_state="acted"
			quiet_until=$((now + backoff))
		elif [ "$last_state" = "ok" ]; then
			echo "WATCHDOG ALERT pressure from outside harakiri $summary"
			last_state="alert"
		fi
	else
		[ "$last_state" != "ok" ] && echo "WATCHDOG RECOVERED $summary"
		[ "${WATCHDOG_VERBOSE:-0}" = 1 ] && echo "ok $summary"
		last_state="ok"
	fi
	sleep "$interval"
done
