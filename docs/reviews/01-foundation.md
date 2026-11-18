# Review 01: foundation (packages, main services, toolchain)

Adversarial review with two reviewers on different models: Reviewer A (Opus, 19 findings) and Reviewer B (Fable, 19 findings). Scope: packages/mpv, packages/jellyfin (profile, ids, stream URLs), packages/input, packages/harness, apps/desktop main (except player), preload, shared bridge, mise.toml, hk.pkl, scripts.

## Act on

| #   | Finding                                                                                                                                                  | Raised by | Fix owner                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------- |
| 1   | Jellyfin token in mpv argv, readable from `/proc/<pid>/cmdline`                                                                                          | A, B      | mpv + player fix (after the player lands) |
| 2   | Shipped mpv loads the user's config while the harness uses `--no-config`; passthrough defaults to none; lone `dts` sends DTS-HD as core                  | A, B      | mpv + harness fix                         |
| 3   | mpv outlives Electron; no single-instance lock; stale temp dirs                                                                                          | A, B      | main hardening                            |
| 4   | No navigation guard, window-open guard, IPC sender check, or CSP around the privileged preload                                                           | A, B      | main hardening                            |
| 5   | Bridge uses bare `z.url()` and plain strings instead of the branded Jellyfin schemas; two device ids                                                     | A, B      | main hardening                            |
| 6   | safeStorage `basic_text` backend treated as encryption                                                                                                   | A         | main hardening                            |
| 7   | No timeout on mpv IPC requests or harness tool runs                                                                                                      | A, B      | mpv + harness fix                         |
| 8   | FATE suite skips silently, even when configured but broken                                                                                               | A, B      | harness fix; `mise run test:fate` added   |
| 9   | Watchdog dies when a scope vanishes; acts on pressure harakiri did not cause; blocks 90 s; PSI and unit parsing fragile                                  | A, B      | coordinator (done)                        |
| 10  | `mise run dev` unbounded; `bounded.sh` has no fallback without systemd                                                                                   | B         | coordinator (done)                        |
| 11  | Space and Backspace act inside text fields; held buttons re-fire after the player-mode switch; no stick hysteresis                                       | A, B      | input fix                                 |
| 12  | `ServerUrl` mangles URLs with a query; non-atomic session write; pending-request leak; test surface in production preload; `play()` resolution undefined | A, B      | main hardening, mpv fix                   |

## Consider

- Harness asserts exact byte counts tied to this FFmpeg and mpv build (A, B). Relax to hashes and structure in the harness fix.

## Noted

- Profile tests restate constants (A, B). The real-server Jellyfin tier in the e2e wave is the real check.
- Owner's NAS paths sat in `packages/harness/src/fixtures.ts` (B). Fixed: that file is gone, and media comes from the corpus catalog (`packages/harness/src/corpus/catalog.ts`).

## Dismissed

- Global hk install (A). Prescribed deliberately by the owner's project-setup skill; repos without `hk.pkl` are unaffected.
- Missing `player/index.ts` (A, B). In flight at review time.
