---
title: "The Event and the Path"
description: "An input event travels from a driver capsule, through the kernel ring, to the router capsule, and on to whichever consumer owns the focus."
weight: 2
---
An input event travels from a driver capsule, through the kernel ring, to the router capsule, and
on to whichever consumer owns the focus. This page documents the event structure, the three
syscalls that move it, the routing decisions the router makes for a keypress and for a pointer
event, focus and grab handling, the coordinate spaces, and every place along the way where an
event can be dropped. Every claim is against `src/` and `userland/`; the source map at the bottom
lists the files.

## The event

An `InputEvent` ([`src/kernel_core/surface_registry/types.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/types.rs#L44)) is a fixed, flat record, `#[repr(C)]`:

```
  struct InputEvent {
      kind:    u16,    // event kind, one of the INPUT_KIND_* constants
      flags:   u16,    // modifier bits on key events, zero otherwise
      code:    u32,    // key code or button id
      x, y:    i32,    // absolute position
      delta_x, delta_y: i32,   // relative motion
      timestamp_ns: u64,
  }
```

`size_of::<InputEvent>()` is 32 bytes with no padding: the two `u16`s pack into the first four
bytes, the `u32` and the four `i32`s are naturally aligned, and the trailing `u64` sits on an
8-byte boundary. That fixed layout is what lets the record cross the syscall boundary and the IPC
boundary by value. The userland mirror in [`userland/libc/src/surface_registry/types.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/surface_registry/types.rs#L44) is the
identical struct, and its comment ties it to the ABI wire definition so every supported target
lays it out the same way. The kernel never interprets these fields; it moves the record.

The `kind` values are defined once, in userland, at
[`userland/libc/src/surface_registry/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/surface_registry/types.rs#L23):

```
  INPUT_KIND_KEY_DOWN    = 0
  INPUT_KIND_KEY_UP      = 1
  INPUT_KIND_POINTER_REL = 2
  INPUT_KIND_POINTER_ABS = 3
  INPUT_KIND_WHEEL       = 4
  INPUT_KIND_BUTTON_DOWN = 5
  INPUT_KIND_BUTTON_UP   = 6
  INPUT_KIND_TOUCH       = 7
```

On key events the `flags` field carries modifier bits. The PS/2 driver defines them at
[`userland/capsule_driver_ps2_input/src/keymap/post.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/keymap/post.rs#L25) as `MOD_SHIFT=1`, `MOD_CTRL=2`,
`MOD_ALT=4`, `MOD_META=8`, and its comment notes the USB HID driver uses the same encoding. On
button events `code` is the button id: the PS/2 and USB drivers post `bit + 1`, so left button is
1, right is 2, middle is 3 ([`userland/capsule_driver_ps2_input/src/mouse/post.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/mouse/post.rs#L43),
[`userland/capsule_driver_usb_hid/src/hid/post_mouse.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_mouse.rs#L44)). `timestamp_ns` is posted as zero by every
current driver; nothing on the path fills it in.

## The three syscalls

Input is three `MkInputEvent*` syscalls. Their numbers are FourCC tags, packed little-endian by
`tag4` ([`src/syscall/abi/tag.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/tag.rs#L20)), so they read as ASCII if dumped at low memory
([`src/syscall/numbers/defs.rs:96`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/defs.rs#L96)):

```
  MkInputEventPost  = tag4("MIEP") = 0x5045494D
  MkInputEventDrain = tag4("MIED") = 0x4445494D
  MkInputEventWait  = tag4("MIEW") = 0x5745494D
```

The userland wrappers `mk_input_event_post`, `mk_input_event_drain`, `mk_input_event_wait` live in
`userland/libc/src/surface_registry/`, and the matching number constants are in
[`userland/libc/src/syscall/numbers/input.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/syscall/numbers/input.rs#L18).

They are dispatched by `input_ops::handle` ([`src/syscall/dispatch/router/input_ops.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs#L36)):

```
  MkInputEventPost(ev_ptr)                     a driver posts one event
  MkInputEventDrain(out_ptr, max)              the router drains up to max (<= 64) events
  MkInputEventWait(last_seq, timeout, out_ptr) block until the sequence advances or times out
```

`do_post` (`input_ops.rs:53`) reads one `InputEvent` out of user memory with `read_user_value`,
returning `EFAULT` (14) if that read faults, then calls `post_input`; on a full ring it returns
`ENOMEM` (12). `do_drain` (`input_ops.rs:64`) rejects a null pointer or a zero count with `EINVAL`
(22), clamps the request to `MAX_DRAIN` (64) events, drains into a kernel scratch buffer, copies
the used bytes out with `copy_to_user` (the [usercopy](/docs/subsystems/memory/usercopy/) checks), and returns
the count; a copy fault is `EFAULT`. `do_wait` (`input_ops.rs:83`) validates the `u64` out-pointer
with `validate_user_write`, then loops: it arms the caller as the ring's waiter, reads the current
sequence, and if the sequence differs from the `last_seq` the caller passed, or the timeout has
elapsed, it clears the waiter, writes the new sequence back, and returns. Otherwise it sleeps to a
deadline (`start + timeout_ms`, or `now + 50ms` when `timeout_ms` is zero) and re-checks. Each of
the three returns `success_audited`, so every input syscall is marked in the audit stream.

## The kernel ring

The ring is a single global MPSC queue in [`src/kernel_core/surface_registry/input_ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs). Many
driver capsules post; exactly one router capsule drains. It is a fixed array of
`INPUT_RING_CAP = 1024` events (`types.rs:18`) behind a `spin::Mutex`, plus four atomics:

```
  RING    Mutex<Ring{head, tail, buf[1024]}>   the events
  SEQ     AtomicU64   incremented on every successful post
  WAITER  AtomicU64   pid of the parked drainer, or 0
  DROPPED AtomicU64   count of posts that hit a full ring
```

`post_input` (`input_ring.rs:55`) takes the mutex, computes `next = (head+1) % 1024`, and if that
equals `tail` the ring is full: it bumps `DROPPED` and returns `RegistryError::OutOfSlots`, which
`do_post` maps to `ENOMEM`. Otherwise it stores the event, advances `head`, releases the mutex,
does a release-ordered `SEQ.fetch_add(1)`, and if a waiter pid is parked it swaps `WAITER` to zero
and calls `sched::wake_process` on it. The first post ever also emits the one-shot bench marker
`input_post_first` through `mark_once` (`input_ring.rs:68`, [`src/sys/bench/mark_once.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/bench/mark_once.rs#L19)).

`drain_input` (`input_ring.rs:95`) takes the mutex and copies from `tail` up to `head` into the
caller's slice, stopping at whichever runs out first, and returns the count. `arm_input_waiter`
and `clear_input_waiter` (`input_ring.rs:80`) set and clear the parked pid. The design is
deliberately thin: a bounded ring, a monotonic sequence, and one wakeup. There is no per-source
queue and no priority in the kernel; per-source fanout happens in the router.

## The capsule path

```
  driver capsule            kernel ring              input_router capsule       consumers
  (ps2 / i2c-hid / usb)                                                         (shell / gui / apps)
  MkInputEventPost   -->  post_input, SEQ++, wake  -->  Wait + Drain, route  -->  NINP over IPC
```

A driver capsule owns its device through the [hardware broker](/docs/subsystems/hardware-broker/irq/),
translates hardware input into `InputEvent`s, and posts each one with `mk_input_event_post`. The
single `capsule_input_router` (`userland/capsule_input_router/`) drains the batch and routes each
event to the consumer that should receive it, over [IPC](/docs/subsystems/ipc/).

### The driver side

- PS/2 keyboard: scancodes are translated to keycodes and posted at
  [`userland/capsule_driver_ps2_input/src/keymap/post.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/keymap/post.rs#L41) as `KEY_DOWN`/`KEY_UP` with the current
  modifier mask in `flags`. The mouse posts relative motion as `POINTER_REL` with `delta_x`/
  `delta_y`, wheel as `WHEEL` with `delta_y`, and button transitions as `BUTTON_DOWN`/`BUTTON_UP`
  with `code = bit+1` ([`userland/capsule_driver_ps2_input/src/mouse/post.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/mouse/post.rs#L24)).
- USB HID: the same shape through [`userland/capsule_driver_usb_hid/src/hid/post_wire.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_wire.rs), which
  offers both a relative `send` and an absolute `send_abs` that fills `x`/`y`. The mouse publisher
  posts `POINTER_REL`, `WHEEL`, and button events ([`.../hid/post_mouse.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../hid/post_mouse.rs)).
- i2c HID: [`userland/capsule_driver_i2c_hid/src/input/post.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/post.rs#L19) posts through the same
  `mk_input_event_post`, driven by the report parser under `.../input/`.

A driver whose `post_input` returns `ENOMEM` has hit a full ring; the driver simply sees a negative
return from `mk_input_event_post` and treats the event as lost. The USB HID mouse counts these in
`state.post_failures` ([`.../hid/mouse.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../hid/mouse.rs#L67)); the PS/2 and i2c paths discard the boolean.

### The router loop

`server::run` ([`userland/capsule_input_router/src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L31)) is the whole router. Each
iteration it services one IPC request (subscribe, grab, release, health), periodically purges dead
pids and re-reads mouse sensitivity policy, then calls `drain_batch`
([`userland/capsule_input_router/src/sources/kernel_ring.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L27)), which drains up to
`MAX_BATCH = 32` events with `mk_input_event_drain`. It routes each event through `route_event`,
pushes a cursor update to the compositor if the cursor moved, and when the batch was empty parks in
`mk_input_event_wait` with a 20ms timeout, carrying `last_seq` forward. So the router never blocks
while events are pending and never spins when idle.

## Routing one event

`route_event` ([`userland/capsule_input_router/src/route/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L28)) decides the destination in
this order.

1. Grab. If a capsule holds a grab whose kind mask covers this event's kind
   ([`state/grabs/holder_for.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/grabs/holder_for.rs#L20)), the event goes straight to the grab holder and no focus or
   hit-test logic runs. A failed delivery forgets that pid.
2. Pointer kinds (`REL`, `ABS`, `WHEEL`, `BUTTON_DOWN`, `BUTTON_UP`, `TOUCH`) go to
   `pointer::route_pointer`.
3. Keyboard kinds (`KEY_DOWN`, `KEY_UP`) go to `keyboard::route_keyboard`.
4. Anything else fans out to every subscriber whose mask matches
   (`state/subscriptions/match_kind`), with failed pids forgotten afterward.

### A keypress

`route_keyboard` ([`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25)):

- A `KEY_DOWN` resolves the destination by asking the window manager for the focused pid,
  `wm::query_focus` ([`clients/wm/query_focus.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/clients/wm/query_focus.rs#L20)), a synchronous IPC round trip to the
  `app.window_manager` service returning an owner pid. The result is cached in `last_focus_pid`. If
  the WM has no focus (or the query fails), it falls back to `last_focus_pid`, then to the shell.
- A `KEY_UP` does not query the WM. It looks up whoever received the matching press in the
  `key_targets` table keyed by `code` and sends the release there. This is deliberate: if focus
  changes while a key is held, the release still reaches the window that got the press, so no window
  is left with a stuck key.
- Before delivering, the router checks the destination is subscribed to this kind
  (`subscriptions.allows`). If not, the event is dropped and counted as zero delivered.
- On a successful `KEY_DOWN` the target is remembered in `key_targets` for the future release. A
  failed delivery forgets the pid.

The delivered event keeps its `code` and `flags` unchanged; the consumer reads the keycode and
modifier bits directly.

### A pointer event

`route_pointer` ([`userland/capsule_input_router/src/route/pointer/route_pointer.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L33)):

1. `refresh_display` lazily learns the display size from the compositor the first time, so the
   cursor bounds match the screen ([`route/pointer/refresh_display.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/pointer/refresh_display.rs#L20)).
2. `cursor.apply` folds the event into the absolute cursor position
   ([`state/cursor.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/cursor.rs#L43)). A `POINTER_REL` adds `delta * mult_x2 / 2` (a sensitivity multiplier
   clamped to 1..4 from policy); an `ABS` or `TOUCH` maps the device's `x`/`y` from the fixed
   `0..0x7FFF` range onto the display, then clamps into `0..max`. Coordinates leaving the cursor
   are unsigned screen pixels.
3. `mirror_shell_pointer` sends motion to the shell as a `POINTER_ABS` at the cursor position if the
   shell subscribed to `POINTER_ABS`, so the shell can track the cursor for edge reveals even when a
   window is focused ([`route/pointer/mirror_shell_pointer.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/pointer/mirror_shell_pointer.rs#L24)).
4. If a press is active (a button went down over a window), the event is routed to that press
   target until the matching `BUTTON_UP`, which clears the press. This is the drag path
   (`route_pointer.rs:40`).
5. Motion also drives hover (`hover_motion`).
6. Buttons, touch, and wheel need a hit test. `topmost_target` asks the WM which window is under the
   cursor, `wm::query_topmost` ([`clients/wm/query_topmost.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/clients/wm/query_topmost.rs#L21)), which returns a `Target`: owner
   pid, window id, the local coordinates inside the window, and the window rect. If the topmost is
   the shell (or there is no window), the event goes to the shell. Otherwise, a `BUTTON_DOWN` opens
   a press latched to that window and the event is routed there.

`route_to_window` ([`route/pointer/route_to_window.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/pointer/route_to_window.rs#L27)) is where the coordinate space changes:
a `BUTTON_DOWN` or `TOUCH` first raises and focuses the window through `wm::route_focus`, then the
event is rewritten so `x`/`y` are the window-local coordinates from the `Target`, and a
`POINTER_REL` is converted to `POINTER_ABS` with its deltas zeroed. The consumer therefore always
receives window-local absolute coordinates, never screen coordinates. A subscription check gates the
delivery, and a failed send forgets the pid.

## Coordinate spaces

- Device space. What a driver posts. Relative deltas for a mouse; for absolute devices the
  `0..0x7FFF` normalized range ([`state/cursor.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/cursor.rs#L19)).
- Screen space. What the router's cursor tracks after `cursor.apply`, unsigned pixels clamped to
  the display, cursor starting centered ([`state/cursor.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/cursor.rs#L31)).
- Window-local space. What a focused window receives, produced by `route_to_window` from the WM's
  `Target.local_x`/`local_y`.

## Focus and grabs

Focus is owned by the window manager, not the router. The router asks on each `KEY_DOWN` and on each
pointer hit test and caches the answer; a `BUTTON_DOWN`/`TOUCH` on a window also tells the WM to
change focus. There is no focus state of record inside the router beyond the `last_focus_pid` cache.

A grab is an exclusive claim on a class of events. `grab_request`
([`server/handlers/grab_request.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/grab_request.rs#L31)) only accepts three named capsules,
`app.boot_splash`, `app.setup_wizard`, `app.input_probe`, resolved by name to pid; anyone else gets
`E_ACCES`. The mask is split into keyboard bits (`0b11`) and pointer bits (`0b1111_1100`) so a mixed
request cannot cross-match, and a second holder of an already-held class gets `E_BUSY`
([`state/grabs/request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/grabs/request.rs#L22)). While a grab is held, matching events bypass focus and hit testing
entirely. `grab_release` ([`server/handlers/grab_release.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/grab_release.rs#L21)) drops the caller's grabs.

## Delivery envelope

Every event handed to a consumer is wrapped in the NINP envelope by `encode_delivery`
([`userland/capsule_input_router/src/protocol/delivery.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/protocol/delivery.rs#L29)) and sent with `mk_ipc_send_to_pid`
([`route/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/deliver.rs#L24)). The frame is 40 bytes: a 4-byte magic `NINP` (`0x4E49_4E50`), a 2-byte
version (1), 2 zero bytes, then the 32-byte `InputEvent` laid out field by field, little-endian.
The magic is distinct from the router's request channel so a subscriber cannot mistake a delivery
for a reply. The consumer decodes it inversely; the desktop shell's handler
([`userland/capsule_desktop_shell/src/server/input.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/src/server/input.rs#L28)) checks length >= 40, magic `0x4E49_4E50`,
version 1, then reads `kind` at offset 8 and `x`/`y` at 16/20.

## Where an event can be dropped

- Full kernel ring. `post_input` drops when `head+1 == tail`, bumps `DROPPED`, returns `ENOMEM`
  (`input_ring.rs:59`). Nothing reads `DROPPED` back out, so this loss is silent to userland.
- Drain batch cap. The router drains at most 32 per iteration
  ([`sources/kernel_ring.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/sources/kernel_ring.rs#L25)) and the syscall caps at 64 (`input_ops.rs:32`); a burst larger than
  the ring is what actually loses events, the batch cap only bounds latency.
- No subscription. Keyboard and window pointer delivery are gated by `subscriptions.allows`; an
  unsubscribed target is skipped with zero delivered ([`route/keyboard.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/keyboard.rs#L46),
  [`route/pointer/route_to_window.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/pointer/route_to_window.rs#L40)).
- No focus target. If the WM reports no focus and there is no cached focus and no shell pid, a key
  event has nowhere to go and is dropped ([`route/keyboard.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/keyboard.rs#L61)).
- Dead pid. Any `deliver_one` that fails (negative IPC send) returns zero and the router calls
  `forget_pid` on that target, removing its subscriptions and grabs ([`route/deliver.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/deliver.rs#L31)).
- Grab misdirection. While a grab is held, a non-grabbing window sees none of the grabbed class,
  by design ([`route/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/dispatch.rs#L29)).
- Negative coordinates at the consumer. The shell rejects an event whose decoded `x` or `y` is
  negative ([`server/input.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/input.rs#L44)).

## Security analysis

Input is a sensitive stream: a keypress can be a password, and synthetic input is a way to drive
another capsule. The trust boundary is the capability model.

Who can post. `MkInputEventPost` requires `can_input_source`, which grants only to a token holding
`InputSource`, `Irq`, or `Admin` ([`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78),
[`src/capabilities/token/types.rs:166`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/types.rs#L166)). `InputSource` is capability value `2097152`
([`src/capabilities/types.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L49)). In practice only the device driver capsules that already own the
hardware through an IRQ grant hold it, so an ordinary capsule cannot inject synthetic keystrokes or
pointer motion into the shared ring.

Who can drain and wait. `MkInputEventDrain` and `MkInputEventWait` require only `can_ipc`
(`mk.rs:79`). The kernel does not check that the drainer is the router; the ring has a single
`WAITER` slot and a single `tail`, so the design assumes exactly one drainer. Any capsule holding
IPC and the syscall knowledge could drain the raw stream, and drained events are removed from the
ring. The isolation that matters is therefore that only one trusted router capsule is spawned with
this role; the kernel enforces post authority strictly but drain authority weakly. This is a
boundary worth stating plainly: input confidentiality against a rogue IPC-capable capsule rests on
that capsule not being present, not on a kernel check.

Isolation between capsules. The router never hands one consumer another consumer's events. A key
goes only to the focused pid (or the press/grab target); a window pointer event is rewritten to
window-local coordinates before delivery so a consumer cannot infer the global cursor position or
other windows' geometry from it. Delivery is a point-to-point `mk_ipc_send_to_pid`, not a broadcast,
so a subscriber receives only events routed to it. Grabs, the one way to receive the whole class of
events, are restricted to three named trusted capsules by pid lookup (`grab_request.rs:25`).

## Debugging

Boot markers. The PS/2 driver emits `[driver_ps2] endpoint driver.ps2_kbd0 ready` through
`mk_debug` once its setup sequence completes ([`userland/capsule_driver_ps2_input/src/setup/sequence.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/setup/sequence.rs#L43)).
The USB HID driver emits `[USB-HID-ENUM] tablet bound`
([`userland/capsule_driver_usb_hid/src/orchestrator/poll/run.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/poll/run.rs)). If neither marker appears, the
device was never claimed and nothing is posting; the failure is upstream in device discovery or the
broker claim, not in the input path. `find_ps2_kbd` returning nothing is reported as
`ps2 keyboard not present in device list` ([`setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/sequence.rs#L27)).

First-event markers. The kernel emits the one-shot bench markers `input_post_first` on the first
successful post and `input_drain_first` on the first drain (`input_ring.rs:68`, `input_ops.rs:79`).
`input_post_first` present but `input_drain_first` absent means events are entering the ring but the
router is not draining, so look at whether `capsule_input_router` was spawned and holds IPC.
Neither present means no driver ever posted; go back to the boot markers above.

Dead keyboard or touchpad. If the driver marker is present but keys do nothing, the event is
reaching the ring but not the window. Check, in order: is the target subscribed to the kind
(`subscriptions.allows`, [`route/keyboard.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/keyboard.rs#L46)), does `wm::query_focus` return a real pid, and is
IPC delivery succeeding. A window that is not subscribed silently receives nothing; a window whose
pid has died is forgotten on the first failed send. A pointer that moves the cursor but never
clicks through to a window points at the hit test: `wm::query_topmost` returning the shell or a zero
owner pid routes the event to the shell instead of the window
([`route/pointer/route_pointer.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/pointer/route_pointer.rs#L52)).

Input reaches nothing at all. A full ring drops posts and bumps `DROPPED`, but nothing reads that
counter, so drops are invisible in the log; a suddenly unresponsive system under an input flood is
consistent with ring saturation even without a log line. The batch drain and the 20ms wait timeout
([`server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/runner.rs#L29)) bound how stale a delivered event can be.

## Source map

```
  src/kernel_core/surface_registry/types.rs          InputEvent, INPUT_RING_CAP, kinds
  src/kernel_core/surface_registry/input_ring.rs      the MPSC ring, SEQ, WAITER, DROPPED
  src/syscall/dispatch/router/input_ops.rs            the three MkInputEvent* handlers
  src/syscall/numbers/defs.rs                         MIEP / MIED / MIEW tags
  src/syscall/abi/tag.rs                              tag4 FourCC packing
  src/syscall/contract/cap_table/mk.rs               capability gate per syscall
  src/capabilities/token/types.rs                    can_input_source
  src/capabilities/types.rs                           InputSource capability
  userland/libc/src/surface_registry/                InputEvent mirror, kinds, wrappers
  userland/capsule_driver_ps2_input/                 PS/2 keyboard and mouse driver
  userland/capsule_driver_usb_hid/                   USB HID driver
  userland/capsule_driver_i2c_hid/                   i2c HID driver
  userland/capsule_input_router/                     the router: sources, route, state, protocol
  userland/capsule_desktop_shell/src/server/input.rs the consumer decode
```

Every reference above is verified against those trees.
