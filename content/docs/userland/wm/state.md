---
title: "State: the window table and subscribers"
description: "This page mirrors src/state/ and src/window/: the Context the server loop carries, the fixed window table, the Window record with its kind and visibility, the owner-scoped looku..."
weight: 4
---
This page mirrors `src/state/` and `src/window/`: the `Context` the server loop carries, the fixed window
table, the `Window` record with its kind and visibility, the owner-scoped lookups, and the subscriber
list. The verbs that mutate this state are in [operations.md](/docs/userland/wm/operations/); the placement and focus
logic that reads it is in [layout.md](/docs/userland/wm/layout/).

## The Context

`Context` is the single mutable value the server loop threads through every handler
([`src/state/context.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context.rs#L22)). It holds the resolved compositor port, the display width and height, the
window table, the focus model, the z counter, the subscriber list, a monotonic request-id counter, and the
cached `input_router` pid. `issue_request_id` hands out the next id and wraps past zero back to 1 so a
compositor call always carries a nonzero id ([`src/state/context.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context.rs#L35)).

## The window table

The window model is a fixed `[Window; 256]` array, so it allocates once and never grows
([`src/window/table/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/types.rs#L19), `MAX_WINDOWS` = 256). Each `Window` is `owner_pid`, `window_id`, a `Rect`,
a `Kind`, a `Visibility`, a `z`, and an `in_use` flag; a default `Window` is `Hidden` and not in use
([`src/window/window.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/window.rs#L27), `window.rs:38`).

Every lookup and mutation keys on `(owner_pid, window_id)` through `Window::matches`, which also requires
the slot be in use ([`src/window/window.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/window.rs#L53)). That single predicate is the mechanism that scopes every
verb to its owner:

- `find` and `find_mut` return the matching entry for reads and in-place edits
  ([`src/window/table/find.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/find.rs#L22), [`src/window/table/find_mut.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/find_mut.rs#L22)).
- `insert` refuses a duplicate `(pid, window_id)` and otherwise fills the first free slot, returning `Err`
  when the table is full ([`src/window/table/insert.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/insert.rs#L22)).
- `remove` clears the matching entry ([`src/window/table/remove.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/remove.rs#L22)).
- `remove_one_dead` clears the first entry whose owner pid is no longer alive and returns a copy so the
  sweep can notify subscribers about it ([`src/window/table/remove_one_dead.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/remove_one_dead.rs#L22)).
- `windows` iterates the in-use entries for the hit test and draw order
  ([`src/window/table/windows.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/table/windows.rs)).

## Kind and visibility

The four window kinds are `Normal`, `Dialog`, `Tooltip`, and `Popup`; only `Normal`, `Dialog`, and `Popup`
are focusable, so a tooltip is never a hit-test or focus target ([`src/window/kind.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/kind.rs#L19),
[`src/window/kind.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/kind.rs#L27)). `kind_from_u32` decodes the wire value and returns `None` for anything outside
0..3, which is how the open decode rejects a bad kind ([`src/window/kind.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/kind.rs#L32)). Visibility is `Visible`,
`Minimized`, or `Hidden`, and only `Visible` windows are hit-tested or considered for placement collisions
([`src/window/window.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/window.rs#L20)).

## The subscriber list

Lifecycle subscribers live in a fixed `[u32; 16]` array ([`src/state/subscriptions.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions.rs#L19), `MAX_SUBSCRIBERS`
= 16). `add` ignores pid 0, is idempotent for an already-present pid, and fills the first free slot,
returning `false` when the list is full so `OP_LIFECYCLE_SUBSCRIBE` can reply `E_NOMEM`
([`src/state/subscriptions.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions.rs#L28)). `iter` yields the nonzero pids for a broadcast, `remove_pid` drops a
stale subscriber after a failed send, and `purge_dead` clears every slot whose pid is no longer alive on
each sweep tick ([`src/state/subscriptions.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions.rs#L46), `subscriptions.rs:50`, `subscriptions.rs:61`).

Both fixed tables are swept of dead pids every fourth loop wakeup, so a crashed or malicious app cannot
leak entries indefinitely ([`src/server/runner/sweep_dead.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/sweep_dead.rs#L21)).

## Source map

```
  userland/capsule_wm/src/state/context.rs             Context fields, issue_request_id
  userland/capsule_wm/src/state/subscriptions.rs       the 16-entry list: add, iter, remove, purge
  userland/capsule_wm/src/window/window.rs             the Window record, Visibility, matches
  userland/capsule_wm/src/window/kind.rs               Kind, focusable, kind_from_u32
  userland/capsule_wm/src/window/table/types.rs        WindowTable, MAX_WINDOWS = 256
  userland/capsule_wm/src/window/table/find.rs         find by (owner_pid, window_id)
  userland/capsule_wm/src/window/table/find_mut.rs     find_mut for in-place edits
  userland/capsule_wm/src/window/table/insert.rs       insert into first free slot, reject duplicate
  userland/capsule_wm/src/window/table/remove.rs       remove the matching entry
  userland/capsule_wm/src/window/table/remove_one_dead.rs  clear one dead-owner entry, return a copy
  userland/capsule_wm/src/window/table/windows.rs      iterate in-use entries
```

Every reference above is verified against those trees.
</content>
