#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds harakiri-mpv-source.tar, the corresponding source of an mpv bundle (GPLv3 §1 and §6(d)):
# this recipe, each source tarball it pins, and the Fedora 44 source RPM of each library the bundle
# copies out of an RPM. Then it checks the tar, and fails naming each missing file or wrong sha256.
# `mise run mpv:source` runs it on the current recipe's bundle. A source RPM that is not in
# .cache/mpv-source/srpms yet is downloaded in BASE_IMAGE from the source of the frozen release
# repo the build installed from, which needs podman and the network.
#   mpv/source.sh <bundle-dir> <out.tar>          build <out.tar>, then check it
#   mpv/source.sh --check <bundle-dir> <tar>      check <tar> only
set -euo pipefail
recipe="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$recipe")"
cli="$root/packages/mpv/src/source-cli.ts"
cache="$root/.cache/mpv-source"
top=harakiri-mpv-source
tab=$'\t'
cleanup=()
trap 'rm -rf "${cleanup[@]}"' EXIT

usage() {
	echo "usage: mpv/source.sh <bundle-dir> <out.tar> | mpv/source.sh --check <bundle-dir> <tar>" >&2
	exit 2
}

# "<file>\t<sha256>\t<url>" for each tarball <versions.env> pins, under the name fetch.sh saves it as
pins() {
	(
		# shellcheck source=versions.env
		. "$1"
		for name in $(sed -n 's/^\([A-Z0-9_]*\)_URL=.*/\1/p' "$1"); do
			url_var="${name}_URL" sha_var="${name}_SHA256" file_var="${name}_FILE"
			printf '%s\t%s\t%s\n' "${!file_var:-$(basename "${!url_var}")}" "${!sha_var}" "${!url_var}"
		done
	)
}

# Field <n> of each line of <sources> (source-cli.ts sources) whose kind is <kind>
sources_of() { awk -F'\t' -v kind="$2" -v n="$3" '$1 == kind { print $n }' <<<"$1"; }

# Checks <tar> against <bundle-dir>, with one line per problem that starts with [name] (the tar's
# file name by default). The tar holds harakiri-mpv-source/ alone, with: README, and the bundle's
# own SOURCES.txt and BUILDING.txt; recipe/, whose recipe hash is the bundle's name; one file in
# upstream/ per pin in recipe/versions.env, with its sha256, and those pins are the bundle's
# upstream components; one source RPM in srpms/ per srpm component, and nothing else.
# usage: check <bundle-dir> <tar> [name]
check() {
	local bundle="$1" tar="$2" name="${3:-$(basename "$2")}" dir src failed=0 file got want_hash
	local got_hash sources pinned
	fail() {
		echo "$name: $*" >&2
		failed=1
	}
	mkdir -p "$cache"
	dir="$(mktemp -d "$cache/check.XXXXXX")"
	cleanup+=("$dir")
	tar -xf "$tar" -C "$dir"
	src="$dir/$top"

	[ "$(ls -A "$dir")" = "$top" ] || fail "holds $(ls -A "$dir" | tr '\n' ' ')instead of $top/ alone"
	for file in README SOURCES.txt BUILDING.txt recipe/versions.env; do
		[ -s "$src/$file" ] || fail "$top/$file: missing or empty"
	done
	for file in SOURCES.txt BUILDING.txt; do
		[ ! -s "$src/$file" ] || cmp -s "$src/$file" "$bundle/$file" ||
			fail "$top/$file: differs from the bundle's"
	done

	want_hash="$(basename "$bundle")"
	got_hash=none
	if [ -d "$src/recipe" ]; then
		got_hash="$(bun "$cli" recipe-hash "$src/recipe")"
		[ "$got_hash" = "$want_hash" ] ||
			fail "$top/recipe/: recipe hash $got_hash, but recipe $want_hash built the bundle"
	else
		fail "$top/recipe/: missing"
	fi

	sources="$(bun "$cli" sources "$bundle")"
	pinned=""
	if [ -s "$src/recipe/versions.env" ]; then
		pinned="$(pins "$src/recipe/versions.env")"
	fi
	while IFS="$tab" read -r file sha url; do
		[ -n "$file" ] || continue
		if [ ! -f "$src/upstream/$file" ]; then
			fail "$top/upstream/$file: missing ($url)"
		else
			got="$(sha256sum "$src/upstream/$file" | cut -d' ' -f1)"
			[ "$got" = "$sha" ] || fail "$top/upstream/$file: sha256 $got, expected $sha"
		fi
		grep -qxF "upstream$tab$url$tab$sha" <<<"$sources" ||
			fail "$url: pinned in recipe/versions.env, but not an upstream component of the bundle"
	done <<<"$pinned"
	while IFS="$tab" read -r url sha; do
		[ -n "$url" ] || continue
		awk -F'\t' -v sha="$sha" -v url="$url" '$2 == sha && $3 == url { found = 1 } END { exit !found }' <<<"$pinned" ||
			fail "$url: an upstream component of the bundle, but recipe/versions.env pins no such tarball with sha256 $sha"
	done < <(awk -F'\t' '$1 == "upstream" { print $2 "\t" $3 }' <<<"$sources")
	for file in "$src"/upstream/*; do
		[ -e "$file" ] || continue
		cut -f1 <<<"$pinned" | grep -qxF "$(basename "$file")" ||
			fail "$top/upstream/$(basename "$file"): recipe/versions.env pins no such tarball"
	done

	while read -r file; do
		[ -n "$file" ] || continue
		if [ ! -s "$src/srpms/$file" ]; then
			fail "$top/srpms/$file: missing"
		# An RPM lead: its magic, the format version, then the package type, 1 for a source package
		elif [[ "$(od -An -tx1 -N8 "$src/srpms/$file" | tr -d ' \n')" != edabeedb????0001 ]]; then
			fail "$top/srpms/$file: not a source RPM"
		fi
	done < <(sources_of "$sources" srpm 2)
	for file in "$src"/srpms/*; do
		[ -e "$file" ] || continue
		sources_of "$sources" srpm 2 | grep -qxF "$(basename "$file")" ||
			fail "$top/srpms/$(basename "$file"): no component of the bundle comes from it"
	done

	[ "$failed" = 0 ] || return 1
	echo "$name: ok, recipe $got_hash, $(ls "$src/upstream" | wc -l) upstream tarballs, $(ls "$src/srpms" | wc -l) source RPMs"
}

# Downloads each source RPM in $@ that .cache/mpv-source/srpms lacks, checks Fedora's signature on
# it, and deletes every other file there.
fetch_srpms() {
	local missing=() keep base_image file
	mkdir -p "$cache/srpms"
	for file in "$@"; do
		[ -s "$cache/srpms/$file" ] || missing+=("${file%.src.rpm}")
	done
	if [ "${#missing[@]}" -gt 0 ]; then
		command -v podman >/dev/null || {
			echo 'mpv/source.sh needs podman to download source RPMs (dnf install podman)' >&2
			exit 1
		}
		base_image="$(sed -n 's/^BASE_IMAGE=//p' "$recipe/versions.env")"
		rm -rf "$cache/srpms.partial"
		mkdir -p "$cache/srpms.partial"
		cleanup+=("$cache/srpms.partial")
		# fedora-source is the source of `fedora`, the frozen release repo the build installs from
		podman run --rm --memory 1g --memory-swap 1g -v "$cache/srpms.partial:/out:Z" "$base_image" sh -euc '
			dnf -q -y download --source --disablerepo="*" --enablerepo=fedora-source --destdir /out "$@"
			rpmkeys --import /etc/pki/rpm-gpg/RPM-GPG-KEY-fedora-44-primary
			for file in /out/*.src.rpm; do
				rpm -K "$file" | grep -q ": digests signatures OK$" || { rpm -K "$file" >&2; exit 1; }
			done' sh "${missing[@]}"
		mv "$cache/srpms.partial"/*.src.rpm "$cache/srpms/"
	fi
	keep="$(printf '%s\n' "$@")"
	for file in "$cache/srpms"/*; do
		[ -e "$file" ] || continue
		grep -qxF "$(basename "$file")" <<<"$keep" || rm -f "$file"
	done
}

build() {
	local bundle="$1" out="$2" stage="$cache/stage" sources epoch file srpms
	[ -f "$bundle/manifest.json" ] || {
		echo "$bundle/manifest.json: missing; mise run mpv:build builds the bundle" >&2
		exit 1
	}
	rm -f "$out" "$out.partial"
	sources="$(bun "$cli" sources "$bundle")"
	srpms="$(sources_of "$sources" srpm 2 | sort -u)"
	"$recipe/fetch.sh" "$root/.cache/mpv/src"
	# shellcheck disable=SC2086 # one word per file name: a source RPM's name has no space
	fetch_srpms $srpms

	rm -rf "$stage"
	cleanup+=("$stage" "$out.partial")
	mkdir -p "$stage/$top/upstream" "$stage/$top/srpms"
	cp "$recipe/source-README.txt" "$stage/$top/README"
	cp "$bundle/SOURCES.txt" "$bundle/BUILDING.txt" "$stage/$top/"
	cp -a "$recipe" "$stage/$top/recipe"
	while IFS="$tab" read -r file _; do
		cp --reflink=auto "$root/.cache/mpv/src/$file" "$stage/$top/upstream/"
	done < <(pins "$recipe/versions.env")
	for file in $srpms; do
		cp --reflink=auto "$cache/srpms/$file" "$stage/$top/srpms/"
	done

	# The same bytes from the same commit and sources
	epoch="${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct)}"
	mkdir -p "$(dirname "$out")"
	tar --sort=name --owner=0 --group=0 --numeric-owner --mode=go-w --mtime="@$epoch" \
		-cf "$out.partial" -C "$stage" "$top"
	check "$bundle" "$out.partial" "$(basename "$out")"
	mv "$out.partial" "$out"
}

case "${1:-}" in
--check)
	[ "$#" = 3 ] || usage
	check "$(cd "$2" && pwd)" "$3"
	;;
-* | '') usage ;;
*)
	[ "$#" = 2 ] || usage
	build "$(cd "$1" && pwd)" "$2"
	;;
esac
