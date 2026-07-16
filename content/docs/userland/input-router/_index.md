---
title: "The Input Router Capsule"
description: "capsuleinputrouter is the single consumer of the kernel input ring and the fan-out point for the whole desktop."
weight: 400
---
`capsule_input_router` is the single consumer of the kernel input ring and the fan-out point for the
whole desktop. Driver capsules post hardware events into the kernel ring; this capsule drains that ring,
decides where each event belongs, and delivers it to the owning window over IPC. It is the userland
counterpart to the kernel [input subsystem](/docs/subsystems/input/), and the routing decisions
here are the userland half of the [event path](/docs/subsystems/input/path/).

Its source is organized into six top-level modules, and this documentation mirrors that structure so a
page can be read beside the folders it describes. The one fact to hold before anything else: the router
sees every keystroke and every pointer motion on the machine, yet it holds no `InputSource` capability. It
can drain the ring and speak IPC, but it cannot inject a synthetic event back into the ring the way a
driver can. That property is the spine of every page here.

## Identity

Everything the kernel and the service registry need to name and reach the router comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `input-router` | `Capsule.mk:5` |
| Service handle | `input_router` | `Capsule.mk:6`, [`src/userspace/capsule_input_router/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_router/spawn.rs#L31) |
| Namespace | `systems.nonos.input_router` | `Capsule.mk:11` |
| Service endpoint | `service:4320:input_router` | `Capsule.mk:12`, `spawn.rs:32` |
| Reply endpoint | `reply:4321:endpoint.input_router.reply` | `Capsule.mk:13`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x19` | `Capsule.mk:15` |
| Binary name | `input_router` | `Capsule.mk:9` |
| Kernel mirror | `src/userspace/capsule_input_router` | `Capsule.mk:16` |

The mask `0x19` decomposes into exactly three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|---|---|---|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | send and receive on its endpoints and speak the drain syscalls (`types.rs:59`) |
| Memory | `0x0010` | map its own heap and stack (`types.rs:60`) |

```
  0x0019 = 0x0001 + 0x0008 + 0x0010
         = CoreExec + IPC + Memory
```

The kernel spawn path requests exactly those three capabilities and no others
([`src/userspace/capsule_input_router/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_router/spawn.rs#L50)). The router does **not** hold `InputSource`.
`InputSource` (capability value `2097152`, [`src/capabilities/types.rs:77`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L77)) is the post authority, and
`MkInputEventPost` is gated on it ([`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78)); only the signed driver
capsules that own the hardware hold it. The router only drains, and `MkInputEventDrain` and
`MkInputEventWait` are gated on `can_ipc` ([`src/syscall/contract/cap_table/mk.rs:79`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L79)), which the `IPC` bit
satisfies. So the router can read the ring and speak IPC, but it cannot inject a synthetic event, and it
holds no network, filesystem, graphics, or hardware capability at all. Compromising the router yields
those three bits and the right to ask the window manager, compositor, and policy services a question.

## The six pillars

The source under `userland/capsule_input_router/src/` is six top-level modules, and this documentation is
one page per pillar (two of the modules pair with a partner). Data flows from the kernel ring on the left,
through classification and delivery, to the consumer on the right; the clients on the bottom answer the
questions each decision needs.

```
  sources/  ->  route/          ->  consumers
  drain the     classify and         (windows, shell,
  kernel ring   deliver each event    grab holders)
                    |
  server/  <-- IPC in (subscribe / grab / release / health)
  the loop and handlers, protocol/ the wire formats
                    |
  state/    the routing memory (cursor, grabs, subs, press, hover, key targets)
  clients/  the questions out (wm focus and hit-test, compositor, policy)
```

| Page | Mirrors | What it covers |
|---|---|---|
| [operations.md](/docs/userland/input-router/operations/) | `src/protocol/`, `src/server/` | The `NIRS` request frame and the `NINP` delivery frame, the four opcodes, the non-blocking IPC drain, the four handlers, and the reply path on port 4321. |
| [routing.md](/docs/userland/input-router/routing/) | `src/sources/`, `src/route/` | The kernel-ring batch drain and the routing decision engine: the grab-first / pointer / keyboard / broadcast order, and the pointer specialization with focus query, hit-test, and the press-drag latch. |
| [state.md](/docs/userland/input-router/state/) | `src/state/` | The routing memory: the cursor, the grab table, the subscription table, the per-key targets, the press and hover caches, and the `Context` that owns them all. |
| [clients.md](/docs/userland/input-router/clients/) | `src/clients/` | The outbound service clients: the window manager (focus, hit-test, route-focus), the compositor (display size, cursor update), the policy field read, and the shared `NIRS` wire helper. |
| [contributing.md](/docs/userland/input-router/contributing/) | the whole tree | Where to work, how to add an operation or a routing rule, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/input-router/debugging/) | runtime | The boot marker, the first-event bench markers, and where to look when input never reaches a window or a grab is stuck. |

## Lifecycle

The router is spawned first in the desktop GUI fleet, before the compositor, so the rest of the desktop
comes up behind it ([`src/userspace/init/spawn_plan/desktop_fleet.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L38), `:72`). The spawn is idempotent
through an `is_alive` guard, verifies the embedded ELF, cert, manifest, and attestation, and registers
`input_router` on port 4320 ([`src/userspace/capsule_input_router/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_router/spawn.rs#L37)). It also runs as part of
the input-probe fleet ([`src/userspace/init/spawn_plan/input_probe_fleet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/input_probe_fleet.rs#L24)).

`_start` initializes the heap and calls `server::run`, which never returns ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). Each loop
iteration drains pending IPC, does periodic maintenance every 64th tick, drains a batch of input events
from the kernel ring, routes each event, pushes a cursor update to the compositor if the cursor moved, and
blocks on the ring's sequence number when there is nothing left to do ([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). So the
router never spins when idle and never blocks while events are pending. On a successful spawn the kernel
logs `[INPUT-ROUTER] capsule spawned`; the [debugging](/docs/userland/input-router/debugging/) page covers what each later marker
means.

## Source map

```
  Capsule.mk                                 slug, handle, ports, capability mask, kernel mirror
  userland/capsule_input_router/src/main.rs  _start -> heap_init -> server::run
  userland/capsule_input_router/src/protocol/  the NIRS request and NINP delivery wire formats
  userland/capsule_input_router/src/server/    the loop, the IPC drain, and the four op handlers
  userland/capsule_input_router/src/sources/   the kernel-ring batch drain
  userland/capsule_input_router/src/route/     the routing decision engine
  userland/capsule_input_router/src/state/     the routing memory
  userland/capsule_input_router/src/clients/   the outbound service clients
  src/capabilities/types.rs                  the CoreExec / IPC / Memory / InputSource capability bits
  src/syscall/contract/cap_table/mk.rs       the per-syscall capability gate
  src/userspace/capsule_input_router/        the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/             the desktop and input-probe fleet spawn entries
```

Every reference above is verified against those trees.
</content>
</invoke>
