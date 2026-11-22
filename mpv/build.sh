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
# mpv/fetch.sh saves each tarball as <NAME>_FILE, or as its URL's last segment
for name in NV_CODEC_HEADERS SDL2 FFMPEG SPIRV_HEADERS SPIRV_TOOLS GLSLANG SHADERC LIBPLACEBO CURL MPV; do
	url_var="${name}_URL" file_var="${name}_FILE"
	tar -xf "/src/${!file_var:-$(basename "${!url_var}")}" -C /build
done

# 1. nv-codec-headers: the NVDEC/CUDA headers FFmpeg loads the driver through
make -C "/build/nv-codec-headers-$NV_CODEC_HEADERS_VERSION" install PREFIX="$prefix"

# 2. SDL2: only the joystick, gamecontroller and haptic parts mpv's sdl2-gamepad input uses
cmake -S "/build/SDL2-$SDL2_VERSION" -B /build/sdl2-build -G Ninja \
	-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
	-DSDL_SHARED=ON -DSDL_STATIC=OFF -DSDL_VIDEO=OFF -DSDL_RENDER=OFF -DSDL_AUDIO=OFF \
	-DSDL_JOYSTICK=ON -DSDL_HAPTIC=ON -DSDL_HIDAPI=ON -DSDL_LIBUDEV=ON -DSDL_TEST=OFF
ninja -C /build/sdl2-build -j"$jobs" install

# 3. FFmpeg: --enable-gpl, never --enable-nonfree; --enable-version3 is off, so FFmpeg's own
#    license is GPL version 2 or later. No TLS library (mpv reads http and https through libcurl).
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

# 4. shaderc, with the glslang, SPIRV-Tools and SPIRV-Headers versions.env pins, as one static
#    archive (libshaderc_combined.a) for libplacebo to link. The host's Mesa drivers (every Vulkan
#    driver, libgallium) link libSPIRV-Tools.so, whose soname is unversioned and whose API is C++:
#    a copy in lib/ would be loaded first and bind the host's drivers to it. So the bundle ships no
#    shaderc or SPIRV-Tools library, and libplacebo exports none of their symbols: every object is
#    built position-independent with hidden visibility, and libplacebo links the archive with
#    --exclude-libs (step 5), which also hides the std templates these objects instantiate.
#    Only the archive's target is built: no tests, examples, glslc, glslang or spirv-* tools, and
#    no shared libraries. HLSL input is off (libplacebo compiles GLSL), and -Werror is off so a
#    newer compiler's warnings do not stop the build.
#    Licensing: shaderc and SPIRV-Tools are Apache-2.0, glslang is BSD, MIT and Apache-2.0, and
#    SPIRV-Headers is MIT-style. As before, they are conveyed inside the GPL program, now linked
#    into libplacebo instead of beside it. Apache-2.0 is compatible with GPL version 3, and mpv
#    and FFmpeg are GPL version 2 or later.
cmake -S "/build/shaderc-$SHADERC_VERSION" -B /build/shaderc-build -G Ninja \
	-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
	-DCMAKE_C_FLAGS='-fvisibility=hidden' \
	-DCMAKE_CXX_FLAGS='-fvisibility=hidden -fvisibility-inlines-hidden' \
	-DSHADERC_SPIRV_HEADERS_DIR="/build/SPIRV-Headers-$SPIRV_HEADERS_VERSION" \
	-DSHADERC_SPIRV_TOOLS_DIR="/build/SPIRV-Tools-$SPIRV_TOOLS_VERSION" \
	-DSHADERC_GLSLANG_DIR="/build/glslang-$GLSLANG_VERSION" \
	-DSHADERC_SKIP_TESTS=ON -DSHADERC_SKIP_EXAMPLES=ON -DSHADERC_SKIP_EXECUTABLES=ON \
	-DSHADERC_SKIP_COPYRIGHT_CHECK=ON -DSHADERC_ENABLE_HLSL=OFF \
	-DSHADERC_ENABLE_WERROR_COMPILE=OFF -DSPIRV_SKIP_EXECUTABLES=ON -DSPIRV_WERROR=OFF \
	-DENABLE_GLSLANG_BINARIES=OFF
ninja -C /build/shaderc-build -j"$jobs" shaderc_combined
install -Dm0644 /build/shaderc-build/libshaderc/libshaderc_combined.a "$prefix/lib64/libshaderc_combined.a"
install -Dm0644 -t "$prefix/include/shaderc" "/build/shaderc-$SHADERC_VERSION"/libshaderc/include/shaderc/*.h
# shaderc's own shaderc.pc names the shared library, and its shaderc_combined.pc is a target the
# archive's build skips; libplacebo looks shaderc up as `shaderc`, so this one names the archive.
mkdir -p "$prefix/lib64/pkgconfig"
cat > "$prefix/lib64/pkgconfig/shaderc.pc" <<PC
prefix=$prefix
libdir=\${prefix}/lib64
includedir=\${prefix}/include

Name: shaderc
Description: shaderc, glslang and SPIRV-Tools in one static archive, with hidden symbols
Version: $SHADERC_VERSION
Libs: -L\${libdir} -lshaderc_combined
Cflags: -I\${includedir}
PC

# 5. libplacebo: the tarball's 3rdparty/ dirs are empty, so it builds against the image's Vulkan
#    headers, vk.xml, jinja2 and glad2. --auto-features=disabled, and every feature is named:
#    - vk-proc-addr: mpv creates its Vulkan instance with no vkGetInstanceProcAddr of its own
#      (pl_vk_inst_params()), so libplacebo links it from the host's libvulkan.so.1.
#    - gl-proc-addr: off. mpv hands libplacebo its own GL loader (get_proc_addr_ex), so the
#      built-in dlopen loader is never used.
#    - glslang: off, shaderc (step 4) compiles SPIR-V. libdovi: off, FFmpeg parses the Dolby
#      Vision RPU and libplacebo's built-in dovi applies it.
#    - d3d11 is Windows only. unwind and xxhash are debugging and speed extras with no package here.
#    --exclude-libs makes every symbol libplacebo takes from libshaderc_combined.a local to it.
#    libplacebo links C++, so both languages' link args carry it.
meson setup /build/libplacebo-build "/build/libplacebo-v$LIBPLACEBO_VERSION" \
	--prefix="$prefix" --buildtype=release --auto-features=disabled \
	-Dc_link_args=-Wl,--exclude-libs,libshaderc_combined.a \
	-Dcpp_link_args=-Wl,--exclude-libs,libshaderc_combined.a \
	-Dvulkan=enabled -Dvk-proc-addr=enabled -Dshaderc=enabled -Dglslang=disabled \
	-Dopengl=enabled -Dgl-proc-addr=disabled -Dlcms=enabled -Ddovi=enabled -Dlibdovi=disabled \
	-Dd3d11=disabled -Dunwind=disabled -Dxxhash=disabled -Ddemos=false -Dtests=false
ninja -C /build/libplacebo-build -j"$jobs" install

# 6. libcurl: what mpv reads http, https and ftp through. Fedora 44's 8.18.0 keeps an easy handle
#    paused when mpv adds it again after a seek (curl #20641). Only the features Fedora's
#    libcurl-minimal has: http, https, ftp, ftps and file over OpenSSL, HTTP/2 (nghttp2), IDN
#    (libidn2) and zlib. No GSS-API: it would bundle Kerberos for nothing mpv reads. Every
#    dependency is named, and every other protocol is off.
#    No CA path is compiled in: with CURL_CA_FALLBACK=ON libcurl asks the host's OpenSSL for its
#    default trust store (X509_STORE_set_default_paths), which is the distro's, and SSL_CERT_FILE
#    and SSL_CERT_DIR still apply. OpenSSL comes from the host (mpv/host-libs.txt).
cmake -S "/build/curl-$CURL_VERSION" -B /build/curl-build -G Ninja \
	-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
	-DBUILD_SHARED_LIBS=ON -DBUILD_STATIC_LIBS=OFF -DBUILD_CURL_EXE=OFF -DBUILD_TESTING=OFF \
	-DBUILD_EXAMPLES=OFF -DBUILD_LIBCURL_DOCS=OFF -DBUILD_MISC_DOCS=OFF -DENABLE_CURL_MANUAL=OFF \
	-DCURL_USE_OPENSSL=ON -DUSE_NGHTTP2=ON -DUSE_LIBIDN2=ON -DCURL_USE_GSSAPI=OFF -DCURL_ZLIB=ON \
	-DCURL_BROTLI=OFF -DCURL_ZSTD=OFF -DCURL_USE_LIBPSL=OFF -DCURL_USE_LIBSSH2=OFF \
	-DCURL_USE_LIBSSH=OFF -DCURL_USE_GSASL=OFF -DCURL_USE_LIBUV=OFF -DCURL_USE_LIBBACKTRACE=OFF \
	-DUSE_NGTCP2=OFF -DUSE_QUICHE=OFF -DUSE_ECH=OFF -DUSE_HTTPSRR=OFF -DENABLE_ARES=OFF \
	-DENABLE_THREADED_RESOLVER=ON -DCURL_ENABLE_NTLM=OFF \
	-DCURL_DISABLE_LDAP=ON -DCURL_DISABLE_LDAPS=ON -DCURL_DISABLE_DICT=ON -DCURL_DISABLE_GOPHER=ON \
	-DCURL_DISABLE_IMAP=ON -DCURL_DISABLE_POP3=ON -DCURL_DISABLE_SMTP=ON -DCURL_DISABLE_MQTT=ON \
	-DCURL_DISABLE_RTSP=ON -DCURL_DISABLE_TELNET=ON -DCURL_DISABLE_TFTP=ON -DCURL_DISABLE_IPFS=ON \
	-DCURL_DISABLE_WEBSOCKETS=ON \
	-DCURL_CA_BUNDLE=none -DCURL_CA_PATH=none -DCURL_CA_FALLBACK=ON
ninja -C /build/curl-build -j"$jobs" install

# 7. mpv: --auto-features=disabled, so every feature mpv needs is named here, and every other one
#    (DVD, Blu-ray, JavaScript, libarchive, JACK, ...) stays off. Lua is required: e2e loads
#    hold-load.lua. In mpv 0.42.0, Vulkan hwdec interop has no option (it comes with vulkan), and
#    the shaderc option is Windows-only: Vulkan compiles its shaders through the shaderc linked
#    into libplacebo (step 4).
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

python3 - > /out/manifest.json <<'PY'
import json, os, sys
print(json.dumps({
    "mpv": os.environ["MPV_VERSION"],
    "libplacebo": os.environ["LIBPLACEBO_VERSION"],
    "ffmpeg": os.environ["FFMPEG_VERSION"],
    "sdl2": os.environ["SDL2_VERSION"],
    "nvCodecHeaders": os.environ["NV_CODEC_HEADERS_VERSION"],
    "curl": os.environ["CURL_VERSION"],
    "shaderc": os.environ["SHADERC_VERSION"],
    "glslang": os.environ["GLSLANG_VERSION"],
    "spirvTools": os.environ["SPIRV_TOOLS_VERSION"],
    "spirvHeaders": os.environ["SPIRV_HEADERS_VERSION"],
}, indent=2))
PY

# Smoke test: a library missing from lib/ fails the build here
env -i /out/mpv --no-config --version
