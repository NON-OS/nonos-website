---
title: "The routing engine"
description: "This page is the heart of the capsule: how a drained event becomes a delivery to exactly one destination."
weight: 4
---
This page is the heart of the capsule: how a drained event becomes a delivery to exactly one destination.
It mirrors `src/sources/` (the kernel-ring drain that feeds the engine) and `src/route/` (the decision
order, the keyboard path, and the pointer specialization). For the tables the engine reads see the
[state](/docs/userland/input-router/state/) page; for the questions it asks the desktop see the [clients](/docs/userland/input-router/clients/) page; for the
frame it ships see the [operations](/docs/userland/input-router/operations/) page.

The router drains the ring and routes what it finds. It never posts. Draining is gated on `can_ipc`, which
the `IPC` bit satisfies; posting is gated on `InputSource`, which the router does not hold (see the
[README](/docs/userland/input-router/) identity table).

## Draining the kernel ring

`drain_batch` is the whole ingress ([`src/sources/kernel_ring.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sources/kernel_ring.rs#L27)). It calls `mk_input_event_drain` for
up to `MAX_BATCH = 32` events into a caller-owned stack array and returns the count, clamped to the batch
size defensively ([`src/sources/kernel_ring.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sources/kernel_ring.rs#L25), `:33`). A return of zero or less means the ring was
empty this iteration. The kernel ring has already normalised the events at post time, so they land in this
address space ready to route; nothing here reinterprets a field.

The loop calls `drain_batch` once per iteration and routes each event, then parks in `mk_input_event_wait`
with a 20 ms timeout only when the batch was empty, carrying the last observed sequence forward
([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51), `:66`). The syscall side of this drain, and its `can_ipc` gate, is documented
in the kernel [ring page](/docs/subsystems/input/ring/) and the [event path](/docs/subsystems/input/path/).

## The decision order

`route_event` decides the destination of every drained event in a fixed order ([`src/route/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L28)):

```
  route_event(ctx, ev):
      if a grab covers ev.kind:   deliver to the grab holder; forget the pid if the send fails
      elif is_pointer(ev.kind):   route_pointer(ctx, ev)
      elif is_keyboard(ev.kind):  route_keyboard(ctx, ev)
      else:                       fan out to every subscriber whose mask matches ev.kind
```

1. Grab first. `grabs.holder_for(ev.kind)` shifts `1 << kind` and tests it against the stored keyboard
   then pointer masks; a hit short-circuits all focus and hit-test logic and the event goes straight to the
   holder ([`src/route/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L29)). A failed delivery forgets that pid, and the result is recorded.
2. Pointer versus keyboard. `is_pointer` matches `POINTER_REL`, `POINTER_ABS`, `WHEEL`, `BUTTON_DOWN`,
   `BUTTON_UP`, and `TOUCH`; `is_keyboard` matches `KEY_DOWN` and `KEY_UP` ([`src/route/dispatch.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L61),
   `:65`). Each takes its own path below.
3. Everything else broadcasts to subscribers whose mask matches the kind, collecting failed pids into a
   fixed array and forgetting each one after the loop so a failing send does not perturb the iteration
   ([`src/route/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L43)).

Every arm ends by calling `ctx.record(n)`, which folds the count into the delivered or dropped telemetry
([`src/route/dispatch.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L34), `:57`). The telemetry itself is on the [state](/docs/userland/input-router/state/) page.

## Delivery

`deliver_one` is the single exit point to a consumer ([`src/route/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/deliver.rs#L24)). It refuses a zero pid,
encodes the event into the `NINP` envelope, and sends it point-to-point with `mk_ipc_send_to_pid`,
returning 1 on success and 0 on a failed send ([`src/route/deliver.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/deliver.rs#L25), `:30`). Delivery is never a
broadcast: even the fan-out arm loops over matched pids and calls `deliver_one` once each. That 0 or 1
return is what every path folds into the telemetry and uses to decide whether to forget a pid.

## The keyboard path

`route_keyboard` routes to the focused window and tracks per-key targets so a release follows its press
([`src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L25)):

```
  route_keyboard(ctx, ev):
      if ev is KEY_UP:  pid = key_targets.take(ev.code)  else fallback_focus
      else:             pid = wm::query_focus  (cached in last_focus_pid)  else fallback_focus
      if not subscriptions.allows(pid, ev.kind):  drop (record 0)
      delivered = deliver_one(pid, ev)
      if KEY_DOWN and delivered:  key_targets.remember(ev.code, pid)
      if delivered == 0:          forget_pid(pid)
```

- A `KEY_DOWN` asks the window manager for the focused pid and caches it in `last_focus_pid`; if the WM has
  no focus or the query fails, `fallback_focus` returns the cached focus, then the shell
  ([`src/route/keyboard.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L37), `:61`).
- A `KEY_UP` does not query the WM. It looks up whoever received the matching press in `key_targets` keyed
  by `code` and sends the release there, so a focus change while a key is held never strands the release in
  the wrong window ([`src/route/keyboard.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L31)). The `key_targets` table and its 16-slot cap are on the
  [state](/docs/userland/input-router/state/) page.
- Before delivering, the router checks the destination is subscribed to this kind; an unsubscribed pid is
  dropped and recorded as zero delivered ([`src/route/keyboard.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/keyboard.rs#L46)). This subscription gate is what makes
  a live but unsubscribed window silently ignore keys.

## The pointer path

`route_pointer` is the most involved path and runs its steps in this order ([`src/route/pointer/route_pointer.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_pointer.rs#L33)):

```
  route_pointer(ctx, ev):
      refresh_display(ctx)                       // learn the display size from the compositor, once
      (x, y) = ctx.cursor.apply(ev)               // fold motion into the absolute cursor position
      ctx.cursor_dirty = true
      deliver  = mirror_shell_pointer(ctx, ev, x, y)   // the shell always sees pointer motion
      if a press is active:                        // a drag: keep events on the press target
          deliver += route_to_press(ctx, ev, x, y)
          if ev is BUTTON_UP:  ctx.press = None
          return deliver
      if is_motion(ev):  deliver += hover_motion(ctx, ev, x, y)
      if needs_hit_test(ev):                       // BUTTON_DOWN / BUTTON_UP / TOUCH / WHEEL
          match topmost_target(ctx, x, y):         // ask the WM (QUERY_TOPMOST)
              None or shell:  route_to_shell(ctx, ev, x, y)
              target:         if BUTTON_DOWN: latch Press{target}; route_to_window(ev, target)
```

Each step is one file under `src/route/pointer/`:

- `refresh_display` fetches the display bounds from the compositor the first time only, so the cursor
  clamps to the real screen ([`src/route/pointer/refresh_display.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/refresh_display.rs#L20)). Before that first success the
  cursor uses the 1023x767 default from `CursorState::new` ([state](/docs/userland/input-router/state/)).
- `cursor.apply` folds the event into the absolute position, on the [state](/docs/userland/input-router/state/) page. `route_pointer`
  copies the result into `ctx.cursor_x`/`cursor_y` and sets `cursor_dirty`, which is what makes the main
  loop push a cursor update to the compositor after routing ([`src/route/pointer/route_pointer.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_pointer.rs#L35)).
- `mirror_shell_pointer` sends the shell a `POINTER_ABS` at the cursor position whenever the shell
  subscribed to `POINTER_ABS`, so the shell can track the cursor even while another window is focused; it
  fires for `POINTER_REL`, `POINTER_ABS`, and `TOUCH` and rewrites the kind to `POINTER_ABS` with zeroed
  deltas ([`src/route/pointer/mirror_shell_pointer.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/mirror_shell_pointer.rs#L24)).
- A held button is a drag. While `ctx.press` is set, `route_to_press` keeps sending the target its events
  in the window-local frame frozen at press time (`x - origin_x`, `y - origin_y`), until the `BUTTON_UP`
  clears the press ([`src/route/pointer/route_to_press.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_to_press.rs#L23), `route_pointer.rs:42`). The `Press` origin
  and why it is frozen are on the [state](/docs/userland/input-router/state/) page.
- Motion also drives hover. `hover_motion` caches the topmost window rect so pointer motion inside it
  routes without a WM round trip per event. It delivers local-coordinate motion while the cursor is inside
  the cached rect, sends a leave (local `(-1, -1)`) and clears the cache when the cursor exits, and
  re-queries the WM only every fourth motion event (`REQUERY_EVERY = 4`) to throttle the cross-service call
  ([`src/route/pointer/hover_motion.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/hover_motion.rs#L27), `:36`).
- A button, touch, or wheel needs a hit test. `topmost_target` asks the window manager which window is
  under the cursor and drops a zero owner pid ([`src/route/pointer/topmost_target.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/topmost_target.rs#L20)). If the topmost is
  the shell or there is no window, the event goes to `route_to_shell`, which delivers only button-down and
  touch ([`src/route/pointer/route_to_shell.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_to_shell.rs#L24)). Otherwise a `BUTTON_DOWN` latches a `Press` on that
  window, clears any hover, and the event is routed there (`route_pointer.rs:56`).

### Coordinate frames change at delivery

`route_to_window` is where the coordinate frame changes ([`src/route/pointer/route_to_window.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_to_window.rs#L27)). A
`BUTTON_DOWN` or `TOUCH` first raises and focuses the window through `wm::route_focus`, then the event is
rewritten: a `POINTER_REL` is promoted to `POINTER_ABS` with its deltas zeroed, and `x`/`y` are replaced by
the window-local coordinates from the WM `Target` ([`src/route/pointer/route_to_window.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_to_window.rs#L33), `:38`). A
subscription check gates the delivery, and a failed send forgets the pid
([`src/route/pointer/route_to_window.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_to_window.rs#L40)). A consumer therefore always receives window-local absolute
coordinates and can never infer the global cursor position or another window's geometry from what it gets.

## Source map

```
  src/sources/kernel_ring.rs             drain_batch: mk_input_event_drain, MAX_BATCH = 32
  src/route/dispatch.rs                  route_event: grab / pointer / keyboard / broadcast order
  src/route/deliver.rs                   deliver_one: NINP encode + mk_ipc_send_to_pid, 0/1 result
  src/route/keyboard.rs                  focus routing, KEY_UP via key_targets, subscription gate
  src/route/pointer/route_pointer.rs     the pointer decision order and the press latch
  src/route/pointer/refresh_display.rs   one-shot display-size fetch
  src/route/pointer/mirror_shell_pointer.rs  the shell's always-on pointer mirror
  src/route/pointer/route_to_press.rs    the drag path, frozen-origin local frame
  src/route/pointer/hover_motion.rs      cached-rect hover, leave event, REQUERY_EVERY throttle
  src/route/pointer/topmost_target.rs    QUERY_TOPMOST hit test, zero-owner drop
  src/route/pointer/route_to_shell.rs    fall-through to the shell for button-down / touch
  src/route/pointer/route_to_window.rs   window-local rewrite, route_focus, subscription gate
  src/route/pointer/shell_pid.rs         cached desktop_shell pid lookup
  src/server/runner.rs                   the loop: drain_batch, route, cursor push, wait
```

Every reference above is verified against those trees.
</content>
