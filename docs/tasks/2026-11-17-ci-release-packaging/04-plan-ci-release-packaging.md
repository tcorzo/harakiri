# CI Release Packaging and Self Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Repos touched:** `harakiri`

**Goal:** Merging a release-please release PR publishes a Linux AppImage to the GitHub release, and an installed AppImage updates itself on the next quit.

**Architecture:** `mise run package` is the one build command, for both the owner and CI. `.github/workflows/release.yml` runs release-please and then, gated on `release_created`, packages the app and uploads it with `gh release upload --clobber`. In the main process, a controller (`updates.ts`) drives electron-updater through a narrow `UpdaterLike` adapter (`updater.ts`). The existing quit hold calls `installIfReady` after mpv stops and before `app.exit(0)`. Settings polls the status over two zod-validated invokes.

**Tech Stack:** release-please-action v5, electron-builder 26.18.0, electron-updater 6.8.11, Electron 45, React 19 with TanStack Query, vitest 5, Playwright e2e, mise and bun.

**Spec:** `docs/tasks/2026-11-17-ci-release-packaging/03-structure-outline-ci-release-packaging.md` (the phases) and `02-design-discussion-ci-release-packaging.md` (resolved questions Q1–Q12). Where they disagree, the outline wins.

## Global Constraints

- Tags are `vX.Y.Z`. The release-please package is root `.`, `release-type: simple`, `include-component-in-tag: false`, `bump-minor-pre-major: true`, and `extra-files` bumps `apps/desktop/package.json` `$.version`. The manifest starts at `0.1.0`.
- The only artifact is `harakiri-x86_64.AppImage` (x64, no version in the name), plus `latest-linux.yml`. There are no deb, rpm, Flatpak or Snap targets.
- `electron-builder` always runs with `--publish never`. Assets reach the release only through `gh release upload "$TAG" … --clobber`.
- The update feed is electron-updater's public `github` provider, `owner: tcorzo`, `repo: harakiri`. No token goes in the app or in `app-update.yml`, and no secret other than `GITHUB_TOKEN` goes in the workflow.
- The package job runs on `ubuntu-24.04` (pinned, not `ubuntu-latest`). Actions are pinned as `actions/checkout@v4`, `jdx/mise-action@v4` and `googleapis/release-please-action@v5`. Untrusted values reach `run:` only through `env`.
- The package job runs `lint`, `lint:skips`, `lint:private` and `typecheck`, not `test` or e2e.
- Pin `electron-updater` at `6.8.11`. Set `autoDownload = false` and `autoInstallOnAppQuit = false`. Install only through `install(isSilent = true, isForceRunAfter)` from the quit hold, never `quitAndInstall()`.
- Check at startup and every 6 h (`21_600_000` ms). Download only while nothing plays, re-testing every `60_000` ms. Install on quit, after mpv has stopped.
- When `APPIMAGE` is unset (dev, e2e, unpackaged), status is `unsupported` and electron-updater is never instantiated.
- `apps/desktop/package.json` stays the single version source. Nothing calls `app.getVersion()`.
- Run heavy commands through `scripts/bounded.sh`. vitest always gets `--maxWorkers=2`. Commits and PR titles are Conventional Commits.
- Renderer UI changes go through the impeccable loop (`context --target apps/desktop`, craft floor, detector, critique). React follows `vercel-react-best-practices`.

## Review Focus

1. **Quit while a download is still running.** The app exits normally, and installs nothing. _(Task 7: `installIfReady does nothing unless an update is downloaded`.)_
2. **Offline at startup, or a release whose assets are not uploaded yet (404).** The status becomes `failed`, there is no unhandled rejection, and the next periodic check retries. _(Task 7: `a failed check is reported and retried on the next interval`.)_
3. **The install itself fails** (unwritable AppImage directory, file moved). The quit still reaches `app.exit(0)`. _(Task 6: `a throwing afterStop still exits`. Task 7: `an install that throws marks the update failed`.)_
4. **An update found during a long playback.** Nothing downloads until playback stops, then the download starts within one idle poll. _(Task 7: `downloads only once nothing plays`.)_
5. **"Restart to update" pressed after the status left `ready`, or the status invoke fails.** Restart is a no-op, and Settings still shows the plain version. _(Task 9: `restart quits only when an update is ready`. Task 10: `versionLine` with `undefined`.)_

---

## Phase 1: `mise run package` builds a checked AppImage

### Task 1: Publish-ready AppImage build and `mise run package`

**Files:**

- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json` (the `package` script, plus a `description`)
- Modify: `mise.toml` (a new `[tasks.package]` after `[tasks.e2e]`)

**Interfaces:**

- Produces: `mise run package` writes `apps/desktop/dist/harakiri-x86_64.AppImage` and `apps/desktop/dist/latest-linux.yml`. The AppImage embeds `resources/app-update.yml`.

- [ ] **Step 1: Write the target `electron-builder.yml`**

```yaml
appId: dev.harakiri.desktop
productName: harakiri
directories:
  output: dist
files:
  - out/**
  - package.json
# Writes latest-linux.yml and embeds resources/app-update.yml. Uploading is release.yml's job (--publish never).
publish:
  provider: github
  owner: tcorzo
  repo: harakiri
linux:
  target:
    - target: AppImage
      arch: [x64]
  category: AudioVideo
  # No version in the name: AppImageUpdater overwrites the running file in place only then.
  artifactName: harakiri-${arch}.AppImage
```

- [ ] **Step 2: Change the script, and add a description to `apps/desktop/package.json`**

```json
"description": "TV-first, gamepad-first Jellyfin player",
"package": "electron-vite build && electron-builder --linux AppImage --x64 --publish never"
```

- [ ] **Step 3: Add the mise task**

```toml
[tasks.package]
description = "Build the Linux AppImage and its update metadata into apps/desktop/dist"
dir = "{{config_root}}/apps/desktop"
run = "../../scripts/bounded.sh package 4G -- bun run package"
```

- [ ] **Step 4: Build**

Run: `mise run package`
Expected: exit 0. `ls apps/desktop/dist` shows `harakiri-x86_64.AppImage` and `latest-linux.yml`, and `grep version: apps/desktop/dist/latest-linux.yml` prints `version: 0.1.0`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/package.json mise.toml
git commit -m "build: package the desktop app as a publish-ready AppImage"
```

### Task 2: `mise run package:check` proves the build matches its metadata

**Files:**

- Create: `scripts/check-release.ts`
- Modify: `mise.toml` (a new `[tasks."package:check"]`)

**Interfaces:**

- Consumes: Task 1's `apps/desktop/dist` and `apps/desktop/out/main`.
- Produces: `bun scripts/check-release.ts [version]`. `version` defaults to `apps/desktop/package.json`'s. It prints `ok: <check>` per pass and `FAIL: <check>: <why>` per failure, and exits 1 on any failure. Task 4's workflow calls `mise run package:check "${TAG#v}"`.

Like `scripts/lint-*.ts`, this script has no vitest project. It is proved by running it on a real build and on a tampered copy (Steps 3–4).

- [ ] **Step 1: Implement `scripts/check-release.ts`**

Header doc comment in the style of `scripts/lint-skips.ts`. Paths resolve from the repo root (`import.meta.dirname/..`). Checks, in order:

```text
dist = $HARAKIRI_DIST ?? apps/desktop/dist     # the override exists for Step 4's tampered copy
version = argv[2] ?? apps/desktop/package.json version
meta = Bun.YAML.parse(dist/latest-linux.yml)
"version"         meta.version === version
"artifact"        dist/<meta.files[0].url> exists; meta.path === meta.files[0].url
"sha512"          meta.files[0].sha512 === meta.sha512 === base64(sha512(file))
"size"            meta.files[0].size === stat(file).size
in a mkdtemp cwd: execFileSync(file, ["--appimage-extract", "resources/*"])   # works without FUSE
"feed"            squashfs-root/resources/app-update.yml parses to provider github, owner tcorzo, repo harakiri, and has no "token" key
"runtime deps"    every bare specifier imported by apps/desktop/out/main/**/*.js
                  (from "x" | import("x") | require("x"); skip node:*, node builtins via module.builtinModules, electron)
                  has /node_modules/<pkg>/package.json in `bun x --package @electron/asar@3.4.1 asar list <app.asar>`
                  (<pkg> = "@scope/name" or "name")
rm the temp dir
```

- [ ] **Step 2: Add the mise task**

```toml
[tasks."package:check"]
description = "Check apps/desktop/dist: latest-linux.yml matches the AppImage and the version, the feed is public GitHub, runtime deps are packed"
run = "bun scripts/check-release.ts"
```

- [ ] **Step 3: Run it on Task 1's build**

Run: `mise run package:check`
Expected: six `ok:` lines (version, artifact, sha512, size, feed, runtime deps), exit 0. If `runtime deps` fails, fix the packaging (declare the missing package in `apps/desktop/package.json` `dependencies`, per research §11), rebuild, and re-run. Do not weaken the check.

- [ ] **Step 4: Prove it fails on mismatches**

Run: `mise run package:check 9.9.9`
Expected: `FAIL: version: …9.9.9…`, exit 1.

Run: `d="$(mktemp -d)" && cp -r apps/desktop/dist/. "$d" && printf x >> "$d/harakiri-x86_64.AppImage" && HARAKIRI_DIST="$d" mise run package:check`
Expected: `FAIL: sha512` and `FAIL: size`, exit 1.

- [ ] **Step 5: `mise run check`** (lint, `lint:private` on the new files, typecheck, tests). Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-release.ts mise.toml
git commit -m "build: check the AppImage against its update metadata"
```

- [ ] **Step 7 (owner): Run the AppImage on Fedora 44**

`apps/desktop/dist/harakiri-x86_64.AppImage` starts fullscreen, signs in to the dev Jellyfin (`dev/jellyfin/COMMANDS.txt`), and plays a corpus file through the system mpv. Record the result in the PR description. It settles the research's open questions 2 (deps) and 3 (FUSE 2).

---

## Phase 2: Merging a release PR publishes the AppImage

### Task 3: Clear the repo for going public and document distribution

**Files:**

- Delete: `docs/decisions/autonomous-run.md`
- Modify: `CLAUDE.md:10` (remove the bullet), and add a `## Releases` section after `## Architecture`
- Modify: `docs/PRD.md:10`, `docs/PRD.md:164` (remove both bullets), and add `## Distribution and updates` before `## Out of scope for the MVP`
- Modify: `docs/reviews/01-foundation.md:29`, `docs/reviews/03-fix-wave.md:28`

- [ ] **Step 1: Delete the file and the three bullets**

- [ ] **Step 2: Reword the reviews**

- `01-foundation.md:29` → `- Owner's NAS paths sat in \`packages/harness/src/fixtures.ts\` (B). Fixed: that file is gone, and media comes from the corpus catalog (\`packages/harness/src/corpus/catalog.ts\`).`
- `03-fix-wave.md:28`: replace both "D16" mentions with "the sign-out decision". The rest of the line stays.

- [ ] **Step 3: Add the PRD section**

```markdown
## Distribution and updates

- harakiri ships as one Linux x64 AppImage, attached to each GitHub release of `tcorzo/harakiri`. Like a source checkout, it needs the system mpv (>= 0.41) on `PATH`.
- release-please cuts releases: Conventional Commit titles on `main` keep a release PR open, merging it tags `vX.Y.Z`, and `.github/workflows/release.yml` builds `mise run package` and uploads the AppImage and `latest-linux.yml`.
- A running AppImage checks the latest release at startup and every 6 hours, downloads only while nothing plays, and installs on the next quit after mpv has stopped. Settings shows the state and offers "Restart to update". The download is verified by the sha512 in `latest-linux.yml` only.
- Not shipped: Flatpak, Snap, rpm, deb or pacman packages; a bundled mpv (issue #2); code or GPG signing; beta channels, rollback and staged rollouts.
```

- [ ] **Step 4: Add the CLAUDE.md section**

```markdown
## Releases

- release-please keeps a release PR open on `main`. Merging it tags `vX.Y.Z`, and `.github/workflows/release.yml` uploads `harakiri-x86_64.AppImage` and `latest-linux.yml` to that release. Never edit the version in `apps/desktop/package.json` or `CHANGELOG.md` by hand.
- `mise run package` builds the same AppImage locally, and `mise run package:check` verifies it. `gh workflow run release.yml -f tag=vX.Y.Z` rebuilds and re-uploads an existing release.
```

- [ ] **Step 5: Verify**

Run: `git grep -n autonomous-run -- ':!docs/tasks'`
Expected: no output.

Run: `mise run lint:private`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A CLAUDE.md docs/PRD.md docs/decisions docs/reviews
git commit -m "docs: drop the autonomous-run log and document distribution and updates"
```

### Task 4: release-please and `release.yml`

**Files:**

- Create: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`
- Modify: `CLAUDE.md` (Dependencies "Chosen" table: a `releases` row, `googleapis/release-please-action v5 (release-please 17.6.0)`, job "version, changelog, tag and GitHub release from Conventional Commits")

**Interfaces:**

- Consumes: `mise run package`, `mise run package:check [version]` (Tasks 1–2).
- Produces: tag `vX.Y.Z` and a release carrying `harakiri-x86_64.AppImage` and `latest-linux.yml`. Phase 3's updater reads this feed.

- [ ] **Step 1: Write the config and the manifest**

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "simple",
      "include-component-in-tag": false,
      "bump-minor-pre-major": true,
      "extra-files": [
        { "type": "json", "path": "apps/desktop/package.json", "jsonpath": "$.version" }
      ]
    }
  }
}
```

`.release-please-manifest.json`: `{ ".": "0.1.0" }`. The `simple` strategy updates `version.txt` only if it exists (`createIfMissing: false`), so none is created.

- [ ] **Step 2: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      tag:
        description: "Existing release tag to rebuild and re-upload, e.g. v0.2.0"
        required: true

concurrency:
  group: release
  cancel-in-progress: false

permissions: {}

jobs:
  release-please:
    if: github.event_name == 'push'
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      release_created: ${{ steps.rp.outputs.release_created }}
      tag_name: ${{ steps.rp.outputs.tag_name }}
    steps:
      - id: rp
        uses: googleapis/release-please-action@v5
      # release-please bumps apps/desktop/package.json but not bun.lock, which records it too.
      - if: steps.rp.outputs.pr
        uses: actions/checkout@v4
        with:
          ref: ${{ fromJSON(steps.rp.outputs.pr).headBranchName }}
      - if: steps.rp.outputs.pr
        uses: jdx/mise-action@v4
        with:
          install_args: bun
      - if: steps.rp.outputs.pr
        shell: bash
        run: |
          set -euo pipefail
          bun install --ignore-scripts
          git diff --quiet -- bun.lock && exit 0
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "chore: sync bun.lock with the release version" -- bun.lock
          git push

  package:
    needs: release-please
    if: ${{ !cancelled() && (needs.release-please.outputs.release_created == 'true' || github.event_name == 'workflow_dispatch') }}
    runs-on: ubuntu-24.04 # pinned: an older glibc keeps the AppImage portable
    permissions:
      contents: write
    env:
      TAG: ${{ needs.release-please.outputs.tag_name || inputs.tag }}
    steps:
      - shell: bash
        run: '[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a release tag: $TAG" >&2; exit 1; }'
      - uses: actions/checkout@v4
        with:
          ref: ${{ env.TAG }}
      - uses: jdx/mise-action@v4
        with:
          install_args: bun node
      - run: bun install --frozen-lockfile
      - run: mise run lint && mise run lint:skips && mise run lint:private && mise run typecheck
      - run: mise run package
      - run: mise run package:check "${TAG#v}"
      - run: gh release upload "$TAG" apps/desktop/dist/harakiri-x86_64.AppImage apps/desktop/dist/latest-linux.yml --clobber
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 3: Lint the workflow**

Run: `mise x actionlint@1.7.12 -- actionlint .github/workflows/release.yml .github/workflows/pr-title.yml`
Expected: no output, exit 0.

- [ ] **Step 4: Commit and push the branch, then dry-run release-please against it**

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release.yml CLAUDE.md
git commit -m "ci: release with release-please and upload the AppImage"
git push -u origin tcorzo/package
```

Run: `bun x release-please@17.6.0 release-pr --dry-run --repo-url=tcorzo/harakiri --target-branch=tcorzo/package --token="$(gh auth token)"`
Expected: a proposed release PR `chore(main): release 0.2.0`, with updates to `CHANGELOG.md`, `.release-please-manifest.json` and `apps/desktop/package.json` (`"version": "0.2.0"`).

### Task 5 (owner checkpoint): Go public and cut the first release

No code. Phase 3's manual check depends on this, so merge Phases 1–2 as their own PR before Phase 3.

- [ ] The owner sets `tcorzo/harakiri` to public, and enables Settings → Actions → "Allow GitHub Actions to create and approve pull requests".
- [ ] Merge the Phase 1–2 PR. Expected: the Release run opens `chore(main): release 0.2.0`, whose diff includes `bun.lock` (or the run log shows that the lockfile needed no change).
- [ ] Merge the release PR. Expected: the `package` job is green, and release `v0.2.0` has both assets. `curl -sL https://github.com/tcorzo/harakiri/releases/latest/download/latest-linux.yml` (no token) prints `version: 0.2.0`.
- [ ] Run: `gh workflow run release.yml -f tag=v0.2.0`. Expected: green, and the same two asset names remain on the release.

---

## Phase 3: An installed AppImage updates itself on quit

### Task 6: The quit hold runs an `afterStop` step

**Files:**

- Modify: `apps/desktop/src/main/lifecycle.ts:39-55`
- Test: `apps/desktop/src/main/lifecycle.test.ts`

**Interfaces:**

- Produces: `holdQuitUntilStopped(app: QuittingApp, stop: () => Promise<void>, options?: { capMs?: number; afterStop?: () => void }): void`. `capMs` defaults to `STOP_CAP_MS`. Task 8 passes `afterStop`.

- [ ] **Step 1: Write the failing tests, and move the existing cap test to the options form**

```ts
test("afterStop runs once, after the player stopped and before exit", async () => {
  const { app, exits, quit } = fakeApp();
  const order: string[] = [];
  holdQuitUntilStopped(app, async () => void order.push("stop"), {
    afterStop: () => void order.push(`afterStop exits=${exits.length}`),
  });

  quit();
  quit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(order).toEqual(["stop", "afterStop exits=0"]);
  expect(exits).toEqual([0]);
});

test("a throwing afterStop still exits", async () => {
  const { app, exits, quit } = fakeApp();
  holdQuitUntilStopped(app, () => Promise.resolve(), {
    afterStop: () => {
      throw new Error("install failed");
    },
  });

  quit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(exits).toEqual([0]);
});
```

The existing hang test becomes `holdQuitUntilStopped(app, () => new Promise(() => {}), { capMs: 20 })`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/lifecycle.test.ts`
Expected: FAIL. TypeScript or runtime rejects the options object, and `afterStop` never runs.

- [ ] **Step 3: Implement**

Take the options object. Call `options.afterStop` inside `try`/`catch` after the timeout warning and before `app.exit(0)`, and log a catch with `logger.error("Installing the update on quit failed: {error}", { error })`. Update the docstring: "…then runs afterStop, then exits without re-entering quit." `index.ts:99` keeps compiling unchanged.

- [ ] **Step 4: Run the tests and watch them pass**

Run: the same command as Step 2.
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lifecycle.ts apps/desktop/src/main/lifecycle.test.ts
git commit -m "feat(desktop): run an after-stop step in the quit hold"
```

### Task 7: The update controller

**Files:**

- Modify: `apps/desktop/src/shared/bridge.ts` (add `UpdateStatus` after `PlayerProbe`)
- Create: `apps/desktop/src/main/updates.ts`
- Test: `apps/desktop/src/main/updates.test.ts` (`// @vitest-environment node`)

**Interfaces:**

- Produces, in `shared/bridge.ts`:

```ts
export const UpdateStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unsupported") }),
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("available"), version: z.string() }),
  z.object({ state: z.literal("downloading"), version: z.string(), percent: z.number() }),
  z.object({ state: z.literal("ready"), version: z.string() }),
  z.object({ state: z.literal("failed"), message: z.string() }),
]);
export type UpdateStatus = z.infer<typeof UpdateStatus>;
```

- Produces, in `main/updates.ts`:

```ts
export interface UpdaterLike {
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  /** Synchronous; swaps the AppImage. `relaunch` starts the new one. */
  install(relaunch: boolean): boolean;
  onAvailable(listener: (version: string) => void): void;
  onNotAvailable(listener: () => void): void;
  onProgress(listener: (percent: number) => void): void;
  onDownloaded(listener: (version: string) => void): void;
  onError(listener: (error: Error) => void): void;
}

export interface UpdateDeps {
  readonly appImage: string | undefined;
  /** Called only when appImage is set. */
  readonly createUpdater: () => UpdaterLike;
  readonly isPlaying: () => boolean;
  readonly releaseLock: () => void;
  readonly checkEveryMs?: number; // 21_600_000
  readonly idlePollMs?: number; // 60_000
}

export interface Updates {
  status(): UpdateStatus;
  installIfReady(): void;
}

export function startUpdates(deps: UpdateDeps): Updates;
```

Task 9 adds `quit` to `UpdateDeps` and `restart()` to `Updates`.

- [ ] **Step 1: Write the fake and the failing tests**

```ts
function fakeUpdater() {
  const on: {
    available?: (v: string) => void;
    notAvailable?: () => void;
    progress?: (p: number) => void;
    downloaded?: (v: string) => void;
    error?: (e: Error) => void;
  } = {};
  const calls = { check: 0, download: 0, installs: [] as boolean[] };
  let checkResult: () => Promise<unknown> = () => Promise.resolve();
  let installResult: () => boolean = () => true;
  const updater: UpdaterLike = {
    check: () => {
      calls.check += 1;
      return checkResult();
    },
    download: () => {
      calls.download += 1;
      return Promise.resolve();
    },
    install: (relaunch) => {
      calls.installs.push(relaunch);
      return installResult();
    },
    onAvailable: (l) => {
      on.available = l;
    },
    onNotAvailable: (l) => {
      on.notAvailable = l;
    },
    onProgress: (l) => {
      on.progress = l;
    },
    onDownloaded: (l) => {
      on.downloaded = l;
    },
    onError: (l) => {
      on.error = l;
    },
  };
  return {
    updater,
    on,
    calls,
    failChecks: (e: Error) => {
      checkResult = () => Promise.reject(e);
    },
    failInstall: () => {
      installResult = () => {
        throw new Error("EACCES");
      };
    },
  };
}
const start = (fake: ReturnType<typeof fakeUpdater>, over: Partial<UpdateDeps> = {}) =>
  startUpdates({
    appImage: "/apps/harakiri-x86_64.AppImage",
    createUpdater: () => fake.updater,
    isPlaying: () => false,
    releaseLock: () => {},
    ...over,
  });
```

Use `vi.useFakeTimers()` in `beforeEach` and `vi.useRealTimers()` in `afterEach`. The tests and their assertions:

- `unsupported without an AppImage, and electron-updater is never created`: `startUpdates({ appImage: undefined, createUpdater: () => { throw new Error("created") }, … })`, then `status()` → `{ state: "unsupported" }`, and `installIfReady()` does not throw.
- `checks at start and every 6 hours`: `calls.check === 1`, then advance `21_600_000` and expect `calls.check === 2`.
- `walks available → downloading → ready`: `on.available("0.3.0")` → `calls.download === 1`, status `{ state: "downloading", version: "0.3.0", percent: 0 }`. Then `on.progress(41.6)` → percent `41.6`. Then `on.downloaded("0.3.0")` → `{ state: "ready", version: "0.3.0" }`.
- `downloads only once nothing plays`: `let playing = true`. Then `on.available("0.3.0")` → `calls.download === 0`, status `{ state: "available", version: "0.3.0" }`. Advance `60_000` → still `0`. Set `playing = false` and advance `60_000` → `calls.download === 1`.
- `does not check again while downloading or ready`: after `on.downloaded("0.3.0")`, advance `21_600_000` → `calls.check === 1`.
- `a failed check is reported and retried on the next interval`: `failChecks(new Error("net::ERR_INTERNET_DISCONNECTED"))` before start, then flush microtasks (`await vi.advanceTimersByTimeAsync(0)`) and `on.error(new Error("net::ERR_INTERNET_DISCONNECTED"))` → `{ state: "failed", message: "net::ERR_INTERNET_DISCONNECTED" }` with no unhandled rejection. Advance `21_600_000` → `calls.check === 2`. Then `on.notAvailable()` → `{ state: "idle" }`.
- `installIfReady does nothing unless an update is downloaded`: in `available` and in `downloading`, `installIfReady()` → `calls.installs` stays `[]`.
- `installIfReady installs silently without relaunch`: after `on.downloaded("0.3.0")`, `installIfReady()` → `calls.installs` equals `[false]`, and the `releaseLock` spy is not called.
- `an install that throws marks the update failed`: call `failInstall()`, get to ready, then `installIfReady()` does not throw, and status is `{ state: "failed", message: "EACCES" }`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/updates.test.ts`
Expected: FAIL, "Cannot find module './updates'".

- [ ] **Step 3: Implement `startUpdates`**

State is one `let status: UpdateStatus` (initially `idle`) plus a private `relaunch = false`. Check and download promises are `void`-ed with a `.catch` that only logs at debug, because the `error` event sets the status. `getLogger(["harakiri", "updates"])` logs each transition at info. The behavior:

```text
startUpdates
  if appImage undefined → return { status: unsupported, installIfReady: no-op }
  u = createUpdater(); wire listeners
  check(); setInterval(checkEveryMs): if status not in {downloading, ready}: check()
  setInterval(idlePollMs): if status is available and not isPlaying(): download()
  download(): status = downloading(v, 0); u.download()
  available(v) → available(v); if not isPlaying(): download()
  notAvailable  → idle
  progress(p)   → if downloading: downloading(v, p)
  downloaded(v) → ready(v)
  error(e)      → failed(e.message)
installIfReady
  if status is not ready: return
  if relaunch: releaseLock()
  try u.install(relaunch) catch e → failed(e.message), log error
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: the same command as Step 2.
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/bridge.ts apps/desktop/src/main/updates.ts apps/desktop/src/main/updates.test.ts
git commit -m "feat(desktop): add the update controller"
```

### Task 8: Wire electron-updater into the app

**Files:**

- Modify: `apps/desktop/package.json` (`dependencies`: `"electron-updater": "6.8.11"`), then `bun install`, which updates `bun.lock`
- Create: `apps/desktop/src/main/updater.ts`
- Test: `apps/desktop/src/main/updater.test.ts` (`// @vitest-environment node`)
- Modify: `apps/desktop/src/main/env.ts` (`APPIMAGE: z.string().min(1).optional()`)
- Modify: `apps/desktop/src/main/player/index.ts` (add `isPlaying`)
- Modify: `apps/desktop/src/main/index.ts:98-114`
- Modify: `CLAUDE.md` (Dependencies "Chosen" table: an `auto-update` row, `electron-updater 6.8.11`, job "AppImage self-update from the public GitHub release")

**Interfaces:**

- Consumes: `UpdaterLike`, `startUpdates`, `Updates` (Task 7), and `holdQuitUntilStopped(…, { afterStop })` (Task 6).
- Produces:
  - `adaptUpdater(real: BaseUpdater): UpdaterLike` and `electronUpdater(): UpdaterLike` in `main/updater.ts`, the only file that imports `electron-updater`.
  - `isPlaying(): boolean` in `player/index.ts` (`current !== undefined`).
  - The `updates` variable in `main()`, which Task 9 passes to `registerIpc`.

- [ ] **Step 1: Write the failing adapter tests**

Build a fake from a plain `EventEmitter`, with fields `autoDownload = true`, `autoInstallOnAppQuit = true`, `logger = null` and spy methods `checkForUpdates`, `downloadUpdate` and `install`. Cast it `as unknown as BaseUpdater`.

- `adaptUpdater turns off auto download and install-on-quit and logs through logtape`: after `adaptUpdater(fake)`, `fake.autoDownload === false`, `fake.autoInstallOnAppQuit === false`, and `fake.logger` has `info`, `warn` and `error` functions.
- `adaptUpdater maps events and calls`: `onAvailable(l)`, then `fake.emit("update-available", { version: "0.3.0" })` → `l` gets `"0.3.0"`. `fake.emit("download-progress", { percent: 12.5 })` → `12.5`. `fake.emit("update-downloaded", { version: "0.3.0" })` → `"0.3.0"`. `fake.emit("update-not-available", {})` → called. `fake.emit("error", new Error("x"))` → the error. `install(true)` calls `fake.install(true, true)` and returns its value.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/updater.test.ts`
Expected: FAIL, "Cannot find module './updater'".

- [ ] **Step 3: Implement `updater.ts`**

`import pkg from "electron-updater"; const { BaseUpdater } = pkg;` (CJS package, ESM bundle). `adaptUpdater` sets the two flags to `false` and sets `logger` to `{ info: (m) => log.info("{m}", { m: String(m) }), warn: …, error: … }` with `log = getLogger(["harakiri", "updates", "electron-updater"])`. The braces in electron-updater's messages must not be read as logtape placeholders. It maps `check` → `checkForUpdates()`, `download` → `downloadUpdate()`, `install(r)` → `real.install(true, r)`, and each `on*` to its event. `electronUpdater()` reads `pkg.autoUpdater`, throws `new Error("electron-updater did not pick an installing updater on this platform")` unless it is `instanceof BaseUpdater`, and returns `adaptUpdater(it)`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: the same command as Step 2. Expected: PASS, 2 tests.

- [ ] **Step 5: Wire it in `index.ts`**

```diff
   killOnExit(player.mpvPid);
-  holdQuitUntilStopped(app, player.stop);
+  let updates: Updates | undefined;
+  holdQuitUntilStopped(app, player.stop, { afterStop: () => updates?.installIfReady() });
   …
   await app.whenReady();
+  // electron-updater requests through Electron's net stack, which needs ready.
+  updates = startUpdates({
+    appImage: env.APPIMAGE,
+    createUpdater: electronUpdater,
+    isPlaying: player.isPlaying,
+    releaseLock: () => app.releaseSingleInstanceLock(),
+  });
   installContentSecurityPolicy(…);
```

- [ ] **Step 6: Run the full gate**

Run: `mise run check`
Expected: exit 0.

Run: `mise run e2e`
Expected: all specs pass. `APPIMAGE` is unset, so the updates status is `unsupported`, no update request is made, and the teardown finds no mpv.

Run: `mise run package && mise run package:check`
Expected: all `ok:`. `runtime deps` now covers `electron-updater`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json bun.lock apps/desktop/src/main CLAUDE.md
git commit -m "feat(desktop): update the AppImage from GitHub releases on quit"
```

- [ ] **Step 8 (manual, needs Task 5): Watch a real swap**

While the local version is still `0.1.0`, copy `apps/desktop/dist/harakiri-x86_64.AppImage` to `~/Applications/` and start it. Expected in the run log (`~/.config/harakiri/logs/`): an update to `0.2.0` found, then downloaded. Start a play before the download completes: within a minute the log shows the download cancelled and the status back to available; stop playing and within a minute it downloads again. Quit. Expected: quit returns within about 5 s, the same path now holds 0.2.0, and the next start logs `harakiri 0.2.0`. If quit hangs, `APPIMAGE_EXIT_AFTER_INSTALL` is ignored by the runtime (outline open question 1). Stop and switch `installIfReady` to always install with relaunch before Phase 4.

---

## Phase 4: Settings shows the update and restarts into it

### Task 9: `updates:status` and `updates:restart` over IPC

**Files:**

- Modify: `apps/desktop/src/shared/bridge.ts` (`channels`, `HarakiriBridge`)
- Modify: `apps/desktop/src/preload/bridge.ts`, and test `apps/desktop/src/preload/bridge.test.ts`
- Modify: `apps/desktop/src/main/updates.ts`, and test `apps/desktop/src/main/updates.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts:13`, `apps/desktop/src/main/index.ts`

**Interfaces:**

- Produces:
  - `channels.updateStatus = "updates:status"` and `channels.updateRestart = "updates:restart"`.
  - `HarakiriBridge.updates: { readonly status: () => Promise<UpdateStatus>; readonly restart: () => Promise<void> }`.
  - `UpdateDeps.quit: () => void`. In `Updates`, `restart(): void`. When the app is unsupported, `restart` is a no-op.
  - `registerIpc(isAppUrl: AppUrlCheck, updates: Pick<Updates, "status" | "restart">): void`.

- [ ] **Step 1: Write the failing tests**

`updates.test.ts` (`start` gains `quit` and `releaseLock` spies):

- `restart quits only when an update is ready`: in `idle`, `restart()` → `quit` is not called. After `on.downloaded("0.3.0")`, `restart()` → `quit` is called once, and a following `installIfReady()` → `releaseLock` is called once and `calls.installs` equals `[true]`.

`bridge.test.ts`:

- Both key lists in `the test surface is exposed only for e2e` gain `"updates"`.
- `update status is parsed and restart invokes its channel`: with replies `{ [channels.updateStatus]: { state: "ready", version: "0.3.0" } }`, `await bridge.updates.status()` equals `{ state: "ready", version: "0.3.0" }`. `await bridge.updates.restart()`, and `invoked` contains `[channels.updateRestart]`. A reply of `{ state: "ready" }` with no version rejects.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/updates.test.ts apps/desktop/src/preload/bridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- In the controller, `restart` sets `relaunch = true` and calls `deps.quit()` only when the status is `ready`. `app.quit()` takes the before-quit hold, so mpv stops first.
- In the bridge, `updates: { status: () => invoke(channels.updateStatus, UpdateStatus), restart: () => invoke(channels.updateRestart, z.undefined()) }`.
- In `ipc.ts`, `handle(channels.updateStatus, () => updates.status())`, and `handle(channels.updateRestart, () => { updates.restart(); })`.
- In `index.ts`, pass `quit: () => app.quit()` and call `registerIpc(isAppUrl, updates)`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: the same command as Step 2. Expected: PASS.

Run: `mise run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/bridge.ts apps/desktop/src/preload apps/desktop/src/main
git commit -m "feat(desktop): expose update status and restart to the renderer"
```

### Task 10: Settings shows the update state and "Restart to update"

**Files:**

- Create: `apps/desktop/src/renderer/src/settings/version-line.ts`
- Test: `apps/desktop/src/renderer/src/settings/version-line.test.ts`
- Modify: `apps/desktop/src/renderer/src/settings/SettingsScreen.tsx:61-76`
- Modify: `apps/desktop/e2e/onboarding.spec.ts:302-305`

**Interfaces:**

- Consumes: `window.harakiri.updates` and `UpdateStatus` (Tasks 7 and 9).
- Produces: `versionLine(version: string, status: UpdateStatus | undefined): string`.

- [ ] **Step 1: Load the impeccable skill**

Run `context --target apps/desktop` and read the craft floor before you edit. The copy below is the default. If the critique changes it, change the test strings in the same commit.

- [ ] **Step 2: Write the failing test**

```ts
test.each([
  [undefined, "Version 0.2.0"],
  [{ state: "unsupported" }, "Version 0.2.0"],
  [{ state: "idle" }, "Version 0.2.0 · up to date"],
  [
    { state: "available", version: "0.3.0" },
    "Version 0.2.0 · 0.3.0 found, downloads when playback stops",
  ],
  [
    { state: "downloading", version: "0.3.0", percent: 41.6 },
    "Version 0.2.0 · 0.3.0 downloading 42%",
  ],
  [{ state: "ready", version: "0.3.0" }, "Version 0.2.0 · 0.3.0 ready, installs when you quit"],
  [{ state: "failed", message: "net::ERR_FAILED" }, "Version 0.2.0 · update check failed"],
] as const)("versionLine(%o)", (status, line) => {
  expect(versionLine("0.2.0", status)).toBe(line);
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/renderer/src/settings/version-line.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `versionLine` with `ts-pattern` `match(status)…exhaustive()`, then wire up Settings**

```diff
+  const updates = useQuery({
+    queryKey: ["updates", "status"],
+    queryFn: () => window.harakiri.updates.status(),
+    refetchInterval: (query) => (query.state.data?.state === "unsupported" ? false : 1000),
+  });
   …
-  <dd className="m-0">Version {appVersion}</dd>
+  <dd className="m-0" aria-live="polite">{versionLine(appVersion, updates.data)}</dd>
   …
+  {updates.data?.state === "ready" && (
+    <ListAction
+      focusKey="settings-restart"
+      label="Restart to update"
+      detail={`Installs ${updates.data.version} and opens harakiri again`}
+      onPress={() => void window.harakiri.updates.restart()}
+    />
+  )}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: the same command as Step 3. Expected: PASS, 7 cases.

- [ ] **Step 6: Extend the e2e Settings check** (`onboarding.spec.ts`, after the `Address` assertion)

```ts
// Unpackaged e2e has no APPIMAGE: updates are unsupported, so only the version shows.
await expect(facts).toContainText(/AppVersion \d+\.\d+\.\d+$/);
await expect(page.getByRole("button", { name: /Restart to update/ })).toHaveCount(0);
```

- [ ] **Step 7: Run the impeccable detector, critique and audit on `SettingsScreen.tsx`**

Expected: no detector findings. Apply any material critique fix.

- [ ] **Step 8: Run the full gate**

Run: `mise run check && mise run e2e`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/src/settings apps/desktop/e2e/onboarding.spec.ts
git commit -m "feat(desktop): show update state and restart to update in Settings"
```

- [ ] **Step 10 (owner, after merge): The "done" evidence (design Q12)**

Release the version that contains this phase, and install its AppImage. Merge any `fix:`, then release the next patch. Expected: Settings goes from "downloading N%" to "ready, installs when you quit". Press "Restart to update" with the gamepad. harakiri closes, then reopens at the new version from the same file path.
