# 02 — HDR validation harness without an HDR display

Date: 2026-10-29. Host: Fedora 44, kernel 7.2, KDE Plasma Wayland session.
Scope: read-only research. Nothing was installed. All experiments ran as the normal user inside the scratchpad.

Tag legend: `[cmd: ...]` = local command I ran, `[src: URL/path]` = source or doc I read, `[exp]` = experiment I ran with its output summarised, `unverified` = not confirmed.

---

## 0. TL;DR

- **Strongest cheap assertion, works today with installed packages:** run a **nested `kwin_wayland --virtual`** (no root, no GPU needed). It advertises `wp_color_manager_v1` v2 with `st2084_pq` + `bt2020` + mastering/luminance features. Run mpv under it with `WAYLAND_DEBUG=client` and parse the `wp_image_description_creator_params_v1.set_tf_named(11)` / `set_primaries_named(6)` / `set_mastering_luminance` / `set_max_cll` / `wp_color_management_surface_v1.set_image_description` requests. [exp] below.
- KWin's virtual output reports **HDR: incapable** and its preferred description is sRGB/gamma22/80 nits, and `KWIN_FORCE_ASSUME_HDR_SUPPORT=1` does not change that on the virtual backend [exp]. So under KWin virtual, mpv's default `target-colorspace-hint=auto` + `target` mode tone-maps to SDR. For the "PQ passthrough" path you must force it with `--target-colorspace-hint=yes --target-colorspace-hint-mode=source`, or fake the display with `--target-trc=pq --target-prim=bt.2020 --target-peak=N`.
- To simulate a **real HDR TV** (the compositor _prefers_ PQ, so mpv's default path goes HDR on its own), use **Weston 15 headless** with `color-management=true` and `eotf-mode=st2084` on the output. The headless head advertises every EOTF and colorimetry mode [src]. Weston is in the Fedora repos (15.0.1) but is not installed.
- **Lavapipe** (installed, Mesa 26.2.5) exposes `VK_EXT_swapchain_colorspace`, `VK_EXT_hdr_metadata` and `VK_COLOR_SPACE_HDR10_ST2084_EXT` on a Wayland surface under KWin virtual [exp]. **ffmpeg libplacebo on lavapipe is bit-exact across runs** [exp], so it works as a golden-image oracle in CI.
- Fedora's ffmpeg (RPM Fusion 8.1.3) has `libplacebo` (with `apply_dolbyvision`), `libx265` (with `-dolbyvision`), the `dovi_rpu` BSF, `ssim`, `psnr`, `libvmaf` and `signalstats` [cmd]. libplacebo 7.360.1 links `libdovi.so.3` [cmd].
- **VKMS is not usable for HDR.** In mainline (7.3 tree) it has no EDID configfs attribute, no `HDR_OUTPUT_METADATA` property, and its colorops are sRGB curves only [src]. Infoframe readback needs a real GPU + EDID override + root, so it belongs in an optional tier.
- mpv over IPC exposes rich HDR state (`video-params/*` incl. max-cll/fall, mastering primaries, HDR10+ scene stats, `colormatrix=dolbyvision`, `video-target-params`, `vo-passes`). No property says "RPU applied" directly. Use `vo-passes` (look for libplacebo's `"reshaping"` shader description) plus a pixel check.

---

## 1. Installed now

`[cmd: rpm -q weston gamescope kwin mutter sway mesa-vulkan-drivers vulkan-tools ffmpeg ffmpeg-free libplacebo libva-utils x265 libdovi dovi_tool hdr10plus_tool wayland-utils; echo $XDG_SESSION_TYPE $XDG_CURRENT_DESKTOP]`

| Package                                                                                | State                                                                                              |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| kwin                                                                                   | 6.7.5-1.fc44 ✅                                                                                    |
| mesa-vulkan-drivers                                                                    | 26.2.5-1.fc44 ✅ (`lvp_icd.x86_64.json` present)                                                   |
| vulkan-tools                                                                           | 1.4.341.0 ✅                                                                                       |
| ffmpeg                                                                                 | 8.1.3-1.fc44 ✅, Vendor **RPM Fusion** `[cmd: rpm -qi ffmpeg]` (ffmpeg-free not installed)         |
| libplacebo                                                                             | 7.360.1-3.fc44 ✅, requires libdovi.so.3, libvulkan, shaderc `[cmd: rpm -q --requires libplacebo]` |
| libdovi                                                                                | 3.3.2 ✅                                                                                           |
| wayland-utils                                                                          | 1.3.0 ✅ (`wayland-info`)                                                                          |
| kscreen-doctor                                                                         | ✅ /usr/bin/kscreen-doctor                                                                         |
| weston, gamescope, mutter, sway, libva-utils, x265 CLI, dovi_tool, hdr10plus_tool, mpv | ❌ not installed                                                                                   |
| Session                                                                                | `wayland KDE`                                                                                      |

Available in repos `[cmd: dnf --cacheonly info ...]`: weston 15.0.1 (updates), gamescope 3.16.29 (updates), mutter 50.6, sway 1.11, **mpv 0.41.0 (fedora repo)**. Upstream: Weston 16.0.2 released 2026-10-26 `[src: gitlab.freedesktop.org/api/v4/projects/wayland%2Fweston/releases]`, gamescope tags 3.17.0 / 3.16.31 `[cmd: gh api repos/ValveSoftware/gamescope/tags]`, libplacebo v7.387.0 on 2026-10-25 `[cmd: gh api repos/haasn/libplacebo/releases/latest]`, mpv v0.41.0 on 2025-12-21 `[cmd: gh api repos/mpv-player/mpv/releases/latest]`.

The live desktop session also advertises `wp_color_manager_v1` v2, `frog_color_management_factory_v1` and `wp_color_representation_manager_v1`. Its output preferred description is gamma22 / 200 nits max (an SDR panel) `[cmd: wayland-info]`.

---

## 2. Q1 — What mpv exposes over JSON IPC

Sources: `[src: gh api repos/mpv-player/mpv/contents/DOCS/man/input.rst]`, `[src: .../player/command.c]`, `[src: .../video/csputils.c]`, `[src: .../video/out/vo_gpu_next.c]`, `[src: .../video/out/wayland_common.c]` (master, 2026-10-29).

| Property                                                      | What it tells you                                                                                                                                         | Notes                                                                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current-vo`                                                  | must be `gpu-next`                                                                                                                                        | command.c:4804                                                                                                                                                                               |
| `hwdec-current`                                               | `vaapi`, `vulkan`, `no`, …                                                                                                                                | command.c:4810. Pin `--hwdec=no` in CI for determinism                                                                                                                                       |
| `track-list/N/dolby-vision-profile`, `.../dolby-vision-level` | DV profile/level from the container config record                                                                                                         | input.rst:3717. Only present if the container carries a dvcC/dvvC record                                                                                                                     |
| `video-params/colormatrix`                                    | `dolbyvision` for DV (IPTPQc2) streams; `bt.2020-ncl` for HDR10/HLG                                                                                       | csputils.c:44 maps `"dolbyvision"` → `PL_COLOR_SYSTEM_DOLBYVISION`                                                                                                                           |
| `video-params/primaries`, `/gamma`, `/light`                  | `bt.2020`, `pq` / `hlg`, scene light type                                                                                                                 | csputils.c:94-107                                                                                                                                                                            |
| `video-params/min-luma`, `/max-luma`, `/max-cll`, `/max-fall` | HDR10 static metadata                                                                                                                                     | unavailable unless HDR10 metadata is present (command.c:2619-2622)                                                                                                                           |
| `video-params/prim-{red,green,blue,white}-{x,y}`              | mastering display primaries                                                                                                                               | only when they differ from the container primaries (command.c:2629)                                                                                                                          |
| `video-params/scene-max-{r,g,b}`, `/scene-avg`                | **HDR10+** dynamic metadata, updated per frame                                                                                                            | presence proves HDR10+ SEI is parsed (command.c:2623-2626)                                                                                                                                   |
| `video-params/max-pq-y`, `/avg-pq-y`                          | libplacebo peak detection output                                                                                                                          | CIE_Y metadata                                                                                                                                                                               |
| `video-params/sig-peak`                                       | deprecated                                                                                                                                                |                                                                                                                                                                                              |
| `video-out-params`                                            | same, after filters                                                                                                                                       |                                                                                                                                                                                              |
| **`video-target-params`**                                     | the **colorspace the VO renders into**: `gamma=pq` + `primaries=bt.2020` means mpv is outputting HDR; `gamma=gamma2.2`/`srgb` means it tone-mapped to SDR | input.rst:3060; command.c:4789                                                                                                                                                               |
| `vo-passes`                                                   | per-pass `desc` + timings (`fresh`/`redraw`)                                                                                                              | input.rst:3899. libplacebo labels the DV reshape shader `sh_describe(sh, "reshaping")` `[src: haasn/libplacebo src/shaders/colorspace.c:172]` and the FEL pass `"enhancement layer"` (:1723) |

### Detecting "DV RPU reshaping applied" vs the green/purple failure

No single boolean exists. Use three layers:

1. **Metadata present:** `track-list/N/dolby-vision-profile == 5` and `video-params/colormatrix == "dolbyvision"`. This proves the decoder exported the RPU and mpv tagged the frame. It does not prove the renderer used it.
2. **Renderer used it:** `vo-passes/fresh/*/desc` contains `reshaping` (DV reshaping polynomial/MMR shader). Mapping the desc string through mpv's pass list is `unverified` until mpv runs. Exact string match is risky across libplacebo versions, so match `/reshap/i`.
3. **Pixels are right** (the only real proof): screenshot, then compare against a libplacebo reference and check the chroma-cast metric (§5).

Known failure modes: the green/purple cast appears when IPTPQc2 samples are read as BT.2020 YCbCr. That happens with the libmpv render API + `vo=libmpv`, when `--vf` strips side data, when hwdec drops RPU side data, or on `--vo=gpu` (no DV support). Assert `current-vo=gpu-next` and that no `--vf` is active.

### mpv's Wayland signalling, from source (what the protocol tier asserts)

`wayland_common.c:set_color_management()` (lines 3691+):

- creates a `wp_image_description_creator_params_v1` via `create_parametric_creator`
- `set_primaries_named(primaries)` and `set_tf_named(transfer)`
- for PQ: `set_luminances(0, 10000, 203)` (`PL_COLOR_SDR_WHITE`)
- for HDR with valid metadata: `set_mastering_display_primaries(...×1e6)`, `set_mastering_luminance(min×10000, max)`, and (below the excerpt) `set_max_cll` / `set_max_fall`. `cm_metadata_sanitize()` zeroes max_cll/fall if they are inconsistent (lines 3218-3237)
- if the compositor lacks the TF or primaries, it logs `Compositor does not support transfer function: …` and calls `unset_image_description`
- verbose log lines: `Generating image creator params:` / `primaries: bt.2020, transfer: pq` (a second cheap assertion via `--msg-level=vo=v` or IPC `request_log_messages`)
- Vulkan+Wayland: mpv requests `VK_COLOR_SPACE_PASS_THROUGH_EXT` and owns the Wayland color surface itself, so it does not rely on Mesa WSI to signal `[src: video/out/vulkan/context.c:634-649]`

`--target-colorspace-hint=<auto|yes|no>` (default `auto`: only signal if display params are known). `--target-colorspace-hint-mode=<target|source|source-dynamic>` (default `target`, which falls back to `source` per property when target params are unknown) `[src: DOCS/man/options.rst:7406-7451]`.

**Important finding:** KWin 6.7.5 advertises named TFs **gamma22, st2084_pq, ext_linear, bt1886 only (no HLG)** `[cmd: wayland-info]`. So on KWin, HLG sources must be converted to PQ by libplacebo, and the HLG test asserts `set_tf_named(11)`, not 13.

---

## 3. Q2 — Headless / virtual compositors

| Compositor                                                                                                                                      | Headless HDR?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | How to read back what the client signalled                                                                                                                                                                                                                                                                                                              | Verdict                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KWin `--virtual`** (installed)                                                                                                                | Advertises `wp_color_manager_v1` v2 with PQ/BT.2020/mastering/luminances/scRGB features [exp]. Output is **HDR: incapable**, preferred description sRGB/gamma22/80 nits; `kscreen-doctor output.Virtual-0.hdr.enable` has no effect; `KWIN_FORCE_ASSUME_HDR_SUPPORT=1` has no effect on the virtual backend [exp]. The VirtualOutput ctor takes `edid` + `capabilities` [src: invent.kde.org kwin src/backends/virtual/virtual_output.cpp:22-35], but no CLI flag sets them (`unverified` whether any env/config path does) | `WAYLAND_DEBUG=client` on mpv (verified log format). The protocol is accepted and composited (tone-mapped to SDR by KWin)                                                                                                                                                                                                                               | **Primary for Tier 2.** No root, already installed, same compositor family as production                                                                |
| **Weston 15/16 headless** (`--backend=headless --renderer=gl`, `color-management=true`, `[output] eotf-mode=st2084 colorimetry-mode=bt2020rgb`) | Headless head sets `supported_eotf_mask = ALL` and `colorimetry_mask = ALL` [src: libweston/backend-headless/headless.c:579-582]; `color-management=true` requires GL renderer; ICC/`color-profile=` works on headless [src: man/weston.ini.man:215-233, 581-591]. Weston implements `set_mastering_display_primaries`, `set_mastering_luminance` and `set_max_cll` [src: libweston/color-management.c:1409-1551]                                                                                                           | (a) `WAYLAND_DEBUG`; (b) Weston debug scopes `color-lcms-profiles` / `color-lcms-transformations` / `color-lcms-optimizer` via `weston-debug` / `--debug` [src: libweston/color-lcms/color-lcms.c:394-407]; (c) **output pixel capture** (weston_capture_v1 / screenshooter, as Weston's own test suite does), which gives real compositor output in PQ | **Tier 3** "simulated HDR TV": mpv's default `auto/target` path goes HDR because the preferred description is PQ. Needs `dnf install weston` (not done) |
| gamescope `--backend headless --hdr-enabled --hdr-debug-force-output`                                                                           | Flags exist [src: ValveSoftware/gamescope src/main.cpp:146-152, 197, 212, 269-270]. HDR from clients "needs Gamescope WSI layer". It is an Xwayland-centric nested compositor; a code search for `wp_color_manager_v1` in the repo returned nothing (`unverified`: the search API may miss it)                                                                                                                                                                                                                              | Its own debug output only. No clean protocol readback                                                                                                                                                                                                                                                                                                   | Dropped: different signalling path (WSI layer, frog/X11) from what users get on KDE                                                                     |
| Mutter headless / `--virtual-monitor`                                                                                                           | `unverified` whether virtual monitors can be HDR. Mutter 50.6 is in the repos                                                                                                                                                                                                                                                                                                                                                                                                                                               | WAYLAND_DEBUG                                                                                                                                                                                                                                                                                                                                           | Dropped for MVP (primary target is KDE). Possible later GNOME-coverage tier                                                                             |
| sway/wlroots headless (`WLR_BACKENDS=headless`)                                                                                                 | sway 1.11 in the repos. wlroots color-management support on headless is `unverified`                                                                                                                                                                                                                                                                                                                                                                                                                                        | WAYLAND_DEBUG                                                                                                                                                                                                                                                                                                                                           | Dropped: older, weakest HDR story                                                                                                                       |

### The cheapest strong assertion: protocol log (verified format)

`[exp: WAYLAND_DEBUG=client wayland-info against kwin --virtual]` produced:

```
[02:58:33.925889] {Default Queue} wl_registry#2.global(48, "wp_color_manager_v1", 2)
[02:58:33.925982] {Default Queue}  -> wp_color_manager_v1#10.get_output(new id wp_color_management_output_v1#16, wl_output#14)
[02:58:33.926255] {Default Queue} wp_color_manager_v1#10.supported_feature(1)
```

Lines starting with `->` are client requests. A parser tracks object ids and asserts this chain for an HDR10 fixture:

```
-> wp_color_manager_v1#A.create_parametric_creator(new id wp_image_description_creator_params_v1#B)
-> wp_image_description_creator_params_v1#B.set_primaries_named(6)        # bt2020
-> wp_image_description_creator_params_v1#B.set_tf_named(11)              # st2084_pq
-> wp_image_description_creator_params_v1#B.set_luminances(0, 10000, 203)
-> wp_image_description_creator_params_v1#B.set_mastering_display_primaries(...)
-> wp_image_description_creator_params_v1#B.set_mastering_luminance(<min*10000>, <max>)
-> wp_image_description_creator_params_v1#B.set_max_cll(<n>)   /  set_max_fall(<n>)
-> wp_image_description_creator_params_v1#B.create(new id wp_image_description_v1#C)
   wp_image_description_v1#C.ready…(…)
-> wp_color_management_surface_v1#D.set_image_description(wp_image_description_v1#C, <intent>)
```

Enum values come from the protocol XML: primaries `srgb=1 … bt2020=6 … display_p3=9`; TF `bt1886=1 gamma22=2 … srgb=9 ext_srgb=10 st2084_pq=11 st428=12 hlg=13`. Units: mastering min luminance is in 0.0001 cd/m², max_cll/max_fall in cd/m², mastering primaries ×1,000,000 `[src: gitlab.freedesktop.org/wayland/wayland-protocols staging/color-management/color-management-v1.xml]`. The XML on main is at interface version 3; KWin advertises v2 `[cmd: wayland-info]`.

The chain shown is from mpv source; seeing mpv emit it is `unverified` until mpv is installed. Caveats: WAYLAND_DEBUG goes to stderr and is verbose (one line per frame commit), so filter it with a streaming parser. Timestamps and ids vary between runs, so assert on the semantic chain, not on raw lines.

---

## 4. Q3 — Lavapipe for CI

`[exp: VK_DRIVER_FILES=…/lvp_icd.x86_64.json vulkaninfo under the live session and under kwin --virtual]`

- Device `llvmpipe (LLVM 22.1.8, 256 bits)`. Extensions: `VK_KHR_wayland_surface`, `VK_EXT_headless_surface`, `VK_EXT_swapchain_colorspace` rev 5, `VK_EXT_hdr_metadata` rev 3.
- Surface formats under kwin --virtual include `COLOR_SPACE_HDR10_ST2084_EXT`, `BT2020_LINEAR_EXT`, `EXTENDED_SRGB_LINEAR_EXT`, `DISPLAY_P3_LINEAR_EXT` and `PASS_THROUGH_EXT` (each on 5 formats). Mesa WSI derives these from the compositor's wp_color_manager.
- ffmpeg's `libplacebo` filter runs on lavapipe (`-init_hw_device vulkan`), and two runs gave **identical md5** output [exp §5].
- mpv `--vo=gpu-next --gpu-api=vulkan` on lavapipe: `unverified` (mpv not installed). libplacebo itself clearly works on lavapipe (ffmpeg test above). Neither libplacebo's `.gitlab-ci.yml` nor mpv's `build.yml` mentions lavapipe, so upstream does not exercise this combination `[src: grep of both CI files]`. Risk: slow (expect a few fps at 1080p; use 720p or 540p fixtures). `--gpu-api=opengl` on llvmpipe is the fallback for IPC-only tests, but OpenGL loses the Wayland HDR path.
- mpv + Wayland HDR signalling does not depend on `VK_EXT_hdr_metadata`: mpv sends `wp_color_management` itself and uses PASS_THROUGH (§2). So lavapipe's WSI colorspace support is nice to have, not required.

---

## 5. Q4 — Pixel golden tests

### Producing the frame from mpv

- `screenshot video` (native resolution, no OSD), format PNG with `--screenshot-tag-colorspace=yes` (default) and `--screenshot-high-bit-depth=yes`. PNG/JXL/AVIF are "flexible csp" formats [src: video/image_writer.c:578-585], so screenshot.c passes `native_csp=true` [src: player/screenshot.c:367]. In vo_gpu_next that sets `target.color = image.color`, i.e. the frame is **rendered by libplacebo into the source colorspace (PQ/BT.2020) into a 16-bit RGBA FBO** [src: vo_gpu_next.c:1924-2060]. That is the deterministic "what gpu-next computed" image, independent of the window.
- `screenshot window` / `scaled` applies the target options/LUT/ICC (`apply_target_options`), which approximates what went to the swapchain.
- `screenshot-raw video rgba64` returns the bytes over the client API (libmpv only; JSON IPC cannot carry byte arrays, so use the file-writing `screenshot-to-file` there).
- `--screenshot-sw=yes` lacks HDR, so don't use it.
- `--vo=image` exists but uses the software path, which is not what gpu-next renders, so it can't serve as a golden source. Offscreen gpu-next without a window (`--gpu-context=displayvk`/headless) is `unverified`. Use the compositor instead.
- Open question (`unverified`): for DV, whether `image.color` after libplacebo's DV mapping is PQ/BT.2020 (expected from libplacebo's `pl_frame` DV handling). Confirm once mpv is installed.

### Reference from ffmpeg + libplacebo (verified locally)

`ffmpeg -filters` lists `libplacebo`, `libvmaf`, `psnr`, `ssim`, `signalstats` [cmd]. `ffmpeg -h filter=libplacebo` shows `apply_dolbyvision` (default true), `apply_filmgrain`, `tonemapping`, `gamut_mode`, `peak_detect`, `color_primaries`, `color_trc`, `colorspace` [cmd].

`[exp]` (all on lavapipe):

```
ffmpeg -init_hw_device vulkan -i hdr10.mkv -frames:v 1 \
  -vf "hwupload,libplacebo=format=rgba64le:colorspace=gbr:color_primaries=bt709:color_trc=bt709:tonemapping=bt.2390,hwdownload,format=rgba64le" ref.png
```

- Two runs gave identical md5 (`1d774ddd…`), so the output is **deterministic**.
- `format=rgb48le` failed. Use `rgba64le` (`[exp]`).
- `bt.2390` vs `clip` on testsrc2-in-PQ: SSIM 0.99906, PSNR 57.1 dB. That is nearly identical because testsrc2 content sits at about 203 nits. **Fixtures must contain highlights well above 1000 nits** or tone-mapping regressions won't show.

DV references: `apply_dolbyvision=1` is the correct image and `apply_dolbyvision=0` is the **known-bad (green/purple) image**. Render both with target = BT.2020/PQ (matching mpv's native_csp screenshot) and in SDR.

### Metrics and the DV P5 failure detector

1. **Relative-distance test (robust):** `d_good = 1-SSIM(mpv, ref_dv_on)`, `d_bad = 1-SSIM(mpv, ref_dv_off)`. Assert `d_good < 0.02` and `d_bad > 5*d_good`. This needs no absolute threshold tuning per clip.
2. **Chroma-cast detector (no reference needed):** convert the screenshot to yuv444p and run `signalstats`. Assert |UAVG−128| and |VAVG−128| (8-bit) are small on a fixture whose ground truth is near-neutral (grey ramp / greyscale scene). A misread IPT frame shows a strong negative-U / positive-V shift (green/magenta). Thresholds need calibration on the first real failing sample (`unverified` magnitudes).
3. Use PSNR/SSIM for regression and VMAF (libvmaf present) only for perceptual summaries, never as the gate.
4. Pin `--hwdec=no`, `--dither=no` (or a fixed dither), `--deband=no`, and `--tone-mapping`/`--gamut-mapping-mode` explicitly so mpv and the ffmpeg reference use the same algorithm.

---

## 6. Q5 — Kernel route (VKMS / EDID / infoframes)

- `vkms.ko` is present and signed for the 7.2 kernel (`CONFIG_DRM_VKMS=m`, KUnit tests `=m`) [cmd: modinfo vkms; grep /boot/config]. configfs instances exist (planes/CRTCs/encoders/connectors, connector `status`) [src: torvalds/linux Documentation/gpu/vkms.rst:54-126; drivers/gpu/drm/vkms/vkms_configfs.c] (mainline Makefile = 7.3.0).
- **No HDR in VKMS:** `vkms_connector.c` uses `drm_add_modes_noedid()` and attaches no HDR_OUTPUT_METADATA/Colorspace property. vkms.rst lists "change EDID" as **TODO** (:243, :265). The colorop pipeline only supports `DRM_COLOROP_1D_CURVE_SRGB_EOTF/INV_EOTF` and YCbCr→RGB matrices, no PQ [src: vkms_colorop.c:12-21]. KWin/Weston therefore see an SDR display.
- `drm.edid_firmware=` / debugfs `edid_override` only matter for drivers that read EDID through `drm_edid` helpers (amdgpu, i915, nouveau). VKMS ignores them because it never reads an EDID. `unverified` on this host's GPU.
- Real-GPU variant (optional Tier 5): force a **disconnected** HDMI/DP connector on with `video=HDMI-A-1:e` (kernel cmdline) + `edid_firmware=HDMI-A-1:edid/lg-c2.bin` (or a debugfs `edid_override` write + `trigger_hotplug`). KWin then sees an "HDR TV", lets kscreen-doctor enable HDR, and commits `HDR_OUTPUT_METADATA`. Read it back with `drm_info` / `modetest -c` (blob id → blob contents). Generic `infoframes/` debugfs exists only for drivers on the HDMI connector state helper framework, which excludes amdgpu/i915 (`unverified`). **Needs root** (cmdline or debugfs), a GPU with a free connector, and a reboot or hotplug. That is not CI material; it's a "dev box nightly" tier at best.

---

## 7. Q6 — Fixtures

Maintenance `[cmd: gh api repos/<r> + releases/latest]`:

| Tool                     | Latest             | Last push  | License | Notes                                                                                                                                                                                      |
| ------------------------ | ------------------ | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| quietvoid/dovi_tool      | 2.3.4 (2026-09-10) | 2026-10-24 | MIT     | active. `generate` (from XML CMv2.9/4.0, from **profile 5 / 8.1 / 8.4 JSON config**, from HDR10+ JSON, from madVR), `inject-rpu`, `extract-rpu`, `convert`, `editor`, `info` [src: README] |
| quietvoid/hdr10plus_tool | 1.7.2 (2025-12-27) | 2026-04-27 | MIT     | maintained but slower. extract/inject HDR10+ JSON                                                                                                                                          |
| libdovi (Fedora pkg)     | 3.3.2 installed    | —          | —       | dovi_tool's library, used by libplacebo                                                                                                                                                    |

Neither tool is packaged in Fedora (`rpm -q` says not installed; packaging status `unverified`). Install via `cargo install` or GitHub release binaries into the harness toolchain.

### Cutting real files (local dev, never committed)

- `ffmpeg -ss X -i src.mkv -t 10 -c copy cut.mkv` **preserves HDR10 in-band SEI** (mastering display + CLL survived on frame 1) [exp]. It cuts on keyframes, so seek to an IDR.
- DV: ffmpeg 8.1 maps the DV configuration record (dvcC/dvvC) into MKV/MP4 and passes RPU NALs through on `-c copy` (`unverified` locally, no DV sample here). The `dovi_rpu` BSF can `strip=1` (producing an HDR10-only negative control from P7/P8) or recompress RPUs [cmd: ffmpeg -h bsf=dovi_rpu]. Verify with `ffprobe -show_streams` (DOVI configuration record side data) and `-show_frames` (Dolby Vision RPU / metadata side data per frame). Use `dovi_tool extract-rpu` + `info -s` for an independent check.
- HDR10+: `-c copy` keeps the SEI T.35 in-band (`unverified` locally). Confirm with `hdr10plus_tool extract` or ffprobe `HDR Dynamic Metadata SMPTE2094-40` side data.

### Synthetic, redistributable CI fixtures (verified generator for HDR10)

`[exp]` 2 s, 720p, ~53 KB:

```
ffmpeg -init_hw_device vulkan -f lavfi -i testsrc2=s=1280x720:r=24:d=2 \
  -vf "format=yuv420p,hwupload,libplacebo=format=yuv420p10le:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=tv,hwdownload,format=yuv420p10le" \
  -c:v libx265 -preset ultrafast \
  -x265-params "hdr10=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400" hdr10.mkv
```

ffprobe then showed `hevc Main 10, yuv420p10le, bt2020nc/smpte2084/bt2020` and per-frame Mastering display metadata (primaries, 1000 nit / 0.0001 nit) plus CLL 1000/400.

Proposed fixture set (all generated in CI from lavfi or a small numpy generator, no copyrighted media):

| Fixture              | How                                                                                                                                                                                                                                               | Asserts                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hdr10_ramp_4000nit` | numpy PQ ramp + colour bars with patches at 100/1000/4000 nits → libx265 HDR10 SEI (MaxCLL=4000)                                                                                                                                                  | IPC metadata, protocol chain, tone-map golden (highlights exercised)                                                                                                                           |
| `hlg_bars`           | libplacebo `color_trc=arib-std-b67` → x265 `transfer=arib-std-b67`                                                                                                                                                                                | `gamma=hlg`; on KWin expect PQ (11) signalled                                                                                                                                                  |
| `hdr10plus_scenes`   | `hdr10plus_tool inject` of a generated JSON (2 scenes with different peaks)                                                                                                                                                                       | `video-params/scene-max-*` changes at the cut                                                                                                                                                  |
| `dv_p81_generated`   | HDR10 base + `dovi_tool generate -j profile8.1.json` + `inject-rpu`                                                                                                                                                                               | `dolby-vision-profile=8`, `vo-passes` reshaping, picture ≈ HDR10 (P8.1 is backward compatible)                                                                                                 |
| `dv_p5_synthetic`    | generate a grey ramp and colour patches **directly in IPTPQc2** (numpy: RGB→LMS→PQ→IPT using the P5 matrices dovi_tool's generator writes), encode with x265 (no VUI colour tags), inject `dovi_tool generate` P5 RPU (identity/linear reshaping) | the **green/purple detector**: correct render is neutral grey; misread shows a U/V shift. `unverified`: generator needs a prototype and P5 matrix constants from dovi_tool docs/`generator.md` |
| `dv_p7_fel`          | needs a real FEL sample. Local-only, not CI                                                                                                                                                                                                       | FEL "enhancement layer" pass                                                                                                                                                                   |
| negative controls    | `dovi_rpu=strip=1` copies of each DV fixture                                                                                                                                                                                                      | expected-bad references                                                                                                                                                                        |

---

## 8. Proposed tiered harness

| Tier                                | Runs where                 | Needs                                                                                                    | What it proves                                                                                                                                                                                                                                                                                               | Cost         |
| ----------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **T0 unit**                         | every commit, CI           | Node/TS only                                                                                             | TS mapping logic (Jellyfin stream info → expected HDR class, the mpv option set we generate, IPC response parsers, protocol-log parser fed with recorded logs)                                                                                                                                               | ms           |
| **T1 fixtures/probe**               | CI                         | ffmpeg, ffprobe, (dovi_tool, hdr10plus_tool)                                                             | generated fixtures carry what we think: ffprobe side data, DV config record, RPU count = frame count                                                                                                                                                                                                         | s            |
| **T2 mpv IPC, headless compositor** | CI                         | mpv 0.41 + `kwin_wayland --virtual` + lavapipe (`VK_DRIVER_FILES`)                                       | `current-vo=gpu-next`; `video-params` (colormatrix/primaries/gamma/max-cll/DV profile/HDR10+ scene stats); `video-target-params` per scenario: (a) SDR target → tone-mapped; (b) `--target-colorspace-hint=yes --target-colorspace-hint-mode=source` → `pq/bt.2020`; `vo-passes` contains `reshaping` for DV | ~10 s/clip   |
| **T3 protocol**                     | CI (same run as T2)        | `WAYLAND_DEBUG=client` on mpv, plus Weston 15 headless `eotf-mode=st2084` for the "real HDR TV" scenario | exact `set_tf_named(11)`/`set_primaries_named(6)`/mastering/max_cll/fall + `set_image_description` chain; on Weston, with **default** mpv options (hint=auto) mpv goes HDR on its own; HLG→PQ on KWin; SDR content does not get PQ                                                                           | ~10 s/clip   |
| **T4 pixel golden**                 | CI (nightly if slow)       | mpv `screenshot video` 16-bit PNG + ffmpeg libplacebo refs on lavapipe; optional Weston output capture   | DV reshaping really applied (relative SSIM vs dv_on/dv_off refs + chroma-cast detector); tone-map regressions (PSNR/SSIM vs stored golden, deterministic on lavapipe)                                                                                                                                        | 10-60 s/clip |
| **T5 real hardware (optional)**     | dev box, manual or nightly | real GPU (VAAPI hwdec), KWin DRM, optional EDID override (root), optional HDMI capture/analyser          | hwdec keeps DV/HDR10+ side data; KWin commits `HDR_OUTPUT_METADATA` (drm_info blob); passthrough on a real TV; eyeball checklist                                                                                                                                                                             | minutes      |

Harness implementation notes:

- Drive mpv as a subprocess with `--input-ipc-server=<sock> --idle=yes --pause --vo=gpu-next --gpu-api=vulkan --hwdec=no --msg-level=vo=v`, plus `WAYLAND_DISPLAY=<test socket>`, `VK_DRIVER_FILES=lvp` and `WAYLAND_DEBUG=client 2> proto.log`.
- Use a fresh compositor per test file: `QT_QPA_PLATFORM=offscreen kwin_wayland --virtual --socket harakiri-$RAND --width 1920 --height 1080` (verified to start in ~4 s, no root).
- Wait for `video-target-params` to be populated (observe_property) before asserting. Frame-step with `frame-step` for deterministic screenshots.

---

## 9. Decisions

| Problem                                | Choice                                                                                                  | Why                                                                                                  | Considered & dropped                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Headless compositor for HDR signalling | **KWin `--virtual`** (T2/T3)                                                                            | Installed, no root, advertises PQ/BT.2020/mastering [exp], same compositor as production             | gamescope headless (WSI-layer/X11 path, not what KDE users get); sway/wlroots (weak HDR); Mutter (not primary DE) |
| "Display prefers HDR" simulation       | **Weston 15 headless, `eotf-mode=st2084`, `color-management=true`**                                     | Headless head supports all EOTF/colorimetry modes [src]; debug scopes + output capture give readback | KWin virtual (always SDR, force env ignored [exp]); VKMS (no HDR, no EDID [src])                                  |
| Assert what the client signalled       | **`WAYLAND_DEBUG=client` parser + mpv `-v` log**                                                        | Zero extra deps, exact protocol values, format verified [exp]                                        | Compositor-side introspection (KWin has no per-surface dump; Weston debug scopes kept as secondary)               |
| Software GPU in CI                     | **lavapipe** via `VK_DRIVER_FILES`                                                                      | Installed; HDR10 swapchain colorspaces + hdr_metadata [exp]; libplacebo output deterministic [exp]   | llvmpipe GL (no Vulkan Wayland HDR path); SwiftShader (not packaged, `unverified`)                                |
| Golden reference renderer              | **ffmpeg `libplacebo` filter** (same lib as gpu-next)                                                   | Present in RPM Fusion ffmpeg, has `apply_dolbyvision`, bit-exact reruns [exp]                        | `zscale`/`tonemap` filters (different algorithms, no DV); mpv `--vo=image` (software path)                        |
| mpv frame capture                      | `screenshot video` → 16-bit PNG, tag-colorspace on (native csp)                                         | Rendered by gpu-next/libplacebo in source colorspace [src]                                           | `--screenshot-sw` (no HDR); window capture via compositor (non-deterministic scaling)                             |
| DV P5 failure detection                | SSIM relative to `apply_dolbyvision=1` vs `=0` refs + signalstats U/V cast on neutral synthetic fixture | Self-calibrating; catches the exact failure                                                          | Absolute PSNR thresholds (content-dependent); human eyeballing                                                    |
| Kernel-level HDR sink                  | **Not in CI**; optional T5 on a real GPU with EDID override                                             | VKMS lacks HDR_OUTPUT_METADATA/EDID/PQ colorops [src]; override needs root                           | VKMS configfs                                                                                                     |
| Fixture source                         | Synthetic (lavfi/numpy → libx265 HDR10 SEI; dovi_tool generate/inject; hdr10plus_tool inject)           | Redistributable, small (53 KB per 2 s) [exp]                                                         | Shipping cuts of commercial discs (copyright); public DV samples (licence unclear, `unverified`)                  |
| DV metadata tooling                    | dovi_tool 2.3.4 / hdr10plus_tool 1.7.2 (MIT) + ffmpeg `dovi_rpu` BSF                                    | Actively maintained [cmd], ffmpeg BSF covers strip/compress without extra tools                      | MP4Box/mkvmerge-only flows (no RPU generation)                                                                    |

---

## 10. Open risks

1. **mpv not installed**, so every mpv-side claim (property values at runtime, the emitted protocol chain, lavapipe gpu-next performance, the DV `image.color` in native-csp screenshots, `vo-passes` desc strings) comes from source and is `unverified`. Next step: `dnf install mpv` (0.41.0 in the fedora repo) and run T2/T3 against the HDR10 fixture already generated at `scratchpad/fx/hdr10.mkv`.
2. KWin virtual cannot pretend to be an HDR display, so mpv's **default** HDR decision path is only covered by Weston (different compositor quirks from KWin) or T5 hardware. The KWin VirtualOutput has `edid`/`capabilities` ctor params; whether a test-only path to set them exists is `unverified` (worth asking KDE or reading `virtual_backend.cpp`).
3. The synthetic DV P5 (IPTPQc2) generator is a custom prototype. Getting the matrices wrong would yield a fixture that is "wrong both ways".
4. Lavapipe speed with 4K/10-bit and DV reshaping is unknown. Keep fixtures at ≤720p and a few frames.
5. libplacebo version skew: Fedora libplacebo 7.360 vs upstream 7.387. mpv and ffmpeg must link the same libplacebo for goldens to match. Pin and record `libplacebo` version in golden metadata.
6. HLG is not advertised by KWin 6.7.5, which affects passthrough expectations for HLG broadcasts.
7. WAYLAND_DEBUG output format is libwayland-internal (not a stable API), so a format change would break the parser. Keep a recorded-log unit test (T0).
