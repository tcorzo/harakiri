#!/usr/bin/env bash
# Provisions the dev/vm guest. guest.sh runs it as root, once per recipe hash, with HOST_UID and
# HOST_GID set to the host user's ids.
set -euo pipefail

: "${HOST_UID:?guest.sh sets HOST_UID}" "${HOST_GID:?guest.sh sets HOST_GID}"

# One package per line. A phase that needs a guest package adds it here.
PACKAGES=(
  kwin
  mesa-vulkan-drivers
  vulkan-loader
  pipewire
  wireplumber
  pipewire-pulseaudio
  pulseaudio-utils
  # RPM Fusion: Fedora's ffmpeg-free has no HEVC decoder.
  ffmpeg
  mpv # until Phase 7: the bundled mpv replaces it
  python3-evdev
  dbus-daemon
  procps-ng
  util-linux
  shadow-utils
  # mise's node links it, and the fedora image lacks it.
  libatomic
  # Electron's runtime libraries.
  gtk3
  nss
  alsa-lib
  libxkbcommon
  mesa-libgbm
  at-spi2-atk
  cups-libs
  libdrm
  fontconfig
  dejavu-sans-fonts
)

dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-44.noarch.rpm
dnf install -y --allowerasing "${PACKAGES[@]}"

# The guest user has the host user's uid and gid, so files it writes to /workspace belong to the
# host user. Its home is outside /home.
id -u harakiri >/dev/null 2>&1 || useradd -o -u "$HOST_UID" -U -d /var/lib/harakiri -m harakiri
[ "$(id -g harakiri)" = "$HOST_GID" ] || groupmod -o -g "$HOST_GID" harakiri

# The fake S/PDIF sink: an ALSA null PCM named iec958_* behind PipeWire's ALSA sink adapter. No
# sound card or kernel module.
install -m 0644 /workspace/dev/vm/asoundrc /var/lib/harakiri/.asoundrc
chown harakiri: /var/lib/harakiri/.asoundrc
install -D -m 0644 /workspace/dev/vm/pipewire/fake-spdif.conf /etc/pipewire/pipewire.conf.d/fake-spdif.conf

# The marker that tells a test it runs in the guest. It is the last step, so a failed provision
# leaves no marker.
printf 'harakiri dev/vm guest\n' >/etc/harakiri-guest
