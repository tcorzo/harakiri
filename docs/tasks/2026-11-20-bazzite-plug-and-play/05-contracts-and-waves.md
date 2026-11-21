---
task: 2026-11-20-bazzite-plug-and-play
type: contracts
repo: harakiri
branch: tcorzo/bazzite-first-party
plan: 04-plan-app-side-fixes.md
---

**Repos touched:** `harakiri`

# Frozen contracts and execution waves for plan 04

Plan 04's tasks share interfaces. Task 5 makes the host module that Tasks 6 and 8 read. Task 8 adds the `PictureWorld` and `FidelityStart` fields that Task 9 builds on. Several tasks also need the same player wiring. Wave 0 lands every shared interface in code as one commit (`refactor: freeze the host and fidelity contracts for plan 04`), with stub bodies that keep today's behaviour. After it, no task waits on another task's interface. A task only fills in a stub that it owns.

Wave 0 proves that behaviour did not change:

- `docs/fidelity/compatibility.md` is byte-identical, and `table.test.ts` passes.
- `mise run typecheck`, `mise run lint` and `mise run test` pass (389 tests).
- mpv's argv is unchanged. `colorspaceHint` is now passed explicitly, but its stub value is `auto`, which is `buildPlaybackArgs`' default.

## The contracts

The code is the contract. This section says where each part lives, who fills in each stub, and the rule the real body must follow.

### C1. The host module: `apps/desktop/src/main/host/`

| Export                                                                   | File              | Stub today                                                       | Filled by |
| ------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------- | --------- |
| `SecretProbe`, `HostFacts`                                               | `facts.ts`        | (types)                                                          | —         |
| `readHostFacts(env, secrets): Promise<HostFacts>`                        | `facts.ts`        | fixed facts: no displays, `desktop: []`, backend `unknown`       | Task 5    |
| `SecretStore = "keyring" \| "file"`                                      | `capabilities.ts` | (type)                                                           | —         |
| `HostCapabilities { secretStore, hdrSignalling }`                        | `capabilities.ts` | (type, with both fields frozen now)                              | —         |
| `capabilitiesOf(facts): HostCapabilities`                                | `capabilities.ts` | `{ secretStore: "keyring", hdrSignalling: "colour-management" }` | Task 5    |
| `hostFacts()`, `hostCapabilities()` (memoized, Electron's `safeStorage`) | `index.ts`        | real                                                             | —         |

The rules the real `capabilitiesOf` must follow:

- `secretStore` is `"keyring"` if and only if `encryptionAvailable` is true and `secretBackend` is not `"basic_text"` or `"unknown"`.
- `hdrSignalling` is `"swapchain-formats"` if and only if `gamescopeDisplay` is set and `waylandDisplay` is unset or equal to it. Otherwise it is `"colour-management"`.

Nothing reads `secretStore` until Task 6. `hdrSignalling` is already read on every play (C3), so the stub's `colour-management` value keeps mpv's `auto` hint.

### C2. The fidelity vocabulary: `packages/fidelity/src/`

| Shape                                                                                     | File           | Stub today                          | Filled by |
| ----------------------------------------------------------------------------------------- | -------------- | ----------------------------------- | --------- |
| `HdrSignalling`, `ColorspaceHint`, `Size` (exported from `index.ts`)                      | `model.ts`     | (types)                             | —         |
| `Observation` `{ kind: "outputSize", output: Size, picture: Size }`                       | `model.ts`     | `learn` returns the state unchanged | Task 9    |
| `DowngradeReason` `{ kind: "scaledDown", output: Size }`                                  | `model.ts`     | never produced                      | Task 9    |
| `PictureWorld.hdrSignalling`, `PictureWorld.scaled` (`startFidelity` sets `scaled: null`) | `picture.ts`   | real                                | —         |
| `colorspaceHintFor(signalling): ColorspaceHint`                                           | `picture.ts`   | always `"auto"`                     | Task 8    |
| `scalePlan(picture, world): Downgrade \| null`                                            | `picture.ts`   | always `null`                       | Task 9    |
| `FidelityStart.hdrSignalling` (required), `FidelityView.colorspaceHint`                   | `engine.ts`    | real                                | —         |
| `displays[n].hdrSignalling?`, and `simulate(…, hdrSignalling = "colour-management")`      | `scenarios.ts` | real                                | —         |

These invariants are already in place, and later tasks keep them:

- The `rendererFailed` branch of `learn` spreads `state.pictureWorld`, so `hdrSignalling` and `scaled` survive a renderer step-down.
- `fidelityView` lists `scalePlan(...)` right after `picture.downgrade` in `downgrades`.
- The engine and the scenarios name no platform. The words are `colour-management` and `swapchain-formats`.

### C3. The player wiring: `apps/desktop/src/main/player/`

- `PlayerWiring.loadSession: () => Promise<Session | null>`. It is async now, because Task 6 makes the session store async. Until then, `player/index.ts` wraps the sync `loadSession`.
- `PlayerWiring.hdrSignalling: () => Promise<HdrSignalling>`. `player/index.ts` reads it from `hostCapabilities()` on each `prepare` and `play`, after the app is ready.
- `PlaybackDeps.hdrSignalling: HdrSignalling`.
- `startingFidelity(resolution, output, hdrSignalling): FidelityState`.
- `mpvArgs` passes `colorspaceHint: fidelity.colorspaceHint` to `buildPlaybackArgs`.

### C4. The IPC schema: `apps/desktop/src/shared/bridge.ts`

The `DowngradeReason` zod union has a `scaledDown` member with `output: { width, height }`. The `satisfies z.ZodType<…>` check does not catch a missing union member, so without this member the preload would reject the first `scaledDown` downgrade at run time.

### Not frozen: each has one owner

These interfaces belong to a single task and are not used outside it, so freezing them gains nothing:

- **Task 1:** `feedUnreachable`
- **Task 3:** `encodingOf`
- **Task 4:** `MpvStartError` and `fatalLines`
- **Task 6:** the session store's internals, the `session:storage` channel, `SessionStorage`, and `HarakiriBridge.session.storage`
- **Task 7:** `scripts/lint-host.ts`

### Changing a contract

A wave agent never edits a frozen shape. That covers the types and signatures above, and the stub signatures. Filling in a stub's body is the owning task's job. If an agent finds a contract wrong, it stops and reports the problem. The integrator then changes the contract on the base branch, before the next wave branches.

## Gaps in plan 04 that the freeze found

The freeze found three gaps. Plan 04 is amended to match.

1. **Task 6 left out the player.** An async session store breaks `PlayerWiring.loadSession`, which was sync, and `create-player.ts` was not in Task 6's files. C3 makes the wiring async now. Task 6 only replaces the wrapper in `player/index.ts`.
2. **Task 9 left out the IPC schema.** Without the `scaledDown` member in `bridge.ts`, the renderer would never show the downgrade. C4 adds it.
3. **Tasks 5 and 8 both edited `host/`.** The `hdrSignalling` rule and its tests move to Task 5, which owns `host/`. Task 8 no longer touches `host/`, `playback.ts`, `create-player.ts` or `player/index.ts`. Its only change outside `packages/fidelity` is one test in `create-player.test.ts`.

## Waves

Each wave's tasks touch disjoint files, so their branches merge without conflicts. Every wave branches from the merged head of the wave before it.

| Wave | Tasks (parallel)                                         | Why these go together                                                                                                                                     |
| ---- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | contracts (done, integrator)                             | every shared shape, with behaviour unchanged                                                                                                              |
| 1    | 5 host · 8 colorspace hint · 4 mpv start error · 3 pactl | 5 and 8 are the two cores the others build on; 4 and 3 stand alone                                                                                        |
| 2    | 6 session · 9 downscale · 1 updater · 2 licence          | 6 runs on Task 5's real `secretStore`; 9 comes after 8 because both edit `packages/fidelity`, `scenarios.ts` and the generated table; 1 and 2 stand alone |
| 3    | 7 lint-host                                              | it scans the final tree, so it runs once everything else has merged                                                                                       |

Files each task owns in its wave:

| Task | Owns                                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5    | `main/host/**` (bodies, `fixtures/environments.ts`, `host.test.ts`), the host log line in `main/index.ts`                                                                                                                                                                                                        |
| 8    | `fidelity/src/picture.ts` (`colorspaceHintFor` body), `scenarios.ts` (two displays), `table.ts`, `engine.test.ts`, `docs/fidelity/compatibility.md`, one case in `create-player.test.ts`                                                                                                                         |
| 4    | `packages/mpv/src/{start-error,client,index}.ts`, `client.test.ts`, `e2e/screening.spec.ts`                                                                                                                                                                                                                      |
| 3    | `main/player/audio-output.ts`, its test, `fixtures/pactl-fake-spdif.json`                                                                                                                                                                                                                                        |
| 6    | `main/session.ts`, `session.test.ts`, `main/ipc.ts`, `shared/bridge.ts` (session parts), `preload/bridge.ts`, `preload/bridge.test.ts`, `renderer/src/settings/settings-screen.tsx`, `main/player/index.ts` (the `loadSession` line), `e2e/support/{jellyfin,harakiri}.ts`, `e2e/session.spec.ts`, `docs/PRD.md` |
| 9    | `fidelity/src/picture.ts` (`scalePlan` body), `engine.ts` (`learn` `outputSize`), `scenarios.ts` (one display), `engine.test.ts`, `compatibility.md`, `main/player/fidelity-watch.ts`, `fidelity-watch.test.ts`                                                                                                  |
| 1    | `main/updates.ts`, `main/updater.ts`, their tests                                                                                                                                                                                                                                                                |
| 2    | `LICENSE`, the `license` fields in each `package.json`, `README.md`                                                                                                                                                                                                                                              |
| 7    | `scripts/lint-host.ts`, `hk.pkl`, `mise.toml`, `CLAUDE.md`, and any reworded hits it reports                                                                                                                                                                                                                     |

### What a wave agent does

1. Works in its own worktree, on a branch from the wave's base. It runs `scripts/bounded.sh install 3G -- bun install --frozen-lockfile` first, because a fresh worktree has no `node_modules`.
2. Reads plan 04 for its task, this document's C1 to C4, and the CLAUDE.md rules. The plan's steps are the task. This document only overrides the plan's file lists, through the "Gaps" section.
3. Runs its own tests only, scoped to its paths: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 <paths>`. It also runs `mise run typecheck` and `mise run lint`. It does not run `mise run e2e`. The suite shares one Jellyfin container on a fixed port and one nested KWin, so the integrator runs e2e once per wave.
4. Keeps platform names and host environment reads out of feature code now. Task 7's lint enforces this only from wave 3, and anything it finds then has to be reworded.
5. Commits only its own files, as the plan's commit step names. It does not push.
6. Reports back: the branch, the commit, the test output, and any place where the plan or a contract did not fit.

Four agents at once share `harakiri.slice` (7 GB). Each scoped test run is capped at 3 GB. If a run ends with `WATCHDOG KILLED`, the run was stopped for memory, and the test did not fail. Run it again.

### The gate after each wave (integrator)

1. Merge the wave's branches in the table's order.
2. If `packages/fidelity` changed, run `mise run fidelity:table`. Then check the `compatibility.md` diff against each task's "Expected diff" in plan 04.
3. Run `mise run check`, then `mise run e2e`.
4. Review the wave's diff with a fresh reviewer, against plan 04 and C1 to C4.
5. Only then does the next wave branch from the merged head.

The gate after wave 2 also covers the owner actions in Task 2: make the repo public, and release-please cuts `v0.1.0`. The HTPC checks at the end of plan 04 run once that release is installed.
