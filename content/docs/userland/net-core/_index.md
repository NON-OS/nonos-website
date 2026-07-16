---
title: "The net_core Capsule"
description: "netcore is the core of the NØNOS network stack: a signed ring-3 capsule that runs a full smoltcp TCP/IP interface over a NIC driver it reaches only by IPC, and serves the net."
weight: 400
---
`net_core` is the core of the NØNOS network stack: a signed ring-3 capsule that runs a full smoltcp
TCP/IP interface over a NIC driver it reaches only by IPC, and serves the `net.*` services the rest of the
system uses to speak to the network. It does not run in the kernel and it does not touch the hardware. It
finds a NIC driver capsule through the service registry, exchanges Ethernet frames with it over a small
binary protocol, and drives one smoltcp `Interface` that owns DHCP, DNS, TCP, and UDP. Everything above the
frame exchange, the address configuration, the socket table, and the wire protocols clients speak, is
ordinary userland code inside the capsule.

The source under `userland/capsule_net_core/src/` is organized by concern, and this documentation mirrors
that structure one page per pillar so a page can be read beside the folder it describes. For where this
capsule sits in the wider stack, see the [networking subsystem](/docs/subsystems/networking/).

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-core` | `Capsule.mk:5` |
| Service handle | `net.core` | `Capsule.mk:6`, [`src/userspace/capsule_net_core/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_core/spawn.rs#L31) |
| Namespace | `systems.nonos.net.core` | `Capsule.mk:11` |
| Service endpoint | `service:4480:net.core` | `Capsule.mk:12`, `spawn.rs:32` |
| Reply endpoint | `reply:4481:endpoint.net.core.reply` | `Capsule.mk:13`, `spawn.rs:33` |
| Capability mask | `0x0043d` | `Capsule.mk:14` |
| Binary name | `net_core` | `Capsule.mk:9`, `Cargo.toml:9` |
| Kernel mirror | `src/userspace/capsule_net_core` | `Capsule.mk:15`, `spawn.rs` |

The `net.core` handle at port 4480 is the identity the kernel spawns and the registry knows the capsule by
([`src/userspace/capsule_net_core/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_core/spawn.rs#L31)). It is not the service applications call. Once the capsule is
up it registers four separate service names of its own, each at its own port ([`src/register.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L29)):

| Service | Port | Source |
|---|---|---|
| `net.tcp` | 4476 | [`src/register.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L19), [`src/register.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L24) |
| `net.udp` | 4472 | [`src/register.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L20), [`src/register.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L25) |
| `net.dhcp.client` | 4474 | [`src/register.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L21), [`src/register.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L26) |
| `net.dns` | 4478 | [`src/register.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L22), [`src/register.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L27) |

The mask `0x0043d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec         bit()       1   types.rs:56
  0x00004  Network          bit()       4   types.rs:58
  0x00008  IPC              bit()       8   types.rs:59
  0x00010  Memory           bit()      16   types.rs:60
  0x00020  Crypto           bit()      32   types.rs:61
  0x00400  RegisterService  bit()    1024   types.rs:66
  -------
  0x0043d  = 1 + 4 + 8 + 16 + 32 + 1024
```

The kernel spawn path requests five of those six bits explicitly: `IPC | Memory | Crypto | Network |
RegisterService` ([`src/userspace/capsule_net_core/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_core/spawn.rs#L50)), which is `0x43c`. The manifest ceiling in
`Capsule.mk` is `0x43d`, the same set plus `CoreExec` (bit 1), the run-as-a-process bit every capsule holds
to execute at all. The capsule holds `Network` (its reason to exist), `Crypto` (it draws a random seed for
smoltcp at build time, [`src/iface/build.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/build.rs#L27)), `RegisterService` (it registers `net.tcp`, `net.udp`,
`net.dhcp.client`, and `net.dns`, [`src/register.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L29)), and the `IPC` and `Memory` bits every capsule
needs. It holds no driver-broker authority: no `DeviceEnum`, `Driver`, `Mmio`, `Irq`, `Dma`, or `Pio`. It
never touches the NIC directly; it reaches a driver capsule that holds those bits, over IPC. Compromising
`net_core` yields a hostile TCP/IP stack, which is why it is isolated from both the applications above it
and the driver below it, but it yields no device.

## The four pillars

The capsule reads as four concerns, and the documentation is one page each. Data flows in a loop: the
device bridge exchanges frames with the NIC driver, the interface drives smoltcp over those frames and
acquires an address, the server decodes a client request and dispatches it, and the state tables hold the
sockets and lease every request works against.

```
  NIC driver  <--frames-->  device/   -->  iface/   -->  smoltcp Interface
  (IPC)                     the bridge      poll + DHCP    sockets + routes
                                                              |
  client op   -->  server/  -->  handlers  -->  state/ + handles/ + udp_ports/
  net.tcp/udp/dns  decode         per op         lease, socket tables
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/net-core/protocol/) | `src/protocol/`, [`src/register.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs) | The four wire protocols (`NNET`, `NTCP`, `NUDP`, `NDNS`, `NDHC`), the shared 20-byte header, the full op list per service, the errno sets, and the service names and ports the capsule registers. |
| [server.md](/docs/userland/net-core/server/) | `src/server/` | The single-threaded request loop that also pumps the stack, the header parse and magic dispatch, the reply encoder, and every handler: TCP connect/send/recv/close/state, UDP bind/send/recv/unbind, DNS resolve, DHCP lease status, and health. |
| [device.md](/docs/userland/net-core/device/) | `src/device/`, [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | The NIC discovery and link bring-up, the `NicDevice` smoltcp `phy::Device` bridge, the RX and TX frame path over IPC, and the request-id sequence. |
| [iface.md](/docs/userland/net-core/iface/) | `src/iface/`, [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs), [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs), [`src/udp_ports.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs) | Building the smoltcp `Interface`, the poll loop, the DHCPv4 client and DNS socket install, the shared `NetState`, and the per-client socket tables. |
| [contributing.md](/docs/userland/net-core/contributing/) | the whole tree | Where each concern lives, how to add a service op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-core/debugging/) | runtime | The boot marker, the lease markers, and the runtime failure modes: no NIC, link down, no lease, no packets. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, waits for setup to succeed, registers its
services, and enters the server loop, which never returns ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36)). `wait_for_setup` retries
`setup::run` forever while the NIC is not yet found or the link is not yet up, yielding between attempts,
and exits only on a hard error ([`src/main.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L45)). `setup::run` discovers a NIC driver by service name,
brings the link up, reads the MAC, and builds the smoltcp state ([`src/setup.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L46)). The kernel spawns the
capsule through [verified spawn](/docs/subsystems/networking/) under the network spawn plan,
checking its signature and attestation and holding its requested capabilities against its manifest ceiling
before its ELF is mapped ([`src/userspace/init/spawn_plan/network/spawn_core.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_core.rs#L21)). A successful spawn
prints `[NET-CORE] capsule spawned` on the boot log; the [debugging](/docs/userland/net-core/debugging/) page covers that marker
and the lease markers that follow.

Once setup succeeds and the services are registered, the capsule is the system's TCP/IP stack. Clients
speak four small binary protocols over IPC to open and drive TCP connections and UDP sockets, resolve names,
and read the DHCP lease. The stack is real, not a stub: it is smoltcp 0.11, brought to a bound DHCP lease on
a live boot (`Cargo.toml:15`).

## Source map

```
  userland/capsule_net_core/src/main.rs        _start -> wait_for_setup -> register::all -> server::run
  userland/capsule_net_core/src/setup.rs       NIC discovery, link-up, MAC, build the smoltcp state
  userland/capsule_net_core/src/register.rs    the four net.* service names and their ports
  userland/capsule_net_core/src/protocol/      the NNET/NTCP/NUDP/NDNS/NDHC wire formats, ops, errnos
  userland/capsule_net_core/src/server/        the request loop, the parse, the reply, and every handler
  userland/capsule_net_core/src/device/        the NIC driver link, the phy::Device bridge, RX/TX frames
  userland/capsule_net_core/src/iface/         building the smoltcp Interface, the poll loop, DHCP, DNS
  userland/capsule_net_core/src/state.rs       NetState and the DHCP lease under a spin::Mutex
  userland/capsule_net_core/src/handles.rs     the per-client TCP socket-handle table
  userland/capsule_net_core/src/udp_ports.rs   the per-client UDP socket table keyed by local port
  userland/capsule_net_core/Cargo.toml         the binary name, smoltcp features, panic = "abort"
  userland/capsule_net_core/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_net_core/              the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/       the NET-CORE spawn entry
  src/capabilities/types.rs                    the capability bit values behind the mask
```

Every reference above is verified against those trees.
