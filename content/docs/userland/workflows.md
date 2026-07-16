---
title: "Runtime Workflows"
description: "This page describes end-to-end runtime workflows in NØNOS userland."
weight: 15
---
This page describes end-to-end runtime workflows in NØNOS userland. Read
[Userland Model](/docs/userland/), [Lifecycle and Launch](/docs/userland/lifecycle/), and
[Protocol Atlas](/docs/userland/protocols/) first.

The goal is operational: if a boot log says a capsule spawned but a feature does
not work, this page points to the exact source path that should be inspected.

---

## 1. Boot to runqueue

The boot path starts in `run_init`, runs the proof and RAMFS phases, spawns core
services, display core, drivers, VFS, network, desktop, market, and the app
fleet, then enters the supervisor loop ([`src/userspace/init/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L25),
[`src/userspace/init/entry.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L26), [`src/userspace/init/entry.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L27),
[`src/userspace/init/entry.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L28), [`src/userspace/init/entry.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L29),
[`src/userspace/init/entry.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L30), [`src/userspace/init/entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L31),
[`src/userspace/init/entry.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L32), [`src/userspace/init/entry.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L33),
[`src/userspace/init/entry.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L38)).

The spawn planner groups work by dependency. Driver startup calls virtio, bus,
input, NIC, USB, and storage groups in order
([`src/userspace/init/spawn_plan/orchestrator.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L29)). Network startup calls L2,
IP, UDP, DHCP, TCP, DNS, Nym, and sockets in order
([`src/userspace/init/spawn_plan/network.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L17)). Desktop startup calls GUI core,
WM, wallpaper catalog, wallpaper, desktop shell, and desktop services
([`src/userspace/init/spawn_plan/desktop_fleet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L17)). Desktop services are
image codec, clipboard, attest, login, and toolkit
([`src/userspace/init/spawn_plan/desktop_services.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L17)).

Each successful capsule boot goes through `capsule_boot::boot`: it calls the
spawn function, logs success, then registers the capsule in lifecycle. Failed
spawns log an error and are not registered ([`src/userspace/init/capsule_boot/run.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L21),
[`src/userspace/init/capsule_boot/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L27), [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/userspace/init/capsule_boot/run.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L30), [`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)).

```
+-----------------+
| run_init        |
+--------+--------+
         |
+--------+--------+
| spawn_plan      |
+--------+--------+
         |
+--------+--------+
| capsule boot    |
+--------+--------+
         |
+--------+--------+
| spawn_verified  |
+--------+--------+
         |
+--------+--------+
| install process |
+--------+--------+
         |
+--------+--------+
| runqueue        |
+-----------------+
```

`spawn_verified` runs certificate and manifest preflight, then installs the
capsule using capabilities from the verified manifest result
([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L29),
[`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L48),
[`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L31),
[`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L38)). Install
creates the process, registers the per-process inbox, loads the ELF, installs
caps, allocates stacks, builds the initial user context, registers the service
endpoint, and adds the pid to the runqueue
([`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L38),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L42),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L44),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L46),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L48),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L50),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L51),
[`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L54)).

## 2. App launch workflow

The apps are spawned once at boot by `spawn_apps`, so there is no launch broker
and a taskbar click never has to start anything
([`src/userspace/init/spawn_plan/apps.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L17)). The desktop shell launcher table
carries nine entries, each an icon, a label, and a service name: terminal, files,
editor, settings, process manager, about, calculator, snake, and wallet
([`userland/capsule_desktop_shell/src/state/apps.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/state/apps.rs#L36)).

A launcher click resolves to `launcher_request::request`, which looks up the
app's service pid through `mk_service_lookup`. If the service resolves to a live
pid, the shell sends that pid an eight-byte `NCTL` focus frame through
`mk_ipc_send_to_pid`; if the lookup fails, the request returns false and the
click does nothing, because the app was never spawned or has exited
([`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L26),
[`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L32),
[`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L42),
[`userland/capsule_desktop_shell/src/server/handlers/launcher_focus.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_focus.rs#L24)).

```
+------------------+
| shell click      |
+--------+---------+
         |
+--------+---------+
| lookup service   |
+---+----------+---+
    |          |
    | found    | missing
    |          |
+---+---+  +---+------+
| NCTL  |  | ignored  |
| focus |  |          |
+-------+  +----------+
```

## 3. Window open and render workflow

An app skeleton app starts by initializing heap, resolving peers, constructing
the app, reading the manifest, booting it, allocating a receive buffer, and
entering the service frame loop ([`userland/app_skeleton/src/runner/entry.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L30),
[`userland/app_skeleton/src/runner/entry.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L35),
[`userland/app_skeleton/src/runner/entry.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L39),
[`userland/app_skeleton/src/runner/entry.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L40),
[`userland/app_skeleton/src/runner/entry.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L42),
[`userland/app_skeleton/src/runner/entry.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L46),
[`userland/app_skeleton/src/runner/entry.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L47)).

Opening a window allocates anonymous read/write backing memory, zeroes it,
registers the backing as an ARGB8888 surface, shares the surface, announces the
window to WM, submits a compositor scene, and subscribes to input
([`userland/app_skeleton/src/setup/backing.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/backing.rs#L22),
[`userland/app_skeleton/src/setup/backing.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/backing.rs#L26),
[`userland/app_skeleton/src/setup/backing.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/backing.rs#L29),
[`userland/app_skeleton/src/setup/backing.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/backing.rs#L33),
[`userland/app_skeleton/src/setup/backing.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/backing.rs#L35),
[`userland/app_skeleton/src/setup/register.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/register.rs#L21),
[`userland/app_skeleton/src/setup/register.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/register.rs#L28),
[`userland/app_skeleton/src/setup/register.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/register.rs#L37),
[`userland/app_skeleton/src/setup/register.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/register.rs#L41),
[`userland/app_skeleton/src/setup/announce.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/announce.rs#L27),
[`userland/app_skeleton/src/setup/announce.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/announce.rs#L34),
[`userland/app_skeleton/src/setup/announce.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/announce.rs#L44),
[`userland/app_skeleton/src/setup/announce.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/announce.rs#L48)).

WM decodes the open request, clamps the requested rect to display bounds, avoids
collisions for normal windows, allocates z, records owner pid and window id, and
focuses normal windows ([`userland/capsule_wm/src/server/handlers/window_open/handle.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/handle.rs#L26),
[`userland/capsule_wm/src/server/handlers/window_open/handle.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/handle.rs#L27),
[`userland/capsule_wm/src/server/handlers/window_open/place.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/place.rs#L25),
[`userland/capsule_wm/src/server/handlers/window_open/place.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/place.rs#L26),
[`userland/capsule_wm/src/server/handlers/window_open/place.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/place.rs#L27),
[`userland/capsule_wm/src/server/handlers/window_open/handle.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/handle.rs#L33),
[`userland/capsule_wm/src/server/handlers/window_open/handle.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/handle.rs#L34),
[`userland/capsule_wm/src/server/handlers/window_open/handle.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/handle.rs#L43),
[`userland/capsule_wm/src/server/handlers/window_open/handle.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_open/handle.rs#L47)).

The compositor accepts scene submissions only when the body length and rectangle
fit the display. It records owner pid, surface handle, geometry, z, and marks
the submitted rect dirty ([`userland/compositor/src/server/handlers/scene_submit.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/scene_submit.rs#L21),
[`userland/compositor/src/server/handlers/scene_submit.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/scene_submit.rs#L28),
[`userland/compositor/src/server/handlers/scene_submit.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/scene_submit.rs#L49),
[`userland/compositor/src/server/handlers/scene_submit.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/scene_submit.rs#L56),
[`userland/compositor/src/server/handlers/scene_submit.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/scene_submit.rs#L67),
[`userland/compositor/src/server/handlers/scene_submit.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/scene_submit.rs#L70)). Damage commits
validate a dirty rectangle and accumulate it
([`userland/compositor/src/server/handlers/damage_commit.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/damage_commit.rs#L21),
[`userland/compositor/src/server/handlers/damage_commit.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/damage_commit.rs#L28),
[`userland/compositor/src/server/handlers/damage_commit.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/damage_commit.rs#L43),
[`userland/compositor/src/server/handlers/damage_commit.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/damage_commit.rs#L50)).

The compositor runner drains IPC, ticks the frame pacer, and waits for vsync
([`userland/compositor/src/server/runner/entry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/entry.rs#L23),
[`userland/compositor/src/server/runner/entry.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/entry.rs#L27),
[`userland/compositor/src/server/runner/entry.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/entry.rs#L28),
[`userland/compositor/src/server/runner/entry.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/runner/entry.rs#L35)). The frame pacer drains one
damage rect, composites it, emits a release fence, transfers the dirty region to
the GPU resource, sets scanout once, flushes the dirty region, and returns
([`userland/compositor/src/frame_pacer/tick.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L23),
[`userland/compositor/src/frame_pacer/tick.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L24),
[`userland/compositor/src/frame_pacer/tick.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L27),
[`userland/compositor/src/frame_pacer/tick.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L28),
[`userland/compositor/src/frame_pacer/tick.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L31),
[`userland/compositor/src/frame_pacer/tick.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L41),
[`userland/compositor/src/frame_pacer/tick.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L43),
[`userland/compositor/src/frame_pacer/tick.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L53),
[`userland/compositor/src/frame_pacer/tick.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L56)). Vsync wait is a direct libc
display syscall wrapper ([`userland/compositor/src/frame_pacer/vsync.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/vsync.rs#L17),
[`userland/compositor/src/frame_pacer/vsync.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/vsync.rs#L19),
[`userland/compositor/src/frame_pacer/vsync.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/vsync.rs#L20)).

```
+----------------+
| app manifest   |
+-------+--------+
        |
+-------+--------+
| mmap backing   |
| share surface  |
+-------+--------+
        |
+-------+--------+
| WM window_open |
+-------+--------+
        |
+-------+--------+
| scene_submit   |
| damage_commit  |
+-------+--------+
        |
+-------+--------+
| composite      |
| transfer flush |
+----------------+
```

## 4. Input workflow

Input delivery starts in the kernel input ring exposed through libc. The input
router drains IPC control messages, purges dead subscribers periodically, drains
a bounded input batch, routes each event, and waits on the input event sequence
when no events were available ([`userland/capsule_input_router/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L30),
[`userland/capsule_input_router/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L38),
[`userland/capsule_input_router/src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L40),
[`userland/capsule_input_router/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L43),
[`userland/capsule_input_router/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L44),
[`userland/capsule_input_router/src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L49)). The batch drain calls
`mk_input_event_drain` with a max batch of 32
([`userland/capsule_input_router/src/sources/kernel_ring.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L25),
[`userland/capsule_input_router/src/sources/kernel_ring.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L27),
[`userland/capsule_input_router/src/sources/kernel_ring.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L28)).

Subscription requests carry a kind mask. The router validates request length,
reads the mask, upserts the sender pid, and returns `ENOMEM` when the table is
full ([`userland/capsule_input_router/src/server/handlers/subscribe.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/subscribe.rs#L23),
[`userland/capsule_input_router/src/server/handlers/subscribe.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/subscribe.rs#L24),
[`userland/capsule_input_router/src/server/handlers/subscribe.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/subscribe.rs#L28),
[`userland/capsule_input_router/src/server/handlers/subscribe.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/subscribe.rs#L32),
[`userland/capsule_input_router/src/server/handlers/subscribe.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/subscribe.rs#L33)). Upsert
replaces an existing pid, removes it when the mask is zero, or inserts into a
free slot ([`userland/capsule_input_router/src/state/subscriptions/upsert.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/subscriptions/upsert.rs#L20),
[`userland/capsule_input_router/src/state/subscriptions/upsert.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/subscriptions/upsert.rs#L22),
[`userland/capsule_input_router/src/state/subscriptions/upsert.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/subscriptions/upsert.rs#L23),
[`userland/capsule_input_router/src/state/subscriptions/upsert.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/subscriptions/upsert.rs#L34),
[`userland/capsule_input_router/src/state/subscriptions/upsert.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/subscriptions/upsert.rs#L36)).

Routing honors grabs first, then routes pointer and keyboard events through
specialized paths, and broadcasts other subscribed event kinds
([`userland/capsule_input_router/src/route/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L28),
[`userland/capsule_input_router/src/route/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L29),
[`userland/capsule_input_router/src/route/dispatch.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L37),
[`userland/capsule_input_router/src/route/dispatch.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L40),
[`userland/capsule_input_router/src/route/dispatch.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L46)). Delivery encodes the
event into a `NINP` frame and sends it directly to the target pid
([`userland/capsule_input_router/src/route/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L24),
[`userland/capsule_input_router/src/route/deliver.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L28),
[`userland/capsule_input_router/src/route/deliver.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L29),
[`userland/capsule_input_router/src/route/deliver.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L30)).

Pointer routing refreshes display size once, applies cursor movement, mirrors
pointer position to the shell, asks WM for the topmost target, routes clicks on
empty space to shell, and routes window hits to the target owner pid
([`userland/capsule_input_router/src/route/pointer/route_pointer.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L28),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L29),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L30),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L31),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L32),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L33),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L35)). Cursor
state supports relative, absolute, and touch input, then clamps to display bounds
([`userland/capsule_input_router/src/state/cursor.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/cursor.rs#L40),
[`userland/capsule_input_router/src/state/cursor.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/cursor.rs#L41),
[`userland/capsule_input_router/src/state/cursor.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/cursor.rs#L45),
[`userland/capsule_input_router/src/state/cursor.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/cursor.rs#L49),
[`userland/capsule_input_router/src/state/cursor.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/cursor.rs#L53)).

Window pointer hits ask WM for topmost local coordinates. Button down and touch
route focus through WM before the event is converted to window-local coordinates
and sent to the owner pid ([`userland/capsule_input_router/src/route/pointer/topmost_target.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/topmost_target.rs#L20),
[`userland/capsule_input_router/src/route/pointer/topmost_target.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/topmost_target.rs#L22),
[`userland/capsule_input_router/src/route/pointer/route_to_window.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L27),
[`userland/capsule_input_router/src/route/pointer/route_to_window.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L28),
[`userland/capsule_input_router/src/route/pointer/route_to_window.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L30),
[`userland/capsule_input_router/src/route/pointer/route_to_window.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L38),
[`userland/capsule_input_router/src/route/pointer/route_to_window.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L40),
[`userland/capsule_input_router/src/route/pointer/route_to_window.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L43)).

Keyboard routing asks WM for the focused pid, falls back to shell, checks the
subscription mask, and sends one event to that pid
([`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25),
[`userland/capsule_input_router/src/route/keyboard.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L26),
[`userland/capsule_input_router/src/route/keyboard.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L27),
[`userland/capsule_input_router/src/route/keyboard.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L28),
[`userland/capsule_input_router/src/route/keyboard.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L32)).

```
+--------------------------+
| kernel input sequence    |
+------------+-------------+
             |
+------------+-------------+
| drain batch of 32        |
+------------+-------------+
             |
+------------+-------------+
| grabs first              |
+------------+-------------+
             |
+------------+-------------+
| pointer keyboard other   |
+------------+-------------+
             |
+------------+-------------+
| NINP frame to target     |
+--------------------------+
```

## 5. Focus, move, resize, and close workflow

WM `query_topmost` validates the request, calls `topmost_hit_at`, and returns
owner pid, window id, local x, and local y, or zeros when there is no hit
([`userland/capsule_wm/src/server/handlers/query_topmost.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/query_topmost.rs#L27),
[`userland/capsule_wm/src/server/handlers/query_topmost.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/query_topmost.rs#L28),
[`userland/capsule_wm/src/server/handlers/query_topmost.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/query_topmost.rs#L40),
[`userland/capsule_wm/src/server/handlers/query_topmost.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/query_topmost.rs#L42),
[`userland/capsule_wm/src/server/handlers/query_topmost.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/query_topmost.rs#L48)).

`route_focus` is restricted to the input router. It validates request length and
sender, decodes owner pid and window id, confirms the target window exists and
is focusable, pushes compositor focus, and updates WM focus state
([`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L24),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L25),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L31),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L37),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L43),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L49),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L57),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L58),
[`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L64)).

Window move validates request length, decodes id and position, clamps the target
rect to display bounds, rejects overlap for visible normal windows, then stores
the new rect ([`userland/capsule_wm/src/server/handlers/window_move.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L23),
[`userland/capsule_wm/src/server/handlers/window_move.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L24),
[`userland/capsule_wm/src/server/handlers/window_move.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L28),
[`userland/capsule_wm/src/server/handlers/window_move.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L32),
[`userland/capsule_wm/src/server/handlers/window_move.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L36),
[`userland/capsule_wm/src/server/handlers/window_move.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L47),
[`userland/capsule_wm/src/server/handlers/window_move.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L48),
[`userland/capsule_wm/src/server/handlers/window_move.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L54),
[`userland/capsule_wm/src/server/handlers/window_move.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L62)). Resize rejects
zero dimensions, clamps to display, rejects normal-window collisions, then
stores the new rect ([`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L24),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L45),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L49),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L50),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L51),
[`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L59)).

Close from an app skeleton removes the compositor scene, clears its input
subscription, releases the surface, unmaps backing memory, closes the WM window,
and exits ([`userland/app_skeleton/src/runner/teardown.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L31),
[`userland/app_skeleton/src/runner/teardown.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L35),
[`userland/app_skeleton/src/runner/teardown.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L36),
[`userland/app_skeleton/src/runner/teardown.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L39),
[`userland/app_skeleton/src/runner/teardown.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L42),
[`userland/app_skeleton/src/runner/teardown.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/teardown.rs#L46)). WM close clears compositor
focus if the closing window is focused, removes the window from WM state,
broadcasts close notification, and replies success
([`userland/capsule_wm/src/server/handlers/window_close.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L41),
[`userland/capsule_wm/src/server/handlers/window_close.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L43),
[`userland/capsule_wm/src/server/handlers/window_close.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L44),
[`userland/capsule_wm/src/server/handlers/window_close.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L50),
[`userland/capsule_wm/src/server/handlers/window_close.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L58),
[`userland/capsule_wm/src/server/handlers/window_close.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L64),
[`userland/capsule_wm/src/server/handlers/window_close.rs:72`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_close.rs#L72)).

```
+--------------------------+
| pointer hit or app call  |
+------------+-------------+
             |
+------------+-------------+
| query topmost or focus   |
+------------+-------------+
             |
+------------+-------------+
| move resize close        |
+------------+-------------+
             |
+------------+-------------+
| validate owner geometry  |
+------------+-------------+
             |
+------------+-------------+
| state update or reject   |
+--------------------------+
```

## 6. Service IPC workflow

Core service calls use explicit protocol frames and service-owned dispatch. VFS
is the storage example: dispatch maps open, close, read, write, stat, list,
mkdir, unlink, rename, and healthcheck, then returns `EINVAL` for unknown ops
([`userland/capsule_vfs/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L26),
[`userland/capsule_vfs/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L27),
[`userland/capsule_vfs/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L28),
[`userland/capsule_vfs/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L31),
[`userland/capsule_vfs/src/server/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L32),
[`userland/capsule_vfs/src/server/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L33),
[`userland/capsule_vfs/src/server/dispatch.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L34),
[`userland/capsule_vfs/src/server/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L35),
[`userland/capsule_vfs/src/server/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L36),
[`userland/capsule_vfs/src/server/dispatch.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L37),
[`userland/capsule_vfs/src/server/dispatch.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L38)).

VFS open payload is caller pid, path length, path bytes, and flags. The handler
validates caller, path length, UTF-8 path, create/truncate/append flags, then
returns a file descriptor or mapped store error
([`userland/capsule_vfs/src/server/handlers/open.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L26),
[`userland/capsule_vfs/src/server/handlers/open.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L27),
[`userland/capsule_vfs/src/server/handlers/open.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L28),
[`userland/capsule_vfs/src/server/handlers/open.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L35),
[`userland/capsule_vfs/src/server/handlers/open.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L36),
[`userland/capsule_vfs/src/server/handlers/open.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L43),
[`userland/capsule_vfs/src/server/handlers/open.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L54),
[`userland/capsule_vfs/src/server/handlers/open.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L55),
[`userland/capsule_vfs/src/server/handlers/open.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L56),
[`userland/capsule_vfs/src/server/handlers/open.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L57),
[`userland/capsule_vfs/src/server/handlers/open.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L58)). VFS write validates
caller, fd, data length, and `MAX_DATA_BYTES` before writing to the store
([`userland/capsule_vfs/src/server/handlers/write.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L23),
[`userland/capsule_vfs/src/server/handlers/write.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L24),
[`userland/capsule_vfs/src/server/handlers/write.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L25),
[`userland/capsule_vfs/src/server/handlers/write.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L32),
[`userland/capsule_vfs/src/server/handlers/write.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L33),
[`userland/capsule_vfs/src/server/handlers/write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L34),
[`userland/capsule_vfs/src/server/handlers/write.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L37)).

For kernel-side capsule clients, lifecycle transport captures the generation at
send time, rejects dead capsules, enqueues to `proc.<pid>`, wakes sleeping
owners, rechecks liveness and generation while waiting, decodes a response, and
ignores replies with a different request id
([`src/services/lifecycle/transport.rs:134`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L134),
[`src/services/lifecycle/transport.rs:142`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L142),
[`src/services/lifecycle/transport.rs:143`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L143),
[`src/services/lifecycle/transport.rs:146`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L146),
[`src/services/lifecycle/transport.rs:149`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L149),
[`src/services/lifecycle/transport.rs:151`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L151),
[`src/services/lifecycle/transport.rs:169`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L169),
[`src/services/lifecycle/transport.rs:170`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L170),
[`src/services/lifecycle/transport.rs:173`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L173),
[`src/services/lifecycle/transport.rs:176`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L176),
[`src/services/lifecycle/transport.rs:180`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L180),
[`src/services/lifecycle/transport.rs:181`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L181)).

```
+--------------------------+
| client request frame     |
+------------+-------------+
             |
+------------+-------------+
| service dispatch         |
| op match                 |
+------------+-------------+
             |
+------------+-------------+
| handler validation       |
| service state            |
+------------+-------------+
             |
+------------+-------------+
| reply frame              |
+------------+-------------+
             |
+------------+-------------+
| lifecycle transport      |
| generation guard         |
+--------------------------+
```

## 7. Network workflow

Network services are layered by capsule. Init starts L2, IP, UDP, DHCP, TCP,
DNS, Nym, and sockets in that order ([`src/userspace/init/spawn_plan/network.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L17),
[`src/userspace/init/spawn_plan/network.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L18),
[`src/userspace/init/spawn_plan/network.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L19),
[`src/userspace/init/spawn_plan/network.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L20),
[`src/userspace/init/spawn_plan/network.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L21),
[`src/userspace/init/spawn_plan/network.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L22),
[`src/userspace/init/spawn_plan/network.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L23),
[`src/userspace/init/spawn_plan/network.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L24),
[`src/userspace/init/spawn_plan/network.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L25)).

`net.l2` stores the resolved NIC port and pid, MAC address, local IPv4, and ARP
cache. Its state file states that NIC claims and grants remain in the driver
capsule and that L2 talks to the NIC through IPC only
([`userland/capsule_net_l2/src/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L17),
[`userland/capsule_net_l2/src/state.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L29),
[`userland/capsule_net_l2/src/state.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L30),
[`userland/capsule_net_l2/src/state.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L31),
[`userland/capsule_net_l2/src/state.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L32),
[`userland/capsule_net_l2/src/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L33),
[`userland/capsule_net_l2/src/state.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L34),
[`userland/capsule_net_l2/src/state.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/state.rs#L48)).

Sending a frame checks for a NIC port, calls the NIC client TX path, and maps
success, no link, and TX busy responses into L2 status codes
([`userland/capsule_net_l2/src/server/handlers/send_frame.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L22),
[`userland/capsule_net_l2/src/server/handlers/send_frame.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L23),
[`userland/capsule_net_l2/src/server/handlers/send_frame.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L24),
[`userland/capsule_net_l2/src/server/handlers/send_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L28),
[`userland/capsule_net_l2/src/server/handlers/send_frame.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L30),
[`userland/capsule_net_l2/src/server/handlers/send_frame.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L33)). The NIC TX
client builds a NIC request, copies the Ethernet frame after the NIC header,
calls the NIC driver service with `mk_ipc_call`, parses the response, and treats
negative status as refused ([`userland/capsule_net_l2/src/nic_client/tx.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L32),
[`userland/capsule_net_l2/src/nic_client/tx.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L36),
[`userland/capsule_net_l2/src/nic_client/tx.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L39),
[`userland/capsule_net_l2/src/nic_client/tx.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L41),
[`userland/capsule_net_l2/src/nic_client/tx.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L50),
[`userland/capsule_net_l2/src/nic_client/tx.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L63)).

Polling a frame checks for a NIC port, calls NIC RX, observes inbound frames so
ARP can seed the cache, copies the raw frame into the response, and reports empty
or no-link status when needed ([`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L27),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L28),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L33),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L34),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L35),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L44),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L45),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L47),
[`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L48)). The NIC RX
client calls the NIC driver service with an RX op and parses the payload
([`userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs#L28),
[`userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs#L31),
[`userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs#L35),
[`userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs#L43)).

```
+--------------------------+
| net l2 send frame        |
+------------+-------------+
             |
+------------+-------------+
| nic tx ipc call          |
| tx status mapped         |
+------------+-------------+
             |
+------------+-------------+
| net l2 poll frame        |
+------------+-------------+
             |
+------------+-------------+
| nic rx ipc call          |
| payload parsed           |
+------------+-------------+
             |
+------------+-------------+
| arp observe response     |
+--------------------------+
```

## 8. Debugging map

| Symptom | First source path to inspect | Why |
|---------|------------------------------|-----|
| Capsule appears in boot log but client sees dead service | [`src/services/lifecycle/state/liveness.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/state/liveness.rs#L36) and [`src/services/lifecycle/transport.rs:142`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/services/lifecycle/transport.rs#L142) | Liveness checks pid state and transport rejects dead generation before enqueue. |
| Launcher click does nothing | [`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L26) and [`userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/handlers/launcher_request.rs#L32) | Apps are spawned at boot, so a click only focuses a live app; the service lookup returned no pid, meaning the app was never spawned or has exited. |
| App opens but no pixels update | [`userland/compositor/src/server/handlers/damage_commit.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/server/handlers/damage_commit.rs#L21) and [`userland/compositor/src/frame_pacer/tick.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/compositor/src/frame_pacer/tick.rs#L23) | Damage must accumulate and frame pacer must transfer and flush the dirty rect. |
| Keyboard reaches no app | [`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25) and [`userland/capsule_wm/src/server/handlers/window_focus.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_focus.rs#L22) | Keyboard uses WM focus and subscription mask before delivery. |
| Pointer click misses windows | [`userland/capsule_input_router/src/route/pointer/topmost_target.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/topmost_target.rs#L20) and [`userland/capsule_wm/src/server/handlers/query_topmost.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/query_topmost.rs#L27) | Pointer routing depends on WM topmost hit testing. |
| Cursor does not move | [`userland/capsule_input_router/src/route/pointer/route_pointer.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L29) and [`userland/capsule_input_router/src/state/cursor.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/state/cursor.rs#L40) | Pointer routing applies the event to cursor state, and cursor state handles relative, absolute, and touch input. |
| App subscribed but receives no input | [`userland/capsule_input_router/src/server/handlers/subscribe.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/subscribe.rs#L28) and [`userland/capsule_input_router/src/route/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L24) | Subscription upsert must keep the pid and delivery must encode a `NINP` frame for that target. |
| Close button is ignored | [`userland/app_skeleton/src/runner/decorations.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/decorations.rs#L28) and [`userland/app_skeleton/src/runner/service_frame.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/service_frame.rs#L47) | Decoration hit testing must return close, and the service frame must enter teardown on close. |
| Click does not focus the window | [`userland/capsule_input_router/src/route/pointer/route_to_window.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_to_window.rs#L38) and [`userland/capsule_wm/src/server/handlers/route_focus/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/route_focus/handle.rs#L24) | Button-down routing asks WM to route focus before local delivery. |
| Window overlap occurs | [`userland/capsule_wm/src/server/handlers/window_move.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_move.rs#L48) and [`userland/capsule_wm/src/server/handlers/window_resize/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/server/handlers/window_resize/handle.rs#L51) | Move and resize reject normal-window collisions at WM. |
| File write fails | [`userland/capsule_vfs/src/server/handlers/write.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/write.rs#L24) and [`userland/capsule_vfs/src/server/handlers/open.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/open.rs#L27) | VFS validates caller, fd, path, flags, and data caps. |
| Network frame send fails | [`userland/capsule_net_l2/src/server/handlers/send_frame.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/send_frame.rs#L22) and [`userland/capsule_net_l2/src/nic_client/tx.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/tx.rs#L32) | L2 requires a resolved NIC port and a successful driver IPC TX response. |
| Network receive stays empty | [`userland/capsule_net_l2/src/server/handlers/poll_frame.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/poll_frame.rs#L27) and [`userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs#L28) | L2 must have a resolved NIC port, then the NIC RX IPC path must return a payload. |
