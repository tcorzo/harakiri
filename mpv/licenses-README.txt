harakiri's mpv bundle: licenses and source

This bundle (resources/mpv/ in the harakiri AppImage) is mpv, the libraries in lib/ that it loads,
and their licenses. mpv is a separate program: harakiri starts it and talks to it over IPC.
harakiri itself is MIT licensed, and this bundle is not part of it.

The bundle as a whole is conveyed under the GNU General Public License, version 3: COPYING.GPLv3
in this directory, from FFmpeg's source. mpv and FFmpeg are licensed under the GPL version 2 or
later, and libplacebo links shaderc, glslang and SPIRV-Tools, whose Apache-2.0 code is compatible
with version 3 of the GPL only. Each component keeps its own license, and its license files are
in licenses/<component>/:

- a component built from source (mpv, libplacebo, ffmpeg, sdl2, nv-codec-headers, curl, shaderc,
  glslang, spirv-tools, spirv-headers) has the license files of its source tarball;
- a library copied from Fedora 44 is the component named after the package it came from, and has
  the files that package marks as its licenses.

../SOURCES.txt has one line per component, separated by tabs: its name, version and license (an
SPDX expression), then the URL and sha256 of its source tarball, or the Fedora source RPM it was
built from. ../BUILDING.txt has the configure lines the bundle was built with. ../manifest.json
lists the same components, with the files of the bundle that each one provides.

Corresponding source

The complete corresponding source of this bundle is the asset harakiri-mpv-source.tar on the same
GitHub release as the AppImage that holds it (https://github.com/tcorzo/harakiri/releases). It has
each source tarball and source RPM that SOURCES.txt lists, and the recipe that builds this bundle
from them: the mpv/ directory of harakiri's repository at that release's tag.
