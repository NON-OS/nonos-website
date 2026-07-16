---
title: "The IPv4 Capsule"
description: "capsulenetip is the NØNOS IPv4 network layer: a signed ring-3 capsule that owns interface configuration and the route table, validates and builds IPv4 datagrams, and moves proto..."
weight: 400
---
`capsule_net_ip` is the NØNOS IPv4 network layer: a signed ring-3 capsule that owns interface
configuration and the route table, validates and builds IPv4 datagrams, and moves protocol payloads
between the transport capsules above it and the link layer below. It does not run in the kernel and it
does not touch a NIC. It reaches the wire only by talking to `net.l2` over IPC, which owns the device;
everything above that seam, the IPv4 parse and build path, the RFC 1071 checksum, the longest-prefix
route table, the ICMP echo responder, and the protocol demux, is ordinary userland code inside the
capsule.

It is one layer of the decomposed [network stack](/docs/subsystems/networking/): the
maximal-isolation form where each protocol layer is a separately-sandboxed capsule that speaks to its
neighbors over IPC rather than a kernel that must be trusted to parse the wire. In that layering
`net.ip` sits below the transport capsules (`net.udp`, `net.tcp`) and the ICMP path, and above
`net.l2`, which owns the NIC and ARP.

The source under `userland/capsule_net_ip/src/` is organized by concern, and this documentation mirrors
that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-ip` | `Capsule.mk:7` |
| Service handle | `net.ip` | `Capsule.mk:8`, [`src/userspace/capsule_net_ip/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_ip/spawn.rs#L35) |
| Namespace | `systems.nonos.net.ip` | `Capsule.mk:13` |
| Service endpoint | `service:4402:net.ip` | `Capsule.mk:14`, `spawn.rs:36` |
| Reply endpoint | `reply:4403:endpoint.net.ip.reply` | `Capsule.mk:15`, `spawn.rs:37` |
| Capability mask | `0x0001d` | `Capsule.mk:17` |
| Binary name | `net_ip` | `Capsule.mk:11`, `Cargo.toml:21` |
| Kernel mirror | `src/userspace/capsule_net_ip` | [`src/userspace/capsule_net_ip/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_ip/spawn.rs) |
| Wire magic | `NIP4` (`0x4E49_5034`) | [`src/protocol/header.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L23) |

The service port `4402` and the reply port `4403` are the same numbers in the manifest and in the
kernel spawn record (`Capsule.mk:14`, `Capsule.mk:15`, `spawn.rs:36`, `spawn.rs:38`). Unlike a driver
whose reply inbox is a numeric kernel constant, this capsule's reply inbox is a named endpoint,
`endpoint.net.ip.reply` (`spawn.rs:37`); at runtime the capsule sends every reply straight back to the
attested sender pid with `mk_ipc_reply` ([`src/server/respond.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L58)).

The mask `0x0001d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec     bit()   1   types.rs:56
  0x00004  Network      bit()   4   types.rs:58
  0x00008  IPC          bit()   8   types.rs:59
  0x00010  Memory       bit()  16   types.rs:60
  -------
  0x0001d  = 1 + 4 + 8 + 16
```

This is a policy capsule, not a driver: it holds none of the hardware-broker authority bits. There is
no `DeviceEnum` (32768), no `Driver` (65536), no `Mmio` (131072), `Irq` (262144), `Dma` (524288), or
`Pio` (1048576), and no `FileSystem` (64), `Admin` (512), or `Debug` (256) authority
([`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)). It cannot reach a NIC; it depends on `net.l2` for that. The `Network`
bit names it a participant in the stack, and `IPC` plus `Memory` are the two bits it shares with any
ordinary capsule.

One caveat worth stating plainly: the kernel spawn path requests only `IPC | Memory | Network`, which
is `0x1c` (`spawn.rs:55`), while the manifest ceiling is `0x1d` and additionally carries the `CoreExec`
bit (`Capsule.mk:17`). The requested set is a subset of the manifest ceiling, so the spawn is accepted;
the `CoreExec` bit is present in the ceiling but not requested at spawn.

## The code pillars

The capsule reads as a request path and the machinery that serves it. A client request enters through
the protocol and server (the operations page), is answered against interface state and the route table
(the state page), and, on the packet ops, runs through the IPv4 parse or build path (the IPv4 page)
and reaches the wire through the link client. The ICMP echo responder sits inside the ingress path and
answers ping without ever surfacing it to a caller.

```
  net.udp / net.tcp / ICMP client
      |  transport payload over net.ip IPC
      v
  server/protocol  ->  ipv4 build + route lookup  ->  l2_client (ARP + TX)  ->  net.l2
      ^                                                                            |
      |  poll                        ingress: strip L2, ipv4 parse, ICMP echo  <---'
      `-- OP_POLL_PACKET  <--  rx queue  <--  protocol demux
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-ip/operations/) | `src/protocol/`, `src/server/` | The `NIP4` wire format, the request loop, the seven client ops, per-op bodies, the authorization tiers, and the errno set. |
| [ipv4.md](/docs/userland/net-ip/ipv4/) | `src/ipv4/`, `src/egress/`, [`src/ingress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs) | The RFC 791 header parse and build, the RFC 1071 checksum, address and subnet helpers, and the egress and ingress framing that wrap them. |
| [icmp.md](/docs/userland/net-ip/icmp/) | `src/icmp/` | The ICMP header, the echo parse and reply build, and the auto-responder that answers ping inside ingress. |
| [routing.md](/docs/userland/net-ip/routing/) | `src/route/`, `src/l2_client/` | The 16-entry longest-prefix route table and the `net.l2` client: MAC read, ARP resolve, frame TX, and frame poll. |
| [state.md](/docs/userland/net-ip/state/) | `src/state/`, [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | The interface config, the identification counter, the bounded receive queue, and the bring-up that resolves `net.l2` and reads the MAC. |
| [contributing.md](/docs/userland/net-ip/contributing/) | the whole tree | Where each concern lives, how to add a client op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-ip/debugging/) | runtime | The boot marker, the setup retry loop, and the runtime failure modes behind each errno. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops `setup::run` until it
succeeds before handing off to the request server, which loops forever ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38)). `setup::run`
resolves `net.l2` through the service registry and reads the NIC MAC through it; until `net.l2` is up
the setup call fails and the capsule yields and retries rather than exiting ([`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46),
[`src/setup.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L35)). The kernel spawns it through verified spawn under the network spawn plan, checking
its signature, manifest, and attestation and holding its requested capabilities against its manifest
ceiling before its ELF is mapped ([`src/userspace/capsule_net_ip/spawn.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_ip/spawn.rs#L41),
[`src/userspace/init/spawn_plan/network/spawn_ip.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_ip.rs#L21)). A successful spawn prints `[NET-IP] capsule
spawned` on the boot log; the [debugging](/docs/userland/net-ip/debugging/) page covers what that and each errno mean.

Once setup succeeds the capsule is the IPv4 layer of the host. It receives interface configuration and
routes over IPC, validates inbound datagrams and dispatches their payloads by protocol number, builds
outbound datagrams with a valid header checksum, resolves the next hop, and asks `net.l2` to wrap and
send the frame. It does not own the NIC, does not resolve neighbours itself, and does not hold any
transport or socket state; those belong to `net.l2` below and the transport capsules above. It is the
mechanism the IPv4 host is built on, not the transport or socket policy.

## Source map

```
  userland/capsule_net_ip/src/main.rs        _start -> setup retry loop -> server::run; module list
  userland/capsule_net_ip/src/protocol/      the NIP4 wire format: magic, ops, errno, limits
  userland/capsule_net_ip/src/server/        the request loop, the per-op handlers, and authz
  userland/capsule_net_ip/src/ipv4/          RFC 791 parse/build, RFC 1071 checksum, address helpers
  userland/capsule_net_ip/src/egress/        outbound framing: route, ARP, IPv4 build, L2 send
  userland/capsule_net_ip/src/ingress.rs     inbound framing: strip L2, IPv4 parse, ICMP echo hook
  userland/capsule_net_ip/src/icmp/          ICMP header, echo parse/build, the auto-responder
  userland/capsule_net_ip/src/route/         Route and the 16-entry longest-prefix Table
  userland/capsule_net_ip/src/l2_client/     the net.l2 client: MAC, ARP, TX, RX over IPC
  userland/capsule_net_ip/src/state/         InterfaceConfig, the id counter, the bounded rx queue
  userland/capsule_net_ip/src/setup.rs       resolve net.l2 and read the NIC MAC
  userland/capsule_net_ip/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_net_ip/spawn.rs      the kernel-side verified spawn and requested caps
  src/userspace/init/spawn_plan/network/spawn_ip.rs  the NET-IP spawn entry and boot marker
  src/capabilities/types.rs                  the capability bit values behind the mask
```

Every reference above is verified against those trees.
</content>
