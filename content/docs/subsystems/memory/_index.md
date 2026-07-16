---
title: "Memory"
description: "How NØNOS manages physical and virtual memory: the frame allocator that owns physical RAM, the paging manager that owns every address space and mapping, the init step that moves..."
weight: 3
---
How NØNOS manages physical and virtual memory: the frame allocator that owns
physical RAM, the paging manager that owns every address space and mapping, the
init step that moves the kernel onto its own upper half, the heap that backs
`alloc`, the fault handlers that back pages lazily, the hardening that enforces
the safety invariants, and the boundary that copies to and from user memory
without ever dereferencing a user pointer.

Read them roughly in this order. Each starts from the layer below it.

| Page | What it covers |
|------|----------------|
| [physical-frames.md](/docs/subsystems/memory/physical-frames/) | The bitmap frame allocator, one bit per 4 KiB frame, seeded at boot from the firmware memory map, with next-fit allocation, alignment and range checks, and double-free detection. |
| [paging-manager.md](/docs/subsystems/memory/paging-manager/) | The manager state, the page-permission model and the W^X predicate, address spaces and ASIDs, `map_page` and the typed helpers with their cache and permission rationale, and per-ASID TLB shootdown. |
| [unified-vm.md](/docs/subsystems/memory/unified-vm/) | `init_unified_vm`: the ordered preconditions for creating an address space, the LAPIC rebind that must precede the teardown, and dropping the bootloader's low-half identity map. |
| [page-allocator.md](/docs/subsystems/memory/page-allocator/) | The tracked whole-range virtual allocator over the buddy allocator, zero-on-alloc and zero-on-free, the size and tracking bounds, and the live-usage statistics. |
| [heap.md](/docs/subsystems/memory/heap/) | The global allocator, the bootstrap-buffer to frame-backed transition, the mapping at the fixed heap base, and zero-on-alloc and zero-on-free. |
| [faults.md](/docs/subsystems/memory/faults/) | The page-fault dispatch, demand paging with its user-space-only and demand-budget guards, and copy-on-write. |
| [hardening.md](/docs/subsystems/memory/hardening/) | The W^X enforcement gate on the mapping path, guard pages, stack canaries, allocation tracking, and the violation tally. |
| [usercopy.md](/docs/subsystems/memory/usercopy/) | The user/kernel copy boundary: range policy, per-page presence and permission walk, and transfer through the direct map with interrupts disabled. |
| [zeroization.md](/docs/subsystems/memory/zeroization/) | RAM residency and the ZeroState guarantee: frame-free zeroing, heap zero-on-alloc and zero-on-free, secure-region erase, and the whole-system multi-pass wipe, stated as what the code does and does not claim. |

Device memory (the MMIO and DMA mapping paths) is introduced here through the
paging manager's typed helpers and covered from the requester's side on the
[hardware broker](/docs/subsystems/hardware-broker/) page. The kernel virtual-range allocator
that carves per-process kernel stacks is the [page allocator](/docs/subsystems/memory/page-allocator/).

## Sources

The code for this subsystem lives under `src/memory/` (physical frames, paging,
the unified-VM init, the heap, faults, and hardening), `src/usercopy/` (the copy
boundary), and [`src/kernel_core/init/memory.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/memory.rs) (the boot seeding). Every page is
verified against those trees with `file:line` references.
