---
title: "Terminal rendering"
description: "The terminal draws itself the same way every app-skeleton app does: it never touches the framebuffer directly."
weight: 4
---
The terminal draws itself the same way every app-skeleton app does: it never touches the framebuffer
directly. Once per frame the skeleton hands the terminal a `PaintBuffer` over the window's backing
store, and `src/paint/` fills that buffer top to bottom. It clears the background, lays down the header,
walks the visible rows of the character grid turning each cell into a rectangle of pixels and a glyph,
paints the cursor, then finishes with the input bar and the footer. There is no incremental redraw and
no dirty tracking inside the capsule: every repaint reconstructs the whole surface from the current
`State`. This page follows `src/paint/` file by file. For the rest of the capsule (identity, shell,
IPC) see [the terminal README](/docs/userland/terminal/).

## What a frame is and what triggers it

The terminal's `App::paint` forwards straight to `paint_inner`, which stamps the tab's start time on the
first frame (used only by the fetch screen's uptime line) and then calls the compose entry point
`paint_tabs` ([`src/term/terminal/app_impl.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl.rs#L30), [`src/term/terminal/app_impl_paint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl_paint.rs#L22)). The
skeleton runner is what decides when that happens. `paint_once` maps the window's backing store into a
`PaintBuffer`, calls `app.paint(&mut fb)`, then commits the damaged rectangle to the compositor
([`app_skeleton/src/runner/paint_once.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/runner/paint_once.rs#L33)). Event handlers signal that a repaint is needed by
returning `EventOutcome::Repaint`; typing, tab switches, and tab close all do this
([`app_skeleton/src/app/event_outcome.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/app/event_outcome.rs#L20), [`src/term/terminal/tabs.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tabs.rs#L42)). So a frame is produced on
demand, and each one is a full repaint of the surface, not a delta.

## Surface and framebuffer target ([`paint/compose.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/compose.rs), skeleton `PaintBuffer`)

The terminal draws into a `PaintBuffer`, a thin view over the window's shared backing store:
`pixels` is a `&mut [u32]` of ARGB words, `stride_words` is the row pitch in words, and `width`/`height`
are the drawable size ([`app_skeleton/src/paint/buffer.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/paint/buffer.rs#L17)). The buffer is constructed in the runner
by reinterpreting the surface's `backing_va` as a `u32` slice, so every `fill_rect` and `text` call
writes directly into the memory the compositor reads ([`app_skeleton/src/runner/paint_frame.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/runner/paint_frame.rs#L49)).

`fill_rect` clips against the buffer bounds and writes `argb` into each covered word
([`app_skeleton/src/paint/fill_rect.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/paint/fill_rect.rs#L20)). `clear` fills the whole buffer with one colour
([`app_skeleton/src/paint/clear.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/paint/clear.rs)). `text` and `text_scaled` delegate to the toolkit font renderer,
`draw_text` / `draw_text_scaled`, passing the pixel slice, stride, and clip size
([`app_skeleton/src/paint/text.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/paint/text.rs#L22), [`app_skeleton/src/paint/text_scaled.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/paint/text_scaled.rs#L22)).

`compose::paint` is the frame recipe ([`src/paint/compose.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L34)):

1. `fb.clear(BACKGROUND)` wipes the surface to the theme background `0xFF181A1F`
   ([`src/paint/compose.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L35), [`src/term/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/theme.rs#L17)).
2. `draw_header` paints the top bar ([`src/paint/compose.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L36)).
3. It reads `state.scrollback.grid.alternate` and computes `input_y`, the row where the input bar sits,
   as `height - (FOOTER_H + LINE_HEIGHT)` ([`src/paint/compose.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L37)).
4. It picks one of three body layouts (below), draws the input line unless the alternate screen is
   active, and ends with `draw_footer` ([`src/paint/compose.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L39)).

`paint_tabs` is the wrapper the capsule actually calls: it paints the active tab's `State` with `paint`,
then overlays the tab strip ([`src/paint/compose.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L29)). After `app.paint` returns, the skeleton draws
its own window chrome (titlebar, buttons, border) on top of the same buffer before committing
([`app_skeleton/src/runner/paint_frame.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/runner/paint_frame.rs#L59)), so the terminal owns the interior and the skeleton owns
the frame.

## Layout constants ([`paint/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/constants.rs))

The geometry is fixed in one file ([`src/paint/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/constants.rs#L17)):

| Constant | Value | Meaning |
|---|---|---|
| `LINE_HEIGHT` | 15 | vertical pitch of one text row |
| `TEXT_LEFT` | 14 | left inset for body text |
| `HEADER_H` | 28 | header bar height |
| `FOOTER_H` | 16 | footer bar height |
| `BODY_TOP` | 50 | first body row, `HEADER_H + 6 + 16` |
| `CELL_WIDTH` | 9 | column pitch used by the fixed-layout screens |

`CELL_WIDTH` is 9 because the toolkit font is an 8-pixel glyph with 1 pixel of letter spacing; the
grid path instead reads that pitch at runtime through `glyph_advance`, which returns
`glyph_width + letter_spacing = 8 + 1 = 9` from the default `FontAtlas`
([`app_skeleton/src/paint/glyph_advance.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/paint/glyph_advance.rs#L22), [`toolkit/src/font/atlas.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/toolkit/src/font/atlas.rs#L12)). The two agree, but the
grid uses the live value so it tracks any font change, while the header, fetch, and input-bar code use
the constant.

## The three body layouts ([`paint/compose.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/compose.rs))

`compose::paint` chooses exactly one body path ([`src/paint/compose.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L39)):

- Alternate screen (`grid.alternate` true): a full-program TUI is running, so it draws the grid across
  the whole body down to `height - FOOTER_H`, draws the grid's own cursor, and skips the input bar
  ([`src/paint/compose.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L40)).
- Fresh tab (`state.fresh` true, no command run yet): it draws the neofetch-style splash instead of the
  grid ([`src/paint/compose.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L43)).
- Normal (a command has run): it draws the block chrome behind the text, then the grid, both bounded by
  `input_y` so scrollback never overlaps the prompt ([`src/paint/compose.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/compose.rs#L45)).

## Cell and glyph drawing ([`paint/draw_grid.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/draw_grid.rs))

`draw_grid` is where the character grid becomes pixels ([`src/paint/draw_grid.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L40)). It reads the column
pitch once as `adv = fb.glyph_advance()`, then walks `row` from 0 to `VISIBLE_ROWS` (15,
[`src/term/dimensions.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/dimensions.rs#L19)). For each row it computes `y = oy + row * LINE_HEIGHT` and stops early if
the row would cross `max_y`, which is how the grid is clipped to the input line or the footer
([`src/paint/draw_grid.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L42)).

For each row it asks the grid for the backing cells with `g.visible_row(row)`. That call resolves the
scrollback view: it maps the on-screen row through `view_offset` and `hist_count`, returning a slice out
of the ring `history` buffer when the row is scrolled into the past, or out of the live `cells` when it
is on the active screen ([`src/term/grid/view.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/view.rs#L22)). So scrollback is not a separate render path; it is
the same walk reading a different slice.

Then it walks `col` from 0 to `COLS` (96, [`src/term/dimensions.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/dimensions.rs#L17)). Each `Cell` carries a byte
`ch`, an ANSI foreground index `fg`, an ANSI background index `bg`, and `flags`
([`src/term/grid/cell.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/cell.rs#L21)). Turning one cell into pixels:

- `x = ox + col * adv` places the cell ([`src/paint/draw_grid.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L50)).
- `fg` and `bg` are converted from ANSI indices to ARGB with `ansi_to_argb` ([`src/paint/draw_grid.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L51)).
- If the cell's `F_REVERSE` flag is set, foreground and background are swapped
  ([`src/paint/draw_grid.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L53), [`src/term/grid/cell.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/cell.rs#L19)).
- The background rectangle is only painted when the cell's background differs from the default, or when
  reverse is set; a default-background cell keeps the surface clear that was laid down earlier and skips
  the fill ([`src/paint/draw_grid.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L57)).
- The glyph is drawn only when `ch` is not a space, so blank cells cost nothing beyond the optional
  background ([`src/paint/draw_grid.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L60)).

The glyph itself is a single byte handed to `fb.text(x, y, &[cell.ch], fg)`, which routes to the toolkit
font renderer ([`src/paint/draw_grid.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L61)). The terminal stores one byte per cell, so it renders the
low 256 code points of the built-in font and does not carry wide characters.

## Cursor ([`paint/draw_cursor.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/draw_cursor.rs), grid cursor in [`paint/draw_grid.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/draw_grid.rs))

There are two cursors because there are two body paths.

The grid cursor is used on the alternate screen. `draw_grid_cursor` returns immediately if the grid's
`cursor_visible` flag is clear, otherwise it fills a `adv` by `LINE_HEIGHT` block in the `CURSOR` colour
at the grid's `(x, y)`, and if the covered cell holds a printable byte it repaints that glyph in
`BACKGROUND` so it reads through the block ([`src/paint/draw_grid.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_grid.rs#L26)). This is a solid inverse-video
block cursor driven entirely by grid state.

The input cursor is used on the normal screen and belongs to the line editor, not the grid.
`draw_cursor` fills a `CELL_WIDTH` by `LINE_HEIGHT - 2` block at
`TEXT_LEFT + (prompt_cells + cursor_cell) * CELL_WIDTH`, and if the character under the cursor is
printable it redraws it in `BACKGROUND` for the same inverse-block effect
([`src/paint/draw_cursor.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_cursor.rs#L22)). Both cursors share the `CURSOR` colour `0xFF5FB0C9`
([`src/term/theme.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/theme.rs#L21)).

## Colours and palette ([`paint/fetch_palette.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/fetch_palette.rs), theme, vt/color)

Two colour systems meet in the paint layer. The chrome (header, footer, prompt, cursor, block tints)
uses named theme constants, fixed ARGB words in [`src/term/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/theme.rs#L17). The grid contents use ANSI
colour indices per cell, resolved to ARGB by `ansi_to_argb` in the VT layer: indices 0..15 are the
standard and bright sixteen, 16..231 are the 6x6x6 cube, and 232..255 are the grayscale ramp
([`src/term/vt/color.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/color.rs#L20)). `DEFAULT_BG` is index 0, which is the value `draw_grid` checks against to
decide whether a cell needs a background fill ([`src/term/vt/color.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/color.rs#L18)).

The fetch splash has its own inline swatch strip. `draw_palette` paints eight 14x10 rectangles spaced 18
pixels apart, a hard-coded brand palette independent of the ANSI table
([`src/paint/fetch_palette.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch_palette.rs#L19)).

## Fetch splash ([`paint/fetch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/fetch.rs), [`paint/fetch_row.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/fetch_row.rs), [`paint/fetch_uptime.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/fetch_uptime.rs))

A fresh tab shows a neofetch-style card instead of scrollback. `draw_fetch` draws a large scaled NØNOS
mark and wordmark with `text_scaled`, then a right-hand column of labelled rows starting at x=172
([`src/paint/fetch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch.rs#L26)). Each row is a `fetch_row` call: the label is drawn in `ACCENT` and the value
is drawn in `FOREGROUND` one label-column to the right, at `x + 9 * CELL_WIDTH`
([`src/paint/fetch_row.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch_row.rs#L22)). The fixed rows are os, kernel, shell, trust, arch, and a live uptime
([`src/paint/fetch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch.rs#L36)). The uptime value comes from `mk_time_millis()` minus the tab's `start_ms`,
formatted as `<m>m <s>s` by `uptime_str` ([`src/paint/fetch.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch.rs#L46), [`src/paint/fetch_uptime.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch_uptime.rs#L19)). The
card closes with the swatch strip from `draw_palette` ([`src/paint/fetch.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fetch.rs#L53)).

## Block chrome ([`paint/block_chrome.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/block_chrome.rs), [`paint/block_meta.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/block_meta.rs))

On the normal screen the terminal groups output by command into visual blocks, drawn behind the grid so
the text lands on top. `draw_block_chrome` walks the same visible rows as `draw_grid`, converts each
on-screen row to an absolute scrollback line with `abs_of_visible_row`, and asks the state which command
block owns that line ([`src/paint/block_chrome.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/block_chrome.rs#L29), [`src/term/grid/absline.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/absline.rs#L28)). For a row inside a
block it fills a full-width tint behind the row, alternating `BLOCK_TINT_A` and `BLOCK_TINT_B` by block
index so adjacent commands read apart, and paints a 3-pixel status stripe in the left gutter coloured by
the block's status: `BLOCK_OK`, `BLOCK_ERR`, or `BLOCK_RUN` ([`src/paint/block_chrome.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/block_chrome.rs#L41)).

On the block's first row it also draws the metadata line. `draw_meta` right-aligns a timestamp, then a
formatted duration to its left, then a status mark glyph to the left of that, all in the `DIM` colour and
positioned in cell multiples from the right edge ([`src/paint/block_meta.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/block_meta.rs#L23)). This is decoration only;
it reads block records and does not change the grid.

## Header, input bar, footer ([`paint/header.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/header.rs), [`paint/draw_input_line.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/draw_input_line.rs), [`paint/footer.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/footer.rs))

The header is a filled `HEADER_H` bar with a one-pixel rule under it, a scaled `NØNOS` wordmark on the
left, and the current working directory right-aligned and clipped to its last 34 characters
([`src/paint/header.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/header.rs#L23)).

The input bar is the Warp-style prompt panel drawn on the normal screen at `input_y`. It fills an inset
`INPUT_BG` panel with a 2-pixel `ACCENT` stripe on its left edge, then computes how many character cells
fit between equal left and right margins ([`src/paint/draw_input_line.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_input_line.rs#L24)). The prompt is a glyph plus
the cwd (capped to a third of the line so a deep path cannot starve the typing area) plus a trailing
space ([`src/paint/draw_input_line.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_input_line.rs#L36)). The body text is horizontally scrolled by a `body_cells`-wide
window so the cursor stays on screen, and the caret is placed by `draw_cursor` at the cursor's column
within that window ([`src/paint/draw_input_line.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/draw_input_line.rs#L43)).

The footer is a filled `FOOTER_H` bar at the bottom carrying a fixed one-line keybinding hint in the
`DIM` colour ([`src/paint/footer.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/footer.rs#L22)).

## Tab strip ([`paint/tabstrip.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paint/tabstrip.rs))

When more than the body is in play, `paint_tabs` overlays the tab strip on the row just below the header
(`STRIP_Y = HEADER_H`, `STRIP_H = 16`). `draw_tabstrip` fills the strip in `HEADER_BG`, then for each
tab draws a `TAB_W`-wide slot (`16 * CELL_WIDTH`) holding an index, a colon, and the cwd basename capped
to nine characters, with the active tab filled in `ACCENT` and its label inverted to `HEADER_BG`
([`src/paint/tabstrip.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/tabstrip.rs#L29)). Each slot has an `x` close mark on its right, and a `+` new-tab affordance
follows the last slot ([`src/paint/tabstrip.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/tabstrip.rs#L44)). The strip's `TAB_W`, `STRIP_Y`, `STRIP_H`,
`CLOSE_W`, and `PLUS_W` constants are re-used by the click hit-testing so the drawn geometry and the hot
regions stay in one place ([`src/paint/tabstrip.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/tabstrip.rs#L23), [`src/term/terminal/tab_click.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tab_click.rs#L20)).

## How the frame reaches the compositor

The terminal never presents anything itself. After `app.paint` returns, `paint_frame` finishes the same
`PaintBuffer` with the skeleton's window chrome, and `paint_once` calls `compositor::damage_commit` with
the window rectangle to tell the compositor the surface changed ([`app_skeleton/src/runner/paint_once.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/runner/paint_once.rs#L37)).
Because the `PaintBuffer` is a direct view of the shared surface memory, there is no copy step between
the terminal's drawing and the compositor's read; the commit is just the damage notification. The
compositor then blits the surface into the screen framebuffer as part of its own pass.

## Source map

Every rendering claim above is traced to `userland/capsule_terminal/src/paint/` (the compose entry,
grid and cursor drawing, the fetch splash, block chrome, header, input line, footer, and tab strip),
with the grid model and scrollback view living in `userland/capsule_terminal/src/term/grid/`, the colour
tables in [`src/term/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/theme.rs) and [`src/term/vt/color.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/color.rs), and the framebuffer primitives and paint loop
in `userland/app_skeleton/src/paint/` and `userland/app_skeleton/src/runner/`. Every reference above is
verified against those trees.
