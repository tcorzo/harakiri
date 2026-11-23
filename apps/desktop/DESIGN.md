---
name: harakiri
description: A TV-first, gamepad-first Jellyfin player whose library reads like a printed screening programme.
colors:
  ink: "oklch(0.13 0.008 40)"
  ink-raised: "oklch(0.18 0.011 40)"
  ink-line: "oklch(0.34 0.012 40)"
  house: "oklch(0.06 0.006 40)"
  shade: "oklch(0.06 0.007 40 / 0.6)"
  paper: "oklch(0.955 0.01 85)"
  paper-dim: "oklch(0.8 0.016 70)"
  paper-faint: "oklch(0.66 0.02 65)"
  band: "oklch(0.44 0.17 25)"
  play: "oklch(0.44 0.17 25)"
  play-ink: "oklch(0.955 0.01 85)"
  alert: "oklch(0.84 0.15 85)"
typography:
  marquee:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "5.5rem"
    fontWeight: 820
    lineHeight: 0.94
    fontVariation: "'wdth' 125"
  title:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "4rem"
    fontWeight: 800
    lineHeight: 0.98
    fontVariation: "'wdth' 125"
  heading:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 780
    lineHeight: 1.1
    fontVariation: "'wdth' 118"
  notes:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 540
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 72"
  badge:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 560
    lineHeight: 1.3
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 72"
  body:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 420
    lineHeight: 1.45
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 100"
  caption:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 72"
  label:
    fontFamily: "Archivo Variable, Archivo, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 620
    lineHeight: 1.3
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 72"
rounded:
  none: "0"
spacing:
  safe-x: "5vw"
  safe-y: "5vh"
  margin: "7.5rem"
  gutter: "2.5rem"
  row-gap: "2rem"
components:
  button-play:
    backgroundColor: "{colors.play}"
    textColor: "{colors.play-ink}"
    typography: "{typography.heading}"
    rounded: "{rounded.none}"
    padding: "0 2rem"
    height: "4.5rem"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 1.75rem"
    height: "4.5rem"
  button-quiet-focus:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  list-action:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    typography: "{typography.heading}"
    rounded: "{rounded.none}"
    padding: "1rem"
    height: "4.5rem"
  list-action-focus:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  section-band:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0"
  margin-band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.paper}"
    width: "3.5rem"
    height: "10rem"
  poster-card:
    backgroundColor: "{colors.ink-raised}"
    rounded: "{rounded.none}"
    width: "13.5rem"
  still-card:
    backgroundColor: "{colors.ink-raised}"
    rounded: "{rounded.none}"
    width: "24rem"
  side-sheet:
    backgroundColor: "{colors.ink-raised}"
    width: "46rem"
---

# Design System: harakiri

## Overview

**Creative North Star: "The Screening Programme"**

Every screen is set like a page of a printed programme seen from the couch. The owner's own artwork is the ground: backdrops run full bleed and a deep warm near-black ink field rises over the lower part of the frame to carry the type. On that ink, one variable grotesk family does all the work by changing width: titles go wide and heavy, technical notes go condensed with tabular figures, and quiet badges, with each format's own logo, carry the facts under a title. Nothing is rounded, nothing floats on a card, and one red does all the colour work: it marks the section you are in and it fills the action that starts the film. Play is the only red block that carries a line of type.

The system is built for ten feet and a d-pad. The root size tracks the screen height (1rem is 100vh / 67.5, so 16px at 1080p and 32px at 4K), every layout sits inside a 5% overscan-safe frame, and every focusable thing shows focus by two cues at once. Motion is slow and theatrical (long eased re-lights, a dimming house before playback) and disappears entirely under reduced motion.

Density is low and deliberate. A screen carries one title, a row of quiet note badges, a few actions, and on the library's first view nothing else but a small arrow to the rows below. Technical facts carry their real signal state and sit low in the hierarchy: the film is the content.

**Key Characteristics:**

- Artwork as the ground, a warm near-black ink field as the reading surface.
- One variable family, hierarchy carried by width (62 to 125 axis) as much as weight.
- Square geometry throughout; hairline rules instead of containers.
- One accent, Harakiri Red, a dark arterial red: it fills Play and Resume and marks sections with short tabs. Play is the only red block that carries horizontal type.
- Problems carry a small Torch Amber square and words, never red, so an error is never read as the brand.
- Focus is a paper outline plus scale, or a full paper inversion, never colour alone.

## Colors

A warm near-black night palette with warm paper type and one dark arterial red that does all the colour work: it marks structure and it starts the film. Everything else is paper on ink. The ink family shares one warm hue (40), and the dim papers lean the same way, so nothing on screen reads cold.

### Primary

- **Harakiri Red** (band): the one accent, a dark arterial red. The section tab on Settings and onboarding, the short tab before each row and sheet head, the Welcome screen's full-height band, the underline of the selected season, and text selection. Paper on it holds 7.4:1, and it stands 2.4:1 off the ink. It is the only saturated surface in the product.
- **Play Red** (play): Harakiri Red under the name the Play button reads. The token is defined as the band's red, so the two can never drift. It fills Play and Resume, and the player's state tile in the mpv overlay, Play in miniature with a paper glyph and an ink keyline. Play is the only red block that carries a line of type, so the eye finds it from across the room.
- **Play Paper** (play-ink): the paper type and glyph set on Play Red; the token is Paper.

### Tertiary

- **Torch Amber** (alert): a solid square the height of a capital, set before a problem sentence (unreachable server, wrong password, a failed start, a server that must transcode, a downgrade in the player), like an usher's torch in a dark house. Always paired with words; never a fill or a text colour. It sits 60 degrees of hue and 0.4 of lightness away from Harakiri Red, so a problem never reads as the brand. It is nearly the retired Saffron Play (oklch(0.85 0.16 80)); it comes back only as this mark, never as a fill.

### Neutral

- **Programme Ink** (ink): the page. Body background, the ink field over artwork, and focused text on paper inversions.
- **Raised Ink** (ink-raised): image placeholders before artwork loads, on-screen keyboard keys, and the side sheet for track choice.
- **Ink Rule** (ink-line): the unfilled part of progress rules, the hero hold rule and handoff station bars.
- **House Dark** (house): the near-black ground of the screening handoff, darker than the page, as the lights go down. At this lightness sRGB holds it at #010100: the warm hue is a hair off black, no more, which is the point.
- **Shade** (shade): a translucent dark used only inside soft shadows, under logos and behind the side sheet.
- **Paper** (paper): primary type, the focus outline, the filled part of progress, and the background of focused quiet and list actions.
- **Dim Paper** (paper-dim): secondary type: notes labels, overviews, server names, signal-state words.
- **Faint Paper** (paper-faint): the curtain wordmark, hint lines, and the input underline at rest.
- **Hairline**: Paper mixed to 22% over transparent, used for every rule and frame (row rules, quiet action frames, list dividers).

### Named Rules

**The One Red Rule.** Harakiri Red is the only saturated surface in the product; Torch Amber appears only as a small problem mark. The red has two jobs. It names where you are: the section tab on Settings and onboarding, the short tab before each row and sheet head, the Welcome band, the selected season's underline, and text selection. It starts the film: the Play and Resume fill, and the player's state tile, Play in miniature. No other control, badge, focus state, fact or illustration may use it.

**The Red Names Or Starts Rule.** Only Play and Resume are red blocks that carry a line of type, so a red block with words on it always starts the film. Section names sit in paper on ink beside a red tab, or run upward in the margin's tab. Tabs, bands and the season underline are never focusable, and the underline says which season is showing, not where focus is. The player's state tile shows whether the film that started is playing or paused; it is not a control. Focus on red is the paper ring and scale, never a change of red.

**The Problem Is Never Red Rule.** Every problem leads with the Torch Amber square, the height of a capital, and states itself in plain words at weight 560. That covers a section that did not load, a wrong password, an unreachable server, a failed start, a server transcode, and a downgrade in the player. Red stays the brand's, so a band never reads as an alarm and an alarm never reads as a band.

**The Paper On Ink Rule.** Type is paper on ink at three strengths (paper, dim, faint). Hue is never used to rank text.

## Typography

**Display Font:** Archivo Variable, self-hosted (with Archivo, sans-serif)
**Body Font:** Archivo Variable
**Label Font:** Archivo Variable, condensed

**Character:** One grotesk family stretched across its full width axis, as a programme catalogue sets titles wide and notes narrow. Figures are tabular everywhere so years, runtimes and minutes left line up.

### Hierarchy

- **Marquee** (820, 5.5rem, 0.94, width 125%): a film's name when it has no logo, empty-state headlines, the title on the handoff screen.
- **Title** (800 to 820, 4rem, 0.98, width 125%): page titles and the compact title when the hero yields to rows. The same size at 460 condensed sets the handoff signal slug.
- **Heading** (700 to 820, 2.25rem, 1.1, width 118 to 125%): the wordmark, Play, list choices, handoff sub-lines.
- **Notes** (540, 1.625rem, 1.25, width 72%): list details and the handoff's programme lines.
- **Badge** (560, 1.25rem, 1.3, width 72%): the note badges under a title (year, runtime, picture, sound, seen).
- **Body** (420 default, 560 to 680 on card names and problem sentences, 1.5rem, 1.45): overviews (max 60ch, two lines in the hero), quiet actions, card titles at width 86%, section heads (760, width 118%).
- **Caption** (560 to 620, 1.5rem, 1.3, width 72%): episode codes under stills, title counts, minutes left, server name.
- **Label** (620, 1.5rem or 1.375rem, letter-spacing 0.06 to 0.12em, uppercase, width 72 to 86%): the word beside a signal-state mark, handoff station names, credit terms ("Directed", "With"), and field labels. A label always names the value beside or below it.

### Named Rules

**The Width Carries Rank Rule.** Wide means a name, condensed means a fact. Titles and section names set wide (118 to 125%); notes, numbers and captions set condensed (72%); running copy sits at 86 to 100%.

**The Tabular Rule.** Figures are tabular across the whole product, set on the body. Do not switch to proportional figures for display.

## Layout

The root size is 100vh / 67.5, so every rem scales with the screen height and a 4K TV gets exactly double the 1080p layout. All content sits inside an overscan-safe frame of 5vw horizontally and 5vh vertically; only artwork and the ink field run to the edge.

The library hero, the film page and the series page have no margin column: content sits on the left safe edge, its block capped near 46vw on the library hero. The film logo is capped at a third of the screen width. Settings and onboarding keep a left margin column (7.5rem) with a 3.5rem Harakiri Red section tab, the section name set rotated and reading upward; the tab is as tall as its name and at least 10rem, and only Welcome runs the band the full height of the screen.

The library is a stage plus programme rows. On arrival the hero holds the whole screen: the rows wait out of sight below, and a single thin arrow centred at the bottom edge, drifting slowly, says there is more. The hero block rests low, its hold rule just under the actions. When focus moves into the rows the block lifts and compacts, the ink field deepens, and the rows scroll vertically one section at a time. Rows already passed fade out; rows waiting below dim their pictures to half opacity while their type keeps full contrast. Cards in a row are spaced 2rem apart and the row leaves 1.5rem of lead so the first card's ring and scale never clip.

Lists (settings, track choice) are full-width lines divided by hairlines, not grids of tiles. Settings facts use a two-column definition grid (12rem terms).

## Elevation & Depth

The system is flat. Depth comes from the artwork sitting behind a graded ink field, not from raised surfaces. Surfaces do not cast shadows at rest; a soft dark shadow appears in exactly two places, to keep a film logo legible over a bright backdrop and to separate the side sheet from the page.

The hero ink field has two states. With the hero holding the stage it is light and low, so the artwork carries the first view: solid ink only to 14% of the height, 78% at 26%, 38% at 38%, and clear by 50%, plus a left-side wash (60% fading out by 48% of the width) that backs the type and a thin top wash (60%, clear by 14%) for the wordmark. With the rows focused it deepens: solid to 35%, then 85%, 45% and 15% ink reaching the top edge. The light state is a deliberate adaptation to the principle that the library is the hero (PRODUCT principle 5).

### Shadow Vocabulary

- **Logo lift** (`drop-shadow(0 0.25rem 1.5rem var(--color-shade))`): under film logos only.
- **Sheet edge** (`box-shadow: -1.5rem 0 4rem var(--color-shade)`): the left edge of the track side sheet only.

### Named Rules

**The Ink Field Rule.** Type over artwork always sits on the graded ink field. Never place type on a raw backdrop, and never use a hard stop: the ramp is eased so bright skies fade into ink without a horizon line.

## Shapes

Every corner is square (radius 0): buttons, cards, images, bands, sheets and progress rules. Form comes from rules and fills, not containers. Hairlines are 2px-equivalent (border width 2) in Paper at 22%; progress and station rules are 0.1875rem to 0.375rem solid bars. Marks are small geometric SVG: a half-filled square, an outline square, a hand-drawn pen tick, a solid play triangle, a cog with square teeth for Settings, and the solid Torch Amber square before a problem sentence.

## Components

### Buttons

Three actions and no more. Square, 4.5rem tall, all sharing the focus mark.

- **Play:** Harakiri Red fill, paper type at heading size weight 780, width 118%, with a solid triangle glyph at 0.8em. Used for Play and Resume only.
- **Quiet:** transparent with a hairline frame (2), paper type at body size weight 560, width 86%. On focus it inverts to a paper fill with ink type and gains the ring and scale. Disabled drops to 40% opacity.
- **List:** a full-width line with a hairline under it, the choice at heading size weight 700 wide, an optional condensed dim detail beside it. On focus the whole line inverts to paper with ink type and does not scale.
- **Focus:** a 0.1875rem paper outline offset by 0.375rem of ink, plus scale to 1.06, over 260ms on the curtain ease. Because the TV has no pointer, focus styling follows every focus, not only keyboard-visible focus.

### Cards

- **Poster** (13.5rem, 2:3): the picture, then the title truncated at body size with the seen tick after it.
- **Still** (24rem, 16:9): the picture with a paper progress rule along its bottom edge on a 70% ink track, then a caption row (episode code, minutes left), then the name.
- **Corner Style:** square. **Background:** Raised Ink placeholder until the artwork loads. **Border:** none. Focus puts the ring and scale on the picture only.

### Inputs / Fields

- **Style:** no box. A condensed uppercase label above, then the value at title size on a bare underline in Faint Paper.
- **Focus:** the underline turns paper and the field fills with Raised Ink, two cues together. The on-screen keyboard sits beneath, with Raised Ink keys; the submit key adds a hairline frame and goes wide and heavy.
- **Error:** a Torch Amber square before a plain sentence saying what went wrong and what to do.

### Navigation

The wordmark "harakiri" (heading, 820, width 125%) sits top left with the server name in dim caption beside it; Settings is a cog mark with square teeth (2.25rem in a 3.5rem square, named "Settings" for assistive tech) top right, in full Paper so it holds over a bright sky; on focus the square inverts to paper with an ink cog and takes the ring and scale. Back is the gamepad B button; there is no on-screen back control.

### Note Badges (signature)

A row of quiet badges under the title: year, runtime, picture, sound, and a pen tick when the title is seen. Each badge is Raised Ink at 55% over the field, square, with Dim Paper type at the badge size (560, 1.25rem, width 72%). Picture and sound formats are drawn as their own logos, painted in the text colour from a luminance mask so they stay paper on ink: Dolby Vision, HDR10, HDR10+, Dolby Atmos, Dolby TrueHD, Dolby Digital Plus, Dolby Digital and DTS (DTS-HD names its tier in words beside the DTS logo, since its stacked logo cannot be read this small). Formats with no logo (DTS:X, HLG, SDR, PCM, FLAC, Opus, AAC), resolutions and channel counts stay words. A fact harakiri changes leads with its mark in a cell set off by a hairline: a half-filled square for mapped, an outline square for decoded; the word is kept for assistive tech and as a tooltip. Every badge carries the whole fact in words for assistive tech. The badges sit low in the hierarchy on purpose: the film is the content, its quality is a footnote.

### Section Tabs

Rows and the track sheet head each section with paper type led by a short red tab (0.5rem by 1.5em), followed by a hairline and a title count at the far right. Settings and onboarding keep the margin's rotated section tab.

### Hero Stage

The featured film holds the stage with Play focused. It advances to the next featured film only after 20 seconds with no input at all, restarting the wait on any press; a press within 800ms of a change is ignored. Under reduced motion it never advances on its own. The hold is shown by one rule and nothing else: a 0.1875rem paper fill on an Ink Rule track, running the full safe width under the hero's actions, restarting on any press. There is no preview of the next film. The quiet action beside Play reads "Details" and opens the title page. Backdrops cross-fade with a 900ms re-light (from 55% brightness) rather than cutting to black.

### Screening Handoff (signature)

Before playback hands off to the player, the screen moves through three stations in fixed order: House, Programme, Picture. The ground is House Dark; the backdrop dims on the house ease over 1.2s while the main process asks the server how it will send the file. The programme slug then states the server's own signal path at title size condensed, held 3s so it can be read from the couch; then the picture takes over. A native leg is stated bare ("TrueHD Atmos bitstream"); a mapped or decoded leg already says so in words and adds its mark. When the server transcodes, the slug reads "Server transcode" with a sentence led by the Torch Amber square giving its reasons in plain words; when the server could not read the file, a sentence led by the Torch Amber square says so instead. A start that fails says so the same way. Station names sit above 9rem bars that fill paper as each is reached. After an episode plays to its end, the same screen offers the next one: "Next" beside its code and title, with Play focused.

## Do's and Don'ts

### Do:

- **Do** size everything in rem so it scales with screen height (1rem is 100vh / 67.5), and keep content inside the 5vw by 5vh safe frame.
- **Do** show focus with two cues: the paper outline with scale, or a full paper inversion. Never only a colour change.
- **Do** set names wide (118 to 125%) and facts condensed (72%) with tabular figures.
- **Do** mark signal state by shape only where harakiri changes the signal (half square mapped, outline square decoded), with the word kept for assistive tech and as a tooltip. Native facts carry no mark.
- **Do** keep the note badges quiet (55% Raised Ink, Dim Paper, badge size): the film is the content.
- **Do** put type over artwork only on the eased ink field.
- **Do** dim only the pictures of inactive rows; keep their type at full contrast.
- **Do** keep the handoff stations in order: House, then Programme, then Picture.
- **Do** respect reduced motion: no auto-advancing hero, no transitions.

### Don't:

- **Don't** use Harakiri Red for anything but the section tab on Settings and onboarding, the tab before row and sheet heads, the Welcome band, the selected season's underline, text selection, the Play and Resume fill, and the player's state tile.
- **Don't** set a line of type on a red block other than Play and Resume, make a tab or band focusable, or show focus by changing the red; focus on red is the paper ring and scale.
- **Don't** run the margin band the full height of the screen; it is a tab as tall as its section name. Only Welcome runs it full height.
- **Don't** round corners or put titles on floating cards.
- **Don't** use colour alone to carry focus, state or errors.
- **Don't** use red for errors or warnings; problems carry the Torch Amber square and words.
- **Don't** advance the hero while the owner is pressing, or at all under reduced motion.
- **Don't** add shadows beyond the logo lift and the sheet edge.
- **Don't** set an uppercase tracked label above a heading as decoration; labels only name the value beside or below them.
- **Don't** use the film the product is named after, or its imagery, as decoration.
- **Don't** turn the red into blood imagery: no drips, splatter or wounds. It is a colour, not a motif.
