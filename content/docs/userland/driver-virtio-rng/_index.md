---
title: "The virtio-rng Driver Capsule"
description: "capsuledrivervirtiorng is the first real userland hardware-driver capsule in the NØNOS tree: a signed user process that claims a virtio-rng PCI device through the kernel hardwar..."
weight: 400
---
`capsule_driver_virtio_rng` is the first real userland hardware-driver capsule in the NØNOS tree: a
signed user process that claims a virtio-rng PCI device through the kernel hardware broker, drives its
request virtqueue over DMA, and serves raw entropy bytes to the rest of the system over IPC. It runs no
crypto and keeps no pool. It is the device-facing source that the entropy and crypto capsules sit above.
The source is `userland/capsule_driver_virtio_rng/src/`, and this documentation mirrors that source one
page per pillar so a page can be read beside the folder it describes.

The kernel-side mirror that embeds, spawns, and calls the capsule is `src/hardware/virtio_rng_capsule/`;
it must stay in step with the wire format, and every page that touches the wire says so.

## Overview and role

The capsule owns one virtio-rng device end to end. At startup it enumerates the broker device table,
claims the device, maps its register window, binds its interrupt, allocates two DMA regions for the
virtqueue and the entropy buffer, brings the device through the virtio init handshake, and does a sanity
fill before it serves anything ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40), [`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26)). Once up, it answers two IPC
operations: fill a caller's buffer from device entropy, and a structural liveness probe. Everything the
device produces flows out over IPC; nothing crosses back in.

The capsule deliberately does no policy. It does not mix entropy, stretch it, run a CSPRNG, or make any
cryptographic decision; its own README states that plainly, and the code holds no pool object at all
(`README.md:6`). Its relationship to [capsule_entropy](/docs/userland/entropy/) is a layering, not a
duplication. `capsule_entropy` is a monitored pass-through over the CPU `RDRAND` instruction executed in
its own context; it holds no hardware capability and claims no device (its mask carries only IPC, Memory,
and Crypto). This driver is the opposite: it holds the hardware authority and no crypto bit, and it draws
bytes from a virtio device over a virtqueue rather than from a CPU instruction. There is no in-tree wire
between the two today. The only kernel caller of this driver is the driver's own `CAP_DRIVER`-gated
client, and a service that wanted to fold this source into an entropy pool would layer its own check above
that client ([`src/hardware/virtio_rng_capsule/capability.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/capability.rs#L18)). So the two are complementary entropy
sources with distinct authority, not a chain that is wired end to end in the shipping build.

The failure posture is fail-closed. Setup failure aborts startup and retries; a fill the device never
completes returns an error; and there is no software fallback that fabricates entropy if the hardware path
cannot be established ([`src/main.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L65), `README.md:68`).

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and the kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-virtio-rng` | `Capsule.mk:6` |
| Service handle | `driver.virtio_rng` | `Capsule.mk:7`, [`src/hardware/virtio_rng_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/spawn.rs#L32) |
| Namespace | `systems.nonos.driver.virtio_rng` | `Capsule.mk:12` |
| Service endpoint | `service:4200:driver.virtio_rng` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4201:endpoint.4294967302` | `Capsule.mk:14`, `spawn.rs:34` |
| Reply inbox name | `endpoint.4294967302` (= `0x1_0000_0006`) | [`src/hardware/virtio_rng_capsule/client/transport.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/client/transport.rs#L27), [`src/protocol/endpoint.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L21) |
| Capability mask | `0x1F8019` | `Capsule.mk:17` |
| Binary name | `driver_virtio_rng` | `Capsule.mk:10` |
| Kernel mirror | `src/hardware/virtio_rng_capsule` | `Capsule.mk:18` |

The capsule serves `driver.virtio_rng` on port 4200. The reply endpoint it sends responses to is the
kernel-owned inbox `endpoint.4294967302`, whose numeric form `0x1_0000_0006` is the constant
`KERNEL_REPLY_ENDPOINT` the capsule targets ([`src/protocol/endpoint.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L21), [`src/server/error.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L24)).
That is slot 6 in the per-service reply-inbox numbering that runs ramfs=1, keyring=2, entropy=3, crypto=4,
vfs=5, virtio_rng=6, and the kernel mirror names the same slot ([`src/protocol/endpoint.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L19),
[`src/hardware/virtio_rng_capsule/client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/client/transport.rs#L25)). The reply port itself is 4201 (`spawn.rs:34`).

### Mask decomposition

The mask `0x1F8019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x000001  CoreExec     56 -> 1         run as a process
  0x000008  IPC          59 -> 8         send and receive on its endpoints
  0x000010  Memory       60 -> 16        map its own heap and stack
  0x008000  DeviceEnum   71 -> 32768     enumerate the broker device table
  0x010000  Driver       72 -> 65536     claim and release a device
  0x020000  Mmio         73 -> 131072    map the claimed device's register BAR
  0x040000  Irq          74 -> 262144    bind the device interrupt to a slot
  0x080000  Dma          75 -> 524288    allocate device-visible DMA memory
  0x100000  Pio          76 -> 1048576   mint a port-IO window for the register BAR
  --------
  0x1F8019  = 1 + 8 + 16 + 32768 + 65536 + 131072 + 262144 + 524288 + 1048576
```

There is a difference between the manifest mask and the runtime request worth stating plainly. The
`Capsule.mk` comment enumerates `IPC|Memory|Driver|DeviceEnum|Mmio|Irq|Dma|Pio` and writes that as
`0x1F8019` (`Capsule.mk:15`), but those eight bits sum to `0x1F8018`; the value `0x1F8019` carries one
extra bit, `CoreExec` (`0x1`), which the comment does not list, so the comment's own arithmetic
`= 0x1F8019` is wrong for the bits it names (`Capsule.mk:16`). The kernel spawn path is the authority on
what the process actually receives, and it requests exactly `IPC | Memory | Driver | DeviceEnum | Mmio |
Irq | Dma | Pio` with no `CoreExec` bit (`spawn.rs:51`). So the value baked into the manifest is `0x1F8019`
(nine bits including `CoreExec`), while the caps the kernel requests at spawn are `0x1F8018` (the eight the
comment names). Either way there is no `Network` (4), no `FileSystem` (64), no `Crypto` (32), no `Admin`
(512), no `Debug` (256), and no graphics or input bit. The capsule can enumerate and claim a device, map
its registers by MMIO or PIO, bind its IRQ, allocate DMA, and speak IPC, and nothing else.

## The pillars

The source under `userland/capsule_driver_virtio_rng/src/` is a small tree, and the documentation is one
page per real pillar. Bytes flow one way: a fill request arrives over IPC, the server bounds it and runs
one virtqueue round trip, the device writes into the DMA buffer, and the bytes are copied back out over
IPC.

```
  IPC in  ->  server  ->  fill (one virtqueue round trip)  ->  device DMA  ->  IPC out
              bounds       post descriptor, notify, wait        writes into
              the request  for the used ring                    the buffer
```

| Page | Mirrors | What it covers |
|---|---|---|
| [operations.md](/docs/userland/driver-virtio-rng/operations/) | `src/protocol/` + `src/server/` | The `NORD` wire frame, the two ops (`fill_random`, `healthcheck`), the handlers, the error codes, and the kernel-side client that calls them. |
| [hardware.md](/docs/userland/driver-virtio-rng/hardware/) | `src/discover/` + `src/setup/` + [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs) + `src/regs/` | Device discovery, the ordered broker bring-up chain (claim, registers, IRQ, DMA), the virtio init handshake, and the MMIO-or-PIO register accessor. |
| [queue.md](/docs/userland/driver-virtio-rng/queue/) | `src/queue/` + [`src/fill.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs) + [`src/constants/queue.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs) | The split virtqueue, how a fill posts a descriptor and pulls bytes, the completion wait, and the DMA buffer bound. |
| [contributing.md](/docs/userland/driver-virtio-rng/contributing/) | the whole tree | Where to work, how to add an op, the kernel mirror, and the build, sign, and code standards. |
| [debugging.md](/docs/userland/driver-virtio-rng/debugging/) | runtime | The boot marker, the early-exit codes, the broker-phase stalls, and how to read the error codes. |

## Lifecycle

The capsule is spawned at boot through [verified spawn](/docs/security/capsules-and-trust/): its
signature and attestation are checked, its requested capabilities are held against its manifest ceiling,
and only then is its ELF mapped ([`src/hardware/virtio_rng_capsule/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/spawn.rs#L37)). Inside the capsule,
`_start` initializes the heap, loops on `setup::run` until the whole broker chain succeeds, does one
sanity fill and rejects an all-zero result, and only then enters the server loop ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). A
successful spawn prints `[DRIVER-VIRTIO-RNG] capsule spawned` on the boot log; the [debugging](/docs/userland/driver-virtio-rng/debugging/)
page covers what each early-exit code and broker-phase stall means.

## Source map

```
  userland/capsule_driver_virtio_rng/src/main.rs      _start: heap, setup retry, sanity fill, server
  userland/capsule_driver_virtio_rng/src/protocol/    the NORD frame, ops, errno, limits, endpoint
  userland/capsule_driver_virtio_rng/src/server/      the IPC loop, error path, fill/health handlers
  userland/capsule_driver_virtio_rng/src/discover/    device-table match (vendor/device, IRQ, BAR)
  userland/capsule_driver_virtio_rng/src/setup/       the ordered broker bring-up chain and rollback
  userland/capsule_driver_virtio_rng/src/init.rs      the virtio legacy init handshake
  userland/capsule_driver_virtio_rng/src/regs/        the MMIO/PIO register accessor
  userland/capsule_driver_virtio_rng/src/queue/       the split virtqueue (post_request, used ring)
  userland/capsule_driver_virtio_rng/src/fill.rs      one virtqueue round trip + completion wait
  userland/capsule_driver_virtio_rng/src/constants/   device ids, register offsets, queue layout, status
  userland/capsule_driver_virtio_rng/Capsule.mk       slug, handle, ports, capability mask, mirror
  src/hardware/virtio_rng_capsule/                    the verified kernel-side spawn, mirror, and client
  src/capabilities/types.rs                           the capability bit values
```

Every reference above is verified against those trees.
