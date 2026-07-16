---
title: "The Page Allocator"
description: "The frame allocator hands out raw physical frames, and the paging manager maps them."
weight: 4
---
The [frame allocator](/docs/subsystems/memory/physical-frames/) hands out raw physical frames, and the
[paging manager](/docs/subsystems/memory/paging-manager/) maps them. The page allocator sits above both: it is the
kernel's tracked allocator for whole virtual page ranges, the layer that carves a range of
kernel virtual address space, backs it with frames, zeroes it, and remembers it so it can be
freed and zeroed again. Per-process kernel stacks and similar fixed kernel allocations come
from here. The code is under `src/memory/page_allocator/`.

## What it allocates

A request is a size in bytes; the allocator rounds it up to whole pages and returns a kernel
virtual address for the base of the range. `allocate_page` ([`manager/alloc.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/manager/alloc.rs#L27)) is the
core:

```
  allocate_page(size):
      reject if not initialized, size == 0, or size > MAX_ALLOCATION_SIZE (1 GiB)
      reject if tracked pages >= MAX_TRACKED_PAGES (100_000)
      page_count = ceil(size / PAGE_SIZE)
      va = allocate_virtual_pages(page_count)      // backed by the buddy allocator
      pa = translate(va)                           // resolve the backing frame
      record AllocatedPage { page_id, va, pa, time, size }
      write_bytes(va, 0, total_size)               // zero the whole range
      return va
```

The virtual range and its frame backing come from the buddy allocator
(`crate::memory::buddy_alloc`, via [`manager/mapping.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/manager/mapping.rs#L22)), which allocates the contiguous
virtual pages and maps them; the page allocator adds tracking, physical-address resolution,
and the zeroing. Every allocation is zeroed before it is returned, so a caller never sees a
previous tenant's bytes. The size is bounded above at one gigabyte and the number of live
tracked allocations at one hundred thousand, so neither a single oversize request nor an
unbounded number of small ones can run the tracking table away.

## What it tracks

Each live allocation is an `AllocatedPage` ([`types/page.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/types/page.rs#L20)) kept in a `Vec` behind the
allocator's mutex:

```
  struct AllocatedPage {
      page_id:       u64,        // monotonic, from INITIAL_PAGE_ID = 1
      virtual_addr:  VirtAddr,
      physical_addr: PhysAddr,
      allocation_time: u64,      // TSC at allocation
      size:          usize,      // rounded-up byte size
  }
```

The record is what lets the allocator answer `get_page_info`, `is_allocated`, and the free
path by virtual address; the monotonic `page_id` and the TSC timestamp make an allocation
identifiable in a dump. The allocator is a single global, `PAGE_ALLOCATOR`, a `Mutex` around
the `PageAllocator` struct ([`manager/globals.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/manager/globals.rs#L21)), initialized once at unified-VM bring-up.

## Freeing

`deallocate_page` ([`manager/dealloc.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/manager/dealloc.rs#L26)) reverses the allocation and zeroes on the way
out as well:

```
  deallocate_page(va):
      idx = tracked page with virtual_addr == va      else PageNotFound
      page = remove(idx)
      write_bytes(va, 0, page.size)                    // zero before unmap
      free_virtual_pages(va, page.size / PAGE_SIZE)    // buddy unmap + frame free
      record deallocation
```

Freeing an address that was never allocated here is `PageNotFound` rather than a silent
unmap, so the allocator will not tear down a range it did not carve. The range is zeroed
before it is unmapped, which pairs with the zero-on-allocate to give the property that page
memory holds no stale content either when handed out or after being reclaimed; this is the
per-allocation half of the [zeroization](/docs/subsystems/memory/zeroization/) posture.

## Statistics

`AllocatorStats` ([`types/stats.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/types/stats.rs#L19)) counts total allocations and deallocations, live page
count, total bytes, and a peak page high-water mark maintained with a compare-exchange loop
so a concurrent allocation cannot lose a peak update. The snapshot is available through
`get_stats`, `get_allocation_count`, `get_total_bytes_allocated`, and `get_peak_pages`
([`manager/api.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/manager/api.rs)), which makes the kernel's virtual-range usage observable at runtime.

## Where it sits

```
  page_allocator   tracked virtual-range allocation, zero-on-alloc/free, stats
      |
      v
  buddy_alloc      contiguous virtual pages, frame backing, mapping and unmapping
      |
      v
  frame allocator  raw physical frames        paging manager  the mappings
```

The page allocator is the tracked, zeroing, size-bounded front the rest of the kernel calls
for whole-range allocations; the buddy allocator underneath owns the virtual-range bookkeeping
and the actual map and unmap, over the [frame allocator](/docs/subsystems/memory/physical-frames/) and
[paging manager](/docs/subsystems/memory/paging-manager/). The general-purpose byte allocator capsules and kernel
code reach through `alloc` is the separate [heap](/docs/subsystems/memory/heap/); the page allocator is for
page-granular kernel ranges.

## Security analysis

The page allocator carves whole kernel virtual ranges, including per-process kernel stacks, so its
job is to hand those out clean and bounded and to refuse to tear down a range it did not create.
Three properties hold that.

**Zero on both ends.** `allocate_page` writes the whole range to zero before returning it
(`alloc.rs`), and `deallocate_page` zeroes it again before it unmaps it (`dealloc.rs:26`). A caller
therefore never sees a previous tenant's bytes when a range is handed out, and reclaimed memory holds
no readable content when it goes back. This is the page-granular half of the
[zeroization](/docs/subsystems/memory/zeroization/) posture, and it matters most for kernel stacks, where the previous
occupant's saved registers and locals would otherwise linger.

**Bounded above and in count.** A single request is capped at `MAX_ALLOCATION_SIZE` (1 GiB) and the
number of live tracked allocations at `MAX_TRACKED_PAGES` (100000) (`constants.rs`), both checked at
the top of `allocate_page` (`alloc.rs:27`). So neither one oversize request nor an unbounded stream
of small ones can run the tracking `Vec` away or drain virtual space through this path; an
over-request is refused with `InvalidSize` or `TooManyPages` before anything is allocated.

**Free only what was allocated here.** `deallocate_page` looks the address up in its tracked set and
returns `PageNotFound` if it is not there (`dealloc.rs:31`) rather than issuing a blind unmap. The
allocator will not tear down a range it did not carve, so a bad or stale virtual address cannot be
used to unmap arbitrary kernel memory through this interface. The honest boundary: the tracking is a
`Vec` scanned by address, not a guarantee about what lies between two allocations, so this layer
gives lifetime and provenance safety, not guard-page isolation between neighbouring ranges. Guard
pages around stacks are the [hardening](/docs/subsystems/memory/hardening/) subsystem's job.

## Debugging page allocation

Every failure is a `PageAllocError` variant ([`error/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/error/types.rs)) returned to the caller, so a failed
kernel-range allocation names its cause rather than faulting:

```
  NotInitialized        the allocator was used before unified-VM bring-up
  InvalidSize           size == 0, or size > MAX_ALLOCATION_SIZE (1 GiB)
  TooManyPages          the request exceeds the buddy allocator, or tracked pages >= 100000
  FrameAllocationFailed the buddy layer could not back the virtual range with frames
  MappingFailed         the pages could not be mapped
  OutOfVirtualSpace     no contiguous virtual range of that size is free
  PageNotFound          deallocate_page was given an address this allocator never carved
  TranslationFailed     the backing frame could not be resolved for the tracking record
```

The two that read as a bug in the caller rather than resource pressure are `PageNotFound` and
`InvalidSize`: `PageNotFound` on a free means the address is wrong or was already freed (a
double-free or a stale handle), and `InvalidSize` is a zero or absurd request. `OutOfVirtualSpace`
and `TooManyPages` are the ceilings biting, and `FrameAllocationFailed` under them is genuine
physical exhaustion one layer down in the [frame allocator](/docs/subsystems/memory/physical-frames/). The runtime view is
`AllocatorStats` ([`types/stats.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/types/stats.rs)): total allocations and deallocations, live page count, total
bytes, and a peak high-water mark maintained with a compare-exchange loop so a concurrent allocation
cannot lose a peak update. A live page count that climbs and never falls is a leak in a caller that
allocates a kernel range and never frees it; the monotonic `page_id` and TSC timestamp on each
`AllocatedPage` make the leaking allocation identifiable in a dump.

## Where it sits

```
  page_allocator   tracked virtual-range allocation, zero-on-alloc/free, stats
      |
      v
  buddy_alloc      contiguous virtual pages, frame backing, mapping and unmapping
      |
      v
  frame allocator  raw physical frames        paging manager  the mappings
```

The page allocator is the tracked, zeroing, size-bounded front the rest of the kernel calls
for whole-range allocations; the buddy allocator underneath owns the virtual-range bookkeeping
and the actual map and unmap, over the [frame allocator](/docs/subsystems/memory/physical-frames/) and
[paging manager](/docs/subsystems/memory/paging-manager/). The general-purpose byte allocator capsules and kernel
code reach through `alloc` is the separate [heap](/docs/subsystems/memory/heap/); the page allocator is for
page-granular kernel ranges, and the guard pages and canaries that protect the stacks it carves
are on the [hardening](/docs/subsystems/memory/hardening/) page.

## Source map

```
  src/memory/page_allocator/manager/alloc.rs    allocate_page, zero-on-alloc
  src/memory/page_allocator/manager/dealloc.rs  deallocate_page, zero-on-free
  src/memory/page_allocator/manager/mapping.rs  buddy-allocator backing and translation
  src/memory/page_allocator/manager/api.rs      the public surface and init
  src/memory/page_allocator/types/page.rs       AllocatedPage, PageInfo
  src/memory/page_allocator/types/stats.rs      AllocatorStats and the peak high-water mark
  src/memory/page_allocator/error/types.rs      PageAllocError
  src/memory/page_allocator/constants.rs        the size and tracking bounds
```

Every reference above is verified against those trees. The frames come from the
[physical frame allocator](/docs/subsystems/memory/physical-frames/), the mapping goes through the
[paging manager](/docs/subsystems/memory/paging-manager/), the zeroing is the [zeroization](/docs/subsystems/memory/zeroization/) posture, and
the guard pages around carved stacks are on the [hardening](/docs/subsystems/memory/hardening/) page.
