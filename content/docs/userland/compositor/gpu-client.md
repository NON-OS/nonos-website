---
title: "The GPU client and scanout"
description: "This page mirrors src/gfxclient/ and src/setup/: the outbound NVGP protocol the compositor uses to drive the virtio-gpu driver, the display bring-up that chooses a backend, and ..."
weight: 6
---
This page mirrors `src/gfx_client/` and `src/setup/`: the outbound `NVGP` protocol the compositor uses to
drive the virtio-gpu driver, the display bring-up that chooses a backend, and the two present paths (virtio
resource ops versus the kernel GOP blit). The tick that issues these calls is in
[frame-pacing.md](/docs/userland/compositor/frame-pacing/). Back to the [README](/docs/userland/compositor/).

## Two backends, one loop

The compositor holds two present backends, chosen once at startup. On a machine with a virtio-gpu driver it
composites into the driver's primary surface and presents through virtio resource ops. On a machine without
one (real UEFI hardware, VirtualBox, VMware) it backs its own page-aligned surface and presents by asking
the kernel to blit it to the UEFI linear framebuffer. The choice is a single `gop_mode` flag on the
`Context`, and the loop is otherwise identical.

`wait_for_setup` ([`src/wait_for_setup.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L25)) tries virtio first and only falls back after
`VIRTIO_ATTEMPTS_BEFORE_GOP = 6` failed attempts, yielding between tries, so a machine that has virtio-gpu
always uses it and only hardware without it takes the GOP route ([`src/wait_for_setup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L23), `:31`).
`setup::run_virtio` and `setup::run_gop` are the two entry points ([`src/setup/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L22)).

## Virtio bring-up

`run_virtio_once` ([`src/setup/prime_once.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_once.rs#L25)) resolves the gfx endpoint, fetches the primary surface, and
attaches it:

1. `discover::lookup_gfx_endpoint` resolves `driver.virtio_gpu0` through `mk_service_lookup` and returns its
   port; a missing service, dead owner, or zero port is an error ([`src/setup/discover.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L19), `:28`,
   `:37`). The compositor routes by port and the kernel verifies the owning pid is alive before delivery, so
   the compositor does not need to hold the endpoint (`discover.rs:25`).
2. `get_primary_surface` fetches the handle, resource id, geometry, and format, and setup rejects an absent
   surface or a format that is not `SURFACE_FORMAT_ARGB8888` (`prime_once.rs:27` through `:33`).
3. `mk_surface_attach` maps the primary surface; setup validates the returned VA is positive, the format
   matches, the geometry is non-zero, the stride is at least `width * 4`, and the byte length covers
   `stride * height`, each with a specific error (`prime_once.rs:35` through `:51`).
4. It builds the `Context` with `gop_mode = false`, `first_scanout_done = false`, and full damage, and seeds
   `next_request_id = 2` (request id 1 was spent on `get_primary_surface`) (`prime_once.rs:54`, `:66`).

## GOP bring-up

`run_gop_once` ([`src/setup/prime_gop.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_gop.rs#L36)) is the no-virtio path (`prime_gop.rs:17` describes it). It
reads the display dimensions through `nonos_display_dimensions` (`prime_gop.rs:88`), computes stride and
byte length, and allocates a backing buffer with `mk_mmap` rather than the heap: mmap gives a dedicated,
page-aligned VMA whose start is exactly `base_va`, so the kernel's present path resolves the surface to a
real region, where a heap allocation would sit inside the heap VMA and never match (`prime_gop.rs:41`,
`:98`, `:102`). It registers the buffer as a surface with `mk_surface_register` (`prime_gop.rs:51`), then
self-attaches with `mk_surface_attach` to get the same VA the present path resolves against
(`prime_gop.rs:59`). It builds the `Context` with `gop_mode = true`, `first_scanout_done = true` (there is
no scanout step to run), and full damage (`prime_gop.rs:67`, `:77`).

## The NVGP protocol

The outbound wire is `NVGP`, a separate 20-byte header, magic `0x4E56_4750`, version 1
([`src/gfx_client/wire.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gfx_client/wire.rs#L24)). `build_request` lays out `magic (u32), version (u16), op (u16), flags (u16),
reserved (u16), request_id (u32), payload_len (u32)` and appends the payload ([`wire/build_request.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/build_request.rs#L19)).
A call sends the request and reads the reply through `mk_ipc_call_timeout`; a non-positive return is
`Err("gfx ipc call failed")` ([`wire/call_with_timeout.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/call_with_timeout.rs#L31), `:39`). Two timeouts are used: the boot call
uses `BOOT_REPLY_TIMEOUT_MS = 250` ([`wire/call_boot.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/call_boot.rs), `wire.rs:28`), the per-frame calls use
`CALL_REPLY_TIMEOUT_MS = 1000` ([`wire/call.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/call.rs), `wire.rs:27`). `read_status` reads the `i32` status word
that follows the reply header ([`wire/read_status.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/read_status.rs#L17)); `payload_slice` returns the bytes after the status
([`wire/payload_slice.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/payload_slice.rs#L17)).

The ops the compositor issues:

| Op | Code | Body | What it does | Source |
|----|------|------|--------------|--------|
| GET_PRIMARY_SURFACE | `0x000C` | empty | fetch handle, resource id, geometry, format | [`gfx_client/get_primary.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gfx_client/get_primary.rs#L22) |
| TRANSFER_TO_HOST | `0x0008` | 32 B | copy the dirty rect to the device | [`gfx_client/transfer.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gfx_client/transfer.rs#L21) |
| SET_SCANOUT | `0x0009` | 24 B | bind the resource to scanout 0 (first frame) | [`gfx_client/set_scanout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gfx_client/set_scanout.rs#L21) |
| RESOURCE_FLUSH | `0x000A` | 20 B | flush the dirty rect to the panel | [`gfx_client/flush.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gfx_client/flush.rs#L21) |

Each call checks the reply status and returns a specific `&'static str` on a non-zero driver status, for
example `"gfx transfer: driver rejected"` (`transfer.rs:44`), `"gfx scanout: driver rejected"`
(`set_scanout.rs:44`), `"gfx flush: driver rejected"` (`flush.rs:44`), and `"gfx primary: driver rejected"`
(`get_primary.rs:39`). `GET_PRIMARY_SURFACE` also validates the reply is long enough before decoding its
fields (`get_primary.rs:43`).

## The present path in tick

In `frame_pacer::tick` ([`src/frame_pacer/tick.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/tick.rs#L29)), after compositing and the release fence, the present
splits on `gop_mode`:

- **GOP mode.** The composed pixels already live in the registered surface, so the compositor calls
  `mk_surface_present(ctx.surface_handle)` and the kernel blits that surface to the UEFI framebuffer. A
  negative return is `Err("gop present rejected")` (`tick.rs:29` through `:35`). No virtio resource ops run.
- **Virtio mode.** The compositor computes the byte offset of the dirty rectangle
  (`rect.y * stride + rect.x * 4`), issues `transfer_to_host` for just that region, issues `set_scanout` on
  the very first frame only (guarded by `first_scanout_done`), and issues `resource_flush` for the dirty
  rectangle (`tick.rs:37` through `:72`). Each call is given a fresh request id from `issue_request_id`.

The `set_scanout` is done exactly once: it binds the resource to scanout 0 the first time a frame is
presented, then `first_scanout_done` is set so subsequent frames skip it (`tick.rs:49`, `:61`). If any of
the three virtio calls returns an error, `tick` propagates it; the loop latches the first such error into
`ctx.scanout_error_reported` and keeps running ([frame-pacing.md](/docs/userland/compositor/frame-pacing/)).

## Kernel surface primitives

Beyond the NVGP client, the compositor uses kernel surface primitives directly: `mk_surface_attach` and
`mk_surface_release` for the attach cache ([`src/state/attach.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/attach.rs#L17)), `mk_surface_register` and `mk_mmap`
for the GOP backing ([`src/setup/prime_gop.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime_gop.rs#L24)), `mk_surface_present` for the GOP present
([`src/frame_pacer/tick.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/tick.rs#L32)), and `mk_display_vsync_wait` for pacing ([`src/frame_pacer/vsync.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/vsync.rs#L17)).
These are the same surface primitives the [graphics](/docs/subsystems/graphics/) subsystem
describes.
</content>
