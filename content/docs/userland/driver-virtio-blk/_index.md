---
title: "The virtio-blk Driver Capsule"
description: "capsuledrivervirtioblk is the virtio block-device backend: a signed userland capsule that claims one virtio-blk PCI device, drives its virtqueue over brokered DMA, and serves se..."
weight: 400
---
`capsule_driver_virtio_blk` is the virtio block-device backend: a signed userland capsule that claims one
virtio-blk PCI device, drives its virtqueue over brokered DMA, and serves sector-oriented read, write, and
flush requests over IPC. It is the default disk under QEMU, where `-device virtio-blk-pci` is the backing
drive the image is built against (`Makefile:272`). It owns no filesystem, no partition table, and no
cache; every byte of interpretation above a raw sector lives in a capsule layered on top of it.

The source under `userland/capsule_driver_virtio_blk/src/` splits into three concerns, and this
documentation is one page each so a page can be read beside the folder it describes: the client-facing IPC
protocol and its handlers, the device bring-up transaction and the broker grants it takes, and the
virtqueue request engine that moves the bytes.

## Identity

Everything the kernel and the broker need to name and reach the driver comes from its `Capsule.mk` and its
kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-virtio-blk` | `Capsule.mk:6` |
| Service handle | `driver.virtio_blk0` | `Capsule.mk:7`, [`src/hardware/virtio_blk_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_blk_capsule/spawn.rs#L32) |
| Namespace | `systems.nonos.driver.virtio_blk0` | `Capsule.mk:12` |
| Service endpoint | `service:4202:driver.virtio_blk0` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4203:endpoint.4294967304` | `Capsule.mk:14`, `spawn.rs:34` |
| Binary name | `driver_virtio_blk` | `Capsule.mk:10` |
| Capability mask | `0x1F8019` | `Capsule.mk:16` |
| Kernel mirror | `src/hardware/virtio_blk_capsule` | `Capsule.mk:17` |

The reply endpoint id `4294967304` is `0x1_0000_0008`, the same constant the driver hard-codes as its
outbound `KERNEL_REPLY_ENDPOINT` for every reply it sends ([`src/protocol/endpoint.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L16)). The kernel
receives on it; the driver never listens there.

The mask `0x1F8019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x000008  IPC          bit()       8   types.rs:59
  0x000010  Memory       bit()      16   types.rs:60
  0x008000  DeviceEnum   bit()   32768   types.rs:71
  0x010000  Driver       bit()   65536   types.rs:72
  0x020000  Mmio         bit()  131072   types.rs:73
  0x040000  Irq          bit()  262144   types.rs:74
  0x080000  Dma          bit()  524288   types.rs:75
  0x100000  Pio          bit() 1048576   types.rs:76
  ------
  0x1F8019  = 8 + 16 + 32768 + 65536 + 131072 + 262144 + 524288 + 1048576
```

The kernel spawn path requests exactly those eight capabilities and no others, OR-ing the same bits
([`src/hardware/virtio_blk_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_blk_capsule/spawn.rs#L51)). There is no `CoreExec` bit (1), no `Network` bit (4), and
no `FileSystem` bit (64). The mask is the hardware-driver envelope: the capsule can enumerate devices,
claim one, map its registers by MMIO or PIO, bind its interrupt, allocate DMA buffers, and speak IPC. It
cannot spawn a process, open a socket, or reach a filesystem. `Mmio` and `Pio` are both present because the
register BAR can be either memory-mapped or a port range, and the driver takes whichever the device
exposes; the [bring-up](/docs/userland/driver-virtio-blk/bringup/) page covers that fork.

## The three pillars

The source is a discovery-and-setup front, a queue-and-io middle, and a protocol-and-server face. A request
arrives on the IPC endpoint, is parsed and bounds-checked by the server, is turned into a virtqueue
descriptor chain and submitted to the device, and the completion is copied back into the reply.

```
  ipc in  ->  server/ + protocol/  ->  queue/ + io/  ->  setup/ + init/ (device)
  a message   parse, bounds-check     descriptor chain   claimed, negotiated
              dispatch on opcode      DMA, wait, ack     device behind grants
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [client.md](/docs/userland/driver-virtio-blk/client/) | `src/protocol/`, `src/server/` | The NBLK wire format, the receive loop and opcode dispatch, the five operations and their bounds, and the fixed kernel reply endpoint. |
| [bringup.md](/docs/userland/driver-virtio-blk/bringup/) | [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/setup/`, [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs), `src/regs/` | Device discovery, the ordered claim/register/irq/dma grant transaction and its rollback, the legacy virtio handshake and feature negotiation, and the MMIO-versus-PIO register abstraction. |
| [queue.md](/docs/userland/driver-virtio-blk/queue/) | `src/queue/`, `src/io/` | The split-virtqueue layout, the header/data/status descriptor chain, the available-ring publish, and the notify/wait/ack completion path. |
| [contributing.md](/docs/userland/driver-virtio-blk/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-virtio-blk/debugging/) | runtime | The boot marker, the bring-up and per-request failure modes, and where to look for each. |

## Lifecycle

The capsule is a `no_std`/`no_main` binary. `_start` initialises the heap, then loops calling `setup::run`
until it returns a live `Driver`, yielding 64 times between attempts so a device that is not yet claimable
does not spin the CPU; once bring-up succeeds it enters `server::run`, which never returns
([`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)). There is no policy in the loop: the driver discovers exactly one virtio-blk device,
negotiates it, allocates its DMA regions, probes capacity, and then answers IPC.

Bring-up is an ordered transaction. Discover the device, claim it for the epoch every later grant must
quote, map its register BAR, bind its interrupt, allocate the three DMA regions (queue, header, data), walk
the virtio status handshake, probe the sector count, and hand back a `Driver` ([`src/setup/sequence.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L23)).
Each step depends on the grant the previous one produced, and each failure rolls back the grants already
taken, so a failed bring-up leaves the device unclaimed and no grants leaked. The [bring-up](/docs/userland/driver-virtio-blk/bringup/)
page walks each step; the broker side is documented in
[claim](/docs/subsystems/hardware-broker/claim/), [mmio](/docs/subsystems/hardware-broker/mmio/),
[irq](/docs/subsystems/hardware-broker/irq/), and [dma](/docs/subsystems/hardware-broker/dma/).

The driver uses a single request in flight by design: it always builds the descriptor chain from
descriptor 0 and reuses the one queue, header, and data region for every request
([`src/queue/post/descriptors.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L28), [`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41)). A request is serialised through the
server loop, submitted, waited on, and answered before the next `mk_ipc_recv` returns, so there is never a
second chain outstanding.

The driver is spawned through verified spawn: its signature and attestation are checked, its requested
capabilities are held against its manifest ceiling, and only then is its ELF mapped
([`src/hardware/virtio_blk_capsule/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_blk_capsule/spawn.rs#L37)). A successful spawn prints
`[DRIVER-VIRTIO-BLK] capsule spawned` on the boot log ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); the
[debugging](/docs/userland/driver-virtio-blk/debugging/) page covers what each later marker means.

## Isolation

The virtio-blk driver is a hardware-facing capsule, so its authority is real device authority, but it is
bounded on every axis the broker controls. It cannot spawn a process, open a socket, or reach a filesystem;
it can touch one claimed device and move bytes over IPC. Every hardware action goes through the broker,
which validates it against the exclusive claim and its epoch: only one capsule can hold a virtio-blk device
at a time, the MMIO grant can only map memory inside the device's own BAR, the IRQ grant delivers on a
kernel-owned vector, and the DMA regions are allocated and zero-scrubbed by the broker before the capsule
sees them ([claim](/docs/subsystems/hardware-broker/claim/),
[mmio](/docs/subsystems/hardware-broker/mmio/), [irq](/docs/subsystems/hardware-broker/irq/),
[dma](/docs/subsystems/hardware-broker/dma/)).

The request bounds are the driver's own line of defence against a client. Read and write both require
`nsectors` in `1..=64`, a `payload_len` that exactly matches the header-plus-data size, and an
`lba + nsectors` that stays within the probed capacity, with the addition `checked_add` so a wrapped LBA is
rejected rather than truncated ([`src/server/handlers/read/request.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L33),
[`src/server/handlers/write/request.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write/request.rs#L42)). A read never copies more than the DMA buffer length back into
the reply ([`src/queue/used.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L27)). So a client cannot make the driver DMA outside its data buffer, read a
sector past the device, or overrun the reply. The [client](/docs/userland/driver-virtio-blk/client/) page details each bound.

The honest caveat is the IOMMU. NØNOS carries an `IommuDomain` abstraction but its hardware backend is
behind the `nonos-arch-iommu` feature and is not engaged in the shipping builds, so the device physical
address the broker hands back is a raw physical address and a malicious or buggy device could in principle
DMA to any physical address regardless of the grant ([dma](/docs/subsystems/hardware-broker/dma/)). The
broker bounds what the capsule may allocate and program; it does not yet bound what the device does once
running. On the kernel side, the in-kernel client that talks to this endpoint is itself gated: only a
caller holding `CAP_DRIVER` may reach the block surface ([`src/hardware/virtio_blk_capsule/capability.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_blk_capsule/capability.rs#L30)).

## Source map

```
  src/main.rs                         _start: heap init, retry setup::run, then server::run
  src/discover.rs                     find_virtio_blk: match vendor/device, pick register BAR
  src/setup/                          the bring-up transaction (claim, regs, irq, dma) and its rollback
  src/init.rs                         bring_up: the legacy virtio status handshake and feature negotiation
  src/regs/                           MMIO vs PIO register access behind the Regs abstraction
  src/queue/                          the split-virtqueue layout, descriptor chain, publish, and used ring
  src/io/                             submit: notify, IRQ-poll wait with used-ring fallback, ack
  src/protocol/                       the NBLK header, ops, errno, limits, and reply endpoint
  src/server/                         the receive loop and the health, capacity, read, write, flush handlers
  src/constants/                      pci, queue, regs, request, and status constants
  Capsule.mk                          slug, handle, ports, capability mask, kernel mirror
  src/hardware/virtio_blk_capsule/    the kernel-side embed, verified spawn, and mirrored protocol
  src/userspace/init/spawn_plan/drivers_virtio_io.rs   the driver spawn entry and boot marker
  src/capabilities/types.rs           the capability bit definitions the mask decomposes against
```

Everything here is drawn from `userland/capsule_driver_virtio_blk/` (the capsule source and its
`Capsule.mk`), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), and the kernel mirror under
`src/hardware/virtio_blk_capsule/`. Every reference above is verified against those trees.
