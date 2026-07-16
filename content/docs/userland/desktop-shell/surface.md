---
title: "The User Surface"
description: "This page is the user reference: everything a person sees and touches on the shell."
weight: 1
---
This page is the user reference: everything a person sees and touches on the shell. It mirrors
`src/render/`, which turns the live state into overlay pixels, and [`src/server/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs), which is the
only path a pointer or touch takes into the shell. For the served operations that other capsules drive,
see [operations.md](/docs/userland/desktop-shell/operations/); for the state these draw from, see [state.md](/docs/userland/desktop-shell/state/); for the
identity and lifecycle, see the [README](/docs/userland/desktop-shell/).

The shell has no keyboard commands. Every user action is a pointer or touch gesture. Notifications, tray
icons, and the spotlight panel are driven by other capsules over the service port rather than by direct
clicks, and are covered on the [operations](/docs/userland/desktop-shell/operations/) page.

## The overlay

The chrome is drawn into one full-screen ARGB8888 overlay that the shell allocates during setup and
submits to the compositor as a scene at z-order 1, above every application window
([`src/setup/prime/register.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L25), [`src/setup/prime/register.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L57)). After that submission the shell
paints into the overlay's own backing memory and issues a compositor damage commit to have the changed
rectangle presented, exactly like any other client ([`src/render/chrome.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L32),
[`src/compositor_client/damage_commit.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/damage_commit.rs#L22)).

`paint_chrome` is the composite paint ([`src/render/chrome.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L32)). It clears the overlay, paints the menu
bar and its `NØNOS launcher` title, paints the dock and its entries only when the dock is visible, paints
the notification badge, and paints the spotlight rectangle only when the spotlight is visible
(`chrome.rs:33`, `chrome.rs:35`, `chrome.rs:36`, `chrome.rs:46`, `chrome.rs:47`). The three chrome
regions have fixed rectangles: the menu bar spans the full width at 28 pixels tall
([`src/render/layout.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/layout.rs#L20), `layout.rs:34`), the dock is a centered bar 64 pixels tall inset 24 pixels
from the bottom (`layout.rs:22`, `layout.rs:23`, `layout.rs:38`), and the spotlight is a centered
640x80 panel at the upper third of the screen (`layout.rs:46`).

## The launcher dock

The dock is the launcher. It shows a fixed set of nine apps ([`src/state/apps.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/apps.rs#L36)), each a label
paired with the service handle it focuses:

| Slot | Label | Service focused | Source |
|---|---|---|---|
| 1 | Terminal | `app.terminal` | `apps.rs:37` |
| 2 | Files | `app.file_manager` | `apps.rs:38` |
| 3 | Editor | `app.text_editor` | `apps.rs:39` |
| 4 | Settings | `app.settings` | `apps.rs:40` |
| 5 | Processes | `app.process_manager` | `apps.rs:41` |
| 6 | About | `app.about` | `apps.rs:46` |
| 7 | Calculator | `app.calculator` | `apps.rs:47` |
| 8 | Snake | `app.snake` | `apps.rs:52` |
| 9 | Wallet | `app.nonos_wallet` | `apps.rs:53` |

Each entry is 80 pixels wide with a 6-pixel gap, laid out left to right from a 12-pixel inset
([`src/render/bottom_taskbar.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/bottom_taskbar.rs#L28), `bottom_taskbar.rs:71`, [`src/render/layout.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/layout.rs#L24)). Every entry draws
its 28-pixel icon centered in the box (`bottom_taskbar.rs:22`, `bottom_taskbar.rs:68`); the icon bitmap
comes from `draw_app_icon`, which fills the icon background and dispatches on the `LauncherIcon` variant
to the per-app bitmap under `src/render/icons/` ([`src/render/icons.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/icons.rs#L35), `icons.rs:47`).

Each entry is tinted by its state (`bottom_taskbar.rs:34`):

- Active window: a lighter fill and a green underline (`bottom_taskbar.rs:35`, `bottom_taskbar.rs:55`).
- Launch pulse: a distinct tint for 900 ms after a launch click (`bottom_taskbar.rs:37`).
- Open: a dimmer tint plus a cyan underline while the app has a live window (`bottom_taskbar.rs:39`,
  `bottom_taskbar.rs:54`).
- Neither: the base tint (`bottom_taskbar.rs:41`).

The window manager drives the active and open state through its lifecycle notifications (see
[operations.md](/docs/userland/desktop-shell/operations/)), so the dock reflects what is really on screen, not just what was
clicked.

### Launching an app

A button-down or touch inside a dock entry runs `launcher_focus`, which hit-tests the pointer against
each entry's rectangle ([`src/server/input.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs#L62), [`src/server/handlers/launcher_focus.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/launcher_focus.rs#L24)). On a hit
it sends that app an `NCTL` focus-self control frame through `launcher_request`: magic `NCTL`, version 1,
op `FOCUS_SELF` = 1, sent to the target's pid after a service lookup
([`src/server/handlers/launcher_request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/launcher_request.rs#L22), `launcher_request.rs:24`, `launcher_request.rs:29`). On
success the shell marks the entry with a launch pulse for 900 ms and repaints
(`launcher_focus.rs:33`, [`src/state/taskbar/mark_launch.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/taskbar/mark_launch.rs#L21)).

An important honesty point: the dock does not spawn a process. Every desktop app is already running, so
clicking a dock entry only focuses it. If the target service is not registered, the lookup returns no pid
and nothing happens (`launcher_request.rs:36`).

### Revealing and hiding the dock

The dock auto-hides, and it only paints when it is visible ([`src/render/chrome.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L36)). When it is
hidden, moving the pointer into the bottom 4-pixel band of the screen reveals it
([`src/server/input.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs#L71), `HOVER_REVEAL_BAND` = 4, `input.rs:26`), and a touch or button-down within 18
pixels of the dock's top edge reveals it too (`input.rs:54`, `input.rs:56`). A reveal lasts 1800 ms
([`src/state/taskbar/reveal.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/taskbar/reveal.rs#L21)). When the dock is visible and the pointer moves above it while no
entry is open, it collapses again (`input.rs:81`, [`src/state/taskbar/collapse.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/taskbar/collapse.rs#L19)).

## Status indicators

The menu bar carries a right-aligned status area painted by `paint_status` ([`src/render/status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/status.rs#L28)).
Four segments are drawn in order, right-aligned with a 12-pixel pad and a two-glyph gap between them
(`status.rs:38`, `status.rs:24`, `status.rs:25`):

| Segment | Shows | Source |
|---|---|---|
| Battery | percentage `NN%`, or `AC` when no battery or the reading is out of `0..=100` | [`src/state/indicators/battery.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/battery.rs#L19) |
| Network | `NET` when the DHCP lease is bound, `OFF` otherwise | `status.rs:33`, [`src/state/indicators/net.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/net.rs#L28) |
| Date | `YYYY-MM-DD` from the RTC | [`src/state/indicators/clock.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/clock.rs#L40) |
| Time | `HH:MM` from the RTC, 12h or 24h per policy | [`src/state/indicators/clock.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/clock.rs#L19) |

The battery reads `mk_battery_status`; a value below 0 or above 100 renders as `AC`
(`battery.rs:20`, `battery.rs:21`). The network segment is `NET` only when the `net.dhcp.client` lease
status is at least `BOUND` (`net.rs:24`, `net.rs:25`, `net.rs:56`). The clock's 12h-versus-24h choice
comes from the `policy` service's `CLOCK_FORMAT24` field ([`src/state/indicators/policy.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/policy.rs#L24),
`clock.rs:24`); if either the date or time read fails, the segment falls back to `----------` or `--:--`
(`status.rs:35`, `status.rs:37`). The clock and indicators refresh once a second in the loop
([`src/server/runner/run.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L38), [`src/server/runner/refresh_clock.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/refresh_clock.rs#L24)). There are no click targets in
the status area; the indicators are display-only, and if the four segments would not fit the bar width
the whole status area is skipped (`status.rs:48`). The menu-bar title reads `NØNOS launcher`
(`chrome.rs:35`).

## The pointer input path

The shell subscribes to the input router and receives `NINP` frames on its inbox (magic `0x4E49_4E50`,
[`src/server/input.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs#L29)). `handle` rejects a short buffer or a wrong magic, reads the event kind at
offset 8 and the signed x and y at offsets 16 and 20, and drops any event with a negative coordinate
(`input.rs:29`, `input.rs:35`, `input.rs:38`, `input.rs:44`). A pointer-abs event only drives the
hover reveal or collapse; a touch or button-down either reveals the hidden dock or, when the dock is
already visible, runs the launcher hit-test (`input.rs:47`, `input.rs:51`, `input.rs:62`). The shell
subscribes to key-down, key-up, pointer-abs, wheel, button-down, button-up, and touch, but only the
pointer-abs, touch, and button-down kinds change anything ([`src/setup/prime/run/input_mask.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/input_mask.rs#L25)).

## How a frame reaches the screen

Every visible change follows the same shape: mutate state, call `paint_chrome`, then damage-commit the
one rectangle that changed so the compositor presents it. The dock uses the dock rectangle
([`src/server/refresh_taskbar.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/refresh_taskbar.rs#L23)), the menu bar handlers use the menu-bar rectangle (for example
[`src/server/handlers/notify.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/notify.rs#L50)), the spotlight uses the spotlight rectangle
([`src/server/handlers/spotlight_open.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/spotlight_open.rs#L26)), and the once-a-second clock refresh commits the full
screen ([`src/server/runner/refresh_clock.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/refresh_clock.rs#L36)). The shell never presents a frame itself; the
compositor does, on receipt of the damage commit ([`src/compositor_client/damage_commit.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/damage_commit.rs#L35)).

## Source map

```
  src/render/chrome.rs             the composite paint (menu bar, dock, badge, spotlight)
  src/render/layout.rs             the menu-bar, dock, and spotlight rectangles and dimensions
  src/render/bottom_taskbar.rs     the dock entries, their tints, and the underline indicators
  src/render/status.rs             the four right-aligned status segments and their layout
  src/render/icons.rs              draw_app_icon: per-app icon dispatch into src/render/icons/
  src/state/apps.rs                LAUNCHER_APPS: the nine dock entries
  src/state/indicators/            battery, net, clock, policy status sources
  src/server/input.rs              NINP decode, hover reveal, dock collapse, launch click
  src/server/refresh_taskbar.rs    repaint + dock-rectangle damage commit
  src/state/taskbar/reveal.rs      1800 ms reveal; mark_launch.rs the 900 ms pulse; collapse.rs hide
  src/compositor_client/damage_commit.rs  the present call
```

Every reference above is verified against those trees.
