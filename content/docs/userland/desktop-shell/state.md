---
title: "The Live State"
description: "This page mirrors src/state/: the Context that holds the whole live model, the launcher app list, the taskbar open and pulse and visibility state, the owner-scoped tray table, t..."
weight: 4
---
This page mirrors `src/state/`: the `Context` that holds the whole live model, the launcher app list, the
taskbar open and pulse and visibility state, the owner-scoped tray table, the toast queue, the spotlight
flag, and the indicator data sources. The [operations](/docs/userland/desktop-shell/operations/) handlers and the
[surface](/docs/userland/desktop-shell/surface/) renderer both read and write this state; the [clients](/docs/userland/desktop-shell/clients/) fill the parts
that come from other services.

## The Context

The `Context` is the whole live state, threaded through every handler as `&mut`
([`src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context.rs#L19)):

| Field | Holds | Source |
|---|---|---|
| `compositor_port`, `wm_port`, `input_router_port`, `policy_port` | the resolved peer ports | `context.rs:20`, `context.rs:38` |
| `input_kind_mask` | the input subscription mask | `context.rs:23` |
| `input_ready`, `wm_notify_ready` | whether the two subscriptions succeeded | `context.rs:24`, `context.rs:25` |
| `width`, `height`, `stride`, `backing_va` | the overlay geometry and backing address | `context.rs:26`, `context.rs:29` |
| `tray` | the 32-slot tray table | `context.rs:30` |
| `taskbar` | the dock open/pulse/active/visible state | `context.rs:31` |
| `spotlight` | the spotlight visibility flag | `context.rs:32` |
| `last_notify_level`, `toasts`, `toast_layer_live` | the toast queue and its layer flag | `context.rs:33`, `context.rs:34`, `context.rs:35` |
| `net_was_online`, `clock_24h` | the cached network and clock-format state | `context.rs:36`, `context.rs:37` |
| `next_request_id` | a monotonically increasing request-id counter | `context.rs:39` |

`issue_request_id` returns the current id and advances the counter, wrapping past zero so an id is never
0 (`context.rs:43`, `context.rs:45`).

## The launcher apps

`LAUNCHER_APPS` is a fixed array of nine `LauncherApp`, each an icon variant, a label, and the `app.*`
service handle it focuses ([`src/state/apps.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/apps.rs#L30), `apps.rs:36`). The nine entries and their handles are
tabulated on the [surface](/docs/userland/desktop-shell/surface/) page. The array length is the single source of truth for the dock
size: the taskbar arrays, the dock width, and the hit-test all derive from `LAUNCHER_APPS.len()`
([`src/state/taskbar/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/taskbar/types.rs#L17), [`src/render/layout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/layout.rs#L21)).

## The taskbar

`TaskbarState` tracks per-entry open flags and launch-pulse deadlines, both arrays sized to the app
count, plus a reveal deadline, an active index, and a visibility flag
([`src/state/taskbar/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/taskbar/types.rs#L20)). `active` is a `u8` where `0xFF` means no active entry
(`types.rs:18`). The state transitions live one per file under `src/state/taskbar/`:

- `reveal_taskbar` sets `visible` and a reveal deadline 1800 ms out (`reveal.rs:19`).
- `collapse_taskbar` clears `visible` and the reveal deadline (`collapse.rs:19`).
- `mark_taskbar_launch` sets a 900 ms pulse deadline for one entry and reveals the dock
  (`mark_launch.rs:19`).
- `set_taskbar_open` flips one entry's open flag from a wm lifecycle event (`set_open.rs`).
- `expire_taskbar_pulses` clears elapsed pulse deadlines, and `expire_taskbar_visibility` hides the dock
  once its reveal deadline passes; each reports whether it changed anything so the loop knows to repaint
  (`expire_pulses.rs`, `expire_visibility.rs`).

## The tray table

The tray is a fixed array of 32 owner-tagged slots ([`src/state/tray/entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/tray/entry.rs#L19),
[`src/state/tray/table.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/tray/table.rs#L20)). Each `TrayEntry` carries the owner pid, the tray id, a label length, up to
24 label bytes, and an `in_use` flag (`entry.rs:22`, [`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20)). `insert` rejects a
duplicate `(owner_pid, tray_id)` and fills the first free slot or returns an error when full
(`table.rs:36`, `table.rs:40`, `table.rs:46`). `find` and `find_mut` match on the owner pid and tray id,
and `remove` clears the matching slot (`table.rs:48`, `table.rs:51`, `table.rs:56`). Because every lookup
carries the owner pid, one capsule can never read or overwrite another's entry, which is what makes the
tray ops owner-scoped.

## The toast queue

`ToastQueue` holds up to 3 live toasts, each truncated to 48 bytes with a 4-second lifetime
([`src/state/toasts.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/toasts.rs#L19), `toasts.rs:20`, `toasts.rs:21`). `push` truncates the text, fills the first
empty slot, or rotates the oldest out when the queue is full (`toasts.rs:40`, `toasts.rs:48`,
`toasts.rs:52`). `expire` clears any toast past its deadline and reports whether it changed anything
(`toasts.rs:56`). A `NotifyLevel` is Info, Warn, or Error, each with its own tint
([`src/state/notify.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/notify.rs#L19), `notify.rs:35`).

## The spotlight

`SpotlightState` is a single visibility flag, toggled by the spotlight op and painted as a rectangle
when set ([`src/state/spotlight.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/spotlight.rs#L20), `spotlight.rs:25`). Its 640x80 dimensions live beside it and feed
the layout (`spotlight.rs:17`, [`src/render/layout.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/layout.rs#L46)).

## The indicator sources

The four status indicators read their values live rather than caching them in the `Context`:

- `battery::label` reads `mk_battery_status` and formats `NN%` or `AC` ([`src/state/indicators/battery.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/battery.rs#L19)).
- `net::online` calls the DHCP client and returns true only for a bound lease
  ([`src/state/indicators/net.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/net.rs#L28)).
- `clock::hhmm` and `clock::ymd` read the RTC and format the time and date, with the 12h/24h choice passed
  in ([`src/state/indicators/clock.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/clock.rs#L19), `clock.rs:40`).
- `policy::clock_24h` reads the policy service's clock-format field and caches the port in the `Context`
  ([`src/state/indicators/policy.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/policy.rs#L29)).

The once-a-second refresh reads policy and network, updates `clock_24h` and `net_was_online`, raises the
first `network connected` toast, and repaints ([`src/server/runner/refresh_clock.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/refresh_clock.rs#L24),
`refresh_clock.rs:29`, `refresh_clock.rs:32`).

## Source map

```
  src/state/context.rs          Context: ports, overlay geometry, tray, taskbar, toasts, request-id counter
  src/state/apps.rs             LAUNCHER_APPS: the nine dock entries; the single source of dock size
  src/state/taskbar/types.rs    TaskbarState and the app-count-sized arrays
  src/state/taskbar/            reveal, collapse, mark_launch, set_open, expire_pulses, expire_visibility
  src/state/tray/entry.rs       TrayEntry and the 32-slot bound
  src/state/tray/table.rs       insert/find/find_mut/remove, all owner-scoped
  src/state/toasts.rs           the 3-slot toast queue, 48-byte text, 4 s lifetime
  src/state/notify.rs           NotifyLevel Info/Warn/Error and tints
  src/state/spotlight.rs        the visibility flag and 640x80 dimensions
  src/state/indicators/         battery, net, clock, policy data sources
```

Every reference above is verified against those trees.
