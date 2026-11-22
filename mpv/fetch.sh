#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Downloads the five source tarballs that mpv/versions.env pins into <dest>, and checks each sha256.
# A file that is already there with the right sha256 is kept. usage: mpv/fetch.sh <dest>
set -euo pipefail
dest="${1:?usage: mpv/fetch.sh <dest>}"
# shellcheck source=versions.env
. "$(dirname "$0")/versions.env"
mkdir -p "$dest"

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

for name in MPV LIBPLACEBO FFMPEG SDL2 NV_CODEC_HEADERS; do
	url_var="${name}_URL" sha_var="${name}_SHA256"
	url="${!url_var}" want="${!sha_var}"
	file="$dest/$(basename "$url")"
	if [ -f "$file" ] && [ "$(sha256_of "$file")" = "$want" ]; then
		continue
	fi
	echo "fetching $url"
	curl -fsSL --retry 3 -o "$file.part" "$url"
	got="$(sha256_of "$file.part")"
	if [ "$got" != "$want" ]; then
		rm -f "$file.part"
		echo "$file: sha256 $got, expected $want" >&2
		exit 1
	fi
	mv "$file.part" "$file"
done
