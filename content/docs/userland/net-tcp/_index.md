---
title: "The TCP Capsule"
description: "nettcp is the TCP transport capsule: a signed ring-3 capsule that owns the whole connection state machine, segment build and parse, the retransmit and TimeWait timers, congestio..."
weight: 400
---
`net_tcp` is the TCP transport capsule: a signed ring-3 capsule that owns the whole connection state
machine, segment build and parse, the retransmit and TimeWait timers, congestion and flow control, and the
per-flow control blocks. It runs no code in the kernel and touches no device. It sits one layer above the
IPv4 capsule and one layer below the sockets multiplexer: it asks `net.ip` to carry raw TCP segments over
IPv4 and it exposes a small connection-oriented op set to `net.sockets`. Everything a TCP does that is not a
raw IPv4 datagram, the handshake, the sequence space, the sliding window, the reassembly queue, the RTO
clock, lives inside this capsule as ordinary userland code.

The source under `userland/capsule_net_tcp/src/` is organized by concern, and this documentation mirrors
that structure one page per pillar so a page can be read beside the folder it describes. For where this
capsule sits in the whole network stack, read the [networking subsystem](/docs/subsystems/networking/).

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-tcp` | `Capsule.mk:5` |
| Service handle | `net.tcp` | `Capsule.mk:6`, [`src/userspace/capsule_net_tcp/spawn.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_tcp/spawn.rs#L30) |
| Namespace | `systems.nonos.net.tcp` | `Capsule.mk:11` |
| Service endpoint | `service:4430:net.tcp` | `Capsule.mk:12`, `spawn.rs:31` |
| Reply endpoint | `reply:4431:endpoint.net.tcp.reply` | `Capsule.mk:13`, `spawn.rs:32`, `spawn.rs:33` |
| Capability mask | `0x0003d` | `Capsule.mk:14` |
| Binary name | `net_tcp` | `Capsule.mk:7`, `Cargo.toml:19` |
| Feature gate | `nonos-capsule-net-tcp` | `Capsule.mk:8`, [`src/userspace/capsule_net_tcp/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_tcp/embed.rs#L17) |
| Wire magic | `NTCP` (`0x4E544350`) | [`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17) |
| Kernel mirror | `src/userspace/capsule_net_tcp` | `Capsule.mk:15`, [`src/userspace/capsule_net_tcp/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_tcp/spawn.rs) |

The reply endpoint has two parts the manifest and the spawn record agree on: the inbox name
`endpoint.net.tcp.reply` (`spawn.rs:32`) and the reply port `4431` (`spawn.rs:33`). The capsule sends every
reply back to the sender by pid with `mk_ipc_reply` rather than to a fixed inbox ([`src/server/respond.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L38)),
so the reply endpoint is the registry-side name for its return path, not an address the capsule hardcodes.

The mask `0x0003d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec   bit()   1   types.rs:56
  0x00004  Network    bit()   4   types.rs:58
  0x00008  IPC        bit()   8   types.rs:59
  0x00010  Memory     bit()  16   types.rs:60
  0x00020  Crypto     bit()  32   types.rs:61
  -------
  0x0003d  = 1 + 4 + 8 + 16 + 32
```

The kernel spawn path requests four of those five bits by name, `IPC | Memory | Crypto | Network`
([`src/userspace/capsule_net_tcp/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_tcp/spawn.rs#L49)), which is `0x3c`; the manifest ceiling adds `CoreExec`
(`0x1`) so the process can run, giving the full `0x3d`. The requested set is a subset of the manifest
ceiling, which is what the spawn check enforces before the ELF is mapped. What each bit buys this capsule:
`CoreExec` runs it as a process, `IPC` lets it receive on `net.tcp` and call `net.ip`, `Memory` maps its
own heap and stack, and `Crypto` reaches `crypto_random` to seed the SipHash key behind its initial send
sequence numbers ([`src/setup.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L33), [`src/tcp/iss.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/iss.rs#L20)). The `Network` bit is the transport-class marker
the stack uses to place it above `net.ip`; the capsule reaches the wire only by IPC to `net.ip`, never a
NIC. It holds no driver, MMIO, IRQ, DMA, PIO, filesystem, graphics, admin, or debug authority, so
compromising it yields its own connection tables and the ability to speak to `net.ip`, and nothing more.

## The five pillars

The capsule reads as five concerns, and the documentation is one page each. A client op enters through the
protocol and server (the operations page), which drives a connection whose behaviour is the TCP state
machine (the connections page) over segments the protocol engine builds and parses (the segments page),
against a table of control blocks and their queues (the state page), by exchanging IPv4-carried segments
with `net.ip` (the ip-link page).

```
  net.sockets                                      net.ip
      |                                               ^
      | NTCP op IPC                                   | NIP4 segment IPC
      v                                               |
  server/  ->  tcp_rx state machine  ->  tcp/ build/parse  ->  ip_client/
  decode      handshake, data, close   segment + checksum    send / poll
      \              |                         |                  /
       \             v                         v                 /
        `------  state/ : per-flow TCB table, retx, reasm, timers  ------'
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-tcp/operations/) | `src/protocol/`, [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs), [`src/server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs), [`src/server/parse_req.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs), [`src/server/respond.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs), `src/server/handlers/` | The `NTCP` wire format, the request loop and its tick budget, the nine ops, per-op payloads, and the errno set. |
| [connections.md](/docs/userland/net-tcp/connections/) | `src/server/tcp_rx/`, `src/server/handlers/connect/`, [`src/server/tick.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs), [`src/server/sender.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sender.rs), [`src/server/retransmit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/retransmit.rs) | The ten-state machine: passive and active open, the three-way handshake, established data flow, the four close paths, reset handling, the RTO scan, and the send pump. |
| [segments.md](/docs/userland/net-tcp/segments/) | `src/tcp/` | The segment engine: header build and parse, the mandatory pseudo-header checksum, the sequence algebra, the SipHash ISS, the RTT estimator, the Reno congestion controller, and the send window math. |
| [state.md](/docs/userland/net-tcp/state/) | `src/state/` | The connection table: the `Entry` control block, the handle and per-pid quota model, the retransmit queue, the out-of-order reassembly map, the TimeWait timer wheel, and the process-global locals. |
| [ip-link.md](/docs/userland/net-tcp/ip-link/) | `src/ip_client/`, [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs), [`src/clock.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clock.rs) | The `net.ip` client: the `NIP4` wire, config read at setup, segment send, packet poll, and the millisecond clock the timers run on. |
| [contributing.md](/docs/userland/net-tcp/contributing/) | the whole tree | Where each concern lives, how to add an op or a state transition, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-tcp/debugging/) | runtime | The boot marker, the setup retry loop, and the runtime failure modes: no IP config, refused connect, timeout, reset, and an empty receive queue. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops `setup::run` until it succeeds,
then enters `server::run`, which loops forever ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). If the heap init fails the process exits
with code 1 ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)); setup itself does not exit on failure, it retries after yielding so a boot
that races ahead of `net.ip` recovers on its own ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). `setup::run` seeds the ISS SipHash key
from `crypto_random`, looks up `net.ip`, reads the local IPv4 config, and stores the IP port and address
([`src/setup.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L42)). The kernel spawns it through [verified spawn](/docs/security/capsules-and-trust/)
under the network spawn plan, checking its signature and attestation and holding its requested capabilities
against its manifest ceiling before its ELF is mapped ([`src/userspace/init/spawn_plan/network/spawn_tcp.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_tcp.rs#L21)).
A successful spawn prints `[NET-TCP] capsule spawned` on the boot log ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29));
the [debugging](/docs/userland/net-tcp/debugging/) page covers what that and the setup retry mean.

Once setup succeeds the capsule is a transport backend. Clients speak the small `NTCP` binary protocol over
IPC to open connections actively or passively, move stream bytes, read the connection state, and close. The
capsule owns every byte of TCP state; the kernel owns no connection, sequence number, buffer, or timer. It
is the mechanism the sockets service is built on, not the socket-fd policy: it holds no fd table, no TLS,
and no name resolution.

## Source map

```
  userland/capsule_net_tcp/src/main.rs        _start -> heap -> setup retry -> server::run
  userland/capsule_net_tcp/src/setup.rs       seed ISS key, find net.ip, read local IPv4 config
  userland/capsule_net_tcp/src/clock.rs       mk_time_millis wrapper the timers run on
  userland/capsule_net_tcp/src/protocol/      the NTCP wire: magic, ops, errno, limits, header
  userland/capsule_net_tcp/src/server/        the request loop, dispatch, handlers, tick, retransmit
  userland/capsule_net_tcp/src/server/tcp_rx/ the receive path and the TCP state transitions
  userland/capsule_net_tcp/src/tcp/           segment build/parse, checksum, seq, ISS, RTT, cc, window, TCB
  userland/capsule_net_tcp/src/state/         the TCB table, retx queue, reassembly, timers, process locals
  userland/capsule_net_tcp/src/ip_client/     the net.ip client: config, send, poll over the NIP4 wire
  userland/capsule_net_tcp/Capsule.mk         slug, handle, ports, capability mask, feature, kernel mirror
  userland/capsule_net_tcp/Cargo.toml         panic = "abort" and the binary name
  src/userspace/capsule_net_tcp/              the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/spawn_tcp.rs  the NET-TCP spawn entry and boot marker
  src/capabilities/types.rs                   the capability bit values behind the mask
```

Every reference above is verified against those trees.
