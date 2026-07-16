---
title: "Presentation and Vsync"
description: "Once a surface is drawn, it is presented, and a capsule that animates paces itself to the display's refresh by waiting for vertical blank."
weight: 3
---
Once a surface is drawn, it is presented, and a capsule that animates paces itself to the display's
refresh by waiting for vertical blank. The vsync path is worth documenting carefully because its
timing model was the difference between a smooth desktop and a slow one. This page documents present
and vsync. The code is [`src/syscall/dispatch/router/surface_ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/surface_ops.rs) and
[`src/kernel_core/surface_registry/vsync.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/vsync.rs).

## The surface syscalls

Six `MkSurface*` and `MkDisplay*` syscalls make up the surface surface, dispatched by
`surface_ops::handle` (`surface_ops.rs:31`):

```
  MkSurfaceRegister   register a surface, return sid + handle
  MkSurfaceShare      mark it shareable (owner)
  MkSurfaceAttach     map it into the caller, return the descriptor + VA
  MkSurfaceRelease    drop a reference
  MkSurfacePresent    commit the surface's current contents
  MkDisplayVsyncWait  block until the next vertical blank
```

`map_err` (`surface_ops.rs:51`) maps the registry errors to errnos, so a bad handle or a non-owner
operation becomes `EINVAL` or `EPERM` for the caller. Present commits the owner's surface for
display; the compositor capsule reads the shared surfaces and builds the final image, and the
kernel's role is to have kept the frames coherent across the sharers.

## The vsync phase grid

`wait_for_vsync` (`vsync.rs:38`) blocks a caller until the next vblank, computed on a fixed phase
grid derived from absolute time:

```
  wait_for_vsync(display_id, pid):
      period   = 1e9 / target_hz          // 60 Hz default -> ~16.67 ms
      now      = time::now_ns()
      deadline = (now / period + 1) * period   // next boundary on the shared grid
      while now_ns() < deadline:
          sleep_until(deadline); yield
      publish LAST_VBLANK_NS = max(LAST_VBLANK_NS, deadline)
      return deadline
```

The deadline is quantized to a grid of period-sized slots anchored to absolute time, so every
capsule that waits within the same frame computes the *same* next boundary and wakes together. This
is the fix the code documents in place: an earlier version advanced one shared running deadline by a
full period per waiter, so with the compositor, window manager, shell, and cursor all waiting, each
was pushed a period past the last, and the effective refresh collapsed to target_hz divided by the
number of waiters, which is what made the desktop feel slow. The published `LAST_VBLANK_NS` is now
only a monotonic timestamp for readers (a `fetch_max`) and does not feed back into the next
deadline, so waiters can never serialize behind one another. The wait uses the monotonic
[clock](/docs/subsystems/time-and-clock/time-bases/) and the [scheduler](/docs/subsystems/scheduler/sleep-wake/) sleep, so
it is immune to any wall-clock adjustment.

## Security analysis

Present is where a capsule's pixels finally reach the one framebuffer the whole screen shares, so it
is the point where per-surface isolation has to hold up against a caller trying to write outside its
own surface. Three properties bound it, plus the display pool ceiling that keeps a display capsule
from draining RAM.

**Present and vsync are separately gated.** `MkSurfacePresent` routes through `can_present`
(`mk.rs:76`), requiring `GraphicsPresent` (bit `16384`, [`capabilities/types.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capabilities/types.rs#L70)), and
`MkDisplayVsyncWait` routes through `can_display_query` (`mk.rs:77`), requiring
`GraphicsDisplayQuery` (bit `2048`). A capsule can be allowed to pace itself to vblank without being
allowed to present, and the compositor, which is the one capsule that actually commits pixels, is the
one that holds the present grant.

**Present only commits a surface the caller has attached.** `do_present`
(`surface_handlers.rs:134`) does not take a raw pointer; it looks the handle up in the attach map
with `lookup_attached_va` (`surface_handlers.rs:139`) and uses the recorded base VA and byte length,
returning `EINVAL` if the caller has no such attachment. The blit that follows
(`graphics_present.rs:28`) reads from that source through `copy_from_user`, which validates each
source page, and clamps every rectangle against the real framebuffer dimensions: `rect_x >= fb_w`,
`rect_y >= fb_h`, and `rect_x + rect_w > fb_w` all return `EINVAL` (`graphics_present.rs:68`). A
present therefore cannot be steered to write outside the framebuffer, and it can only source from a
surface the caller legitimately mapped.

**The display DMA pool is bounded.** A display driver capsule that needs device-visible framebuffer
memory draws it from the high-memory display pool ([`hardware/broker/dma/pool.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hardware/broker/dma/pool.rs)), whose capacity is
`DISPLAY_FRAMEBUFFER_PAGES = 8192` ([`dma/limits.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/limits.rs#L28)), the same ceiling the DISPLAY class carries
in `dma_page_limit_for_class` ([`dma/limits.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/limits.rs#L44)). 8192 pages is one 3840x2160 ARGB surface, so a
display capsule gets exactly enough for a primary framebuffer and cannot use the display path to
exhaust physical memory.

The honest boundary is that present writes into the single shared boot framebuffer with no per-surface
hardware isolation. The blit clamps geometry and validates the source in software, but every
presenting path lands in the same physical scanout region, so isolation between what different
surfaces put on screen is a software property of the compositor being the sole presenter, not a
hardware one. Without an IOMMU the display device also scans out of raw physical memory, so the same
device-reach boundary as [DMA](/docs/subsystems/hardware-broker/dma/) applies to the framebuffer itself.

## Debugging presentation

The display memory path narrates itself at init through the DMA broker. `init_display_pool`
([`dma/pool.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/pool.rs#L31)) tries to reserve a high contiguous run and prints exactly one of two lines:

```
  [DMA] display pool base=<hex> pages=<n>   the pool was reserved (n is 8192, 4096, 2048, or 1024)
  [DMA] display pool unavailable            no high contiguous run was found at all
```

The pool falls back through `8192 -> 4096 -> 2048 -> 1024` pages ([`dma/pool.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/pool.rs#L36)), so a `base=`
line with `pages=` below 8192 tells you memory was fragmented enough that the full framebuffer pool
could not be carved, which is worth knowing before a display capsule asks for a full-size surface.
The `unavailable` line means no display DMA memory exists at all, and a display driver that depends
on it will not come up.

A present that fails is one of a small set of errnos out of `graphics_present.rs`: `ENOTSUP` if
`framebuffer_state` is `None` (`graphics_present.rs:44`), meaning the boot framebuffer was never
handed off, `EINVAL` for a rectangle that fails the clamp or a `span` shorter than the framebuffer,
and `EFAULT` if `copy_from_user` cannot read a source page (`graphics_present.rs:86`), meaning the
surface memory the caller presented is not actually mapped. At the registry layer a present on a
surface the caller never attached returns `EINVAL` from `do_present` before the blit runs.

The boot framebuffer and the desktop coexist because the kernel's on-screen text console is off by
design. `init_after_fb` ([`sys/boot_log/init.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/sys/boot_log/init.rs#L22)) leaves the bootloader's verified-boot splash in
the framebuffer, sets `DISPLAY_ENABLED` false, and prints `[fbconsole] on-screen log disabled;
serial only`; the kernel log then goes to serial only while the framebuffer is left intact for the
compositor to bring up the boot-splash capsule and the desktop over it. So the kernel and the
desktop are not fighting over the same pixels: the kernel writes its log to serial, and present blits
the compositor's surface into the same framebuffer the bootloader left behind. If you see the green
kernel log on screen it means `DISPLAY_ENABLED` was left true, which would clobber the compositor.

## Source map

```
  src/syscall/dispatch/router/surface_ops.rs     the six MkSurface*/MkDisplay* handlers, map_err
  src/syscall/dispatch/router/surface_handlers.rs  do_present: attach lookup before the blit
  src/syscall/dispatch/router/graphics_present.rs  the clamped blit into the boot framebuffer
  src/kernel_core/surface_registry/vsync.rs        the phase-grid vblank and the serialization fix
  src/kernel_core/init/framebuffer.rs              the boot framebuffer handoff and framebuffer_state
  src/sys/boot_log/init.rs                         the on-screen console left off for the compositor
  src/hardware/broker/dma/pool.rs                  the high-memory display pool and its markers
  src/hardware/broker/dma/limits.rs                DISPLAY_FRAMEBUFFER_PAGES, the DISPLAY class ceiling
  src/syscall/contract/cap_table/mk.rs             present -> GraphicsPresent, vsync -> GraphicsDisplayQuery
```

Every reference above is verified against those trees. The surface and its handle are on the
[surfaces](/docs/subsystems/graphics/surfaces/) page, the cross-address-space sharing the compositor reads through is on the
[sharing](/docs/subsystems/graphics/sharing/) page, and the display pool and its per-class ceiling live with the
[DMA broker](/docs/subsystems/hardware-broker/dma/).
