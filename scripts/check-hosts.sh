#!/usr/bin/env bash
# Runs the AppImage's shipped mpv bundle on the Bazzite image, in podman with no network. Arch is
# not checked by default: it ships only OpenSSL 4 (no libssl.so.3), and the owner targets Bazzite.
# Bazzite (Fedora 45) ships OpenSSL 4. libssl.so.3 comes from its openssl3-libs compat package,
# which nothing on the image requires: if an update drops it, mpv does not start, and this check
# shows it. The way out is in CLAUDE.md (curl against the host's GnuTLS).
# usage: HOST_IMAGES="<image> ..." scripts/check-hosts.sh [apps/desktop/dist/*.AppImage]
# The images are taken by tag on purpose: the check is about the hosts users run today.
set -euo pipefail
cd "$(dirname "$0")/.."

images="${HOST_IMAGES:-ghcr.io/ublue-os/bazzite:stable}"
appimage="$(realpath -- "${1:-apps/desktop/dist/harakiri-x86_64.AppImage}")"
[ -f "$appimage" ] || { echo "FAIL: $appimage not found, run mise run package" >&2; exit 1; }
command -v podman >/dev/null || { echo "FAIL: podman not found" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# A private copy, so the caller's file keeps its mode. --appimage-extract works without FUSE.
cp -- "$appimage" "$tmp/app.AppImage"
chmod +x "$tmp/app.AppImage"
(cd "$tmp" && ./app.AppImage --appimage-extract 'resources/mpv/*' >/dev/null)
bundle="$tmp/squashfs-root/resources/mpv"
[ -x "$bundle/mpv" ] || { echo "FAIL: $appimage carries no resources/mpv/mpv" >&2; exit 1; }

# Runs inside the image, with the bundle at /bundle (read-only). Prints one FAIL line per problem.
probe="$tmp/probe.sh"
cat >"$probe" <<'PROBE'
#!/bin/sh
# An ostree image's ld.so.cache can be stale; a running host rebuilds it.
ldconfig 2>/dev/null || true
fail=0
bad() { echo "FAIL: $1"; fail=1; }

# Every executable and library resolves, and every symbol version it needs exists.
for f in /bundle/mpv /bundle/lib/*.so*; do
	[ -f "$f" ] || continue
	out="$(ldd "$f" 2>&1)" || true
	if printf '%s\n' "$out" | grep 'not found' >/dev/null; then
		bad "ldd $f:"
		printf '%s\n' "$out" | grep 'not found' | sed 's/^/    /'
	fi
done

/bundle/mpv --no-config --version >/dev/null 2>/tmp/version.err || bad "mpv --version failed: $(cat /tmp/version.err)"

# curl is built with no CA path of its own: it must fall back to this image's OpenSSL defaults.
# Nothing is reachable over the network, so a TLS server with a throwaway self-signed certificate
# listens on this container's loopback. curl loads its trust store before the handshake, so the
# fallback line proves the image's OpenSSL supplied the store; the verification failure that
# follows (the certificate is self-signed) is expected. A bare connection to a closed port would
# fail before curl loads the store and prove nothing.
cd /tmp
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -subj /CN=127.0.0.1 \
	-days 1 >/dev/null 2>&1 || bad "openssl could not make a test certificate"
openssl s_server -accept 127.0.0.1:4433 -cert cert.pem -key key.pem -www >/dev/null 2>&1 &
server=$!
# Wait for the listener (up to 10 s) instead of a fixed sleep.
for _ in $(seq 100); do
	(exec 3<>/dev/tcp/127.0.0.1/4433) 2>/dev/null && break
	sleep 0.1
done
/bundle/mpv --no-config --msg-level=curl=trace https://127.0.0.1:4433/ >/tmp/curl.log 2>&1 </dev/null || true
kill "$server" 2>/dev/null || true
grep -F 'OpenSSL default paths (fallback)' /tmp/curl.log >/dev/null || bad "curl did not log 'OpenSSL default paths (fallback)'"
if grep -F 'error setting certificate' /tmp/curl.log >/dev/null; then
	bad "curl logged 'error setting certificate'"
fi

# The store the OpenSSL that libcurl loads points at holds certificates. The openssl CLI can be a
# different major version (Bazzite's is 4), so read OPENSSLDIR from the libcrypto.so.3 that ldd
# resolves for the bundle's libcurl; the string is compiled into the library.
libcrypto="$(ldd /bundle/lib/libcurl.so.4 2>/dev/null | awk '$1 == "libcrypto.so.3" { print $3 }')"
dir=""
[ -n "$libcrypto" ] && dir="$(grep -a -o 'OPENSSLDIR: "[^"]*"' "$libcrypto" | head -n 1 | sed 's/^OPENSSLDIR: "\(.*\)"$/\1/')"
if [ -z "$dir" ]; then
	bad "no OPENSSLDIR in the libcrypto.so.3 that libcurl loads ($libcrypto)"
elif [ -n "$(find -L "$dir/certs" -type f -size +0c 2>/dev/null | head -n 1)" ] ||
	[ -s "$dir/cert.pem" ]; then
	:
else
	bad "the trust store under $dir (certs/ or cert.pem) is empty"
fi
exit "$fail"
PROBE
chmod +x "$probe"

status=0
for image in $images; do
	echo "== $image"
	if out="$(podman run --rm --memory 1g --network none \
		-v "$bundle:/bundle:ro,Z" -v "$probe:/probe.sh:ro,Z" \
		"$image" /bin/sh /probe.sh 2>&1)"; then
		echo "ok: $image"
	else
		echo "FAIL: $image"
		printf '%s\n' "$out" | sed 's/^/  /'
		status=1
	fi
done
exit "$status"
