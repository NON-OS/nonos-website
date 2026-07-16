---
title: "Debugging capsule_input_router"
description: "This page lists the boot and first-event markers the input path emits and the concrete failure modes with where to look for each."
weight: 8
---
This page lists the boot and first-event markers the input path emits and the concrete failure modes with
where to look for each. For what the router does and how it is put together, read the [README](/docs/userland/input-router/),
the [operations reference](/docs/userland/input-router/operations/), the [routing engine](/docs/userland/input-router/routing/), the [state](/docs/userland/input-router/state/), and the
[clients](/docs/userland/input-router/clients/) pages in this folder. The kernel half of the path, including the ring counters, is on
the [event path](/docs/subsystems/input/path/) page.

## Log markers

The router carries no Debug bit in its mask, so it emits no serial markers of its own in steady state
([README](/docs/userland/input-router/) identity table). The markers that matter come from the kernel: the spawn line and the
two one-shot bench markers on the ring.

On a successful spawn the kernel logs `[INPUT-ROUTER] capsule spawned`. The `Ok` arm of the capsule boot
path calls `boot_log::ok("INPUT-ROUTER", "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)), and the prefix comes from
the fleet spawn entry ([`src/userspace/init/spawn_plan/desktop_fleet.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L78)). If that line is absent the
router never started, and the `Err` arm logged an error line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure. The router is spawned first in the desktop fleet, before the compositor
([`src/userspace/init/spawn_plan/desktop_fleet.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L38)), so its line should be the first capsule line in the
GUI bring-up.

The kernel also emits two one-shot bench markers on the ring itself: `input_post_first` on the first
successful post by any driver, and `input_drain_first` on the router's first drain
([`src/kernel_core/surface_registry/input_ring.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs#L68), [`src/syscall/dispatch/router/input_ops.rs:79`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs#L79)). These
bracket the whole path and are the fastest way to localise a dead input problem, described under the first
failure mode below.

## Failure modes

### Input reaches no window at all

Take the two ring markers in order.

- Neither marker present. No driver ever posted. The problem is upstream of the router, in device discovery
  or the broker claim; go to the driver boot markers on the [event path](/docs/subsystems/input/path/#debugging)
  page. The router draining an empty ring is correct behaviour, not a fault.
- `input_post_first` present but `input_drain_first` absent. Events are entering the ring but the router is
  not draining. Confirm `[INPUT-ROUTER] capsule spawned` appeared and that the router holds `IPC`, since the
  drain and wait syscalls are gated on `can_ipc` ([README](/docs/userland/input-router/) identity table). Drain authority is
  weak by design: the kernel assumes exactly one drainer, so if a second IPC-capable capsule were draining
  the same ring it would steal events, but in a stock fleet only the router drains.
- Both markers present but nothing reaches a window. The event is being routed but dropped at delivery; see
  the next mode.

### Input not reaching a window

The router routed the event but no window received it. Check, in order:

- Subscription. Keyboard delivery and window-pointer delivery are both gated on `subscriptions.allows`, and
  an unsubscribed pid is dropped and counted as zero delivered ([`src/route/keyboard.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L46),
  [`src/route/pointer/route_to_window.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_to_window.rs#L40)). A live window that never sent `OP_SUBSCRIBE`, or subscribed to
  the wrong kind mask, silently receives nothing. Confirm it subscribed to the kind it expects and did not
  overflow the 16-slot table, which would have replied `E_NOMEM` ([state](/docs/userland/input-router/state/), [operations](/docs/userland/input-router/operations/)).
- Focus. For a keypress, `wm::query_focus` must return a real pid; if the wm reports no focus, the router
  falls back to `last_focus_pid` and then the shell, and if all three are zero the key has nowhere to go and
  is dropped ([`src/route/keyboard.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L38), [`src/route/keyboard.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L61)). A wm that is not answering leaves
  every key falling back to the shell.
- Hit test. A pointer that moves the cursor but never clicks through to a window points at the hit test:
  `topmost_target` returning the shell or a zero owner pid routes the event to the shell instead of the
  window ([`src/route/pointer/topmost_target.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/topmost_target.rs#L20), [`src/route/pointer/route_pointer.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_pointer.rs#L33)). The click is
  being delivered, just to the shell.
- Dead pid. Any `deliver_one` that fails returns 0, and the router calls `forget_pid`, tearing down that
  pid's subscriptions, grabs, key targets, and caches ([`src/route/deliver.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/deliver.rs#L30),
  [`src/state/context/forget_pid.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/forget_pid.rs#L20)). A window whose process has died is forgotten on the first failed
  send, so a stale target never lingers, but a window still starting up that is not yet subscribed looks
  identical to a dead one from the router's side: it simply is not delivered to.

### A grab is stuck

While a grab is held, every event of that class bypasses focus and hit testing and goes straight to the
holder, so a stuck grab looks like the whole desktop ignoring the keyboard or the pointer
([`src/route/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L29), [routing](/docs/userland/input-router/routing/)). A grab is only ever held by one of the three trusted
grabbers (`app.boot_splash`, `app.setup_wizard`, `app.input_probe`), resolved by name in the grab-request
handler ([`src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L25)). Two ways it clears:

- The holder releases it. `OP_GRAB_RELEASE` is unconditional and drops whichever classes the caller holds
  ([`src/server/handlers/grab_release.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_release.rs#L22)); releasing a class you do not hold is a no-op because
  `GrabTable::release` is keyed on the holder pid ([`src/state/grabs/release.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/release.rs#L20)). A grabber that exits
  without releasing is the usual cause of a stuck grab.
- The holder dies. `purge_dead` runs every 64th loop tick and clears either grab class whose holder pid is
  no longer alive ([`src/state/grabs/purge_dead.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/purge_dead.rs#L22), [`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)), and a failed delivery to
  the holder forgets it immediately through `forget_pid` ([`src/route/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L29),
  [`src/state/context/forget_pid.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/forget_pid.rs#L31)). So a grab held by a crashed capsule clears on the next sweep at the
  latest; a grab that persists means its holder is still alive and has not released. Confirm which of the
  three grabbers is running.

### The cursor moves but is not drawn where expected

The router tracks the cursor and pushes it to the compositor, but the drawing is the compositor's. Before
the compositor answers `OP_DISPLAY_INFO` once, the cursor clamps to the 1024x768 default rather than the
real screen ([`src/state/cursor.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L31), [`src/route/pointer/refresh_display.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/refresh_display.rs#L20)), so a cursor that stops
short of the screen edges means the display-size fetch has not succeeded yet. A cursor that jumps too far or
too little per motion is the sensitivity: it is read from the policy service every two seconds and clamped
to `1..4` ([`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44), [clients](/docs/userland/input-router/clients/)); a policy service that never answers leaves the
default `mult_x2 = 2` unity gain in place.

### A key-up lands in the wrong window

By design it should not: a release is routed to whoever received the matching press through `key_targets`,
not to current focus, so a focus change while a key is held cannot strand the release
([`src/route/keyboard.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L31), [state](/docs/userland/input-router/state/)). If a release is going astray, the press was not remembered:
the 16-slot `key_targets` table drops a record when full, and that key-up then falls back to current focus
([`src/state/key_targets.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/key_targets.rs#L42)). More than 16 keys held at once is the only way to hit this.

## Source map

```
  src/userspace/init/capsule_boot/run.rs             [INPUT-ROUTER] capsule spawned / error path
  src/sys/boot_log/output.rs                         boot_log::ok formatting
  src/userspace/init/spawn_plan/desktop_fleet.rs     the fleet entry and the INPUT-ROUTER prefix
  src/kernel_core/surface_registry/input_ring.rs     input_post_first marker
  src/syscall/dispatch/router/input_ops.rs           input_drain_first marker
  src/route/keyboard.rs                              subscription gate, focus fallback, key-up target
  src/route/pointer/topmost_target.rs                hit test, zero-owner drop
  src/route/pointer/route_to_window.rs               window-pointer subscription gate
  src/route/pointer/refresh_display.rs               one-shot display-size fetch
  src/route/deliver.rs                               deliver_one 0/1 result, forget on failure
  src/route/dispatch.rs                              grab-first bypass
  src/state/context/forget_pid.rs                    teardown of a dead consumer
  src/state/grabs/release.rs                         holder-keyed release
  src/state/grabs/purge_dead.rs                      dead-holder sweep
  src/state/cursor.rs                                default bounds before display info
  src/state/key_targets.rs                           16-slot held-key table
  src/server/runner.rs                               the 64th-tick sweep and policy read
```

Every reference above is verified against those trees.
