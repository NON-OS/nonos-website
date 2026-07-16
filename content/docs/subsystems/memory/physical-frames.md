---
title: "The Physical Frame Allocator"
description: "Physical memory is managed one 4 KiB frame at a time by a bitmap allocator, one bit per frame, seeded at boot from the firmware memory map."
weight: 1
---
Physical memory is managed one 4 KiB frame at a time by a bitmap allocator, one
bit per frame, seeded at boot from the firmware memory map. It is the bottom of
the memory subsystem: the paging manager, the kernel heap, the page allocator,
and the DMA pools all draw their physical frames from here. This page documents
its state, how it is seeded, how a frame is allocated and freed, the allocation
flags, and the safety checks the free path enforces. The code is under
`src/memory/phys/`.

## The state and the bitmap

The allocator's whole state is one structure
([`src/memory/phys/types/allocator_state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/phys/types/allocator_state.rs#L18)):

```
  AllocatorState
    frame_start   u64        base physical address of the managed range
    frame_count   usize      number of frames it manages
    bitmap_ptr    *mut u8    the bitmap, one bit per frame
    bitmap_bytes  usize      size of the bitmap in bytes
    next_hint     u64        where the next-fit search starts
    random_seed   u64        seed for placement randomisation
```

The bitmap is the allocator. Each frame is one bit: a set bit means the frame is
allocated, a clear bit means it is free. Frame `i` covers the physical range
`frame_start + i * 4096`. `is_initialized` (`allocator_state.rs:39`) is true once
`frame_count` is non-zero and the bitmap pointer is not null, and every operation
checks it first, so the allocator refuses to hand out or free frames before it is
seeded. The structure is marked `Send` and `Sync` because it lives behind a lock
at the module boundary; the functions documented below take it by mutable
reference.

## Seeding at boot

The allocator is seeded from the boot handoff during early memory init
([`src/kernel_core/init/memory.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/memory.rs#L21)):

```
  init_memory(handoff):
      pick the single largest usable region from handoff.mmap
      if that region is smaller than 1 MiB or invalid:
          fall back to (0x100000, 0x8000_0000)
      if its start is below 1 MiB, clamp the start up to 0x100000
      phys::init(start, end)
      on error, or if still not initialised, init_fallback()
      once initialised, bring up the DMA display pool
```

It scans `handoff.mmap.usable_regions()` and keeps the widest one, so the
allocator is seeded from the largest contiguous block of usable RAM the firmware
reported. The low megabyte is always excluded by clamping the start up to
`0x100000`, since that region holds legacy structures the kernel does not
allocate over. If the memory map is missing or unusably small, `init_fallback`
([`init/memory.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/init/memory.rs#L56)) tries three hard-coded ranges in turn, and a failure to
initialise at all is logged as `CRITICAL`. Only once the allocator is live does
memory init bring up the DMA pool that depends on it.

## Initialising the bitmap

`phys::init` reduces to `init_with_bitmap` ([`src/memory/phys/allocator/init.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/phys/allocator/init.rs#L23)),
which validates the range and the bitmap before it will accept them:

```
  init_with_bitmap(state, managed_start, managed_end, bitmap_ptr, bitmap_bytes):
      if managed_end <= managed_start            -> InvalidRange
      aligned_start = align_up(managed_start, 4096)
      aligned_end   = align_down(managed_end, 4096)
      if aligned_end <= aligned_start            -> NoCompletePagesInRange
      frame_count    = frames_in_range(aligned_start, aligned_end)
      required_bytes = bitmap_bytes_for_frames(frame_count)
      if bitmap_bytes < required_bytes           -> BitmapTooSmall
      if bitmap_ptr is null                       -> InvalidBitmapPointer
      store the fields, next_hint = 0, random_seed = derive_seed()
      zero the bitmap over required_bytes
```

The range is aligned inward to whole pages, so a partial page at either end is
dropped rather than half-managed. The bitmap is required to be large enough for
the whole frame count before it is accepted, and it is zeroed on init, which
means every managed frame starts free. The next-fit hint starts at zero and the
placement seed is drawn once here.

## Allocating a frame

`allocate_frame` ([`src/memory/phys/allocator/alloc.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/phys/allocator/alloc.rs#L20)) returns the next free
frame, honouring the requested flags:

```
  allocate_frame(state, flags):
      if not initialised -> None
      if flags has HIGH:
          scan i from the top down; take the first free bit
      else:
          scan from next_hint upward, wrapping, for the first free bit
      set the bit, advance next_hint past it
      frame = frame_start + i * 4096
      if flags has ZERO: zero the frame
      return Some(frame)
```

The default search is next-fit: it begins at `next_hint`, scans forward wrapping
around the whole bitmap, and on success advances the hint one past the frame it
took. In the common case a free frame is found immediately after the last one,
which keeps allocation close to constant time, and the wrap guarantees the whole
range is searched before allocation fails. The `HIGH` flag reverses the search to
run from the top of the range downward, used where a caller wants frames placed
high, and the `ZERO` flag zero-fills the frame before returning it. If no free bit
exists anywhere, allocation returns `None`; the allocator never faults or halts on
exhaustion, it reports it, and the caller decides what to do.

## Freeing a frame

`deallocate_frame` (`alloc.rs:55`) validates a frame thoroughly before clearing
its bit, and in particular detects a double free:

```
  deallocate_frame(state, frame):
      if not initialised                    -> NotInitialized
      if frame.addr < frame_start            -> AddressBelowRange
      offset = frame.addr - frame_start
      if offset not page-aligned             -> AddressNotAligned
      idx = offset / 4096
      if idx >= frame_count                  -> AddressAboveRange
      if the bit is already clear            -> DoubleFree
      clear the bit
```

A frame outside the managed range, below or above it, is rejected rather than
corrupting the bitmap, an unaligned address is rejected, and an attempt to free a
frame that is already free returns `DoubleFree` rather than silently clearing an
already-clear bit. The free path cannot be used to mark a frame free twice or to
touch a bit outside the allocator's own range.

## Flags and errors

Allocation flags are `AllocFlags` ([`src/memory/phys/types/flags.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/phys/types/flags.rs)): the paths
above use `HIGH` to place from the top of the range and `ZERO` to zero-fill a
frame before returning it. The error type is `PhysAllocError`
([`src/memory/phys/error/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/phys/error/types.rs)); the variants the init, alloc, and free paths
return are `InvalidRange`, `NoCompletePagesInRange`, `BitmapTooSmall`,
`InvalidBitmapPointer`, `NotInitialized`, `AddressBelowRange`, `AddressNotAligned`,
`AddressAboveRange`, and `DoubleFree`.

## Security analysis

This allocator is the root of physical memory, so a corruption here is a corruption everywhere above
it. Its safety is the discipline of the free path and the refusal to operate before it is seeded.
Three properties carry that.

**A frame is validated against the managed range before its bit is touched.** `deallocate_frame`
(`alloc.rs:55`) rejects an address below `frame_start` (`AddressBelowRange`), an unaligned address
(`AddressNotAligned`), and an index at or past `frame_count` (`AddressAboveRange`) before it computes
a bit position. So the free path cannot be used to clear a bit outside the allocator's own bitmap,
which means a bad or attacker-influenced address cannot corrupt the free/allocated state of memory
the allocator does not manage.

**Double free is a hard error.** If the target bit is already clear, `deallocate_frame` returns
`DoubleFree` (`alloc.rs:72`) rather than silently clearing an already-clear bit. This is the bottom
line under the higher-level lifetime tracking: even if a caller loses track of a frame's state, the
bitmap itself refuses to mark the same frame free twice, which is what prevents the classic double-free
that hands the same physical frame to two owners.

**It never operates uninitialised, and never faults on exhaustion.** Every operation checks
`is_initialized` first (`allocator_state.rs:39`), so the allocator refuses to hand out or free frames
before it is seeded from the firmware map, and a genuinely out-of-frames `allocate_frame` returns
`None` (`alloc.rs:20`) rather than faulting or halting: exhaustion is reported and the caller decides.
The low megabyte is excluded at seed time by clamping the start up to `0x100000`, so the allocator
never hands out the legacy region. The honest boundary worth stating: this layer does not zero a
frame on allocation unless the `ZERO` flag is passed, so the no-stale-data guarantee for reused memory
comes from the *free* path zeroing (the [zeroization](/docs/subsystems/memory/zeroization/) `zero_frame` on deallocate) and
from the callers that pass `ZERO`, not from allocation zeroing by default here.

## Debugging the frame allocator

The frame allocator does not narrate to the console; it returns a `PhysAllocError`
([`error/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/error/types.rs)), and the variant is the whole diagnosis. Seeding and the free path return distinct
ones:

```
  InvalidRange           managed_end <= managed_start                  a bad seed range
  NoCompletePagesInRange after inward alignment, nothing is left       range too small or misaligned
  BitmapTooSmall         the bitmap cannot cover frame_count           bitmap sized wrong for the range
  InvalidBitmapPointer   the bitmap pointer is null
  NotInitialized         an operation ran before seeding
  AddressBelowRange      a free below frame_start                      wrong or foreign address
  AddressNotAligned      a free of a non-page-aligned address          a corrupted or fabricated frame
  AddressAboveRange      a free at or past frame_count                 wrong or foreign address
  DoubleFree             a free of an already-free frame               a lifetime bug in the caller
```

The three `Address*` variants and `DoubleFree` are the ones that mean a caller handed the allocator a
bad frame, and they are the tell for a lifetime bug or a stray physical address rather than exhaustion.
Allocation exhaustion, by contrast, is not an error variant at all: `allocate_frame` returns `None`, so
a caller that maps that to its own "no memory" error (the [heap's](/docs/subsystems/memory/heap/) `FrameAllocationFailed`,
the [DMA path's](/docs/subsystems/hardware-broker/dma/) `NoMemory`) is reporting real physical pressure. At boot,
the seeding step ([`kernel_core/init/memory.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/kernel_core/init/memory.rs)) logs a `CRITICAL` if the allocator cannot be
initialised at all after the fallback ranges, which is the one console signal from this layer and means
the firmware memory map was unusable.

## What sits above it

This allocator hands out single frames. Contiguous multi-frame allocation is a
separate path ([`src/memory/phys/allocator/contiguous.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/phys/allocator/contiguous.rs)). Above the frame
allocator, the [paging manager](/docs/subsystems/memory/paging-manager/) consumes frames for page
tables and mappings, the [kernel heap](/docs/subsystems/memory/heap/) is backed by frames mapped at a
fixed virtual base, and the DMA pools reserve frames for device buffers. Each of
those has its own page; this one is the source they all draw from.

## Source map

```
  src/memory/phys/types/allocator_state.rs  the AllocatorState
  src/memory/phys/allocator/init.rs         init_with_bitmap
  src/memory/phys/allocator/alloc.rs        allocate_frame, deallocate_frame, the double-free check
  src/memory/phys/bitmap/                    the bit operations
  src/memory/phys/types/flags.rs            AllocFlags
  src/memory/phys/error/types.rs            PhysAllocError
  src/kernel_core/init/memory.rs            the boot seeding
```

Every reference above is verified against those trees. The free-path zeroing that makes reused frames
safe is on the [zeroization](/docs/subsystems/memory/zeroization/) page, and the consumers that turn a `None` allocation into
their own error are the [heap](/docs/subsystems/memory/heap/), the [paging manager](/docs/subsystems/memory/paging-manager/), and the
[DMA path](/docs/subsystems/hardware-broker/dma/).
