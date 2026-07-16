---
title: "Snake rendering"
description: "The renderer is the paint submodule under src/snake/paint/, one file per layer."
weight: 5
---
The renderer is the `paint` submodule under `src/snake/paint/`, one file per layer. It is a pure
projection: it reads the `Game` and writes pixels into the `PaintBuffer` the skeleton hands it, and it
never mutates game state. A frame clears the background, computes a fit-to-window layout, draws the score
header and the board, and overlays a banner for whichever non-running phase is active. This page mirrors
[`paint/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/mod.rs), `layout.rs`, `header.rs`, `board.rs`, and `overlay.rs`. For the state being drawn see the
[game loop](/docs/userland/snake/game-loop/), and for the wider capsule see the [overview](/docs/userland/snake/).

## The frame

`paint` is the single entry point the `App` adapter forwards to ([`src/snake/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L42)). It runs four
steps in order ([`src/snake/paint/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/mod.rs#L28)):

1. Compute the layout from the surface's own width and height ([`src/snake/paint/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/mod.rs#L29)).
2. Clear the whole buffer to the background colour `0xFF10_1418` ([`src/snake/paint/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/mod.rs#L26),
   `mod.rs:30`).
3. Draw the header, then the board ([`src/snake/paint/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/mod.rs#L31), `mod.rs:32`).
4. Match the phase and overlay the matching banner: `Ready` draws `ready`, `Paused` draws `paused`,
   `GameOver` draws `game_over`, and `Running` draws no overlay ([`src/snake/paint/mod.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/mod.rs#L33)).

## Layout

The board layout is recomputed from the surface size on every frame, so the cells scale to fit whatever
window the compositor grants rather than assuming the manifest's size. `compute` takes the buffer width
and height and returns a `Layout` with the cell size, board origin, and board dimensions
([`src/snake/paint/layout.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/layout.rs#L33)).

- The available width and height subtract the margins, the title bar, and the header from the surface, and
  floor at the grid dimension so the math never underflows ([`src/snake/paint/layout.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/layout.rs#L34),
  `layout.rs:35`).
- The cell size is the smaller of the per-column and per-row fit, floored at 4 px so a cell is always
  visible ([`src/snake/paint/layout.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/layout.rs#L36)).
- The board is then sized `cell * COLS` by `cell * ROWS` and centered horizontally in the surface and
  vertically in the area below the header ([`src/snake/paint/layout.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/layout.rs#L37), `layout.rs:39`).

`Layout::inset` derives a small per-cell gap from the cell size, `(cell / 16).max(1)`, so cells read as
separate squares at any scale ([`src/snake/paint/layout.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/layout.rs#L28)). Every width the layout subtracts uses
`saturating_sub`, so a tiny surface produces a valid, if cramped, layout rather than a panic.

## Header

The header draws the score at the top of the window. It prints the label `SCORE` in the muted label
colour and the live score value in green, both at text scale 2, positioned from the title-bar height and
the layout origin ([`src/snake/paint/header.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/header.rs#L26), `header.rs:29`, `header.rs:30`). The score is rendered
with a local `itoa` that fills a fixed 10-byte buffer from the least significant digit and returns the
written slice, so it allocates nothing and cannot overflow ([`src/snake/paint/header.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/header.rs#L33)). The colours
are module constants: label `0xFF9A_A4B2`, value `0xFF6A_D47A` ([`src/snake/paint/header.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/header.rs#L23)).

## Board

The board draws the playfield and its occupants in back-to-front order so the head is never hidden
([`src/snake/paint/board.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L27)):

1. Fill the board rectangle with the board background `0xFF18_2024` ([`src/snake/paint/board.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L28)).
2. Draw the food cell in red `0xFFE0_533D` ([`src/snake/paint/board.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L29)).
3. Draw every body segment except the head in the body green `0xFF3F_A34D` ([`src/snake/paint/board.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L30)).
4. Draw the head last, on top, in the bright head green `0xFF6A_D47A` ([`src/snake/paint/board.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L33)).

Each cell is drawn by the `cell` helper, which converts a `(col, row)` grid coordinate into a pixel
rectangle at `layout.x + col * cell` and `layout.y + row * cell`, shrunk by the layout inset on every
side so adjacent cells do not merge ([`src/snake/paint/board.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L36)). The colour constants sit at the top
of the module ([`src/snake/paint/board.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L22)).

## Overlays

The overlay layer draws a scrim banner and centered text for each non-running phase ([`src/snake/paint/overlay.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs)).
Every banner is a horizontal scrim strip centered on the board, and text is centered by measuring its
pixel width from the byte length and the scale ([`src/snake/paint/overlay.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L41), `overlay.rs:45`).

| Phase | Text drawn | Source |
|---|---|---|
| `Ready` | `PRESS A DIRECTION KEY` | [`src/snake/paint/overlay.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L25) |
| `Paused` | `PAUSED` | [`src/snake/paint/overlay.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L30) |
| `GameOver` | `GAME OVER` and `ENTER TO RESTART` | [`src/snake/paint/overlay.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L35) |

`Running` draws no overlay at all, so a live game shows only the header and board
([`src/snake/paint/mod.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/mod.rs#L37)). The overlay colours are module constants: the scrim `0xFF20_262E`, the
primary text `0xFFEC_EFF4`, and the sub-text `0xFF9A_A4B2` ([`src/snake/paint/overlay.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L21)).

## Source map

```
  userland/capsule_snake/src/snake/paint/mod.rs      the frame: clear, header, board, phase overlay
  userland/capsule_snake/src/snake/paint/layout.rs   fit-to-window cell size, centered board, inset
  userland/capsule_snake/src/snake/paint/header.rs   SCORE label and value, the itoa digit render
  userland/capsule_snake/src/snake/paint/board.rs    board fill, food, body, head in back-to-front order
  userland/capsule_snake/src/snake/paint/overlay.rs  the Ready / Paused / GameOver banners
  userland/capsule_snake/src/snake/app.rs            the App::paint forward
```

Every reference above is verified against those trees.
