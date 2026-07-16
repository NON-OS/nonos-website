---
title: "The Process Manager Capsule"
description: "capsuleprocessmanager is the NØNOS task viewer: a small GUI window that lists the desktop applications, shows whether each is running and under which pid, and paints a live CPU ..."
weight: 400
---
`capsule_process_manager` is the NØNOS task viewer: a small GUI window that lists the desktop
applications, shows whether each is running and under which pid, and paints a live CPU sparkline per row
sampled from the kernel. It is a read-only observer. It does not start, stop, or signal any process, and
it holds no authority over the processes it reports on.

It is an [app-skeleton](/docs/userland/writing-an-app/) GUI app. The kernel spawns it under service handle
`app.process_manager` on service port 4730 with a reply port on 4731, and its source is
`userland/capsule_process_manager/`. This documentation mirrors that source: the capsule is a single
module tree under `src/pm/`, and the two pillar pages below each read beside the files they describe.

## Contents

- [Overview](#overview)
- [Identity](#identity)
- [The two pillars](#the-two-pillars)
- [Lifecycle](#lifecycle)
- [How to contribute](/docs/userland/process-manager/contributing/)
- [Debugging](/docs/userland/process-manager/debugging/)
- [Source map](#source-map)

## Overview

The process manager is an ordinary NØNOS GUI application. Its entry point hands its `App` implementation
to the skeleton's `run`, so the runtime owns the surface, the window, the input subscription, and the
paint and tick loop, and the capsule supplies four things: a manifest for a normal window, an `on_event`
that refreshes on a key or click and closes on Escape, a `paint` that draws the table, and an `on_tick`
that periodically re-resolves the process list and samples the kernel for CPU ticks
([`userland/capsule_process_manager/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_process_manager/src/main.rs#L28), [`src/pm/app.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/app.rs#L36)).

Unlike the service capsules, it runs no IPC server of its own and receives no application opcodes. It is
a poller: every tick it reads the kernel's process-statistics syscall and, every fifth tick, re-resolves
the monitored service names to pids through the skeleton's service lookup ([`src/pm/app.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/app.rs#L49)). What it
displays is exactly what those two reads expose, and nothing more. The [sampling](/docs/userland/process-manager/sampling/) pillar
covers those two reads; the [interface](/docs/userland/process-manager/interface/) pillar covers the window, the input, and the frame.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `process-manager` | `Capsule.mk:1` |
| Service handle | `app.process_manager` | `Capsule.mk:2`, [`src/userspace/capsule_process_manager/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_process_manager/spawn.rs#L31) |
| Namespace | `systems.nonos.app.process_manager` | `Capsule.mk:7` |
| Service endpoint | `service:4730:app.process_manager` | `Capsule.mk:8`, `spawn.rs:32` |
| Reply endpoint | `reply:4731:endpoint.app.process_manager.reply` | `Capsule.mk:9`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Binary name | `process_manager` | `Capsule.mk:5` |
| Feature gate | `nonos-capsule-process-manager` | `Capsule.mk:6` |
| Kernel mirror | `src/userspace/capsule_process_manager` | `Capsule.mk:12` |

The mask `0x1819` decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|---|---|---|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | send and receive on its endpoints (`types.rs:59`) |
| Memory | `0x0010` | map its own heap and stack (`types.rs:60`) |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry (`types.rs:67`) |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into (`types.rs:68`) |

`0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000 = 0x1819`. The kernel spawn path requests exactly those five
capabilities and no others ([`src/userspace/capsule_process_manager/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_process_manager/spawn.rs#L50)). The two graphics bits
are the only difference between this capsule and the service pools: it is a GUI app, so it needs to query
the display and create a surface to paint into. There is no `Network` bit (4), no `FileSystem` bit (64),
no `Debug` bit (256), no `Admin` bit (512), and no hardware, driver, MMIO, IRQ, DMA, or PIO capability.
The whole basis of its trust story is that it reads the process table through an introspection syscall and
creates a surface, and it can do nothing else.

Do not confuse this capability mask with the manifest's `input_kind_mask`. The latter is a separate,
smaller value (`1 << 0`, key-down only) that the window subscription uses, and it is documented on the
[interface](/docs/userland/process-manager/interface/) pillar, not here.

## The two pillars

The source under `userland/capsule_process_manager/src/` is one module tree, `pm`, split one unit per
file. The work divides cleanly into two concerns: getting the numbers, and showing them. Data flows one
way: a tick pulls fresh figures out of the kernel, which the renderer turns into a table and a sparkline.

```
  sample.rs + state.rs   ->   paint.rs + manifest.rs + event.rs
  read pids and ticks         the window, the frame, the input
```

| Page | Mirrors | What it covers |
|---|---|---|
| [sampling.md](/docs/userland/process-manager/sampling/) | [`src/pm/sample.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs), [`src/pm/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs) | The two reads: `mk_proc_stat` for CPU ticks and the delta math, and the service lookup that resolves the eight monitored names to pids. The monitored list and the refresh cadence. |
| [interface.md](/docs/userland/process-manager/interface/) | [`src/pm/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/manifest.rs), [`src/pm/event.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs), [`src/pm/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs) | The window shape and the `input_kind_mask`, every user action and its handler, and the renderer that draws the title, the table, the status line, the refresh counter, and the sparklines. |
| [contributing.md](/docs/userland/process-manager/contributing/) | the whole tree | Where to work, how to change what is watched, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/process-manager/debugging/) | runtime | The boot marker and the visual failure modes: an offline row, a flat sparkline, a stuck CPU column, the hardcoded `caps` column. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` calls the skeleton's `run(ProcessManager::new)`
([`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27)). The model is a `ProcessManager` holding a `State` and a tick counter
([`src/pm/app.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/app.rs#L25)).

1. The kernel spawns the capsule at boot through the apps-and-tools fleet plan
   ([`src/userspace/init/spawn_plan/apps_tools.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs#L20), behind the `nonos-capsule-process-manager`
   feature), which calls `super::boot::capsule("APP-PROCESS-MANAGER", "app_process_manager", ...)`
   (`apps_tools.rs:52`). The spawn path decodes the baked trust anchor and hands a verified capsule spec
   to `spawn_verified`, which checks the embedded ELF, id cert, manifest, and ZK attestation trailer, then
   registers `app.process_manager` on port 4730 with its reply inbox on 4731
   ([`src/userspace/capsule_process_manager/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_process_manager/spawn.rs#L37)). On success the boot log prints
   `[APP-PROCESS-MANAGER] capsule spawned` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)).
2. The skeleton `run` initialises the heap, resolves the desktop peers, creates the window from the
   manifest, and drives the event and tick loop.
3. `on_tick` fires on the skeleton's timer (a 1000 ms default interval, [`app_skeleton/src/app/behavior.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app_skeleton/src/app/behavior.rs#L30)).
   Every fifth tick it calls `state.refresh()` to re-resolve pids; every tick it calls `sample()` to read
   `mk_proc_stat` and update the CPU history, then returns `true` to request a repaint ([`src/pm/app.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/app.rs#L49)).
   This is the [sampling](/docs/userland/process-manager/sampling/) pillar.
4. `on_event` handles input between ticks: a pointer button-down or any non-Escape key-down triggers a
   refresh and a repaint, and Escape closes the window ([`src/pm/event.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L21)). This is the
   [interface](/docs/userland/process-manager/interface/) pillar.
5. `paint` projects the `State` into the surface, and the frame lands in the shared surface the compositor
   presents ([`src/pm/paint.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L29)).

## Source map

```
  userland/capsule_process_manager/src/main.rs      _start -> run(ProcessManager::new)
  userland/capsule_process_manager/src/pm/mod.rs    the module tree (app, event, manifest, paint, sample, state, format, theme)
  userland/capsule_process_manager/src/pm/app.rs    the App impl (manifest, event, paint, tick)
  userland/capsule_process_manager/Capsule.mk       slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                         the capability bit values behind 0x1819
  src/userspace/capsule_process_manager/spawn.rs    the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/apps_tools.rs       the apps-and-tools fleet spawn entry
  src/userspace/init/capsule_boot/run.rs            the [APP-PROCESS-MANAGER] capsule spawned marker
  userland/app_skeleton/src/app/behavior.rs         the App trait and the default tick interval
```

The two pillars, [sampling.md](/docs/userland/process-manager/sampling/) and [interface.md](/docs/userland/process-manager/interface/), each carry their own source
map for the files under `src/pm/`. Every reference above is verified against those trees.
