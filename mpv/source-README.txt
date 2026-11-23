harakiri's mpv bundle: corresponding source

This is the complete corresponding source of the mpv bundle in the harakiri AppImage on the same
GitHub release: resources/mpv/ in the AppImage. The bundle is conveyed under the GNU General Public
License, version 3. resources/mpv/licenses/README in the AppImage says why, and the licenses/
directory next to it has the license files of every component.

- recipe/ is the mpv/ directory of harakiri's repository at the release's tag: the scripts that
  control the build. versions.env pins the base image (Fedora 44, by digest) and each source
  tarball with its sha256. Containerfile installs the build tools from Fedora 44's release repo
  only, and build.sh builds the bundle and copies in the libraries it loads.
- upstream/ has each source tarball that recipe/versions.env pins, byte for byte, under the name
  recipe/fetch.sh saves it as. `sha256sum` of each one matches its pin.
- srpms/ has the Fedora 44 source RPM of each library that the bundle copies out of a Fedora 44
  RPM, at the version the build installed. Each one is signed by Fedora (`rpm -K`).
- SOURCES.txt and BUILDING.txt are the bundle's own: one line per component with its version,
  license and source, and the configure lines the bundle was built with.

Rebuilding the bundle

In a checkout of harakiri at the release's tag, `mise run mpv:build` builds this bundle into
.cache/mpv/<recipe hash>. It downloads the tarballs in upstream/; copy them into .cache/mpv/src
first, and it uses them instead.

Without a checkout, podman builds it from this directory alone, into bundle/:

    . recipe/versions.env
    podman build --build-arg BASE_IMAGE="$BASE_IMAGE" --build-arg JOBS=4 \
      -v "$PWD/upstream:/src:ro,Z" -f recipe/Containerfile -o type=local,dest=bundle recipe

The libraries from Fedora RPMs are Fedora's builds of the source RPMs in srpms/. `rpmbuild
--rebuild <file>` in the base image builds one again, and the .so files it makes replace the ones
in the bundle's lib/.
