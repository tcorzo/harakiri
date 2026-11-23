#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds harakiri's mpv inside mpv/Containerfile's build stage, and assembles the bundle in /out:
# mpv, lib/ (every library mpv needs that mpv/host-libs.txt does not leave to the host),
# manifest.json, licenses/ (each component's license files), SOURCES.txt and BUILDING.txt.
# The source tarballs are bind-mounted read-only at /src (mpv/fetch.sh).
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
#    BUILDING.txt prints this line, libplacebo's and mpv's meson lines and curl's CMake line.
ffmpeg_configure=(
	./configure --prefix="$prefix"
	--enable-gpl --enable-shared --disable-static --disable-programs --disable-doc
	--enable-vulkan --enable-vaapi --enable-vdpau --enable-nvdec --enable-ffnvcodec
	--enable-libdrm --enable-libdav1d --disable-autodetect
	--enable-zlib --enable-bzlib --enable-lzma --enable-iconv --enable-pthreads
)
(
	cd "/build/ffmpeg-$FFMPEG_VERSION"
	"${ffmpeg_configure[@]}"
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
# shellcheck disable=SC2054 # the commas separate -Wl's arguments, not the array's
libplacebo_meson=(
	meson setup /build/libplacebo-build "/build/libplacebo-v$LIBPLACEBO_VERSION"
	--prefix="$prefix" --buildtype=release --auto-features=disabled
	-Dc_link_args=-Wl,--exclude-libs,libshaderc_combined.a
	-Dcpp_link_args=-Wl,--exclude-libs,libshaderc_combined.a
	-Dvulkan=enabled -Dvk-proc-addr=enabled -Dshaderc=enabled -Dglslang=disabled
	-Dopengl=enabled -Dgl-proc-addr=disabled -Dlcms=enabled -Ddovi=enabled -Dlibdovi=disabled
	-Dd3d11=disabled -Dunwind=disabled -Dxxhash=disabled -Ddemos=false -Dtests=false
)
"${libplacebo_meson[@]}"
ninja -C /build/libplacebo-build -j"$jobs" install

# 6. libcurl: what mpv reads http, https and ftp through. Fedora 44's 8.18.0 keeps an easy handle
#    paused when mpv adds it again after a seek (curl #20641). A subset of what Fedora's
#    libcurl-minimal has: http, https, ftp, ftps and file over OpenSSL, HTTP/2 (nghttp2), IDN
#    (libidn2) and zlib, without its GSS-API, which would bundle Kerberos for nothing mpv reads.
#    Every dependency is named, and every other protocol is off.
#    No CA path is compiled in: with CURL_CA_FALLBACK=ON libcurl asks the host's OpenSSL for its
#    default trust store (X509_STORE_set_default_paths), which is the distro's, and SSL_CERT_FILE
#    and SSL_CERT_DIR still apply. OpenSSL comes from the host (mpv/host-libs.txt).
curl_cmake=(
	cmake -S "/build/curl-$CURL_VERSION" -B /build/curl-build -G Ninja
	-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix"
	-DBUILD_SHARED_LIBS=ON -DBUILD_STATIC_LIBS=OFF -DBUILD_CURL_EXE=OFF -DBUILD_TESTING=OFF
	-DBUILD_EXAMPLES=OFF -DBUILD_LIBCURL_DOCS=OFF -DBUILD_MISC_DOCS=OFF -DENABLE_CURL_MANUAL=OFF
	-DCURL_USE_OPENSSL=ON -DUSE_NGHTTP2=ON -DUSE_LIBIDN2=ON -DCURL_USE_GSSAPI=OFF -DCURL_ZLIB=ON
	-DCURL_BROTLI=OFF -DCURL_ZSTD=OFF -DCURL_USE_LIBPSL=OFF -DCURL_USE_LIBSSH2=OFF
	-DCURL_USE_LIBSSH=OFF -DCURL_USE_GSASL=OFF -DCURL_USE_LIBUV=OFF -DCURL_USE_LIBBACKTRACE=OFF
	-DUSE_NGTCP2=OFF -DUSE_QUICHE=OFF -DUSE_ECH=OFF -DUSE_HTTPSRR=OFF -DENABLE_ARES=OFF
	-DENABLE_THREADED_RESOLVER=ON -DCURL_ENABLE_NTLM=OFF
	-DCURL_DISABLE_LDAP=ON -DCURL_DISABLE_LDAPS=ON -DCURL_DISABLE_DICT=ON -DCURL_DISABLE_GOPHER=ON
	-DCURL_DISABLE_IMAP=ON -DCURL_DISABLE_POP3=ON -DCURL_DISABLE_SMTP=ON -DCURL_DISABLE_MQTT=ON
	-DCURL_DISABLE_RTSP=ON -DCURL_DISABLE_TELNET=ON -DCURL_DISABLE_TFTP=ON -DCURL_DISABLE_IPFS=ON
	-DCURL_DISABLE_WEBSOCKETS=ON
	-DCURL_CA_BUNDLE=none -DCURL_CA_PATH=none -DCURL_CA_FALLBACK=ON
)
"${curl_cmake[@]}"
ninja -C /build/curl-build -j"$jobs" install

# 7. mpv: --auto-features=disabled, so every feature mpv needs is named here, and every other one
#    (DVD, Blu-ray, JavaScript, libarchive, JACK, ...) stays off. Lua is required: e2e loads
#    hold-load.lua. In mpv 0.42.0, Vulkan hwdec interop has no option (it comes with vulkan), and
#    the shaderc option is Windows-only: Vulkan compiles its shaders through the shaderc linked
#    into libplacebo (step 4).
#    vdpau-gl-x11 needs GLX (gl-x11), which stays off; VDPAU decodes through vdpau-copy.
mpv_meson=(
	meson setup /build/mpv-build "/build/mpv-$MPV_VERSION"
	--prefix="$prefix" --buildtype=release --auto-features=disabled
	-Dgpl=true -Dcplayer=true -Dlibmpv=false -Dtests=false -Dbuild-date=false
	-Dmanpage-build=disabled -Dhtml-build=disabled
	-Dsdl2-gamepad=enabled -Dlibcurl=enabled -Dlua=luajit -Diconv=enabled -Dzlib=enabled
	-Dvector=enabled -Dlcms2=enabled -Dzimg=enabled -Duchardet=enabled
	-Dvulkan=enabled -Dshaderc=disabled -Dwayland=enabled -Dx11=enabled -Dxv=disabled
	-Dgl=enabled -Degl=enabled -Degl-wayland=enabled -Degl-x11=enabled -Degl-drm=enabled
	-Ddrm=enabled -Dgbm=enabled -Ddmabuf-wayland=enabled
	-Dvaapi=enabled -Dvaapi-wayland=enabled -Dvaapi-x11=enabled -Dvaapi-drm=enabled
	-Dvdpau=enabled -Dvdpau-gl-x11=disabled -Dcuda-hwaccel=enabled -Dcuda-interop=enabled
	-Dpipewire=enabled -Dpulse=enabled -Dalsa=enabled
)
"${mpv_meson[@]}"
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
# Where each bundle file came from: a path under $prefix is built here, any other is a Fedora
# RPM's. The components step below reads it.
printf 'mpv\t%s\n' "$prefix/bin/mpv" > /build/origins.tsv
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
		printf 'lib/%s\t%s\n' "$soname" "$src" >> /build/origins.tsv
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

# BUILDING.txt, FFmpeg's legal checklist item 6: the lines that configured what the bundle holds,
# as this script ran them. The whole recipe is mpv/ in the corresponding source.
command_line() { # each argument as the shell reads it, quoted only when it has to be
	local arg line=""
	for arg in "$@"; do
		[[ $arg =~ ^[[:alnum:]_./=,:+@%-]+$ ]] || arg="$(printf '%q' "$arg")"
		line+="${line:+ }$arg"
	done
	printf '%s\n' "$line"
}
{
	echo "harakiri's mpv bundle was built by mpv/build.sh, in mpv/Containerfile's build stage on"
	echo "$BASE_IMAGE, with each source tarball extracted under /build and installed to $prefix."
	echo
	echo "# FFmpeg $FFMPEG_VERSION, in /build/ffmpeg-$FFMPEG_VERSION"
	command_line "${ffmpeg_configure[@]}"
	echo
	echo "# libplacebo $LIBPLACEBO_VERSION"
	command_line "${libplacebo_meson[@]}"
	echo
	echo "# curl $CURL_VERSION"
	command_line "${curl_cmake[@]}"
	echo
	echo "# mpv $MPV_VERSION"
	command_line "${mpv_meson[@]}"
} > /out/BUILDING.txt

# The components, for manifest.json, licenses/ and SOURCES.txt (docs/research/08: the Flathub
# layout, one licenses/<component>/ per component). Every file in the bundle belongs to one:
# - a file from $prefix is built here, and BUILT below names the component that provides it and
#   the license files in that component's own tarball;
# - any other file is a Fedora 44 RPM's: its component is the %{NAME} of the package that owns it
#   (rpm -qf), with that package's %{VERSION}-%{RELEASE}, %{LICENSE} and %{SOURCERPM}, and its
#   license files are the ones the package marks %license (rpm -qL). A package that marks none
#   fails the build, unless LICENSE_FROM names where its own license files are.
# No license text is written here: licenses/README is mpv/licenses-README.txt, and
# licenses/COPYING.GPLv3, the license the bundle is conveyed under, is FFmpeg's.
python3 - "$prefix" <<'PY'
import json, os, shutil, subprocess, sys
from fnmatch import fnmatch

prefix = sys.argv[1]
env = os.environ

# name: (its versions.env name, its tree under /build, its license (SPDX), the bundle files it
#        provides, its license files in that tree; a directory is copied whole)
BUILT = {
    "mpv": ("MPV", "mpv-{}", "GPL-2.0-or-later", ["mpv"],
            ["Copyright", "LICENSE.GPL", "LICENSE.LGPL"]),
    "libplacebo": ("LIBPLACEBO", "libplacebo-v{}", "LGPL-2.1-or-later", ["lib/libplacebo.so.*"],
                   ["LICENSE"]),
    "ffmpeg": ("FFMPEG", "ffmpeg-{}", "GPL-2.0-or-later",
               ["lib/libavcodec.so.*", "lib/libavfilter.so.*", "lib/libavformat.so.*",
                "lib/libavutil.so.*", "lib/libswresample.so.*", "lib/libswscale.so.*"],
               ["LICENSE.md", "COPYING.GPLv2", "COPYING.GPLv3", "COPYING.LGPLv2.1",
                "COPYING.LGPLv3"]),
    "sdl2": ("SDL2", "SDL2-{}", "Zlib", ["lib/libSDL2-2.0.so.*"], ["LICENSE.txt"]),
    # Its tarball has no license file: each header opens with the notice that applies to it,
    # which NOTICES below copies.
    "nv-codec-headers": ("NV_CODEC_HEADERS", "nv-codec-headers-{}", "MIT", [], []),
    "curl": ("CURL", "curl-{}", "curl", ["lib/libcurl.so.*"], ["COPYING"]),
    "shaderc": ("SHADERC", "shaderc-{}", "Apache-2.0", [],
                ["LICENSE", "third_party/LICENSE.glslang", "third_party/LICENSE.spirv-tools"]),
    # Every license glslang's REUSE.toml gives a file of its tree, and LICENSES/ has each text
    "glslang": ("GLSLANG", "glslang-{}",
                "AML-glslang AND Apache-2.0 AND BSD-2-Clause AND BSD-3-Clause"
                " AND GPL-3.0-or-later WITH Bison-exception-2.2 AND MIT AND MIT-Khronos-old",
                [], ["LICENSE.txt", "LICENSES"]),
    "spirv-tools": ("SPIRV_TOOLS", "SPIRV-Tools-{}", "Apache-2.0", [], ["LICENSE"]),
    # REUSE.toml: MIT, except the repo's own git and Bazel files (CC-BY-4.0), which ship nowhere
    "spirv-headers": ("SPIRV_HEADERS", "SPIRV-Headers-{}", "MIT", [],
                      ["LICENSE", "LICENSES/MIT.txt"]),
}

# The headers whose opening comment, the notice that applies to that header only, is the
# component's license file: licenses/<component>/<header name>.notice
NOTICES = {
    "nv-codec-headers": ["include/ffnvcodec/dynlink_cuda.h", "include/ffnvcodec/dynlink_cuviddec.h",
                         "include/ffnvcodec/dynlink_loader.h", "include/ffnvcodec/dynlink_nvcuvid.h",
                         "include/ffnvcodec/nvEncodeAPI.h"],
}

# A package that marks no %license file: the package of the same SRPM that marks its license files.
# pcre2 requires pcre2-syntax at its own version-release, and only pcre2-syntax marks pcre2's
# COPYING and LICENCE.md.
LICENSE_FROM = {"pcre2": "pcre2-syntax"}


def fail(message):
    sys.exit(f"build.sh: {message}")


def rpm(*args):
    result = subprocess.run(["rpm", *args], capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"rpm {' '.join(args)}: {(result.stdout + result.stderr).strip()}")
    return result.stdout


def copy(src, dest):
    if not os.path.exists(src):
        fail(f"{src} is missing")
    if os.path.exists(dest):
        fail(f"{dest} would hold two license files")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.isdir(src):
        shutil.copytree(src, dest)
    else:
        shutil.copyfile(src, dest)


origins = dict(line.rstrip("\n").split("\t") for line in open("/build/origins.tsv"))
shipped = {"mpv"} | {f"lib/{name}" for name in os.listdir("/out/lib")}
if set(origins) != shipped:
    fail(f"origins.tsv and the bundle differ: {sorted(set(origins) ^ shipped)}")

built_files = {name: [] for name in BUILT}
rpm_files = {}
for rel, src in sorted(origins.items()):
    if src.startswith(prefix + "/"):
        owners = [name for name, spec in BUILT.items() if any(fnmatch(rel, glob) for glob in spec[3])]
        if len(owners) != 1:
            fail(f"{rel} is built here ({src}), and BUILT names {len(owners)} components for it: {owners}")
        built_files[owners[0]].append(rel)
    else:
        owners = rpm("-qf", "--qf", "%{NAME}\n", os.path.realpath(src)).split()
        if len(owners) != 1:
            fail(f"{rel} ({src}) is owned by {len(owners)} packages: {owners}")
        rpm_files.setdefault(owners[0], []).append(rel)

components = []
for name, (var, tree, license, provides, texts) in BUILT.items():
    for glob in provides:
        if not any(fnmatch(rel, glob) for rel in built_files[name]):
            fail(f"BUILT says {name} provides {glob}, which is not in the bundle")
    root = f"/build/{tree.format(env[var + '_VERSION'])}"
    for text in texts:
        copy(f"{root}/{text}", f"/out/licenses/{name}/{text}")
    for header in NOTICES.get(name, []):
        content = open(f"{root}/{header}").read()
        if not content.startswith("/*") or "*/" not in content:
            fail(f"{root}/{header} does not open with a comment")
        dest = f"/out/licenses/{name}/{os.path.basename(header)}.notice"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w") as out:
            out.write(content[: content.index("*/") + 2] + "\n")
    components.append({
        "name": name,
        "version": env[var + "_VERSION"],
        "license": license,
        "files": sorted(built_files[name]),
        "source": {"kind": "upstream", "url": env[var + "_URL"], "sha256": env[var + "_SHA256"]},
    })

for pkg, files in sorted(rpm_files.items()):
    if pkg in BUILT:
        fail(f"the RPM {pkg} has the name of a component built here")
    fields = rpm("-q", "--qf", "%{VERSION}-%{RELEASE}\t%{LICENSE}\t%{SOURCERPM}\n", pkg).splitlines()
    if len(fields) != 1:
        fail(f"{pkg} is installed {len(fields)} times")
    version, license, srpm = fields[0].split("\t")
    holder = LICENSE_FROM.get(pkg, pkg)
    if holder != pkg and rpm("-q", "--qf", "%{SOURCERPM}\n", holder).strip() != srpm:
        fail(f"LICENSE_FROM takes {pkg}'s license files from {holder}, which is not built from {srpm}")
    texts = [line for line in rpm("-qL", holder).splitlines() if line.startswith("/")]
    if not texts:
        fail(f"{pkg} marks no %license file (rpm -qL {holder}): name where its license files are in LICENSE_FROM")
    licenses_dir = f"/usr/share/licenses/{holder}/"
    for text in texts:
        rel = text[len(licenses_dir):] if text.startswith(licenses_dir) else os.path.basename(text)
        copy(text, f"/out/licenses/{pkg}/{rel}")
    components.append({
        "name": pkg,
        "version": version,
        "license": license,
        "files": sorted(files),
        "source": {"kind": "srpm", "srpm": srpm},
    })

components.sort(key=lambda component: component["name"])
copy("/recipe/licenses-README.txt", "/out/licenses/README")
copy(f"/build/ffmpeg-{env['FFMPEG_VERSION']}/COPYING.GPLv3", "/out/licenses/COPYING.GPLv3")

with open("/out/manifest.json", "w") as out:
    json.dump({
        "mpv": env["MPV_VERSION"],
        "libplacebo": env["LIBPLACEBO_VERSION"],
        "ffmpeg": env["FFMPEG_VERSION"],
        "sdl2": env["SDL2_VERSION"],
        "nvCodecHeaders": env["NV_CODEC_HEADERS_VERSION"],
        "curl": env["CURL_VERSION"],
        "shaderc": env["SHADERC_VERSION"],
        "glslang": env["GLSLANG_VERSION"],
        "spirvTools": env["SPIRV_TOOLS_VERSION"],
        "spirvHeaders": env["SPIRV_HEADERS_VERSION"],
        "components": components,
    }, out, indent=2)
    out.write("\n")

# One line per component: name, version, license, then the tarball's URL and sha256, or the SRPM
with open("/out/SOURCES.txt", "w") as out:
    for component in components:
        source = component["source"]
        where = [source["url"], source["sha256"]] if source["kind"] == "upstream" else [source["srpm"]]
        out.write("\t".join([component["name"], component["version"], component["license"], *where]) + "\n")
PY

# Smoke test: a library missing from lib/ fails the build here
env -i /out/mpv --no-config --version
