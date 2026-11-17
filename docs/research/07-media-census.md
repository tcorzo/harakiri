# 07 - Media census of the real library (movies + series)

Date: 2026-10-29. Scope: every video file in the owner's movie library (168) and series library (1434), 1602 in total.

This report keeps format counts only. Titles, file names, paths, release tags and item ids are left out on purpose. The full count tables are in `07-media-census.data.md`. The aggregator and its per-file JSON were scratch scripts and are not committed.

## Method and data-quality notes

- **Pass 1** (ffprobe, given): stream and format fields, plus stream side data (the DOVI configuration record).
  - **Gap:** pass 1 asked for `frame=side_data_list` without naming any side-data fields. The frame side-data entries therefore came back as empty `{}` objects. With them, you cannot tell Mastering Display, CLL, HDR10+ and DV RPU apart.
- **Pass 2** (added by this worker, read-only ffprobe): collected the first-frame side-data **types**, `interlaced_frame`, `field_order`, `r_frame_rate`/`avg_frame_rate` and the `attached_pic` disposition for all 1602 files. The HDR10, HDR10+ and DV-RPU classification below uses pass 2.
- **Failed probes: 10 of 1602 (0.6%).** All 10 are the episodes of one 2160p WEB-DL season. The error is `Permission denied` on the file share, and the JSON is malformed because ffprobe returned nothing. These files are almost certainly DV P8.1 + HDR10 with E-AC3 5.1, the same as the next season of the same show from the same source, but they are **not counted**. Fix the share ACL to include them.
- **Interlace and VFR:** ffprobe shows `field_order` only for 644 files (all `progressive`). It is absent for the other 948 (mostly MKV, which seldom stores it). The first frame decoded `interlaced_frame=0` everywhere. Only 2 files have `r_frame_rate != avg_frame_rate`, both MP4s, and the difference is under 0.01%, so it is not VFR. **No interlaced or VFR content was detected.** Header-level signals are weak for this, so the conclusion is "none flagged", not "proven none".
- DTS:X and Atmos come only from the ffprobe 8.1.3 `profile` strings. 3 track titles say "Atmos" while ffprobe reports `ac3` or `DTS-HD MA`. Those titles are mislabelled, so they are not counted as Atmos.

## Headline findings for the client

1. **HDR is all HEVC Main10 4:2:0.** The library has no AV1-HDR, no HLG, no VP9 and no 12-bit content.
   - 92 files are Dolby Vision with a DOVI record: 51 P8.1, 12 P8.1 + HDR10+, 19 P7 FEL/MEL, 10 P5.
   - 2 more are probable DV P7 dual-PID UHD-BD `.m2ts` files.
   - 48 files are HDR10 with MDM + CLL, and 3 are HDR10+ only.
   - Every PQ file carries static metadata. There is no "PQ without MDM" case.
2. **DV P7 FEL is common (19 files, all BD remuxes).** The client has to decide between BL+RPU (mpv/libplacebo ignore the EL) and a device that does FEL.
   - **DV P5 (10 files, one 2160p WEB-DL anime season)** has no HDR10 fallback. ffprobe reports untagged colour for it. It needs real DV handling or a libplacebo reshaping tone-map, or it plays with wrong colours.
3. **Edge cases that will break naive logic:**
   - One 2160p HEVC re-encode carries a DOVI record that claims P8.1, but the stream is BT.709 SDR with no RPU. Logic that sees the DOVI record and selects DV on the AVR will display it wrongly.
   - One 1080p HEVC encode is DV P8.1 L3 at 1080p.
   - 2 UHD-BD `.m2ts` files carry a 3840x2160 PQ BL and a 1920x1080 HEVC EL as separate video PIDs.
4. **Audio.** 2533 audio streams in all. Bitstream-capable best tracks per file:
   - E-AC3 315, E-AC3 + Atmos 62, AC3 178, DTS-HD MA 66, TrueHD + Atmos 22, TrueHD 21, DTS core 12, DTS-HD MA + DTS:X 2.
   - **914 files (57%) have no bitstreamable track** (AAC, Opus, FLAC or LPCM only, mostly the anime and web series). Those files must decode to PCM. Multichannel PCM over HDMI must work, as must the correct downmix and upmix policy.
   - Layouts are 2.0, 5.1/5.1(side) and 7.1. One E-AC3 Atmos track reports `5.1.2`, and several layouts are missing (`6ch`, `8ch`). Sample rates are 48 kHz (2473), 44.1 kHz (59) and 22.05 kHz (1).
5. **Subtitles.**
   - PGS is in 614 files: bitmap subtitles, which need correct HDR rendering and positioning.
   - SRT is in 526 files, ASS in 329 (with font attachments) and VobSub/dvd_subtitle in 29. mov_text is in 3 MP4s.
   - 1272 of 1592 videos have a stem-matched external `.srt` sibling, 2865 sidecar `.srt` files in all, with language suffixes like `.es.srt`, `.es-MX.srt` and `.en.srt`.
6. **Decode.**
   - HEVC Main10 912, H.264 High 523, H.264 Main 39, HEVC Main 8-bit 9.
   - **AV1 Main10: 62** (one anime series, 11 of them at 2160p).
   - **H.264 Hi10P: 36** (anime): no hardware decoder handles it.
   - **VC-1: 11** (BD remuxes).
   - There is no MPEG-2, MPEG-4 ASP or other legacy codec.
   - Containers: MKV 1484, MP4 104, MPEG-TS 4. One of the TS files has a `.mp4` extension (an HDTV episode).
   - 157 files have an attached cover picture (mjpeg/png video stream). The video-track selection must skip it.

## Curated fixture shortlist (cut 30 s clips from these)

These come from a greedy set cover over every distinct HDR, audio, decode, subtitle and container case (17 files), lightly curated. Each row is one real file in the library; the file names stay out of this repo. The best audio track was picked by ffprobe stream index per file.

| #   | Source (format only)            | Why (cases covered)                                                                                                                                                                                          |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2160p UHD-BD remux, MKV         | DV P8.1 + HDR10 base + **HDR10+** together. Audio: TrueHD Atmos 7.1, E-AC3 Atmos, DTS-HD MA, AC3, LPCM, so one clip covers track switching across all passthrough codecs. Also PGS, SRT and an attached pic. |
| 2   | 2160p UHD-BD remux, MKV         | **DV P7 FEL/MEL + HDR10 (BD) base** (single-track MKV), TrueHD 5.1 without Atmos.                                                                                                                            |
| 3   | 2160p WEB-DL episode, MKV       | **DV P5 IPTPQc2** (no fallback, untagged colour), E-AC3.                                                                                                                                                     |
| 4   | 2160p UHD-BD encode, MP4        | **DV P8.1 in MP4** (dvh1/hvc1 path), E-AC3 + FLAC, mov_text.                                                                                                                                                 |
| 5   | 1080p HEVC encode, MKV          | **DV P8.1 L3 at 1080p**, AC3 5.1.                                                                                                                                                                            |
| 6   | 2160p HEVC re-encode, MKV       | **Bogus DOVI record on a BT.709 SDR stream** (no RPU). The client must not switch to DV or HDR. AAC 5.1 (decode to PCM).                                                                                     |
| 7   | 2160p BD remux, MKV             | **HDR10** (MDM + CLL, no DV), TrueHD Atmos, SRT.                                                                                                                                                             |
| 8   | 2160p HEVC encode, MKV          | **HDR10+ only** (SMPTE 2094-40), DTS-HD MA.                                                                                                                                                                  |
| 9   | UHD-BD stream file, m2ts        | **UHD-BD m2ts dual-PID** (PQ BL 2160p + HEVC 1080p EL stream), multiple video streams, DTS-HD MA. _A second m2ts in the library is the same case with TrueHD Atmos._                                         |
| 10  | BD stream file, m2ts            | **DTS-HD MA + DTS:X** (and DTS core), BD m2ts, H.264 SDR untagged.                                                                                                                                           |
| 11  | 2160p HEVC encode, MKV          | **2160p SDR BT.709** (HEVC 10-bit, the client must not trigger HDR), E-AC3 (no Atmos), AAC LC + HE-AAC, ASS + VobSub. Non-ASCII path (`³`, double space).                                                    |
| 12  | 1080p BD AV1 encode, MKV        | **AV1 10-bit**, Opus-only (no bitstreamable track). _Add a 2160p AV1 file from the same set if 4K AV1 hardware decode matters._                                                                              |
| 13  | 1080p BD anime episode, MKV     | **H.264 Hi10P** (software decode only), FLAC-only audio.                                                                                                                                                     |
| 14  | 1080p BD remux, MKV             | **VC-1**, TrueHD 5.1 + AC3.                                                                                                                                                                                  |
| 15  | 2160p SDR BD encode, MKV        | HEVC Main 8-bit at 2160p, **DTS with no profile reported** (6ch, no layout).                                                                                                                                 |
| 16  | 1080p BD remux, MKV             | **LPCM mono only** (24-bit). Tests PCM output, with no passthrough codec in the file.                                                                                                                        |
| 17  | 1080p HDTV episode, `.mp4`      | **`.mp4` extension holding MPEG-TS**, plus a data stream (container sniffing).                                                                                                                               |
| 18  | 1080p WEB episode, MKV          | **E-AC3 + Atmos (JOC)** on a 1080p SDR web file: the most common Atmos form (62 files).                                                                                                                      |
| opt | 2160p WEB-DL episode (unprobed) | Repeat after the permissions are fixed. Expected DV P8.1 + E-AC3.                                                                                                                                            |

The minimum set for HDR plus passthrough is #1-#10 and #16. #11-#15 and #17 add decode and container coverage. #18 is optional because #1 already holds E-AC3 Atmos.

## Summary tables

The headline counts the PRD and the fidelity scenarios rely on. Every other table is in `07-media-census.data.md`.

### Containers

| value                   | count |
| ----------------------- | ----: |
| matroska,webm           |  1484 |
| mov,mp4,m4a,3gp,3g2,mj2 |   104 |
| mpegts                  |     4 |

### Video codec

| value | count |
| ----- | ----: |
| hevc  |   921 |
| h264  |   598 |
| av1   |    62 |
| vc1   |    11 |

### HDR detail (per file)

| value                                                                     | count |
| ------------------------------------------------------------------------- | ----: |
| SDR (untagged colour)                                                     |   929 |
| SDR (bt709)                                                               |   515 |
| DV P8.1 + HDR10 base                                                      |    51 |
| HDR10 (PQ + MDM+CLL)                                                      |    48 |
| DV P7 FEL/MEL (EL present) + HDR10 base (BD)                              |    19 |
| DV P8.1 + HDR10 base + HDR10+                                             |    12 |
| DV P5 (IPTPQc2)                                                           |    10 |
| HDR10+ (SMPTE2094-40)                                                     |     3 |
| SDR (untagged trc)                                                        |     2 |
| UHD-BD m2ts: HEVC PQ BL 2160p + 2nd HEVC 1080p stream (DV P7 EL dual-PID) |     2 |
| Stale DOVI record (claims P8.1) on bt709 SDR stream, no RPU in frame      |     1 |

### Dolby Vision configuration records

| value                      | count |
| -------------------------- | ----: |
| P8 L6 compat1 bl1 el0 rpu1 |    59 |
| P7 L6 compat6 bl1 el1 rpu1 |    19 |
| P5 L6 compat0 bl1 el0 rpu1 |    10 |
| P8 L7 compat1 bl1 el0 rpu1 |     4 |
| P8 L3 compat1 bl1 el0 rpu1 |     1 |

### Best passthrough-capable track per file

| value                                          | count |
| ---------------------------------------------- | ----: |
| no bitstreamable track -> best aac LC          |   477 |
| eac3                                           |   315 |
| no bitstreamable track -> best aac HE-AAC      |   269 |
| ac3                                            |   178 |
| no bitstreamable track -> best opus            |    92 |
| no bitstreamable track -> best flac            |    75 |
| dts DTS-HD MA                                  |    66 |
| eac3 Dolby Digital Plus + Dolby Atmos          |    62 |
| truehd Dolby TrueHD + Dolby Atmos              |    22 |
| truehd                                         |    21 |
| dts DTS                                        |    11 |
| dts DTS-HD MA + DTS:X                          |     2 |
| no bitstreamable track -> best pcm (pcm_s24le) |     1 |
| dts (no profile)                               |     1 |

### Audio channel layouts (streams)

| value           | count |
| --------------- | ----: |
| stereo          |  1288 |
| 5.1(side)       |   828 |
| 5.1             |   348 |
| 7.1             |    46 |
| mono            |     8 |
| 1ch (no layout) |     3 |
| 3.0             |     2 |
| 6.1             |     2 |
| 6ch (no layout) |     2 |
| 5.1.2           |     1 |
| 8ch (no layout) |     1 |
| 2ch (no layout) |     1 |
| 5.0(side)       |     1 |
| quad            |     1 |
| 4.0             |     1 |

### Subtitle codecs (files)

| value              | count |
| ------------------ | ----: |
| hdmv_pgs_subtitle  |   614 |
| subrip             |   526 |
| ass                |   329 |
| dvd_subtitle       |    29 |
| mov_text           |     3 |
| (no embedded subs) |   314 |
