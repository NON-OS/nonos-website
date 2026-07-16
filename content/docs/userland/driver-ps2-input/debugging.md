---
title: "Debugging capsule_driver_ps2_input"
description: "This page lists the markers and counters the driver and its input path emit, and the concrete failure modes with where to look for each."
weight: 7
---
This page lists the markers and counters the driver and its input path emit, and the concrete failure
modes with where to look for each. For how the driver is put together read the [README](/docs/userland/driver-ps2-input/), the
[protocol and rings](/docs/userland/driver-ps2-input/protocol/), the [bring-up](/docs/userland/driver-ps2-input/bring-up/), and the [decode](/docs/userland/driver-ps2-input/decode/) pages in this
folder. The system-wide input path, including the router and the compositor, is in
[../../subsystems/input/path.md](/docs/subsystems/input/path/).

## The boot marker

The first thing to confirm is that the driver came up. On a successful bring-up it emits
`[driver_ps2] endpoint driver.ps2_kbd0 ready` through `mk_debug`, the last thing `setup::run` does before
returning ([`src/setup/sequence.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L43), [`src/setup/marker.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/marker.rs#L17)). If that line is absent the device was
never claimed and nothing is posting; the failure is upstream in discovery or the broker claim, not in
the decode path. A missing keyboard record is reported as `ps2 keyboard not present in device list`
([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)), and `_start` retries `setup::run` forever with a yield between attempts, so
a driver that logs neither the marker nor an event is stuck in that retry loop
([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)).

## The first-event markers

Once the driver marker is present, the kernel emits one-shot bench markers on the input path:
`input_post_first` on the first successful post into the ring
([`src/kernel_core/surface_registry/input_ring.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs#L68)) and `input_drain_first` on the first router drain
([`src/syscall/dispatch/router/input_ops.rs:79`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs#L79)). `input_post_first` present but `input_drain_first`
absent means the driver is decoding and posting but the router is not draining, so check that the input
router capsule was spawned and holds IPC. Neither present means no driver ever posted; go back to the
boot marker above.

## The diagnostic counters

`OP_GET_STATE` returns seven `u64` counters in a fixed order, and they are the fastest way to localise a
fault ([`src/server/handlers/state.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/state.rs#L27), and the [protocol](/docs/userland/driver-ps2-input/protocol/) page for the layout). Index 0
is keyboard events seen, 1 keyboard events dropped, 2 parity errors, 3 timeout errors, 4 mouse events
seen, 5 mouse events dropped, 6 mouse sync errors. `OP_CONTROLLER_STATUS` complements them with a live
i8042 snapshot that does not consume a data byte ([`src/server/handlers/controller_status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_status.rs#L28)).

## Failure modes

### Dead keyboard, driver marker present

Events either are not reaching the ring or are not reaching the window. Poll `OP_GET_STATE` and watch
index 0 (keyboard events seen). If it stays at zero, the controller is not delivering bytes to this
capsule, which most often means the config-byte flush regressed and `CONFIG_IRQ1` got cleared or the
disable bit got set during the enable sequence ([`src/init/enable_keyboard/enable.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/enable.rs#L28)). If index 0
climbs but nothing appears on screen, the driver is fine and the problem is downstream in the router or
the target's subscription, which is the input-path case in
[../../subsystems/input/path.md](/docs/subsystems/input/path/), not this capsule.

### No mouse

`OP_CONTROLLER_STATUS` reports `mouse_enabled` at offset 20 of its payload (`src/server/handlers/
controller_status.rs:48`). A zero there means the AUX enable sequence never acknowledged, so the keyboard
runs but the mouse never came up; the enable path fails unless every mouse command returns `MOUSE_ACK`
([`src/init/enable_mouse/mouse_command.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_mouse/mouse_command.rs#L24), [`src/setup/sequence.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L40)). A non-zero `mouse_enabled`
with index 4 (mouse events seen) staying flat points instead at IRQ12 delivery or a stuck AUX line, not
at enable. Note that the AUX path is soft-failing by design: an absent or unbindable mouse leaves
`aux_irq_grant_id = 0` and the keyboard fully live ([`src/setup/setup_aux.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/setup_aux.rs#L21)).

### Stuck or repeating keys

Keys are posted as raw make/break translations, so a stuck key usually means a break code was lost. Watch
index 1 (keyboard events dropped): the keyboard ring overwrites the oldest event on overflow and counts
the drop, which can eat a break code if the router falls behind reading `OP_POLL_EVENTS`
([`src/ring/push.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/push.rs#L22)). Parity and timeout counters (indices 2 and 3) rising alongside indicate
line-level corruption rather than a decode bug ([`src/poll/drain.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/drain.rs#L39)). The kernel input post itself
sends a `KEY_UP` for every break code it decodes, so a key stuck in a window rather than in the counters
is a router or consumer problem, covered in
[../../subsystems/input/path.md](/docs/subsystems/input/path/).

### Mouse pointer jumps or desyncs

Index 6 (mouse sync errors) rising means the 3-byte packet alignment is being lost. The parser refuses a
first byte without the sync bit and counts it rather than desynchronising, so a high count points at
dropped bytes on the AUX line, not at the parser ([`src/mouse/parser.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L30)). Index 5 (mouse events
dropped) rising means the mouse ring filled and dropped the newest samples, which is consistent with a
consumer that stopped calling `OP_POLL_MOUSE` while motion continued ([`src/mouse/ring.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs#L38)). A pointer
that moves but never clicks through to a window is the hit-test case in the input path, not a decode bug:
buttons are posted only on transition ([`src/mouse/post.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs#L35)).

### No IPC reply at all

Every reply goes to the fixed kernel reply endpoint, not back through the recv socket
([`src/protocol/endpoint.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L16)). A caller that never sees a reply but the driver is otherwise alive is
usually reading the wrong endpoint; the kernel-side transport binds the matching inbox
([`src/hardware/ps2_kbd_capsule/client/transport.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/client/transport.rs#L30)). A malformed request (bad magic, wrong version,
short buffer, or a non-zero payload length) is answered `E_INVAL` rather than dropped
([`src/server/runner.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L59), `:64`).

## Source map

```
  userland/capsule_driver_ps2_input/src/main.rs                   the setup retry loop
  userland/capsule_driver_ps2_input/src/setup/sequence.rs         the ready marker and the missing-record error
  userland/capsule_driver_ps2_input/src/setup/setup_aux.rs        the soft-failing AUX path
  userland/capsule_driver_ps2_input/src/init/enable_keyboard/enable.rs  the config-byte flush fix
  userland/capsule_driver_ps2_input/src/init/enable_mouse/mouse_command.rs  the MOUSE_ACK gate
  userland/capsule_driver_ps2_input/src/server/handlers/state.rs  the seven diagnostic counters
  userland/capsule_driver_ps2_input/src/server/handlers/controller_status.rs  the live i8042 snapshot
  userland/capsule_driver_ps2_input/src/ring/push.rs              the keyboard overwrite-oldest drop
  userland/capsule_driver_ps2_input/src/mouse/ring.rs             the mouse drop-newest drop
  userland/capsule_driver_ps2_input/src/mouse/parser.rs           the sync-error counting
  userland/capsule_driver_ps2_input/src/protocol/endpoint.rs      the fixed kernel reply endpoint
  src/kernel_core/surface_registry/input_ring.rs                  the input_post_first bench marker
  src/syscall/dispatch/router/input_ops.rs                        the input_drain_first bench marker
  src/hardware/ps2_kbd_capsule/client/transport.rs                the kernel-side reply inbox binding
```

Every reference above is verified against those trees.
