# 05 — 10-foot UI, spatial navigation, gamepad input

Research date: 2026-10-29. Read-only. Every version or maintenance claim has a tag naming its source:

- `[npm]`: `curl https://registry.npmjs.org/<pkg>` (dist-tags.latest, time, maintainers.length)
- `[gh]`: `gh api repos/<owner>/<repo>` (pushed_at, stars, archived) or `.../releases/latest`
- `[src:<url>]`: raw source file from GitHub
- `unverified`: from memory or a secondary source; not checked today

## Decision table

| Problem                                                | Choice                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Considered & dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spatial/focus navigation                               | **@noriginmedia/norigin-spatial-navigation 3.4.0** (meta package → `-core` 4.2.0 + `-react` 3.3.0)                                                                                                                                                                                                        | Releases every month in 2026 (3.0.0 on 2026-03-19, then 3.4.0 on 2026-10-23) `[npm]`. 19 npm maintainers `[npm]`, 23 contributors, 26 commits since 2026-04-01 `[gh: /contributors, /commits?since]`. React peer `>=16.8.0` `[npm: -react 3.3.0]`. API has what we need: `setKeyMap`, `navigateByDirection`, `pause/resume`, `shouldFocusDOMNode`, `domNodeFocusOptions`, `isFocusBoundary`/`focusBoundaryDirections`, `saveLastFocusedChild`, `preferredChildFocusKey`, `updateAllLayouts`, `useGetBoundingClientRect`, `rtl`, `distanceCalculationMethod` `[src: tarball dist/*.d.ts of -core 4.2.0]`. Only runtime dependency is `lodash-es` `[npm]`                  | `react-tv-space-navigation` (bamlab): latest is `6.0.0-beta1` (2025-07-17), last stable 5.2.0 (2025-07-10), repo last pushed 2025-10-24, 31 open issues `[npm][gh]`. Built for React Native TV first; stale. `@bbc/tv-lrud-spatial` 0.0.18 (2026-07-09), 68 stars `[npm][gh]`: works on the DOM without React bindings and is still 0.0.x. Old `lrud` 8.0.0 (2021) `[npm]`. `js-spatial-navigation` 1.0.1 (2017) on npm, GitHub last pushed 2024-05 `[npm][gh]`. `spatial-navigation-polyfill` 1.3.1 (2019), WICG repo **archived** `[npm][gh]`. `@please/lrud` 1.0.0 (2024): React peer stops at 18 `[npm]`. `@enact/spotlight` 5.6.0 (2026-09-02) `[npm]`: tied to the Enact framework |
| Gamepad while the UI is up                             | **Gamepad API in the renderer** (`navigator.getGamepads()` polled in rAF/interval), feeding one input-intent layer                                                                                                                                                                                        | Built into Chromium. Standard mapping. Easy to fake in tests. On Linux Chromium reads joydev/evdev/hidraw itself `[src: chromium device/gamepad/gamepad_device_linux.cc]`, so no OS focus restriction applies. Blink samples data whenever the page is _visible_. Window focus only gates the "gamepad press counts as user activation" step (`GamepadUserActivationFocus`, status `stable`) `[src: navigator_gamepad.cc L127-131; runtime_enabled_features.json5]`                                                                                                                                                                                                      | Native SDL in the Electron main process for all input (keep as a fallback, see below). Not in WebKitGTK's case, see Wails row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Gamepad during playback (mpv window focused)           | **One owner per mode.** While playing, mpv owns the pad: start it with `--input-gamepad=yes` and bind `GAMEPAD_*` keys in input.conf. Actions that need the app go out over JSON IPC (`script-message` or `client-message` events the app observes). When playback stops, the renderer takes the pad back | `--input-gamepad=<yes\|no>` still exists ("Enable/disable SDL2 Gamepad support. Disabled by default.") in v0.41.0 and on master `[ctx7 /mpv-player/mpv; src: DOCS/man/options.rst v0.41.0 + master]`. mpv 0.41.0 released 2025-12-21 `[gh releases/latest]`. Key names: `GAMEPAD_DPAD_*`, `GAMEPAD_ACTION_{UP,DOWN,LEFT,RIGHT}`, `GAMEPAD_BACK/START/MENU`, shoulders, triggers, sticks `[src: input/keycodes.c]`. mpv uses SDL2 (`#include <SDL.h>`, `SDL_INIT_GAMECONTROLLER`) `[src: input/sdl_gamepad.c]`                                                                                                                                                            | Leaving the renderer to read the pad behind a fullscreen mpv. It may keep working: the page counts as "visible" while occluded on Wayland, which Chromium cannot detect (`unverified`). But rAF gets throttled, and if both mpv and the renderer react to one press you get double actions. If you go this way, set `backgroundThrottling:false` and poll with `setInterval`                                                                                                                                                                                                                                                                                                             |
| Native input fallback (Electron main or Wails Go side) | **Not now.** Keep `@kmamal/sdl` behind an `InputSource` interface as plan B                                                                                                                                                                                                                               | `@kmamal/sdl`: latest 0.11.13 (2025-08-30), `next` 1.0.0-5 (2026-10-24) moves to **SDL3** `[npm][gh commits]`. **1 maintainer** `[npm]`. Node-gyp addon (`gypfile:true`, install script downloads a prebuilt) `[npm]`, so it needs an Electron ABI rebuild or prebuilds (`unverified`)                                                                                                                                                                                                                                                                                                                                                                                   | `sdl3` npm 0.0.1 placeholder `[npm]`. `evdev` 0.3.0 (2020) `[npm]`: Linux only and too low level. `node-hid` 3.4.0 (4 maintainers, 2026-07-18) `[npm]`: raw HID with no mappings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Wails v3 on Linux                                      | Gamepad API **probably works** in WebKitGTK                                                                                                                                                                                                                                                               | WebKitGTK builds with `ENABLE_GAMEPAD` ON by default and requires libmanette ≥0.2.4 `[src: WebKit Source/cmake/OptionsGTK.cmake L100,L269-276]`. On this machine Fedora's `webkit2gtk4.1-2.54.1` and `webkitgtk6.0` both require `libmanette-0.2.so.0` (installed: libmanette-0.2.13) `[dnf repoquery / rpm -q]`. No gamepad issues in wailsapp/wails `[gh search issues]`                                                                                                                                                                                                                                                                                               | Needs a real smoke test: WebKit only exposes pads after a button press, and libmanette mappings differ from Chromium's (`unverified`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Button → mapping DB                                    | Use the browser **standard mapping**. For unknown pads, fall back to SDL_GameControllerDB through mpv/SDL                                                                                                                                                                                                 | mdqinc/SDL_GameControllerDB pushed 2026-10-27, 1787 stars `[gh]`. SDL latest release-3.4.18 (2026-10-02) `[gh]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `joymap` 2.3.0, 1 maintainer, 26 stars `[npm][gh]`. `gamepad.js` 3.0.1, 1 maintainer `[npm]`. `gamecontroller.js` 1.5.0 (2020) `[npm]`. The polling wrapper is about 60 lines, so write it in-house                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| TV remote (HDMI-CEC)                                   | **Kernel CEC → evdev keys** when the hardware has a CEC adapter (`/dev/cec0`, `cec-ctl`). Remote keys then arrive as ordinary key events (arrows, Enter, Back) and the same keyboard path handles them                                                                                                    | Needs no app code. libcec is still maintained: libcec-8.1.7 (2026-09-02), 816 stars `[gh]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `node-cec` 0.1.2 (2016) `[npm]`. Wrapping `cec-client` from libcec is a last resort. Most PC GPUs have no CEC; you need a Pulse-Eight USB adapter or a DP-CEC dongle (`unverified`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Focus-graph tests                                      | **Vitest browser mode (Playwright provider)** for norigin graphs. Pure-logic tests can use jsdom with mocked `getBoundingClientRect`                                                                                                                                                                      | norigin measures real layout (`measureLayout`, `useGetBoundingClientRect`) `[src: -core dist]`. jsdom returns zeros, so geometry tests need a real browser (`unverified` that norigin's own tests mock layout; `-core` ships a `__tests__` dir `[src]`)                                                                                                                                                                                                                                                                                                                                                                                                                  | Plain jsdom for geometry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Gamepad e2e without hardware                           | **Playwright `addInitScript` that overrides `navigator.getGamepads`** and fires `gamepadconnected`; tests drive a fake pad's state. For real end-to-end on Linux, add a **uinput virtual pad** (python-evdev `UInput` or `evemu-device`)                                                                  | No CDP domain or Playwright API for gamepads turned up (WebSearch, see Sources). Chromium on Linux enumerates pads through udev `[src: udev_gamepad_linux.cc exists]`, so a uinput device looks like real hardware                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Waiting for CDP gamepad emulation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Renderer dev server                                    | **Stay on Vite 8**                                                                                                                                                                                                                                                                                        | `@tanstack/router-plugin` 1.168.48 exports `./vite`, `./rspack`, `./webpack`, `./esbuild` only, **no Bun export** `[npm exports]`. It is built on `unplugin ^3.3.0` `[src: router-plugin/package.json]`, and unplugin 3.7.0 lists Bun as a target in its README `[npm][src: unplugin README]`, so a hand-built Bun plugin is possible but nobody ships one. Bun 1.4.4 (2026-10-22) `[npm][gh]`. Tailwind works under `Bun.serve` through `bun-plugin-tailwind` 0.1.2 (2025-10-09, a year old) in `[serve.static] plugins` of bunfig.toml. Bun docs say plugins "work in `Bun.build()`'s JS API, but not yet in the CLI" `[src: bun docs/bundler/fullstack.mdx L400-486]` | Bun fullstack server. Workable with `tsr watch` (`@tanstack/router-cli` 1.167.46, bin `tsr`) `[npm]` generating `routeTree.gen.ts`, but then you lose router code-splitting and the plugin ecosystem (paraglide's Vite plugin and so on) with no real gain inside Electron                                                                                                                                                                                                                                                                                                                                                                                                               |
| TV component library                                   | **None.** Use shadcn/Base UI plus our own 10-foot tokens and focus ring                                                                                                                                                                                                                                   | Nothing clears the bar for React + DOM: Enact (one npm maintainer, its own framework), react-tv-space-navigation (stale, RN-first). Lightning/Blits are canvas/WebGL, not React (`unverified`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Enact, bamlab, Lightning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 1. Spatial navigation details

**Recommendation: Norigin.** Use it like this:

- Call `init({ shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true } })`. Real DOM focus then follows the logical focus. That keeps `:focus-visible` styling, screen readers and Base UI's focus-based logic consistent. Scroll yourself, from `onFocus`.
- Call `setKeyMap` to add remote keys (MediaPlayPause, GoBack/BrowserBack, ContextMenu). Gamepad input should not synthesize key events. Call `navigateByDirection('up'|...)` directly from the gamepad poller, and fire Enter/Back intents through your own bus.
- Make every row a `FocusContext` with `saveLastFocusedChild` (on by default). Rails then remember their column, Netflix-style. Make modals `isFocusBoundary`.

**Virtualized rows with @tanstack/react-virtual 3.14.24** (React peer up to ^19) `[npm]`. Norigin only knows about mounted focusables, so:

- Give each item a `focusKey` built from the item id, not the index.
- In the item's `onFocus`, call `virtualizer.scrollToIndex(i, { align: 'center' })` (or `'start'` for rails).
- Set `overscan` ≥ 2 so the next item already exists in the direction of travel. Otherwise norigin finds nothing to the right and focus jumps to another row.
- When a row scrolls far enough that the focused child unmounts, norigin falls back to the parent. Restore focus with `setFocus(key)` after the virtualizer mounts the item (`unverified` exact behaviour; needs a prototype).
- After scroll or animation, call `updateAllLayouts()` if positions are cached (`unverified` whether 4.x caches).

**Testability.** Norigin is a singleton (`SpatialNavigation`), so call `destroy()` and `init()` between tests. Use `getCurrentFocusKey()` and `doesFocusableExist()` for assertions `[src: d.ts]`.

**shadcn / Base UI conflicts** (`@base-ui/react` 1.9.0, 8 maintainers, 2026-10-09 `[npm]`):

- Base UI Menu, Select, Combobox, Tabs, RadioGroup, Slider and NavigationMenu handle arrow keys themselves (roving tabindex), and Dialog/Popover trap focus. Norigin listens to `keydown` on `window`, so both act on one arrow press (`unverified` whether Base UI calls `stopPropagation`; assume no).
- Rule: while a Base UI popup or composite widget is open, call `pause()` on norigin (or turn the popup into a focus boundary), let Base UI handle the arrows, and call `resume()` on close. Wrap this once in a `useSpatialPause(open)` hook.
- Gamepad: while paused, translate d-pad into synthetic `KeyboardEvent('keydown', {key:'ArrowDown'})` dispatched on `document.activeElement`. Base UI widgets then work unchanged.
- Prefer full-screen TV pickers over small popovers for 10-foot use anyway: fewer conflicts.
- Slider: the d-pad left/right must adjust the value, not move focus. Make it a focus boundary on left/right only (`focusBoundaryDirections`).

## 2. Gamepad input details

**Chromium/Electron** `[src: navigator_gamepad.cc, runtime_enabled_features.json5]`:

- Data is withheld until the page has seen a button press: the standard "gamepad exposed" rule. Pads report `null` until then (web.dev).
- Sampling continues while the page is visible. The `gamepadconnected` event and the activation behaviour also depend on visibility.
- When the window is unfocused, the page still receives data, but presses no longer count as user activation (feature `GamepadUserActivationFocus` is stable). Only APIs gated on user activation (fullscreen, audio unlock) are affected.
- Linux backend reads the devices directly, so no OS focus gating applies. On Windows, XInput/WGI may stop delivering input to background apps (W3C thread, see Sources; `unverified` for Electron 45).
- In Electron, set `webPreferences.backgroundThrottling: false` if you need polling while mpv covers the window. The page's own `document.visibilityState` decides whether data flows.

**Electron 45 vs Wails v3:**

- Electron gives the same Chromium Gamepad API on every OS.
- Wails v3 means WebKitGTK on Linux (Gamepad API via libmanette, see table), WKWebView on macOS (Gamepad API supported, `unverified` in an embedded WKWebView) and WebView2 on Windows (Chromium).

**Mode arbitration** is the core architecture point:

```
InputHub (renderer)
  sources: KeyboardSource (incl. CEC-as-keys), GamepadApiSource, MpvIpcSource
  mode: 'browse' | 'playback'
  browse   → intents → norigin.navigateByDirection / select / back
  playback → renderer ignores GamepadApiSource; mpv has --input-gamepad=yes and
             input.conf binds GAMEPAD_BACK → "script-message app-back" etc.
             MpvIpcSource turns those client-message events into intents (show OSD menu, stop → browse)
```

- Switching modes at runtime: mpv has an `input-gamepad` option that can be set at runtime through `set_property` (`unverified`; check that it re-inits SDL), so mpv can stay alive in the background.
- Caveat: mpv's SDL gamepad reading happens in mpv's process. Whether SDL delivers pad events while mpv's window is unfocused depends on `SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS`. mpv uses no SDL window, so SDL most likely delivers them (`unverified`; test on Wayland).

**Steam Input / Steam Deck** (`unverified`, general knowledge):

- When the app runs as a non-Steam shortcut, Steam Input usually hides the physical pad and exposes a virtual Xbox 360 pad (uinput). Both Chromium and SDL see it as a standard pad, which is good.
- Risk: double input (physical plus virtual). Steam tells SDL via `SDL_GAMECONTROLLER_IGNORE_DEVICES`, but Chromium ignores that hint. Dedupe by preferring the pad whose `id` contains "Steam Virtual Gamepad" / "Valve" (`unverified` id strings).
- In Deck Game Mode the gamescope compositor runs one app fullscreen. A separate mpv window plus an Electron window may stack badly there; test this early.

## 3. Testing input without hardware

**Playwright mock pad:**

```ts
await page.addInitScript(() => {
  const pad = {
    id: "Fake (STANDARD GAMEPAD)",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  (window as any).__pad = pad;
  navigator.getGamepads = () => [pad as any, null, null, null];
  window.addEventListener("load", () =>
    window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: pad }))
  );
});
// press d-pad down for 2 frames
await page.evaluate(() => {
  const p = (window as any).__pad;
  p.buttons[13] = { pressed: true, touched: true, value: 1 };
  p.timestamp++;
});
```

Design the poller so it detects edges from `timestamp` and button state, and allow it to be driven by `requestAnimationFrame` or a fake clock.

**Real-path e2e on Linux:**

- python-evdev `UInput` with BTN_SOUTH/BTN_DPAD_* and ABS_X/Y creates a pad that Chromium and mpv/SDL enumerate like real hardware. It needs write access to `/dev/uinput` (udev rule or `input` group, a one-time user setup, not done here).
- `evemu-device` with a recorded descriptor of a real Xbox pad gives exact matching against the mapping DB.
- Use these for the mpv-mode tests: send GAMEPAD_BACK and assert the app returns to browse mode.

**Focus-graph unit tests:**

- Render small grids in Vitest browser mode (Playwright Chromium provider), call `navigateByDirection` and assert `getCurrentFocusKey()`.
- Keep a separate pure function `intentFromPadState(prev, next, repeatState)` (key repeat with initial delay and rate, stick deadzone around 0.5) and test it in node.

**Run command:** the local hook blocks one literal word. Run tests with `V="vi""test"; bunx $V --browser` or through a package.json script.

## 4. Vite 8 vs Bun fullstack (re-opened)

- Bun 1.4.4 (2026-10-22) `[npm: bun; gh releases]`.
- Tailwind 4 under Bun: supported through `bun-plugin-tailwind` (0.1.2, 3 maintainers, published 2025-10-09) `[npm]`, configured in `bunfig.toml [serve.static] plugins` `[src: bun fullstack.mdx]`. Plugins work for `Bun.serve` static routes and the `Bun.build()` JS API, "not yet in the CLI" `[src]`.
- TanStack Router file routes: `@tanstack/router-plugin` has no Bun entry `[npm exports]`. The options are:
  - (a) run `tsr watch` (router-cli 1.167.46) next to `Bun.serve`. Route generation works, automatic code splitting is lost.
  - (b) hand-wrap `unpluginRouterGeneratorFactory` / `unpluginRouterCodeSplitterFactory` (exported from the package root `[src: router-plugin/src/index.ts]`) with unplugin's Bun adapter (unplugin README lists Bun `[src]`; adapter maturity `unverified`).
- Electron/Wails only need a dev URL and a static `dist/`. Bun works for both, but Vite has the first-party plugins for router, Tailwind, React and paraglide and the HMR edge cases are worked out. **Verdict: Vite 8.** Use Bun as package manager and test runner host only.

## 5. 10-foot design references

These are rules of thumb, `unverified` against a primary source today:

- Android TV design guidelines: screen margins 48dp horizontal and 27dp vertical on a 960×540dp canvas, roughly 5% overscan safe area. At 1920×1080 that is about 96px horizontal and 54px vertical. Put this in a `--safe-x/--safe-y` token and add a user overscan slider (Kodi has one).
- Type: body text ≥ 24px at 1080p, headings 32 to 48px. Avoid thin weights and pure white on pure black (halation). Use high contrast and medium weight.
- Focus: one obvious focused state. Combine a scale of 1.05 to 1.1 with a 3 to 4px ring or outline plus a glow. Never show focus by colour alone. Respect `prefers-reduced-motion`. Use `:focus-visible` (which works because norigin sets real DOM focus).
- Layout: rails with peeking next items, no hover-only affordances, Back always works. Hold-to-repeat with acceleration on long lists.
- Reference implementations to study: jellyfin-web TV layout (v12.4, 2026-10-26 `[gh]`), jellyfin-media-player (v1.12.0, 2025-03-20 `[gh]`), Kodi Estuary skin.

## Open risks

1. **Wayland window stacking.** An Electron window plus a separate fullscreen mpv window: when Electron opens an overlay (OSD menu) above mpv, Wayland gives clients no z-order control. This is the biggest UX risk for in-playback menus. Options: mpv-side OSD (Lua `mp.input.select` exists `[ctx7]`), or embed mpv via `--wid`, which does not work on Wayland (`unverified`).
2. Double input during playback if arbitration is wrong. Also Steam Input's virtual plus physical pad duplicates.
3. Virtualized rails plus norigin: focus loss on unmount. Prototype early.
4. Base UI popups vs norigin key handling: the pause/resume discipline is a convention that someone will forget. Lint for it or wrap popups.
5. `@kmamal/sdl` fallback has 1 maintainer and is mid-migration to SDL3 (1.0.0-5 prerelease).
6. WebKitGTK gamepad in Wails is untested here. libmanette 0.2.x mapping quality is unverified.
7. Norigin is a singleton with `lodash-es` throttle. Check bundle size and test isolation.

## Sources

- npm registry JSON for every package named above (fetched 2026-10-29)
- `gh api repos/{NoriginMedia/norigin-spatial-navigation, bbc/lrud-spatial, bamlab/react-tv-space-navigation, luke-chang/js-spatial-navigation, WICG/spatial-navigation, kmamal/node-sdl, mpv-player/mpv, mdqinc/SDL_GameControllerDB, libsdl-org/SDL, Pulse-Eight/libcec, oven-sh/bun, diegodoumecq/joymap, enactjs/enact, jellyfin/*}`
- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/gamepad/navigator_gamepad.cc
- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/runtime_enabled_features.json5
- https://raw.githubusercontent.com/chromium/chromium/main/device/gamepad/gamepad_device_linux.cc
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/cmake/OptionsGTK.cmake
- https://raw.githubusercontent.com/mpv-player/mpv/{v0.41.0,master}/DOCS/man/options.rst, input/keycodes.c, input/sdl_gamepad.c; `npx ctx7 docs /mpv-player/mpv "input-gamepad"`
- https://raw.githubusercontent.com/oven-sh/bun/main/docs/bundler/fullstack.mdx and plugins.mdx
- https://raw.githubusercontent.com/TanStack/router/main/packages/router-plugin/{src/index.ts,package.json}
- W3C thread on gamepad focus: https://lists.w3.org/Archives/Public/public-webapps-github/2024May/0242.html
- web.dev gamepad article: https://web.dev/articles/gamepad
- TanStack file-based routing docs: https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing
