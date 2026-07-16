---
title: "The L2 Networking Capsule"
description: "capsulenetl2 is the NØNOS Ethernet and ARP capsule: a signed ring-3 capsule that sits one layer above a NIC driver capsule and one layer below the IP stack."
weight: 400
---
`capsule_net_l2` is the NØNOS Ethernet and ARP capsule: a signed ring-3 capsule that sits one layer above a
NIC driver capsule and one layer below the IP stack. It owns nothing in hardware. Its whole job is
link-layer: parse and build the 14-byte Ethernet header, learn the local MAC from the chosen NIC, resolve
an IPv4 next hop to a MAC through ARP, keep a bounded neighbour cache, and move raw frames between the NIC
driver and `net.ip`. It reaches the NIC only by IPC to a driver capsule that holds the device, and it never
programs a register, maps a BAR, or touches DMA. Everything above that IPC boundary, the request server, the
Ethernet helpers, the ARP protocol, and the cache, is ordinary userland code inside the capsule.

The source under `userland/capsule_net_l2/src/` is organized by concern, and this documentation mirrors that
structure one page per pillar so a page can be read beside the folder it describes. For where this capsule
fits in the larger stack, see the [networking subsystem](/docs/subsystems/networking/).

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-l2` | `Capsule.mk:6` |
| Service handle | `net.l2` | `Capsule.mk:7`, [`src/userspace/capsule_net_l2/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_l2/spawn.rs#L35) |
| Namespace | `systems.nonos.net.l2` | `Capsule.mk:12` |
| Service endpoint | `service:4400:net.l2` | `Capsule.mk:13`, `spawn.rs:36`, `spawn.rs:37` |
| Reply endpoint | `reply:4401:endpoint.net.l2.reply` | `Capsule.mk:14`, `spawn.rs:37`, `spawn.rs:38` |
| Capability mask | `0x0001d` | `Capsule.mk:16` |
| Binary name | `net_l2` | `Capsule.mk:10`, `Cargo.toml:20` |
| Wire magic | `0x4E4C_3200` ("NL2\0") | [`src/protocol/header.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L31) |
| Kernel mirror | `src/userspace/capsule_net_l2` | [`src/userspace/capsule_net_l2/spawn.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_l2/spawn.rs#L41) |

The service endpoint number `4400` is the port the kernel binds the service to, and `4401` is the reply
port; both are constants in the spawn mirror (`spawn.rs:36`, `spawn.rs:38`). The reply inbox name
`endpoint.net.l2.reply` matches the manifest byte for byte (`Capsule.mk:14`, `spawn.rs:37`).

The mask `0x0001d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec     bit()      1   types.rs:56
  0x00004  Network      bit()      4   types.rs:58
  0x00008  IPC          bit()      8   types.rs:59
  0x00010  Memory       bit()     16   types.rs:60
  -------
  0x0001d  = 1 + 4 + 8 + 16
```

This is a pure IPC capsule. It holds none of the hardware-broker authority bits: no `DeviceEnum` (32768),
no `Driver` (65536), no `Mmio` (131072), no `Irq` (262144), no `Dma` (524288), no `Pio` (1048576). It holds
no `FileSystem` (64), `Crypto` (32), `Admin` (512), `Debug` (256), or graphics authority. The NIC-side
authority lives one layer below in the driver capsule (`spawn.rs:17`); this service reaches the NIC only
through the service registry, never through the kernel. The `Network` bit is what lets it participate in the
network stack, `IPC` and `Memory` are the ordinary application bits, and `CoreExec` is the run bit every
capsule carries.

The mask in the manifest is the capability ceiling the signed artifact is bound to
(`nonos-mk/capsule.mk:71`, `nonos-mk/capsule.mk:230`). The kernel spawn path requests a subset of it at
runtime: `Capability::IPC | Capability::Memory | Capability::Network` (`spawn.rs:55`), which is `0x1c`. The
`CoreExec` bit is present in the manifest ceiling but is not part of the runtime request list; the spawn
never asks for authority the manifest does not cover.

## The four pillars

The capsule reads as four concerns, and the documentation is one page each. A client request enters through
the protocol and server (the operations page), which reaches the chosen NIC through the NIC client (the
NIC-link page), building and parsing Ethernet and ARP frames (the framing page), and resolving neighbours
against a bounded cache the cache page owns.

```
  client op   ->   server/protocol   ->   ethernet + ARP   ->   nic_client   ->   NIC driver capsule
  NL2 IPC          parse, dispatch        frame build/parse     NNET IPC call     driver.virtio_net0 / e1000 / rtl*

  inbound path (poll):
  nic_client poll -> ingress::observe -> ARP learn + reply -> frame handed up to net.ip
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-l2/operations/) | `src/protocol/`, `src/server/`, `src/setup/`, [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | The `NL2` wire format, the request loop, the seven client ops, the per-op payloads, the caller authorization, the errno set, and the one-time NIC bind. |
| [framing.md](/docs/userland/net-l2/framing/) | `src/ethernet/`, `src/arp/packet/`, [`src/arp/handle.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs), [`src/ingress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs) | The Ethernet header, the ARP packet parse and build, the request/reply exchange, and the ingress observer that seeds the cache. |
| [cache.md](/docs/userland/net-l2/cache/) | `src/arp/cache/` | The bounded neighbour cache, the learn policy, the pending-request ring, and oldest-first eviction. |
| [nic-link.md](/docs/userland/net-l2/nic-link/) | `src/nic_client/` | The `NNET` protocol to the driver capsule, the MAC read, the frame TX and RX paths, and the request-id sequence. |
| [contributing.md](/docs/userland/net-l2/contributing/) | the whole tree | Where each concern lives, how to add a client op or a NIC op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-l2/debugging/) | runtime | The boot marker, the setup retry loop, and the runtime failure modes: no link, no neighbour, RX empty, TX busy, and a permission reject. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops in `wait_for_setup` until
`setup::run` succeeds, and only then enters `server::run`, which loops forever ([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34)). Setup
resolves the first available NIC driver from the service registry, records its port and pid, and reads its
MAC into capsule state ([`src/setup/mod.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L46)); if no NIC is registered yet it yields and retries rather
than failing ([`src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L42)). The IPv4 binding stays zero until the DHCP client pushes a leased address
down through `OP_SET_IP` ([`src/setup/mod.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L44), [`src/server/handlers/set_ip.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_ip.rs#L25)).

The kernel spawns the capsule under the network spawn plan, checking its signature, its NØNOS-ID cert, and
its manifest, and holding its requested capabilities against its manifest ceiling before its ELF is mapped
([`src/userspace/capsule_net_l2/spawn.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_l2/spawn.rs#L41), `spawn.rs:60`). The spawn is gated on the
`nonos-capsule-net-l2` feature ([`src/userspace/init/spawn_plan/network/spawn_l2.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_l2.rs#L18)) and prints a
`NET-L2` boot marker on success; the [debugging](/docs/userland/net-l2/debugging/) page covers what that marker and each failure
state mean.

Once setup succeeds the capsule is the link layer. `net.ip` and the DHCP client speak the small `NL2` binary
protocol over IPC to read the MAC and link state, send and poll raw frames, resolve a neighbour, and set the
interface IPv4. The capsule does not route IP, run a transport, do DHCP or DNS, keep a socket table, or
persist frames; it is the link-layer mechanism a higher-level IP stack is built on, not the policy.

## Source map

```
  userland/capsule_net_l2/src/main.rs        _start -> wait_for_setup -> server::run; module list
  userland/capsule_net_l2/src/protocol/      the NL2 wire format: header, ops, errno, limits, parse/encode
  userland/capsule_net_l2/src/server/        the request loop, the caller authz, and one handler per op
  userland/capsule_net_l2/src/setup/         the one-time NIC discovery and MAC read
  userland/capsule_net_l2/src/state.rs       the capsule state: NIC port/pid, MAC, IPv4, ARP cache
  userland/capsule_net_l2/src/ethernet/      the Ethernet header parse/write and payload split
  userland/capsule_net_l2/src/arp/           the ARP packet codec, the inbound handler, and the cache
  userland/capsule_net_l2/src/ingress.rs     the inbound observer that learns ARP and answers requests
  userland/capsule_net_l2/src/nic_client/    the NNET IPC client to the driver capsule
  userland/capsule_net_l2/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_net_l2/spawn.rs      the kernel-side verified spawn: name, ports, requested caps
  src/userspace/init/spawn_plan/network/spawn_l2.rs  the feature-gated spawn entry and boot marker
  src/capabilities/types.rs                  the capability bit values behind the mask
```

Every reference above is verified against those trees.
</content>
</invoke>
