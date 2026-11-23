# Changelog

## [0.1.0](https://github.com/tcorzo/harakiri/compare/v0.1.0...v0.1.0) (2026-11-23)


### Features

* add harakiri MVP, a TV-first Jellyfin player with passthrough ([#1](https://github.com/tcorzo/harakiri/issues/1)) ([9485899](https://github.com/tcorzo/harakiri/commit/9485899d7ea5f3d2e015431032e5e78a2ea7e7fa))
* **desktop:** add harakiri to Steam from the library and Settings ([#35](https://github.com/tcorzo/harakiri/issues/35)) ([4449a4a](https://github.com/tcorzo/harakiri/commit/4449a4a3f0021bac8504ec95fc2eed6af5a03580))
* **desktop:** play with harakiri's mpv build, or HARAKIRI_MPV ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **desktop:** re-tone the UI to blood red on warm black ([#5](https://github.com/tcorzo/harakiri/issues/5)) ([46164e2](https://github.com/tcorzo/harakiri/commit/46164e2cbf8662769bdc4cfe88da5d3cdd2c9fbe))
* **desktop:** warn when Chromium composites in software ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **harness:** check for a read-write /dev/kvm in doctor ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **mpv:** find harakiri's own mpv build and check what it needs from the host ([#34](https://github.com/tcorzo/harakiri/issues/34)) ([4c6a6a7](https://github.com/tcorzo/harakiri/commit/4c6a6a79b99e06d9a08c181e98042e5330017f7d))
* **player:** say when the server's certificate is not trusted ([2791694](https://github.com/tcorzo/harakiri/commit/2791694fa1e809804c1c452e4c2c01c66d33b9a9))
* release the desktop app as a self-updating AppImage ([#4](https://github.com/tcorzo/harakiri/issues/4)) ([017219a](https://github.com/tcorzo/harakiri/commit/017219a7def6b175c6096032c3842e5296450977))
* **release:** ship harakiri's mpv build, its licenses and its source in the AppImage ([#44](https://github.com/tcorzo/harakiri/issues/44)) ([e7b9376](https://github.com/tcorzo/harakiri/commit/e7b937622de3a861060d9d8e97f59800199cf94e))


### Bug Fixes

* **audio:** bitstream when PipeWire lists formats with attributes ([#27](https://github.com/tcorzo/harakiri/issues/27)) ([062e726](https://github.com/tcorzo/harakiri/commit/062e726a3b14db87902cda0bdb3da733981c88fd))
* **desktop:** keep custom Steam art under any image extension, and heal art only when owed ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** log a failed launcher add as a warning ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** quote the launcher's Exec only for the Desktop Entry reserved characters ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** read the launcher status again each time Settings opens ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** refuse a launcher add when the launcher is unavailable ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** set the Steam launcher's modes with chmod, and repair a wrong one ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** show the window at once, so it appears when Chromium composites in software ([e72d7f2](https://github.com/tcorzo/harakiri/commit/e72d7f24efb24b239a1105ac621a572d28507a98))
* **desktop:** skip fixed-width shortcuts.vdf fields instead of rejecting the file ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **desktop:** take the launcher's where-to-launch and retry words from the host ([f6e04bc](https://github.com/tcorzo/harakiri/commit/f6e04bc146ffacf6878b22cedc9eb6c4fa11dd34))
* **e2e:** run the guest half when the host half fails ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **e2e:** time out the setup's requests to the e2e Jellyfin ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **library:** keep the focused card's neighbours mounted, so a held key drops no press ([ae6a0e0](https://github.com/tcorzo/harakiri/commit/ae6a0e0d3c10bc34de689b4bdd57b9e2a4f57d3e))
* **onboarding:** require mise 2026.9.16 and relock mise.lock ([#22](https://github.com/tcorzo/harakiri/issues/22)) ([159ef37](https://github.com/tcorzo/harakiri/commit/159ef3779aa2d145259052634c2b2e5bc0840a05))
* **onboarding:** require mise 2026.9.16 and relock with current mise ([159ef37](https://github.com/tcorzo/harakiri/commit/159ef3779aa2d145259052634c2b2e5bc0840a05)), closes [#16](https://github.com/tcorzo/harakiri/issues/16)
* **packaging:** ship harakiri's icon and declare desktopName in the AppImage ([#23](https://github.com/tcorzo/harakiri/issues/23)) ([eb7b904](https://github.com/tcorzo/harakiri/commit/eb7b904459dde919a2bbdbfac10bd79a6f8291f4)), closes [#18](https://github.com/tcorzo/harakiri/issues/18)
* **picture:** pick the HDR hint from the compositor, and report a scaled-down picture ([#30](https://github.com/tcorzo/harakiri/issues/30)) ([25991bc](https://github.com/tcorzo/harakiri/commit/25991bc3f6ab1d9b9d8bb522914071a50ef71715))
* **player:** find the mpv build before stopping the film that is playing ([2791694](https://github.com/tcorzo/harakiri/commit/2791694fa1e809804c1c452e4c2c01c66d33b9a9))
* **player:** keep at most one progress report waiting, and send the start report first ([b01cae1](https://github.com/tcorzo/harakiri/commit/b01cae11a0741709e654f7786aa47c0e2c98f19a))
* **player:** send playback reports in order, so a late progress report cannot roll back the resume point ([b01cae1](https://github.com/tcorzo/harakiri/commit/b01cae11a0741709e654f7786aa47c0e2c98f19a))
* **player:** show mpv's own reason when it fails to start ([#28](https://github.com/tcorzo/harakiri/issues/28)) ([fad43bc](https://github.com/tcorzo/harakiri/commit/fad43bc949092c2c26673fbbadd52b5acf367414))
* **player:** skip exactly 30 s forward and 10 s back, not to the next keyframe ([b01cae1](https://github.com/tcorzo/harakiri/commit/b01cae11a0741709e654f7786aa47c0e2c98f19a))
* **session:** keep the sign-in without a keyring, behind host capabilities ([#29](https://github.com/tcorzo/harakiri/issues/29)) ([ade8891](https://github.com/tcorzo/harakiri/commit/ade889151d52a9b80e89d4e9eba6b4328ae7c8cd))
* **updates:** report an unreachable update feed as one warning, and license under MIT ([#26](https://github.com/tcorzo/harakiri/issues/26)) ([3e16655](https://github.com/tcorzo/harakiri/commit/3e16655fb1b12f227996a88262827a19da7eacf0))
* **vm:** name an empty HARAKIRI_CORPUS_DIR or HARAKIRI_FATE_DIR ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **vm:** stop the guest at once on a signal during exec, one exec at a time ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))
* **vm:** unmount the document portal before removing the session dir ([4c680aa](https://github.com/tcorzo/harakiri/commit/4c680aaf9d12d887af0705c2a64714f33f88de7f))


### Performance Improvements

* **vm:** give the guest 2 GiB, which its measured working set fits ([b01cae1](https://github.com/tcorzo/harakiri/commit/b01cae11a0741709e654f7786aa47c0e2c98f19a))
