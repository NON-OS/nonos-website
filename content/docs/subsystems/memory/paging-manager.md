---
title: "The Paging Manager"
description: "The paging manager owns the kernel's view of virtual memory."
weight: 2
---
The paging manager owns the kernel's view of virtual memory. It tracks every
address space, every mapping the kernel has installed, the page-table root that is
active on the CPU, and the allocation of address-space identifiers. It is a single
global behind a lock, and every path that maps or unmaps a page goes through it.
This page documents its state, the permission model it installs, the address-space
record, and the mapping interface with its typed helpers and their exact behaviour.
The code is under `src/memory/paging/`.

## The manager state

The whole tracked state of virtual memory is one structure
([`src/memory/paging/manager/core/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/paging/manager/core/types.rs#L24)):

```
  PagingManager
    active_page_table  Option<PhysAddr>          the root last loaded into CR3
    active_asid        Option<u32>               the ASID active on the last
                                                 switch, for TLB shootdown scope
    mappings           BTreeMap<u64, PageMapping> every mapping, keyed by VA
    address_spaces     BTreeMap<u32, AddressSpace> every address space, by ASID
    next_asid          u32                       next ASID to hand out
    initialized        bool
```

`next_asid` starts at `FIRST_USER_ASID`, so user address spaces are numbered above
the kernel's reserved `KERNEL_ASID`. `active_asid` is `None` before any process
has been dispatched, when the kernel is still running on the boot page tables with
no user CR3 active; once a process is switched to, it records that process's ASID
so the TLB shootdown wrappers can scope their invalidations to the right address
space. The `mappings` and `address_spaces` maps are ordered `BTreeMap`s, so the
manager can answer range and lookup queries over what it has installed. The whole
structure lives behind a single lock at the module boundary, which makes the
interrupt discipline below necessary.

## Page permissions

Every mapping carries a `PagePermissions`, a `u32` bitfield with a named constant
per bit ([`src/memory/paging/types/permissions/flags.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/paging/types/permissions/flags.rs#L20)):

```
  READ  WRITE  EXECUTE  USER  GLOBAL
  NO_CACHE  WRITE_THROUGH  DEVICE
  COW  DEMAND  ZERO_FILL  SHARED  LOCKED
```

The operations on it are the usual set algebra as `const fn`s: `contains`,
`union`, `insert`, `remove`, and `empty`. The one predicate that is a security
invariant rather than a convenience is `is_wx_violation` (`flags.rs:60`):

```
  is_wx_violation(self) = self.contains(WRITE) and self.contains(EXECUTE)
```

A permission set is a write-execute violation exactly when it is both writable and
executable. No page in the system is ever supposed to be both, and this predicate
is the test that enforces it. The enforcement point and the guarantees around it
are documented in full on the [hardening](/docs/subsystems/memory/hardening/) page; here it is enough to
know that the permission model can name a W^X violation and that the manager's
callers check for it. The remaining flags describe caching (`NO_CACHE`,
`WRITE_THROUGH`, `DEVICE`), sharing and lifecycle (`SHARED`, `LOCKED`, `COW`), and
lazy population (`DEMAND`, `ZERO_FILL`), the last two of which are the
[fault handler's](/docs/subsystems/memory/faults/) concern.

## Address spaces

An address space is a small record tying an ASID to a page-table root and a
process ([`src/memory/paging/types/address_space.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/paging/types/address_space.rs#L22)):

```
  AddressSpace
    asid           u32        the address-space identifier
    cr3_value      PhysAddr   the page-table root for this space
    process_id     u32        the owning process
    creation_time  u64
```

`is_kernel` (`address_space.rs:34`) reports whether the ASID is the reserved
`KERNEL_ASID`. The kernel's own address space is registered during unified-VM init
and shared, mapped identically, into the upper half of every process's space; each
process gets its own `AddressSpace` with a fresh ASID and its own `cr3_value` whose
lower half is private. The manager keeps these in `address_spaces` and consults
them when switching CR3 and when scoping TLB shootdowns.

## Mapping a page

The public entry point is `map_page` ([`src/memory/paging/manager/api/mapping.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/paging/manager/api/mapping.rs#L24)),
and the first thing it does is disable interrupts around the manager lock:

```
  map_page(va, pa, perms):
      without_interrupts(||
          PAGING_MANAGER.lock().map_page(va, pa, perms, Size4KiB, &PAGING_STATS))
```

The interrupt discipline is not incidental and the source explains it. The manager
is a `spin::Mutex`. If a timer interrupt fired on this CPU while the lock is held,
the preemption path in the ISR would call `switch_to_process_address_space`, which
takes the same lock, and the CPU would deadlock on its own mutex. Disabling
interrupts across the critical section closes that window. Every mapping and
unmapping entry point in this module follows the same pattern. Inside the lock the
manager walks the page-table levels, allocating intermediate tables from the
[frame allocator](/docs/subsystems/memory/physical-frames/) as needed, installs the leaf entry, records
the `PageMapping` in its `mappings` map, and updates `PAGING_STATS`. `map_huge_page`
is the same with a caller-chosen `PageSize`.

## The typed helpers

Most callers do not build a raw permission set; they call a helper that encodes the
correct permissions and cache mode for a kind of memory, and these helpers are
where the system's memory policy is written down ([`api/mapping.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/api/mapping.rs)).

```
  map_kernel_page      READ | WRITE | GLOBAL
  map_user_page(w)     READ | USER (+ WRITE if w)
  map_device_memory    READ | WRITE | NO_CACHE | DEVICE
  map_user_mmio        USER | READ | WRITE | NO_CACHE | DEVICE
  map_user_dma         USER | READ | WRITE                  (write-back cacheable)
```

Three details in these are worth stating because they are correctness, not style.
None of them set `EXECUTE`, so device, MMIO, and DMA mappings are non-executable by
construction. The MMIO helpers set `NO_CACHE` because device registers must not be
cached, while the DMA helper deliberately does not: on x86_64 PCI devices snoop the
cache, so a coherent DMA buffer is write-back cacheable, and marking it uncached or
write-combining would be wrong. And `map_user_mmio` and `map_user_dma` roll back on
partial failure: if the `n`-th page of a range fails to map, the helper unmaps the
`n-1` pages it already installed before returning the error, so a failed mapping
never leaves a partial range behind.

The source also records who is allowed to call the user device helpers: the comment
on `map_user_mmio` states that the caller is the hardware broker and no other path
is permitted to expose physical memory to a capsule, and that the helper does not
itself consult the broker tables, so the broker is responsible for confirming the
physical range belongs to a BAR the calling process claimed. The
[hardware broker](/docs/subsystems/hardware-broker/) page covers that check.

## Unmapping and TLB shootdown

`unmap_page` ([`api/mapping.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/api/mapping.rs#L62)) unmaps under the same interrupt discipline,
returns the physical address that was mapped along with the permissions and size,
and records the unmapping in the stats. `unmap_range` walks 4 KiB pages across a
byte length rounded up and unmaps each, stopping at the first failure and returning
it. The unmap path is also where cross-CPU TLB coherency happens: as the comments
on `unmap_user_mmio` and `unmap_user_dma` note, `unmap_page` emits a per-ASID SMP
TLB shootdown through the manager's shootdown wrappers
([`src/memory/paging/manager/shootdown.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/paging/manager/shootdown.rs)), scoped by the `active_asid` recorded in
the manager state, so a mapping removed on one CPU is invalidated on the others
that share the address space rather than lingering in their TLBs.

## Security analysis

The paging manager is the single choke point through which every mapping in the system is installed,
so its properties are the ones the rest of the memory subsystem builds on. Four hold.

**W^X by construction.** The install path `map_page_in_asid` rejects a permission set that is both
`WRITE` and `EXECUTE` with `PagingError::WXViolation` before it computes a PTE, so no writable-executable
page is ever installed into any address space. The predicate `is_wx_violation` (`flags.rs:60`) is where
that rule is named; the [hardening](/docs/subsystems/memory/hardening/) page covers the gate itself. Because it is the same
`map_page` every helper and every fault handler funnels through, the invariant is total: there is one
place mappings are made, and that place enforces it.

**The device helpers are non-executable and correctly cached.** `map_device_memory`, `map_user_mmio`,
and `map_user_dma` ([`api/mapping.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/api/mapping.rs)) never set `EXECUTE`, so a device register window or a DMA buffer
is not a code page by construction. The MMIO helpers set `NO_CACHE` because device registers must not
be cached; the DMA helper deliberately does not, because on x86_64 PCI devices snoop the cache and a
coherent DMA buffer is write-back cacheable. Marking a snooped DMA buffer uncached would be a
correctness bug, not extra safety, and the helper gets it right.

**Partial mappings roll back.** `map_user_mmio` and `map_user_dma` unmap the pages they already
installed if a later page in the range fails ([`api/mapping.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/api/mapping.rs)), so a failed range mapping never
leaves a partial window exposed to a capsule. The same discipline is why the install is the
transaction boundary.

**The interrupt discipline prevents self-deadlock.** Every map and unmap entry point runs the manager
lock inside `without_interrupts` ([`api/mapping.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/api/mapping.rs#L24)). The manager is a `spin::Mutex`, and if a timer
interrupt fired while the lock was held, the preemption path would call
`switch_to_process_address_space`, which takes the same lock, and the CPU would deadlock on its own
mutex. Disabling interrupts across the critical section closes that window and, on the unmap path, keeps
the per-ASID TLB shootdown consistent with the `active_asid` it reads. The honest boundary the source
records: `map_user_mmio` does not itself consult the broker tables, so the [hardware broker](/docs/subsystems/hardware-broker/)
is trusted to confirm the physical range belongs to a BAR the calling process claimed. The manager
enforces W^X, NX, caching, and rollback; it does not re-check the broker's authority decision.

## Debugging the paging manager

Every mapping and unmapping failure is a `PagingError` variant ([`error/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/error/types.rs)), and the manager
carries a string form for each ([`error/impls.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/error/impls.rs)) so a failure reads as a sentence:

```
  NotInitialized        "Paging manager not initialized"          used before init
  NoActivePageTable     "No active page table"                    no CR3 recorded yet
  FrameAllocationFailed "Failed to allocate page table frame"     no frame for an intermediate table
  WXViolation           "W^X violation: RW+X not allowed"         a writable-executable request
  PageNotMapped         "Page not mapped"                         unmap or translate of an absent page
  Pml4NotPresent ...    "PML4/PDPT/PD/PT entry not present"        the walk stopped at a missing level
  AlreadyMapped         "Page already mapped"                     a double map at the same VA
  UnhandledPageFault    "Unhandled page fault"                    the fault path could not classify it
  KernelSpaceViolation  "Kernel space violation"                  a user helper aimed at the kernel half
```

The two that name a hardening or isolation problem are `WXViolation` and `KernelSpaceViolation`: the
first is a caller asking for a W+X page and being refused at the gate (and it also bumps the hardening
`wx_violations` counter), the second is a user-mapping helper pointed at a kernel-half address. The
`Pml4NotPresent` family tells you exactly which level of the four-level walk found a missing entry,
which is how a translate failure is localised to a level rather than left as "not mapped". A
`FrameAllocationFailed` here is subtle: it is not the leaf frame but an *intermediate page table* the
manager could not allocate, so it is physical exhaustion surfacing during a deep map. `PAGING_STATS`
records page faults, demand loads, and cow faults, so the ratio of demand loads to ordinary faults is
the runtime signal for a capsule that is faulting more than its eager mappings should require.

## Where this connects

The manager is brought up, and the kernel's own mappings established, by the
[unified-VM init](/docs/subsystems/memory/unified-vm/), which also tears down the bootloader's low-half
identity map once the kernel half is confirmed. The `DEMAND`, `ZERO_FILL`, and
`COW` permission bits are populated lazily by the [fault handler](/docs/subsystems/memory/faults/). The
W^X invariant named here is enforced and its guarantees stated on the
[hardening](/docs/subsystems/memory/hardening/) page. And every intermediate page table this manager
allocates comes from the [physical frame allocator](/docs/subsystems/memory/physical-frames/).

## Source map

```
  src/memory/paging/manager/core/types.rs        the PagingManager state
  src/memory/paging/types/permissions/flags.rs   PagePermissions and is_wx_violation
  src/memory/paging/types/address_space.rs       the AddressSpace record
  src/memory/paging/manager/api/mapping.rs       map_page and the typed helpers
  src/memory/paging/manager/shootdown.rs         the per-ASID TLB shootdown
  src/memory/paging/error/types.rs               the PagingError variants and their strings
```

Every reference above is verified against those trees. The W^X gate that this permission model feeds is
on the [hardening](/docs/subsystems/memory/hardening/) page, the lazy bits are populated by the [fault handler](/docs/subsystems/memory/faults/),
the intermediate tables come from the [physical frame allocator](/docs/subsystems/memory/physical-frames/), and the broker
authority the device helpers trust is on the [hardware broker](/docs/subsystems/hardware-broker/) page.
