---
title: "Preview"
description: "This page mirrors the preview units under src/fm/: the Preview struct and the read that fills it (preview.rs), the binary sniff (previewisbinary.rs), the two renderers (previewt..."
weight: 4
---
This page mirrors the preview units under `src/fm/`: the `Preview` struct and the read that fills it
(`preview.rs`), the binary sniff (`preview_is_binary.rs`), the two renderers (`preview_text.rs`,
`preview_hex.rs`), the scroll keys (`preview_key.rs`), the info bar (`preview_info.rs`), the paint pass
(`preview_paint.rs`), and the line clip (`preview_clip.rs`). Preview is a full-window mode: when it is
active the paint pass draws only the preview and nothing else ([`src/fm/paint.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/paint.rs#L33)). Opening is reached
from the browse keys on [input.md](/docs/userland/file-manager/input/).

## Opening a file

Pressing Enter, Right, or `l` on a file, or clicking it, calls `open_preview`
([`src/fm/event_open.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/event_open.rs#L31)). It reads the file through the vfs with `read_file`, capped at
`MAX_PREVIEW_BYTES = 256 KiB` so opening a huge file stays bounded ([`src/fm/preview.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview.rs#L29), `:45`). On
success it sniffs the bytes, builds the line list, stores a `Preview`, switches to preview mode, and
shows the `esc back  up/down scroll` status (`preview.rs:47`, `:57`). A failed read clears the preview
and leaves browse mode with a `read failed` status (`preview.rs:60`).

The `Preview` holds the path, the rendered lines, the byte length, the binary flag, a truncated flag set
when the read hit the cap, and the scroll offset ([`src/fm/preview.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview.rs#L33), `:53`).

## Text or binary

`is_binary` samples the first 1024 bytes: any NUL byte makes it binary immediately, and otherwise it is
binary if more than 30 percent of the sampled bytes are non-printable (outside `0x20..=0x7e` and not
tab, newline, or carriage return) ([`src/fm/preview_is_binary.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_is_binary.rs#L18), `:24`, `:32`). An empty file is
treated as text (`preview_is_binary.rs:19`).

A text file is rendered by `text_lines`: newlines break lines, carriage returns are dropped, tabs expand
to four spaces, and any other control byte becomes a dot so the glyph atlas never renders noise. Lines
are capped at `MAX_LINE = 512` characters and `MAX_LINES = 8192` lines so a pathological file cannot
exhaust the heap ([`src/fm/preview_text.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_text.rs#L22), `:29`, `:46`).

A binary file is rendered by `hex_lines` as an offset/hex/ascii dump, `COLS = 16` bytes per row: a
four-digit hex offset, the byte values in hex, then the printable ascii with non-printable bytes shown
as dots. The dump is capped at `MAX_ROWS = 4096` rows ([`src/fm/preview_hex.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_hex.rs#L22), `:28`, `:31`).

## Scrolling and the info bar

In preview mode Up scrolls up one line and Down scrolls down one line, clamped so the last line does not
scroll past the bottom of the `VISIBLE_LINES = 10` window; Esc returns to browsing
([`src/fm/preview_key.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_key.rs#L24), `:33`, [`src/fm/preview_paint.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_paint.rs#L28)).

`paint_preview` draws the title, the path, the info bar, the visible window of content lines starting at
the scroll offset, and the footer hint ([`src/fm/preview_paint.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_paint.rs#L32)). Each line is clipped to
`MAX_COLS = 38` characters by `clip` before it is drawn (`preview_paint.rs:39`, [`src/fm/preview_clip.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_clip.rs#L19)).
The info bar reports the byte count, whether the file is text or binary, the visible line range, the
total line count, and a `(truncated)` note when the read hit the 256 KiB cap
([`src/fm/preview_info.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/preview_info.rs#L20), `:26`).

## The vfs ops preview calls

`read_file` goes over the app skeleton's vfs client, service `vfs_pool`, magic `0x4E4F5646`, using
`OP_OPEN` (1), `OP_READ` (3), and `OP_CLOSE` (2) ([`.../vfs/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/types.rs#L19), `:21`, `:20`,
[`.../vfs/read_file.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/read_file.rs)). The read is bounded by the `MAX_PREVIEW_BYTES` argument (`preview.rs:45`). The
listing ops are on [listing.md](/docs/userland/file-manager/listing/) and the action ops on [actions.md](/docs/userland/file-manager/actions/).

## Source map

Everything here is drawn from the preview units under `userland/capsule_file_manager/src/fm/`
(`preview.rs`, `preview_is_binary.rs`, `preview_text.rs`, `preview_hex.rs`, `preview_key.rs`,
`preview_info.rs`, `preview_paint.rs`, `preview_clip.rs`), the browse open path in `event_open.rs`, the
top-level `paint.rs`, and the shared vfs client under `userland/app_skeleton/src/clients/vfs/`. Every
reference above is verified against those trees.
