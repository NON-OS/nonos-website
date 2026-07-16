---
title: "Input"
description: "How a keystroke or a pointer motion reaches an application."
weight: 12
---
How a keystroke or a pointer motion reaches an application. NØNOS keeps input in one place in the
kernel, a bounded ring, and moves the policy of routing events to windows out into a capsule.
Driver capsules post events into the ring, the kernel wakes a single router capsule, and the router
fans each event out to the consumer that owns the focus.

| Page | What it covers |
|------|----------------|
| [ring.md](/docs/subsystems/input/ring/) | The bounded MPSC ring, drop-on-full with a counter, the monotonic sequence number, and the single-waiter wakeup. |
| [path.md](/docs/subsystems/input/path/) | The `InputEvent` record, the `MkInputEventPost` / `Drain` / `Wait` syscalls, and the driver-to-router-to-consumer path. |
| [drivers.md](/docs/subsystems/input/drivers/) | The four input driver capsules (PS/2, i2c-PCI, i2c-HID, USB-HID), the claim / grant / IRQ / read / post model each follows, and how real hardware splits input across all of them at once. |

The shape to keep in mind is that the kernel does the least it can: it holds a 1024-entry ring,
counts drops rather than blocking a producer, publishes a sequence number so the consumer can wait
on an edge, and wakes exactly one router capsule. Everything above that, which window has focus,
how a scancode becomes a character, how events are delivered to a shell or a GUI, is a capsule's
job, reached over [IPC](/docs/subsystems/ipc/). This mirrors the [hardware broker](/docs/subsystems/hardware-broker/):
the kernel owns the minimal shared mechanism, capsules own the policy.

## Sources

The ring is [`src/kernel_core/surface_registry/input_ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs) with its types in the same directory;
the syscalls are [`src/syscall/dispatch/router/input_ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs); and the router capsule is
`src/userspace/capsule_input_router/`. Driver capsules that post live under `src/hardware/` and
`src/userspace/`. Every page is verified against those trees with `file:line` references.
