---
title: "Interface"
description: "This page mirrors src/pm/manifest.rs, src/pm/event.rs, and src/pm/paint.rs: the window the capsule asks for, the handful of actions a user can take, and the frame the renderer d..."
weight: 5
---
This page mirrors [`src/pm/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/manifest.rs), [`src/pm/event.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs), and [`src/pm/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs): the window the capsule
asks for, the handful of actions a user can take, and the frame the renderer draws. The rule that runs
through all three is that the process manager is an observer. Its input handling has no verb that acts on
a process, and its frame reports state rather than offering controls.

## The window

The manifest describes a 440x240 normal window titled `Process Manager`, placed at (744, 456)
([`src/pm/manifest.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/manifest.rs#L19), `manifest.rs:24`). The window id is `0x504D_4752` and the kind is
`WindowKind::Normal` (`manifest.rs:27`, `manifest.rs:28`).

The manifest also sets `input_kind_mask` to `INPUT_KEY_DOWN_BIT`, which is `1 << 0`
([`src/pm/manifest.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/manifest.rs#L22), `manifest.rs:33`). This is the window's input subscription, and it is a
separate value from the capability mask on the [README](/docs/userland/process-manager/): it selects which `InputKind` values
the compositor delivers, not what the capsule is allowed to do. The bit index matches
`InputKind::KeyDown = 0` ([`userland/app_skeleton/src/input/kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/kind.rs#L20)), so the window subscribes to
key-down events. Pointer button events still reach the handler through the skeleton runner, which the
event handling below relies on.

## User actions

Input arrives at `on_event` ([`src/pm/event.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L21)). There are exactly four things a user can do, and none
of them touches a process:

| Action | Effect | Handler |
|---|---|---|
| Press Escape | close the window | [`src/pm/event.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L29) |
| Press any other key | force an immediate refresh (re-resolve pids) and repaint | [`src/pm/event.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L32) |
| Click in the window | force an immediate refresh and repaint | [`src/pm/event.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L22) |
| Wait | the tick loop refreshes and re-samples on its own | [`src/pm/app.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/app.rs#L49) |

The handler order is: a `ButtonDown` refreshes and repaints and returns early ([`src/pm/event.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L22));
anything that is not a key-down is `Idle` (`event.rs:26`); a key-down of `KEY_ESC` closes (`event.rs:29`);
any other key-down refreshes and repaints (`event.rs:32`). A keypress and a mouse click do the same
thing, which is to trigger a fresh service lookup (the [sampling](/docs/userland/process-manager/sampling/) refresh) so the pid column
and the online flag catch up immediately instead of waiting for the next automatic refresh.

There is no scroll, no sort, and no select or kill. The list is a fixed eight rows that fit the window,
the order is the static `KNOWN` order from `state.rs`, and the capsule has no code path that signals or
terminates a process: there is no `kill` verb and no signalling syscall anywhere in the source. The
capsule cannot act on the processes it lists, only refresh what it reads about them.

## The frame

`paint` draws the whole surface each call ([`src/pm/paint.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L29)). It clears to the background colour, then
lays out a fixed frame:

- A title, `process_manager`, at the top left ([`src/pm/paint.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L31)).
- A header row of three columns, `name`, `pid`, and `caps`, in the warning colour (`paint.rs:32`,
  `paint.rs:33`, `paint.rs:34`).
- One row per monitored application, drawn from `state.rows` (`paint.rs:41`). Each row shows its label,
  and then either the resolved pid when online or the word `offline` when not (`paint.rs:42`, `paint.rs:45`,
  `paint.rs:48`); the `caps` column is always the literal `unavailable` (`paint.rs:46`, `paint.rs:49`).
- A sparkline per row and a percentage, described below (`paint.rs:51`, `paint.rs:52`).
- A status line near the bottom carrying `state.status` (`paint.rs:35`), and a `refreshes:` counter that
  prints `state.refreshes` as a decimal (`paint.rs:37`, `paint.rs:38`, `paint.rs:39`).

Rows are laid out from `y = 68` downward at an 18-pixel pitch ([`src/pm/paint.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L40), `paint.rs:55`), with
the `name`, `pid`, and `caps` columns at fixed x-offsets from `TEXT_LEFT = 16` (`paint.rs:24`, `paint.rs:42`,
`paint.rs:45`, `paint.rs:46`).

What each row's data means:

| Column | Content | Source |
|---|---|---|
| name | the application label | `paint.rs:42` |
| pid | the resolved pid, or `offline` if the name did not resolve | `paint.rs:45`, `paint.rs:48` |
| caps | always `unavailable`, because per-process capability reporting is not implemented | `paint.rs:46`, `paint.rs:49` |
| sparkline | a 30-sample bar chart of recent CPU share | `paint.rs:51`, `paint.rs:59` |
| percent | the newest CPU-share sample as a number | `paint.rs:52` |

## The sparkline

Each row's CPU history is drawn by `paint_spark` ([`src/pm/paint.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L59)). It walks the 30-slot circular
history in chronological order, starting at `head` so the oldest sample is leftmost, and draws one
one-pixel-wide bar per sample (`paint.rs:61`, `paint.rs:62`, `paint.rs:65`). A bar's height is the sample
percentage scaled into `SPARK_H = 12` pixels, with a floor of one pixel so a live-but-idle row still shows
a baseline (`paint.rs:63`). A zero sample draws in the muted colour, anything above zero in the foreground
colour (`paint.rs:64`). The bars grow upward from a common baseline (`paint.rs:60`, `paint.rs:65`).

The number beside the sparkline is the newest sample, read from the slot just behind `head`
([`src/pm/paint.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L52)), formatted as a decimal by the `u32_decimal` helper in [`src/pm/format.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/format.rs#L17) and
drawn at `PCT_X` (`paint.rs:53`, `paint.rs:54`). The colours (`BACKGROUND`, `FOREGROUND`, `WARNING`,
`MUTED`) are the four constants in [`src/pm/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/theme.rs#L17).

## The caps column is honest, not lazy

The `caps` column always reads `unavailable` because per-process capability reporting is not implemented
([`src/pm/paint.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L46), `paint.rs:49`). This is the one boundary the tool states about itself: the capsule
that decodes capability masks in this documentation cannot in fact show the mask of any process it lists.
It is a placeholder for a feature that does not exist yet, not a runtime failure.

## Source map

```
  userland/capsule_process_manager/src/pm/manifest.rs   the 440x240 window, id, and input_kind_mask
  userland/capsule_process_manager/src/pm/event.rs      the input handler (Esc close, key/click refresh)
  userland/capsule_process_manager/src/pm/paint.rs      the title, table, status, counter, sparkline
  userland/capsule_process_manager/src/pm/format.rs     the u32-to-decimal helper
  userland/capsule_process_manager/src/pm/theme.rs      the four palette colours
  userland/app_skeleton/src/input/kind.rs               the InputKind values behind the subscription bit
```

Every reference above is verified against those trees.
