---
title: "Calculator rendering"
description: "The calculator draws itself the same way every app-skeleton app does: it never touches the framebuffer directly."
weight: 5
---
The calculator draws itself the same way every app-skeleton app does: it never touches the framebuffer
directly. Once per frame the skeleton hands it a `PaintBuffer` over the window's backing store, and
`src/calc/paint/` fills that buffer top to bottom. There is no incremental redraw and no dirty tracking
inside the capsule; every repaint reconstructs the whole surface from the current `State`. A frame is
produced on demand, whenever an event handler returns `EventOutcome::Repaint` ([`src/calc/event/on_key.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/on_key.rs#L29),
[`src/calc/event/on_pointer_button.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/on_pointer_button.rs#L37)). This page follows `src/calc/paint/` file by file and
[`src/calc/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs) for the palette. For the state a frame projects, see the [engine](/docs/userland/calculator/engine/) page; for
the overview see the [README](/docs/userland/calculator/).

## The compose order

`paint` is the frame recipe, a fixed sequence of five draws in one order ([`src/calc/paint/frame.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/frame.rs#L26)):

| Step | What it draws | Source |
|---|---|---|
| `background::paint` | clear the surface to the theme background | `frame.rs:27`, [`src/calc/paint/background.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/background.rs#L21) |
| `wordmark::paint` | the `NØNOS calc` wordmark, top-left | `frame.rs:28`, [`src/calc/paint/wordmark.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/wordmark.rs#L24) |
| `display::paint` | the display panel and the current value or `Error` | `frame.rs:29`, [`src/calc/paint/display.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/display.rs#L28) |
| `memory_badge::paint` | the amber `M` badge, only when memory is engaged | `frame.rs:30`, [`src/calc/paint/memory_badge.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/memory_badge.rs#L25) |
| `grid::paint` | the 6x5 keypad, cell by cell | `frame.rs:31`, [`src/calc/paint/grid.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/grid.rs#L23) |

Later draws land on top of earlier ones, so the badge sits over the cleared background and the keypad is
drawn last over everything above it. After `paint` returns, the skeleton draws its own window chrome
(titlebar, border) on the same buffer and commits the damage to the compositor, so the calculator owns the
interior and the skeleton owns the frame.

## Background and wordmark

`background::paint` fills the whole buffer with the theme `BACKGROUND`, a near-black green `0xFF0A0F0A`
([`src/calc/paint/background.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/background.rs#L22), [`src/calc/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs#L17)). `wordmark::paint` draws the fixed text
`NØNOS calc` at the top-left inset by `PADDING`, in the dim `WORDMARK` green `0xFF1F4020`, a quiet brand
mark above the display ([`src/calc/paint/wordmark.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/wordmark.rs#L24), `theme.rs:35`).

## The display panel

`display::paint` draws the readout ([`src/calc/paint/display.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/display.rs#L28)). It fills a `DISPLAY_H`-tall panel in
`DISPLAY_BG`, then paints a one-pixel `DISPLAY_BORDER` rule along the top and bottom edges of the panel
(`display.rs:30`). It then picks the text and colour: while the error latch is set it shows the red
`ERROR_TEXT` in `DISPLAY_ERROR`; otherwise it formats the display value and shows it in `DISPLAY_TEXT`, the
phosphor green (`display.rs:34`). The text is right-aligned: the width is estimated at 8 pixels per glyph
and the string is placed so its right edge sits a fixed padding in from the panel's right side, with
`saturating_sub` guarding a value too wide to fit (`display.rs:40`). The formatting itself belongs to
`src/calc/format/` and is covered in the [engine](/docs/userland/calculator/engine/) page.

## The memory badge

`memory_badge::paint` returns immediately unless `state.memory_engaged()` is true, so the badge is drawn
only when the memory register is non-zero ([`src/calc/paint/memory_badge.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/memory_badge.rs#L26)). When it is, it draws a
single `M` glyph near the top-left in the `MEMORY_INDICATOR` amber `0xFFD8B45F`, a small persistent hint
that memory holds a value (`memory_badge.rs:29`, [`src/calc/theme.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs#L22)).

## The keypad grid

`grid::paint` walks the same static `GRID` the [input](/docs/userland/calculator/input/) path hit-tests, so the drawn geometry and
the hot regions come from one source ([`src/calc/paint/grid.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/grid.rs#L23)). It reads the cell size once from
`cell_size()`, then for every row and column it computes the cell origin with `cell_origin()` and hands the
button to `button::paint` (`grid.rs:24`). Both `cell_size` and `cell_origin` live in [`src/calc/layout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs),
the same file `hit_test` uses, which is why a click always lands on the button drawn under it
([`src/calc/layout.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs#L26), `layout.rs:32`).

`button::paint` draws one cell ([`src/calc/paint/button.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/button.rs#L28)). It picks a background and foreground colour
from the button's `Role`, fills the cell, draws a one-pixel `BUTTON_BORDER` rule top and bottom, then
centres the label horizontally and vertically inside the cell (`button.rs:29`, `button.rs:36`). The
per-role palette:

| Role | Background | Text | Source |
|---|---|---|---|
| `Number` | `NUMBER_BG` `0xFF101810` | `NUMBER_TEXT` `0xFFB6FF7A` | `button.rs:30`, `theme.rs:24` |
| `Operator` | `OPERATOR_BG` `0xFF1A3520` | `OPERATOR_TEXT` `0xFF8CF08C` | `button.rs:31`, `theme.rs:26` |
| `Equals` | `EQUALS_BG` `0xFF2D8F44` | `EQUALS_TEXT` `0xFF0A0F0A` | `button.rs:32`, `theme.rs:30` |
| `Function` | `FUNCTION_BG` `0xFF152015` | `FUNCTION_TEXT` `0xFF5FB95F` | `button.rs:33`, `theme.rs:28` |
| `Memory` | `MEMORY_BG` `0xFF332010` | `MEMORY_TEXT` `0xFFD8B45F` | `button.rs:34`, `theme.rs:32` |

The equals button is the brightest, a solid green with near-black text so it reads as the primary action;
the memory row and its badge share the amber family; numbers, operators, and functions sit in graded
greens. All of these are fixed ARGB words in [`src/calc/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs#L17).

## The palette

The whole colour scheme is one file, [`src/calc/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs#L17), a phosphor-green desk-calculator look. The
display group is the panel background, border, the phosphor text, and the red error text
(`theme.rs:18`); the button group is the five role pairs above plus the shared `BUTTON_BORDER`
(`theme.rs:24`); and the two accents are the amber `MEMORY_INDICATOR` used by the badge and the dim
`WORDMARK` green (`theme.rs:22`, `theme.rs:35`). Nothing here is computed; every colour is a literal ARGB
constant, so the look is entirely static.

## How the frame reaches the compositor

The calculator never presents anything itself. It writes into the `PaintBuffer`, which is a direct view of
the shared surface memory the compositor reads, so there is no copy step between the calculator's drawing
and the compositor's read. After `paint` returns and the handler's `Repaint` outcome propagates, the
skeleton finishes the buffer with its window chrome and notifies the compositor that the surface changed;
the compositor then blits the surface into the screen framebuffer as part of its own pass.

## Source map

```
  src/calc/paint/mod.rs           the paint module tree; re-exports paint
  src/calc/paint/frame.rs         paint: the five-step compose order
  src/calc/paint/background.rs    clear to the theme background
  src/calc/paint/wordmark.rs      the NØNOS calc wordmark
  src/calc/paint/display.rs       the display panel, value, and Error text
  src/calc/paint/memory_badge.rs  the amber M badge, gated on memory_engaged
  src/calc/paint/grid.rs          walk GRID and draw each cell
  src/calc/paint/button.rs        one cell: role colour, border, centred label
  src/calc/theme.rs               the phosphor-green palette (all ARGB constants)
  src/calc/layout.rs              cell_size / cell_origin (shared with the hit-test)
  src/calc/format/                value -> text for the display panel
```

Every reference above is verified against those trees.
