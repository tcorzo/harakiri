# 07 - Media census: format tables

The generated tables behind `07-media-census.md`, reduced to format counts. Titles, file names, paths and item ids are left out on purpose: only the formats matter for product decisions. Scope: 1,602 video files, 1,592 probed (10 failed probes, all from one season; see the main report).

Counts are per file unless the heading says streams. Labels are ffprobe 8.1.3 values.

### Containers (format_name)

| value                   | count |
| ----------------------- | ----: |
| matroska,webm           |  1484 |
| mov,mp4,m4a,3gp,3g2,mj2 |   104 |
| mpegts                  |     4 |

### File extensions

| value | count |
| ----- | ----: |
| .mkv  |  1484 |
| .mp4  |   105 |
| .m2ts |     3 |

### Video codec

| value | count |
| ----- | ----: |
| hevc  |   921 |
| h264  |   598 |
| av1   |    62 |
| vc1   |    11 |

### Video codec · profile · pix_fmt · bit depth

| value                                 | count |
| ------------------------------------- | ----: |
| hevc · Main 10 · yuv420p10le · 10-bit |   912 |
| h264 · High · yuv420p · 8-bit         |   523 |
| av1 · Main · yuv420p10le · 10-bit     |    62 |
| h264 · Main · yuv420p · 8-bit         |    39 |
| h264 · High 10 · yuv420p10le · 10-bit |    36 |
| vc1 · Advanced · yuv420p · 8-bit      |    11 |
| hevc · Main · yuv420p · 8-bit         |     9 |

### Resolution buckets (primary video)

| value  | count |
| ------ | ----: |
| 1080p  |  1367 |
| 2160p+ |   185 |
| <=SD   |    36 |
| 720p   |     4 |

### Codec x resolution

| value         | count |
| ------------- | ----: |
| hevc @ 1080p  |   731 |
| h264 @ 1080p  |   574 |
| hevc @ 2160p+ |   174 |
| av1 @ 1080p   |    51 |
| h264 @ <=SD   |    21 |
| hevc @ <=SD   |    15 |
| vc1 @ 1080p   |    11 |
| av1 @ 2160p+  |    11 |
| h264 @ 720p   |     3 |
| hevc @ 720p   |     1 |

### HDR class (per file)

| value                                  | count |
| -------------------------------------- | ----: |
| SDR                                    |  1446 |
| Dolby Vision                           |    92 |
| HDR10                                  |    48 |
| HDR10+                                 |     3 |
| Dolby Vision (probable, m2ts dual-PID) |     2 |
| DV record on SDR stream (bogus)        |     1 |

### HDR detail (per file)

| value                                                                                                     | count |
| --------------------------------------------------------------------------------------------------------- | ----: |
| SDR (untagged colour)                                                                                     |   929 |
| SDR (bt709)                                                                                               |   515 |
| DV P8.1 + HDR10 base                                                                                      |    51 |
| HDR10 (PQ + MDM+CLL)                                                                                      |    48 |
| DV P7 FEL/MEL (EL present) + HDR10 base (BD)                                                              |    19 |
| DV P8.1 + HDR10 base + HDR10+                                                                             |    12 |
| DV P5 (IPTPQc2)                                                                                           |    10 |
| HDR10+ (SMPTE2094-40)                                                                                     |     3 |
| SDR (untagged trc)                                                                                        |     2 |
| UHD-BD m2ts: HEVC PQ BL 2160p + 2nd HEVC 1080p stream (= DV P7 EL dual-PID; ffprobe gives no DOVI record) |     2 |
| Stale DOVI record (claims P8.1) on bt709 SDR stream, no RPU in frame                                      |     1 |

### Dolby Vision configuration records

| value                      | count |
| -------------------------- | ----: |
| P8 L6 compat1 bl1 el0 rpu1 |    59 |
| P7 L6 compat6 bl1 el1 rpu1 |    19 |
| P5 L6 compat0 bl1 el0 rpu1 |    10 |
| P8 L7 compat1 bl1 el0 rpu1 |     4 |
| P8 L3 compat1 bl1 el0 rpu1 |     1 |

### First-frame side data types (probe2)

| value                                       | count |
| ------------------------------------------- | ----: |
| H.26[45] User Data Unregistered SEI message |  1808 |
| Mastering display metadata                  |   127 |
| SMPTE 12-1 timecode                         |   120 |
| Content light level metadata                |   119 |
| Dolby Vision RPU Data                       |    91 |
| Dolby Vision Metadata                       |    91 |
| HDR Dynamic Metadata SMPTE2094-40 (HDR10+)  |    15 |
| ATSC A53 Part 4 Closed Captions             |     4 |

### Colour tags (primary video)

| value                                          | count |
| ---------------------------------------------- | ----: |
| trc=None prim=None cs=None range=tv            |   618 |
| trc=bt709 prim=bt709 cs=bt709 range=tv         |   514 |
| trc=None prim=None cs=None range=None          |   310 |
| trc=smpte2084 prim=bt2020 cs=bt2020nc range=tv |   135 |
| trc=None prim=None cs=None range=pc            |    10 |
| trc=bt709 prim=bt709 cs=bt709 range=None       |     2 |
| trc=None prim=bt709 cs=bt709 range=tv          |     2 |
| trc=None prim=None cs=bt709 range=tv           |     1 |

### Audio codec+profile (streams)

| value                                   | count |
| --------------------------------------- | ----: |
| aac · LC                                |   581 |
| eac3                                    |   543 |
| ac3                                     |   478 |
| aac · HE-AAC                            |   374 |
| opus                                    |   154 |
| flac                                    |   148 |
| dts · DTS-HD MA                         |    88 |
| eac3 · Dolby Digital Plus + Dolby Atmos |    70 |
| dts · DTS                               |    43 |
| truehd · Dolby TrueHD + Dolby Atmos     |    23 |
| truehd                                  |    22 |
| pcm (pcm_s24le)                         |     5 |
| dts · DTS-HD MA + DTS:X                 |     2 |
| dts                                     |     2 |

### Audio codec+profile (files containing >=1)

| value                                   | count |
| --------------------------------------- | ----: |
| aac · LC                                |   506 |
| aac · HE-AAC                            |   372 |
| eac3                                    |   335 |
| ac3                                     |   257 |
| flac                                    |   100 |
| opus                                    |    93 |
| dts · DTS-HD MA                         |    74 |
| eac3 · Dolby Digital Plus + Dolby Atmos |    63 |
| dts · DTS                               |    31 |
| truehd · Dolby TrueHD + Dolby Atmos     |    22 |
| truehd                                  |    22 |
| pcm (pcm_s24le)                         |     4 |
| dts · DTS-HD MA + DTS:X                 |     2 |
| dts                                     |     1 |

### Best passthrough-capable track per file

| value                                          | count |
| ---------------------------------------------- | ----: |
| no bitstreamable track -> best aac · LC        |   477 |
| eac3                                           |   315 |
| no bitstreamable track -> best aac · HE-AAC    |   269 |
| ac3                                            |   178 |
| no bitstreamable track -> best opus            |    92 |
| no bitstreamable track -> best flac            |    75 |
| dts · DTS-HD MA                                |    66 |
| eac3 · Dolby Digital Plus + Dolby Atmos        |    62 |
| truehd · Dolby TrueHD + Dolby Atmos            |    22 |
| truehd                                         |    21 |
| dts · DTS                                      |    11 |
| dts · DTS-HD MA + DTS:X                        |     2 |
| no bitstreamable track -> best pcm (pcm_s24le) |     1 |
| dts                                            |     1 |

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

### Audio sample rates (streams)

| value | count |
| ----- | ----: |
| 48000 |  2473 |
| 44100 |    59 |
| 22050 |     1 |

### Audio codec x layout (streams)

| value                                               | count |
| --------------------------------------------------- | ----: |
| eac3 @ 5.1(side)                                    |   457 |
| aac · HE-AAC @ stereo                               |   366 |
| aac · LC @ 5.1                                      |   337 |
| ac3 @ stereo                                        |   300 |
| aac · LC @ stereo                                   |   240 |
| ac3 @ 5.1(side)                                     |   173 |
| opus @ stereo                                       |   151 |
| flac @ stereo                                       |   134 |
| eac3 @ stereo                                       |    82 |
| eac3 · Dolby Digital Plus + Dolby Atmos @ 5.1(side) |    69 |
| dts · DTS-HD MA @ 5.1(side)                         |    68 |
| dts · DTS @ 5.1(side)                               |    35 |
| truehd · Dolby TrueHD + Dolby Atmos @ 7.1           |    23 |
| truehd @ 5.1(side)                                  |    22 |
| dts · DTS-HD MA @ 7.1                               |     9 |
| dts · DTS @ stereo                                  |     8 |
| aac · HE-AAC @ 5.1                                  |     8 |
| dts · DTS-HD MA @ stereo                            |     7 |
| flac @ 7.1                                          |     5 |
| flac @ 5.1(side)                                    |     4 |
| eac3 @ 7.1                                          |     4 |
| ac3 @ mono                                          |     4 |
| opus @ 5.1                                          |     3 |
| aac · LC @ 7.1                                      |     3 |
| pcm (pcm_s24le) @ 1                                 |     3 |
| flac @ mono                                         |     3 |
| dts · DTS-HD MA @ 3.0                               |     2 |
| dts · DTS-HD MA @ 6.1                               |     2 |
| dts · DTS-HD MA + DTS:X @ 7.1                       |     2 |
| dts @ 6                                             |     2 |
| aac · LC @ mono                                     |     1 |
| eac3 · Dolby Digital Plus + Dolby Atmos @ 5.1.2     |     1 |
| pcm (pcm_s24le) @ 8                                 |     1 |
| pcm (pcm_s24le) @ 2                                 |     1 |
| flac @ 5.0(side)                                    |     1 |
| flac @ quad                                         |     1 |
| ac3 @ 4.0                                           |     1 |

### Atmos mentioned in track title but not in ffprobe profile

| value           | count |
| --------------- | ----: |
| ac3             |     2 |
| dts · DTS-HD MA |     1 |

### Subtitle codecs (streams)

| value             | count |
| ----------------- | ----: |
| subrip            |  8096 |
| hdmv_pgs_subtitle |  2457 |
| ass               |  1398 |
| dvd_subtitle      |   380 |
| mov_text          |    45 |

### Subtitle codecs (files)

| value              | count |
| ------------------ | ----: |
| hdmv_pgs_subtitle  |   614 |
| subrip             |   526 |
| ass                |   329 |
| (no embedded subs) |   314 |
| dvd_subtitle       |    29 |
| mov_text           |     3 |

### External subtitles

| value                                         | count |
| --------------------------------------------- | ----: |
| video with stem-matched .srt sibling          |  1272 |
| no .srt in same dir                           |   286 |
| video whose dir has .srt but not stem-matched |    34 |

### External subtitle extensions (stem-matched)

| value | count |
| ----- | ----: |
| .srt  |  2865 |

### Odd cases (per file)

| value                  | count |
| ---------------------- | ----: |
| attached_pic           |   157 |
| av1                    |    62 |
| h264_hi10p             |    36 |
| vc1                    |    11 |
| mpegts/m2ts            |     4 |
| container:mpegts       |     4 |
| multiple_video_streams |     2 |
| data_streams           |     2 |
| extension_mismatch     |     1 |

### Primary video r_frame_rate

| value  | count |
| ------ | ----: |
| 23.976 |  1385 |
| 29.970 |    82 |
| 23.810 |    64 |
| 24.000 |    32 |
| 23.980 |    20 |
| 25.000 |     7 |
| 23.970 |     1 |
| 30.000 |     1 |
