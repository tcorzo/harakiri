# Bazzite / Steam Game Mode: plug and play

**Repos touched:** `harakiri`

## Prompt

Go through the open GitHub issues related to gamescope or Bazzite, the OS the living-room HTPC runs. Make harakiri easier to set up and make it just work there: it should feel plug and play. The first install on that machine hit a run of annoyances. Plan a holistic solution, an epic, that makes the whole thing work together.

Issues #16 and #18 are being worked on separately in parallel sessions; leave them out.

## Issues in scope

- #20 docs: support and document Steam Game Mode (gamescope) as a target (tracking)
- #2 Bundle mpv, FFmpeg and libplacebo in the packaged Linux app
- #8 fix(audio): bitstream is never used when PipeWire lists formats with attributes
- #9 fix(picture): HDR is tone-mapped to SDR under gamescope (`--target-colorspace-hint=auto`)
- #10 fix(app): Electron GPU process crashes 3 times at launch from Steam (overlay `LD_PRELOAD`)
- #11 fix(session): sign-in is lost on every restart when no keyring is available
- #12 fix(player): when mpv fails to start, the error shown hides mpv's reason
- #13 fix(player): playback fails with mpv builds that lack `sdl2-gamepad`
- #14 docs(onboarding): immutable distros and Steam Game Mode (a verified mpv recipe)
- #15 fix(release): README install steps and the auto-updater point at unreachable releases
- #17 fix(doctor): setup fails for player-only installs (weston required)

Out of scope: #16 (mise.lock min_version), #18 (AppImage icon and desktopName), #19 (renderer preload warnings).
