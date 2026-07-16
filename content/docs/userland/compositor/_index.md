---
title: "The Compositor Capsule"
description: "The compositor owns the screen. It is the one capsule in the desktop fleet that puts pixels on the display: every window's surface, the wallpaper, the login prompt, and the boot..."
weight: 400
---
The compositor owns the screen. It is the one capsule in the desktop fleet that puts pixels on the
display: every window's surface, the wallpaper, the login prompt, and the boot splash all become visible
only because the compositor composites them into the framebuffer and presents the frame. Client capsules
submit layers (a surface handle and a rectangle on the display) and commit damage; the compositor
accumulates the damaged region, composites the visible layers z-ordered into its backing framebuffer on
each vsync, and presents. It is passive: it receives requests, paints, and calls no capsule except the
graphics driver.

Its source is organized into pillars, and this documentation mirrors that structure one page per pillar so
a page can be read beside the folder it describes. The [surfaces](/docs/subsystems/graphics/surfaces/)
and [graphics](/docs/subsystems/graphics/) subsystem pages give the wider picture of the surface
model the compositor consumes.

## Identity

Everything the kernel and the service registry need to name and reach the compositor comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|-------|-------|--------|
| Slug | `compositor` | `userland/compositor/Capsule.mk:5` |
| Service handle | `compositor` | `Capsule.mk:6`, [`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33) |
| Namespace | `systems.nonos.compositor` | `Capsule.mk:11` |
| Service endpoint | `service:4310:compositor` | `Capsule.mk:12`, `spawn.rs:31` |
| Reply endpoint | `reply:4311:endpoint.compositor.reply` | `Capsule.mk:13`, `spawn.rs:33` |
| Manifest capability ceiling | `0x7919` | `Capsule.mk:14` |
| Granted mask at spawn | `0x7819` | [`src/userspace/capsule_compositor/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_compositor/spawn.rs#L50) |
| Binary name | `compositor` | `Capsule.mk:9` |
| Kernel mirror | `src/userspace/capsule_compositor` | `Capsule.mk:15` |

### Mask decomposition

Two masks are in play and they differ by one bit, so both are stated. The `Capsule.mk` field
`CAPSULE_REQUIRED_CAPS := 0x7919` is what the build stamps into the signed manifest and uses as the
capability ceiling (`Capsule.mk:14`). Decomposed against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| Debug | `0x0100` | manifest headroom only, not requested | `types.rs:64` |
| GraphicsDisplayQuery | `0x0800` | read display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | register its own backing surface | `types.rs:68` |
| GraphicsSurfaceMap | `0x2000` | map a client surface to composite it | `types.rs:69` |
| GraphicsPresent | `0x4000` | put a frame on the display | `types.rs:70` |

`0x7919 = 1 + 8 + 16 + 256 + 2048 + 4096 + 8192 + 16384`.

The kernel spawn path requests only seven of the eight, dropping `Debug`
([`src/userspace/capsule_compositor/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_compositor/spawn.rs#L50)): CoreExec, IPC, Memory, and the four graphics caps. That
sum is `0x7819 = 1 + 8 + 16 + 2048 + 4096 + 8192 + 16384`, and `0x7819` is the effective granted mask. It
is the value the kernel prints in the `[SPAWN]` marker (`spawn_log.rs:18`, `:22`) and the value the
attestation inventory records for the compositor
([`userland/capsule_attest/src/server/handlers/proof_capsule_list.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/proof_capsule_list.rs#L31) lists `(b"compositor", 0x7819)`).
The `Debug` bit in the manifest ceiling is a headroom bit the running capsule never asks for.

What matters either way is `GraphicsPresent`, the sole right to present a frame, and `GraphicsSurfaceMap`,
the right to map a client's surface so it can be composited. There is no `Network`, no `FileSystem`, and
none of the driver-broker bits (`Driver`, `Mmio`, `Irq`, `Dma`, `Pio`). The compositor never touches a
device register or programs DMA; a compromise of it is bounded to what lands in the framebuffer.

## The pillars

The source under `userland/compositor/src/` is a set of top-level modules
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)), and the documentation is one page each. A request flows through them in order: a client
frame arrives on the wire, `protocol` parses it, a `server` handler mutates the `state`, and on the next
vsync the `frame_pacer` composites the dirty region and presents it, through either the `gfx_client`
(virtio-gpu) or the kernel GOP path.

```
  protocol/  ->  server/  ->  state/  ->  frame_pacer/  ->  gfx_client/ or GOP
  the wire      dispatch     scene,       composite and     present the
  format        + handlers   damage,      pace to vsync      dirty rect
                             cursor
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/compositor/operations/) | `src/protocol/`, `src/server/` | The `NCMP` wire format, the eight operations with opcodes, the batch drain, dispatch, and every handler. |
| [frame-pacing.md](/docs/userland/compositor/frame-pacing/) | `src/frame_pacer/`, `src/sw_blitter/` | The damage-driven loop, `tick`, the compositing pass, the software blitter, and vsync pacing. |
| [scene-and-damage.md](/docs/userland/compositor/scene-and-damage/) | `src/state/` | The 32-slot layer table, the damage accumulator, focus, and the surface attach cache. |
| [gpu-client.md](/docs/userland/compositor/gpu-client/) | `src/gfx_client/`, `src/setup/` | The outbound `NVGP` virtio-gpu client, display bring-up, and the two present backends. |
| [cursor-and-input.md](/docs/userland/compositor/cursor-and-input/) | cursor and focus paths | The software cursor sprite, `CURSOR_UPDATE`, and the input-subscription and focus model. |
| [contributing.md](/docs/userland/compositor/contributing/) | the whole tree | Where to work, how to add an op or change compositing, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/compositor/debugging/) | runtime | The boot marker, the failure modes (black screen, no present, tearing), and where to look. |

## The server loop

`_start` initialises the heap, waits for setup, registers the `compositor` service on port 4310, and enters
the loop ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)). Setup (`wait_for_setup`, [`src/wait_for_setup.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L25)) tries the virtio-gpu path
first and only falls back to GOP after `VIRTIO_ATTEMPTS_BEFORE_GOP = 6` failed attempts, so a machine with
virtio-gpu always uses it and only hardware without it takes the GOP route ([`src/wait_for_setup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L23)).
The loop ([`src/server/runner/entry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L23)) is:

```
  run(ctx):
      loop:
          drain_ipc(ctx, rx, tx)          batch up to 16 requests, RECV_NOWAIT
          frame_pacer::tick(ctx)          if damage is pending, composite and present one frame
          frame_pacer::wait_for_vsync()   block to the next vblank, or yield on error
```

It is damage-driven: nothing is painted when nothing changed, so an idle desktop costs a vsync wait and no
pixels. If `tick` returns an error it is latched once into `ctx.scanout_error_reported` and the loop keeps
running; if the vsync wait fails the loop yields instead of spinning (`entry.rs:30`, `:35`). The batch and
dispatch live in [operations.md](/docs/userland/compositor/operations/); the tick and present live in
[frame-pacing.md](/docs/userland/compositor/frame-pacing/).

## Lifecycle

1. The kernel spawns the compositor as part of the desktop fleet's display core, after the boot splash and
   the input router ([`src/userspace/init/spawn_plan/desktop_fleet.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L38), `:39`). The spawn verifies the
   embedded ELF, id cert, manifest, and attestation, requests the seven caps, and logs
   `[COMPOSITOR] capsule spawned` ([`src/userspace/capsule_compositor/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_compositor/spawn.rs#L37),
   [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)).
2. `wait_for_setup` brings up the display and returns a fully populated `Context`. The virtio path fetches
   the driver's primary surface, attaches it, validates stride and byte length, and marks the whole screen
   damaged ([`src/setup/prime_once.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_once.rs#L25)). The GOP path allocates a page-aligned mmap backing, registers it
   as a surface, self-attaches, and marks full damage ([`src/setup/prime_gop.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_gop.rs#L36)). Either way the first
   frame repaints the entire display. Detail is in [gpu-client.md](/docs/userland/compositor/gpu-client/).
3. `_start` registers the service and enters `server::run`.
4. On each iteration the loop drains client requests into scene and damage state, and the frame pacer
   composites and presents any pending damage, paced to vsync.

The `Context` ([`src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context.rs#L19)) is the whole runtime state: the graphics port and resource id,
the display geometry, the `gop_mode` flag, the present surface handle, the request-id counter, and the five
compositing structures (`scene`, `damage`, `focus`, `cursor`, `attach`). It is described in
[scene-and-damage.md](/docs/userland/compositor/scene-and-damage/).

## Who calls it

Clients resolve the compositor by `mk_service_lookup("compositor")` and speak `NCMP`:

- Every GUI app, through the app skeleton, calls `SCENE_SUBMIT`, `DAMAGE_COMMIT`, `SCENE_REMOVE`,
  `DISPLAY_INFO`, and `HEALTHCHECK`
  ([`userland/app_skeleton/src/clients/compositor/scene_submit.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/compositor/scene_submit.rs#L41), and the sibling files in that
  directory).
- The [input router](/docs/userland/input-router/) sends `CURSOR_UPDATE` and queries `DISPLAY_INFO`
  ([`userland/capsule_input_router/src/clients/compositor/cursor_update.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/clients/compositor/cursor_update.rs),
  [`.../display_size.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../display_size.rs)).
- The wm, wallpaper, login, desktop shell, and boot splash all resolve `compositor` at startup and submit
  their own layers.

The compositor initiates no call to any capsule except `driver.virtio_gpu0`, which it resolves once at
setup ([`src/setup/discover.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L19)). It is a target, not a client; its inbound attack surface is the eight
fixed-size ops.

## Source map

```
  userland/compositor/src/main.rs                _start: heap, setup, register, run
  userland/compositor/src/wait_for_setup.rs      virtio-first, GOP-fallback bring-up
  userland/compositor/src/protocol/              the NCMP wire format
  userland/compositor/src/server/                the loop, batch drain, dispatch, the eight handlers
  userland/compositor/src/frame_pacer/           the tick, compositing pass, cursor, vsync
  userland/compositor/src/sw_blitter/            the bounds-checked software blitter
  userland/compositor/src/state/                 scene, damage, focus, cursor, attach, context
  userland/compositor/src/setup/                 the two display backends and gfx discovery
  userland/compositor/src/gfx_client/            the virtio-gpu NVGP client
  userland/compositor/Capsule.mk                 slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_compositor/              the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/desktop_fleet.rs the desktop-fleet spawn entry
  src/capabilities/types.rs                      the capability bit definitions
```

Every reference above is verified against those trees.
</content>
</invoke>
