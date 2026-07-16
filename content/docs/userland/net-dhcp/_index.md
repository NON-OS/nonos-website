---
title: "The DHCPv4 Client Capsule"
description: "capsulenetdhcp is the NØNOS DHCPv4 client: a signed ring-3 capsule that acquires, renews, reports, and releases an IPv4 lease and installs the accepted lease into the IP layer."
weight: 400
---
`capsule_net_dhcp` is the NØNOS DHCPv4 client: a signed ring-3 capsule that acquires, renews, reports, and
releases an IPv4 lease and installs the accepted lease into the IP layer. It does not run in the kernel and
it holds no network device. Because BOOTP has to move before an IPv4 address exists, it does not go through
the UDP transport; it sends and receives raw broadcast ethernet frames by talking to the L2 capsule
(`net.l2`) as an ordinary IPC client, and once the server acknowledges a lease it installs the address into
the IP capsule (`net.ip`) by IPC. Upstream, it serves five lease operations to whatever boot-path or network
manager holds the right to reach it. The kernel neither runs the DHCP state machine, parses BOOTP messages,
nor mutates interface configuration; all of that is userland code inside this capsule.

The source under `userland/capsule_net_dhcp/src/` is organized by concern, and this documentation mirrors
that structure so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-dhcp` | `Capsule.mk:5` |
| Service handle | `net.dhcp.client` | `Capsule.mk:6`, [`src/userspace/capsule_net_dhcp/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dhcp/spawn.rs#L36) |
| Namespace | `systems.nonos.net.dhcp.client` | `Capsule.mk:11` |
| Service endpoint | `service:4440:net.dhcp.client` | `Capsule.mk:12`, `spawn.rs:37` |
| Reply endpoint | `reply:4441:endpoint.net.dhcp.client.reply` | `Capsule.mk:13`, `spawn.rs:38`, `spawn.rs:39` |
| Capability mask | `0x0003d` | `Capsule.mk:14` |
| Binary name | `net_dhcp` | `Capsule.mk:9`, `Cargo.toml:22` |
| Kernel mirror | `src/userspace/capsule_net_dhcp` | `Capsule.mk:15`, [`src/userspace/capsule_net_dhcp/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dhcp/spawn.rs) |

The service port `4440` and the reply port `4441` are the numbers the kernel binds when it spawns the
capsule (`spawn.rs:37`, `spawn.rs:39`); the reply inbox name `endpoint.net.dhcp.client.reply` is the string
the spawn record carries as the reply inbox (`spawn.rs:38`).

The mask `0x0003d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec   bit()    1   types.rs:56
  0x00004  Network    bit()    4   types.rs:58
  0x00008  IPC        bit()    8   types.rs:59
  0x00010  Memory     bit()   16   types.rs:60
  0x00020  Crypto     bit()   32   types.rs:61
  -------
  0x0003d  = 1 + 4 + 8 + 16 + 32
```

Five bits, and no more. `CoreExec` lets it run as a process, `Memory` lets it map its own heap and stack,
`IPC` lets it send and receive on its endpoints, `Network` marks it a member of the network trust domain so
`net.l2` and `net.ip` answer it, and `Crypto` lets it draw a random transaction id: the client mints its
BOOTP `xid` from `crypto_random` ([`src/state/global.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L56)), which is the syscall the `Crypto` bit gates. It
holds no driver-broker authority (`DeviceEnum`, `Driver`, `Mmio`, `Irq`, `Dma`, `Pio`, at `types.rs:71`
through `types.rs:76`), no filesystem bit (64), no graphics, no admin, and no debug. It never touches a NIC.
The only way it reaches the wire is by asking `net.l2`, and the only inbound surface it exposes is the
`net.dhcp.client` request server.

The kernel spawn path requests four of those five bits explicitly: `IPC | Memory | Crypto | Network`
(`spawn.rs:56`), which is `0x3c`. The `CoreExec` bit in the manifest mask is the process-execution right
every capsule carries; the spawn record names only the four service-authority bits it adds on top. The caps
that land on the process control block come from the verified manifest, never from `requested_caps`, which is
only the upper bound the spawn site is willing to grant ([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L23));
the spawn is verified before the ELF is mapped ([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L57)),
so the capsule can never run with more than the mask above.

The source README on this capsule is stale on two points. It states the mask is `0x00018` (IPC and memory
only) and that the capsule talks to `net.udp`; both are wrong. The authoritative mask is `0x0003d`
(`Capsule.mk:14`), matched by the spawn record's requested set plus `CoreExec` (`spawn.rs:56`), and the
transport is `net.l2` for the outbound BOOTP exchange ([`src/l2_client/wire.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/wire.rs#L22)), with `net.ip` for lease
install ([`src/ip_client/wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L21)). This page and the pillar pages describe the code as it is.

## The four pillars

The capsule reads as four concerns, and the documentation is one page each. A request enters through the
protocol and server (the operations page), which drives the DHCP acquisition ladder and holds the lease (the
lease page), which sends and waits for BOOTP over `net.l2` and installs the accepted lease into `net.ip`
(the transport page), all built on the wire codecs for DHCP messages and ethernet frames (the framing page).

```
  client op   ->   server         ->   dora ladder      ->   net.l2 (raw frames)
  NDHC IPC         decode, dispatch     DISCOVER..ACK         send + poll
                                        renew / release       net.ip (lease install)

  build/parse of BOOTP options and Eth+IPv4+UDP framing sits under the transport
  path (the framing page); the active lease and client state live in state/.
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-dhcp/operations/) | `src/protocol/`, `src/server/` | The `NDHC` wire format, the request loop, the five lease ops, the status reply body, the errno set, and the reply path. |
| [lease.md](/docs/userland/net-dhcp/lease/) | `src/dora/`, `src/dhcp/`, `src/state/`, `src/setup/` | The DISCOVER/OFFER/REQUEST/ACK ladder, NAK and timeout, renew and release, the client state machine, the lease record, and bring-up. |
| [transport.md](/docs/userland/net-dhcp/transport/) | `src/l2_client/`, `src/ip_client/` | The `net.l2` raw-frame client (MAC, send, poll, set-ip) and the `net.ip` client that installs the lease with `OP_SET_CONFIG`. |
| [framing.md](/docs/userland/net-dhcp/framing/) | `src/dhcp/`, `src/frame/` | The BOOTP fixed region and option build and parse, the subnet-mask-to-prefix conversion, and the Ethernet/IPv4/UDP compose and extract with the RFC 1071 checksum. |
| [contributing.md](/docs/userland/net-dhcp/contributing/) | the whole tree | Where each concern lives, how to add a lease op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-dhcp/debugging/) | runtime | The boot marker, the setup and initial-acquire loops, and the runtime errno failure modes: no link, timeout, and NAK. |

For where DHCP sits in the wider stack, see the [networking subsystem](/docs/subsystems/networking/).

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, loops calling `setup::run` until it
succeeds, makes a bounded attempt to acquire an initial lease, and only then enters the request server, which
loops forever ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). `setup::run` resolves `net.l2` and `net.ip` through the service registry,
caches both service ports, and reads the NIC MAC from `net.l2` so the data path does not repeat those
round-trips ([`src/setup/run.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L45)); a failed setup yields and retries ([`src/main.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L44)). The initial
acquire runs the DORA ladder up to sixteen times with a yield between tries, so a lease is usually bound by
the time the server accepts requests ([`src/main.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L55)). The kernel spawns it under the network spawn plan,
checking its signature and attestation and holding its manifest capabilities before its ELF is mapped
([`src/userspace/init/spawn_plan/network/spawn_dhcp.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_dhcp.rs#L20)). A successful spawn prints `[NET-DHCP] capsule spawned`
on the boot log; the [debugging](/docs/userland/net-dhcp/debugging/) page covers what that marker means.

Once running, the capsule is a lease manager. Clients speak the small `NDHC` binary protocol over IPC to
request or restart acquisition, read the current lease and client state, renew before expiry, and release the
lease. The capsule owns the DHCP client state machine, the active lease, and the pending transaction id;
`net.ip` owns the installed interface configuration. It keeps no lease history and persists nothing to disk.

## Source map

```
  userland/capsule_net_dhcp/src/main.rs        _start -> setup retry -> initial acquire -> server::run; module list
  userland/capsule_net_dhcp/src/protocol/      the NDHC wire format: magic, ops, errno
  userland/capsule_net_dhcp/src/server/        the request loop, parse, respond, one handler per lease op
  userland/capsule_net_dhcp/src/dora/          the DISCOVER/OFFER/REQUEST/ACK ladder, install, release, mask
  userland/capsule_net_dhcp/src/dhcp/          the BOOTP message, build, parse, and RFC 2131/2132 constants
  userland/capsule_net_dhcp/src/frame/         the Eth/IPv4/UDP compose and extract and the RFC 1071 checksum
  userland/capsule_net_dhcp/src/l2_client/     the net.l2 client: MAC, send frame, poll frame, set ip
  userland/capsule_net_dhcp/src/ip_client/     the net.ip client: OP_SET_CONFIG lease install and clear
  userland/capsule_net_dhcp/src/state/         the shared state, the client state, and the lease record
  userland/capsule_net_dhcp/src/setup/         resolve net.l2 and net.ip and read the NIC MAC
  userland/capsule_net_dhcp/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_net_dhcp/              the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/spawn_dhcp.rs   the NET-DHCP spawn entry
  src/capabilities/types.rs                    the capability bit values behind the mask
```

Every reference above is verified against those trees.
