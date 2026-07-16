---
title: "Settings rendering"
description: "This page mirrors src/settings/paint/. Rendering is a pure projection: it reads the current State and draws a frame, and it never writes policy or mutates the model. Each pass i..."
weight: 3
---
This page mirrors `src/settings/paint/`. Rendering is a pure projection: it reads the current `State` and
draws a frame, and it never writes policy or mutates the model. Each pass is one file, and this page walks
them in the order `paint` calls them. The renderer is driven by the app-skeleton, which calls `paint`
whenever an event returns `Repaint`; for what produces those events see [input.md](/docs/userland/settings/input/), and for the
model it draws see [panels.md](/docs/userland/settings/panels/).

## The frame

`paint` is the top of the renderer ([`src/settings/paint/paint.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint.rs#L31)). It runs a fixed sequence:

| Step | What it draws | Source |
|---|---|---|
| Clear | fill the whole surface with the background colour | `paint.rs:32` |
| Header | the title band across the top | `paint.rs:33`, `paint_header.rs` |
| Tabs | the three tab buttons, the active one highlighted | `paint.rs:34`, `paint_tabs.rs:32` |
| Rows | the visible rows of the active category | `paint.rs:42`, `paint_field_row.rs:27` |
| Scroll indicator | a marker when the list is longer than the window | `paint.rs:47`, `scroll_indicator.rs` |
| Status bar | the hint, a result, or the unavailable line | `paint.rs:48`, `paint_status.rs:28` |

It resolves the active category's field slice through `visible_for`, reads the per-tab cursor and scroll
top, computes how many rows fit, and draws only that window of rows (`paint.rs:35`). Everything below
follows from those three inputs.

## Tabs

`paint_tabs` draws a fixed three-entry strip: `Display`, `Network`, `Security`, mapped to `Category::User`,
`Category::Identity`, and `Category::Kernel` ([`src/settings/paint/paint_tabs.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_tabs.rs#L25)). Each tab is a third
of the window width; the active one is drawn with the active background and foreground, the rest with the
inactive palette (`paint_tabs.rs:32`). This is the on-screen counterpart of the pointer hit-test in
[input.md](/docs/userland/settings/input/), which splits the same strip into thirds.

## Rows

`paint` walks the visible slice and calls `paint_field_row` for each, passing the absolute row index, the
y offset, and whether that row is under the cursor ([`src/settings/paint/paint.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint.rs#L42)). A row fills its
background (selected, or one of two alternating shades by parity), draws the field label from `label_of`
on the left, and hands the value area to `paint_field_value` ([`src/settings/paint/paint_field_row.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_field_row.rs#L35)).

`paint_field_value` is where the value renderer branches on kind ([`src/settings/paint/paint_field_value.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_field_value.rs#L34)):

| Kind | Rendered as | Source |
|---|---|---|
| `KIND_BOOL` | an on/off value | `paint_value_bool.rs` via `paint_field_value.rs:43` |
| `KIND_U8` with an enum table | `< Label >  [n/total]` | `paint_value_enum.rs:25` via `paint_field_value.rs:45` |
| `KIND_U8` without a table | a decimal against its max | `paint_value_u8.rs` via `paint_field_value.rs:46` |
| `KIND_I8` | a signed decimal | `paint_value_i8.rs` via `paint_field_value.rs:48` |
| `KIND_STR` | the string, with a caret when this row is being edited | `paint_value_str.rs` via `paint_field_value.rs:49` |

The enum-versus-decimal choice for a u8 field is made by asking the shared crate whether the field has an
`enum_table`, not by anything hard-coded in the renderer (`paint_field_value.rs:45`). The value it draws
comes from the cache via `cached_value`, so the renderer only ever shows a value the store returned
(`paint_field_value.rs:41`). The string renderer is told whether the row is selected and editing so it can
show the live edit buffer with a caret rather than the committed value (`paint_field_value.rs:52`).

## How many rows fit

`visible_rows` derives the row count from the window: body height is the window height minus the header,
tabs, and status bands, and the count is that divided by the row height ([`src/settings/paint/visible_rows.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/visible_rows.rs#L21)).
The same value bounds the pointer hit-test and the scroll clamp, so what the renderer draws and what a
click can land on always agree. The scroll indicator is drawn only when the field list is longer than the
visible window ([`src/settings/paint/scroll_indicator.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/scroll_indicator.rs)).

## The status bar

`paint_status` draws the bottom band and picks its text and colour in three cases
([`src/settings/paint/paint_status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_status.rs#L28)):

- Policy not ready: `policy unavailable; showing static defaults` in the error colour, drawn before any
  status is consulted (`paint_status.rs:31`).
- Ready with an empty status: the keybinding hint `[Tab] tabs  [Up/Down] move  [Left/Right] adjust
  [Enter] edit/toggle  [Esc] close` in the idle colour (`paint_status.rs:36`).
- Ready with a status set: the status text in green for a successful write, red for a rejected one, and
  the idle colour otherwise, chosen by the status kind (`paint_status.rs:40`).

The status text itself is set by the event layer (a successful write sets `updated`, a failed one sets an
error line via `report`); the renderer only projects it.

## Source map

```
  src/settings/paint/paint.rs             the frame sequence: clear, header, tabs, rows, scroll, status
  src/settings/paint/paint_header.rs      the title band
  src/settings/paint/paint_tabs.rs        the three-tab strip, active highlight
  src/settings/paint/paint_field_row.rs   one row: background, label, value area
  src/settings/paint/paint_field_value.rs branch on kind to the per-kind value renderer
  src/settings/paint/paint_value_{bool,enum,u8,i8,str}.rs   the per-kind value renderers
  src/settings/paint/field_{bool,u8,i8,str}_value.rs        pull the typed value out of the cache
  src/settings/paint/{fmt_dec,fmt_signed}.rs                decimal formatting for numeric values
  src/settings/paint/visible_rows.rs      rows that fit from the window height
  src/settings/paint/scroll_indicator.rs  the overflow marker
  src/settings/paint/paint_status.rs      the status band: unavailable, hint, or result
  src/settings/paint/layout.rs            the band and column offsets
  src/settings/theme.rs                   the palette
```

Every reference above is verified against those trees.
