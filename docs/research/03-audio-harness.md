# 03 — Audio harness: proving bitstream passthrough without a receiver

Date: 2026-10-29. Host: Fedora 44, kernel 7.2, PipeWire 1.6.9, WirePlumber 0.5.18, ffmpeg 8.1.3, mpv NOT installed.
Sources fetched read-only into the scratchpad (`gh api repos/<org>/<repo>/contents/<path>`, default branch, fetched 2026-10-29; mpv latest release `v0.41.0` per `gh api repos/mpv-player/mpv/releases/latest`).

Scratchpad artifacts (not committed):

- PoC extractor: `scripts/iec61937_extract.py` in the research scratchpad
- FATE samples used: `samples/` in the research scratchpad

## TL;DR

1. **mpv `--ao=pcm` writes the exact IEC 61937 stream when `--audio-spdif` is on.** ao_pcm keeps spdif sample formats (it only forces S16 when the format is _not_ spdif), negotiates up to 8 channels (WAVE_FORMAT_EXTENSIBLE), and `fwrite`s the buffers unchanged. The WAV header says 16-bit PCM, which is what IEC 61937 over HDMI is.
2. **mpv's IEC 61937 packer is FFmpeg's `spdif` muxer** (ad_spdif.c calls `av_guess_format("spdif")`). So `ffmpeg -c copy -f spdif` gives a byte-level reference made by the same code, with the same `dtshd_rate` mpv uses.
3. **FFmpeg's `spdif` demuxer only handles AC3, EAC3, DTS core (types I/II/III), MPEG audio and AAC.** It does not handle DTS-HD (type IV, 0x11) or TrueHD/MAT (0x16). On TrueHD it fails with "Not yet implemented in FFmpeg, patches welcome" (verified). For HBR streams we need our own extractor of about 60 lines. The PoC is written and checked.
4. **I proved bit-exact round trips on this machine** with real FATE samples, including **EAC3+Atmos (JOC) 7.1, TrueHD+Atmos, DTS-HD MA 7.1, and DTS:X 7.1.4**. A DTS-HD stream cut down to core-only is **caught** (the bytes do not match).
5. **A PipeWire null sink cannot take passthrough.** `support.null-audio-sink` only enumerates and accepts `SPA_MEDIA_SUBTYPE_raw`, and returns `-EINVAL` for anything else. mpv's ao_pipewire offers _only_ an IEC958 EnumFormat when spdif is on, so negotiation against a null sink fails. Capturing what PipeWire would actually send needs an ALSA sink that PipeWire treats as IEC958/HDMI. The practical route is `snd-aloop` plus an ALSA PCM whose name starts with `iec958`. That needs `modprobe` (privileged).
6. Hardware tier: the ELD in `/proc/asound/card*/eld#*` lists the sink's Short Audio Descriptors. On this machine the HDMI monitors only advertise AC-3 2ch and LPCM 2ch, and the NVidia HDMI card profile is `off`. The AV receiver's ELD has to be checked on the target box.

## 1. mpv capture paths

### 1a. `--ao=pcm`: works for every passthrough codec (from source; mpv not installed, so no end-to-end run)

Evidence (`gh api repos/mpv-player/mpv/contents/audio/out/ao_pcm.c`):

- `init()`: in the waveheader branch, `default: if (!af_fmt_is_spdif(ao->format)) ao->format = AF_FORMAT_S16;`. **Spdif formats are kept as they are.**
- `mp_chmap_sel_add_waveext(&sel)` → up to 8ch WAVE_FORMAT_EXTENSIBLE, so HBR 8ch/192 kHz fits.
- `write_wave_header`: `fmt = WAV_ID_PCM` (not float), `bits = af_fmt_to_bytes(fmt)*8`. For spdif formats `af_fmt_to_bytes` gives 2 bytes (audio/format.c `if (af_fmt_is_spdif(format))` branch), so the header says 16-bit PCM.
- `audio_write`: `fwrite(data[0], len, 1, fp)`. Raw copy, nothing converted.
- `get_state`: `delay = 0`, `free_samples = device_buffer`. The AO takes data as fast as it gets it, so runs should go faster than real time (inferred from code, **unverified** at runtime).

What mpv puts into it (`audio/decode/ad_spdif.c`):

| Source codec           | mpv `--audio-spdif` token | AF format (`af_fmt_to_str`) | Rate / ch written               | IEC 61937 Pc |
| ---------------------- | ------------------------- | --------------------------- | ------------------------------- | ------------ |
| AC3                    | `ac3`                     | spdif-ac3                   | src rate (48k) / 2              | 0x01         |
| EAC3 (incl. Atmos JOC) | `eac3`                    | spdif-eac3                  | 192000 / 2                      | 0x15         |
| DTS core               | `dts`                     | spdif-dts                   | 48k or 44.1k / 2                | 0x0B-0x0D    |
| DTS-HD MA / DTS:X      | `dts-hd`                  | spdif-dtshd                 | 192000 / 8, `dtshd_rate=768000` | 0x11         |
| DTS-HD HRA             | `dts-hd`                  | spdif-dtshd                 | 192000 / 2, `dtshd_rate=192000` | 0x11         |
| TrueHD (incl. Atmos)   | `truehd`                  | spdif-truehd                | 192000 / 8 (MAT)                | 0x16         |

Notes:

- `select_spdif_codec`: the token `dts-hd` enables `spdif_dts_hd` for codec `dts`. With only `dts`, mpv sends **core only** (FFmpeg FATE comment: "Only the core will be transferred, extensions are discarded", `tests/fate/spdif.mak`). The harness must catch this, and does (section 2c).
- TrueHD: mpv throws away packets until the first major sync (`truehd_has_major_sync`). The capture can start later than the source, so compare with prefix/offset tolerance.
- DTS-HD overflow fallback: spdifenc strips the stream to core for `dtshd_fallback_time` (default 60 s) when a frame does not fit the repetition period ("DTS-HD bitrate too high, temporarily sending core only", `libavformat/spdifenc.c` ~L227). With mpv's 768000 rate for MA this should not happen, but it is a silent degradation that only a bit-exact check catches.
- The run should also assert at runtime: libmpv property `audio-out-params/format` must equal `spdif-<codec>` (names from audio/format.c `af_fmt_to_str`; property `audio-out-params` exists per DOCS/man/input.rst L2828). This is cheap and catches "mpv decoded to PCM" without touching any file.

Example invocation (**unverified**, mpv not installed):

```
mpv --no-config --vo=null --ao=pcm --ao-pcm-file=cap.wav \
    --audio-spdif=ac3,eac3,dts-hd,truehd --aid=1 --end=30 input.mkv
```

(Pass `dts-hd`, not `dts`, for HD. The project's planned list `ac3,dts,dts-hd,eac3,truehd` is fine because it contains `dts-hd`.)

### 1b. Other mpv AOs

- `--ao=null`: has a `format` option (`OPT_AUDIOFORMAT`) and accepts any format, but writes nothing. Useful only together with the `audio-out-params` assertion. ("Did mpv pick spdif?" at zero cost.)
- `--ao=alsa`: opens `<device>` with `AES0=...,AES1=...,AES3=<rate>` appended (ao_alsa.c ~L577). For `hw:Loopback,...` the `hw` PCM does not accept AES args and mpv only falls back to `hdmi`/`iec958` for the `default` device. So mpv → `hw:Loopback` directly is likely to fail. Wrap the loopback in a user-defined ALSA PCM that takes AES args (**unverified**).
- `--ao=pipewire`: when spdif is on, it builds _only_ `spa_format_audio_iec958_build(...)` with codec and rate (ao_pipewire.c ~L599). There is no raw fallback, so the sink must support IEC958 (see section 3).

## 2. Verifying a capture

### 2a. FFmpeg `spdif` demuxer coverage (`libavformat/spdifdec.c`, last change 2026-07-09)

`spdif_get_offset_and_codec` cases: AC3, MPEG1 L1/L2/3, MPEG2 ext, MPEG2 AAC, MPEG2 LSF L1/L2/L3, DTS1/2/3, EAC3. **No DTSHD (0x11), no TRUEHD (0x16).** The default case returns `AVERROR_PATCHWELCOME`.
FATE agrees: `tests/fate/spdif.mak` has `*-remux` (mux, then demux) tests for aac/ac3/dca-core/eac3/mp2/mp3, but for DTS-HD master and MLP/TrueHD only muxer md5 tests.
The WAV demuxer also detects spdif (`libavformat/wavdec.c set_spdif` → `ff_spdif_probe`). Verified: `ffprobe sp_ac3.wav` → `ac3`, `sp_dts.wav` → `dts`. For EAC3 inside WAV it reported `pcm_s16le` (at both 48k and 192k headers). **Strip the WAV header and use `-f spdif` on the raw data, or use our own parser. Do not rely on WAV probing.**

### 2b. Verified commands (run here, ffmpeg 8.1.3)

Bit-exact check for codecs the demuxer supports (AC3/EAC3/DTS core). Hash the concatenated packet bytes, because the EAC3 burst holds several frames, so packet boundaries differ but the byte stream is the same:

```
ffmpeg -v error -i src.eac3 -map 0:a -c copy -f hash -hash sha256 -
ffmpeg -v error -f spdif -i cap.raw -map 0:a -c copy -f hash -hash sha256 -
```

Results: AC3 5.1 equal, EAC3 5.1 equal, DTS 5.1 at 48 kHz equal (framemd5 per packet also equal). A synthetic DTS at **44.1 kHz** failed to demux (`End of file / could not find codec parameters`). This is a caveat to look into, because Blu-ray DTS is 48 kHz.
To get raw data out of mpv's WAV: `ffmpeg -i cap.wav -f s16le -c copy cap.raw` (or skip the 44/68-byte header; ao_pcm writes EXTENSIBLE, so the header size is variable. Parse the `data` chunk).

### 2c. Our own IEC 61937 extractor (needed for HBR; PoC verified)

Format (LE 16-bit words as written by spdifenc and ao_pcm): sync `72 F8 1F 4E` (Pa=F872, Pb=4E1F), then Pc (data type in low 7 bits), then Pd (length: **bytes** for EAC3/DTSHD/TrueHD, **bits** for the others). Payload is byte-swapped back to big-endian.

- DTS-HD (0x11): payload = 10-byte `dtshd_start_code` (`01 00 00 00 00 00 00 00 FE FE`) + BE16 length + the original DTS frame.
- TrueHD (0x16): 61424-byte MAT frame = `mat_start_code` (20 B) at 0, `mat_middle_code` (12 B) at 30708, `mat_end_code` (16 B) at 61408, plus zero padding. Strip the codes, then walk TrueHD AUs by their 12-bit length field (in 16-bit words), skipping zero padding.
  Results on FATE samples (`fate-suite.ffmpeg.org`):

| Sample                                         | ffprobe profile                       | Mux                           | Extracted vs source                                                                             |
| ---------------------------------------------- | ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| eac3/the_great_wall_7.1.eac3                   | Dolby Digital Plus + Dolby Atmos, 8ch | `-f spdif`                    | **equal** (723456 B)                                                                            |
| dts/master_audio_7.1_24bit.dts                 | DTS-HD MA, 8ch                        | `-f spdif -dtshd_rate 768000` | **equal** (6598176 B)                                                                           |
| dts/dtsx_7.1.4_24bit.dts                       | DTS-HD MA + DTS:X                     | `-dtshd_rate 768000`          | **equal** (17532 B)                                                                             |
| truehd/atmos.thd                               | Dolby TrueHD + Dolby Atmos            | `-f spdif`                    | **prefix-equal** (55196 of 58738 B: the muxer does not flush the last partial MAT frame at EOF) |
| master_audio (no dtshd_rate, = mpv `dts` only) |                                       | `-f spdif`                    | **NOT equal** (2358064 B, core only). The downgrade is caught.                                  |

Burst scan: ma.raw 1172 bursts, all type 0x11. thd.raw 5 bursts, all type 0x16.
PoC caveat: the MID code is removed by `find()`, not by fixed offset. The production version should cut at offset 30708 and handle AUs that are split across MAT frames.

### 2d. Does Atmos / DTS:X survive?

Atmos in DD+ (JOC) and in TrueHD, and DTS:X, are carried _inside_ the elementary bitstream as extension substreams or metadata. IEC 61937 is a lossless container. So if the payload is byte-identical, the object audio is preserved. Evidence from this run: FFmpeg's own detector labels the source streams `Dolby Digital Plus + Dolby Atmos`, `Dolby TrueHD + Dolby Atmos`, `DTS-HD MA + DTS:X` (`libavcodec/profiles.c` `AV_PROFILE_EAC3_DDP_ATMOS`, `AV_PROFILE_TRUEHD_ATMOS`, `AV_PROFILE_DTS_HD_MA_X`), and the extracted bytes are identical. As an extra assertion, run `ffprobe -show_entries stream=profile` on the extracted payload and require the Atmos/X profile. I did not find a primary Dolby document stating this in the time available, so the Dolby citation is **unverified**. The empirical identity plus the FFmpeg profile is the evidence.
A related trap: FFmpeg's `truehd_core` bsf and the DTS core-only paths remove the extensions. Never let them into the pipeline.

## 3. PipeWire passthrough (the real system path)

Facts:

- Node property `iec958.codecs` (JSON array): `PCM, AC3, DTS, MPEG, MPEG2-AAC, EAC3, TRUEHD, DTSHD` (`doc/dox/config/pipewire-props.7.md` L1116, gitlab master).
- ALSA SPA sink enumerates `SPA_MEDIA_SUBTYPE_iec958` formats **only if** `state->is_iec958 || state->is_hdmi`, and those are decided by the ALSA device _name prefix_: `spa_strstartswith(props.device, "iec958")` / `"hdmi"` (`spa/plugins/alsa/alsa-pcm.c` L1057-1058, L1922). Codec gating: EAC3 needs rmax ≥ 192k; TRUEHD/DTSHD need ≥ 8 channels (L1895-1902). For EAC3 at ≤48k the sink opens 4× the rate ("some clients already multiply (mpv)"), and TRUEHD/DTSHD open 8ch (L2225-2233).
- User-facing switch: `pactl set-sink-formats <sink> 'ac3-iec61937, eac3-iec61937, dts-iec61937, truehd-iec61937, dtshd-iec61937'` (pulse-server sets `iec958Codecs` on the route, pulse-server.c L3779). The equivalent in KDE is the HDMI device's "passthrough" checkboxes. WirePlumber stores it per route (`/usr/share/wireplumber/scripts/device/state-routes.lua`, `apply-routes.lua` on this host). Persistent config: a WirePlumber rule that sets `iec958.codecs` on the HDMI node (**exact rule syntax unverified**, owned by whoever writes the setup doc).
- **Null sink: NOT possible.** `spa/plugins/support/null-audio-sink.c` builds EnumFormat with `SPA_MEDIA_SUBTYPE_raw` only, and `port_set_format` rejects non-raw with `-EINVAL` (L636-639). `pactl load-module module-null-sink` in PipeWire maps onto this node, so it is also raw-only (inferred). mpv ao_pipewire offers only IEC958 when spdif is on, so there is no format overlap. `pw-cat` has no IEC958 mode (its `TYPE_ENCODED` is compressed offload, `src/tools/pw-cat.c`).
- **snd-aloop route (needs privilege):** the module exists here (`modinfo -F filename snd-aloop` → `/lib/modules/<kernel>/kernel/sound/drivers/snd-aloop.ko.xz`) but is not loaded (`lsmod`). Design (**unverified**): `sudo modprobe snd-aloop pcm_substreams=1`, add `~/.asoundrc` `pcm.iec958loop { type hw; card Loopback; device 0 }` (the name prefix `iec958` turns on IEC958 enumeration), then add a PipeWire `context.objects` adapter `api.alsa.pcm.sink` with `api.alsa.path = "iec958loop"`, `iec958.codecs = [ AC3 EAC3 DTS DTSHD TRUEHD ]`, 8ch, rates up to 192000. Play with `mpv --ao=pipewire --audio-device=pipewire/<that node>`. Capture with `arecord -D hw:Loopback,1,0 -f S16_LE -c 8 -r 192000 -t raw cap.raw` (channels/rate must match what the sink opened: 2ch for AC3/DTS, 2ch@192k for EAC3, 8ch@192k for HBR), then run the same extractor. Risks: aloop forces both ends to the same rate/channels. Whether PipeWire applies IEC958 AES status bits to a non-HDMI hw device is untested. Volume is bypassed in iec958 passthrough mode (expected, unverified).
- Alternatives for a CI box with root: same as above in a VM or container with `--device /dev/snd` and the module loaded on the host.

### Read-only checks run here

- `pactl info` → `Server Name: PulseAudio (on PipeWire 1.6.9)`, default sink a USB audio interface (analog).
- `pactl list sinks` → 2 sinks (a USB headset and the USB audio interface), both `Formats: pcm`. No HDMI sink is active.
- `pactl list cards` → the GPU's HDMI audio card (NVidia HDA HDMI) `Active Profile: off`. It offers hdmi-stereo/surround/surround71 profiles. `/proc/asound/cards`: card0 NVidia HDA, card1 Generic HDA, and three USB audio devices (the interface, the headset and one more).
- ELD (`/proc/asound/card0/eld#0.0`): a desktop monitor, `sad0_coding_type [0x2] AC-3`, 2ch, 32/44.1/48k. `eld#0.4`: a second monitor, LPCM 2ch only. These are monitors, not an AV receiver, so the hardware tier cannot run on this desk setup.

### Hardware-tier check (target box)

`grep -E 'monitor_name|sad[0-9]+_(coding_type|channels|rates)' /proc/asound/card*/eld#*`. Expect the AV receiver to list AC-3, E-AC-3 (`[0xa]` "E-AC-3/DD+"), DTS, DTS-HD (`[0xb]`), MLP/TrueHD (`[0xc]`), and LPCM 8ch with 192k. Compare this list with `pactl list sinks` `Formats:` and with the node's `iec958.codecs`. The app should read the ELD at startup and gray out codecs the sink cannot take. (The exact strings ALSA prints for coding types beyond AC-3 and LPCM are **unverified**; this host only shows those two.)

## 4. Jellyfin side (flag only; owned by another worker)

The trigger (DD+ → AAC 5.1) is a profile problem: when the server decides to transcode or remux _video_, it also re-encodes audio unless the codec is allowed in the TranscodingProfile. The DeviceProfile must:

- list `ac3,eac3,truehd,dts,dca` (plus `mlp` alias where relevant) in `DirectPlayProfiles[].AudioCodec`,
- list the same, passthrough codecs first, in `TranscodingProfiles[].AudioCodec`, so a video transcode **copies** audio,
- leave out `MaxAudioChannels` caps lower than 8 and avoid audio CodecProfile conditions that reject Atmos/HD profiles,
- the harness should assert on `PlaybackInfo` that the response is `SupportsDirectPlay/DirectStream` or `TranscodeReasons` without an audio reason, and that the media URL keeps `AudioCodec=<source>` / `copy` (**unverified** field names).

## 5. Existing projects and test suites

- **FFmpeg FATE** `tests/fate/spdif.mak`: mux md5 for ac3/eac3/dca core/dca master (`-dtshd_rate 192000` and a too-low 96000 case showing fallback to core)/mlp/truehd (`truehd/atmos.thd`), and mux→demux remux tests for the codecs the demuxer supports. Samples: `https://fate-suite.ffmpeg.org/{truehd,eac3,dts}/`. These are the best free test corpus. Atmos/DTS:X: `truehd/atmos.thd`, `eac3/the_great_wall_7.1.eac3`, `dts/dtsx_7.1.4_24bit.dts`, `dts/master_audio_7.1_24bit.dts`. Licensing of FATE samples for redistribution is **unverified**, so download them at test time instead of vendoring.
- **Kodi** `xbmc/cores/AudioEngine/Utils/test/TestAEBitstreamPacker.cpp` (output rate/channels for TrueHD 192k/176.4k, DTS-HD MA 8ch/192k, AC3 2ch, EAC3 192k, DTS 512) and `TestAEStreamParser.cpp`. Kodi packs IEC 61937 itself (`AEPackIEC61937.cpp`, `AEBitstreamPacker.cpp`). Its tests check parameters, not bit identity.
- **mpv** `test/` has no spdif/passthrough tests (tree listing: chmap, format, img, libmpv_* ...). Our harness would be new ground there.
- LibreELEC: nothing found in the time available (**unverified**).

## Proposed tiered audio harness

| Tier                                 | Needs                                 | What runs                                                                                                             | Asserts                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 Golden/unit (CI, no mpv)          | ffmpeg                                | FATE samples → `ffmpeg -c copy -f spdif [-dtshd_rate 768000]` → TS extractor                                          | extractor round-trip equals source; burst type correct; Atmos/X profile survives; core-only downgrade detected (negative test)                                               |
| T1 mpv file capture (CI, mpv)        | mpv + ffmpeg                          | `mpv --ao=pcm --audio-spdif=ac3,eac3,dts-hd,truehd` on MKV fixtures (remux FATE samples into MKV with HEVC/HDR video) | `audio-out-params/format == spdif-<codec>`; WAV data == T0 reference bytes (same spdifenc) and the extractor gives source payload (prefix tolerance for TrueHD startup/tail) |
| T2 App integration (CI)              | Electron/Wails app + mock Jellyfin    | the real app drives libmpv/mpv IPC with ao=pcm forced by a test flag                                                  | the app passes the right spdif list; Jellyfin PlaybackInfo has no audio transcode; capture as in T1                                                                          |
| T3 PipeWire path (privileged box/VM) | snd-aloop + PipeWire iec958 ALSA node | `mpv --ao=pipewire` → iec958loop sink → `arecord` from aloop                                                          | PipeWire negotiates IEC958 (`pw-dump` shows the iec958 format on the node); captured stream passes the extractor                                                             |
| T4 Hardware smoke (target box)       | AV receiver on HDMI                   | ELD read + real play                                                                                                  | ELD SADs include the codec; `pw-dump` node format = IEC958 <codec>; manual/OCR check of the AVR front panel ("Dolby Atmos"/"DTS:X")                                          |

## Decisions

| Problem                                    | Choice                                                                                              | Why                                                                                                        | Considered & dropped                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Capture mpv's passthrough without hardware | `--ao=pcm` (WAV, 16-bit, up to 8ch)                                                                 | keeps spdif formats and writes them raw (ao_pcm.c init/audio_write); no privileges; faster than real time  | ao=null (no data); ao=alsa→hw:Loopback (AES args rejected, needs modprobe); ao=pipewire→null sink (raw-only)             |
| Decide "did mpv choose passthrough"        | libmpv `audio-out-params/format` == `spdif-*`                                                       | instant, no file I/O, catches decode-to-PCM                                                                | parsing mpv logs (brittle)                                                                                               |
| Identify burst codec                       | own parser on Pc data type (+ `ffprobe -f spdif` for AC3/EAC3/DTS)                                  | the demuxer lacks 0x11/0x16 (spdifdec.c)                                                                   | `ffprobe` alone (fails on TrueHD with PATCHWELCOME, and on DTS-HD)                                                       |
| Bit-exact assertion                        | extract payload → compare with `ffmpeg -c copy` bytes from the source (sha256 of the concatenation) | packet boundaries differ for EAC3/MAT; byte identity is the real invariant; proven on FATE Atmos/X samples | framemd5 (only valid for AC3/DTS core, 1 frame = 1 burst); decoding and comparing PCM (proves nothing about passthrough) |
| Reference stream                           | `ffmpeg -f spdif` with mpv's parameters (`dtshd_rate` 768000 for MA, 192000 for HRA)                | same libavformat muxer that mpv calls                                                                      | own packer (duplicate logic)                                                                                             |
| Atmos/DTS:X preservation                   | byte identity + `ffprobe` profile on the extracted payload                                          | the extensions live inside the bitstream; FFmpeg labels them                                               | trusting AVR-only checks                                                                                                 |
| System-path capture                        | snd-aloop + ALSA PCM named `iec958*` + PipeWire ALSA node with `iec958.codecs`                      | PipeWire only enables IEC958 for device names starting with hdmi/iec958 (alsa-pcm.c L1057)                 | PipeWire null sink (raw-only, -EINVAL); pw-cat (no IEC958 mode)                                                          |
| Hardware readiness                         | parse ELD SADs from /proc/asound                                                                    | ground truth for what the sink advertises; no privileges                                                   | trusting KDE checkboxes alone                                                                                            |
| Test corpus                                | FATE samples fetched at test time                                                                   | real Atmos/DTS:X/MA streams, small (17 KB to 6.6 MB)                                                       | synthetic ffmpeg encodes (no Atmos/X/MA encoders; DTS 44.1k synthetic did not demux)                                     |

## Open risks

- mpv was not run (not installed). The ao_pcm and spdif behavior comes from reading source. T1 must be validated first once mpv is available. Check that the mpv build links the same libavformat as the reference ffmpeg; spdifenc changes between versions would break byte comparison with T0. In that case compare extracted payloads only.
- TrueHD: tolerance is needed at startup (mpv drops packets before major sync) and at the tail (MAT not flushed). AUs split across MAT frames need careful handling. MAT internals may change in spdifenc (recent TrueHD/MAT work: `TRUEHD_NOMINAL_AU_SPACING`, `hd_buf` ring).
- EAC3 inside WAV is not detected by ffprobe's WAV demuxer, so always strip the header.
- DTS at 44.1 kHz: demux failed on a synthetic sample. Not yet understood.
- PipeWire T3 design is untested and needs root (modprobe). Whether PipeWire accepts a non-HDMI hw device named `iec958*` for passthrough is unverified.
- Hardware: this desk's HDMI sinks are monitors (AC-3 2ch / LPCM 2ch), and the NVidia HDMI profile is off. AV receiver ELD content and HBR over the NVidia HDA HDMI on kernel 7.2 are unverified.
- The citation that "Atmos is inside the bitstream" comes from FFmpeg profile detection, not from a Dolby primary source (unverified).
