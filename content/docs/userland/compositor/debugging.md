---
title: "Debugging the compositor"
description: "This page lists the log markers the compositor and its boot path emit, and the concrete failure modes with where to look for each."
weight: 9
---
This page lists the log markers the compositor and its boot path emit, and the concrete failure modes with
where to look for each. For what the compositor does and how it is built, read the [README](/docs/userland/compositor/), the
[operations](/docs/userland/compositor/operations/), the [frame pacing](/docs/userland/compositor/frame-pacing/), the [scene and damage](/docs/userland/compositor/scene-and-damage/),
the [GPU client](/docs/userland/compositor/gpu-client/), and the [cursor and input](/docs/userland/compositor/cursor-and-input/) pages in this folder.

## Log markers

The first thing to confirm is that the capsule spawned. On a successful boot the kernel logs
`[COMPOSITOR] capsule spawned`: the desktop fleet calls `boot("COMPOSITOR", "compositor", ...)` and its `Ok`
arm calls `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/spawn_plan/desktop_fleet.rs:93`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L93), [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that
line is absent the capsule never started, and the `Err` arm logged an error line through `boot_log::error`
instead ([`capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability failure.

The install path also emits a `[SPAWN]` line: `[SPAWN] name=compositor pid=0x... caps=0x7819 entry=0x...`
([`src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs#L18) through `:26`). Note
`caps=0x7819`, the granted mask, not the `0x7919` manifest ceiling (the two differ only in the `Debug` bit,
[README](/docs/userland/compositor/)).

The compositor is the display service the desktop fleet's clients wait on: the boot splash and wallpaper
poll `mk_service_lookup("compositor")` and retry until it resolves, so a desktop that never paints usually
means the compositor never registered. Because setup acquires the graphics port, the backing framebuffer,
its geometry, and the GOP-versus-virtio mode before the loop runs, a compositor that spawns but never
presents is stuck in that acquisition ([`src/wait_for_setup.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L25)), not the loop.

## Failure modes

### Black screen, nothing paints

Either setup never completed (no framebuffer acquired) or nothing has ever been damaged. The first real
frame comes from `mark_full` at setup ([`src/setup/prime_once.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_once.rs#L53), [`src/setup/prime_gop.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_gop.rs#L66)), so a
black screen after a clean spawn points at a client never submitting a layer, not at the compositor. If
setup itself is stuck, the virtio path is failing its checks (no gfx service, absent primary surface, format
mismatch, or a stride/byte-length that does not validate, [`src/setup/prime_once.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_once.rs#L27) through `:51`) and
the fallback to GOP has not fired yet: it only fires after `VIRTIO_ATTEMPTS_BEFORE_GOP = 6` failed virtio
attempts ([`src/wait_for_setup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L23)).

### A window never appears

A `SCENE_SUBMIT` with a zero-area rectangle, or one that does not fit the display, is rejected with
`E_INVAL` before a layer is created ([`src/server/handlers/scene_submit.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/scene_submit.rs#L49)), so a missing window is
usually a geometry rejection, not a lost frame. A submit past 32 live layers also returns `E_INVAL`
([`src/state/scene/submit.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/submit.rs#L28)). Confirm the client is submitting inside the geometry it read from
`DISPLAY_INFO`.

### A window lingers after its capsule dies, then vanishes

A layer whose surface can no longer be attached is not painted and its `miss_count` climbs; after
`REAP_THRESHOLD = 60` consecutive misses the layer is reaped and its surface forgotten
([`src/frame_pacer/composite.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/composite.rs#L24), `:57`, [`src/state/scene/reap_unattachable.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/reap_unattachable.rs#L37)). A window that hangs
for about a second after its owner exits and then disappears is the reaper working, not a leak.

### No present in virtio mode

Each virtio op returns a specific error on a non-zero driver status: `"gfx transfer: driver rejected"`
([`src/gfx_client/transfer.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gfx_client/transfer.rs#L44)), `"gfx scanout: driver rejected"` ([`src/gfx_client/set_scanout.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gfx_client/set_scanout.rs#L44)),
`"gfx flush: driver rejected"` ([`src/gfx_client/flush.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gfx_client/flush.rs#L44)). A compositing loop that runs but shows
nothing on a virtio machine is a driver rejection on transfer, scanout, or flush. The first-frame
`set_scanout` in particular must succeed or the resource is never bound to the panel
([`src/frame_pacer/tick.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/tick.rs#L49)). The loop latches the first such error once into `ctx.scanout_error_reported`
and keeps running ([`src/server/runner/entry.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L30)), so the failure will not spam the log.

### No present in GOP mode

`mk_surface_present` returning negative yields `"gop present rejected"` ([`src/frame_pacer/tick.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/tick.rs#L32)). This
usually means the registered backing surface's VA did not resolve to a real VMA, which is exactly why the
GOP path backs the surface with a dedicated `mk_mmap` region rather than the heap: mmap gives a page-aligned
VMA whose start is exactly `base_va`, so the present path resolves it, where a heap allocation would sit
inside the heap VMA and never match ([`src/setup/prime_gop.rs:98`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_gop.rs#L98), `:102`).

### Tearing, or a smear between two small changes

Damage is a single bounding box, so a change in two opposite corners dirties everything between them and
repaints it ([`src/state/damage.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/damage.rs#L17)). That is the accumulator merging rectangles, expected in v1, not a
bug. The compositor paces to vsync and issues a release fence before each present
([`src/frame_pacer/tick.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/tick.rs#L28), [`src/frame_pacer/vsync.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/vsync.rs#L19)), so genuine tearing points at the present
backend below the compositor (the virtio driver's flush or the kernel GOP blit), not at the compositing
pass. Per-tile damage that would tighten the dirty region lands alongside multi-CPU render workers in a
follow-up ([`src/state/damage.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/damage.rs#L18)).

## Source map

```
  src/userspace/init/spawn_plan/desktop_fleet.rs   the [COMPOSITOR] boot marker call
  src/userspace/init/capsule_boot/run.rs           the ok / error boot-log arms
  src/kernel_core/.../install/spawn_log.rs          the [SPAWN] name=/caps=/entry= line
  userland/compositor/src/wait_for_setup.rs         backend selection and the acquisition hang point
  userland/compositor/src/setup/prime_once.rs       virtio bring-up checks and mark_full
  userland/compositor/src/setup/prime_gop.rs        GOP backing, the mmap-not-heap reason
  userland/compositor/src/server/handlers/scene_submit.rs   the geometry rejection
  userland/compositor/src/state/scene/reap_unattachable.rs  the lingering-window reaper
  userland/compositor/src/frame_pacer/tick.rs       the two present backends and their errors
  userland/compositor/src/gfx_client/{transfer,set_scanout,flush}.rs  the virtio rejection strings
  userland/compositor/src/state/damage.rs           the single-bbox damage model
```

Every reference above is verified against those trees.
</content>
