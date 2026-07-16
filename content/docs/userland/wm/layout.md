---
title: "Placement, focus, and stacking"
description: "This page mirrors src/geometry/, src/focus/, src/zorder/, and the placement policy under src/server/handlers/windowopen/: the rectangle and display clamp, the collide-and-step s..."
weight: 2
---
This page mirrors `src/geometry/`, `src/focus/`, `src/z_order/`, and the placement policy under
`src/server/handlers/window_open/`: the rectangle and display clamp, the collide-and-step search, the
focus model, the hit test, and the monotonic z counter. These are the mechanics the operation handlers in
[operations.md](/docs/userland/wm/operations/) call into; the records they read and write are in [state.md](/docs/userland/wm/state/).

## The rectangle and the clamp

`Rect` is four `u32` fields (`x`, `y`, `width`, `height`) with two predicates: `contains(px, py)` for
hit-testing a point and `overlaps(other)` for collision, both written with saturating arithmetic so they
never overflow ([`src/geometry/rect.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/geometry/rect.rs#L26), [`src/geometry/rect.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/geometry/rect.rs#L33)).

`clamp_to_display` pushes a rect inside the display bounding box: it clamps the size between
`MIN_WINDOW_DIM` (16) and the display extent, then clamps the origin so the window stays on screen. It
never panics and never overflows, and it is the gate every incoming geometry passes through
([`src/geometry/constrain.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/geometry/constrain.rs#L25), [`src/geometry/constrain.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/geometry/constrain.rs#L19)).

## Placement

Placement is a real but modest policy, not a tiling engine ([`src/server/handlers/window_open/place.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/window_open/place.rs#L25)).
The requested rect is first clamped inside the display. A non-normal window, or a normal window that does
not overlap any visible normal window, is placed as requested (`place.rs:27`). A normal window that
collides is stepped across a grid from `(PLACEMENT_LEFT, PLACEMENT_TOP)` = `(96, 72)` in `PLACEMENT_STEP`
= 40-pixel steps until it finds a free slot (`place.rs:32`, [`window_open/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/constants.rs#L17)). The overlap
predicate iterates the visible normal windows and returns true on the first `Rect::overlaps`
([`window_open/collides.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/collides.rs#L21)).

If the grid is exhausted the window falls back to a cascade offset by the count of open normal windows, so
even a saturated screen still yields a deterministic, on-screen slot rather than a failure
(`place.rs:50`, [`window_open/fallback_slot.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/fallback_slot.rs#L23)). The whole search is bounded by the display extent and
the step, so it always terminates.

## The focus model

Focus is a single reference, not a stack: `FocusModel` wraps an `Option<FocusedRef>` where `FocusedRef` is
`(owner_pid, window_id)` ([`src/focus/model.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/model.rs#L23), [`src/focus/model.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/model.rs#L17)). It has three operations:

- `set(owner_pid, window_id)` records the new focus and returns whether it changed, so an unchanged focus
  is a cheap no-op ([`src/focus/model.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/model.rs#L32)).
- `clear()` drops focus and returns whether anything was focused, which is what tells a caller to push
  `FOCUS_SET(0)` ([`src/focus/model.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/model.rs#L41)).
- `current()` reads the reference back for the `QUERY_FOCUS` reply and the sweep's focus check
  ([`src/focus/model.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/model.rs#L47)).

## The hit test

`topmost_hit_at` iterates the window table, skips windows that are not `Visible`, do not `contain` the
point, or are not focusable, and keeps the one with the highest z ([`src/focus/hit_test.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/hit_test.rs#L30)). It returns
a `HitTarget` that packs the owner pid, the window id, the point in the window's local coordinates
(computed with `saturating_sub` so it never underflows), and the window rectangle
([`src/focus/hit_test.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/hit_test.rs#L48)). This is exactly what `OP_QUERY_TOPMOST` returns to the input router so it can
route a click to the right window.

Because the hit test filters on `Kind::focusable`, a tooltip is never a hit target: it cannot steal a
click even when it sits under the cursor ([`src/window/kind.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/kind.rs#L27)).

## The z counter

Stacking is one `u32` counter. `ZStack::allocate` hands out a strictly increasing z on each call and wraps
back to 1 on overflow rather than panicking ([`src/z_order/stack.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/z_order/stack.rs#L31)). Open, raise, restore, and maximize
each call it, so `windows()` sorted by z is the bottom-to-top draw order and the topmost hit is the maximum
z among the windows containing the point. A wrap re-stamps the affected windows on their next raise, so the
ordering stays consistent ([`src/z_order/stack.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/z_order/stack.rs#L17)).

## Source map

```
  userland/capsule_wm/src/geometry/rect.rs                     Rect, contains, overlaps
  userland/capsule_wm/src/geometry/constrain.rs                MIN_WINDOW_DIM, clamp_to_display
  userland/capsule_wm/src/focus/model.rs                       FocusModel: set, clear, current
  userland/capsule_wm/src/focus/hit_test.rs                    topmost_hit_at, HitTarget
  userland/capsule_wm/src/z_order/stack.rs                     ZStack::allocate, monotonic z
  userland/capsule_wm/src/server/handlers/window_open/place.rs      clamp then collide-and-step
  userland/capsule_wm/src/server/handlers/window_open/collides.rs   overlap over visible normal windows
  userland/capsule_wm/src/server/handlers/window_open/fallback_slot.rs  the cascade of last resort
  userland/capsule_wm/src/server/handlers/window_open/constants.rs     PLACEMENT_LEFT/TOP/STEP/GAP
```

Every reference above is verified against those trees.
</content>
