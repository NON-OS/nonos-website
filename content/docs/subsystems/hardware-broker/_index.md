---
title: "Hardware Broker"
description: "How a driver capsule reaches real hardware without running in the kernel."
weight: 10
---
How a driver capsule reaches real hardware without running in the kernel. NØNOS puts device
drivers in ring-3 capsules, and the broker is the trusted mediator between them and the physical
device: it enumerates devices, lets a capsule claim one exclusively, and issues narrow, revocable
grants for register access, DMA memory, interrupts, and port I/O. The capsule drives its device
entirely through these grants and never holds a raw physical mapping, a controller register, or
an I/O-privilege bit of its own.

| Page | What it covers |
|------|----------------|
| [devices.md](/docs/subsystems/hardware-broker/devices/) | Building the device table from PCI enumeration, class ids and discovery, and the two-write PCI config allowlist. |
| [claim.md](/docs/subsystems/hardware-broker/claim/) | Exclusive device claim, the monotonic epoch, and the `StaleEpoch` check every grant re-runs. |
| [mmio.md](/docs/subsystems/hardware-broker/mmio/) | `MkMmioMap`: the five-step BAR-into-capsule mapping, the guarded user MMIO region, and the MSI-X table exclusion. |
| [dma.md](/docs/subsystems/hardware-broker/dma/) | `MkDmaMap`: allocate-zero-install-record with rollback, the device-visible address, and the per-class page ceiling. |
| [irq.md](/docs/subsystems/hardware-broker/irq/) | `MkIrqBind`: INTx and MSI-X, wait/poll/ack in ring 3, and the x86 / GICv3 / PLIC backends. |
| [pio.md](/docs/subsystems/hardware-broker/pio/) | `MkPioGrant` and the checked port accesses, x86-only with a fail-closed `ENOSYS` elsewhere. |
| [revocation.md](/docs/subsystems/hardware-broker/revocation/) | The three revocation entry points, the self-context unmap decision, and the four-class revoke on capsule exit. |

The property that defines the subsystem is that hardware authority is *held by the kernel and
lent, never handed over*. A claim is exclusive and epoch-stamped; every grant is checked against
the claim, bounded to the device (a BAR, a class-capped DMA size, a specific IRQ, a port window),
and recorded so it can be undone; and every grant is revoked when the capsule releases the device
or exits. The capabilities these paths require are defined in the
[capability model](/docs/security/capabilities-and-tokens/), the syscalls that reach them are the
`Mk*` family on the [syscall boundary](/docs/subsystems/syscall/boundary/), and the interrupt vectors the IRQ
path installs are covered on the [interrupts](/docs/subsystems/interrupts/idt/) page.

## Sources

The code for this subsystem lives under `src/hardware/broker/`: `table/` and `class.rs` (device
discovery and classification), `claim.rs` (claims and epochs), `mmio/`, `dma/`, `irq/`, and `pio/`
(the four grant classes), `grant.rs` (the MMIO grant table and user VA region), and `pci/` (config
access). The IRQ backends are under `irq/` with `aarch64/` and `riscv64/` subtrees, and the exit
revocation is in `src/process/exit/`. Every page is verified against those trees with `file:line`
references.
