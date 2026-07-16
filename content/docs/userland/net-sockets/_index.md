---
title: "The Sockets Capsule"
description: "netsockets is the socket multiplexer: a signed ring-3 capsule that gives application capsules and the NØNOS standard library one BSD-shaped socket API and routes each per-handle..."
weight: 400
---
`net_sockets` is the socket multiplexer: a signed ring-3 capsule that gives application capsules and the
NØNOS standard library one BSD-shaped socket API and routes each per-handle operation to the transport
that owns it. It runs no code in the kernel and touches no device. It sits one layer above the transport
capsules `net.tcp`, `net.udp`, and `net.nym`: it owns the socket handle table and the family-and-kind
policy, and it forwards the actual connection, datagram, and mixnet work to those backends by IPC. There
is no POSIX socket syscall in the kernel; the socket abstraction a program sees is this capsule, not a
kernel table.

The source under `userland/capsule_net_sockets/src/` is organized by concern, and this documentation
mirrors that structure one page per pillar so a page can be read beside the folder it describes. For where
this capsule sits in the whole network stack, read the
[networking subsystem](/docs/subsystems/networking/).

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-sockets` | `Capsule.mk:5` |
| Service handle | `net.sockets` | `Capsule.mk:6`, [`src/userspace/capsule_net_sockets/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_sockets/spawn.rs#L31) |
| Namespace | `systems.nonos.net.sockets` | `Capsule.mk:11` |
| Service endpoint | `service:4460:net.sockets` | `Capsule.mk:12`, `spawn.rs:32` |
| Reply endpoint | `reply:4461:endpoint.net.sockets.reply` | `Capsule.mk:13`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x0001d` | `Capsule.mk:14` |
| Binary name | `net_sockets` | `Capsule.mk:7`, `Cargo.toml:21` |
| Feature gate | `nonos-capsule-net-sockets` | `Capsule.mk:8`, [`src/userspace/capsule_net_sockets/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_sockets/embed.rs#L17) |
| Wire magic | `NSKT` (`0x4E534B54`) | [`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17) |
| Kernel mirror | `src/userspace/capsule_net_sockets` | `Capsule.mk:15`, [`src/userspace/capsule_net_sockets/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_sockets/spawn.rs) |

The reply endpoint has two parts the manifest and the spawn record agree on: the inbox name
`endpoint.net.sockets.reply` (`spawn.rs:33`) and the reply port `4461` (`spawn.rs:34`). The capsule sends
every reply back to the sender by pid with `mk_ipc_reply` rather than to a fixed inbox
([`src/server/respond.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L31)), so the reply endpoint is the registry-side name for its return path, not an
address the capsule hardcodes.

The mask `0x0001d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec   bit()   1   types.rs:56
  0x00004  Network    bit()   4   types.rs:58
  0x00008  IPC        bit()   8   types.rs:59
  0x00010  Memory     bit()  16   types.rs:60
  -------
  0x0001d  = 1 + 4 + 8 + 16
```

The kernel spawn path requests three of those four bits by name, `IPC | Memory | Network`
([`src/userspace/capsule_net_sockets/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_sockets/spawn.rs#L50)), which is `0x1c`; the manifest ceiling adds `CoreExec`
(`0x1`) so the process can run, giving the full `0x1d`. The requested set is a subset of the manifest
ceiling, which is what the spawn check enforces before the ELF is mapped. What each bit buys this capsule:
`CoreExec` runs it as a process, `IPC` lets it receive on `net.sockets` and call `net.tcp`, `net.udp`, and
`net.nym`, `Memory` maps its own heap and stack, and `Network` is the transport-class marker the stack
uses to place it above the transports. It holds no crypto, driver, MMIO, IRQ, DMA, PIO, filesystem,
graphics, admin, or debug authority, so compromising it yields its own per-pid handle table and the
ability to speak to the transport capsules, and nothing more.

One caveat for anyone reading the source `README.md`: that file predates the wiring and is wrong on the
authority in two places, quoting `0x00018` under "Authority" and `0x00019` under "Microkernel contract";
the manifest and the kernel spawn agree the mask is `0x0001d`. The same source `README.md` also names a
`src/network/sockets_capsule` mirror and an `endpoint.4294967380` reply inbox that do not exist; the real
mirror is `src/userspace/capsule_net_sockets` and the real reply inbox is `endpoint.net.sockets.reply`.
The `Capsule.mk` and the spawn record are the truth used above.

## The four pillars

The capsule reads as four concerns, and the documentation is one page each. A client op enters through the
protocol and server front (the operations page), which reads or mutates a handle in the socket table (the
handles page), and then, for anything that touches the wire, calls out through a transport backend client
(the transports page); the discovery of those backends and the process-global handle counter live in the
capsule's small state (the state page).

```
  application capsule / nonos_std                 net.tcp / net.udp / net.nym
      |                                                   ^
      | NSKT op IPC                                       | NTCP / NUDP / NYM1 op IPC
      v                                                   |
  server/  ->  handlers/  ->  sockets/ table  ->  clients/ (tcp, udp, nym)
  decode      per-op logic    per-pid handles     forward to the transport
      \             |                |                    /
       \            v                v                   /
        `------  state.rs : discovered transport ports + handle counter  ------'
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-sockets/operations/) | `src/protocol/`, [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs), [`src/server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs), [`src/server/parse_req.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs), [`src/server/respond.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs), `src/server/handlers/` | The `NSKT` wire format, the receive loop, the eleven ops and their per-op payloads and handlers, and the errno set. |
| [handles.md](/docs/userland/net-sockets/handles/) | `src/sockets/` | The socket abstraction: the `Kind` families, the `Socket` control block, the per-pid `(pid, handle)` key, the 256-slot table, and the open, lookup, and close operations that mint and reap handles. |
| [transports.md](/docs/userland/net-sockets/transports/) | `src/clients/` | The transport backend clients: the shared IPC envelope, the TCP client, the UDP client, and the multi-file Nym client, and how each op picks a backend by socket kind. |
| [state.md](/docs/userland/net-sockets/state/) | [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs), [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs) | Bring-up and process-global state: the `_start` heap init, the setup-retry loop, and the discovery and caching of the `net.tcp`, `net.udp`, and `net.nym` service ports. |
| [contributing.md](/docs/userland/net-sockets/contributing/) | the whole tree | Where each concern lives, how to add an op or a socket kind, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-sockets/debugging/) | runtime | The boot marker, the setup retry loop, and the runtime failure modes: no handle, no transport, table full, bad family or kind, not bound, and not connected. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops `state::discover` until it
succeeds, then enters `server::run`, which loops forever ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). If the heap init fails the
process exits with code 1 ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)); discovery itself does not exit on failure, it retries after
yielding sixty-four times so a boot that races ahead of the transport capsules recovers on its own
([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). `state::discover` looks up the `net.tcp` and `net.udp` service ports and requires both,
and looks up `net.nym` opportunistically, tolerating its absence ([`src/state.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L45)). The kernel spawns the
capsule through [verified spawn](/docs/security/capsules-and-trust/) under the network spawn plan,
checking its signature and attestation and holding its requested capabilities against its manifest ceiling
before its ELF is mapped ([`src/userspace/init/spawn_plan/network/spawn_sockets.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_sockets.rs#L17)). A successful spawn
prints `[NET-SOCKETS] capsule spawned` on the boot log ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); the
[debugging](/docs/userland/net-sockets/debugging/) page covers what that and the discovery retry mean.

Once discovery succeeds the capsule is the socket service. Clients speak the small `NSKT` binary protocol
over IPC to create a socket, bind, listen, accept, connect, move bytes, get and set options, and close;
the NØNOS standard library's `TcpStream` and `UdpSocket` are built on exactly this protocol
([`userland/sdk/nonos_std/src/net/proto/session.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/sdk/nonos_std/src/net/proto/session.rs#L23), [`userland/sdk/nonos_std/src/net/proto/wire.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/sdk/nonos_std/src/net/proto/wire.rs#L19)).
The capsule owns the handle table and the family-and-kind policy; it owns no connection state, no sequence
number, no datagram queue, and no mixnet session. Those live in the transport capsules it dispatches to,
which is what keeps this capsule small and the boundary between socket policy and transport mechanism
sharp.

## Source map

```
  userland/capsule_net_sockets/src/main.rs        _start -> heap -> discovery retry -> server::run
  userland/capsule_net_sockets/src/protocol/      the NSKT wire: magic, ops, errno
  userland/capsule_net_sockets/src/server/        the receive loop, dispatch, and one handler per op
  userland/capsule_net_sockets/src/sockets/       the Kind families, the Socket block, and the per-pid table
  userland/capsule_net_sockets/src/clients/       the tcp, udp, and nym transport backend clients
  userland/capsule_net_sockets/src/state.rs       the discovered transport ports and the handle counter
  userland/capsule_net_sockets/Capsule.mk         slug, handle, ports, capability mask, feature, kernel mirror
  userland/capsule_net_sockets/Cargo.toml         panic = "abort" and the binary name
  src/userspace/capsule_net_sockets/              the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/spawn_sockets.rs  the NET-SOCKETS spawn entry and boot marker
  src/capabilities/types.rs                       the capability bit values behind the mask
```

Every reference above is verified against those trees.
