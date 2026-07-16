---
title: "NIC Drivers"
description: "The network interface controller is driven by a capsule, like every other device in NØNOS."
weight: 2
---
The network interface controller is driven by a capsule, like every other device in NØNOS. The
driver claims its NIC through the hardware broker, sets up its DMA rings, and exchanges Ethernet
frames with the [network stack](/docs/subsystems/networking/stack/) over IPC. This page documents the driver capsules and the
frame path. The code is under `src/hardware/*_capsule/` and `userland/capsule_driver_*`.

## The driver capsules

Several NIC drivers exist, each a capsule spawned from the driver bring-up plan
([`src/userspace/init/spawn_plan/drivers_nic.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs)):

```
  spawn_e1000()      Intel e1000 / e1000e
  spawn_rtl8139()    Realtek RTL8139
  spawn_rtl8169()    Realtek RTL8169
  (virtio-net)       the virtio network device (QEMU's default)
```

The virtio-net driver has its own capsule documentation under
[userland/driver-virtio-net](/docs/userland/driver-virtio-net/): the NNET protocol, the broker
bring-up transaction, and the RX/TX virtqueue engine, one page each.

Each is feature-gated, so a build includes the drivers it needs, and each is a signed capsule the
init sequence spawns like any other. A driver capsule claims its NIC through the
[hardware broker](/docs/subsystems/hardware-broker/): it claims the device, maps the controller registers
by MMIO, allocates DMA memory for its receive and transmit rings, and binds the device interrupt, all
through the broker's grant paths, so the driver runs in ring 3 with exactly the device authority it
was granted and nothing more.

## The frame path

A driver's job is to move Ethernet frames between the wire and the stack. On receive, the NIC DMAs a
frame into the driver's receive ring, the driver's interrupt handling (through the broker's
[IRQ](/docs/subsystems/hardware-broker/irq/) wait path) picks it up, and the driver hands the frame to
[net_core](/docs/subsystems/networking/stack/) over IPC, where the `NicDevice` rx-token feeds it into smoltcp. On transmit, the
reverse: `net_core`'s tx-token sends a frame to the driver over IPC, and the driver places it in the
transmit ring for the NIC to DMA out. Neither side crosses the other's boundary: the driver never
speaks IP, and the stack never touches a register or a ring.

## Why a capsule

Putting the NIC driver in a capsule is the same containment argument as the [block drivers](/docs/subsystems/storage/block-device/):
a network driver parses attacker-influenced input (every received frame comes from the network) and
programs DMA-capable hardware, which is exactly the combination that makes a driver bug dangerous. As
a capsule it holds only its device's broker grants, so a compromised NIC driver can corrupt its own
rings and frames but cannot map arbitrary memory, reach another device, or fault the kernel. The
frames it hands up are just bytes the stack validates.

## Source

```
  src/userspace/init/spawn_plan/drivers_nic.rs   the NIC driver spawns
  src/hardware/e1000_capsule/, rtl8169_capsule/   the driver capsules (kernel-side spawn)
  userland/capsule_driver_virtio_net/             the virtio-net driver source
  userland/capsule_net_core/src/device/           the NicDevice bridge on the stack side
```
