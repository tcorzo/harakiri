---
name: harakiri
description: A TV-first, gamepad-first Jellyfin player whose library reads like a printed screening programme.
colors:
  ink: "oklch(0.15 0.024 262)"
  ink-raised: "oklch(0.2 0.03 262)"
  ink-line: "oklch(0.36 0.03 262)"
  house: "oklch(0.06 0.01 262)"
  shade: "oklch(0.08 0.02 262 / 0.6)"
  paper: "oklch(0.955 0.01 85)"
  paper-dim: "oklch(0.8 0.018 255)"
  paper-faint: "oklch(0.66 0.022 258)"
  band: "oklch(0.47 0.2 266)"
  play: "oklch(0.85 0.16 80)"
  play-ink: "oklch(0.2 0.04 262)"
  alert: "oklch(0.8 0.12 45)"
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
    backgroundColor: "{colors.band}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0.375rem 1rem"
  margin-band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.paper}"
    width: "3.5rem"
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

Every screen is set like a page of a printed programme seen from the couch. The owner's own artwork is the ground: backdrops run full bleed and a deep blue-black ink field rises over the lower part of the frame to carry the type. On that ink, one variable grotesk family does all the work by changing width: titles go wide and heavy, technical notes go condensed with tabular figures, and catalogue numbers sit in a left margin above a vertical blue section band. Nothing is rounded, nothing floats on a card, and the only warm object on screen is the action that starts the film.

The system is built for ten feet and a d-pad. The root size tracks the screen height (1rem is 100vh / 67.5, so 16px at 1080p and 32px at 4K), every layout sits inside a 5% overscan-safe frame, and every focusable thing shows focus by two cues at once. Motion is slow and theatrical (long eased re-lights, a dimming house before playback) and disappears entirely under reduced motion.

Density is low and deliberate. A screen carries one title, one line of programme notes, a few actions, and the top of the next row. Technical facts are stated plainly with their real signal state, never dressed as badges.

**Key Characteristics:**

- Artwork as the ground, a blue-black ink field as the reading surface.
- One variable family, hierarchy carried by width (62 to 125 axis) as much as weight.
- Square geometry throughout; hairline rules instead of containers.
- A single saffron accent, reserved for Play and Resume.
- A committed blue for section bands and the left-margin band, nothing else.
- Focus is a paper outline plus scale, or a full paper inversion, never colour alone.
- Catalogue numbers ("No. 074") give every film and series a stable identity.

## Colors

A cold blue-black night palette with warm paper type, one section blue for structure, and one saffron light for starting a film.

### Primary

- **Saffron Play** (play): fills Play and Resume and nothing else. It is the only saturated warm surface in the product, so the eye finds it from across the room.
- **Play Ink** (play-ink): the dark type and glyph set on Saffron Play.

### Secondary

- **Section Blue** (band): section bands on rows and sheets, the vertical band in the left margin, the welcome screen's full-height band, and text selection. It marks structure (which section you are in), never an action.

### Tertiary

- **Ember** (alert): a small solid square set before a problem sentence (unreachable server, wrong password, a server that must transcode). Always paired with words; never a fill or a text colour.

### Neutral

- **Programme Ink** (ink): the page. Body background, the ink field over artwork, and focused text on paper inversions.
- **Raised Ink** (ink-raised): image placeholders before artwork loads, on-screen keyboard keys, and the side sheet for track choice.
- **Ink Rule** (ink-line): the unfilled part of progress rules and handoff station bars.
- **House Dark** (house): the near-black ground of the screening handoff, darker than the page, as the lights go down.
- **Shade** (shade): a translucent dark used only inside soft shadows, under logos and behind the side sheet.
- **Paper** (paper): primary type, the focus outline, the filled part of progress, and the background of focused quiet and list actions.
- **Dim Paper** (paper-dim): secondary type: notes labels, overviews, server names, signal-state words, the catalogue "No." prefix.
- **Faint Paper** (paper-faint): the middle-dot separators in programme notes, the curtain wordmark, hint lines, and the input underline at rest.
- **Hairline**: Paper mixed to 22% over transparent, used for every rule and frame (row rules, quiet action frames, list dividers).

### Named Rules

**The One Light Rule.** Saffron Play appears only on Play and Resume. No other control, badge, highlight or illustration may use it, so pressing the warm thing always starts the film.

**The Band Is Structure Rule.** Section Blue labels sections and holds the margin band. It never fills a button, a focus state or a fact.

**The Paper On Ink Rule.** Type is paper on ink at three strengths (paper, dim, faint). Hue is never used to rank text.

## Typography

**Display Font:** Archivo Variable, self-hosted (with Archivo, sans-serif)
**Body Font:** Archivo Variable
**Label Font:** Archivo Variable, condensed

**Character:** One grotesk family stretched across its full width axis, as a programme catalogue sets titles wide and notes narrow. Figures are tabular everywhere so years, runtimes and catalogue numbers line up.

### Hierarchy

- **Marquee** (820, 5.5rem, 0.94, width 125%): a film's name when it has no logo, empty-state headlines, the title on the handoff screen.
- **Title** (800 to 820, 4rem, 0.98, width 125%): page titles and the compact title when the hero yields to rows. The same size at weight 300 and width 72% sets the large catalogue number in the margin, and at 460 condensed sets the handoff signal slug.
- **Heading** (700 to 820, 2.25rem, 1.1, width 118 to 125%): the wordmark, Play, list choices, handoff sub-lines.
- **Notes** (540, 1.625rem, 1.25, width 72%): the programme note line (year, runtime, picture, sound) and list details.
- **Body** (420 default, 560 to 680 on card names, 1.5rem, 1.45): overviews (max 60ch, two lines in the hero), quiet actions, card titles at width 86%.
- **Caption** (560 to 620, 1.5rem, 1.3, width 72%): catalogue labels under cards, title counts, minutes left, server name.
- **Label** (620, 1.5rem or 1.375rem, letter-spacing 0.06 to 0.12em, uppercase, width 72 to 86%): the word beside a signal-state mark, handoff station names, credit terms ("Directed", "With"), and field labels. A label always names the value beside or below it.

### Named Rules

**The Width Carries Rank Rule.** Wide means a name, condensed means a fact. Titles and section names set wide (118 to 125%); notes, numbers and captions set condensed (72%); running copy sits at 86 to 100%.

**The Tabular Rule.** Figures are tabular across the whole product, set on the body. Do not switch to proportional figures for display.

**The Catalogue Number Rule.** Every film and series carries a number in accession order (date added, then sort name), written "No." plus three digits ("No. 074"). An episode carries its series' number. The number never changes when the library is re-sorted, and holds while the library only grows; removing a title renumbers those added after it.

## Layout

The root size is 100vh / 67.5, so every rem scales with the screen height and a 4K TV gets exactly double the 1080p layout. All content sits inside an overscan-safe frame of 5vw horizontally and 5vh vertically; only artwork and the ink field run to the edge.

The recurring structure is a left margin column (7.5rem) holding the catalogue number, the seen tick and a 3.5rem vertical Section Blue band with the section name set rotated, reading upward. Content sits to the right of the margin with a 2.5rem gutter, its block capped near 46vw on the library hero. The film logo is capped at a third of the screen width.

The library is a stage plus programme rows. The hero block rests above the peeking top of the first row so more is always visible below. When focus moves into the rows the block lifts and compacts, the ink field deepens, and the rows scroll vertically one section at a time. Rows already passed fade out; rows waiting below dim their pictures to half opacity while their type keeps full contrast. Cards in a row are spaced 2rem apart and the row leaves 1.5rem of lead so the first card's ring and scale never clip.

Lists (settings, track choice) are full-width lines divided by hairlines, not grids of tiles. Settings facts use a two-column definition grid (12rem terms).

## Elevation & Depth

The system is flat. Depth comes from the artwork sitting behind a graded ink field, not from raised surfaces. Surfaces do not cast shadows at rest; a soft dark shadow appears in exactly two places, to keep a film logo legible over a bright backdrop and to separate the side sheet from the page.

The hero ink field has two states. With the hero focused it is lighter, so the artwork reads on a TV: solid ink up to 40% of the height, 88% ink at 50%, 45% at 60%, and clear by 68%, plus a left-side wash and a thin top wash for the wordmark. With the rows focused it deepens: solid to 35%, then 85%, 45% and 15% ink reaching the top edge. The lighter state is a deliberate adaptation to the principle that the library is the hero (PRODUCT principle 5): the owner's artwork must carry the first view.

### Shadow Vocabulary

- **Logo lift** (`drop-shadow(0 0.25rem 1.5rem var(--color-shade))`): under film logos only.
- **Sheet edge** (`box-shadow: -1.5rem 0 4rem var(--color-shade)`): the left edge of the track side sheet only.

### Named Rules

**The Ink Field Rule.** Type over artwork always sits on the graded ink field. Never place type on a raw backdrop, and never use a hard stop: the ramp is eased so bright skies fade into ink without a horizon line.

## Shapes

Every corner is square (radius 0): buttons, cards, images, bands, sheets and progress rules. Form comes from rules and fills, not containers. Hairlines are 2px-equivalent (border width 2) in Paper at 22%; progress and station rules are 0.1875rem to 0.375rem solid bars. Marks are small geometric SVG: a half-filled square, an outline square, a hand-drawn pen tick, a solid play triangle, and the solid Ember square before a problem sentence.

## Components

### Buttons

Three actions and no more. Square, 4.5rem tall, all sharing the focus mark.

- **Play:** Saffron Play fill, Play Ink type at heading size weight 780, width 118%, with a solid triangle glyph at 0.8em. Used for Play and Resume only.
- **Quiet:** transparent with a hairline frame (2), paper type at body size weight 560, width 86%. On focus it inverts to a paper fill with ink type and gains the ring and scale. Disabled drops to 40% opacity.
- **List:** a full-width line with a hairline under it, the choice at heading size weight 700 wide, an optional condensed dim detail beside it. On focus the whole line inverts to paper with ink type and does not scale.
- **Focus:** a 0.1875rem paper outline offset by 0.375rem of ink, plus scale to 1.06, over 260ms on the curtain ease. Because the TV has no pointer, focus styling follows every focus, not only keyboard-visible focus.

### Cards

- **Poster** (13.5rem, 2:3): the picture, then a caption row with the catalogue label and the seen tick, then the title truncated at body size.
- **Still** (24rem, 16:9): the picture with a paper progress rule along its bottom edge on a 70% ink track, then a caption row (catalogue label, episode code, minutes left), then the name.
- **Corner Style:** square. **Background:** Raised Ink placeholder until the artwork loads. **Border:** none. Focus puts the ring and scale on the picture only.

### Inputs / Fields

- **Style:** no box. A condensed uppercase label above, then the value at title size on a bare underline in Faint Paper.
- **Focus:** the underline turns paper and the field fills with Raised Ink, two cues together. The on-screen keyboard sits beneath, with Raised Ink keys; the submit key adds a hairline frame and goes wide and heavy.
- **Error:** an Ember square before a plain sentence saying what went wrong and what to do.

### Navigation

The wordmark "harakiri" (heading, 820, width 125%) sits top left with the server name in dim caption beside it; Settings is a quiet text link top right, in full Paper so it holds over a bright sky, that inverts to paper on focus. Back is the gamepad B button; there is no on-screen back control.

### Programme Notes (signature)

One condensed line with tabular figures: year, runtime, picture, sound, separated by faint middle dots. A native fact (it passes as it is) is stated bare, so a plain title reads as notes rather than a spec sheet. Only a fact harakiri changes carries a mark and its word in a dim uppercase label: a half-filled square for mapped, an outline square for decoded. Shape and word carry the state; colour never does.

### Margin and Section Band (signature)

The left margin reads top to bottom: "No." in dim body condensed beside the number at title size weight 300 condensed, then the seen tick with the word "Seen", then the vertical Section Blue band with the section name. Rows repeat the band horizontally as a filled label, followed by a hairline and a title count at the far right.

### Hero Stage

The featured film holds the stage with Play focused. It advances to the next featured film only after 20 seconds with no input at all, restarting the wait on any press; a press within 800ms of a change is ignored. Under reduced motion it never advances on its own. An "Up next" preview at the right shows the next film with a paper rule filling over the hold. Backdrops cross-fade with a 900ms re-light (from 55% brightness) rather than cutting to black.

### Screening Handoff (signature)

Before playback hands off to the player, the screen moves through three stations in fixed order: House, Programme, Picture. The ground is House Dark; the backdrop dims on the house ease over 1.2s while the main process asks the server how it will send the file. The programme slug then states the server's own signal path at title size condensed, held 3s so it can be read from the couch; then the picture takes over. A native leg is stated bare ("TrueHD Atmos bitstream"); a mapped or decoded leg already says so in words and adds its mark. When the server transcodes, the slug reads "Server transcode" with an Ember sentence giving its reasons in plain words; when the server could not read the file, an Ember sentence says so instead. The catalogue number before the title never wraps. Station names sit above 9rem bars that fill paper as each is reached. After an episode plays to its end, the same screen offers the next one: "Next" beside its code and title, with Play focused.

## Do's and Don'ts

### Do:

- **Do** size everything in rem so it scales with screen height (1rem is 100vh / 67.5), and keep content inside the 5vw by 5vh safe frame.
- **Do** show focus with two cues: the paper outline with scale, or a full paper inversion. Never only a colour change.
- **Do** set names wide (118 to 125%) and facts condensed (72%) with tabular figures.
- **Do** give every film and series its catalogue number, "No." plus three digits, in accession order.
- **Do** mark signal state by shape plus word only where harakiri changes the signal: half square mapped, outline square decoded. Leave native facts bare.
- **Do** put type over artwork only on the eased ink field.
- **Do** dim only the pictures of inactive rows; keep their type at full contrast.
- **Do** keep the handoff stations in order: House, then Programme, then Picture.
- **Do** respect reduced motion: no auto-advancing hero, no transitions.

### Don't:

- **Don't** use Saffron Play for anything but Play and Resume.
- **Don't** use Section Blue on actions or focus; it marks sections only.
- **Don't** round corners or put titles on floating cards.
- **Don't** use colour alone to carry focus, state or errors.
- **Don't** advance the hero while the owner is pressing, or at all under reduced motion.
- **Don't** add shadows beyond the logo lift and the sheet edge.
- **Don't** set an uppercase tracked label above a heading as decoration; labels only name the value beside or below them.
- **Don't** use the film the product is named after, or its imagery, as decoration.
