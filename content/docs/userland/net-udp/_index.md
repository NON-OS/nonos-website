---
title: "The UDP Transport Capsule"
description: "capsulenetudp is the NØNOS UDP transport: a signed ring-3 capsule that owns UDP datagram send and receive, port binding, and the RFC 768 checksum."
weight: 400
---
`capsule_net_udp` is the NØNOS UDP transport: a signed ring-3 capsule that owns UDP datagram send and
receive, port binding, and the RFC 768 checksum. It does not run in the kernel and it holds no network
device. It reaches the wire only by talking to the IP capsule (`net.ip`) as an ordinary IPC client, and it
serves datagram operations upstream to DHCP, DNS, the sockets multiplexer, and any client capsule that
holds the right to reach it. The kernel neither allocates UDP ports, parses UDP headers, nor owns datagram
queues; all of that is userland code inside this capsule.

The source under `userland/capsule_net_udp/src/` is organized by concern, and this documentation mirrors
that structure so a page can be read beside the folder it describes. This is a small capsule, so the code
is documented as three pillars rather than one page per file.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-udp` | `Capsule.mk:5` |
| Service handle | `net.udp` | `Capsule.mk:6`, [`src/userspace/capsule_net_udp/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_udp/spawn.rs#L35) |
| Namespace | `systems.nonos.net.udp` | `Capsule.mk:11` |
| Service endpoint | `service:4420:net.udp` | `Capsule.mk:12`, `spawn.rs:36` |
| Reply endpoint | `reply:4421:endpoint.net.udp.reply` | `Capsule.mk:13`, `spawn.rs:37` |
| Capability mask | `0x0001d` | `Capsule.mk:14` |
| Binary name | `net_udp` | `Capsule.mk:9`, `Cargo.toml:19` |
| Kernel mirror | `src/userspace/capsule_net_udp` | [`src/userspace/capsule_net_udp/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_udp/spawn.rs) |

The service port `4420` and the reply port `4421` are the numbers the kernel binds when it spawns the
capsule (`spawn.rs:36`, `spawn.rs:38`); the reply inbox name `endpoint.net.udp.reply` is the string the
manifest carries as the reply endpoint (`Capsule.mk:13`, `spawn.rs:37`).

The mask `0x0001d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec   bit()    1   types.rs:55
  0x00004  Network    bit()    4   types.rs:57
  0x00008  IPC        bit()    8   types.rs:58
  0x00010  Memory     bit()   16   types.rs:59
  -------
  0x0001d  = 1 + 4 + 8 + 16
```

Four bits, and no more. `CoreExec` lets it run as a process, `Memory` lets it map its own heap and stack,
`IPC` lets it send and receive on its endpoints, and `Network` marks it as a member of the network trust
domain so a network-class service will answer it. It holds no driver-broker authority (`DeviceEnum`,
`Driver`, `Mmio`, `Irq`, `Dma`, `Pio`, at `types.rs:71` through `types.rs:76`), no filesystem bit (64), no
graphics, no crypto, no admin, and no debug. It never touches a NIC. The only way it reaches the wire is by
asking the IP capsule, and the only inbound surface it exposes is the `net.udp` request server.

The kernel spawn path requests three of those four bits explicitly: `IPC | Memory | Network`
(`spawn.rs:55`), which is `0x1c`. The `CoreExec` bit in the manifest mask is the process-execution right
every capsule carries; the spawn record names only the three service-authority bits it adds on top. The
verified spawn holds the requested set against the manifest ceiling before the ELF is mapped, so the
capsule can never run with more than the mask above.

## The three pillars

The capsule reads as three concerns, and the documentation is one page each. A request enters through the
protocol and server (the operations page), which reaches the datagram machinery that validates and builds
UDP segments (the datagram page), backed by the port table and receive rings the capsule owns (the state
page).

```
  client op   ->   server/protocol   ->   udp datagram engine   ->   net.ip
  NUDP IPC         decode, dispatch       parse/build/checksum      IPC client

  bind/unbind/recv reach the port table and per-bind rings (state);
  send/recv reach net.ip through the ip_client (part of the datagram page).
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-udp/operations/) | `src/protocol/`, `src/server/` | The `NUDP` wire format, the request loop, the five client ops, per-op payloads, the errno set, and the reply path. |
| [datagram.md](/docs/userland/net-udp/datagram/) | `src/udp/`, `src/ip_client/`, [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | The UDP header parse and build, the RFC 768 pseudo-header checksum, the `net.ip` client (config, send, poll), and bring-up. |
| [state.md](/docs/userland/net-udp/state/) | `src/state/` | The port bind table, the one-owner-per-port rule, the per-bind receive ring, and the cached IP link state. |
| [contributing.md](/docs/userland/net-udp/contributing/) | the whole tree | Where each concern lives, how to add a client op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-udp/debugging/) | runtime | The boot marker, the setup retry loop, and the runtime errno failure modes: no port, port in use, no IP link, and empty RX. |

For where UDP sits in the wider stack, see the [networking subsystem](/docs/subsystems/networking/).

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops calling `setup::run` until it
succeeds, and only then enters the request server, which loops forever ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). `setup::run`
resolves `net.ip` through the service registry and caches the IP service port and the local IPv4 address so
the data path does not pay that round-trip on every datagram ([`src/setup.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L36)); a failed setup yields and
retries ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). The kernel spawns it through
[verified spawn](/docs/security/capsules-and-trust/) under the network spawn plan, checking its signature
and attestation and holding its requested capabilities against its manifest ceiling before its ELF is
mapped ([`src/userspace/init/spawn_plan/network/spawn_udp.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_udp.rs#L21)). A successful spawn prints
`[NET-UDP] capsule spawned` on the boot log; the [debugging](/docs/userland/net-udp/debugging/) page covers what that marker
means.

Once setup succeeds the capsule is a datagram transport. Clients speak the small `NUDP` binary protocol
over IPC to bind and unbind a UDP port, to send one datagram, and to poll one received datagram for a bound
port. The capsule owns the port table and the per-bind receive ring; it does not route packets, handle
fragmentation, cache names, or keep stream state. It is the transport a higher-level protocol capsule is
built on, not the policy.

## Source map

```
  userland/capsule_net_udp/src/main.rs        _start -> setup::run (retry) -> server::run; module list
  userland/capsule_net_udp/src/protocol/      the NUDP wire format: magic, ops, errno, limits
  userland/capsule_net_udp/src/server/        the request loop, parse, respond, and one handler per op
  userland/capsule_net_udp/src/udp/           UDP header parse/build and the RFC 768 checksum
  userland/capsule_net_udp/src/ip_client/     the net.ip IPC client: config, send, poll, envelope
  userland/capsule_net_udp/src/state/         the bind table, the per-bind receive ring, and the shared state
  userland/capsule_net_udp/src/setup.rs       resolve net.ip and cache the port and local IPv4
  userland/capsule_net_udp/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_net_udp/              the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/spawn_udp.rs   the NET-UDP spawn entry
  src/capabilities/types.rs                   the capability bit values behind the mask
```

Every reference above is verified against those trees.
