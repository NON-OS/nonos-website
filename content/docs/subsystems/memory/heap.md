---
title: "The Kernel Heap"
description: "The kernel heap backs alloc, so Vec, Box, BTreeMap, and every other dynamic structure in the kernel allocate through it."
weight: 5
---
The kernel heap backs `alloc`, so `Vec`, `Box`, `BTreeMap`, and every other dynamic
structure in the kernel allocate through it. It comes up in two phases: a small
fixed buffer available before paging and the frame allocator exist, and then a
larger frame-backed region mapped at a fixed virtual base. Both phases drive the
same allocator, which zeroes memory on allocation and on free. The code is under
`src/memory/heap/`.

## The global allocator

The heap is the Rust global allocator ([`src/memory/heap/manager/globals.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/heap/manager/globals.rs#L21)):

```
  #[global_allocator]
  static KERNEL_HEAP: SecureHeapAllocator = SecureHeapAllocator::new();
```

Because it is marked `#[global_allocator]`, every `alloc`-crate allocation in the
kernel routes to it, which is why bringing it up early in boot is what makes `Vec`
and friends available to the rest of initialisation. The allocator type is
`SecureHeapAllocator` (`src/memory/heap/types/`); the "secure" is the zeroing
policy described below.

## The two phases

The heap starts in bootstrap mode. A fixed static buffer is reserved in the kernel
image (`globals.rs:29`):

```
  static mut BOOTSTRAP_HEAP_MEMORY: BootstrapHeapMemory =
      BootstrapHeapMemory { data: [0u8; BOOTSTRAP_HEAP_SIZE] };
  static USING_BOOTSTRAP: AtomicBool = AtomicBool::new(true);
```

`USING_BOOTSTRAP` begins `true`, so the earliest allocations, made before the frame
allocator and paging are up, are served from this fixed buffer built into the
image. It is small and fixed, so it is only meant to carry init far enough to map
the real heap. Once that is done, `init` flips `USING_BOOTSTRAP` to `false`
(`init.rs:38`) and every subsequent allocation is served from the mapped region.

## Bringing up the real heap

`init` ([`src/memory/heap/manager/init.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/heap/manager/init.rs#L26)) allocates the backing frames, maps
them at the heap's virtual base, and hands the region to the allocator:

```
  init():
      if the heap is already initialised -> Ok
      heap_size  = layout::KHEAP_SIZE
      heap_pages = ceil(heap_size / PAGE_SIZE)
      frames     = allocate_heap_frames(heap_pages)     one frame per page
      heap_start = map_heap_memory(frames)              map at KHEAP_BASE, R|W
      KERNEL_HEAP.init(heap_start, heap_size)
      HEAP_STATS.set_total_size(heap_size)
      USING_BOOTSTRAP = false
```

`allocate_heap_frames` (`init.rs:42`) pulls one frame at a time from the
[frame allocator](/docs/subsystems/memory/physical-frames/) and returns `HeapError::FrameAllocationFailed`
if any request comes back empty, so a heap that cannot be fully backed fails init
rather than coming up partially. `map_heap_memory` (`init.rs:53`) maps each frame in
turn at `KHEAP_BASE + i * PAGE_SIZE` with `READ | WRITE` permissions through the
[paging manager](/docs/subsystems/memory/paging-manager/), returning `HeapError::MappingFailed` on any
failure. The heap is therefore a contiguous virtual range at a fixed base, backed by
frames that need not be contiguous in physical memory. `init` is idempotent: a
second call returns `Ok` immediately once the heap is initialised.

## Zeroing on allocation and free

Two flags govern the allocator's zeroing policy, and both default to on
(`globals.rs:24`):

```
  HEAP_ZERO_ON_ALLOC  AtomicBool = true
  HEAP_ZERO_ON_FREE   AtomicBool = true
```

With zero-on-alloc, memory handed out never carries the contents of a previous
allocation, so a bug that reads uninitialised memory sees zeros rather than stale
kernel data. With zero-on-free, memory is wiped as it is returned, so freed data
does not sit in the heap waiting to be read back through a later allocation. This is
the same defence-in-depth posture the [ZeroState](/docs/security/) model
applies to capsule memory, applied here to the kernel's own heap, and it is what the
"secure" in `SecureHeapAllocator` names.

## Statistics and time

The heap keeps `HEAP_STATS` (`HeapStatistics`) with the total size set at init and
allocation counts maintained thereafter, and `get_timestamp` (`globals.rs:32`) reads
the TSC directly for timestamping, since the heap can be exercised before the higher
time bases are calibrated.

## Errors

The heap error type (`src/memory/heap/error/`) surfaces two failures from init:
`FrameAllocationFailed` when the frame allocator cannot back the whole heap, and
`MappingFailed` when a page cannot be mapped at the heap base.

## Where this connects

The heap depends on the [frame allocator](/docs/subsystems/memory/physical-frames/) for its backing pages
and the [paging manager](/docs/subsystems/memory/paging-manager/) to map them, so it is brought up in
`init_unified_vm`'s wake during [boot](/docs/subsystems/boot/), after those two are live and before
the rest of init needs dynamic allocation. Its virtual base and size are
`layout::KHEAP_BASE` and `layout::KHEAP_SIZE` in the memory layout constants.

## Security analysis

The heap is a shared kernel resource, so its safety properties are about not leaking one allocation's
data into the next and not coming up in a half-mapped state. Two properties carry that, and one bound
is worth naming.

**Zero on both ends.** `HEAP_ZERO_ON_ALLOC` and `HEAP_ZERO_ON_FREE` both default to `true`
(`globals.rs:24`). Zero-on-alloc means memory handed out never carries a previous allocation's bytes,
so a bug that reads uninitialised memory sees zeros rather than stale kernel data, secrets or
pointers included. Zero-on-free means a freed block is wiped as it is returned, so data does not sit
in the heap waiting to be read back through a later allocation. This is the "secure" in
`SecureHeapAllocator`, and it is the [zeroization](/docs/subsystems/memory/zeroization/) posture applied to the kernel's own
heap rather than to capsule frames. It is a single zero pass, not the multi-pass DoD erase, which is
the right cost for steady-state reclaim.

**All-or-nothing bring-up.** `init` (`init.rs:26`) pulls one frame at a time through
`allocate_heap_frames` and returns `HeapError::FrameAllocationFailed` the moment any request comes
back empty (`init.rs:47`), and `map_heap_memory` returns `HeapError::MappingFailed` if any page fails
to map (`init.rs:58`). So a heap that cannot be fully backed fails init loudly rather than coming up
partially mapped, where a later allocation would fault on an unbacked page. `init` is idempotent, a
second call returns `Ok` once initialised, so re-entry cannot double-map the base.

The honest boundary is that the heap frames are mapped `READ | WRITE` with no guard pages between
allocations, so the heap relies on the allocator's own bounds and the [hardening](/docs/subsystems/memory/hardening/)
tracker rather than on hardware isolation between neighbouring heap objects. The isolation the heap
does give you is against the previous *tenant* of a block (through zeroing), not against a live
neighbour overrunning into you.

## Debugging the heap

The heap surfaces exactly two failures from init, both `HeapError` variants ([`error/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/error/types.rs)), and
they point at different layers:

```
  FrameAllocationFailed   the frame allocator could not back the whole heap (physical exhaustion)
  MappingFailed           a page could not be mapped at KHEAP_BASE (paging manager rejected it)
```

A `FrameAllocationFailed` at heap init is a bottom-of-the-stack problem: the
[frame allocator](/docs/subsystems/memory/physical-frames/) ran out before it could hand over `KHEAP_SIZE / PAGE_SIZE`
frames, so the fix is upstream (a bad memory-map seed, or the heap sized larger than the managed
range). A `MappingFailed` means the frames existed but the [paging manager](/docs/subsystems/memory/paging-manager/)
refused a mapping at the heap base, which points at a layout or W^X problem rather than exhaustion.
Because init is the only place these are returned, a heap fault *after* init is not a heap-init bug,
it is an ordinary allocation reading or writing past its bounds, which is the [hardening](/docs/subsystems/memory/hardening/)
tracker's and the page-fault handler's territory. The heap's `HEAP_STATS` (total size set at init,
allocation counts thereafter) is the runtime view: a live allocation count that never drops while
memory pressure climbs is a leak in a caller, not in the heap.

## Where this connects

The heap depends on the [frame allocator](/docs/subsystems/memory/physical-frames/) for its backing pages
and the [paging manager](/docs/subsystems/memory/paging-manager/) to map them, so it is brought up in
`init_unified_vm`'s wake during [boot](/docs/subsystems/boot/), after those two are live and before
the rest of init needs dynamic allocation. Its virtual base and size are
`layout::KHEAP_BASE` and `layout::KHEAP_SIZE` in the memory layout constants. The zeroing
policy is the per-heap arm of the [zeroization](/docs/subsystems/memory/zeroization/) posture, and overrun detection over
heap ranges lives in the [hardening](/docs/subsystems/memory/hardening/) tracker.

## Source map

```
  src/memory/heap/manager/globals.rs  the global allocator, bootstrap buffer, flags
  src/memory/heap/manager/init.rs      init, allocate_heap_frames, map_heap_memory
  src/memory/heap/types/               SecureHeapAllocator and HeapStatistics
  src/memory/heap/error/types.rs       HeapError
  src/memory/layout/                   KHEAP_BASE and KHEAP_SIZE
```

Every reference above is verified against those trees. The frames come from the
[physical frame allocator](/docs/subsystems/memory/physical-frames/), the mapping goes through the
[paging manager](/docs/subsystems/memory/paging-manager/), the zeroing is the [zeroization](/docs/subsystems/memory/zeroization/) posture, and
heap-range corruption detection is on the [hardening](/docs/subsystems/memory/hardening/) page.
