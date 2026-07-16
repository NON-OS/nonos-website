---
title: "Frame pacing and compositing"
description: "This page mirrors src/framepacer/ and src/swblitter/: the damage-driven tick, the compositing pass that draws the layers, the software blitter that copies pixels, the cursor spr..."
weight: 4
---
This page mirrors `src/frame_pacer/` and `src/sw_blitter/`: the damage-driven `tick`, the compositing pass
that draws the layers, the software blitter that copies pixels, the cursor sprite, and the vsync wait that
paces the loop. The present half of `tick` (the two backends) is detailed in [gpu-client.md](/docs/userland/compositor/gpu-client/).
The scene and damage structures the pass reads are in [scene-and-damage.md](/docs/userland/compositor/scene-and-damage/). Back to
the [README](/docs/userland/compositor/).

## The tick

`frame_pacer::tick` ([`src/frame_pacer/tick.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/tick.rs#L23)) is called once per loop iteration. It drains the damage
rectangle, and if there is none it returns without touching the display, so an idle desktop paints nothing
(`tick.rs:24`). If there is damage it composites, issues a release fence so the pixel writes are ordered
before the present, and presents:

```
  tick(ctx):
      rect = damage.drain()  or return Ok           tick.rs:24
      composite::paint(ctx, rect)                    tick.rs:27
      fence(Release)                                 tick.rs:28
      if gop_mode: mk_surface_present(handle)        tick.rs:29
      else: transfer_to_host; (first frame) set_scanout; resource_flush   tick.rs:37..72
```

The `fence(Ordering::Release)` (`tick.rs:28`) guarantees the composited pixel writes are visible before the
present call is issued, on either backend. The two present backends are covered in
[gpu-client.md](/docs/userland/compositor/gpu-client/); everything above the fence is this page.

## The compositing pass

`composite::paint` ([`src/frame_pacer/composite.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/composite.rs#L26)) draws exactly the dirty rectangle:

```
  paint(ctx, rect):
      fill rect with BACKGROUND_ARGB (0xFF101620)         composite.rs:34
      for layer in scene.z_sorted_snapshot():
          src = attach.get_or_attach(layer.surface_handle)  composite.rs:39
          composite_layer(dst, src, layer rect, clip=rect)  composite.rs:40
      reap layers missing REAP_THRESHOLD = 60 frames       composite.rs:57
      if cursor.visible: draw the cursor sprite clipped     composite.rs:62
```

It first fills the damage rectangle with `BACKGROUND_ARGB`, a dark blue-grey `0xFF10_1620`
(`composite.rs:22`, `:34`). Then it walks the z-sorted snapshot of layers (a higher `z` paints on top,
[scene-and-damage.md](/docs/userland/compositor/scene-and-damage/)); for each layer it maps the source surface through the attach
cache and composites it, clipped to the damage rectangle (`composite.rs:35` through `:40`). The handles it
managed to attach this frame are recorded (`composite.rs:49`).

After the layers, it reaps: `reap_unattachable` increments a miss count on any in-use layer whose surface
was not attachable this frame, and drops the layer once the count reaches `REAP_THRESHOLD = 60` consecutive
frames, forgetting its surface (`composite.rs:24`, `:57`; the reaper itself is
[scene-and-damage.md](/docs/userland/compositor/scene-and-damage/)). Finally, if the cursor is visible it blits the cursor sprite,
clipped to the same damage rectangle (`composite.rs:62`).

The destination is a `Surface` built from the backing framebuffer geometry: `base_va = ctx.backing_va`,
plus `stride`, `width`, `height`, and `byte_len = ctx.backing_len` (`composite.rs:27`). That `byte_len` is
what bounds every write, below.

## The software blitter

The blitter is pure software (`src/sw_blitter/`). Everything it does is bounds-checked against the surface's
declared `byte_len` through one gate, `Surface::row_start` ([`src/sw_blitter/mod.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sw_blitter/mod.rs#L33)):

```
  row_start(y, x, width) -> Option<usize>:
      reject if width == 0, y >= height, x >= width, or width > width - x   mod.rs:34
      row_off = y * stride;  col_off = x * 4;  span = width * 4  (checked)   mod.rs:37
      reject if row_off + col_off + span > byte_len                         mod.rs:42
      return base_va + row_off + col_off                                    mod.rs:45
```

Every arithmetic step uses `checked_mul` / `checked_add`, and a span that would run past `byte_len` yields
`None`, so no blit can address a byte outside the surface it was handed.

`fill_rect` clips the rectangle to the surface and fills whole rows ([`src/sw_blitter/fill.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sw_blitter/fill.rs#L20)). It clamps
`x1` and `y1` to the surface width and height, computes the row width once, and for each row calls
`row_start`; if a row fails the guard it breaks (`fill.rs:24` through `:35`).

`composite_layer` ([`src/sw_blitter/copy_rect.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sw_blitter/copy_rect.rs#L20)) places a source surface at `(at_x, at_y)`, clipped to
both the destination and the damage rectangle. It computes the intersection of the layer placement, the
destination bounds, and the clip rectangle, and returns early if it is empty (`copy_rect.rs:34` through
`:42`). For each destination row it fetches both a destination and a source row pointer through `row_start`
and, if either fails, breaks (`copy_rect.rs:47`, `:50`). Then it copies pixel by pixel, writing only where
the source alpha byte is non-zero, so transparent client pixels do not overwrite what is under them
(`copy_rect.rs:55` through `:61`). Reads and writes are volatile.

## The cursor sprite

The cursor is a 14-pixel white arrow with a one-pixel-offset black shadow, two pixels thick, drawn with
volatile writes and clipped to the damage rectangle ([`src/frame_pacer/cursor.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/cursor.rs#L24)). `FG = 0xFFFFFFFF`,
`SHADOW = 0xFF000000`, `SIZE = 14`, `THICK = 2` (`cursor.rs:19` through `:22`). The inner `put` closure
drops any pixel outside the surface or outside the clip rectangle before the volatile write
(`cursor.rs:27`), so the sprite can never scribble past the screen or outside the dirty region. It draws
the shadow first, then the arrow on top (`cursor.rs:34`, `:40`). It is a software blit, not a hardware
sprite. The cursor position and visibility come from the cursor tracker
([scene-and-damage.md](/docs/userland/compositor/scene-and-damage/)); the `CURSOR_UPDATE` op that feeds it is in
[cursor-and-input.md](/docs/userland/compositor/cursor-and-input/).

## Vsync pacing

`wait_for_vsync` ([`src/frame_pacer/vsync.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame_pacer/vsync.rs#L19)) calls `mk_display_vsync_wait(0)` and returns the vblank
count, or `Err("vsync wait failed")` on a negative return (`vsync.rs:21`). The loop treats an error as a
cue to `mk_yield` rather than spin ([`src/server/runner/entry.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L35)), so a display that cannot signal vblank
still yields the CPU instead of busy-looping. Pacing to vsync is what makes the compositor present at most
one frame per refresh: it composites the accumulated damage, presents, and blocks until the next vblank
before draining the next batch.
</content>
