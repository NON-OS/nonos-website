---
title: "Scene, damage, and attach state"
description: "This page mirrors src/state/: the runtime Context, the 32-slot layer table and its operations, the damage accumulator, the focus table, the cursor tracker, and the surface attac..."
weight: 5
---
This page mirrors `src/state/`: the runtime `Context`, the 32-slot layer table and its operations, the
damage accumulator, the focus table, the cursor tracker, and the surface attach cache. The handlers that
write this state are in [operations.md](/docs/userland/compositor/operations/); the pass that reads it is in
[frame-pacing.md](/docs/userland/compositor/frame-pacing/). Back to the [README](/docs/userland/compositor/).

## The Context

`Context` ([`src/state/context.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context.rs#L19)) is the whole runtime state, built once by setup and threaded through
the loop by mutable reference. It holds the graphics port and resource id, the display geometry (`width`,
`height`, `stride`, `backing_len`, `backing_va`), the `gop_mode` flag that selects the present backend, the
present `surface_handle`, the `first_scanout_done` and `scanout_error_reported` latches, the
`next_request_id` counter, and the five compositing structures: `scene`, `damage`, `focus`, `cursor`,
`attach` (`context.rs:20` through `:38`). `issue_request_id` hands out a monotonic request id for outbound
virtio calls, wrapping but never returning zero (`context.rs:42`).

## The scene table

The scene table ([`src/state/scene/table.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/table.rs#L19)) is a fixed array of up to `MAX_LAYERS = 32` layers plus a
live count ([`src/state/scene/layer.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/layer.rs#L17)). A `Layer` is:

```
  struct Layer { owner_pid, surface_handle, x, y, width, height, z, in_use, miss_count }
```

(`layer.rs:19`). Layers are stored unsorted; `in_use` marks a live slot and `miss_count` drives reaping.

- **submit** ([`src/state/scene/submit.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/submit.rs#L21)) keys on `owner_pid`: if the sender already has a live layer it
  is replaced in place, so a second submit from the same pid updates its one layer rather than adding a new
  one (`submit.rs:22`). Otherwise, if the table is full it returns `Err` (surfaced as `E_INVAL`), else it
  takes the first free slot and bumps the count (`submit.rs:28`, `:31`).
- **z_sorted_snapshot** ([`src/state/scene/snapshot.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/snapshot.rs#L21)) copies the in-use layers into a fresh array and
  insertion-sorts them by ascending `z`, so a higher-`z` layer paints last, on top (`snapshot.rs:24`,
  `:28`). The compositing pass consumes this snapshot.
- **layers** ([`src/state/scene/layers.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/layers.rs#L21)) yields an iterator over the in-use layers, used by
  `SCENE_REMOVE` to collect surface handles.
- **drop_by_pid** ([`src/state/scene/drop_by_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/drop_by_pid.rs#L21)) clears every layer owned by a pid, decrementing the
  count with a saturating subtract, and returns how many it dropped (`drop_by_pid.rs:24`).
- **reap_unattachable** ([`src/state/scene/reap_unattachable.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene/reap_unattachable.rs#L21)) is called each frame with the set of
  handles that attached this frame. A layer whose handle is in that set has its `miss_count` reset; a layer
  whose handle is not increments `miss_count` (saturating), and once it reaches the threshold the layer is
  cleared and its handle written to the caller's dropped list (`reap_unattachable.rs:32` through `:42`).
  This is what makes a window whose owner has died linger for `REAP_THRESHOLD = 60`
  ([frame-pacing.md](/docs/userland/compositor/frame-pacing/)) consecutive frames and then vanish.

`scene_remove::remove_by_pid` ([`src/state/scene_remove.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scene_remove.rs#L23)) is the helper `SCENE_REMOVE` uses: it walks
the owner's layers, computes their union rectangle for damage, and only then calls `drop_by_pid`, returning
the union or `None` if the pid held no layers (`scene_remove.rs:25`, `:38`).

Ownership is the isolation boundary. A layer is tagged with the submitting pid, `submit` keys on that pid,
and `SCENE_REMOVE` only touches the caller's own layers. One capsule cannot move, replace, or delete
another's window.

## The damage accumulator

The `DamageAccumulator` ([`src/state/damage.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/damage.rs#L30)) is a single screen-aligned bounding `Rect` plus a
`pending` flag. The `pending` flag distinguishes "no damage" from "fully damaged" without a sentinel
rectangle (`damage.rs:17`, `:33`).

- **mark_full** sets the box to the whole display and marks it pending; setup calls this so the first frame
  repaints everything (`damage.rs:40`).
- **accumulate** ignores a zero-area rectangle, takes the rectangle directly if nothing is pending, and
  otherwise merges it into the box by min/max of the corners (`damage.rs:45` through `:59`).
- **drain** returns and clears the box if pending, else `None`, which is exactly the early-out `tick`
  keys on (`damage.rs:61`).

Damage is a single bounding box, not a per-tile queue, so a change in two opposite corners dirties
everything between them and repaints it (`damage.rs:17`). That is expected in v1; per-tile damage lands
alongside multi-CPU render workers in a follow-up (`damage.rs:18`).

## The focus table

The `FocusTable` ([`src/state/focus.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/focus.rs#L22)) records one focused pid. `set` overwrites it (`focus.rs:31`); it
starts at zero (`focus.rs:27`). Both `FOCUS_SET` and `INPUT_SUBSCRIBE` write it
([cursor-and-input.md](/docs/userland/compositor/cursor-and-input/)). The wm owns z-order and window state; this table just records
who currently owns input dispatch so it can be queried without a round trip through the wm (`focus.rs:17`).
The recorded pid is not yet used to highlight the focused window.

## The cursor tracker

The `CursorTracker` ([`src/state/cursor.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L24)) holds one `CursorState { x, y, visible }`. It is constructed
at the screen centre by setup (`cursor.rs:29`; `prime_once.rs:70`, `prime_gop.rs:83`). `update` overwrites
the state and returns the previous one so the `CURSOR_UPDATE` handler can damage where the cursor was
(`cursor.rs:33`); `current` reads it for the compositing pass (`cursor.rs:39`).

## The attach cache

The `AttachCache` ([`src/state/attach.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/attach.rs#L31)) is a `MAX_ATTACH = 32`-slot map from a surface handle to a
mapped `Surface` (`attach.rs:21`). This is where `GraphicsSurfaceMap` is exercised: mapping a client's
surface so it can be composited.

- **get_or_attach** ([`src/state/attach.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/attach.rs#L39)) returns `None` for a zero handle, returns a cached mapping if
  the handle is already attached, or otherwise calls `mk_surface_attach` to map the client's surface. On
  success it fills a `Surface` from the returned VA and the descriptor's geometry, caches it in the first
  free slot, and returns it (`attach.rs:43` through `:61`). A non-positive attach return yields `None`,
  which is what lets the reaper count a miss.
- **forget** ([`src/state/attach.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/attach.rs#L63)) finds the slot for a handle, calls `mk_surface_release`, and clears
  the slot; a negative release return is an `Err` the caller surfaces (`attach.rs:66`).

The mapped `Surface` carries its own `byte_len`, so every blit out of it is bounds-checked against the
client's declared surface size ([frame-pacing.md](/docs/userland/compositor/frame-pacing/)). Client surface pixels are untrusted:
the compositor blits them but does not interpret them.
</content>
