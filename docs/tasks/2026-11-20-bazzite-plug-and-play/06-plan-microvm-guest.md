---
task: 2026-11-20-bazzite-plug-and-play
type: plan
repo: harakiri
branch: tcorzo/bazzite-first-party
sha: 25991bc3f6ab1d9b9d8bb522914071a50ef71715
---

**Repos touched:** `harakiri`

# Bazzite plug and play, part 2: a declared microVM guest runs e2e and the first platform checks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run e2e and a new platform tier inside a declared `fedora:44` smolvm guest, so no test uses the dev box's mpv, sinks, keyring or input devices, and add the two checks that would have caught #8 and #13.

**Architecture:** `dev/vm/` declares one guest: a checked-in Smolfile, a root provisioning script, and a per-command user session with PipeWire and the fake `iec958_null` sink. `dev/vm/guest.sh` is the only entry point. It runs smolvm under `scripts/bounded.sh`, keeps all state in `.cache/vm`, and mounts the worktree at `/workspace`. The guest reaches the host's e2e Jellyfin over TCP on the host's loopback. A new `*.platform.test.ts` tier runs only in the guest, and a global setup throws anywhere else.

**Tech Stack:** smolvm 1.35.5 (KVM), Fedora 44, KWin `--virtual`, lavapipe, PipeWire 1.6 + WirePlumber + pipewire-pulse, python3-evdev, vitest 5 projects, Playwright 1.64 projects and tags, bash.

**Spec:** `docs/tasks/2026-11-20-bazzite-plug-and-play/03-structure-outline-bazzite-plug-and-play.md` (Phase 4 and the resolved Open Question "Jellyfin from inside the guest"), `01-research-bazzite-game-mode.md` §13.2 and §13.4 (the spike), `02-design-discussion-bazzite-plug-and-play.md` Q11. Where they differ, the outline wins.

**Not in this plan:** a CI workflow that boots the guest on GitHub runners (research §13.4 check 6 is documented, not run), the Bazzite userland `podman run` check (Q11), recorded host-fact fixtures (Q11), an IEC 61937 link to the fake sink (research Open Question 6), and the Phase 7 and Phase 10 platform tests.

## Decisions this plan makes beyond the outline

- **UDP to the host's loopback does not reach the host, so the discovery tests stay on the host.** This was checked on 2026-11-21 with smolvm 1.35.5 and the running `harakiri-jellyfin-e2e` container. From the host, `who is JellyfinServer?` to `127.0.0.3:7359` got the server's JSON reply. From the guest, TCP `GET http://127.0.0.1:8296/System/Info/Public` got the same server, but the UDP probe to `127.0.0.3:7359` timed out every time. Four setups gave that result: `machine run --allow-host-loopback`, `--net --allow-host-loopback`, the same plus `--allow-udp 127.0.0.3/32:7359`, and a persistent machine started with `SMOLVM_ALLOW_HOST_LOOPBACK=1`. So the `onboarding.spec.ts` describe "with the server answering discovery on loopback" (7 tests) gets the Playwright tag `@host`, and the `host` project runs it on the host under nested KWin as today. The describe "with no server answering discovery" uses 127.0.0.2 and runs in the guest.
- **`--allow-host-loopback` exists only on `machine run` in 1.35.5. `machine create` rejects it** (`unexpected argument`). A persistent machine gets the same grant when `machine start` runs with `SMOLVM_ALLOW_HOST_LOOPBACK=1` in its environment (`crates/smolvm-network/src/egress.rs`, `FloorMode::MetadataOnly`). This was verified with a TCP request from the guest to `127.0.0.1:8296`.
- **The Smolfile holds what is the same in every checkout. The CLI holds what differs.** `dev/vm/Smolfile` sets the image, CPUs, memory, network and workload. `guest.sh` passes the mounts with `-v` (they are absolute host paths) and the loopback grant through the environment. The Smolfile reference lists no loopback key.
- **The guest runs mise's own bun and node.** `guest.sh` mounts `$(mise where bun)` and `$(mise where node)` read-only at `/opt/harakiri/bun` and `/opt/harakiri/node`. The guest then runs the pinned bun 1.4.4 and node 26.13.0 without a download. `bun x vitest` and `bun x playwright` start node through their shebangs, so the guest needs both.
- **A marker file tells a test that it runs in the guest.** `provision.sh` writes it as root: `/etc/harakiri-guest`. The platform tier's vitest `globalSetup` throws when the marker is missing. An environment variable was rejected, because anyone can set one on the host, and the pad test must never create a uinput device on the owner's desktop.
- **`guest.sh exec` starts the guest when it is stopped, and stops it afterwards if it started it.** So a 4 GiB VM never stays up next to a 3 GiB build or a 4 GiB host e2e in the 7 GB slice. `vm:up` and `vm:down` are for interactive sessions.
- **Provisioning runs through `machine exec`, not the Smolfile's `init`.** Its output streams, its failure stops `up`, and a hash of the recipe files decides when to recreate the machine.
- **Phase 5's `session.platform.test.ts` is not a separate file.** Plan 04 moved it here. The guest has no Secret Service and no KWallet, and `e2e/support/harakiri.ts` already launches with `XDG_CURRENT_DESKTOP=gamescope`. So `session.spec.ts` in the guest project is that check: "a sign-in saved without a keyring survives a restart" goes through the real `safeStorage` on a host with no keyring.
- **The fake-sink test asserts what pactl lists and what `readAudioOutput()` reports. It does not play a bitstream.** In the spike, an IEC 61937 stream got no link (§13.4 check 4). The codec list is compared sorted, because the order is PipeWire's enumeration order.
- **smolvm 1.35.5, not 1.36.x.** The spike verified 1.35.5. 1.36.0 and 1.36.1 were published on 2026-11-21.

## Interfaces later phases build on

Phase 7 changes `packages/mpv/src/gamepad.platform.test.ts` and `dev/vm/provision.sh`. Phase 10 adds `apps/desktop/src/main/steam-setup/launcher.platform.test.ts`. These names stay stable, and CLAUDE.md documents them:

- **The tier glob:** `TIERS.platform = "**/*.platform.test.{ts,tsx}"` in `vitest.shared.ts`. `hermeticExclude` and the spelled-out list in `apps/desktop/vitest.config.ts` exclude it from every default run.
- **The tier projects:** `platform:mpv` (root `packages/mpv`) and `platform:desktop` (root `apps/desktop`) in `vitest.tiers.config.ts`. Each one has `globalSetup: [<repo>/packages/harness/src/guest-setup.ts]`. A package that gets its first platform test adds one `platform(...)` line there.
- **The task:** `mise run test:platform` = `dev/vm/guest.sh exec -- bun x vitest run --config vitest.tiers.config.ts --project 'platform:*' --maxWorkers=2`.
- **Guest detection:** `packages/harness/src/guest.ts` exports:
  - `GUEST_MARKER = "/etc/harakiri-guest"`
  - `inGuest(marker = GUEST_MARKER): boolean`
  - `requireGuest(task: string, marker = GUEST_MARKER): void`, which throws ``This test runs inside the dev/vm guest. Run it with `${task}`.``

  A platform test file needs no guard of its own. e2e's global setup calls `inGuest()`.

- **`dev/vm/guest.sh up | down | exec [--cwd <repo-relative dir>] -- <command…>`:**
  - `up` downloads smolvm when it is missing, provisions when the recipe hash changed, starts the guest, and runs the root boot step.
  - `down` stops the guest and keeps its disk.
  - `exec` runs `<command>` as the guest user `harakiri` (the host's uid and gid) in `/workspace/<cwd>`, through `dev/vm/session.sh`, and exits with the command's status.
  - `session.sh` sets `HOME=/var/lib/harakiri`, a private `XDG_RUNTIME_DIR`, a D-Bus session, PipeWire + WirePlumber + pipewire-pulse with `fake-spdif` as the default sink, `PATH` with `/opt/harakiri/{bun,node}/bin` first, and `SDL_JOYSTICK_DISABLE_UDEV=1`.
  - The repo is at `/workspace` (virtiofs, read-write). TCP to the host's `127.0.0.1` works. UDP to the host's loopback does not.
- **Provisioning:** `dev/vm/provision.sh` runs once per recipe hash, as root. The packages are one bash array, `PACKAGES=( … )`, one package per line. Fedora's `mpv` sits on a line of its own with the comment `# until Phase 7: the bundled mpv replaces it`. A phase that needs a guest package adds it to the array.
- **The pad:** a root daemon, `dev/vm/pad.py serve /run/harakiri/pad.sock`. The socket is mode 0666. It reads one command per line and answers one line:
  - `plug` → `ok /dev/input/eventN`, a new "Microsoft X-Box 360 pad" (045e:028e) whose event node is 0666
  - `press <EV_KEY name>` → `ok`
  - `unplug` → `ok`
  - on failure, `error <text>`
- **The fake sink:** `node.name = "fake-spdif"`, `node.description = "Fake S/PDIF"`, the default sink in every guest session.
- **e2e:** the Playwright projects are `host` (`grep: /@host/u`) and `guest` (`grepInvert: /@host/u`). Tag a describe `@host` only when it needs UDP to the host's loopback.
- **Pins:** `dev/vm/versions.env` holds `SMOLVM_VERSION`, `SMOLVM_SHA256` and `GUEST_IMAGE`.

## Global Constraints

- Every VM starts inside `scripts/bounded.sh vm 5G`, from `guest.sh` only. The guest has 4096 MiB. The slice cap stays 7 GB. In `mise run e2e`, the guest starts only after the host half has finished, and the `exec` that started it stops it.
  - **Changed on 2026-11-22:** the guest has 2048 MiB and starts under `bounded.sh` with a 3G cap, still with 4 CPUs. Its working set measured 0.87-1.14 GB at every size. At 2048 MiB the guest e2e (49/49) and the platform tier (7/7) passed with over 1 GB still available. Two CPUs ran slower and flaked once.
- VM state lives in `<repo>/.cache/vm` (gitignored), never in `/tmp`, which is a RAM-backed tmpfs on the dev box.
- vitest always gets `--maxWorkers=2`, Playwright `--workers=1`. Tests never skip (`scripts/lint-skips.ts`). A platform test outside the guest throws and names `mise run test:platform`.
- Nothing committed holds a host path, an owner domain or a library title (`scripts/lint-private.ts`). `guest.sh` computes host paths at run time.
- No secret appears in smolvm's argv. `/proc/<pid>/cmdline` is world-readable. Passwords cross into the guest with `--secret-env NAME=NAME`.
- Pins:
  - smolvm `1.35.5`, the `linux-x86_64` tarball, sha256 `0c1e9b5de59bcf50576bdcc0aed75f7c31d855d62a1caa0e14cb60579cd78e81`, taken from the release's `checksums.sha256` asset (`gh release download v1.35.5 -R smol-machines/smolvm -p checksums.sha256`)
  - image `docker.io/library/fedora:44@sha256:15da97ed9aa94dd3d92c3925eb89520f6c80e07ea7ee24cba848d1f8b6912b3e` (the OCI index, created 2026-11-02)
- `mise run check` never boots the guest and needs no network.
- e2e never opens a window on the owner's desktop. The guest has its own KWin `--virtual`, and the host part keeps `headless.sh`.
- Commits are Conventional Commits, and each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the task's files.
- Exact copy:
  - ``This test runs inside the dev/vm guest. Run it with `mise run test:platform`.``
  - `guest.sh: <device> is missing or not read-write for this user. The guest needs KVM: add yourself to the kvm group, or on a GitHub runner install the udev rule that makes /dev/kvm 0666.`
  - ``The e2e Jellyfin at http://127.0.0.1:8296 is not ready for this corpus (<reason>). `mise run e2e` prepares it on the host before the guest runs.``

## Review Focus

1. **A platform test is started on the host**, for example `bun x vitest run --config vitest.tiers.config.ts --project 'platform:*' --maxWorkers=2` from the dev box. Expected: the run fails with the guard message, and no pad, sink or mpv starts. Pinned in Task 1.
2. **A recipe file changes while a provisioned guest exists** (a package added to `provision.sh`, the sink config edited, a new bun version). Expected: the next `up` or `exec` says `recipe changed; recreating the guest` and provisions again. It never reuses a stale guest. Pinned in Task 2.
3. **`/dev/kvm` is missing or not writable**, as on a runner without the udev rule. Expected: `guest.sh` fails before smolvm runs, with the KVM message. Pinned in Task 2.
4. **The guest's e2e runs while the host's Jellyfin is down or has not scanned this corpus** (after `mise run e2e:down`, or when someone runs only the guest half). Expected: global setup fails at once with the not-ready message, not after a Playwright timeout. Pinned in Task 5.
5. **A command in the guest fails or is killed** (a red test, or the watchdog stopping the VM scope). Expected: `exec` exits with that status and stops a guest it started. The next run starts cleanly. Pinned in Task 2.

---

### Task 1: The platform tier runs only inside the guest

**Files:**

- Create: `packages/harness/src/guest.ts`, `packages/harness/src/guest-setup.ts`
- Test: `packages/harness/src/guest.test.ts`
- Modify: `vitest.shared.ts` (TIERS and the doc comment), `vitest.tiers.config.ts`, `apps/desktop/vitest.config.ts:20-26` (the spelled-out exclude), `tsconfig.tools.json` (include `packages/mpv/vitest.config.ts`), `scripts/lint-skips.ts` (the header and `RULE` name the platform tier)

**Interfaces:**

- Produces: `GUEST_MARKER`, `inGuest`, `requireGuest` (see "Interfaces later phases build on"). `guest-setup.ts` has `export default function setup(): void`, which calls `requireGuest("mise run test:platform")`. It also produces the `platform:mpv` and `platform:desktop` projects.

- [ ] **Step 1: Write the failing test**

```ts
describe(requireGuest, () => {
  it("outside the guest, throws and names the task that runs the tier", () => {
    expect(() => requireGuest("mise run test:platform", path.join(dir, "absent"))).toThrow(
      "This test runs inside the dev/vm guest. Run it with `mise run test:platform`."
    );
  });

  it("passes when the marker exists", () => {
    writeFileSync(path.join(dir, "marker"), "harakiri dev/vm guest\n");
    expect(() => requireGuest("mise run test:platform", path.join(dir, "marker"))).not.toThrow();
    expect(inGuest(path.join(dir, "marker"))).toBe(true);
  });
});
```

`dir` is a `mkdtemp` directory, removed in `afterEach`.

- [ ] **Step 2: Run it to see it fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/harness/src/guest.test.ts`
Expected: FAIL. `./guest` does not exist.

- [ ] **Step 3: Implement**

- `guest.ts`: `inGuest` is `existsSync(marker)`.
- `vitest.shared.ts`: add `platform: "**/*.platform.test.{ts,tsx}"`. The comment gets the line `` `*.platform.test.ts`: inside the dev/vm microVM guest (`mise run test:platform`). ``
- `apps/desktop/vitest.config.ts`: add `"**/*.platform.test.{ts,tsx}"` to the spelled-out list.
- `vitest.tiers.config.ts`: import `packages/mpv/vitest.config`. Add a `platform(project, dir, base)` helper that returns `tier("platform", …)` with `test.globalSetup` set to `[path.resolve(import.meta.dirname, "packages/harness/src/guest-setup.ts")]`. In vitest 5, a project's `globalSetup` runs once for that project, before its workers start, and only when a file is queued. Add `platform("mpv", "packages/mpv", mpv)` and `platform("desktop", "apps/desktop", desktop)`.

- [ ] **Step 4: Prove the guard on the host**

Add a throwaway `packages/mpv/src/probe.platform.test.ts` with `it("runs", () => {})`, then run:

```bash
scripts/bounded.sh test 3G -- bun x vitest run --config vitest.tiers.config.ts --project 'platform:*' --maxWorkers=2
scripts/bounded.sh test 3G -- bun x vitest list --maxWorkers=2 | grep -c 'platform' || true
```

Expected: the first command fails with the guard message, and the second prints `0`. Delete the probe file.

- [ ] **Step 5: Run the tests and the gate**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/harness/src/guest.test.ts && mise run check`
Expected: PASS.

- [ ] **Step 6: Commit**

`test: add a platform tier that runs only inside the dev/vm guest`

---

### Task 2: `dev/vm` declares the guest

**Files:**

- Create: `dev/vm/versions.env`, `dev/vm/Smolfile`, `dev/vm/guest.sh` (mode 0755), `dev/vm/provision.sh`, `dev/vm/session.sh` (mode 0755), `dev/vm/asoundrc`, `dev/vm/pipewire/fake-spdif.conf`
- Modify: `mise.toml` (add `vm:up` and `vm:down`)

**Interfaces:**

- Produces: the `guest.sh` verbs, `session.sh`, the `PACKAGES` array, the marker, and the fake sink, as listed in "Interfaces later phases build on".

- [ ] **Step 1: Write the pins and the Smolfile**

`versions.env`:

```sh
SMOLVM_VERSION=1.35.5
SMOLVM_SHA256=0c1e9b5de59bcf50576bdcc0aed75f7c31d855d62a1caa0e14cb60579cd78e81
GUEST_IMAGE=docker.io/library/fedora:44@sha256:15da97ed9aa94dd3d92c3925eb89520f6c80e07ea7ee24cba848d1f8b6912b3e
```

`Smolfile`. The image is a placeholder: `guest.sh` passes `--image "$GUEST_IMAGE"`, and CLI flags win. The file says so in a comment.

```toml
image = "fedora:44"
cpus = 4
memory = 4096
net = true
cmd = ["sleep", "infinity"]
stop_timeout = 10
```

- [ ] **Step 2: Write `guest.sh`**

The flow, in bash with `set -euo pipefail`. `REPO` is two directories above the script.

```text
KVM=${HARAKIRI_KVM_DEVICE:-/dev/kvm}; [ -r "$KVM" ] && [ -w "$KVM" ] || die <the KVM message>
STATE=$REPO/.cache/vm   SMOLVM=$STATE/smolvm-$SMOLVM_VERSION-linux-x86_64/smolvm   NAME=harakiri-guest
sv() { "$SMOLVM" --state-dir "$STATE" "$@"; }

fetch:   [ -x "$SMOLVM" ] || curl -fL …/releases/download/v$V/smolvm-$V-linux-x86_64.tar.gz
         → sha256sum -c against SMOLVM_SHA256 → tar -xzf into $STATE → delete the tarball
recipe:  sha256 of versions.env, Smolfile, provision.sh, asoundrc, pipewire/fake-spdif.conf,
         plus "$REPO", "$(mise where bun)", "$(mise where node)" and "$(id -u):$(id -g)"
running: sv machine exec --name $NAME --timeout 5s -- true   (status 0 means it is up)
start:   SMOLVM_ALLOW_HOST_LOOPBACK=1 scripts/bounded.sh vm 5G -- "$SMOLVM" --state-dir "$STATE" machine start --name $NAME
up:      fetch
         if [ "$(cat $STATE/provisioned 2>/dev/null)" != "$recipe" ]:
           echo "guest.sh: recipe changed; recreating the guest"
           sv machine delete --name $NAME --force || true
           sv machine create --name $NAME --smolfile "$REPO/dev/vm/Smolfile" --image "$GUEST_IMAGE" \
             -v "$REPO:/workspace" -v "$(mise where bun):/opt/harakiri/bun:ro" -v "$(mise where node):/opt/harakiri/node:ro"
           start
           sv machine exec --name $NAME --stream -e HOST_UID=… -e HOST_GID=… -- bash /workspace/dev/vm/provision.sh
           echo "$recipe" > $STATE/provisioned
         elif ! running: start
down:    sv machine stop --name $NAME || systemctl --user stop 'harakiri-vm-*.scope'
exec:    was_up=0; running && was_up=1
         up                                   # always: a changed recipe recreates even a running guest
         [ $was_up = 0 ] && trap down EXIT
         sv machine exec --name $NAME --stream --user "$(id -u):$(id -g)" -w "/workspace/$cwd" \
           <pass-through> -- /workspace/dev/vm/session.sh "$@"
```

Pass-through:

- `-e NAME=value` for `CI`, `HARAKIRI_E2E_SERVER`, `HARAKIRI_E2E_USER` and `HARAKIRI_E2E_DISCOVERY_ADDRESS`, each only when it is set
- `--secret-env NAME=NAME` for `HARAKIRI_E2E_PASSWORD` and `JELLYFIN_DEV_PASSWORD`, each only when it is set

On 2026-11-21 with 1.35.5, these behaved as follows: `exec` returns the command's exit status, `-w` and `-e` apply, `--stream` prints as output arrives, and a machine started inside `bounded.sh` stays in that scope after `machine start` returns.

- [ ] **Step 3: Write `provision.sh`, the sink files and `session.sh`**

`provision.sh` runs as root, with `set -euo pipefail`:

1. `dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-44.noarch.rpm`
2. `dnf install -y --allowerasing "${PACKAGES[@]}"`. The array holds:
   - `kwin`, `mesa-vulkan-drivers`, `vulkan-loader`
   - `pipewire`, `wireplumber`, `pipewire-pulseaudio`, `pulseaudio-utils`
   - `ffmpeg` (RPM Fusion: Fedora's `ffmpeg-free` has no HEVC decoder)
   - `mpv` (`# until Phase 7: the bundled mpv replaces it`)
   - `python3-evdev`, `dbus-daemon`, `procps-ng`, `util-linux`, `shadow-utils`
   - Electron's runtime libraries: `gtk3`, `nss`, `alsa-lib`, `libxkbcommon`, `mesa-libgbm`, `at-spi2-atk`, `cups-libs`, `libdrm`, `fontconfig`, `dejavu-sans-fonts`
3. `useradd -o -u "$HOST_UID" -U -d /var/lib/harakiri -m harakiri`. The home is outside `/home`, so `lint-private` passes on the scripts. When `HOST_GID` differs from the new group's gid, `groupmod -o -g "$HOST_GID" harakiri`.
4. `install -m 0644 /workspace/dev/vm/asoundrc /var/lib/harakiri/.asoundrc`, then `chown harakiri:` it.
5. `install -D -m 0644 /workspace/dev/vm/pipewire/fake-spdif.conf /etc/pipewire/pipewire.conf.d/fake-spdif.conf`.
6. `printf 'harakiri dev/vm guest\n' > /etc/harakiri-guest`. This is the last line, so a failed provision leaves no marker.

`asoundrc` is `pcm.iec958_null { type null }`.

`fake-spdif.conf` is research §13.2's adapter with the name, group and description pinned. The codec spellings must match `iec958-types.h`: `TrueHD` and `DTS-HD`, never `TRUEHD` or `DTSHD`.

```text
context.objects = [
  { factory = adapter args = {
      factory.name = api.alsa.pcm.sink  node.name = fake-spdif  node.description = "Fake S/PDIF"
      media.class = Audio/Sink  api.alsa.path = "iec958_null"  node.group = pipewire.dummy
      iec958.codecs = [ PCM AC3 EAC3 TrueHD DTS DTS-HD ]
      audio.position = [ FL FR FC LFE RL RR SL SR ] } }
]
```

`session.sh <command…>`:

1. Export `HOME`, `PATH`, `SDL_JOYSTICK_DISABLE_UDEV=1`, and `XDG_RUNTIME_DIR=$(mktemp -d /tmp/harakiri-run.XXXXXX)`.
2. `exec dbus-run-session -- bash -c '…' session "$@"`. The inner script:
   - starts `pipewire`, `wireplumber` and `pipewire-pulse` in the background
   - polls for up to 5 s until `pactl list short sinks` lists `fake-spdif`
   - runs `pactl set-default-sink fake-spdif`
   - runs the command, keeps its status, kills the background jobs, and exits with that status

The guest's `/tmp` is inside the VM's memory, not the host's.

- [ ] **Step 4: Add the mise tasks**

```toml
[tasks."vm:up"]
description = "Start the dev/vm microVM guest (KVM; the first run downloads smolvm 1.35.5 and provisions Fedora 44 into .cache/vm)"
run = "dev/vm/guest.sh up"

[tasks."vm:down"]
description = "Stop the dev/vm guest, keeping its provisioned disk in .cache/vm"
run = "dev/vm/guest.sh down"
```

- [ ] **Step 5: Provision and inspect the guest**

Run `mise run watchdog` in another terminal. Then run each command, with the expected result:

| Command                                                                                                                     | Expected                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `mise run vm:up`                                                                                                            | `recipe changed; recreating the guest`, dnf output, exit 0               |
| `dev/vm/guest.sh exec -- bash -c 'id -un; pwd; bun --version; node --version'`                                              | `harakiri`, `/workspace`, `1.4.4`, `v26.13.0`                            |
| `dev/vm/guest.sh exec -- pactl get-default-sink`                                                                            | `fake-spdif`                                                             |
| `dev/vm/guest.sh exec -- pactl --format=json list sinks`                                                                    | `"truehd-iec61937, format.rate = ` among `fake-spdif`'s formats          |
| `dev/vm/guest.sh exec -- bash -c '! ldd node_modules/electron/dist/electron \| grep "not found"'`                           | exit 0. Add any missing library's package to `PACKAGES`.                 |
| `dev/vm/guest.sh exec -- bash -c 'mpv --vd=help \| grep -c hevc; mpv --no-config --vulkan-device=help \| grep -c llvmpipe'` | two numbers, each at least 1                                             |
| `dev/vm/guest.sh exec -- curl -fsS http://127.0.0.1:8296/System/Info/Public`                                                | the e2e server's JSON (start it first with `mise run e2e` if it is down) |
| `dev/vm/guest.sh exec -- bash -c 'test -w /workspace/.cache && echo writable'`                                              | `writable`                                                               |
| `mise run vm:down && dev/vm/guest.sh exec -- rpm -q kwin`                                                                   | a `kwin-…fc44` version: provisioning survives a stop                     |
| `systemctl --user list-units 'harakiri-vm-*' --no-legend`, run after the previous command                                   | empty: that `exec` started the guest, so it stopped it                   |
| `dev/vm/guest.sh exec -- false; echo $?`                                                                                    | `1`, and the guest is stopped afterwards                                 |
| `HARAKIRI_KVM_DEVICE=/nonexistent dev/vm/guest.sh up; echo $?`                                                              | the KVM message naming `/nonexistent`, then `1`                          |
| Append `# probe` to `provision.sh`, run `dev/vm/guest.sh exec -- true`, then remove the line                                | `recipe changed; recreating the guest`, then exit 0                      |
| `ps -eo args \| grep '[s]molvm'` while a long `exec` runs with `HARAKIRI_E2E_PASSWORD=x` set                                | no `x` in any argv                                                       |

The watchdog shows the guest's scope inside `harakiri.slice`, below its 5G cap.

- [ ] **Step 6: Run the gate**

Run: `mise run check`
Expected: PASS. Nothing in `check` names `guest.sh`.

- [ ] **Step 7: Commit**

`build(vm): declare a smolvm microVM guest for platform checks`

---

### Task 3: In the guest, `readAudioOutput()` reads the fake S/PDIF sink's five codecs (#8)

**Files:**

- Create: `apps/desktop/src/main/player/audio-output.platform.test.ts`
- Modify: `mise.toml` (add `test:platform`)

**Interfaces:**

- Consumes: `readAudioOutput(): Promise<AudioOutput>` from `audio-output.ts`, and the fake sink from Task 2.
- Produces: `mise run test:platform`.

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
it("PipeWire lists the fake sink's codecs with attributes, as the HTPC does (#8)", async () => {
  const { stdout } = await run("pactl", ["--format=json", "list", "sinks"]);
  const sink = Sinks.parse(JSON.parse(stdout)).find((s) => s.name === "fake-spdif");
  expect(sink?.formats).toContain("pcm");
  expect(sink?.formats.filter((f) => /^[a-z0-9]+-iec61937, format\.rate = /u.test(f))).toHaveLength(
    5
  );
});

it("readAudioOutput reports all five bitstream codecs on the fake S/PDIF sink", async () => {
  const output = await readAudioOutput();
  expect(
    output.kind === "known" ? { name: output.name, bitstream: output.bitstream.toSorted() } : output
  ).toStrictEqual({ name: "Fake S/PDIF", bitstream: ["ac3", "dts", "dts-hd", "eac3", "truehd"] });
});
```

`run` is `promisify(execFile)`. `Sinks` is a local zod schema: `z.array(z.object({ name: z.string(), formats: z.array(z.string()) }))`.

- [ ] **Step 2: Add the task**

```toml
[tasks."test:platform"]
description = "Run the platform tier inside the dev/vm microVM guest (KVM; the first run downloads smolvm and provisions the guest)"
run = "dev/vm/guest.sh exec -- bun x vitest run --config vitest.tiers.config.ts --project 'platform:*' --maxWorkers=2"
```

- [ ] **Step 3: Run it to see it pass**

Run: `mise run test:platform`
Expected: PASS, 2 tests in `platform:desktop`.

- [ ] **Step 4: See it catch #8**

In `audio-output.ts:56`, change `CODEC_BY_FORMAT.get(encodingOf(format))` to `CODEC_BY_FORMAT.get(format)` locally. Run `mise run test:platform`.
Expected: FAIL. `bitstream` is `[]`. Then run `git checkout apps/desktop/src/main/player/audio-output.ts`.

- [ ] **Step 5: Commit**

`test(audio): check the fake S/PDIF sink's codecs inside the guest`

---

### Task 4: A virtual pad reaches mpv's SDL gamepad input (#13)

**Files:**

- Create: `dev/vm/pad.py`, `dev/vm/boot.sh`, `packages/mpv/src/gamepad.platform.test.ts`
- Modify: `dev/vm/guest.sh` (the `start` step runs the boot step)

**Interfaces:**

- Consumes: `guest.sh` from Task 2, and `platform:mpv` from Task 1.
- Produces: the pad daemon and its line protocol (see "Interfaces later phases build on").

- [ ] **Step 1: Write the failing test**

```ts
it("a pad's BTN_SOUTH reaches mpv as GAMEPAD_ACTION_DOWN", async () => {
  await expect(padCommand("plug")).resolves.toMatch(/^ok \/dev\/input\/event\d+$/u);
  try {
    // input.conf in a mkdtemp dir: "GAMEPAD_ACTION_DOWN quit 42\n"
    const mpv = spawn("mpv", [
      "--no-config",
      "--idle=yes",
      "--vo=null",
      "--ao=null",
      "--input-gamepad=yes",
      `--input-conf=${conf}`,
      "--msg-level=all=v",
    ]);
    await lineMatching(mpv, /added controller: Xbox 360 Controller/u, 10_000);
    await expect(padCommand("press BTN_SOUTH")).resolves.toBe("ok");
    expect(await exitCode(mpv, 10_000)).toBe(42);
  } finally {
    await padCommand("unplug");
  }
});
```

These helpers live in the test file:

- `padCommand(line: string): Promise<string>` connects to `/run/harakiri/pad.sock`, writes `${line}\n`, and resolves the first reply line. It throws when the reply starts with `error`.
- `lineMatching(child, pattern, ms)` reads stdout and stderr line by line.
- `exitCode(child, ms)` waits for the exit. Both reject on timeout and include the last 20 lines.

Until Phase 7, `mpv` is Fedora's 0.41 from `PATH`.

- [ ] **Step 2: Run it to see it fail**

Run: `mise run test:platform`
Expected: FAIL. `connect ENOENT /run/harakiri/pad.sock`.

- [ ] **Step 3: Implement the boot step and the pad**

`boot.sh` runs as root after every start, and running it twice changes nothing:

```text
[ -e /dev/uinput ] || mknod -m 0600 /dev/uinput c 10 223
mountpoint -q /run/harakiri/dev || { mkdir -p /run/harakiri/dev; mount -t devtmpfs devtmpfs /run/harakiri/dev; }
ln -sfn /run/harakiri/dev/input /dev/input
```

In `guest.sh`, `start` then runs `sv machine exec --name $NAME -- bash /workspace/dev/vm/boot.sh`. When `test -S /run/harakiri/pad.sock` fails, it runs `sv machine exec --name $NAME -d -- python3 /workspace/dev/vm/pad.py serve /run/harakiri/pad.sock`. `-d` keeps the daemon running after `exec` returns. On 1.35.5 a detached process lived on across later `exec` calls, and so did nodes made with `mknod`.

`pad.py serve <socket>` is a `socketserver.UnixStreamServer`, and the socket is chmod 0666 after bind:

- `plug`: `evdev.UInput` named `"Microsoft X-Box 360 pad"`, vendor `0x045e`, product `0x028e`, version `0x110`, bustype `BUS_USB`. Its `EV_KEY` set is `BTN_SOUTH BTN_EAST BTN_NORTH BTN_WEST BTN_TL BTN_TR BTN_SELECT BTN_START BTN_MODE BTN_THUMBL BTN_THUMBR`. Its `EV_ABS` axes are `ABS_X ABS_Y ABS_RX ABS_RY` (−32768..32767), `ABS_Z ABS_RZ` (0..255) and `ABS_HAT0X ABS_HAT0Y` (−1..1). Wait up to 2 s for the event node, chmod it 0666, and answer `ok <path>`. A second `plug` answers `error already plugged`.
- `press <name>`: `EV_KEY` 1, `syn`, sleep 50 ms, `EV_KEY` 0, `syn`, then `ok`. An unknown name answers `error unknown key <name>`.
- `unplug`: close the device and answer `ok`. With no pad, it answers `ok` too.

This is research §13.4 check 3, done as a daemon so that the test can run as the guest user.

- [ ] **Step 4: Run it to see it pass**

Run: `mise run test:platform`
Expected: PASS, 3 tests (`platform:mpv` 1, `platform:desktop` 2).

- [ ] **Step 5: See it catch #13**

In the test, temporarily change `--input-gamepad=yes` to `--input-gamepad=no` and run `mise run test:platform`. mpv then opens no gamepad, as a build without `sdl2-gamepad` cannot.
Expected: FAIL. `added controller` never arrives. Revert.

- [ ] **Step 6: Commit**

`test(mpv): a virtual pad reaches mpv's gamepad input inside the guest`

---

### Task 5: e2e runs in the guest, and the discovery tests stay on the host

**Files:**

- Modify: `apps/desktop/playwright.config.ts` (projects)
- Modify: `apps/desktop/e2e/onboarding.spec.ts:102` (`@host` tag)
- Modify: `apps/desktop/e2e/support/global-setup.ts:132-172` (the guest branch)
- Modify: `apps/desktop/e2e/headless.sh` (comment only)
- Modify: `mise.toml` (`e2e`)
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: `inGuest()` (Task 1), `guest.sh exec --cwd` (Task 2).
- Produces: the Playwright projects `host` and `guest`, and the `@host` tag.

- [ ] **Step 1: Split the run**

- `playwright.config.ts`: add `projects: [{ name: "host", grep: /@host/u }, { name: "guest", grepInvert: /@host/u }]`. Tags count as part of the title for `grep`.
- `onboarding.spec.ts:102`: change it to `test.describe("with the server answering discovery on loopback", { tag: "@host" }, () => {`. Add a comment above it: the app's UDP probe to 127.0.0.3 does not reach the host from the smolvm guest (checked 2026-11-21, smolvm 1.35.5), so these tests run on the host.
- `global-setup.ts`: after the `REAL_SERVER` return, `if (inGuest()) { await expectPrepared(); return; }`. `expectPrepared()` compares `corpus.sha256` in the e2e state directory with the manifest's fingerprint, then runs `waitForScan(readManifest(CORPUS_DIR).entries.length, 10_000)`. Any failure throws the not-ready message, with the cause as `<reason>`: `no scan recorded`, `scanned another corpus`, or the fetch or scan error. The guest never calls podman.
- `mise.toml` `e2e`:

```bash
if [ -z "${HARAKIRI_E2E_SERVER:-}" ]; then mise run media:fetch-fate; fi
../../scripts/bounded.sh build 3G -- bun run build
../../scripts/bounded.sh e2e 4G -- bash e2e/headless.sh --project=host
../../dev/vm/guest.sh exec --cwd apps/desktop -- bash e2e/headless.sh --project=guest
```

The host half runs first, so its global setup starts and scans the container as today. The guest reuses `out/` through the mount. The task's description gets: "the specs tagged @host run on the host under nested KWin, the rest inside the dev/vm guest".

- [ ] **Step 2: Run it**

Run: `mise run e2e`
Expected: the host project passes its 7 `@host` tests, and the guest project passes every other test, including `session.spec.ts` (no keyring anywhere in the guest), `player.hdr.spec.ts` (lavapipe) and `player.passthrough.spec.ts`.

On a freshly created container, the held-Down test in `input-guard.spec.ts` can fail on `main` too. Run it again warm before you blame this change.

- [ ] **Step 3: See the not-ready guard**

Run `mise run e2e:down`, then `dev/vm/guest.sh exec --cwd apps/desktop -- bash e2e/headless.sh --project=guest`.
Expected: it fails within seconds with the not-ready message.

- [ ] **Step 4: Update CLAUDE.md**

- **Architecture:** add `` `dev/vm`: the smolvm microVM guest (Fedora 44, KWin virtual, lavapipe, PipeWire with a fake S/PDIF sink, a uinput pad) that runs e2e and the platform tier. ``
- **"How work is verified", the e2e bullet:**
  - e2e runs inside the guest and reaches the host's e2e Jellyfin over TCP on the host's loopback.
  - Specs tagged `@host` (the UDP discovery probe, which does not reach the host) run on the host under nested KWin.
  - "Podman is the only thing a fresh clone needs" becomes "Podman and a read-write `/dev/kvm`".
- **New bullet:**
  - `mise run test:platform` runs `*.platform.test.ts` in the guest.
  - `dev/vm/guest.sh exec -- <cmd>` runs anything there.
  - The guest lives in `.cache/vm` (about 2 GB), and `rm -rf .cache/vm` resets it.
  - A guest package goes in `PACKAGES` in `dev/vm/provision.sh`.
- **The `important if="you are adding or changing a test…"` block:** add `*.platform.test.ts` (the guest) to the tier list.
- **The rules table:** add the row `Platform tests run only inside the dev/vm guest | packages/harness/src/guest-setup.ts, the platform tier's globalSetup, throws without /etc/harakiri-guest`.

- [ ] **Step 5: Run the phase gate**

Run: `mise run check && mise run lint:skips && mise run test:platform`
Expected: all pass.

Check also that `check` booted nothing: during and after it, `systemctl --user list-units 'harakiri-vm-*' --no-legend` is empty.

- [ ] **Step 6: Manual check**

Run `mise run watchdog` while `mise run e2e` runs. Expected: the build, the host e2e and the guest scopes appear one after another, never together, and each stays inside `harakiri.slice` and the 7 GB cap.

- [ ] **Step 7: Commit**

`test(e2e): run e2e inside the microVM guest, with loopback discovery on the host`

---

## Self-review notes

- **Coverage:**
  - Phase 4's file list maps to Tasks 1 to 5.
  - The guest, its 4 GiB, state off `/tmp` and `bounded.sh` are in Task 2.
  - The platform glob, the tiers project and the guard are in Task 1.
  - The two platform tests are in Tasks 3 and 4.
  - `test:platform` is in Task 3, and `vm:up` and `vm:down` are in Task 2.
  - e2e in the guest and the CLAUDE.md change are in Task 5.
  - The validation lines map as follows: the `encodingOf` revert is Task 3 Step 4, e2e in the guest is Task 5 Step 2, check offline is Task 5 Step 5, lint:skips is Task 5 Step 5, and the watchdog is Task 5 Step 6.
- **Proven live while writing this plan (2026-11-21, smolvm 1.35.5):**
  - the checksum
  - TCP to the host's loopback, and UDP not reaching it
  - `SMOLVM_ALLOW_HOST_LOOPBACK` on `machine start`
  - `exec`'s exit status, `-w`, `-e`, `--stream`, `--user uid:gid` and `-d`
  - nodes made with `mknod` lasting across `exec` calls
  - a digest-pinned image reference
  - the VM staying in its `bounded.sh` scope
- **Assumed, and checked in Task 2 Step 5:** the Fedora package set, Electron's libraries, RPM Fusion's ffmpeg replacing the free libraries, the uid mapping on the virtiofs mount, and provisioning surviving a stop.
