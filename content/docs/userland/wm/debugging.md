---
title: "Debugging capsule_wm"
description: "This page lists the one boot marker the wm's spawn path emits and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the one boot marker the wm's spawn path emits and the concrete failure modes with where to
look for each. For the operation set see the [README](/docs/userland/wm/), the [operations reference](/docs/userland/wm/operations/),
the [placement and focus model](/docs/userland/wm/layout/), the [compositor client and gate](/docs/userland/wm/clients/), and the
[state](/docs/userland/wm/state/) pages in this folder.

## Log markers

The wm is deliberately quiet: Debug is absent from its mask and it emits no serial markers of its own in
steady state (`Capsule.mk:17`). The only wm-related boot marker comes from the kernel spawn path, so the
first thing to confirm is that the capsule started.

On a successful boot the kernel logs `[WM] capsule spawned` from the capsule boot path: the `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is
absent the capsule never started, and the `Err` arm logged an error line through `boot_log::error` instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure.

## Failure modes

### No window opens

If an app's `OP_WINDOW_OPEN` never lands, the wm may still be stuck in `wait_for_setup` because the
compositor is not answering: setup resolves and probes `compositor` and reads the display size before the
loop starts, and it retries forever on failure ([`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19), [`src/setup/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L36)). A
window that opens off-screen or in an unexpected spot is the placement policy: the requested rect was
clamped to the display and then stepped away from a collision ([`src/geometry/constrain.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/geometry/constrain.rs#L25),
[`src/server/handlers/window_open/place.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/window_open/place.rs#L25)). A repeat open that seems to do nothing is the idempotent
path returning the existing rect ([`window_open/handle.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/handle.rs#L32)). An open that returns `E_NOMEM` means the
256-entry table is full ([`window_open/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/handle.rs#L51)).

### Focus stuck or lost

Focus is a single reference; it is cleared and `FOCUS_SET(0)` pushed when the focused window is closed,
minimized, or swept as dead (`window_close.rs:41`, `window_minimize.rs:36`, `sweep_dead.rs:24`). If a click
does not change focus, suspect the `ROUTE_FOCUS` gate: it is refused with `E_PERM` unless the sender is the
live `input_router`, so a router that failed to register or a stale cached pid stops focus routing
([`route_focus/handle.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route_focus/handle.rs#L25), [`route_focus/is_input_router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route_focus/is_input_router.rs#L34)). If a window will not take focus at all,
check its kind: a `Tooltip` is not focusable ([`src/window/kind.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/window/kind.rs#L27)).

### A click lands on the wrong window

The router asks `OP_QUERY_TOPMOST`, which returns the highest-z visible focusable window containing the
point, in that window's local coordinates ([`src/server/handlers/query_topmost.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/query_topmost.rs#L40),
[`src/focus/hit_test.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/focus/hit_test.rs#L30)). A window that should be on top but is not needs an `OP_WINDOW_RAISE` to bump
its z (`window_raise.rs:30`).

### A resize is rejected

`OP_WINDOW_RESIZE` refuses a normal-window size that would overlap another visible normal window with
`E_INVAL`; move the neighbour or resize smaller ([`window_resize/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_resize/handle.rs#L51),
[`window_resize/collides.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_resize/collides.rs#L20)).

### Windows of a crashed app linger

They are cleared on the next sweep tick, which runs every fourth loop wakeup (each wakeup at most 250 ms),
not instantly ([`src/server/runner/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/constants.rs#L17), [`src/server/runner/sweep_dead.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/sweep_dead.rs#L21)). The same tick
purges dead subscribers before removing windows one at a time.

### A subscriber stops receiving notifications

Notifications are best-effort sends with no acknowledgement; a send that fails marks the subscriber pid
stale and drops it from the list, and `purge_dead` clears any subscriber whose pid is no longer alive on
the next sweep ([`src/server/notify_fanout.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/notify_fanout.rs#L35), [`src/state/subscriptions.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/subscriptions.rs#L61)). A subscriber that never
registered will not appear, so confirm it sent `OP_LIFECYCLE_SUBSCRIBE` and did not overflow the 16-entry
list (`lifecycle_subscribe.rs:21`).

## Source map

```
  src/userspace/init/capsule_boot/run.rs                    [WM] capsule spawned / error path
  userland/capsule_wm/src/wait_for_setup.rs                 stuck-in-setup case
  userland/capsule_wm/src/setup/run.rs                      resolve + probe compositor, read display
  userland/capsule_wm/src/server/handlers/window_open/place.rs   off-screen / unexpected placement
  userland/capsule_wm/src/server/handlers/route_focus/          the focus-routing gate
  userland/capsule_wm/src/server/handlers/query_topmost.rs  wrong-window click
  userland/capsule_wm/src/focus/hit_test.rs                 the highest-z hit rule
  userland/capsule_wm/src/server/handlers/window_resize/    rejected-resize case
  userland/capsule_wm/src/server/runner/sweep_dead.rs       crashed-app cleanup cadence
  userland/capsule_wm/src/server/notify_fanout.rs           best-effort notify, stale-pid drop
```

Every reference above is verified against those trees.
</content>
