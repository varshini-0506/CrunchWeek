---
name: CrunchWeek
colors:
  lagoon-ink: "#0e1a1d"
  lagoon-night: "#091114"
  lagoon-surface: "#0f1a1d"
  lagoon-raised: "#24363b"
  bone: "#efe9dc"
  bone-surface: "#f8f4ea"
  bone-text: "#ece5d3"
  vermilion: "#cc3a16"
  vermilion-bright: "#ff6a3d"
  brass: "#74500a"
  brass-bright: "#e8b54d"
  jade: "#146547"
  jade-bright: "#5fd3a8"
  dusk: "#6a4ea3"
  dusk-bright: "#a98bea"
  lake: "#23788a"
  lake-bright: "#6cc7d1"
  clash-red: "#c42d2d"
typography:
  hero:
    fontFamily: Inter Tight
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.025em
  hero-sm:
    fontFamily: Inter Tight
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.1
  display:
    fontFamily: Inter Tight
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.025em
  title:
    fontFamily: Inter Tight
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.25
  display-sm:
    fontFamily: Inter Tight
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.15
  figure:
    fontFamily: Inter Tight
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: Inter Tight
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.47
  body-sm:
    fontFamily: Inter Tight
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Inter Tight
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Inter Tight
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
  code:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
rounded:
  tag: 2px
  segment-inner: 7px
  block: 8px
  segment: 9px
  input: 10px
  list: 12px
  card: 16px
  pill: 9999px
spacing:
  gutter: 20px
  card-padding: 24px
  section: 28px
components:
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  button-secondary:
    backgroundColor: "rgba(14, 26, 29, 0.08)"
    textColor: "{colors.lagoon-ink}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  card:
    backgroundColor: "{colors.bone-surface}"
    rounded: "{rounded.card}"
    padding: 24px
---

# Design System: CrunchWeek

## Overview

"Lagoon & Vermilion", named for Chilika lake. A calm, precise scheduling tool for a busy week: night-water ink, old-timetable bone paper, and one vermilion that only ever means "act here" or "clash caught". This is an Operate surface: familiar controls, dense tables where they help, brand in the details. The landing page (login) is the one Persuade surface and leads with the live Week 7 venue board.

## Colors

Light-mode vermilion, brass, jade and the tertiary text were darkened in the Impeccable pass so every text pairing meets WCAG AA (4.5:1); the dark-mode values are unchanged except tertiary text (`#838e8a`).

### Primary
- **Vermilion** (`#cc3a16` light, `#ff6a3d` dark): primary buttons, the current nav item, selection, the one thing to do next. Never decoration.

### Secondary
- **Brass** (`#74500a` / `#e8b54d`): heads-up, labs, midsems, "moved".
- **Jade** (`#146547` / `#5fd3a8`): all clear, confirmed.
- **Dusk** (`#6a4ea3` / `#a98bea`): Spectra and institute events.
- **Lake** (`#23788a` / `#6cc7d1`): tutorials, club and department events, "awaiting".

### Neutral
- **Lagoon ink** text and dark surfaces, **bone** paper and light surfaces, with `--label-2` / `--label-3` for secondary and tertiary text, tinted from the ink rather than pure grey.

### Named Rules
- **One action colour.** Only vermilion asks the user to do something.
- **Status colours carry meaning only.** Jade, brass, dusk and lake appear where the status or kind is true, never as decoration.

## Typography

Inter Tight for everything, JetBrains Mono only for code and file names. Fixed scale with small steps: 12 / 13 / 14 / 15 / 17 / 20 / 28 / 32 for the app, 34 / 40 only for the landing headline. Tabular numerals wherever something is counted or timed.

### Named Rules
- **No eyebrows.** No small label above a heading. The heading states the answer; facts like the date go below the standfirst as `meta`; descriptions go under a card title as `note`.

## Layout

Max width 1280px with 20px gutters. Page header (headline that states the answer, standfirst, actions on the right), then the work. Timetables use a real time grid with lunch as its own row.

## Elevation & Depth

Flat surfaces separated by a hairline ring (`--shadow-card`). A soft offset shadow (`--shadow-pop`) only for hover on interactive blocks and for popovers. Translucent blur only on the sticky top chrome.

## Shapes

Blocks 8px, inputs 10px, grouped lists 12px, cards 16px, buttons and status pills fully round.

## Components

### Buttons
Primary is solid vermilion; secondary is an ink fill; danger is a soft red that turns solid on hover; ghost is a text link with a drawn chevron. Disabled buttons drop to the neutral fill with tertiary text, never a muddy faded vermilion.

### Status pills
A 6px dot and one word in the status colour on an 11% tint of the same colour.

### Timetable blocks (`.blk`)
Tinted fill plus a 1px ring in the kind's hue: lecture (ink), tutorial (lake), lab (brass), Spectra event (dusk), club/department (lake). No side stripes.

### Navigation
The top menu row of icon tiles that magnify under the cursor like the Mac dock (`.dock-item`, scale set from cursor distance). On phones it becomes a bottom tab bar. No sidebar, no dropdown menus.

### Empty states
A title saying what is missing and one sentence on how it gets filled. Never "Nothing here".

## Do's and Don'ts

### Do:
- Lead with the answer (who, where, when, clash or not), then the reason.
- Give every "no" its reason and the nearest alternative.
- Theme browser surfaces: selection, caret, scrollbars, focus rings, underline offset.

### Don't:
- Eyebrow labels, numbered step badges, gradient text, or coloured side stripes on cards and rows.
- Count-up numbers or staggered entrances on app pages; product pages load straight into the task.
- Unicode glyphs as icons (→, •, ›); use the drawn icon set.
- Fake progress bars that don't measure anything.
