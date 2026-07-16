---
title: "Sharing and Attaching"
description: "A surface becomes useful when more than one capsule can see it: a client draws into it and a compositor reads it to build the screen."
weight: 2
---
A surface becomes useful when more than one capsule can see it: a client draws into it and a
compositor reads it to build the screen. NØNOS shares surfaces by mapping the same physical frames
into a second capsule's address space, so the sharing is zero-copy, and it tracks the sharing with
a refcount and a per-receiver attach map. This page documents share, attach, and release. The code
is under `src/kernel_core/surface_registry/share/` and `.../release/`.

## Share

`share_surface` ([`share/share_surface.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/share/share_surface.rs#L20)) is the owner marking a surface available and bumping
its refcount:

```
  share_surface(owner_pid, handle):
      decode handle; verify epoch (BadHandle) and owner (NotOwner)
      refcount += 1 (checked)
      return handle
```

Only the owner can share, and the epoch is checked, so a capsule cannot share a surface it does not
own or a stale handle. The refcount is what keeps the frames alive while any sharer holds them.

## Attach

`attach_surface` ([`share/attach_surface.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/share/attach_surface.rs#L25)) is the receiving side: it maps the surface's frames
into the receiver's address space and hands back the descriptor and the virtual address:

```
  attach_surface(receiver_pid, handle, out_desc):
      if already attached (attach_map lookup):  return the recorded VA   // idempotent
      if receiver is the owner and has a base VA:  return owner_base_va   // self-attach, no remap
      else:
          refcount += 1; clone the frame list
          reserve a VMA in the receiver of frames.len() pages
          map each frame into the receiver's ASID with user read-write perms
          record (receiver, handle) -> (VA, len) in the attach map
          return the VA
```

The general case maps the surface's physical frames into a freshly reserved region of the
receiver's address space, one page per frame, so both capsules now have the same physical pixels
mapped: a write by the client is visible to the compositor with no copy. Two special cases avoid
redundant work: a repeat attach returns the VA already recorded for that receiver and handle
(idempotent), and a self-attach by the owner returns the VA the owner already registered the
surface at rather than creating a second mapping, which would leave a virtual address with no
backing VMA and break present. The mapping uses the [paging manager](/docs/subsystems/memory/paging-manager/)
per-ASID map, and the receiver's VA comes from its own VMA reservation, so the kernel never guesses
a user address.

## Release

Surfaces are released two ways (`release/`): `release_surface` drops a reference (and frees the
slot and frames when the last reference goes), and `release_owned_by_pid` is called on process exit
to drop every surface a capsule owned. The attach map is likewise cleaned per handle and per pid
(`attach_map/forget*`), so a capsule that exits does not leave a surface slot or a stale attachment
behind. Combined with the epoch on the handle, this means a surface's lifetime is bounded by its
references and its owner, and a handle to a released surface fails rather than aliasing a new one.

## Security analysis

Sharing is where one capsule's pixels become visible to another, so it is the point in the graphics
path with the most opportunity to leak or alias memory across an address-space boundary. Three
properties keep it honest, and the same IOMMU boundary as the rest of the DMA-adjacent path applies.

**Share and attach are separately gated.** Marking a surface shareable goes through
`MkSurfaceShare`, which the cap table routes to `can_surface_create` (`mk.rs:73`); mapping a shared
surface into a receiver goes through `MkSurfaceAttach`, which routes to `can_surface_map`
(`mk.rs:75`), requiring the `GraphicsSurfaceMap` grant (bit `8192`, [`capabilities/types.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capabilities/types.rs#L69)). The
producer of a surface and the consumer that maps it are therefore distinct capabilities: a
compositor that only ever attaches other capsules' surfaces needs the map grant but not the create
grant, and a client that only draws needs create but not map.

**Only the owner shares, and the epoch guards the frames.** `share_surface`
([`share/share_surface.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/share/share_surface.rs#L20)) decodes the handle, rejects a non-owner with `NotOwner` and a stale
epoch with `BadHandle`, then bumps the refcount under check. So a capsule cannot mark someone else's
surface shareable, and it cannot resurrect a released surface through a stale handle. The refcount is
what keeps the frames alive while any sharer holds them, which means a surface's backing memory is
freed exactly when the last reference drops, not while a compositor is still reading it.

**The receiver only ever sees frames it was handed.** `attach_surface`
([`share/attach_surface.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/share/attach_surface.rs)) maps the surface's existing physical frames into the receiver's own ASID
at a VA the receiver reserved through `reserve_vma`, one page per frame, with user read-write perms
(`attach_surface.rs:71`). The kernel never invents a receiver address, and it maps only the frame
list recorded in the slot, so a receiver cannot attach its way to memory outside the surface it was
given a handle for. The idempotent and self-attach shortcuts return an already-recorded VA rather
than laying down a second aliasing mapping.

The honest boundary is again the IOMMU. The whole point of the design is that both capsules map the
*same* physical frames so the sharing is zero-copy, which means the CPU-side isolation between the
two capsules is deliberately relaxed for exactly those pages. That is safe between two cooperating
graphics capsules under paging, but once a display device is programmed with those physical frames,
nothing in this path stops the device from reaching other RAM; that bound lives with the
[DMA broker](/docs/subsystems/hardware-broker/dma/) and its absent IOMMU backend, not with the registry.

## Debugging sharing and attaching

Attach is the step that touches two address spaces, so its failures map to the paging-related
`RegistryError` variants (`types.rs:56`), surfaced as errnos by `map_err` (`surface_ops.rs:51`):

```
  BadHandle  -> EINVAL    stale epoch: the surface was released and its slot reused
  NotOwner   -> EPERM     share on a surface the caller does not own
  NoProc     -> ENOTSUP   no current process at attach time (attach_surface.rs:72)
  MapFailed  -> ENOTSUP   the cross-ASID mapping itself failed
```

`MapFailed` is the interesting one, because it has three distinct origins inside
`attach_surface`: `lookup_asid_for_process` returned nothing for the receiver (`attach_surface.rs:71`),
`reserve_vma` could not carve a region of `frames.len()` pages (`attach_surface.rs:74`), or a
`map_page_in_asid` call failed while installing a frame (`attach_surface.rs:79`). All three collapse
to `ENOTSUP`, so when a compositor attach fails the way to tell them apart is the receiver's state:
a receiver with no ASID is a process-teardown race, a `reserve_vma` failure is VA exhaustion in the
receiver, and a per-frame map failure points at the frame list or the receiver's page tables. A
`BadHandle` here almost always means the client released the surface out from under the compositor,
which is exactly the aliasing the epoch is there to catch. Attach also emits `[SURFACE] attach
enter` / `attach ok` traces on the compositor and shell pids (`surface_handlers.rs:110`), so you can
see whether attach reached `ok`.

## Source map

```
  src/kernel_core/surface_registry/share/share_surface.rs    share (owner, refcount)
  src/kernel_core/surface_registry/share/attach_surface.rs   attach (cross-ASID frame mapping, MapFailed origins)
  src/kernel_core/surface_registry/attach_map/               per-receiver VA record and cleanup
  src/kernel_core/surface_registry/release/                  release_surface, release_owned_by_pid
  src/syscall/contract/cap_table/mk.rs                       share -> GraphicsSurfaceCreate, attach -> GraphicsSurfaceMap
  src/capabilities/types.rs                                  the graphics capability bits
```

Every reference above is verified against those trees. The descriptor and epoch these operations
rest on are on the [surfaces](/docs/subsystems/graphics/surfaces/) page, present and vsync over the shared frames are on the
[presentation](/docs/subsystems/graphics/presentation/) page, and the zero-copy frame mapping uses the
[paging manager](/docs/subsystems/memory/paging-manager/) per-ASID map.
