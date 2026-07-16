---
title: "The Desktop Shell Capsule"
description: "capsuledesktopshell is the top-level chrome of the NØNOS desktop: the launcher dock at the bottom, the menu bar and status indicators at the top, the notification toasts, the sy..."
weight: 400
---
`capsule_desktop_shell` is the top-level chrome of the NØNOS desktop: the launcher dock at the bottom,
the menu bar and status indicators at the top, the notification toasts, the system tray, and the
spotlight panel. It is the coordination hub that ties the compositor, window manager, input router,
wallpaper, and market together, but it holds no more authority than any other graphics client. Its
source is organized into code pillars, and this documentation mirrors that structure one page per pillar
so a page can be read beside the folder it describes.

The kernel spawns it under service handle `desktop_shell` on service port 4410 with a reply inbox on
port 4411, and its capability mask is `0x1819` (`userland/capsule_desktop_shell/Capsule.mk:16`).

## Identity

Everything the kernel and the service registry need to name and reach the shell comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Slug | `desktop-shell` | `Capsule.mk:5` |
| Service handle | `desktop_shell` | `Capsule.mk:6`, [`src/userspace/capsule_desktop_shell/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/spawn.rs#L31) |
| Namespace | `systems.nonos.desktop_shell` | `Capsule.mk:11` |
| Service endpoint | `service:4410:desktop_shell` | `Capsule.mk:12`, `spawn.rs:32` |
| Reply endpoint | `reply:4411:endpoint.desktop_shell.reply` | `Capsule.mk:13`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x1819` | `Capsule.mk:16` |
| Binary name | `desktop_shell` | `Capsule.mk:9` |
| Kernel mirror | `src/userspace/capsule_desktop_shell` | `Capsule.mk:17` |

The mask `0x1819` decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | create the overlay surface it draws into | `types.rs:68` |

```
  0x0001  CoreExec               = 1
  0x0008  IPC                    = 8
  0x0010  Memory                 = 16
  0x0800  GraphicsDisplayQuery   = 2048
  0x1000  GraphicsSurfaceCreate  = 4096
  ------
  0x1819  = 1 + 8 + 16 + 2048 + 4096
```

The kernel spawn path requests exactly those five capabilities and no others
([`src/userspace/capsule_desktop_shell/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/spawn.rs#L50)). There is no `Network` bit (4, `types.rs:58`), no
`FileSystem` bit (64, `types.rs:62`), and no hardware, driver, DMA, or `GraphicsPresent` bit (16384,
`types.rs:70`). The shell can create a surface, ask the display for its size, and speak IPC; it cannot
present a frame itself, read a device, open a socket, or touch the filesystem. It looks like the most
privileged capsule on the desktop because it coordinates everyone, but its authority is exactly the app
envelope, and compromising it yields that envelope and nothing more.

## The code pillars

The source under `userland/capsule_desktop_shell/src/` decomposes into four documented pillars. A pointer
event comes in through the served input path, may flip live `state`, which `render` turns into overlay
pixels; independently, other capsules drive the tray, toasts, and spotlight through the served
operations, and every outbound reach is a normal IPC call through a `client`.

```
  input + operations  ->   state    ->   render      ->  clients
  what comes in            what is       overlay          the compositor,
  (pointer, NDSH ops)      remembered    pixels           wm, and peers
```

| Page | Mirrors | What it covers |
|---|---|---|
| [surface.md](/docs/userland/desktop-shell/surface/) | `src/render/`, [`src/server/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs) | The user surface: the launcher dock and its nine apps, dock reveal and collapse, the menu bar, the four status indicators, notification toasts, the pointer input path, and how a frame reaches the screen. |
| [operations.md](/docs/userland/desktop-shell/operations/) | `src/server/`, `src/protocol/` | The served side: the `NDSH` frame protocol, the six operations (healthcheck, tray register/update/remove, notify, spotlight), the launcher focus path, the window-manager lifecycle handling, and the loop. |
| [clients.md](/docs/userland/desktop-shell/clients/) | `src/compositor_client/`, `src/wm_client/`, [`src/input_router_client.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input_router_client.rs), `src/wallpaper_client/`, `src/market_client/`, `src/setup/` | Everything the shell reaches outward: the compositor, window manager, input router, wallpaper, market, policy, and DHCP wires, plus the setup sequence that resolves the peers and registers the overlay. |
| [state.md](/docs/userland/desktop-shell/state/) | `src/state/` | The live model: the `Context`, the launcher app list, the taskbar open/pulse/visible state, the 32-slot tray table, the toast queue, the spotlight flag, and the indicator data sources. |
| [contributing.md](/docs/userland/desktop-shell/contributing/) | the whole tree | Where to work, how to add a dock app or an indicator, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/desktop-shell/debugging/) | runtime | The boot marker, and where to look when the shell does not draw, an app will not launch, or the wire returns an error. |

## Lifecycle

The shell is a `no_std`/`no_main` capsule. `_start` initializes the heap, blocks in `wait_for_setup`
until every required peer is up and the overlay is registered, then runs the server loop
([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), [`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41), [`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19), [`src/server/runner/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L29)). It
supplies its own frame protocol and its own paint routines; it is not built on the app skeleton the way
the [terminal](/docs/userland/terminal/) is.

1. The kernel spawns the capsule through the desktop-fleet plan, which logs under the tag `DESKTOP-SHELL`
   and calls `spawn_desktop_shell_capsule` ([`src/userspace/init/spawn_plan/desktop_fleet.rs:118`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L118)). That
   path decodes the trust anchor, verifies the embedded ELF, id cert, manifest, and attestation, requests
   the five-capability mask, registers `desktop_shell` on port 4410 with the reply inbox on 4411, and
   marks the capsule alive ([`src/userspace/capsule_desktop_shell/spawn.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/spawn.rs#L38), `spawn.rs:57`).
2. `wait_for_setup` retries `setup::run` until it succeeds ([`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19)). One pass resolves
   and health-checks the peers, applies the wallpaper policy, allocates the overlay, builds the `Context`,
   paints the initial chrome, registers and submits the overlay scene at z-order 1, opens the taskbar
   popup window through the wm, and subscribes to wm lifecycle and input-router events
   ([`src/setup/prime/run/run.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/run.rs#L21)).
3. `paint_initial` retries up to eight times to paint the chrome and land the first full-screen damage
   commit ([`src/server/paint_initial.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/paint_initial.rs#L24)).
4. The loop drains inbound frames, refreshes the clock and indicators once a second, re-subscribes to
   input and wm if either subscription was lost, expires toasts and taskbar pulses, and blocks on the
   display vsync ([`src/server/runner/run.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L35)).

## Source map

The whole capsule lives at `userland/capsule_desktop_shell/`. The pages above draw from `src/render/`,
`src/server/`, `src/protocol/`, `src/state/`, `src/setup/`, and the outbound clients at the crate root,
plus `Capsule.mk` for identity, [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) for the mask bits, and the kernel spawn
mirror under `src/userspace/capsule_desktop_shell/`. Every reference above is verified against those
trees.
