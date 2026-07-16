---
title: "Editing and the view"
description: "This page covers the in-process half of the editor: how a key becomes an edit or a scroll, the full keybinding list, the buffer model, and how the wrapped view and the caret are..."
weight: 1
---
This page covers the in-process half of the editor: how a key becomes an edit or a scroll, the full
keybinding list, the buffer model, and how the wrapped view and the caret are drawn. The file half
(open, save, copy, paste, and the path prompt) is on the [file-io](/docs/userland/text-editor/file-io/) page. For the capsule's
identity and mask see the [README](/docs/userland/text-editor/).

It mirrors [`src/editor/event.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs), `on_nav.rs`, `insert.rs`, `backspace.rs`, the scroll and layout helpers,
and `paint.rs`.

## The key router

Input arrives as key-down events through the app skeleton. `on_event` is the single entry point and it
routes in a fixed order ([`src/editor/event.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L25)):

1. Anything that is not a key-down returns `Idle` and is ignored; the window subscribes only to key-down
   in the first place ([`src/editor/event.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L26), [`src/editor/manifest.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/manifest.rs#L33)).
2. If a path prompt is open, the key goes to the prompt handler and nothing else runs
   ([`src/editor/event.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L29)); that mode is on the [file-io](/docs/userland/text-editor/file-io/) page.
3. A key with the Ctrl modifier goes to `on_ctrl` ([`src/editor/event.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L32)); the chords are on the
   [file-io](/docs/userland/text-editor/file-io/) page.
4. A navigation key (arrows, page, home, end) is claimed by `on_nav` ([`src/editor/event.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L36)).
5. Everything else is editing: Esc closes, Backspace deletes, Enter is a newline, and a printable code
   point is inserted ([`src/editor/event.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L39)).

The key constants are the app-skeleton codes shared with every capsule
([`userland/app_skeleton/src/input/keys.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/keys.rs), [`src/input/modifiers.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/modifiers.rs)). The return value is an
`EventOutcome` the runtime acts on: `Idle`, `Repaint`, or `Close`
([`userland/app_skeleton/src/app/event_outcome.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/app/event_outcome.rs#L19)).

## Keybindings

The complete set of keys the editor acts on, outside the path prompt. Editing and navigation:

| Key | Code | Action | Source |
|-----|------|--------|--------|
| Printable | `0x20..=0x10FFFF` | encode as UTF-8 and append at the end of the buffer | `event.rs:43`, `insert.rs:20` |
| Backspace | `0x08` | remove the last character, skipping UTF-8 continuation bytes | `event.rs:41`, `backspace.rs:20` |
| Enter | `0x0D` | append a newline | `event.rs:42`, `insert.rs:20` |
| Esc | `0x1B` | close the window (returns `Close`) | `event.rs:40` |
| Up | `0x1201` | scroll up one line | `on_nav.rs:28`, `scroll_up.rs:19` |
| Down | `0x1202` | scroll down one line, clamped to the last page | `on_nav.rs:29`, `scroll_down.rs:20` |
| Page Up | `0x1207` | scroll up one screen | `on_nav.rs:30`, `scroll_up.rs:19` |
| Page Down | `0x1208` | scroll down one screen, clamped | `on_nav.rs:31`, `scroll_down.rs:20` |
| Home | `0x1205` | jump to the top of the buffer | `on_nav.rs:32` |
| End | `0x1206` | jump to the last screen of the buffer | `on_nav.rs:33`, `follow_end.rs:21` |

Control chords (Ctrl+O, Ctrl+S, Ctrl+C, Ctrl+V) and the path-prompt keys are on the
[file-io](/docs/userland/text-editor/file-io/) page. There is deliberately no Left, Right, or Delete-at-cursor binding: the arrow
keys scroll the view, they do not move an edit position.

The key codes above are the app-skeleton constants ([`userland/app_skeleton/src/input/keys.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/keys.rs#L17),
`keys.rs:19`, `keys.rs:20`, `keys.rs:24`, `keys.rs:25`, `keys.rs:28`, `keys.rs:29`, `keys.rs:30`,
`keys.rs:31`); Ctrl is `MOD_CTRL = 1 << 1` ([`userland/app_skeleton/src/input/modifiers.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/modifiers.rs#L18)).

## The buffer model

The document is a single fixed array. `State` holds `buf: [u8; CAPACITY]` with `CAPACITY = 16384` and a
`len` marking how much is used; there is no `Vec`, no rope, and no gap buffer
([`src/editor/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L17), [`src/editor/state.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L27)). The caret is implicit at `len`.

Insert appends and is bounded. `State::insert` copies the bytes to `buf[len..len + n]` and advances `len`
only if `len + n <= CAPACITY`; when the buffer is full it returns `false` and drops the input with no
change, so no edit can overrun the array ([`src/editor/insert.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/insert.rs#L20)). A printable key is first encoded to
UTF-8 into a 4-byte scratch and the encoded bytes are what get inserted; a code point that does not decode
to a `char` is dropped ([`src/editor/event.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L43)).

Backspace is UTF-8 aware. `State::backspace` walks `len` backward and stops at the first byte that is not
a UTF-8 continuation byte (`b & 0b1100_0000 != 0b1000_0000`), so one press removes a whole multi-byte
character rather than half of one ([`src/editor/backspace.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/backspace.rs#L20)).

Any edit that changes the buffer sets the status line to `edited` and calls `follow_end` so the view
scrolls to the tail of the document; an edit that changed nothing (a full-buffer insert) leaves the view
and returns `Idle` ([`src/editor/event.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L52)).

## The scroll model

Scrolling is measured in wrapped visual lines, not raw newlines. `on_nav` claims the six view keys and
returns `Repaint`; any other key falls through to editing by returning `None`
([`src/editor/on_nav.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_nav.rs#L26)).

- `scroll_up` subtracts from `scroll_line` with a saturating subtract, so it cannot go below zero
  ([`src/editor/scroll_up.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/scroll_up.rs#L19)).
- `scroll_down` adds to `scroll_line` and then `clamp_scroll` pins it to the last page
  ([`src/editor/scroll_down.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/scroll_down.rs#L20), [`src/editor/clamp_scroll.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/clamp_scroll.rs#L21)).
- Page Up and Page Down move by `rows - 1` (at least one row), so a page overlaps the previous one by a
  line ([`src/editor/on_nav.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_nav.rs#L30)).
- Home sets `scroll_line = 0`; End calls `follow_end`, which sets `scroll_line` to the last scrollable
  line ([`src/editor/on_nav.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_nav.rs#L32), [`src/editor/follow_end.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/follow_end.rs#L21)).

The clamp math is shared. `visual_lines` counts wrapped lines by walking the text and breaking on `\n` or
when the column reaches `wrap_cols` ([`src/editor/visual_lines.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/visual_lines.rs#L17)). `max_scroll` is `total - rows`
saturating, the last line the view can rest on ([`src/editor/max_scroll.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/max_scroll.rs#L17)). `clamp_scroll` pins
`scroll_line` to that maximum every time it runs ([`src/editor/clamp_scroll.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/clamp_scroll.rs#L21)).

## Wrap and view geometry

Both the wrap width and the visible row count are derived from the live surface size on every paint, so a
resize reflows the text with no separate resize handler ([`src/editor/paint.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L27)).

- `wrap_cols(width)` is `(width - 2*TEXT_LEFT) / GLYPH_ADVANCE` clamped to `32..=160` columns
  ([`src/editor/layout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/layout.rs#L21)). The glyph advance is 9 px and the left margin is 16 px
  ([`src/editor/layout.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/layout.rs#L18), [`src/editor/layout.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/layout.rs#L20)).
- `visible_rows(height)` is `(height - FIRST_LINE_Y) / LINE_HEIGHT`, at least one, with the first text row
  at y 76 and a 20 px line height ([`src/editor/visible_rows.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/visible_rows.rs#L19), [`src/editor/layout.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/layout.rs#L17),
  [`src/editor/layout.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/layout.rs#L19)).

## Drawing a frame

`paint` runs once per repaint ([`src/editor/paint.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L26)):

1. Recompute `visible_rows` and `wrap_cols` from the surface, then clamp the scroll
   ([`src/editor/paint.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L27)).
2. Clear to the background colour and draw the header rows: the title `text_editor`, the current path,
   and the status line ([`src/editor/paint.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L30)). While a prompt is open a `_` is drawn after the path
   to mark the prompt edit point ([`src/editor/paint.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L33)).
3. Walk the buffer character by character, tracking `line` and `col`, breaking on `\n` or at `wrap_cols`,
   skipping lines above `scroll_line`, and stopping once past the visible window. Each visible ASCII
   character is drawn at its column and row; a non-ASCII character is drawn as `?`
   ([`src/editor/paint.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L37)).
4. Draw the caret. `end_position` computes the line and column of the buffer end over the same wrap rules,
   and if that position is in view a `_` is drawn there ([`src/editor/paint.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L61),
   [`src/editor/end_position.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/end_position.rs#L17)).

The colours are four constants: a dark background, a light foreground, a title tint, and a muted tint for
the path and status ([`src/editor/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/theme.rs#L17)). The renderer draws one glyph per cell through the
skeleton's `PaintBuffer::text`; there is no font shaping, no colour runs, and no styled text.

## Source map

```
  src/editor/event.rs         on_event: the key-down router (prompt / ctrl / nav / edit)
  src/editor/insert.rs        State::insert: bounded append to the buffer
  src/editor/backspace.rs     State::backspace: UTF-8-aware delete of the last character
  src/editor/on_nav.rs        arrow, page, home, end routing to the scroll helpers
  src/editor/scroll_up.rs     scroll up (saturating)
  src/editor/scroll_down.rs   scroll down (clamped)
  src/editor/clamp_scroll.rs  clamp the scroll line to the last page
  src/editor/max_scroll.rs    the last scrollable line
  src/editor/follow_end.rs    scroll to the end of the buffer
  src/editor/visual_lines.rs  count wrapped lines
  src/editor/end_position.rs  caret line and column at the buffer end
  src/editor/visible_rows.rs  visible rows from the window height
  src/editor/layout.rs        wrap columns and the glyph metrics
  src/editor/paint.rs         the frame renderer
  src/editor/theme.rs         the colour constants
  src/editor/state.rs         State: the fixed buffer, len, and scroll line
  userland/app_skeleton/src/input/keys.rs        the shared key codes
  userland/app_skeleton/src/input/modifiers.rs   MOD_CTRL
  userland/app_skeleton/src/app/event_outcome.rs the Idle / Repaint / Close outcome
```

Every reference above is verified against those trees.
