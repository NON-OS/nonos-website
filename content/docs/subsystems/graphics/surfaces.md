---
title: "Surfaces"
description: "A surface is a framebuffer a capsule owns: a rectangle of ARGB pixels backed by physical frames, registered with the kernel so it can be shared with a compositor and presented t..."
weight: 1
---
A surface is a framebuffer a capsule owns: a rectangle of ARGB pixels backed by physical frames,
registered with the kernel so it can be shared with a compositor and presented to the display. The
kernel does not draw; it tracks who owns which surface and mediates the frame sharing. This page
documents the surface itself and the registry. The code is `src/kernel_core/surface_registry/`.

## The descriptor and the slot

A capsule describes a surface with a `SurfaceDescriptor` (`types.rs:32`) and the registry keeps a
`Slot` (`table.rs:27`) for each live one:

```
  SurfaceDescriptor { width, height, stride, format, byte_len, base_va, flags }

  Slot { owner_pid, epoch, refcount, width, height, stride, format,
         flags, byte_len, owner_base_va, frames: Vec<PhysAddr> }
```

The only pixel format is `ARGB8888` (`PIXEL_BYTES = 4`), and the surface is backed by a vector of
physical frames the owner already had mapped. The slot records the owner pid, a refcount for
sharing, the geometry, and the frames; `owner_base_va` is the virtual address the owner registered
it at, kept so a self-attach can return it without remapping. Surfaces live in a fixed table of
`SLOT_CAP = 256` slots, and a surface is at most `MAX_PAGES_PER_SURFACE = 8192` pages, which is the
same framebuffer-sized ceiling the [DMA broker](/docs/subsystems/hardware-broker/dma/) uses (one 4K ARGB
surface).

## Registration

`register_surface` (`table.rs:46`) validates the descriptor and claims a free slot:

```
  register_surface(owner_pid, desc, frames):
      reject if format != ARGB8888, or width/height == 0
      reject if stride < width * 4                    // stride must cover a row
      reject if frames empty or > MAX_PAGES_PER_SURFACE
      find a free slot, set refcount = 1
      return (sid, handle)
```

The validation is strict: the format must be the one supported format, the dimensions must be
non-zero, and the stride must be at least a full row of pixels, so a surface cannot be registered
with geometry that would let a later present read out of bounds. A full table returns `OutOfSlots`.
The call returns a surface id and a handle.

## The epoch-guarded handle

A surface handle packs the slot index and an epoch (`types.rs:70`):

```
  handle = (slot_index << 32) | epoch
```

The epoch is what makes a handle safe to hold across a slot being freed and reused. Every operation
that takes a handle, share, attach, present, decodes it and checks the epoch against the slot's
current epoch, rejecting a mismatch with `BadHandle`. So if a surface is released and its slot is
later reused for a different surface, a stale handle from the old surface does not silently address
the new one; it fails. `lookup_owned` additionally checks the caller is the owner (`NotOwner`
otherwise), so ownership operations cannot be performed on someone else's surface.

## Security analysis

A surface is a piece of shareable framebuffer that a capsule registers with the kernel, and the
registry is the one place that decides whether a descriptor is well formed and who owns the slot.
Three properties draw the bound, and one is honestly outside the registry's reach.

**Registration is gated by its own capability.** `MkSurfaceRegister` is dispatched only after the
cap table check passes: `mk.rs:72` routes register, share, and release through `can_surface_create`
([`caps/checks/graphics.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/caps/checks/graphics.rs#L25)), which requires the `GraphicsSurfaceCreate` grant (bit `4096`,
[`capabilities/types.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capabilities/types.rs#L68)) on a valid token. A capsule with no graphics capability cannot mint a
surface at all, and the create capability is distinct from the map and present ones, so the three
stages of the surface lifecycle are separately grantable.

**The descriptor cannot describe an out-of-bounds surface.** `register_surface` (`table.rs:46`)
rejects any format other than `ARGB8888`, a zero width or height, a stride below `width * 4`
(`PIXEL_BYTES`), an empty frame list, and a frame count over `MAX_PAGES_PER_SURFACE = 8192`
(`table.rs:51`). The stride check is the load-bearing one: because the stride is validated to cover
a full row, a later present cannot be talked into reading past the end of a row into another
surface's frames. The syscall layer bounds the request even earlier, capping `byte_len` at 64 MiB
in `do_register` (`surface_handlers.rs:62`) so an unbounded length cannot force a huge `Vec` or a
near-infinite translate loop before the registry ever sees it.

**Ownership and epoch are checked on every handle.** The handle packs a slot index and an epoch
(`types.rs:70`), and `lookup_owned` (`table.rs:84`) returns `NotOwner` if the caller is not the
recorded owner and `NotFound` for an empty slot. The per-slot epoch is bumped on reuse, so a stale
handle to a released surface fails with `BadHandle` rather than aliasing whatever surface later took
the slot. A capsule therefore operates only on surfaces it registered, and only while its handle is
current.

The honest boundary is that the frames themselves are the owner's own already-mapped pages, translated
from `base_va` in `do_register` (`surface_handlers.rs:69`). The registry trusts that those frames belong
to the caller because they came out of the caller's own address space through `translate_address`; it
does not, and without an IOMMU cannot, stop a device that is later handed those physical frames from
reaching other RAM. The registry bounds the descriptor and the ownership, not the reach of downstream
hardware.

## Debugging surfaces

Every registry rejection is a `RegistryError` (`types.rs:56`) that `map_err` (`surface_ops.rs:51`)
turns into an errno the caller sees, so a surface that will not register is never silent about why:

```
  InvalidArg   -> EINVAL   bad format, zero geometry, stride < width*4, or frame count over 8192
  OutOfSlots   -> ENOMEM   the 256-slot table is full
  NotOwner     -> EPERM    share/present on a surface the caller does not own
  NotFound     -> EINVAL   the sid does not name a live slot
  BadHandle    -> EINVAL   the handle epoch does not match the slot (stale handle)
  MapFailed    -> ENOTSUP  attach could not map the frames into the receiver
  NoProc       -> ENOTSUP  no current process during attach
```

The two most common create-time failures are geometry and translation. An `EINVAL` out of
`MkSurfaceRegister` with a valid handle means the descriptor failed a `register_surface` check, and
the usual culprit is a stride that does not cover the row or a `byte_len` over the 64 MiB syscall
cap. An `EFAULT` instead means `translate_address` (`surface_handlers.rs:70`) could not resolve one
of the `base_va` pages, so the surface memory the capsule pointed at is not actually mapped in its
own address space. On the `pid` values `0x17`, `0x26`, `0x27` the handlers also emit `[SURFACE]
register enter` / `register ok` trace lines (`surface_handlers.rs:37`), so on the compositor and
shell you can see registration reach or miss `ok` on the serial log.

## Source map

```
  src/kernel_core/surface_registry/types.rs   SurfaceDescriptor, the handle encoding, RegistryError, the caps
  src/kernel_core/surface_registry/table.rs   the slot table, register_surface, lookup_owned
  src/syscall/dispatch/router/surface_handlers.rs  do_register: byte_len cap and frame translation
  src/syscall/dispatch/router/surface_ops.rs  map_err: RegistryError to errno
  src/syscall/contract/cap_table/mk.rs        the per-op capability gate (register -> GraphicsSurfaceCreate)
  src/capabilities/types.rs                   the graphics capability bits
```

Every reference above is verified against those trees. The cross-address-space frame mapping these
surfaces feed is on the [sharing](/docs/subsystems/graphics/sharing/) page, present and vsync are on the
[presentation](/docs/subsystems/graphics/presentation/) page, and the framebuffer-sized 8192-page ceiling is shared with the
[DMA broker](/docs/subsystems/hardware-broker/dma/).
