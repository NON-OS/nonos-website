---
title: "Desktop Service Capsules"
description: "This page documents the desktop service capsules below the application layer: compositor, WM, input router, desktop shell, wallpaper, wallpaper catalog, image codec, clipboard, ..."
weight: 11
---
This page documents the desktop service capsules below the application layer:
compositor, WM, input router, desktop shell, wallpaper, wallpaper catalog, image
codec, clipboard, login, and toolkit. Read [Desktop](/docs/userland/desktop/),
[GUI Contracts](/docs/userland/gui-contracts/), and [Applications](/docs/userland/apps/) first.

The desktop is not one process. It is a set of small services with separate
state tables and protocol routers. Debug it by following the service that owns
the state you are observing.

---

## 1. Service Split

The compositor owns scenes, damage, focus, cursor, display, and surface attach
state. Its dispatcher accepts healthcheck, scene submit, scene remove, damage
commit, focus set, cursor update, input subscribe, and display info
([`userland/compositor/src/server/runner/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L24),
[`userland/compositor/src/server/runner/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L31),
[`userland/compositor/src/server/runner/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L32),
[`userland/compositor/src/server/runner/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L33),
[`userland/compositor/src/server/runner/dispatch.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L34),
[`userland/compositor/src/server/runner/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L35),
[`userland/compositor/src/server/runner/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L36),
[`userland/compositor/src/server/runner/dispatch.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L37),
[`userland/compositor/src/server/runner/dispatch.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L38),
[`userland/compositor/src/server/runner/dispatch.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L41)).

The WM owns window lifecycle, geometry, focus, z-order, and lifecycle
subscriptions. Its dispatcher accepts window open, close, move, resize, focus,
raise, minimize, restore, topmost query, focus query, route focus, and lifecycle
subscribe ([`userland/capsule_wm/src/server/runner/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L25),
[`userland/capsule_wm/src/server/runner/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L32),
[`userland/capsule_wm/src/server/runner/dispatch.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L34),
[`userland/capsule_wm/src/server/runner/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L35),
[`userland/capsule_wm/src/server/runner/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L36),
[`userland/capsule_wm/src/server/runner/dispatch.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L37),
[`userland/capsule_wm/src/server/runner/dispatch.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L38),
[`userland/capsule_wm/src/server/runner/dispatch.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L39),
[`userland/capsule_wm/src/server/runner/dispatch.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L40),
[`userland/capsule_wm/src/server/runner/dispatch.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L41),
[`userland/capsule_wm/src/server/runner/dispatch.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L42),
[`userland/capsule_wm/src/server/runner/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L43),
[`userland/capsule_wm/src/server/runner/dispatch.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L46),
[`userland/capsule_wm/src/server/runner/dispatch.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L47)).

The input router owns subscriptions, grabs, cursor routing, and delivery. Its
IPC drain path handles healthcheck, subscribe, grab request, and grab release
([`userland/capsule_input_router/src/server/drain_ipc.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L28),
[`userland/capsule_input_router/src/server/drain_ipc.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L44),
[`userland/capsule_input_router/src/server/drain_ipc.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L45),
[`userland/capsule_input_router/src/server/drain_ipc.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L46),
[`userland/capsule_input_router/src/server/drain_ipc.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L47),
[`userland/capsule_input_router/src/server/drain_ipc.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L48)).

```
+--------------------------+
| compositor               |
| pixels scenes damage     |
+------------+-------------+
             |
+------------+-------------+
| wm                       |
| windows focus geometry   |
+------------+-------------+
             |
+------------+-------------+
| input router             |
| subscriptions delivery   |
+------------+-------------+
             |
+------------+-------------+
| desktop shell and apps   |
+--------------------------+
```

## 2. Shell and Session Services

Desktop shell owns ports to compositor, WM, and input router, the input mask,
display geometry, overlay backing, pointer state, tray table, spotlight state,
notification level, and request ids ([`userland/capsule_desktop_shell/src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L19),
[`userland/capsule_desktop_shell/src/state/context.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L20),
[`userland/capsule_desktop_shell/src/state/context.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L21),
[`userland/capsule_desktop_shell/src/state/context.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L22),
[`userland/capsule_desktop_shell/src/state/context.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L23),
[`userland/capsule_desktop_shell/src/state/context.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L24),
[`userland/capsule_desktop_shell/src/state/context.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L25),
[`userland/capsule_desktop_shell/src/state/context.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L26),
[`userland/capsule_desktop_shell/src/state/context.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L27),
[`userland/capsule_desktop_shell/src/state/context.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L28),
[`userland/capsule_desktop_shell/src/state/context.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L29),
[`userland/capsule_desktop_shell/src/state/context.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L30),
[`userland/capsule_desktop_shell/src/state/context.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L31),
[`userland/capsule_desktop_shell/src/state/context.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L32),
[`userland/capsule_desktop_shell/src/state/context.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L33),
[`userland/capsule_desktop_shell/src/state/context.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L34),
[`userland/capsule_desktop_shell/src/state/context.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L35),
[`userland/capsule_desktop_shell/src/state/context.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/context.rs#L36)). Its dispatcher
handles healthcheck, tray register, tray update, tray remove, notify, and
spotlight open ([`userland/capsule_desktop_shell/src/server/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L24),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L25),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L26),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L27),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L28),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L29),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L30),
[`userland/capsule_desktop_shell/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L31)).

Login owns keyring, desktop shell, and compositor ports, display backing, a
serial, and locked or unlocked session state ([`userland/capsule_login/src/state/context/types.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L16),
[`userland/capsule_login/src/state/context/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L17),
[`userland/capsule_login/src/state/context/types.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L18),
[`userland/capsule_login/src/state/context/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L19),
[`userland/capsule_login/src/state/context/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L20),
[`userland/capsule_login/src/state/context/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L21),
[`userland/capsule_login/src/state/context/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L22),
[`userland/capsule_login/src/state/context/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L23),
[`userland/capsule_login/src/state/context/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L24),
[`userland/capsule_login/src/state/context/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L25),
[`userland/capsule_login/src/state/context/types.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L28),
[`userland/capsule_login/src/state/context/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L30)). Its runner handles
healthcheck, start session, end session, and get state
([`userland/capsule_login/src/server/runner.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L16),
[`userland/capsule_login/src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L35),
[`userland/capsule_login/src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L42),
[`userland/capsule_login/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L43),
[`userland/capsule_login/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L44),
[`userland/capsule_login/src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L45),
[`userland/capsule_login/src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/server/runner.rs#L48)).

Clipboard owns a deque of entries, total byte count, max depth, max total bytes,
last activity timestamp, and idle timeout ([`userland/capsule_clipboard/src/state/clipboard/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L21),
[`userland/capsule_clipboard/src/state/clipboard/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L22),
[`userland/capsule_clipboard/src/state/clipboard/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L23),
[`userland/capsule_clipboard/src/state/clipboard/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L24),
[`userland/capsule_clipboard/src/state/clipboard/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L25),
[`userland/capsule_clipboard/src/state/clipboard/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L26),
[`userland/capsule_clipboard/src/state/clipboard/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L27)). Its router handles
healthcheck, copy, paste, history list, history get, clear, and idle timeout
([`userland/capsule_clipboard/src/server/handlers/router.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L25),
[`userland/capsule_clipboard/src/server/handlers/router.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L30),
[`userland/capsule_clipboard/src/server/handlers/router.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L31),
[`userland/capsule_clipboard/src/server/handlers/router.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L32),
[`userland/capsule_clipboard/src/server/handlers/router.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L33),
[`userland/capsule_clipboard/src/server/handlers/router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L34),
[`userland/capsule_clipboard/src/server/handlers/router.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L35),
[`userland/capsule_clipboard/src/server/handlers/router.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L36),
[`userland/capsule_clipboard/src/server/handlers/router.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/server/handlers/router.rs#L37)).

```
+--------------------------+
| desktop shell            |
| tray notify spotlight    |
+------------+-------------+
             |
+------------+-------------+
| login                    |
| locked unlocked session  |
+------------+-------------+
             |
+------------+-------------+
| clipboard                |
| bounded history state    |
+--------------------------+
```

## 3. Wallpaper, Catalog, Image, and Toolkit

Wallpaper owns compositor port, display geometry, backing memory, current ARGB,
alpha, policy, fade timeline, request id, optional policy and catalog ports,
applied wallpaper, and subscriber tick count
([`userland/capsule_wallpaper/src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L19),
[`userland/capsule_wallpaper/src/state/context.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L20),
[`userland/capsule_wallpaper/src/state/context.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L21),
[`userland/capsule_wallpaper/src/state/context.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L22),
[`userland/capsule_wallpaper/src/state/context.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L23),
[`userland/capsule_wallpaper/src/state/context.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L24),
[`userland/capsule_wallpaper/src/state/context.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L25),
[`userland/capsule_wallpaper/src/state/context.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L26),
[`userland/capsule_wallpaper/src/state/context.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L27),
[`userland/capsule_wallpaper/src/state/context.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L28),
[`userland/capsule_wallpaper/src/state/context.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L29),
[`userland/capsule_wallpaper/src/state/context.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L30),
[`userland/capsule_wallpaper/src/state/context.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L31),
[`userland/capsule_wallpaper/src/state/context.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L32),
[`userland/capsule_wallpaper/src/state/context.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/state/context.rs#L33)). Its dispatcher handles
healthcheck, set wallpaper, get wallpaper, set policy, and fade
([`userland/capsule_wallpaper/src/server/runner/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L24),
[`userland/capsule_wallpaper/src/server/runner/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L25),
[`userland/capsule_wallpaper/src/server/runner/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L26),
[`userland/capsule_wallpaper/src/server/runner/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L27),
[`userland/capsule_wallpaper/src/server/runner/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L28),
[`userland/capsule_wallpaper/src/server/runner/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L31),
[`userland/capsule_wallpaper/src/server/runner/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L32)).

Wallpaper catalog polls its endpoint, decodes a fixed header, then handles get
count, get size, get chunk, and get slug ([`userland/capsule_wallpaper_catalog/src/server/runner.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L24),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L28),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L36),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L40),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L41),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L42),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L43),
[`userland/capsule_wallpaper_catalog/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper_catalog/src/server/runner.rs#L44)).

Image codec blocks on IPC, parses a request, handles healthcheck, and dispatches
PNG, BMP, LZ4 raw, and JPEG decode requests to one decode handler
([`userland/capsule_image_codec/src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/runner.rs#L28),
[`userland/capsule_image_codec/src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/runner.rs#L36),
[`userland/capsule_image_codec/src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/runner.rs#L46),
[`userland/capsule_image_codec/src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/runner.rs#L51),
[`userland/capsule_image_codec/src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/runner.rs#L52),
[`userland/capsule_image_codec/src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/runner.rs#L53)). The decode handler
uses a 16384-pixel scratch buffer, maps the op to PNG, BMP, JPEG, or LZ4 raw
decoding, registers an ARGB surface, and returns handle, dimensions, stride,
format, and byte length ([`userland/capsule_image_codec/src/server/handlers/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L23),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L25),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L26),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L27),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L28),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L29),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L30),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L31),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L36),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L38),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L39),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L40),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L41),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L42),
[`userland/capsule_image_codec/src/server/handlers/decode.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L43)).

Toolkit owns global atomic theme colors and a revision counter
([`userland/toolkit/src/theme/store/state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/theme/store/state.rs#L18),
[`userland/toolkit/src/theme/store/state.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/theme/store/state.rs#L19),
[`userland/toolkit/src/theme/store/state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/theme/store/state.rs#L20),
[`userland/toolkit/src/theme/store/state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/theme/store/state.rs#L21),
[`userland/toolkit/src/theme/store/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/theme/store/state.rs#L22),
[`userland/toolkit/src/theme/store/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/theme/store/state.rs#L23)). Its dispatcher handles
healthcheck, theme apply, theme get, animation tick, and component render
([`userland/toolkit/src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L25),
[`userland/toolkit/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L26),
[`userland/toolkit/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L27),
[`userland/toolkit/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L28),
[`userland/toolkit/src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L29),
[`userland/toolkit/src/server/dispatch.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L30),
[`userland/toolkit/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L31)).

```
+--------------------------+
| wallpaper service        |
| policy catalog decode    |
+------------+-------------+
             |
+------------+-------------+
| wallpaper catalog        |
| count size chunk slug    |
+------------+-------------+
             |
+------------+-------------+
| image codec              |
| png bmp jpeg lz4         |
+------------+-------------+
             |
+------------+-------------+
| toolkit                  |
| theme animation render   |
+--------------------------+
```

## 4. Failure Map

| Symptom | First source path to inspect | Why |
|---------|------------------------------|-----|
| Surface appears but does not repaint | [`userland/compositor/src/server/runner/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/dispatch.rs#L35) | Damage commit is the compositor state mutation that makes later frame pacing useful. |
| Window cannot move or resize | [`userland/capsule_wm/src/server/runner/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/runner/dispatch.rs#L36) | WM owns geometry mutation and dispatches move and resize requests. |
| Input subscription has no effect | [`userland/capsule_input_router/src/server/drain_ipc.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/drain_ipc.rs#L46) | Subscribe is handled by input router, not compositor or WM. |
| Launcher tray or notification state is wrong | [`userland/capsule_desktop_shell/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/dispatch.rs#L27) | Shell owns tray and notify requests. |
| Clipboard history grows incorrectly | [`userland/capsule_clipboard/src/state/clipboard/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/state/clipboard/types.rs#L21) | Clipboard owns bounded history and total byte counters. |
| Wallpaper does not apply | [`userland/capsule_wallpaper/src/server/runner/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/server/runner/dispatch.rs#L27) | Wallpaper changes enter through set wallpaper, policy, or fade handlers. |
| Decoded image has no surface handle | [`userland/capsule_image_codec/src/server/handlers/decode.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L36) | Decode must register an ARGB surface before replying. |
| Toolkit colors do not update | [`userland/toolkit/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/server/dispatch.rs#L28) | Theme apply is the toolkit path that mutates theme state. |

## 5. Security analysis

The desktop is deliberately not one privileged process, and the capability masks show
why that matters. The compositor is the only desktop service that carries graphics
authority beyond surface create; its mask is `0x7919`, which adds `GraphicsSurfaceMap`
and `GraphicsPresent` on top of the display-query and surface-create bits, because it is
the one capsule that maps shared surfaces and presents pixels to the display backend
([`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)). The WM and the input router carry only `0x19`, CoreExec
plus IPC plus Memory, because they move metadata and route events, not pixels; neither can
present to the display even if it wanted to. The desktop shell sits at `0x1819`, the same
app-class mask its clients hold. So the trust is split: the compositor is trusted with the
framebuffer, the WM is trusted with window geometry and focus, the router is trusted with
input routing, and no single one of them holds all three. A fault in the WM cannot corrupt
the framebuffer, and a fault in the compositor cannot silently re-route input.

The state split enforces this at the data level, not just the process level. The
compositor owns scenes, damage, focus, cursor, and surface attach state; the WM owns
window lifecycle, geometry, z-order, and focus; the input router owns subscriptions,
grabs, and delivery. A capsule that wants to change window geometry has to go through the
WM's move and resize handlers, and a capsule that wants input has to subscribe through the
router; there is no shared mutable desktop state any of them can reach directly. Input
grabs are the sharpest instance: the router reserves exclusive keyboard and pointer grabs
to three named system capsules and refuses everyone else with `E_ACCES`, so the desktop
shell and ordinary apps see only the events routed to them by focus and hit test, never an
exclusive capture (the gate is on the [input router page](/docs/userland/input-router/)).

Login is the session-authority capsule, and it holds ports to the keyring, the desktop
shell, and the compositor plus a locked-or-unlocked session flag
([`userland/capsule_login/src/state/context/types.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/state/context/types.rs#L16)). It is the capsule that decides
when a session is live, and it is separate from the shell it gates, so the lock state is
not something the shell or an app can flip on its own.

## 6. Debugging the desktop

The desktop is a set of services with separate state tables, so the debugging rule is to
follow the service that owns the state you are observing, which is exactly what the Failure
Map in section 4 encodes. A surface that appears but never repaints is a damage-commit
question at the compositor, not a paint bug in the app; a window that cannot move is the
WM's geometry path; an input subscription that has no effect is the router, not the
compositor or WM. Each row of that table names the first source line to open for a specific
symptom, and the reason it points where it does.

Two failure shapes cross service boundaries and are worth naming separately. A window that
draws but does not receive input is usually a focus or subscription mismatch: the router
delivers by the WM's focus answer, so if the WM reports a different window focused than the
one on screen, keys go to the wrong place. And a desktop that boots but shows nothing is a
spawn-order problem, not a render problem; the desktop fleet spawns GUI core first, then
WM, wallpaper, shell, and services ([`src/userspace/init/spawn_plan/desktop_fleet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L17)),
so a blank screen with the compositor up but the WM down is a different failure than one
where the compositor never spawned. The `capsule spawned` boot marker for each service is
the ground truth for which of them actually started.

## 7. Source map

```
  userland/compositor/src/server/runner/dispatch.rs      scenes, damage, focus, cursor, present
  userland/capsule_wm/src/server/runner/dispatch.rs       window lifecycle, geometry, z-order
  userland/capsule_input_router/src/server/drain_ipc.rs   subscribe, grab, and delivery
  userland/capsule_desktop_shell/src/{state/context.rs, server/dispatch.rs}  tray, notify, spotlight
  userland/capsule_login/src/state/context/types.rs       the locked/unlocked session state
  userland/capsule_clipboard/src/{state/clipboard/types.rs, server/handlers/router.rs}  bounded history
  userland/capsule_wallpaper/, capsule_wallpaper_catalog/  wallpaper apply and catalog chunks
  userland/capsule_image_codec/src/server/                png, bmp, jpeg, lz4 decode to a surface
  userland/toolkit/src/{theme/store/state.rs, server/dispatch.rs}  theme colors and render
```

The capability masks and endpoints for these services are in
[the capsule inventory](/docs/userland/capsules/); the window and input contracts between them are on
[the GUI contracts page](/docs/userland/gui-contracts/).
