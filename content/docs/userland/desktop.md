---
title: "Desktop Stack"
description: "This page describes the userland GUI stack: compositor, WM, inputrouter, and desktopshell."
weight: 10
---
This page describes the userland GUI stack: compositor, WM, input_router, and
desktop_shell. Read [Userland Model](/docs/userland/), then
[Graphics](/docs/subsystems/graphics/) and [Input](/docs/subsystems/input/).

Audit the desktop in two passes: first follow drawing into the compositor, then
follow input through the router and WM. Keeping those paths separate makes GUI
failures much easier to isolate.

---

## 1. Boot shape

The desktop fleet spawns GUI core first, then WM, wallpaper catalog, wallpaper,
desktop shell, and desktop services ([`src/userspace/init/spawn_plan/desktop_fleet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L17)).
GUI core is only input_router and compositor ([`src/userspace/init/spawn_plan/desktop_fleet.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L26)).

```
  +-----------------+
  | input drivers   |
  | PS/2, USB HID   |
  +--------+--------+
           |
           | mk_input_event_post
  +--------+--------+       +-----------------+
  | input_router    |-------| wm              |
  | drain and route |       | focus, geometry |
  +--------+--------+       +--------+--------+
           |                         |
           | IPC delivery            | window ops
  +--------+--------+       +--------+--------+
  | apps and shell  |-------| compositor      |
  | event handlers  | scene | scene, scanout  |
  +-----------------+       +-----------------+
```

```
+--------------------------+
| render plane             |
+------------+-------------+
             |
+------------+-------------+
| app or shell surface     |
+------------+-------------+
             |
+------------+-------------+
| compositor scene table   |
+------------+-------------+
             |
+------------+-------------+
| damage and scanout       |
+--------------------------+
```

```
+--------------------------+
| input plane              |
+------------+-------------+
             |
+------------+-------------+
| kernel input ring        |
+------------+-------------+
             |
+------------+-------------+
| input_router routing     |
+------------+-------------+
             |
+------------+-------------+
| WM focus topmost query   |
+------------+-------------+
             |
+------------+-------------+
| shell or app delivery    |
+--------------------------+
```

## 2. Compositor

The compositor is a no_std service capsule. It initializes heap, waits for setup,
registers service name `compositor` on port `4310`, and enters `server::run`
([`userland/compositor/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/main.rs#L31)). Its context owns the graphics port,
resource id, display dimensions, backing memory, scene table, damage
accumulator, focus table, cursor tracker, and attach cache
([`userland/compositor/src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/state/context.rs#L19)).

The compositor protocol exposes healthcheck, scene submit, damage commit, focus
set, input subscribe, cursor update, scene remove, and display info
([`userland/compositor/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/protocol/ops.rs#L17)). The dispatcher maps those ops to
handlers and rejects bad or malformed ops with protocol errors
([`userland/compositor/src/server/runner/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L24)).

The compositor loop drains IPC, ticks frame pacing, records the first scanout
error once, then waits for vsync or yields ([`userland/compositor/src/server/runner/entry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/entry.rs#L23)).

## 3. Window manager

The WM starts after heap init and setup, then enters its server loop
([`userland/capsule_wm/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/main.rs#L35)). Setup resolves the compositor port,
probes compositor health, queries display info, and constructs WM state
([`userland/capsule_wm/src/setup/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/setup/run.rs#L36)). That state holds compositor port,
display size, window table, focus model, z stack, lifecycle subscriptions, and
next request id ([`userland/capsule_wm/src/state/context.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/state/context.rs#L22)).

The WM protocol exposes window open, close, move, resize, focus, raise,
minimize, restore, topmost query, route focus, focus query, and lifecycle
subscribe ([`userland/capsule_wm/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/protocol/ops.rs#L17)). The server loop
periodically sweeps dead windows, receives IPC with sender pid, parses a
request, and dispatches it ([`userland/capsule_wm/src/server/runner/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/run.rs#L28)).

## 4. Input router

input_router starts as a no_std service and calls `server::run` after heap init
([`userland/capsule_input_router/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/main.rs#L31)). Its context owns subscription
state, grabs, cursor state, compositor port, WM port, shell pid, request ids,
and delivery counters ([`userland/capsule_input_router/src/state/context/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/context/types.rs#L19)).

The router loop drains IPC, purges dead subscribers periodically, drains up to
32 input events from the kernel ring, routes each event, and waits up to 20 ms
when no events are available ([`userland/capsule_input_router/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L30)).
The kernel ring source is `mk_input_event_drain`
([`userland/capsule_input_router/src/sources/kernel_ring.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L17)).

Keyboard routing asks WM for the focused pid. If WM returns no focus, the router
falls back to the desktop shell pid, checks the subscription mask, delivers one
event, and forgets a dead target ([`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25)).
Pointer routing refreshes display bounds, applies the event to cursor state,
mirrors pointer events to shell, asks WM for the topmost target, and routes to
shell or window based on that target ([`userland/capsule_input_router/src/route/pointer/route_pointer.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L28)).

## 5. Desktop shell

desktop_shell is a no_std capsule that initializes heap, waits for setup, then
enters its server loop ([`userland/capsule_desktop_shell/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/main.rs#L36)). Setup
resolves peers, healthchecks them, applies wallpaper policy, allocates overlay
backing, paints chrome, opens chrome windows, subscribes to WM lifecycle,
registers the overlay, commits it, and subscribes for input
([`userland/capsule_desktop_shell/src/setup/prime/run/run.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/setup/prime/run/run.rs#L21)).

The shell input mask includes key down, key up, absolute pointer, wheel, button
down, button up, and touch bits ([`userland/capsule_desktop_shell/src/setup/prime/run/input_mask.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/setup/prime/run/input_mask.rs#L17)).
The shell server paints initial chrome, drains IPC, refreshes the clock on its
interval, and waits for display vsync each loop
([`userland/capsule_desktop_shell/src/server/runner/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/runner/run.rs#L27)).
