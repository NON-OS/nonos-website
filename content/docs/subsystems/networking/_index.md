---
title: "Networking"
description: "How NØNOS reaches the network. The entire stack, the NIC driver, the TCP/IP implementation, the socket API, name resolution, runs in capsules, not the kernel. A driver capsule o..."
weight: 14
---
How NØNOS reaches the network. The entire stack, the NIC driver, the TCP/IP implementation, the socket
API, name resolution, runs in capsules, not the kernel. A driver capsule owns the hardware, a stack
capsule runs smoltcp over frames it exchanges with the driver by IPC, a sockets capsule exposes a
BSD-socket API to applications, and an optional overlay capsule adds anonymity. The kernel's role is
the IPC that connects them and the broker that grants the driver its device.

| Page | What it covers |
|------|----------------|
| [stack.md](/docs/subsystems/networking/stack/) | The `net_core` capsule: a smoltcp 0.11 interface over a `NicDevice` bridge, the poll loop, and the consolidated-vs-decomposed forms. |
| [drivers.md](/docs/subsystems/networking/drivers/) | The NIC driver capsules (e1000, RTL8139/8169, virtio-net), broker device access, and the frame path to the stack. |
| [sockets.md](/docs/subsystems/networking/sockets/) | The `net.sockets` service, the BSD socket op set, and how `nonos_std`'s `TcpStream` / `UdpSocket` bind to it. |
| [services.md](/docs/subsystems/networking/services/) | DHCP address acquisition (runtime-proven), the DNS resolver, and the optional `nym` anonymity overlay. |

The layering, driver to stack to sockets to application, is the networking expression of the same
principle as the [storage](/docs/subsystems/storage/) and [input](/docs/subsystems/input/) stacks: the kernel
holds only the connective tissue, and each layer is a separately-isolated capsule holding only the
authority it needs. A NIC driver that parses hostile frames and programs DMA is contained in its own
capsule; the TCP/IP stack that parses hostile packets is contained in another; and a program that opens
a socket reaches a capability-checked IPC service rather than a kernel that must be trusted to parse
the wire. The stack is real, not a stub: it is smoltcp, brought up to a bound DHCP lease on a live
boot.

## Sources

The stack is `userland/capsule_net_core/` (smoltcp interface, device bridge, DHCP, DNS, TCP/UDP), the
sockets service is `userland/capsule_net_sockets/` with the kernel-side spawn in
`src/userspace/capsule_net_sockets/`, the drivers are `src/hardware/*_capsule/` and
`userland/capsule_driver_virtio_net/`, and the overlay is `src/userspace/capsule_net_nym/`. The spawn
plan is `src/userspace/init/spawn_plan/network/` and `drivers_nic.rs`. Every page is verified against
those trees with `file:line` references.
