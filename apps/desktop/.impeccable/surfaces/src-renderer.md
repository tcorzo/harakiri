---
version: 1
slug: "src-renderer"
primary_target: "src/renderer"
related_targets: []
---

# Library and playback handoff (harakiri desktop)

Scope: the whole renderer world, first proven on the library surface (hero, Continue Watching, rows, title page) and the play handoff. Onboarding and the mpv-drawn player controls inherit it. Visitor mode: Experience for the library; Operate for onboarding and player controls.
Audience and job: one owner on the couch, gamepad in hand, lamps down, choosing a film from their own collection in as few presses as possible and trusting what reaches the TV and receiver.
Constraints: d-pad plus select and back only; ten-foot legibility; overscan-safe; reduced motion respected; no busy or gamer-like devices; fidelity never reads as a codec spec sheet.
Memorable moment: the screening handoff into mpv.

## Direction contract

THESIS: The library is a festival programme for one. Every title is a programme entry whose technical facts read as screening notes. It refuses the streaming-service template of identical card rows under a logo-red chrome: its red is a programme's printed section colour and the fill of the one action that starts a film, never a frame around the catalogue.

OWN-WORLD: The film's own backdrop is the ground, dimmed under a deep programme-ink field that owns the lower two thirds. One condensed-to-wide grotesk family set like a catalogue: titles wide and heavy, programme notes as quiet badges with each format's own logo. Section tabs and Play share one committed festival colour, Harakiri Red (a dark arterial red on a warm near-black ink), the only accent; Play is the only red block that carries a line of type. Problems carry an amber mark, never red. Hairline rules from the catalogue grid.

STORY: The owner sees one film presented as tonight's screening, understands its programme notes at a glance (year, runtime, picture, sound), and either presses play or moves down to Continue Watching and the programme sections.

FIRST VIEWPORT: Full-bleed backdrop of the featured film, its logo or wide title lower-left at about a third of the width, quiet note badges beneath, Play as the focused primary action. The rest of the library waits out of sight below, signalled only by a small drifting arrow at the bottom edge. The hero advances slowly through featured films; focus re-lights the whole field.

FORM: Film festival programme catalogue, candidate 3 of 7 on the ordered list, seed key 1ac23202. Signature interaction: the screening handoff. The house dims, a programme slug states the signal path ("Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream"), then mpv takes the screen.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Festival colour and accent: resolved by the owner on 2026-11-17 as one Harakiri Red for bands and Play (DESIGN.md, Colors). Type family: Archivo Variable, chosen at build.
- How the mpv-drawn controls translate the world in ASS.
