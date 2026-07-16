---
title: "Subsystems"
description: "Deep dives into one subsystem at a time. Each page takes a box from the architecture overview and expands it with the full data structures, control flow, and source references."
weight: 20
---
Deep dives into one subsystem at a time. Each page takes a box from the
[architecture overview](/docs/architecture/overview/) and expands it with the full
data structures, control flow, and source references.

The overview already describes every subsystem below at the level needed to
understand the system. These pages go further: every field, every state
transition, every edge case the code handles. Each is verified against the
source.

| Page | Subsystem | Overview section |
|------|-----------|------------------|
| [boot/](/docs/subsystems/boot/) | Boot and init sequence | 4 |
| [memory/](/docs/subsystems/memory/) | Physical frames, paging, unified VM, heap, faults, hardening, usercopy, zeroization | 5 |
| [process/](/docs/subsystems/process/) | The PCB, the process table, lifecycle, context switch, the supervisor | 6, 11 |
| [elf-loader/](/docs/subsystems/elf-loader/) | Parsing, validation, and mapping of capsule ELFs | 6, 7 |
| [scheduler/](/docs/subsystems/scheduler/) | Priority selection, preemption, sleep and wake | 11 |
| [smp/](/docs/subsystems/smp/) | Per-CPU data, CPU identity, TLB shootdown | 11 |
| [syscall/](/docs/subsystems/syscall/) | The ring boundary, the tag numbers, the capability contract, the router | 6, 10 |
| [ipc/](/docs/subsystems/ipc/) | Inboxes, routing and permission, the message envelope and MAC, pipes | 10 |
| [hardware-broker/](/docs/subsystems/hardware-broker/) | Device claim, IRQ, MMIO, DMA, PIO grants | 12 |
| [interrupts/](/docs/subsystems/interrupts/) | IO-APIC routing, GSI ownership, vector pool | 12 |
| [input/](/docs/subsystems/input/) | The input ring and the driver to shell path | 13 |
| [graphics/](/docs/subsystems/graphics/) | Surfaces, sharing, presentation, vsync | 14 |
| [networking/](/docs/subsystems/networking/) | The L2 to sockets network capsule stack | 9 |
| [storage/](/docs/subsystems/storage/) | Block drivers, ramfs, and the vfs capsules | 9 |
| [time-and-clock/](/docs/subsystems/time-and-clock/) | TSC calibration, the two time bases, entropy | 11 |
| [crypto/](/docs/subsystems/crypto/) | The in-tree crypto stack and what uses each primitive | 15 |
| [proof-system/](/docs/subsystems/proof-system/) | The transparent STARK, the Poseidon-Goldilocks hash, the AIR catalog, and the Pedersen attestation | 15 |

The overview-section column points back to the matching section of the
architecture overview for the short version of each subsystem.
