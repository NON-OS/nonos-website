---
title: "State: the routing memory"
description: "This page mirrors src/state/: the Context the server loop carries, the cursor tracker, the grab table, the subscription and allow list, the per-key targets, and the two pointer ..."
weight: 5
---
This page mirrors `src/state/`: the `Context` the server loop carries, the cursor tracker, the grab table,
the subscription and allow list, the per-key targets, and the two pointer caches for a press and a hover.
These are the tables the routing engine reads and the handlers mutate. The routing that reads them is on
the [routing](/docs/userland/input-router/routing/) page; the handlers that write them are on the [operations](/docs/userland/input-router/operations/) page;
for the overview and the capability identity see the [README](/docs/userland/input-router/).

The whole of this state is fixed-size and allocated once. There is no heap growth in the router's steady
state, so a flood of subscribers or held keys cannot make the router allocate without bound; it fills a
slot or it refuses.

## The Context

`Context` is the single mutable value the server loop threads through every handler and every routing step
([`src/state/context/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/types.rs#L19)). It owns the four tables (subscriptions, grabs, key targets, cursor), the
two optional pointer caches (`press`, `hover`) with a `hover_tick` counter, the three resolved service
ports (`compositor_port`, `wm_port`, `policy_port`), the cached `shell_pid` and `last_focus_pid`, the
monotonic `next_request_id`, the delivered and dropped telemetry, and the pending cursor position with its
`cursor_dirty` flag. `Context::new` is a `const` constructor: every port and pid starts at 0, both counters
at 0, `next_request_id` at 1, and both pointer caches `None` ([`src/state/context/new.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/new.rs#L21)).

Four methods live beside the type, one per file:

- `issue_request_id` hands out the next id and wraps past zero back to 1, so a cross-service call always
  carries a nonzero id ([`src/state/context/issue_request_id.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/issue_request_id.rs#L20)).
- `record` folds a delivery count into the telemetry: a zero count increments `dropped_count`, a nonzero
  count adds to `delivered_count`, both saturating ([`src/state/context/record.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/record.rs#L20)). Every routing arm
  ends in this call.
- `forget_pid` is the single teardown for a dead consumer. It first returns early if the pid is 0 or still
  alive, then removes the pid from the subscription table, clears the press and hover caches if they name
  it, releases its grabs, drops its key targets, and zeroes `shell_pid` or `last_focus_pid` if either
  cached it ([`src/state/context/forget_pid.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/forget_pid.rs#L20)). This is what a failed delivery triggers, so a crashed
  window leaves no reference behind.
- `purge_dead` is the periodic sweep: it purges the subscription and grab tables of dead pids and clears
  `shell_pid` if its owner is gone ([`src/state/context/purge_dead.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/purge_dead.rs#L20)). The loop calls it every 64th
  tick ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)).

## The cursor tracker

`CursorState` is the router's model of where the pointer is on the screen ([`src/state/cursor.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L21)). It
holds the current `x`/`y`, the `max_x`/`max_y` bounds, a `configured` flag, and `mult_x2`, a doubled
sensitivity multiplier. `CursorState::new` starts at `(512, 384)` with bounds `1023x767` and `mult_x2 = 2`,
so before the compositor answers the cursor lives on a 1024x768 virtual screen centered ([`src/state/cursor.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L31)).
`configure` is called once the compositor reports the real display: it sets the bounds to
`width - 1`/`height - 1` and recenters the cursor ([`src/state/cursor.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L35)). The `configured` flag is what
makes `refresh_display` a one-shot ([routing](/docs/userland/input-router/routing/)).

`apply` folds one event into the absolute position ([`src/state/cursor.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L43)). A `POINTER_REL` adds
`delta * mult_x2 / 2` per axis with saturating arithmetic, so `mult_x2 = 2` is unity gain and the policy
multiplier scales it. A `POINTER_ABS` or `TOUCH` maps the device's `x`/`y` from the fixed `0..0x7FFF` range
onto the bounds (`ABS_RANGE_MAX = 0x7FFF`, [`src/state/cursor.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L19)). Either way `clamp` pins the result
into `0..max` before it is returned as an unsigned `(x, y)` ([`src/state/cursor.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L56)). The sensitivity
comes from policy: the loop reads `mouse_sensitivity` every two seconds and stores it clamped to `1..4`
into `mult_x2` ([`src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L46)), the read is on the [clients](/docs/userland/input-router/clients/) page.

## The grab table

A grab is an exclusive claim on a class of events. `GrabTable` is two `Grab` records, one for keyboard and
one for pointer, each a `holder_pid` and a `kind_mask` ([`src/state/grabs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/types.rs#L17)). `GrabTable::new` is
`const` and starts both empty ([`src/state/grabs/new.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/new.rs#L20)). The split into two records is deliberate: a
grabber holds keyboard, pointer, or both, and the two are claimed and released independently.

- `request` splits the requested mask by `KEYBOARD_BITS = 0b11` and `POINTER_BITS = 0b1111_1100` and stores
  each class separately, and it stores only the masked-off bits so a mixed request cannot let `holder_for`
  cross-match a pointer kind against a keyboard grab. A class already held by a different pid makes it
  return `false` ([`src/state/grabs/request.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/request.rs#L23)), which the handler maps to `E_BUSY`
  ([operations](/docs/userland/input-router/operations/)).
- `holder_for` shifts `1 << kind` and tests it against the keyboard mask then the pointer mask, returning
  the holder pid on a hit; the shift uses `checked_shl` so an out-of-range kind yields no bit rather than
  wrapping ([`src/state/grabs/holder_for.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/holder_for.rs#L20)). This is the first check the router makes on every event.
- `release` clears whichever class the caller holds, keyed on `holder_pid`, so releasing a class you do not
  hold is a no-op; this is why the grab-release handler is unconditional ([`src/state/grabs/release.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/release.rs#L20)).
- `purge_dead` clears either class whose holder pid is no longer alive and returns how many it cleared
  ([`src/state/grabs/purge_dead.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/purge_dead.rs#L20)).

## The subscription table

The subscription table is the allow list: no event reaches a window that did not subscribe to its kind.
`SubscriptionTable` is a fixed `[Subscription; 16]` array, `MAX_SUBSCRIBERS = 16`, each entry a `pid`, a
`kind_mask`, and an `in_use` flag ([`src/state/subscriptions/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/types.rs#L17)). `SubscriptionTable::new` is
`const` and starts every slot free ([`src/state/subscriptions/new.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/new.rs#L20)).

- `upsert` is what `OP_SUBSCRIBE` calls. It updates the existing entry for a pid, or claims the first free
  slot; a mask of 0 removes the entry (or is a no-op if none exists), and a full table returns `false`,
  which the handler maps to `E_NOMEM` ([`src/state/subscriptions/upsert.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/upsert.rs#L20)).
- `allows` is the per-delivery gate: it returns true only if some in-use entry for that pid has the bit for
  this kind set, using `checked_shl` for the out-of-range guard ([`src/state/subscriptions/allows.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/allows.rs#L20)).
  The keyboard and window-pointer paths both call it before delivering.
- `match_kind` yields the pids of every in-use entry whose mask covers a kind, and is what the broadcast
  arm iterates ([`src/state/subscriptions/match_kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/match_kind.rs#L20)).
- `remove_pid` clears every slot for a pid and reports whether it removed anything; `purge_dead` clears
  every slot whose pid is no longer alive on a sweep ([`src/state/subscriptions/remove_pid.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/remove_pid.rs#L20),
  [`src/state/subscriptions/purge_dead.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions/purge_dead.rs#L20)).

## The per-key targets

`KeyTargets` records which pid received the key-down for each currently held key, so the matching key-up is
delivered to that same pid even if focus moved while the key was held ([`src/state/key_targets.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/key_targets.rs#L30)). It is
a fixed `[Held; 16]` array, `MAX_HELD_KEYS = 16`, each `Held` a `code` and a `pid`. `remember` updates the
entry for a code or claims a free slot, and silently drops the record when the table is full, in which case
that key-up falls back to current focus ([`src/state/key_targets.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/key_targets.rs#L42)). `take` returns and clears the pid
for a code, which is how a key-up finds its target ([`src/state/key_targets.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/key_targets.rs#L53)). `forget_pid` drops every
entry for a dead pid ([`src/state/key_targets.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/key_targets.rs#L61)). The keyboard routing that uses these is on the
[routing](/docs/userland/input-router/routing/) page.

## The pointer caches

Two optional records on the `Context` hold transient pointer state, both cleared by `forget_pid` when their
owner dies.

- `Press` is the implicit pointer grab armed by a button-down inside a window: a `pid` and the window's
  screen origin `origin_x`/`origin_y` frozen at press time, so the drag holder receives motion in a frame
  where deltas equal screen deltas even while the window moves itself ([`src/state/press.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/press.rs#L22)). It is set
  on a `BUTTON_DOWN` over a window and cleared on the matching `BUTTON_UP` ([routing](/docs/userland/input-router/routing/)).
- `Hover` caches the topmost window's rect (`pid`, `x`, `y`, `w`, `h`) so pointer motion inside it routes
  without a WM round trip per event; `contains` is the point-in-rect test ([`src/state/hover.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/hover.rs#L21),
  [`src/state/hover.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/hover.rs#L30)). The cache is dropped on a press (the window may move itself during a drag) and
  when the cursor exits the rect. The `hover_tick` counter on the `Context` throttles how often the WM is
  re-queried ([routing](/docs/userland/input-router/routing/)).

## Source map

```
  src/state/mod.rs                          the re-exports of every state type
  src/state/context/types.rs                Context fields
  src/state/context/new.rs                  const constructor, zeroed
  src/state/context/issue_request_id.rs     next id, wraps past zero to 1
  src/state/context/record.rs               delivered / dropped telemetry
  src/state/context/forget_pid.rs           single teardown for a dead consumer
  src/state/context/purge_dead.rs           periodic sweep of dead pids
  src/state/cursor.rs                       CursorState: bounds, mult_x2, apply, clamp
  src/state/grabs/types.rs                  GrabTable: keyboard and pointer Grab
  src/state/grabs/request.rs                mask split, busy check
  src/state/grabs/holder_for.rs             per-event grab lookup
  src/state/grabs/release.rs                holder-keyed clear
  src/state/grabs/purge_dead.rs             dead-holder clear
  src/state/subscriptions/types.rs          SubscriptionTable, MAX_SUBSCRIBERS = 16
  src/state/subscriptions/upsert.rs         OP_SUBSCRIBE mutation, E_NOMEM on full
  src/state/subscriptions/allows.rs         per-delivery allow gate
  src/state/subscriptions/match_kind.rs     broadcast iterator
  src/state/subscriptions/remove_pid.rs     clear a pid, purge_dead the sweep
  src/state/key_targets.rs                  KeyTargets, MAX_HELD_KEYS = 16
  src/state/press.rs                        Press: drag origin frozen at press
  src/state/hover.rs                        Hover: cached rect, contains
  src/server/runner.rs                      where record/purge_dead/policy are driven
```

Every reference above is verified against those trees.
