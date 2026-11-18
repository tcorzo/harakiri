---
task: 2026-11-17-ci-release-packaging
type: structure-outline
repo: harakiri
branch: tcorzo/package
sha: 9485899d7ea5f3d2e015431032e5e78a2ea7e7fa
---

**Repos touched:** `harakiri`

# CI release packaging and self auto-update

Merging a release-please release PR builds the Linux AppImage on CI and attaches it, with `latest-linux.yml`, to the GitHub release. An installed AppImage finds the new release, downloads it while nothing plays, and swaps itself in during the existing quit protocol. Settings shows the update state and offers "Restart to update".

## Desired End State

- `mise run package` builds the AppImage locally, and `mise run package:check` proves its update metadata matches the file and the version.
- Every merge to `main` keeps a release PR open with the next version, the changelog and a synced `bun.lock`. Merging it tags `vX.Y.Z`, creates the release, and CI uploads the AppImage and `latest-linux.yml` to it.
- `docs/decisions/autonomous-run.md` and every reference to it are gone, `docs/PRD.md` has a "Distribution and updates" section, and the repo is public.
- A harakiri AppImage checks at startup and every 6 h, downloads only while idle, and installs after mpv stops on the next quit.
- Settings shows the update state, and "Restart to update" installs and reopens the app through the same quit path.

## Implementation Overview

- [ ] Phase 1: `mise run package` builds a checked AppImage
- [ ] Phase 2: Merging a release PR publishes the AppImage
- [ ] Phase 3: An installed AppImage updates itself on quit
- [ ] Phase 4: Settings shows the update and restarts into it

Phases 1 and 2 ship before 3 and 4 (a separate PR, or the bottom of a stack). Phase 3's manual check needs a published public release with a higher version than the local build.

---

## Phase 1: `mise run package` builds a checked AppImage

Nothing has ever run `bun run package`. This phase makes it a mise task that the owner and CI share, makes the build publish-ready (a GitHub feed embedded as `app-update.yml`, no implicit publishing), and adds a check that fails when the metadata does not describe the file. Running the AppImage once on Fedora 44 answers the research's open questions 2 and 3 before CI depends on the build.

```diff
 apps/desktop/
 ├── electron-builder.yml
+│     ~ publish: { provider: github, owner: tcorzo, repo: harakiri }
+│     ~ linux.target: AppImage, arch x64
+│     ~ artifactName: harakiri-${arch}.AppImage   # no version, see below
 └── package.json
+      ~ "package": "electron-vite build && electron-builder --linux AppImage --x64 --publish never"
 mise.toml
+  [tasks.package]          # dir apps/desktop; bounded.sh package 4G -- bun run package
+  [tasks."package:check"]  # bun scripts/check-release.ts apps/desktop/dist
 scripts/
+└── check-release.ts       + asserts dist matches the version in apps/desktop/package.json
```

The artifact name carries no version. This differs from the design file tree. `AppImageUpdater` overwrites the running file in place only when the old name has no `x.y.z` in it. A versioned name makes every update write a new file and leave the user's launcher pointing at a deleted path (`AppImageUpdater.js` in electron-updater 6.8.11).

`--publish never` stops electron-builder 26's implicit publish on CI and on tags. The `publish` block still makes it write `latest-linux.yml` and embed `resources/app-update.yml`.

```text
check-release.ts [dist] [--version x.y.z]   (version defaults to apps/desktop/package.json)
  meta = Bun.YAML.parse(dist/latest-linux.yml)
  fail unless meta.version == version
  file = dist/<meta.files[0].url>; fail unless it exists
  fail unless meta.files[0].sha512 == base64(sha512(file)) and size matches
  fail unless `file --appimage-extract resources/app-update.yml` yields provider github, tcorzo/harakiri
  print one line per check
```

### Validation

#### Automated Verification

- [ ] `mise run package` exits 0 and writes `apps/desktop/dist/harakiri-x86_64.AppImage` and `latest-linux.yml`
- [ ] `mise run package:check` passes
- [ ] `mise run package:check -- --version 9.9.9` fails, naming the version mismatch
- [ ] `mise run check`

#### Manual Verification

- [ ] On Fedora 44, `./harakiri-x86_64.AppImage` starts fullscreen, signs in to the dev Jellyfin, and plays a corpus file through the system mpv. This settles whether the bun collector packed every runtime dep and whether FUSE 2 works.

---

## Phase 2: Merging a release PR publishes the AppImage

This phase connects release-please to Phase 1's task. It uses one workflow file and the default token. The package job is gated on `release_created`, because events from `GITHUB_TOKEN` start no other workflow. The same phase clears the repo for going public, since the update feed in Phase 3 is the public `github` provider.

```diff
 .github/workflows/
 ├── pr-title.yml
+└── release.yml                   + release-please job, package job, workflow_dispatch rebuild
+release-please-config.json        + root ".", simple, v-tags, bump-minor-pre-major, extra-files → apps/desktop/package.json
+.release-please-manifest.json     + { ".": "0.1.0" }
 CLAUDE.md                         ~ drop the autonomous-run.md bullet; mention release.yml under "How work is verified"
 docs/
 ├── PRD.md                        ~ + "Distribution and updates"; drop both autonomous-run.md references
-├── decisions/autonomous-run.md
 └── reviews/
     ├── 01-foundation.md          ~ fix the stale NAS-path note
     └── 03-fix-wave.md            ~ reword the D16 reference
```

`CHANGELOG.md` is not written by hand. release-please creates it in the first release PR.

The workflow has two jobs. The release-please job also keeps `bun.lock` in step with the version it bumps (design Q10). The package job reuses the exact commands from Phase 1.

```text
release.yml
on: push main | workflow_dispatch { tag }
concurrency: release (no cancel)
permissions: contents write, pull-requests write, issues write

job release-please   (skipped on workflow_dispatch)
  googleapis/release-please-action@v5 → id rp
  if rp.outputs.pr is set:
    checkout fromJSON(rp.outputs.pr).headBranchName
    mise-action (bun) → bun install
    if bun.lock changed: commit "chore: sync bun.lock", push
  outputs: release_created, tag_name

job package
  needs: release-please   if: release_created == 'true' || workflow_dispatch
  runs-on: ubuntu-24.04            # pinned; older glibc keeps the AppImage portable
  TAG = tag_name or inputs.tag     (through env, never interpolated into run:)
  checkout ref TAG
  mise-action (bun node hk) → bun install --frozen-lockfile
  mise run lint, lint:skips, lint:private, typecheck
  mise run package
  mise run package:check -- --version ${TAG#v}
  gh release upload "$TAG" dist/harakiri-x86_64.AppImage dist/latest-linux.yml --clobber
```

The PRD section stays short. It names the AppImage as the only artifact, the public GitHub release as the update feed, system mpv as a requirement, and the "not doing" list from the design (Flatpak, other packages, signing, channels).

### Validation

#### Automated Verification

- [ ] `mise x actionlint@1.7.12 -- actionlint .github/workflows/release.yml`
- [ ] After pushing the branch: `bun x release-please@17.6.0 release-pr --dry-run --repo-url tcorzo/harakiri --target-branch tcorzo/package --token "$(gh auth token)"` proposes `0.2.0`, and its diff bumps `apps/desktop/package.json` and the manifest
- [ ] `git grep -n autonomous-run -- ':!docs/tasks'` prints nothing
- [ ] `mise run check` (`lint:private` passes on the edited docs)

#### Manual Verification

- [ ] The owner makes `tcorzo/harakiri` public and enables "Allow GitHub Actions to create and approve pull requests"
- [ ] After merge, a release PR opens with the version, `CHANGELOG.md`, `apps/desktop/package.json` and a synced `bun.lock`
- [ ] Merging it creates `v0.2.0`. The package job uploads both assets, and `curl -sL https://github.com/tcorzo/harakiri/releases/latest/download/latest-linux.yml` (no token) shows `version: 0.2.0`
- [ ] `gh workflow run release.yml -f tag=v0.2.0` re-uploads the same assets without error

---

## Phase 3: An installed AppImage updates itself on quit

This phase covers the main process only. A controller wraps electron-updater behind a narrow interface, as `lifecycle.ts` wraps `app`. The quit hold gets an `afterStop` step, so the install runs after mpv has stopped and before `app.exit(0)`.

The planning check that design Q8 asked for, done against `electron-updater@6.8.11`:

- `autoInstallOnAppQuit` installs from `app.once("quit")`, which `app.exit(0)` skips. So it must be `false`, and our hold must install.
- `quitAndInstall()` schedules its own `app.quit()`. The controller calls the public, synchronous `install(isSilent, isForceRunAfter)` instead, from inside the hold.

```diff
 apps/desktop/
 ├── package.json                      ~ + electron-updater 6.8.11
 └── src/
     ├── shared/bridge.ts              ~ + UpdateStatus zod union (the contract Phase 4 sends)
     └── main/
         ├── env.ts                    ~ + APPIMAGE: optional string
         ├── updates.ts                + controller over UpdaterLike
         ├── updates.test.ts           + fake updater, fake timers
         ├── lifecycle.ts              ~ holdQuitUntilStopped(app, stop, { capMs?, afterStop? })
         ├── lifecycle.test.ts         ~ afterStop order; a throwing afterStop still exits
         ├── player/index.ts           ~ + isPlaying()
         └── index.ts                  ~ wires the real autoUpdater into main()
```

`UpdateStatus` is the same union the design names (`unsupported | idle | available | downloading | ready | failed`). The controller's surface:

```ts
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: { info(m: string): void; warn(m: string): void; error(m: string): void } | null;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  install(isSilent: boolean, isForceRunAfter: boolean): boolean;
  on(
    event: "update-available" | "update-downloaded",
    l: (info: { version: string }) => void,
  ): unknown;
  on(event: "download-progress", l: (p: { percent: number }) => void): unknown;
  on(event: "error", l: (e: Error) => void): unknown;
}

export interface Updates {
  status(): UpdateStatus;
  installIfReady(): void;
}

export function startUpdates(
  updater: UpdaterLike,
  deps: {
    appImage: string | undefined;
    isPlaying(): boolean;
    releaseLock(): void;
    checkEveryMs?: number /* 6 h */;
    idlePollMs?: number /* 60 s */;
  },
): Updates;
```

The behavior. A download deferred by playback is retried on a short idle poll, so the player needs no new hook.

```text
startUpdates
  if no appImage: status = unsupported; return     # dev, e2e, unpackaged
  autoDownload = false; autoInstallOnAppQuit = false
  logger = logtape ["harakiri", "updates"]
  check now; check every checkEveryMs
  every idlePollMs: if status is available and not isPlaying(): download
  update-available(v)   → available(v); download now if not isPlaying()
  download-progress(p)  → downloading(v, p.percent)
  update-downloaded(v)  → ready(v)
  error(e)              → log; failed(e.message); the next check retries

installIfReady(relaunch = false)
  if status is not ready: return
  if relaunch: releaseLock()          # the relaunched AppImage must win the single-instance lock
  updater.install(true, relaunch)
```

```diff
 on before-quit(event)
   event.preventDefault()
   if already stopping: return
   stopping = true
   result = race(player.stop(), capMs)
   if result is timed-out: log warning
+  try afterStop() catch log error     # an install failure never blocks the exit
   app.exit(0)
```

```diff
 main()
   …
-  holdQuitUntilStopped(app, player.stop)
+  let updates: Updates | undefined
+  holdQuitUntilStopped(app, player.stop, { afterStop: () => updates?.installIfReady() })
   await app.whenReady()
+  updates = startUpdates(autoUpdater, { appImage: env.APPIMAGE, isPlaying: player.isPlaying,
+                                        releaseLock: () => app.releaseSingleInstanceLock() })
   installContentSecurityPolicy, registerIpc, createWindow
```

The hold is registered before `whenReady`, as it is today. The first check starts after `whenReady`, because electron-updater makes its requests through Electron's network stack. `autoUpdater` comes from `import pkg from "electron-updater"; const { autoUpdater } = pkg`, because the main bundle is ESM and the package is CJS.

### Validation

#### Automated Verification

- [ ] `mise run test`: `updates.test.ts` covers unsupported (no `checkForUpdates` call), flags set to false, no download while playing, a download on the idle poll once playback stops, progress → downloading → ready, `installIfReady` calling `install(true, false)` only when ready, and error → failed → retry on the next check. `lifecycle.test.ts` covers `afterStop` running after stop and before exit, and a throwing `afterStop` that still exits.
- [ ] `mise run typecheck`, `mise run lint`
- [ ] `mise run e2e`: unchanged specs pass (no `APPIMAGE`, so updates stay `unsupported` and make no network call), including the no-mpv-left teardown check
- [ ] `mise run package && mise run package:check`, and `--appimage-extract` lists `resources/app.asar` containing `node_modules/electron-updater`

#### Manual Verification

- [ ] With `v0.2.0` public and the local build still at `0.1.0`, start the AppImage. The run log shows the update found and downloaded. Quit: the file at the same path is replaced, quit returns promptly, and the next start logs `harakiri 0.2.0`.
- [ ] Start a play before the download finishes. The run log shows no download until playback stops.

---

## Phase 4: Settings shows the update and restarts into it

This phase adds the five-file IPC path, two invokes and no push, and the Settings change. "Restart to update" sets the relaunch flag and calls `app.quit()`, so it goes through the Phase 3 hold.

```diff
 apps/desktop/src/
 ├── shared/bridge.ts                 ~ channels updateStatus "updates:status", updateRestart "updates:restart"
 │                                      ~ HarakiriBridge.updates { status(), restart() }
 ├── preload/
 │   ├── bridge.ts                    ~ invoke + zod-parse both
 │   └── bridge.test.ts               ~ fakeIpc cases for both
 ├── main/
 │   ├── ipc.ts                       ~ registerIpc(isAppUrl, updates): two handles behind fromAppOnly
 │   ├── updates.ts                   ~ + restart(): if ready, relaunch = true; quit()
 │   ├── updates.test.ts              ~ restart → quit only when ready; afterStop installs with (true, true)
 │   └── index.ts                     ~ quit: () => app.quit() dep; pass updates to registerIpc
 └── renderer/src/settings/
     ├── SettingsScreen.tsx           ~ status in the App row; Restart action when ready
     └── SettingsScreen.test.tsx      + one render per status (happy-dom, like ServerDecision.test.tsx)
 apps/desktop/e2e/onboarding.spec.ts  ~ Settings shows "Version x.y.z" and no Restart row
```

```diff
 <SettingsScreen>
+  useQuery(["updates"], window.harakiri.updates.status, { refetchInterval: 1000 })
   <dl>
     <dt>App</dt>
-    <dd>Version {appVersion}</dd>
+    <dd>Version {appVersion}{statusText(status)}</dd>
   </dl>
   <ListAction label="Sign out" />
   <ListAction label="Change server" />
+  {status.state === "ready" &&
+    <ListAction label="Restart to update" detail={`Installs ${status.version} and opens harakiri again`}
+                onPress={() => window.harakiri.updates.restart()} />}
```

| status      | appended to "Version x.y.z"                  |
| ----------- | -------------------------------------------- |
| unsupported | nothing                                      |
| idle        | · up to date                                 |
| available   | · 0.3.0 found, downloads when playback stops |
| downloading | · 0.3.0 downloading 42%                      |
| ready       | · 0.3.0 ready, installs when you quit        |
| failed      | · update check failed                        |

The impeccable loop decides the final copy and layout: craft floor before the edit, then the detector, critique and audit on the diff.

### Validation

#### Automated Verification

- [ ] `mise run test`: bridge, controller and Settings tests
- [ ] `mise run typecheck`, `mise run lint`
- [ ] `mise run e2e`: Settings renders through the real IPC path, with sender checks and no Restart row while unsupported
- [ ] The impeccable detector reports no findings on `SettingsScreen.tsx`

#### Manual Verification

- [ ] Release a version with this phase (for example `v0.3.0`) and install its AppImage. Merge a `fix:` and release `v0.3.1`. Settings walks from "downloading" to "ready". "Restart to update", pressed with the gamepad, reopens harakiri at `0.3.1` in the same file. This is the "done" evidence from design Q12.

---

## Open Questions

- The non-relaunch install runs the new AppImage synchronously with `APPIMAGE_EXIT_AFTER_INSTALL=true`. If electron-builder 26's default AppImage runtime ignores that variable, quit would block on a second full app. Phase 3's "quit returns promptly" check settles it. The fallback is to always install with relaunch and let the single-instance lock handle the rest. Confirm that before Phase 4.
- The artifact name without a version (Phase 1) changes the design's file tree. Confirm that a stable `harakiri-x86_64.AppImage` asset name is acceptable on every release.
