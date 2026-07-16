---
title: "Settings input handling"
description: "This page mirrors src/settings/event/. Input in settings is a small tree of handlers. The window subscribes only to key-down, but the app also forwards pointer button-down event..."
weight: 4
---
This page mirrors `src/settings/event/`. Input in settings is a small tree of handlers. The window
subscribes only to key-down, but the app also forwards pointer button-down events, so `on_event` routes a
click to the pointer handler, drops anything that is not a key-down, then splits keyboard handling by
whether a string edit is in progress. Browsing keys move the cursor and change values; editing keys type
into a filtered buffer. A change that touches the store goes out through the [policy client](/docs/userland/settings/policy/) and
sets the status line; the model it drives is described in [panels.md](/docs/userland/settings/panels/).

## Event gate

`on_event` is the top of the tree ([`src/settings/event/on_event.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_event.rs#L25)):

| Event | Routed to | Source |
|---|---|---|
| ButtonDown | the pointer handler with the click coordinates | `on_event.rs:26` |
| not a key-down | ignored, returns Idle | `on_event.rs:29` |
| key-down while editing a string | the editing handler | `on_event.rs:32` |
| key-down otherwise | the browsing handler | `on_event.rs:35` |

The `editing` flag is the only thing that decides which keyboard handler runs, so the same key means
different things depending on whether a string field is open.

## Browsing keys

`on_event_browsing` owns navigation and value changes when no edit is active
([`src/settings/event/on_event_browsing.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_event_browsing.rs#L30)). Every arm returns `Repaint` except `Esc`, which closes the
window, and unmatched keys, which return `Idle`:

| Key | Action | Source |
|---|---|---|
| Up | move the cursor up one row | `on_event_browsing.rs:34`, [`state/cursor_up.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/cursor_up.rs) |
| Down | move the cursor down one row | `on_event_browsing.rs:35`, [`state/cursor_down.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/cursor_down.rs) |
| Left | decrement the current numeric or enum field | `on_event_browsing.rs:36`, [`event/adjust.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/adjust.rs#L24) |
| Right | increment the current numeric or enum field | `on_event_browsing.rs:37`, [`event/adjust.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/adjust.rs#L24) |
| Space or Enter | toggle a bool, cycle an enum, or open the string editor | `on_event_browsing.rs:38`, [`event/toggle_or_inc.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/toggle_or_inc.rs#L24) |
| Tab or `]` | switch to the next tab | `on_event_browsing.rs:33`, `:40`, [`event/next_category.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/next_category.rs) |
| `[` | switch to the previous tab | `on_event_browsing.rs:39`, [`event/prev_category.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/prev_category.rs) |
| Esc | close the window | `on_event_browsing.rs:32` |

Space and Enter both call `toggle_or_inc`, which branches on the current field's kind: a bool flips and
writes immediately, a string opens the inline editor, and anything else increments by one
([`src/settings/event/toggle_or_inc.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/toggle_or_inc.rs#L29)). Left and Right go through `adjust`, which dispatches to the u8
or i8 adjuster by kind and does nothing for a bool or string field
([`src/settings/event/adjust.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/adjust.rs#L29)). The u8 adjuster clamps to the field's max and the i8 adjuster clamps
to -12..=14 ([`src/settings/event/adjust_u8.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/adjust_u8.rs#L26), [`src/settings/event/adjust_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/adjust_i8.rs#L25)).

A bool change writes through `commit_bool`: it sends the `OP_SET`, and only on an `Ok` reply does it update
the cache and set the status to `updated`; a failed write goes to `report` and leaves the cache untouched
([`src/settings/event/commit_bool.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/commit_bool.rs#L27)). Numeric adjusters follow the same accept-then-store shape.

## Editing a string field

`on_event_editing` runs while a hostname or domain-name editor is open
([`src/settings/event/on_event_editing.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_event_editing.rs#L24)):

| Key | Action | Source |
|---|---|---|
| Printable `[A-Za-z0-9._-]` | append to the edit buffer | `on_event_editing.rs:38`, [`event/push_text_char.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/push_text_char.rs#L19) |
| Backspace | delete the last character | `on_event_editing.rs:34` |
| Enter | commit the edited string as an `OP_SET` write | `on_event_editing.rs:30`, [`event/commit_string.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/event/commit_string.rs#L24) |
| Esc | cancel the edit and discard the buffer | `on_event_editing.rs:26`, [`state/edit_cancel.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/edit_cancel.rs) |

`push_text_char` is the filter. It accepts only a printable byte in `0x20..=0x7E` that also passes the
`[A-Za-z0-9._-]` allow-list, and silently drops anything else ([`src/settings/event/push_text_char.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/push_text_char.rs#L23),
`:33`). This is the capsule's half of the hostname rule; the policy server re-validates the same set on the
write, so the two must agree (see [policy.md](/docs/userland/settings/policy/)). `commit_string` reads the buffer, sends the
`OP_SET`, and on success snapshots the bytes into the cache and shows `updated`; on failure it reports the
error and does not touch the cache ([`src/settings/event/commit_string.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/commit_string.rs#L24)).

## Pointer input

`on_pointer` handles a button-down at a pixel ([`src/settings/event/on_pointer.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_pointer.rs#L34)). A negative
coordinate is ignored (`on_pointer.rs:35`). A click in the tab band selects the tab under the pointer, with
the width split into thirds and clamped to the last tab (`on_pointer.rs:39`). A click outside the row body
does nothing (`on_pointer.rs:50`). Otherwise it maps the y offset to a row, rejects a click past the last
real row, selects that row, and then splits the value area: the left region (before the value column)
selects only, the next 96 pixels decrement, the right edge (past width minus 120) increments, and the
middle toggles or cycles (`on_pointer.rs:61`). The row bound uses `focused_count`, the same count the
renderer uses, so a click can only land on a row that is actually drawn.

## Status feedback

Every write path sets the status line. A success sets `updated` in the ok colour
([`src/settings/event/commit_bool.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/commit_bool.rs#L30)), and a failure goes through `report`, which maps each `IpcError`
to a fixed message: `policy timeout`, `ipc send failed`, `policy rejected`, `short reply`, `bad header`,
`kind mismatch`, or `policy service not registered` ([`src/settings/event/report.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/report.rs#L22)). The renderer
projects that line and its colour; see [rendering.md](/docs/userland/settings/rendering/).

## Source map

```
  src/settings/event/on_event.rs           top gate: pointer vs key, browsing vs editing
  src/settings/event/on_event_browsing.rs  navigation and value keys
  src/settings/event/on_event_editing.rs   string editor keys
  src/settings/event/on_pointer.rs         tab and row hit-testing, value-area split
  src/settings/event/toggle_or_inc.rs      Space/Enter: flip bool, open editor, or increment
  src/settings/event/adjust.rs             Left/Right dispatch to the u8/i8 adjuster
  src/settings/event/{adjust_u8,adjust_i8,clamp_u8}.rs   the clamped numeric adjusters
  src/settings/event/{commit_bool,commit_string}.rs      accept-then-store write paths
  src/settings/event/push_text_char.rs     the [A-Za-z0-9._-] editor filter
  src/settings/event/{next_category,prev_category}.rs    tab switching
  src/settings/event/report.rs             IpcError -> status message
  src/settings/state/{cursor_up,cursor_down,edit_cancel,edit_commit,edit_start}.rs  the model moves
```

Every reference above is verified against those trees.
