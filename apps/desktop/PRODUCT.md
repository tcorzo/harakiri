# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Mostly one person: the owner of a curated personal film and series library, watching on a living-room TV from the couch, driving the app with a gamepad (d-pad, A/B) and sometimes a keyboard. Other household members are possible but rare; profile switching exists but stays out of the way. The owner cares about picture and sound fidelity and owns the gear to show it (a 4K HDR TV and an AV receiver for 7.1 / Atmos).

## Product Purpose

harakiri is a TV-first player for a Jellyfin library. It exists because Jellyfin's own clients quietly transcode files they claim they cannot play (Dolby Vision Profile 5 became H.264 with AAC, killing HDR and passthrough). harakiri plays the file as it is: mpv decodes everything, HDR reaches the TV, and compressed audio is bitstreamed to the receiver untouched. Success means the owner sits down, picks something within a few presses, and trusts that what reaches the TV and the receiver is what is in the file.

## Positioning

"A sort of Tidal" for a personal film library. A premium, theatrical library experience in which fidelity is visible and trusted rather than hidden: the app shows what the file is (Dolby Vision, HDR10, HDR10+, Atmos, TrueHD, DTS:X) and what is actually reaching the TV and receiver. Neither Jellyfin nor Kodi can truthfully claim never to transcode while showing the real signal path.

## Operating Context

- Ten-foot viewing: a TV across the room, overscan-prone, input by gamepad first. Every screen must be fully usable with a d-pad, select and back.
- First boot: find or enter the Jellyfin server, sign in, land in the library. After that, launching goes straight to the library.
- Playback happens in mpv's own fullscreen window (required for HDR). The player controls are drawn by mpv, not by the web UI, and must feel like the same product.
- The library is real: 164 films and 37 series, roughly 8% of files HDR or Dolby Vision, many with lossless or Atmos audio.

## Capabilities and Constraints

- Jellyfin server compatibility is the MVP. Content, artwork and watch state come from the server.
- Playback through mpv (gpu-next, Vulkan). Dolby Vision is delivered to the TV as HDR10 (the DV metadata is applied by the player). Native DV signalling over HDMI is out of scope.
- Audio passthrough for AC3, E-AC3 (incl. Atmos), TrueHD (incl. Atmos), DTS, DTS-HD MA and DTS:X. Formats that cannot be bitstreamed (AAC, Opus, FLAC) decode to PCM.
- Primary platform: Fedora Linux on Wayland (KDE). Windows and macOS later.
- Undecided: multi-server support, offline downloads, music.

## Brand Commitments

- The name is **harakiri**, used in the logo, window title and first-boot greeting.
- The name comes from Masaki Kobayashi's 1962 film. Its tone (restraint, gravity) may inform the voice; the film and any related imagery are never used as decoration.

## Evidence on Hand

- The local dev Jellyfin (`dev/jellyfin`) serves a library with posters, backdrops, logos and HDR/DV/Atmos files.
- The format census of the library: `docs/research/07-media-census.md`; the counts above come from it.
- No testimonials, users, press or benchmarks exist; none may be invented.

## Product Principles

1. Play the file as it is. Never transcode silently; if the server must, say so plainly.
2. Fidelity is visible. Format and signal facts appear where they help a decision, stated precisely, never as hype.
3. Three presses to playing. From launch to pressing play on something you want should take as few inputs as possible.
4. The couch is the desk. Every interaction works with a d-pad and two buttons, at ten feet.
5. The library is the hero. The owner's artwork and titles carry the experience; the interface recedes around them.

## Accessibility & Inclusion

Legible at ten feet: large type, strong focus indication that never relies on colour alone, overscan-safe layout, reduced-motion respected for the hero and transitions.
