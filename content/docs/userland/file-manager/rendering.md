---
title: "Rendering"
description: "This page mirrors the window manifest and the paint units under src/fm/: the manifest (manifest.rs), the paint entry (paint.rs), the row geometry (layout.rs, paintmetrics.rs), t..."
weight: 5
---
This page mirrors the window manifest and the paint units under `src/fm/`: the manifest (`manifest.rs`),
the paint entry (`paint.rs`), the row geometry (`layout.rs`, `paint_metrics.rs`), the header, rows, and
footer (`paint_header.rs`, `paint_rows.rs`, `paint_footer.rs`), the right-align and clip helpers
(`paint_right.rs`, `paint_clip.rs`), the palette (`theme.rs`), the help overlay (`help.rs`), and the
file-decoration units that color and format a row (`filetype.rs`, `file_kind.rs`, `file_ext.rs`,
`file_color.rs`, `human_size.rs`, `fmt_time.rs`). It reads the model built on
[listing.md](/docs/userland/file-manager/listing/); the preview renderer is on [preview.md](/docs/userland/file-manager/preview/).

## The window

The manifest declares a 360x260 Normal window titled `File Manager`, opening near the desktop center at
`(792, 438)`, subscribing to key-down, button-down, and absolute-pointer input
([`src/fm/manifest.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/manifest.rs#L26), `:19`, `:35`). `WIDTH` and `HEIGHT` are the constants the paint geometry is
derived from (`manifest.rs:19`).

## The paint pass

`paint` projects the current mode into the surface ([`src/fm/paint.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint.rs#L28)). Help and preview take over the
whole window and return early (`paint.rs:29`, `:33`); those are on this page (help) and
[preview.md](/docs/userland/file-manager/preview/). Otherwise it clears the background, draws the `file_manager` title and the
current path, then the header, the rows, and the footer (`paint.rs:37`).

Geometry is shared so a click lands on the row it points at. `layout.rs` holds the row window:
`FIRST_ROW_Y = 64`, `ROW_HEIGHT = 22`, and `LIST_VISIBLE = 7` rows ([`src/fm/layout.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/layout.rs#L19)).
`paint_metrics.rs` holds the text columns: `TEXT_LEFT = 16`, `GLYPH_W = 9`, `NAME_MAX = 30`, the
right-edge `SIZE_END` and `DATE_END`, and the footer `STATUS_Y = HEIGHT - 22`
([`src/fm/paint_metrics.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint_metrics.rs#L19)).

## Header, rows, and footer

The header draws a right-aligned `sort:<mode>` tag, appending `  /<filter>` when a filter is active
([`src/fm/paint_header.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint_header.rs#L24), `:27`). The sort label comes from `SortMode::label`
(see [listing.md](/docs/userland/file-manager/listing/)).

`paint_rows` draws the scrolling window of rows ([`src/fm/paint_rows.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint_rows.rs#L31)). An empty view shows
`empty directory` with no filter or `no matches` with one (`paint_rows.rs:33`). Otherwise it walks
`LIST_VISIBLE` entries from the scroll offset: the cursor row gets a highlight fill, the name is drawn in
the cursor color or the file-kind color and clipped to `NAME_MAX`, and when metadata is present a
right-aligned human size and a right-aligned modified time are drawn (`paint_rows.rs:38`, `:41`, `:44`,
`:46`, `:49`). Right alignment is done by `paint_right`, which subtracts the glyph width times the text
length from the end column ([`src/fm/paint_right.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint_right.rs#L21)), and `clip` truncates to a column width
([`src/fm/paint_clip.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint_clip.rs#L17)).

The footer draws a right-aligned `cursor/total` counter, the status line, and, in filter or prompt mode,
the live filter or prompt input echoed after the status ([`src/fm/paint_footer.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint_footer.rs#L24), `:29`).

## File decoration

A row's color and its formatted size and time come from small pure units:

- `Kind` is the file class: Dir, Code, Image, Doc, Archive, Exec, or Other
  ([`src/fm/filetype.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/filetype.rs#L17)). `kind_of` returns Dir for a directory and otherwise classifies by extension
  against fixed lists ([`src/fm/file_kind.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/file_kind.rs#L21), `:26`). `ext` takes the extension after the last dot
  ([`src/fm/file_ext.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/file_ext.rs#L17)).
- `color` maps each `Kind` to a palette color ([`src/fm/file_color.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/file_color.rs#L19)), and the palette itself
  (background, foreground, selected, directory, muted) is in `theme.rs` ([`src/fm/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/theme.rs#L17)).
- `human_size` renders a byte count as an exact value under 1K or one decimal with a K/M/G suffix
  ([`src/fm/human_size.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/human_size.rs#L21)).
- `fmt_time` renders a unix-millisecond timestamp as a compact `MM-DD HH:MM`, or `--` when the time is
  unknown, using a branchless civil-date conversion ([`src/fm/fmt_time.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/fmt_time.rs#L21), `:35`).

## The help overlay

`?` opens a full-window keybinding reference; `paint_help` clears the window and draws the fixed `KEYS`
table with a `file_manager keys` title and an `any key to close` footer ([`src/fm/help.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/help.rs#L46), `:27`).
Any key dismisses it back to browsing (`help.rs:58`). The `KEYS` table is the authoritative in-app cheat
sheet and matches the handlers on [input.md](/docs/userland/file-manager/input/) and [actions.md](/docs/userland/file-manager/actions/).

## Source map

Everything here is drawn from the manifest and paint units under
`userland/capsule_file_manager/src/fm/` (`manifest.rs`, `paint.rs`, `layout.rs`, `paint_metrics.rs`,
`paint_header.rs`, `paint_rows.rs`, `paint_footer.rs`, `paint_right.rs`, `paint_clip.rs`, `theme.rs`,
`help.rs`) and the file-decoration units (`filetype.rs`, `file_kind.rs`, `file_ext.rs`, `file_color.rs`,
`human_size.rs`, `fmt_time.rs`). Every reference above is verified against those trees.
