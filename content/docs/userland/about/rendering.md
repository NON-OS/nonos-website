---
title: "About rendering"
description: "The renderer is src/about/paint/, a small set of one-file passes over the shared PaintBuffer, plus the row layout in src/about/sectionrender/row.rs and the palette and geometry ..."
weight: 3
---
The renderer is `src/about/paint/`, a small set of one-file passes over the shared `PaintBuffer`, plus the
row layout in [`src/about/section_render/row.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/row.rs) and the palette and geometry in [`src/about/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/theme.rs). A
paint clears the background and draws five bands top to bottom: header, tab strip, section body, scrollbar,
and status bar. This page walks that order, the row layout the section renderers use, and the theme
constants that place everything. For what each section actually contains see [content](/docs/userland/about/content/); for
the wider capsule see the [about overview](/docs/userland/about/).

## The paint order

`frame::paint` is the whole renderer. It first records the visible-line count for the current window
height, clears the background, then draws each band in order and marks the state painted
([`src/about/paint/frame.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/frame.rs#L27)):

```
  record_visible_lines(visible_lines_for(fb.height))   frame.rs:28
  fb.clear(BACKGROUND)                                 frame.rs:29
  header::paint                                        frame.rs:30
  tabs::paint                                          frame.rs:31
  body::paint                                          frame.rs:32
  scrollbar::paint                                     frame.rs:33
  status_bar::paint                                    frame.rs:34
  state.painted = true                                 frame.rs:35
```

Recording the visible-line count first is what keeps scrolling correct across a resize: the input handlers
clamp against the value this paint computed (`frame.rs:28`, [`src/about/state.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs#L64)). See
[interaction](/docs/userland/about/interaction/) for the clamp.

## Header

The header fills the top band with the accent color and draws the product name, the tagline, and a
right-aligned `n / 5` breadcrumb ([`src/about/paint/header.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/header.rs#L28)). The breadcrumb is built into a small
stack buffer as `<index+1> / <count>` and right-aligned by subtracting its pixel width from the buffer
width (`header.rs:34`, `header.rs:52`). The section count is `SECTIONS.len()`, so the breadcrumb tracks the
section array (`header.rs:35`, [`src/about/section.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section.rs#L26)).

## Tab strip

The tab strip fills its band with the tab-bar color, then lays the five section titles out left to right
([`src/about/paint/tabs.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/tabs.rs#L27)). Each tab is its label width (8px per character) plus 14px of horizontal
padding on each side; the selected tab gets a filled accent rectangle and headline-color text, the rest
get body-color text (`tabs.rs:32`, `tabs.rs:35`, `tabs.rs:38`). This is the exact layout the pointer hit
test walks, so a click lands on the tab that was drawn (`tabs.rs:29`, [`src/about/event/on_pointer_button.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/on_pointer_button.rs#L38)).

## Body

The body pass computes the body's top as header height plus tab-bar height plus the section top padding,
then hands the current section, scroll offset, visible-line count, and that top to `render_section`
([`src/about/paint/body.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/body.rs#L23)). `render_section` matches the selected section to its renderer, and
`section_line_count` matches it to its line count for the scrollbar and the End key
([`src/about/section_render/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/mod.rs#L28), `mod.rs:38`).

Each section renderer walks its rows and draws only the window of rows between `scroll` and
`scroll + visible`, placing each at a y offset from the body top. The fixed-count sections (Identity,
Display, Uptime) index straight into a row array; the variable sections (Authority, License) walk their
rows with a running index and draw the ones that fall in the visible window ([`src/about/section_render/identity.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/identity.rs#L36),
`authority.rs:45`, `license.rs:34`).

## Row layout

`row.rs` is the shared layout every section renderer uses. `pair` draws a label in body color at the left
text column and a value in headline color at a fixed value column 152px to its right; `single` draws one
full-width line in body color; `line_y` turns a row index and the body top into a y coordinate at the line
height ([`src/about/section_render/row.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/row.rs#L24), `row.rs:29`, `row.rs:33`). Because every renderer offsets its
rows through `line_y`, they all share one vertical rhythm and a renderer never computes pixel coordinates
by hand.

## Scrollbar

The scrollbar draws only when the section is taller than the visible area; if the whole section fits it
returns without drawing ([`src/about/paint/scrollbar.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/scrollbar.rs#L29)). Otherwise it fills a track down the right edge
and sizes a thumb proportional to the visible fraction, with an 8px floor, positioned by the scroll offset
over the scroll range (`scrollbar.rs:41`, `scrollbar.rs:43`, `scrollbar.rs:47`). It reads the same
`section_line_count` the body and the End key use, so the thumb and the clamp agree (`scrollbar.rs:27`).

## Status bar

The status bar fills the bottom band with the tab-bar color and draws one fixed hint line in hint color
([`src/about/paint/status_bar.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/status_bar.rs#L23)). The hint is the constant
`Tab/Shift-Tab cycle sections   Up/Down scroll line   PgUp/PgDn scroll page   Esc close`
(`status_bar.rs:21`).

## Theme

`theme.rs` is the single source of color and geometry. Every paint pass reads its constants rather than
hard-coding pixels:

| Constant | Value | Role | Source |
|---|---|---|---|
| `WINDOW_WIDTH` / `WINDOW_HEIGHT` | 560 / 400 | initial window size | `theme.rs:27` |
| `HEADER_HEIGHT` | 48 | header band | `theme.rs:32` |
| `TAB_BAR_HEIGHT` | 28 | tab strip band | `theme.rs:33` |
| `STATUS_BAR_HEIGHT` | 22 | status bar band | `theme.rs:34` |
| `SCROLLBAR_WIDTH` | 6 | scrollbar track width | `theme.rs:35` |
| `LINE_HEIGHT` | 18 | row spacing | `theme.rs:38` |
| `TEXT_LEFT` | 18 | left text column | `theme.rs:37` |
| `SECTION_TOP_PADDING` | 12 | gap above the body | `theme.rs:39` |
| `TAB_HORIZONTAL_PADDING` | 14 | tab inner padding | `theme.rs:40` |

The colors are ARGB8888 constants for the background, header accent, tab bar, selected tab, headline and
body text, hint text, and the scrollbar track and thumb (`theme.rs:17`). The window geometry constants
feed both the manifest and the visible-line math, so the layout the painter draws and the layout the
scroll model assumes are the same numbers ([`src/about/manifest.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/manifest.rs#L19), [`src/about/state.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs#L65)).

## Source map

```
  src/about/paint/frame.rs        the paint order and the visible-line record
  src/about/paint/header.rs       product name, tagline, right-aligned breadcrumb
  src/about/paint/tabs.rs         the tab strip layout and selection highlight
  src/about/paint/body.rs         body top computation and the section dispatch
  src/about/paint/scrollbar.rs    the proportional scrollbar
  src/about/paint/status_bar.rs   the fixed hint line
  src/about/section_render/mod.rs the section-to-renderer and section-to-count dispatch
  src/about/section_render/row.rs the pair/single/line_y row layout
  src/about/theme.rs              the palette and window geometry
```

Every reference above is verified against those trees.
