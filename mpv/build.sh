#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds harakiri's mpv inside mpv/Containerfile's build stage, and assembles the bundle in /out:
# mpv, lib/ (every library mpv needs that mpv/host-libs.txt does not leave to the host) and
# manifest.json. The source tarballs are bind-mounted read-only at /src (mpv/fetch.sh).
set -euo pipefail

prefix=/opt/harakiri
jobs="${JOBS:?JOBS is not set}"
export PKG_CONFIG_PATH="$prefix/lib64/pkgconfig:$prefix/lib/pkgconfig"
export LD_LIBRARY_PATH="$prefix/lib64:$prefix/lib"
set -a # manifest.json reads the versions from the environment
# shellcheck source=versions.env
. /recipe/versions.env
set +a

mkdir -p /build
for url in "$NV_CODEC_HEADERS_URL" "$SDL2_URL" "$FFMPEG_URL" "$LIBPLACEBO_URL" "$MPV_URL"; do
	tar -xf "/src/$(basename "$url")" -C /build
done

# 1. nv-codec-headers: the NVDEC/CUDA headers FFmpeg loads the driver through
make -C "/build/nv-codec-headers-$NV_CODEC_HEADERS_VERSION" install PREFIX="$prefix"

# 2. SDL2: only the joystick, gamecontroller and haptic parts mpv's sdl2-gamepad input uses
cmake -S "/build/SDL2-$SDL2_VERSION" -B /build/sdl2-build -G Ninja \
	-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
	-DSDL_SHARED=ON -DSDL_STATIC=OFF -DSDL_VIDEO=OFF -DSDL_RENDER=OFF -DSDL_AUDIO=OFF \
	-DSDL_JOYSTICK=ON -DSDL_HAPTIC=ON -DSDL_HIDAPI=ON -DSDL_LIBUDEV=ON -DSDL_TEST=OFF
ninja -C /build/sdl2-build -j"$jobs" install

# 3. FFmpeg: GPL, never nonfree or version 3, no TLS library (mpv reads http and https through libcurl)
(
	cd "/build/ffmpeg-$FFMPEG_VERSION"
	./configure --prefix="$prefix" \
		--enable-gpl --enable-shared --disable-static --disable-programs --disable-doc \
		--enable-vulkan --enable-vaapi --enable-vdpau --enable-nvdec --enable-ffnvcodec \
		--enable-libdrm --enable-libdav1d --disable-autodetect \
		--enable-zlib --enable-bzlib --enable-lzma --enable-iconv --enable-pthreads
	make -j"$jobs"
	make install
)

# 4. libplacebo: the tarball's 3rdparty/ dirs are empty, so it builds against the image's Vulkan
#    headers, vk.xml, jinja2 and glad2. --auto-features=disabled, and every feature is named:
#    - vk-proc-addr: mpv creates its Vulkan instance with no vkGetInstanceProcAddr of its own
#      (pl_vk_inst_params()), so libplacebo links it from the host's libvulkan.so.1.
#    - gl-proc-addr: off. mpv hands libplacebo its own GL loader (get_proc_addr_ex), so the
#      built-in dlopen loader is never used.
#    - glslang: off, shaderc compiles SPIR-V. libdovi: off, FFmpeg parses the Dolby Vision RPU
#      and libplacebo's built-in dovi applies it.
#    - d3d11 is Windows only. unwind and xxhash are debugging and speed extras with no package here.
meson setup /build/libplacebo-build "/build/libplacebo-v$LIBPLACEBO_VERSION" \
	--prefix="$prefix" --buildtype=release --auto-features=disabled \
	-Dvulkan=enabled -Dvk-proc-addr=enabled -Dshaderc=enabled -Dglslang=disabled \
	-Dopengl=enabled -Dgl-proc-addr=disabled -Dlcms=enabled -Ddovi=enabled -Dlibdovi=disabled \
	-Dd3d11=disabled -Dunwind=disabled -Dxxhash=disabled -Ddemos=false -Dtests=false
ninja -C /build/libplacebo-build -j"$jobs" install

# 5. mpv: --auto-features=disabled, so every feature mpv needs is named here, and every other one
#    (DVD, Blu-ray, JavaScript, libarchive, JACK, ...) stays off. Lua is required: e2e loads
#    hold-load.lua. In mpv 0.42.0, Vulkan hwdec interop has no option (it comes with vulkan), and
#    the shaderc option is Windows-only: Vulkan compiles its shaders through libplacebo's shaderc.
#    vdpau-gl-x11 needs GLX (gl-x11), which stays off; VDPAU decodes through vdpau-copy.
meson setup /build/mpv-build "/build/mpv-$MPV_VERSION" \
	--prefix="$prefix" --buildtype=release --auto-features=disabled \
	-Dgpl=true -Dcplayer=true -Dlibmpv=false -Dtests=false -Dbuild-date=false \
	-Dmanpage-build=disabled -Dhtml-build=disabled \
	-Dsdl2-gamepad=enabled -Dlibcurl=enabled -Dlua=luajit -Diconv=enabled -Dzlib=enabled \
	-Dvector=enabled -Dlcms2=enabled -Dzimg=enabled -Duchardet=enabled \
	-Dvulkan=enabled -Dshaderc=disabled -Dwayland=enabled -Dx11=enabled -Dxv=disabled \
	-Dgl=enabled -Degl=enabled -Degl-wayland=enabled -Degl-x11=enabled -Degl-drm=enabled \
	-Ddrm=enabled -Dgbm=enabled -Ddmabuf-wayland=enabled \
	-Dvaapi=enabled -Dvaapi-wayland=enabled -Dvaapi-x11=enabled -Dvaapi-drm=enabled \
	-Dvdpau=enabled -Dvdpau-gl-x11=disabled -Dcuda-hwaccel=enabled -Dcuda-interop=enabled \
	-Dpipewire=enabled -Dpulse=enabled -Dalsa=enabled
ninja -C /build/mpv-build -j"$jobs" install

# The bundle: mpv, then every library it needs that the host does not provide, walked recursively
mapfile -t host_libs < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' /recipe/host-libs.txt | grep -v '^$')

is_host_lib() {
	local pattern
	for pattern in "${host_libs[@]}"; do
		# shellcheck disable=SC2053 # the pattern is a glob on purpose: `*` is host-libs.txt's wildcard
		[[ $1 == $pattern ]] && return 0
	done
	return 1
}

resolve() {
	local dir
	for dir in "$prefix/lib64" "$prefix/lib"; do
		[ -e "$dir/$1" ] && {
			echo "$dir/$1"
			return
		}
	done
	# awk reads all of ldconfig's output: an early exit would SIGPIPE ldconfig under pipefail
	ldconfig -p | awk -v soname="$1" '!found && $1 == soname && /x86-64/ { print $NF; found = 1 } END { exit !found }'
}

mkdir -p /out/lib
cp "$prefix/bin/mpv" /out/mpv
queue=(/out/mpv)
while [ "${#queue[@]}" -gt 0 ]; do
	file="${queue[0]}"
	queue=("${queue[@]:1}")
	while read -r soname; do
		[ -n "$soname" ] || continue
		is_host_lib "$soname" && continue
		[ -e "/out/lib/$soname" ] && continue
		src="$(resolve "$soname")" || {
			echo "$file needs $soname, which is neither in $prefix nor in ldconfig" >&2
			exit 1
		}
		cp -L "$src" "/out/lib/$soname"
		chmod 0755 "/out/lib/$soname"
		queue+=("/out/lib/$soname")
	done < <(patchelf --print-needed "$file")
done

# shellcheck disable=SC2016 # $ORIGIN is for the dynamic loader, not the shell
patchelf --set-rpath '$ORIGIN/lib' /out/mpv
for lib in /out/lib/*; do
	# shellcheck disable=SC2016
	patchelf --set-rpath '$ORIGIN' "$lib"
done
strip --strip-unneeded /out/mpv /out/lib/*

# The CA bundle path this libcurl was built to read, which the host must provide
python3 - "$(curl-config --ca)" > /out/manifest.json <<'PY'
import json, os, sys
print(json.dumps({
    "mpv": os.environ["MPV_VERSION"],
    "libplacebo": os.environ["LIBPLACEBO_VERSION"],
    "ffmpeg": os.environ["FFMPEG_VERSION"],
    "sdl2": os.environ["SDL2_VERSION"],
    "nvCodecHeaders": os.environ["NV_CODEC_HEADERS_VERSION"],
    "caBundle": sys.argv[1],
}, indent=2))
PY

# Smoke test: a library missing from lib/ fails the build here
env -i /out/mpv --no-config --version
