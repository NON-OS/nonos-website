---
title: "The xHCI Driver Capsule"
description: "capsuledriverxhci is the USB host-controller driver in the NØNOS tree: a signed userland capsule that owns one xHCI controller end to end."
weight: 400
---
`capsule_driver_xhci` is the USB host-controller driver in the NØNOS tree: a signed userland capsule
that owns one xHCI controller end to end. It finds the PCI device through the hardware broker, claims it,
maps the register window, binds its interrupt, allocates the controller's DMA structures, resets and
starts the controller, and then serves a request/reply IPC surface that USB class capsules (HID, mass
storage) call to enumerate and talk to devices. Nothing about USB lives in ring 0: the kernel grants and
revokes hardware resources, and every register write, ring, and descriptor read happens in this CPL 3
capsule.

The source under `userland/capsule_driver_xhci/src/` is roughly 227 files across thirteen top-level
modules, and this documentation mirrors that structure so a page can be read beside the folder it
describes. It is the largest driver capsule in the tree, so the material is split by pillar rather than
crammed into one page. Its entry point ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36)) initialises the heap, runs the one-shot
bring-up (`setup::run`), and then hands the assembled `Driver` to a blocking server loop.

## The pillars

The capsule is two phases sitting on shared machinery. Bring-up runs once and produces a live `Driver`;
the server then loops forever, turning IPC requests into controller commands and transfers. The command,
event, and transfer rings plus the TRB builders are the machinery both phases stand on, and the slot
table and device contexts are the per-device state enumeration builds up. Data flows inward from a class
capsule's request to the hardware and back:

```
  class capsule  --IPC-->  operations  --calls-->  enumeration + transfers
                           (protocol,               (slots, contexts,
                            server)                  descriptors)
                                  \                    /
                                   \                  /
                                    v                v
                              rings + TRBs  <-->  bring-up + broker grants
                              (trb, rings,         (setup, discover,
                               regs, constants)     handles, dma)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-xhci/operations/) | `src/protocol/`, `src/server/` | The wire format, the `NXHC` header, the eleven client ops, the sequential recv/dispatch/reply loop, and the pid-correlated reply routing. |
| [bring-up.md](/docs/userland/driver-xhci/bring-up/) | `src/setup/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/handles/`, `src/dma/` | The ordered spawn sequence: discover, claim, bus-master, map, bind IRQ, read layout, halt, reset, start, and the no-op probe, plus the broker grant calls and the DMA pool. |
| [rings.md](/docs/userland/driver-xhci/rings/) | `src/trb/`, `src/rings/`, `src/regs/`, `src/constants/` | The TRB model, the command and event rings, the link-TRB wrap, the doorbell and interrupter registers, and how a command completion is matched. |
| [enumeration.md](/docs/userland/driver-xhci/enumeration/) | `src/slots/`, `src/contexts/`, `src/server/handlers/address_flow/` | Enabling a slot, resetting the port, the Address Device flow, the input and device contexts, transfer rings, and control and interrupt-IN transfers. |
| [contributing.md](/docs/userland/driver-xhci/contributing/) | the whole tree | Where to work, how to add an op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-xhci/debugging/) | runtime | The bring-up markers, the distinct timeout errors, and the real-hardware failure modes: controller not halting or running, no ports, no devices enumerated. |

## Overview

The capsule is the transport layer beneath every USB device on the machine. A USB HID capsule that wants
keyboard reports, or a mass-storage capsule that wants to read blocks, does not touch the controller: it
sends this capsule an IPC request, and this capsule drives the xHCI hardware to satisfy it. The split is
explicit: this capsule owns controller mechanics only (bring-up, rings, event processing, port status,
the slot lifecycle), and USB class policy belongs to the capsules above it. Descriptor bytes are returned
raw and parsed by the class capsule, never in the driver and never in the kernel.

Structurally there are two phases. The first is a one-shot setup that runs at spawn and either produces a
fully initialised `Driver` or aborts the capsule with a negative errno ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40),
[`src/setup/sequence.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L34)). The second is a sequential server: one receive, one dispatch, one reply,
forever, with an event-ring drain and interrupter ack at the top of every iteration
([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)). The `Driver` value threaded through the server holds everything setup built:
the broker handles, the DCBAA, the scratchpad array, the DMA pool, the command and event rings, the
controller layout, and the per-slot table ([`src/setup/driver.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L22)).

The interrupt model is MSI-X. Setup binds one MSI-X vector through the broker ([`src/setup/irq_bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq_bind.rs#L23),
`MK_IRQ_BIND_MSIX`), and the server drains the event ring and acknowledges the interrupter on each loop
pass ([`src/server/service_interrupts.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/service_interrupts.rs#L20)). The `Capsule.mk` header comment still describes an INTx
model with MSI-X deferred, which no longer matches the code; the [debugging](/docs/userland/driver-xhci/debugging/) page notes this
and one other stale in-tree comment.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk`.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-xhci` | `Capsule.mk:6` |
| Service handle | `driver.xhci0` | `Capsule.mk:7` |
| Domain | `systems.nonos` | `Capsule.mk:8` |
| Namespace | `systems.nonos.driver.xhci0` | `Capsule.mk:12` |
| Service endpoint | `service:4206:driver.xhci0` | `Capsule.mk:13` |
| Reply endpoint | `reply:4207:endpoint.4294967307` | `Capsule.mk:14` |
| Binary name | `driver_xhci` | `Capsule.mk:10` |
| Kernel feature | `nonos-capsule-driver-xhci` | `Capsule.mk:11` |
| Kernel mirror | `src/hardware/xhci_capsule` | `Capsule.mk:17` |
| Capability mask | `0xF8019` | `Capsule.mk:16` |

The reply endpoint id `4294967307` is `0x1_0000_000B`, the same constant the capsule hardcodes as its
fallback reply target for kernel-internal (pid 0) callers ([`src/protocol/endpoint.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L16)).

The mask `0xF8019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec     1        types.rs:56
  0x00008  IPC          8        types.rs:59
  0x00010  Memory       16       types.rs:60
  0x08000  DeviceEnum   32768    types.rs:71
  0x10000  Driver       65536    types.rs:72
  0x20000  Mmio         131072   types.rs:73
  0x40000  Irq          262144   types.rs:74
  0x80000  Dma          524288   types.rs:75
  -------
  0xF8019  = 1 + 8 + 16 + 32768 + 65536 + 131072 + 262144 + 524288
```

Those eight bits are exactly the hardware-authority set a userspace driver needs and no more.
`DeviceEnum` lets it list PCI devices to find the controller; `Driver` lets it claim and release the
device; `Mmio` lets it map the register BAR; `Irq` lets it bind the interrupt; `Dma` lets it get
device-visible buffers; and `CoreExec`, `IPC`, and `Memory` are the base execute, message, and allocate
rights every capsule runs on. There is no `Pio` bit, which matches xHCI being an MMIO-only controller, and
no `FileSystem`, `Network`, `Graphics`, `InputSource`, `Admin`, or `Debug` authority. The `Capsule.mk`
comment spells the mask out as `IPC|Memory|Driver|DeviceEnum|Mmio|Irq|Dma` (`Capsule.mk:15`); note it
omits the `CoreExec` bit that is also set.

This is the most powerful mask in the driver tree, so the interesting question is what bounds it. Almost
none of the authority is the capsule's own discretion: the broker grants it a slice of one device and
re-checks every grant against a claim epoch. The claim is exclusive, so no second capsule can be mapping
this controller's BARs or taking its interrupts underneath it; the MMIO grant is bounded to the BAR minus
the MSI-X table, so the capsule cannot aim its own interrupt; and DMA buffers come zero-scrubbed from
`MkDmaMap` under a per-class page ceiling. The [bring-up](/docs/userland/driver-xhci/bring-up/) page walks each grant and cites the
matching broker subsystem page. The honest gap, documented there, is that the IOMMU backend is not engaged
in shipping builds, so bus-master DMA is bounded by software rather than hardware containment.

## Lifecycle

The capsule is spawned through verified spawn like every other capsule: its signature and attestation are
checked, its requested capabilities are held against its manifest ceiling, and only then is its ELF
mapped. `_start` initialises the heap, runs `setup::run`, and on success enters the server loop; on a
setup error it exits with the negated errno for that failure ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40),
[`src/error/errno_value.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/errno_value.rs#L23)). Bring-up narrates its progress through nine `mk_debug` markers, the last
of which, `[driver_xhci] endpoint driver.xhci0 ready`, means the controller is live and the service is
about to run ([`src/setup/sequence.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L73)). The [debugging](/docs/userland/driver-xhci/debugging/) page lists every marker and the
error each missing marker names.

## Source map

```
  src/main.rs                     _start -> heap, setup::run, server::run
  src/setup/                      the ordered bring-up and the broker grant calls
  src/discover.rs                 find_xhci: PCI enumeration for the controller
  src/handles/                    BrokerHandles: device id, MMIO grant + VA, IRQ grant
  src/dma/                        DmaPool over MkDmaMap and DmaRegion
  src/controller/                 halt, reset, start, waits, DCBAA, port reset, event drain, IRQ ack, issue/get ops
  src/regs/                       cap/op/runtime MMIO register accessors
  src/rings/                      command, event, and transfer ring state and enqueue
  src/trb/                        the TRB struct, field accessors, builders, and command TRBs
  src/contexts/                   input and device contexts, 32/64-byte sizing
  src/slots/                      the per-slot table, DCI mapping, per-slot resources
  src/constants/                  register offsets, TRB kinds and flags, completion codes, ring sizes
  src/protocol/                   the NXHC header, ops, errno, length limits, encode/decode
  src/server/                     the recv/dispatch/reply loop and one handler per op
  src/error/                      XhciError and its errno mapping
  Capsule.mk                      slug, handle, ports, capability mask, kernel mirror
  src/hardware/xhci_capsule       the kernel-side embed and verified spawn
  src/capabilities/types.rs       the capability bit values the mask decomposes into
  docs/subsystems/hardware-broker/   the claim/mmio/dma/irq grant paths this capsule calls
```

Every reference above is verified against those trees.
