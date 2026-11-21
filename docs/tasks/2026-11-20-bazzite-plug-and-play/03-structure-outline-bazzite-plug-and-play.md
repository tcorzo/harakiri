---
task: 2026-11-20-bazzite-plug-and-play
type: structure-outline
repo: harakiri
branch: tcorzo/bazzite-first-party
sha: 759eb96b499d6d3d687aef98b3e61734001a72a3
---

**Repos touched:** `harakiri`

# Bazzite / Steam Game Mode: plug and play

harakiri becomes plug and play on a Bazzite HTPC in Steam Game Mode. The user downloads one AppImage, adds it to Steam from inside harakiri, signs in once, and plays HDR with bitstreamed audio. The order puts the first public release first, so every later phase reaches the HTPC through the updater and gets checked there cheaply. The host capability layer comes in with its first consumer (the session), the microVM guest comes in with its first platform check (#8), and the bundled mpv is built and used in dev and tests before it ships in the AppImage.

## Desired End State

- A public MIT repo with release `v0.1.0` and later. The updater logs an unreachable feed as one WRN line.
- The receiver gets a bitstream for TrueHD, E-AC-3, DTS and DTS-HD, with PipeWire's attribute-suffixed format strings.
- When mpv does not start, the screen shows mpv's own fatal line.
- `apps/desktop/src/main/host/` is the only code that names a platform. `scripts/lint-host.ts` enforces it.
- Without a keyring, the session goes to a 0600 file, and Settings says so. A restart goes straight to the library.
- The fidelity engine picks `--target-colorspace-hint` from `hdrSignalling`. An output smaller than the video is a reported downgrade.
- The AppImage carries harakiri's own mpv 0.42 + libplacebo 7.387 + FFmpeg 9 + SDL2. Dev, tests and e2e run the same build. No system mpv is needed anywhere.
- A Dolby Vision 7 enhancement layer is applied, and a dropped one is reported from mpv's own report.
- On first start with Steam present, a card offers "Add to Steam". The shortcut clears `LD_PRELOAD`, so the UI is GPU-rendered.
- A declared microVM guest runs e2e and a platform tier. The HTPC is an opt-in `mise run htpc:check`.
- The PRD names Steam Game Mode as the main target, with acceptance criteria. The README has a "Steam Game Mode" section.

## Implementation Overview

- [ ] Phase 1: First public release, and the updater stays quiet about an unreachable feed (#15)
- [ ] Phase 2: Bitstream works with PipeWire's attribute-suffixed formats (#8)
- [ ] Phase 3: When mpv does not start, the screen shows mpv's reason (#12)
- [ ] Phase 4: A declared microVM guest runs e2e and the first platform checks
- [ ] Phase 5: Host capabilities arrive with the keyring-less session (#11)
- [ ] Phase 6: The picture plan picks the HDR hint and reports a downscale (#9, #20)
- [ ] Phase 7: Dev, tests and e2e run harakiri's own mpv build (#13, #17)
- [ ] Phase 8: The AppImage ships the bundled mpv (#2, #14)
- [ ] Phase 9: The Dolby Vision 7 enhancement layer is applied and reported
- [ ] Phase 10: harakiri adds itself to Steam, and the shortcut clears the overlay preload (#10, #20)
- [ ] Phase 11: Steam Game Mode is the documented main target, with an HTPC check (#14, #20)

---

## Phase 1: First public release, and the updater stays quiet about an unreachable feed (#15)

Per Q10, the repo goes public and release-please cuts `v0.1.0` before anything else lands. From then on the HTPC gets each phase through the updater. Until Phase 8, the release still needs a system mpv, and the README says so.

### Change Outline

The code change is one branch in the update controller. A 404 or 401 from the feed becomes one WRN line with no stack. Every other error keeps today's path.

```diff
 LICENSE                              + MIT (Q4a)
 README.md                            ~ install: "needs a system mpv until the bundled build ships"; licence line
 apps/desktop/src/main/
 ├── updates.ts                       ~ on "error": feedUnreachable(error) → status failed, no ERR
 ├── updater.ts                       ~ electron-updater's own logger: 404/401 lines go to debug, not ERR
 └── updates.test.ts                  + 404 and 401 give one WRN "update feed unreachable", no stack
 apps/desktop/package.json            ~ "license": "MIT"
```

```text
on updater "error"(err)
  if feedUnreachable(err)            # HTTP 404 or 401 from the release feed
    logger.warn("update feed unreachable ({status}); tries again later")
  else
    logger.error(... today's message ...)
  status = {state: "failed", message}   # Settings keeps "tries again later"
```

### Validation

#### Automated Verification

- [ ] `mise run check`
- [ ] `mise run package && mise run package:check`

#### Manual Verification

- [ ] The owner makes the repo public and merges the release-please PR. `gh release view v0.1.0` lists `harakiri-x86_64.AppImage` and `latest-linux.yml`.
- [ ] On the HTPC, the AppImage from the release starts (with the existing distrobox mpv wrapper), and the updater logs no ERR.

---

## Phase 2: Bitstream works with PipeWire's attribute-suffixed formats (#8)

The parser matches on the encoding before the first comma. The fixture is real pactl output from the fake `iec958_*` sink (research §13.2), so the test holds the exact shape the HTPC produces.

### Change Outline

```diff
 apps/desktop/src/main/player/
 ├── audio-output.ts                  ~ encodingOf(format) = format.split(",")[0].trim() before CODEC_BY_FORMAT
 ├── audio-output.test.ts             + parses the recorded fake-sink JSON → [ac3, eac3, truehd, dts, dts-hd]
 └── fixtures/
+    └── pactl-fake-spdif.json        + `pactl --format=json list sinks` from the fake iec958 sink, scrubbed
```

```diff
 const bitstream = [...new Set(sink.formats.flatMap((format) =>
-  CODEC_BY_FORMAT.get(format) ?? []))];
+  CODEC_BY_FORMAT.get(encodingOf(format)) ?? []))];
```

### Validation

#### Automated Verification

- [ ] `bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/audio-output.test.ts`
- [ ] `mise run check`

#### Manual Verification

- [ ] On the HTPC, after the updater installs this release, a TrueHD film shows Dolby TrueHD on the receiver, and the run log shows `--audio-spdif=…truehd…`.

---

## Phase 3: When mpv does not start, the screen shows mpv's reason (#12)

`spawnMpv` keeps a redacted tail of mpv's output. On an early exit, the start error carries the lines that look fatal. The player logs them at ERR, and the screening screen already shows `error.message`, so the renderer needs no new code.

### Change Outline

The error type is the contract between `packages/mpv` and the player:

```ts
// packages/mpv/src/client.ts
export class MpvStartError extends Error {
  readonly exitCode: number | string | null;
  /** Redacted lines from mpv's last 20 that match /Error|Fatal|failed/, oldest first. */
  readonly fatal: readonly string[];
}
// message: fatal.join(" ") when non-empty, else today's "mpv exited before its IPC socket was ready (code N)"
```

```diff
 packages/mpv/src/
 ├── client.ts                        ~ ring buffer of 20 redacted lines; exit → MpvStartError
 └── client.test.ts                   + stand-in binaries: "echo Error parsing option …; exit 1" → fatal line in message
                                      + `exit 1` with no output → today's message; missing binary → ENOENT kept
 apps/desktop/src/main/player/
 └── playback.ts                      ~ logs MpvStartError.fatal at ERR
 apps/desktop/e2e/
 └── screening.spec.ts                + HARAKIRI_MPV_ARGS with an unknown option → screen reads mpv's "option not found" line
```

### Validation

#### Automated Verification

- [ ] `bun x vitest run --maxWorkers=2 packages/mpv/src/client.test.ts`
- [ ] `mise run check`
- [ ] `mise run e2e`

---

## Phase 4: A declared microVM guest runs e2e and the first platform checks

Per Q11, platform bugs are reproduced in a declared guest, not on the dev box. This phase brings the guest in with checks that would have caught #8 and #13, and moves e2e into it. Later phases add their own platform checks here.

### Change Outline

The guest is a `fedora:44` smolvm machine with KWin, lavapipe, PipeWire with the fake `iec958_null` sink, and a uinput pad. Its state is off `/tmp`, it has 4 GiB, and it runs under `scripts/bounded.sh`.

```diff
 dev/vm/
+├── guest.sh                         + up / down / exec: smolvm machine under bounded.sh, state in .cache/vm
+├── provision.sh                     + dnf: kwin, mesa-vulkan-drivers, pipewire, wireplumber, pipewire-pulse, mpv (until Phase 7)
+├── pipewire/fake-spdif.conf         + api.alsa.pcm.sink on iec958_null, iec958.codecs = [ PCM AC3 EAC3 TrueHD DTS DTS-HD ]
+├── asoundrc                         + pcm.iec958_null { type null }
+└── pad.py                           + python-evdev UInput "Microsoft X-Box 360 pad" (045e:028e)
 vitest.shared.ts                     ~ TIERS.platform = "**/*.platform.test.{ts,tsx}"
 vitest.tiers.config.ts               ~ platform project
 mise.toml                            + vm:up, vm:down, test:platform; ~ e2e runs headless.sh inside the guest
 apps/desktop/src/main/player/
+└── audio-output.platform.test.ts    + real readAudioOutput() on the fake sink → bitstream has all five codecs
 packages/mpv/src/
+└── gamepad.platform.test.ts         + pad presses BTN_SOUTH → mpv with input.conf "GAMEPAD_ACTION_DOWN quit 42" exits 42
 CLAUDE.md                            ~ "How work is verified": guest, platform tier
```

A platform test outside the guest throws and names `mise run test:platform`, like the other tiers.

```text
mise run test:platform
  dev/vm/guest.sh up            # provision once, cached
  dev/vm/guest.sh exec -- bun x vitest run --config vitest.tiers.config.ts --project 'platform:*' --maxWorkers=2
```

### Validation

#### Automated Verification

- [ ] `mise run test:platform`. Revert Phase 2's `encodingOf` locally once to see the fake-sink test fail.
- [ ] `mise run e2e` passes inside the guest.
- [ ] `mise run check` stays offline and does not boot the guest.
- [ ] `mise run lint:skips`

#### Manual Verification

- [ ] `mise run watchdog` while `mise run e2e` runs: the guest stays inside `harakiri.slice` and the 7 GB cap.

---

## Phase 5: Host capabilities arrive with the keyring-less session (#11)

The capability layer (Q2) comes in with its first consumer. `readHostFacts` reads the platform once. `capabilitiesOf` answers `secretStore`, and the session store asks only that. The e2e plaintext branch goes away, so e2e takes the same branch as Game Mode.

### Change Outline

The two types are the contract that every later phase extends:

```ts
// apps/desktop/src/main/host/facts.ts: the only reader of XDG_*, GAMESCOPE_*, Steam*, LD_PRELOAD
type HostFacts = {
  gamescopeDisplay: string | undefined;   // GAMESCOPE_WAYLAND_DISPLAY
  waylandDisplay: string | undefined;     // WAYLAND_DISPLAY
  desktop: readonly string[];             // XDG_CURRENT_DESKTOP, split on ':'
  secretBackend: string;                  // safeStorage.getSelectedStorageBackend()
};
export const readHostFacts = (env: NodeJS.ProcessEnv, safeStorage: SafeStorageProbe): HostFacts

// apps/desktop/src/main/host/capabilities.ts
type HostCapabilities = { secretStore: "keyring" | "file" };   // Phase 6 adds hdrSignalling, Phase 10 steamLibrary
export const capabilitiesOf = (facts: HostFacts): HostCapabilities
```

```diff
 apps/desktop/src/main/
+├── host/
+│   ├── facts.ts / capabilities.ts
+│   ├── host.test.ts                 + recorded Game Mode env → secretStore "file"; KDE env → "keyring"
+│   └── fixtures/gamescope-env.json  + scrubbed Game Mode environment from the HTPC
 ├── index.ts                         ~ first log line carries facts and capabilities
 ├── session.ts                       ~ async safeStorage; "file" → {kind: "obfuscated"} 0600; INFO once
 │                                    - allowPlaintextToken and the memory-only branch
 ├── session.test.ts                  ~ obfuscated round trip with a fake basic_text crypto; plain branch removed
 └── ipc.ts                           ~ sessionGet returns { ...session, storage: "keyring" | "file" }
 apps/desktop/src/renderer/src/settings/
 └── settings-screen.tsx              + "Signed in on this device without a keyring" when storage is "file"
 apps/desktop/e2e/
 ├── support/harakiri.ts              ~ launches with the recorded no-keyring env, no plaintext flag
 └── session.spec.ts                  ~ restart goes to the library through the obfuscated file; Settings shows the line
 apps/desktop/src/main/
+└── session.platform.test.ts         + guest: built app with the Game Mode env, sign in, restart → library
+scripts/lint-host.ts                 + platform names and host env reads only under main/host/ (tests, fixtures, docs exempt)
 hk.pkl, mise.toml                    + lint-host step; part of `check`
 CLAUDE.md                            + rule row: "No feature code names a platform" → scripts/lint-host.ts
 docs/PRD.md                          ~ onboarding: the no-keyring sentence
```

```diff
 save(session)
-  if encryptionUsable()          -> {kind: "encrypted", base64}
-  else if allowPlaintextToken    -> {kind: "plain", value}
-  else                           -> memory only, rm session.json
+  if secretStore == "keyring"    -> {kind: "encrypted", base64: encryptStringAsync}
+  else                           -> {kind: "obfuscated", base64: encryptStringAsync}   # basic_text, 0600
```

The Settings line is web UI, so it goes through the impeccable loop.

### Validation

#### Automated Verification

- [ ] `bun x vitest run --maxWorkers=2 apps/desktop/src/main/host apps/desktop/src/main/session.test.ts`
- [ ] `mise run check`. It now runs `lint-host`. Add `process.env.XDG_CURRENT_DESKTOP` to a feature file to see it fail.
- [ ] `mise run e2e`
- [ ] `mise run test:platform`

#### Manual Verification

- [ ] On the HTPC in Game Mode, sign in, quit, and launch again: harakiri opens on the library. Settings shows the no-keyring line.

---

## Phase 6: The picture plan picks the HDR hint and reports a downscale (#9, #20)

Q7 and Q9 both land in `packages/fidelity` as scenarios with one reviewed `compatibility.md` diff. The capability layer gains `hdrSignalling`. The engine turns it into `colorspaceHint`, and `playback.ts` passes that through the existing `PlaybackConfig.colorspaceHint` seam.

### Change Outline

The engine's inputs and outputs:

```diff
 // packages/fidelity/src/model.ts, picture.ts
 type PictureWorld = {
   display: "hdr" | "sdr" | "unknown";
   renderer: …;
+  hdrSignalling: "colour-management" | "swapchain-formats";
 };
 type PicturePlan = {
   …
+  colorspaceHint: "auto" | "yes";     // auto for colour-management, yes for swapchain-formats
 };
 type Observation =
   | { kind: "displayTarget"; hdr: boolean }
+  | { kind: "outputSize"; width: number; height: number }   // osd-dimensions, compared with the video size
 type DowngradeReason =
+  | { kind: "scaledDown"; width: number; height: number }   // "Scaled down to 1920×1080 by the output"
```

```diff
 packages/fidelity/src/
 ├── model.ts / picture.ts / engine.ts  ~ the shapes above
 ├── scenarios.ts                       + HDR via swapchain formats, HDR on (PQ, kept) / off ("The display takes SDR only")
 │                                      + 4K video on a 1080p output (scaled down)
 └── engine.test.ts                     + hint per signalling; outputSize smaller → scaledDown, equal → none
 docs/fidelity/compatibility.md         ~ regenerated; the diff is the behaviour change
 apps/desktop/src/main/
 ├── host/capabilities.ts               + hdrSignalling: gamescopeDisplay set and waylandDisplay unset → "swapchain-formats"
 ├── host/host.test.ts                  + Game Mode env → swapchain-formats; KDE env → colour-management
 └── player/
     ├── fidelity-input.ts              ~ PictureWorld.hdrSignalling from capabilities
     ├── fidelity-watch.ts              + samples osd-dimensions → outputSize on change
     ├── fidelity-watch.test.ts         + fakeMpv with osd-dimensions 1920×1080 on a 3840×2160 file
     ├── playback.ts                    ~ buildPlaybackArgs({ …, colorspaceHint: plan.picture.colorspaceHint })
     └── index.ts                       ~ createPlayer({ …, capabilities: () => hostCapabilities })
```

### Validation

#### Automated Verification

- [ ] `mise run fidelity:table`, then review the `docs/fidelity/compatibility.md` diff
- [ ] `mise run check` (`table.test.ts` fails until the diff is committed)
- [ ] `mise run e2e`: `player.hdr.spec.ts` under KWin still spawns with `auto`

#### Manual Verification

- [ ] On the HTPC with Steam's HDR on, an HDR10 film reaches the TV as HDR (TV info banner), and the player shows no downgrade. With Steam's HDR off, it reports "The display takes SDR only".
- [ ] Per Q9, re-check `Display 0 (gamescope)` in the run log. A 1080p output on the 4K TV shows "Scaled down to 1920×1080 by the output".

---

## Phase 7: Dev, tests and e2e run harakiri's own mpv build (#13, #17)

Per Q3, Q4 and Q12, a pinned container recipe builds mpv 0.42 + libplacebo 7.387 + FFmpeg 9 + SDL2. Everything that runs mpv in dev and tests resolves that build. Shipping it in the AppImage is Phase 8. The 0.42 rechecks from Q4 land here, because this is where the tests first run 0.42.

### Change Outline

The recipe and its output. The output is cached by recipe hash, so a changed pin rebuilds and an unchanged one is free.

```diff
+mpv/
+├── Containerfile                    + pinned base; mpv 0.42.x, libplacebo 7.387.0, FFmpeg 9.x (--enable-gpl, no nonfree), SDL2
+├── build.sh                         + meson -Dsdl2-gamepad=enabled -Dlibmpv=false; private libs with rpath $ORIGIN/lib
+├── versions.env                     + exact versions and tarball sha256s (also the GPL source list in Phase 8)
+└── host-libs.txt                    + allowlist: Vulkan loader, GPU driver, PipeWire, libwayland, X11, glibc
 mise.toml                            + mpv:build (bounded, podman --memory) → .cache/mpv/<recipe-hash>/{mpv, lib/}
                                      ~ setup runs mpv:build; doctor no longer checks mpv
```

One resolver answers "which mpv". `packages/mpv` owns the dev path, so tests in every package use it. The desktop adds the override and, in Phase 8, the packaged path.

```ts
// packages/mpv/src/bundle.ts
/** The built bundle for this checkout; throws naming `mise run mpv:build` when it is missing. */
export const bundledMpv = (): string

// apps/desktop/src/main/player/mpv-binary.ts
export const mpvBinary = (): string   // HARAKIRI_MPV ?? bundledMpv()   (packaged path added in Phase 8)
```

```diff
 packages/mpv/src/
+├── bundle.ts
 ├── client.test.ts                   ~ spawns bundledMpv()
 └── gamepad.platform.test.ts         ~ the guest runs the bundle, not Fedora's mpv
 packages/harness/src/
 ├── audio/mpv-capture.ts             ~ bundledMpv() instead of "mpv" on PATH
 ├── doctor.ts                        - mpv and libplacebo checks; harness tools only (#17 for player installs)
 └── doctor.test.ts                   ~ CHECKS has no mpv entry
 apps/desktop/src/main/
 ├── env.ts                           + HARAKIRI_MPV (a developer's mpv, e.g. master)
 └── player/
+    ├── mpv-binary.ts
     ├── playback.ts                  ~ spawnMpv({ binary: deps.mpvBinary(), … })
     │                                + TLS certificate failure → "The server's certificate is not trusted"
     └── playback.local.test.ts       ~ finds the bundled mpv child; headers over libcurl; self-signed server → the sentence
 apps/desktop/e2e/support/            ~ the app resolves the bundle; lavapipe device unchanged
 dev/vm/provision.sh                  - Fedora mpv
 README.md, CLAUDE.md                 ~ onboarding drops system mpv; video row → bundled mpv 0.42 / libplacebo 7.387 / FFmpeg 9
```

### Validation

#### Automated Verification

- [ ] `mise run mpv:build`, then `.cache/mpv/<hash>/mpv -v` lists `-Dsdl2-gamepad=enabled`
- [ ] `mise run check`
- [ ] `scripts/bounded.sh local 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/playback.local.test.ts` (secrets still absent from the real cmdline)
- [ ] `mise run test:platform`: the pad reaches the bundle's SDL gamepad
- [ ] `mise run e2e`, including `player.hdr.spec.ts` and `player.passthrough.spec.ts` on 0.42
- [ ] `mise run setup` on a machine with no system mpv and no weston fails only at the harness tools, and names them

#### Manual Verification

- [ ] `HARAKIRI_MPV=/usr/bin/mpv mise run dev` plays with the developer's mpv, and the run log names that binary.

---

## Phase 8: The AppImage ships the bundled mpv (#2, #14)

The packaged app finds mpv under `resources/mpv/`. `package:check` proves the build at release time (Q8), and the release carries the GPL sources (Q4a). After this phase the HTPC drops its distrobox, wrapper and layer copy.

### Change Outline

```diff
 apps/desktop/
 ├── electron-builder.yml             + extraResources: .cache/mpv/<hash>/ → mpv/
 └── src/main/player/mpv-binary.ts    ~ app.isPackaged → join(process.resourcesPath, "mpv", "mpv")
 scripts/check-release.ts             + extracts the AppImage, then on resources/mpv/mpv:
                                        -v (version pins, sdl2-gamepad), --list-options (input-gamepad),
                                        --vd=help (hevc, h264, vc1, av1), --ad=help (truehd, eac3, dca),
                                        ldd ⊆ mpv/host-libs.txt
 .github/workflows/release.yml        + builds the mpv recipe (cached by hash) before package
                                      + uploads the source tarballs and links the recipe in the release notes
 mise.toml                            + mpv:fetch (the release job's bundle by recipe hash, instead of building)
                                      + package:check-bazzite: podman run the Bazzite image, ldd and `mpv -v` on the bundle
 README.md                            ~ install: one AppImage, nothing else; GPL note for the bundled mpv
 docs/PRD.md                          ~ distribution: bundled mpv; drop "a bundled mpv (#2)" from not shipped
```

```text
mpvBinary()
  HARAKIRI_MPV set     → that path          (developers)
  app.isPackaged       → resources/mpv/mpv  (users)
  otherwise            → bundledMpv()       (dev, tests, e2e)
```

### Validation

#### Automated Verification

- [ ] `mise run package && mise run package:check`
- [ ] `mise run package:check-bazzite`
- [ ] `mise run check`
- [ ] `gh workflow run release.yml -f tag=<tag>` on a test tag: the job builds the bundle, and the release lists the source tarballs

#### Manual Verification

- [ ] On the HTPC, remove the distrobox wrapper from `PATH`, update through the updater, and play an HDR film with TrueHD from Game Mode. The run log shows `resources/mpv/mpv` and mpv 0.42.

---

## Phase 9: The Dolby Vision 7 enhancement layer is applied and reported

Q4 moves DV 7 FEL into scope. The bundle's FFmpeg 9 `dovi_split` and mpv 0.42's `gpu-next` apply it. The label now comes from mpv's report, not from Jellyfin's range type, so a dropped layer is a reported downgrade.

### Change Outline

```diff
 packages/fidelity/src/
 ├── model.ts                         + Observation {kind: "enhancementLayer", applied: boolean}
 │                                    + DowngradeReason {kind: "enhancementLayerDropped"}
 ├── picture.ts                       ~ the FEL label follows the observation
 └── scenarios.ts                     + "DV 7 FEL, layer applied" / "DV 7 FEL, layer dropped"
 docs/fidelity/compatibility.md       ~ regenerated
 apps/desktop/src/main/player/
 ├── fidelity-input.ts                - FEL label from Jellyfin's VideoRangeType
 ├── fidelity-watch.ts                + reads mpv's DV report → enhancementLayer
 └── fidelity-watch.test.ts           + fakeMpv reports with and without the layer
+└── dovi-fel.fate.test.ts            + bundled mpv on fate-dv-p7-fel → enhancementLayer applied
 docs/PRD.md                          ~ DV 7 FEL in scope; out of scope keeps only a native DV signal
```

### Validation

#### Automated Verification

- [ ] `mise run fidelity:table`, then review the diff
- [ ] `mise run test:fate`
- [ ] `mise run check`

#### Manual Verification

- [ ] On the HTPC, a DV 7 FEL file plays with no "enhancement layer dropped" line, with hardware decoding (NVDEC).

---

## Phase 10: harakiri adds itself to Steam, and the shortcut clears the overlay preload (#10, #20)

Per Q13, the first-party way to run harakiri in Game Mode is the shortcut harakiri creates. A launcher script does `unset LD_PRELOAD; exec <AppImage>`. Steam's own URL handler adds a hidden `.desktop` whose `Exec` is that script. harakiri then reads the app ID back from `shortcuts.vdf` and writes its artwork into `grid/`.

### Change Outline

The host layer learns where Steam is. Only `host/` reads Steam's paths.

```diff
 // host/facts.ts
+ steamRoot: string | undefined;                 // ~/.local/share/Steam or ~/.steam/steam, when userdata/ exists
+ steamUsers: readonly string[];                 // userdata/<id>/ with a config/
 // host/capabilities.ts
+ steamLibrary: "absent" | "present" | "has-harakiri";   // has-harakiri: shortcuts.vdf has an Exe equal to our script
```

The flow, one IPC call from the renderer:

```text
steam.add()
  writeLauncher(userData/steam/harakiri.sh, APPIMAGE)     # 0755, unset LD_PRELOAD; exec '<AppImage>' "$@"
  writeDesktopEntry(userData/steam/harakiri.desktop)      # NoDisplay=true, Exec=<script>
  touch /tmp/addnonsteamgamefile
  shell.openExternal("steam://addnonsteamgame/" + encodeURIComponent(desktopPath))
  wait for shortcuts.vdf to list the script (poll, 30 s)
  writeArtwork(userdata/<id>/config/grid/, appId)         # <appId>p.png, <appId>_hero.png, <appId>_logo.png, <appId>.png
  → {state: "added"} | {state: "timedOut"}

at startup
  if the launcher exists → rewrite it with the current APPIMAGE (a moved AppImage heals)
```

```diff
 apps/desktop/src/main/
 ├── host/facts.ts, capabilities.ts   ~ the fields above; host.test.ts with a fake Steam root
+├── steam-setup/
+│   ├── launcher.ts                   + script and .desktop text, writes, the heal at startup
+│   ├── shortcuts-vdf.ts              + binary VDF reader: entries with appid, Exe, AppName
+│   ├── artwork.ts                    + grid files from the packaged icon set (shipped by #23)
+│   ├── add.ts                        + the flow above, with injected openExternal and clock
+│   └── *.test.ts                     + script text, vdf fixture built in the test, the appid/Exe match, artwork names
 ├── ipc.ts / shared/bridge.ts        + steamStatus → steamLibrary; steamAdd → result
 └── index.ts                         ~ heals the launcher at startup
 apps/desktop/src/renderer/src/
 ├── library/                         + "Play harakiri from Steam" card when steamLibrary is "present" and not dismissed
 └── settings/settings-screen.tsx     + "Add to Steam" action when Steam is present
 apps/desktop/e2e/
+└── steam.spec.ts                    + fake HOME with a Steam root; card shows; Add writes script, .desktop, sentinel,
                                        requests the steam:// URL (stubbed); a fake vdf entry → grid files; card gone
 apps/desktop/src/main/steam-setup/
+└── launcher.platform.test.ts        + guest: run the written script with LD_PRELOAD=<fake .so> and the Game Mode env →
                                        harakiri's /proc/<pid>/environ has no LD_PRELOAD; same PID as the script
```

The card and the Settings action are web UI, so they go through the impeccable loop. "Not now" persists in renderer state. Settings keeps the action available.

### Validation

#### Automated Verification

- [ ] `bun x vitest run --maxWorkers=2 apps/desktop/src/main/steam-setup apps/desktop/src/main/host`
- [ ] `mise run check` (`lint-host` passes: the Steam paths live under `host/`)
- [ ] `mise run e2e` (`steam.spec.ts`)
- [ ] `mise run test:platform`

#### Manual Verification

These are the HTPC checks Q13 lists:

- [ ] In Desktop Mode and in Game Mode, "Add to Steam" adds harakiri with its artwork, and Steam needs no restart.
- [ ] Steam keeps the script as the shortcut's target.
- [ ] Launched from the shortcut, the run log has no `GPU process is gone` line, and the UI is GPU-rendered (`chrome://gpu` in a dev build, or the compositing line in the log).
- [ ] Steam shows harakiri as running. "Stop" closes harakiri and mpv, and nothing still shows as running after harakiri quits.
- [ ] The Quick Access menu still opens over harakiri and mpv.

---

## Phase 11: Steam Game Mode is the documented main target, with an HTPC check (#14, #20)

The PRD and README catch up with the end state (Q1). The HTPC checks from Phases 6 to 10 become one opt-in, env-configured checklist, like `JELLYFIN_DEV_LIBRARY=own`. Closing #20 is the end of the epic.

### Change Outline

```diff
 docs/PRD.md                          ~ main target: Steam Game Mode on Bazzite; KDE Plasma on Wayland stays supported and the dev platform
                                      + acceptance: GPU-rendered launch from Steam, sign in once, HDR10 at the TV with
                                        Steam's HDR on, bitstream at the receiver, a reason for every downgrade
                                      ~ harness tiers: platform tier in the guest; HTPC as the opt-in final check
 README.md                            + "Steam Game Mode": download, add to Steam from harakiri, what Steam settings stay default
                                      ~ platform badge
+scripts/htpc-check.ts                + prompts through the checklist on the target, reads the latest run log for
                                        LD_PRELOAD, GPU process crashes, the colorspace hint, --audio-spdif, mpv version;
                                        writes a dated result under .cache/htpc
 mise.toml                            + htpc:check (needs HARAKIRI_HTPC=1 in .env; throws naming it otherwise)
 CLAUDE.md                            ~ intro and "How work is verified" name the main target and the HTPC check
```

### Validation

#### Automated Verification

- [ ] `mise run check` (`lint-private` passes on the new README and PRD text)
- [ ] `mise run htpc:check` without `HARAKIRI_HTPC` fails and names the variable

#### Manual Verification

- [ ] On the HTPC, `mise run htpc:check` passes every item, and the result is attached to #20.
- [ ] A fresh Bazzite user account follows only the README's "Steam Game Mode" section and plays a film from the couch.

---

## Open Questions

- **Network for the default tier.** After Phase 7, `client.test.ts` in `mise run check` needs a built bundle. Building it needs the network once. Is a cached `.cache/mpv/<hash>` like the corpus acceptable under "check never needs the network"? Or should those tests move to a `*.local` tier that throws naming `mise run mpv:build`?
- **Jellyfin from inside the guest.** Phase 4's e2e in the guest needs the e2e Jellyfin. Does the guest reach the host's container at 127.0.0.1:8296 through smolvm's networking, or does podman run inside the guest? Can the guest mount the worktree to run vitest there?
- **mpv's DV FEL report.** Phase 9 needs the property or log line through which mpv 0.42 says the enhancement layer was applied. That is not yet identified.
- **Steam artwork sizes.** Phase 10 assumes the icon set from #23 can produce the grid, hero and logo images. A grid or hero image may need new art at Steam's sizes.
