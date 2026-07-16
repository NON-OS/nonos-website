---
title: "GUI Contracts"
description: "This page documents the concrete GUI behavior implemented by the userland desktop stack: boot order, deterministic app window requests, non-overlap rules, on-demand app launch, ..."
weight: 12
---
This page documents the concrete GUI behavior implemented by the userland
desktop stack: boot order, deterministic app window requests, non-overlap
rules, on-demand app launch, move and resize validation, close teardown,
focus, cursor state, and keyboard and pointer delivery. Read [Desktop](/docs/userland/desktop/),
[Applications](/docs/userland/apps/), and [Capsule Inventory](/docs/userland/capsules/) first.

---

## 1. Runtime shape

The default desktop boot path starts GUI core, then WM, wallpaper catalog,
wallpaper, desktop shell, and desktop services
([`src/userspace/init/spawn_plan/desktop_fleet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L17)). GUI core is input router
and compositor ([`src/userspace/init/spawn_plan/desktop_fleet.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L26)). The init
entry path calls desktop and market after network, then spawns the app fleet
through `spawn_apps` ([`src/userspace/init/entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L31),
[`src/userspace/init/entry.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L32), [`src/userspace/init/entry.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L33)). `spawn_apps`
is exported from `app_orchestrator` and wired into `run_init`, so the apps come
up at boot ([`src/userspace/init/spawn_plan/mod.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/mod.rs#L38),
[`src/userspace/init/spawn_plan/apps.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L17)). There is no launcher broker: the
residual init loop only ticks lifecycle and yields, and does not drain any
launcher inbox ([`src/userspace/init/supervisor/loop_impl.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L31),
[`src/userspace/init/supervisor/loop_impl.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L40)).

```
  +----------------+
  | app manifest   |
  | id x y w h     |
  +-------+--------+
          |
  +-------+--------+
  | wm             |
  | place focus    |
  | move resize    |
  +-------+--------+
          |
  +-------+--------+
  | compositor     |
  | scene cursor   |
  +-------+--------+
          |
  +-------+--------+
  | input_router   |
  | key pointer    |
  +----------------+
```

## 2. App launch

Desktop launcher entries carry an icon, a visible label, and a service name
([`userland/capsule_desktop_shell/src/state/apps.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/apps.rs#L30),
[`userland/capsule_desktop_shell/src/state/apps.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/apps.rs#L36)). The apps are already
running from boot, so a launcher click does not launch anything. The request
looks up the app's service pid; if the app is alive it sends that pid an
eight-byte `NCTL` focus control frame, and if the lookup fails it returns false
and does nothing ([`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L26),
[`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L32),
[`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L42)).

The app skeleton accepts that `NCTL` frame only from the `desktop_shell` pid, so
the shell can focus an already-running app but cannot mint a new process
([`userland/app_skeleton/src/runner/control.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/control.rs#L42),
[`userland/app_skeleton/src/runner/control.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/control.rs#L67)). Spawn authority stays entirely
in init behind verification; there is no launch broker and no allowlisted
runtime spawner in the shell path.

```
  +------------------+
  | desktop_shell    |
  | launcher click   |
  +--------+---------+
           |
  +--------+---------+
  | service lookup   |
  +---+----------+---+
      |          |
      | pid      | no pid
      |          |
  +---+---+  +---+------+
  | NCTL  |  | ignored  |
  | focus |  |          |
  +-------+  +----------+
```

## 3. Window open

Apps using `nonos_app_skeleton` send the manifest window id, kind, requested
initial position, requested width, and requested height to `wm::window_open`
([`userland/app_skeleton/src/setup/announce.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/announce.rs#L33)). The manifest fields are
compiled into each app and include title, window id, kind, initial x and y,
width, height, and input mask ([`userland/app_skeleton/src/app/manifest.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/app/manifest.rs#L20)).
The current app manifest values are listed in [Applications](/docs/userland/apps/).

The WM open path clamps the requested rectangle to the display
([`userland/capsule_wm/src/server/handlers/window_open/place.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/place.rs#L25)). If the
window kind is not normal, or the requested rectangle does not collide, the WM
returns the requested rectangle after clamping
([`userland/capsule_wm/src/server/handlers/window_open/place.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/place.rs#L27)). For normal
windows that collide, the WM scans candidate slots using placement constants
and returns the first non-colliding rectangle
([`userland/capsule_wm/src/server/handlers/window_open/place.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/place.rs#L30)). Collision
checks only consider visible normal windows
([`userland/capsule_wm/src/server/handlers/window_open/collides.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/collides.rs#L21)).

```
+--------------------------+
| app manifest request     |
+------------+-------------+
             |
+------------+-------------+
| wm window open           |
| clamp to display         |
+------------+-------------+
             |
+------------+-------------+
| normal collision check   |
+------------+-------------+
             |
+------------+-------------+
| requested or slot rect   |
| owner focus z state      |
+--------------------------+
```

## 4. Move and resize

Window move validates request length, window id, x, and y, looks up the
sender-owned window, clamps the candidate rectangle to the display, rejects the
move if a normal window would overlap another visible normal window, then
stores the new rectangle ([`userland/capsule_wm/src/server/handlers/window_move.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L23),
[`userland/capsule_wm/src/server/handlers/window_move.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L42),
[`userland/capsule_wm/src/server/handlers/window_move.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L47),
[`userland/capsule_wm/src/server/handlers/window_move.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L48),
[`userland/capsule_wm/src/server/handlers/window_move.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L62)).

Window resize validates request length, id, width, and height, rejects zero
width or height, clamps the candidate rectangle to display bounds, rejects a
normal-window collision, and stores the new rectangle on success
([`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L24),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L45),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L49),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L51),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L59)).

The shared resize collision rule ignores the window being changed and rejects
overlap with visible normal windows
([`userland/capsule_wm/src/server/handlers/window_resize/collides.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/collides.rs#L20)).

```
+--------------------------+
| move or resize request   |
+------------+-------------+
             |
+------------+-------------+
| validate sender window   |
| decode geometry          |
+------------+-------------+
             |
+------------+-------------+
| clamp candidate rect     |
+------------+-------------+
             |
+------------+-------------+
| reject normal collision  |
+------------+-------------+
             |
+------------+-------------+
| store rect or fail       |
+--------------------------+
```

## 5. Close and teardown

The app skeleton maps a button-down event on the toolkit close button to
`EventOutcome::Close` ([`userland/app_skeleton/src/runner/decorations.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/decorations.rs#L28)).
When the service frame sees a close result, it calls teardown
([`userland/app_skeleton/src/runner/service_frame.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/service_frame.rs#L47)). Teardown removes the
compositor scene, clears the input subscription, releases the shared surface,
unmaps the backing memory, sends `window_close` to the WM, and exits
([`userland/app_skeleton/src/runner/teardown.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L25)).

The WM close handler validates the request, clears compositor focus if the
closed window was focused, removes the window from the table, broadcasts a
closed lifecycle notification, and replies success
([`userland/capsule_wm/src/server/handlers/window_close.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L22),
[`userland/capsule_wm/src/server/handlers/window_close.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L41),
[`userland/capsule_wm/src/server/handlers/window_close.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L58),
[`userland/capsule_wm/src/server/handlers/window_close.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L64)).

```
+--------------------------+
| close result in app      |
+------------+-------------+
             |
+------------+-------------+
| scene remove             |
| input unsubscribe        |
+------------+-------------+
             |
+------------+-------------+
| release surface backing  |
+------------+-------------+
             |
+------------+-------------+
| wm window close          |
+------------+-------------+
             |
+------------+-------------+
| clear focus if needed    |
| lifecycle notification   |
+--------------------------+
```

## 6. Focus

Button-down inside an app asks the WM to raise and focus that app window
([`userland/app_skeleton/src/runner/click_focus.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/click_focus.rs#L20)). The app skeleton also
accepts a desktop-shell control frame for focusing itself, but only if the
sender pid resolves to `desktop_shell`
([`userland/app_skeleton/src/runner/control.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/control.rs#L42),
[`userland/app_skeleton/src/runner/control.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/control.rs#L67)). Keyboard routing asks the
WM for the focused pid and falls back to the shell pid when there is no focus
([`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25)).

```
+--------------------------+
| button down or NCTL      |
+------------+-------------+
             |
+------------+-------------+
| wm raise focus           |
+------------+-------------+
             |
+------------+-------------+
| compositor focus state   |
+------------+-------------+
             |
+------------+-------------+
| keyboard route query     |
+------------+-------------+
             |
+------------+-------------+
| focused pid or shell     |
+--------------------------+
```

## 7. Cursor and pointer delivery

The compositor context owns a cursor tracker alongside scene, damage, focus,
and attach state ([`userland/compositor/src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/state/context.rs#L19)). The input
router context owns subscription state, grab state, cursor state, compositor
port, WM port, shell pid, request id, and delivery counters
([`userland/capsule_input_router/src/state/context/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/context/types.rs#L19)).

The input router loop drains IPC, periodically purges dead subscribers, drains
a batch from the kernel input ring, routes each event, and waits on the kernel
input sequence when no event is available
([`userland/capsule_input_router/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L30)). Pointer routing
refreshes display bounds, applies the event to cursor state, mirrors pointer
events to the shell, asks for the topmost target, and routes to shell or the
target window ([`userland/capsule_input_router/src/route/pointer/route_pointer.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L28)).

Keyboard routing issues a WM focus query, checks that the destination
subscription allows the event kind, delivers one event, forgets a dead target,
and records delivery count ([`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25)).

```
+--------------------------+
| kernel input ring        |
+------------+-------------+
             |
+------------+-------------+
| input router batch       |
+------------+-------------+
             |
+------------+-------------+
| cursor state update      |
| shell mirror             |
+------------+-------------+
             |
+------------+-------------+
| wm topmost or focus      |
+------------+-------------+
             |
+------------+-------------+
| NINP delivery            |
+--------------------------+
```

## 8. App-side delivery contract

The app skeleton parses input deliveries with the `NINP` magic and a fixed
delivery length before converting bytes to an `InputEvent`
([`userland/app_skeleton/src/runner/dispatch.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/dispatch.rs#L20)). Each service frame
refreshes input subscription, ensures the first frame has been submitted,
drains IPC, handles close, repaints when requested, and waits for display vsync
([`userland/app_skeleton/src/runner/service_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/service_frame.rs#L28)). This means input,
paint, close, and teardown are part of the shared app runtime, not duplicated
inside each app capsule.

```
+--------------------------+
| NINP frame               |
+------------+-------------+
             |
+------------+-------------+
| parse delivery           |
| normalize event          |
+------------+-------------+
             |
+------------+-------------+
| app on event             |
+------------+-------------+
             |
+------------+-------------+
| repaint close or idle    |
+--------------------------+
```
