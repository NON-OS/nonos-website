---
title: "The Power Capsule"
description: "capsulepower is the userland power service: the one capsule that may reset or power off the machine."
weight: 400
---
`capsule_power` is the userland power service: the one capsule that may reset or power off the machine. It
is deliberately tiny. It takes a request on a fixed IPC port, records a timestamp, and issues the
privileged kernel admin syscall that does the real work. There is no window, no shell, no state beyond two
timestamps. The source is `userland/capsule_power/`, and this documentation mirrors that tree so a page can
be read beside the folder it describes.

Two facts shape everything below and are stated first so nothing later reads as a surprise.

It is not spawned at boot. The capsule is built, signed, and part of the image, but no entry in the kernel
init spawn plan launches it, and the kernel mirror the manifest declares does not exist in the tree
(`Capsule.mk:14`). So there is no `[POWER] capsule spawned` boot line; the capsule is defined but launched
on demand. See [Lifecycle](#lifecycle).

Shutdown does not power the machine off. `OP_SHUTDOWN` reaches the kernel and comes back with `E_NOTSUP`
(`-95`), because the kernel has no AML interpreter to evaluate the DSDT `_S5` object and read the
`SLP_TYPa` value, so the admin handler refuses before any register write rather than writing a meaningless
PM1 value ([`src/syscall/dispatch/router/admin/shutdown.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/shutdown.rs#L19), [`src/arch/x86_64/acpi/power_sleep.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_sleep.rs#L35)).
Reboot, by contrast, is real on any x86 box.

## Contents

- [Overview](#overview)
- [Identity](#identity)
- [Code pillars](#code-pillars)
- [Lifecycle](#lifecycle)
- [Source map](#source-map)

## Overview

The power capsule is a request-reply IPC server with three operations. It exists so that the authority to
reset or power off the machine lives behind exactly one service holding exactly one privileged capability,
rather than being scattered across the fleet. Any capsule that wants the machine to reboot sends a frame to
the power service; the power capsule is the only holder of the Admin capability the reboot and shutdown
syscalls require (`Capsule.mk:13`, [`src/syscall/contract/cap_table/admin.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/admin.rs#L24)).

`_start` initializes the heap and calls `server::run`, which loops on the fixed service port, parses each
frame, dispatches to a per-op handler, and replies to the attested sender
([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29), [`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)). The two power operations are thin wrappers over the kernel
admin syscalls `mk_admin_reboot` and `mk_admin_shutdown`; the capsule itself touches no hardware and holds
no ACPI knowledge ([`src/server/handlers/reboot.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reboot.rs#L29), [`src/server/handlers/shutdown.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/shutdown.rs#L28)).

## Identity

Everything the kernel and the service registry need to name and reach the power capsule comes from its
`Capsule.mk`.

| Field | Value | Source |
|-------|-------|--------|
| Slug | `power` | `Capsule.mk:1` |
| Service handle | `power` | `Capsule.mk:2` |
| Namespace | `systems.nonos.power` | `Capsule.mk:7` |
| Service endpoint | `service:4448:power` | `Capsule.mk:8` |
| Reply endpoint | `reply:4449:endpoint.power.reply` | `Capsule.mk:9` |
| Binary name | `power` | `Capsule.mk:5` |
| Capability mask | `0x219` | `Capsule.mk:13` |
| Kernel mirror (declared) | `src/userspace/capsule_power` | `Capsule.mk:14` |

The service port the running capsule listens on is `4448`, hardcoded in the runner and matching the
manifest endpoint ([`src/server/runner.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L25)). The reply endpoint declares port `4449`, but the runner does
not bind a reply port of its own; it replies directly to the attested sender pid returned by the receive
([`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47)).

The mask `0x219` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | receive and reply on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| Admin | `0x0200` | issue `AdminReboot` and `AdminShutdown` | `types.rs:65` |

```
  0x0219 = 0x0001 + 0x0008 + 0x0010 + 0x0200
         =      1 +      8 +     16 +    512
```

The comment in the manifest states the same decomposition and the reason for the shape: Admin gates
`AdminReboot` and `AdminShutdown`, and Debug is deliberately omitted so a power transition can never leak
to the serial surface (`Capsule.mk:10`, `Capsule.mk:12`). There is no Network, no FileSystem, no Crypto,
no Graphics, and no hardware, driver, or DMA bit. This is a reset button: one privileged verb and nothing
else. It is the same minimal posture as the [policy](/docs/userland/policy/) capsule, which also holds exactly
one Admin-class power and is otherwise bare.

## Code pillars

The source under `userland/capsule_power/src/` is three top-level modules, and this documentation is one
hub page plus one pillar page. The capsule is small, so the wire format and the handler path are covered
together on a single page rather than fragmented.

```
  protocol/   ->   server/handlers/   ->   kernel admin syscall   ->   ACPI
  wire format      dispatch + the         mk_admin_reboot /            reset or
  and parse        three op handlers      mk_admin_shutdown            E_NOTSUP
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/power/operations/) | `src/protocol/`, `src/server/` | The three ops, the fixed frame format, the request loop, the reply-then-reset vs shutdown ordering, and the full syscall path from handler to ACPI, including why shutdown returns `E_NOTSUP`. |
| [contributing.md](/docs/userland/power/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/power/debugging/) | runtime | The absence of a boot marker, the failure modes, and how to read each status a caller can get back. |

The `src/state/` module is a two-field struct (`last_reboot_request_unix`, `last_shutdown_request_unix`)
holding request timestamps for the current process lifetime; it is covered inline on the operations page
rather than given a page of its own ([`src/state/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/mod.rs#L17)).

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initializes the heap and, on failure, exits with code `1`
rather than running with no allocator; on success it hands control to `server::run`, which never returns
([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)). The three modules are `protocol` (the wire format), `server` (the loop and handlers),
and `state` (the two timestamps) ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

Unlike a spawned app such as the [terminal](/docs/userland/terminal/), the power capsule is not launched by
the init spawn plan. The Makefile includes its `Capsule.mk`, so it is built, signed, and pulled into the
image artifact and verify sets (`Makefile:683`, `Makefile:731`, `Makefile:882`). But a search of
`src/userspace/init/spawn_plan/` for the power slug or its port 4448 finds nothing, and the kernel mirror
the manifest declares at `src/userspace/capsule_power` does not exist in the tree (`Capsule.mk:14`). So
there is no boot line for it, and the test that it is up is whether a service lookup for `power` resolves,
not a boot marker. The [debugging](/docs/userland/power/debugging/) page covers what a caller sees instead.

## Source map

```
  userland/capsule_power/src/           the capsule: protocol, server, state
  userland/capsule_power/Capsule.mk     slug, handle, ports, 0x219 mask, declared kernel mirror
  userland/libc/src/admin/              mk_admin_reboot / mk_admin_shutdown wrappers
  src/syscall/dispatch/router/admin/    AdminReboot / AdminShutdown kernel dispatch
  src/syscall/contract/cap_table/       the Admin capability gate on the admin syscalls
  src/arch/x86_64/acpi/                  real reboot; shutdown E_NOTSUP until an AML evaluator lands
  src/capabilities/types.rs             the capability bit values
  src/userspace/init/spawn_plan/        the init fleet; searched and confirmed to have no power entry
```

Every reference above is verified against those trees.
