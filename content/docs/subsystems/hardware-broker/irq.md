---
title: "IRQ Grants"
description: "A driver capsule does not handle interrupts in ring 0."
weight: 5
---
A driver capsule does not handle interrupts in ring 0. Instead it binds its device's interrupt
through the broker, which programs the interrupt controller to deliver on a kernel-owned vector,
and then the capsule waits for and acknowledges interrupts through syscalls. The capsule never
touches the controller or the MSI-X table directly. This page documents `MkIrqBind` and its
companions across the three architectures. The code is under `src/hardware/broker/irq/`.

## The two bind modes

On x86 a bind is either legacy INTx or MSI-X, and both start from the same claim and epoch check
([`src/hardware/broker/irq/bind.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/irq/bind.rs#L52)):

```
  bind(pid, req):
      claim = lookup(device_id); verify pid and epoch
      if req.flags & BIND_MSIX:  bind_msix(...)
      else:                      bind_intx(...)
```

**INTx** (`bind.rs:68`) validates the request against the device's interrupt pin and line,
allocates a broker vector slot, programs the IO-APIC to route the device's GSI to that vector on
the current LAPIC, masks the line, and records a single `Intx` grant. A GSI that is already
bound is refused with `AlreadyBound`, and if the IO-APIC program fails the just-allocated slot is
freed before returning, so no error path leaks a vector.

**MSI-X** (`bind.rs:105`) is the modern path. The kernel walks the device's MSI-X capability,
validates the table and PBA BARs against the claimed device, allocates `vector_count` contiguous
broker vectors, programs that many MSI-X table entries with the LAPIC redirect, enables MSI-X,
and unmasks each entry, recording one grant per vector. The defining property is stated in the
module doc: *the capsule never sees the table address and never writes to it; it only receives
the base grant id and base vector*. All hardware-touching steps go through a `MsixOps`
indirection so the path is testable, and the vectors are allocated contiguously so a failure
frees the whole run.

## Validation order

The MSI-X validator ([`irq/validate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/validate.rs)) returns errors in a fixed priority so a capsule gets a
deterministic reason for a malformed request: unknown flags, then bad vector count (zero, larger
than the broker pool, or larger than the device's table), then no device handle, then no MSI-X
capability, then a bad table or PBA BAR, then a non-zero `irq_source` (MSI-X requires it be
zero), then already-bound (MSI-X bind is all-or-nothing per device per pid). The validators are
pure functions over plain inputs, no globals and no MMIO, run after the bind path has looked up
the kernel-side state.

## Waiting, polling, acknowledging

Once bound, a capsule receives interrupts through three operations ([`irq/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/mod.rs)): `wait_arm` and
`wait_disarm` register interest so the capsule can block until its interrupt fires, `poll`
reports pending interrupts without blocking, and `ack_grant` acknowledges one so the next can be
delivered. The kernel-side interrupt entry for a broker vector was installed in the
[IDT](/docs/subsystems/interrupts/idt/) from `arch::interrupt::broker`; when it fires, the dispatch path
([`irq/dispatch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/dispatch.rs)) records the pending interrupt against the grant and wakes a waiting capsule.
The capsule's handler thus runs in ring 3, driven by syscalls, never in an interrupt context.

## Multiple architectures

IRQ is the one grant class whose backend is genuinely architecture-specific, and the module
selects it by `target_arch` ([`irq/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/mod.rs#L22)):

```
  x86_64    IO-APIC redirection (INTx) + PCI MSI-X
  aarch64   GICv3 SPIs
  riscv64   PLIC external sources
```

The bind, poll, wait, ack, and release surface is the same across all three; only the controller
programming underneath differs. The shared request and grant types live in [`irq/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/types.rs), and
each backend implements the same operations against its platform's controller. Revocation,
`ack_grant`, `release_for_device`, and `release_all_for_pid`, unbinds the vector and, for MSI-X,
tears the table entry down; see [revocation](/docs/subsystems/hardware-broker/revocation/).

## Security analysis

An interrupt is a direct line into the kernel, so a userspace driver model is most dangerous here, and
it is made safe by one rule: the capsule programs nothing. Every controller write, the IO-APIC
redirection entry, the MSI-X table entries, the vector allocation, is done by the kernel; the capsule
receives only a grant id and a base vector and drives interrupts through `wait`, `poll`, and `ack`. Four
properties follow.

**No vector programming.** The capsule never sees or writes the MSI-X table: the [MMIO](/docs/subsystems/hardware-broker/mmio/) clamp
withholds those pages and the IRQ path programs them. So a compromised driver cannot redirect its
interrupt to another vector, aim it at another CPU, or point it at a vector another capsule owns; it
cannot manufacture an interrupt aimed at a victim.

**One device, one binding.** A GSI or device already bound is refused with `AlreadyBound`, so a capsule
cannot steal the interrupt line of a device it does not hold, and an MSI-X bind is all-or-nothing per
device per pid.

**Handler in ring 3.** When a broker vector fires, the kernel entry records the pending interrupt against
the grant and wakes the capsule; the handling runs in ring 3, driven by syscalls, never in interrupt
context. A buggy or slow driver handler cannot corrupt kernel interrupt state or hold off other
interrupts, because it does not run at interrupt priority.

**No leaked vectors.** Every failure path frees what it allocated: a failed IO-APIC program frees the
vector slot, a failed MSI-X run frees the whole contiguous allocation, and exit revocation unbinds every
vector a pid held. Combined with the MMIO MSI-X clamp, the split is complete: the driver drives the
device, the kernel owns the vectors.

## Debugging interrupts

Interrupt failures come in two shapes, diagnosed very differently.

**The bind is refused.** `MkIrqBind` returns one `IrqBindError` ([`irq/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/types.rs)), each a specific cause:

```
  NotClaimed / StaleEpoch      the pid does not hold a current claim on the device
  NotDeviceIrq                 the device has no interrupt pin/line to bind
  AlreadyBound                 the GSI or device is already bound (by this or another pid)
  NoVector                     the broker vector pool is exhausted
  NotIntx / NoMsixCap          the flags asked for a mode the device does not have
  BadMsixBar / BadVectorCount  a malformed MSI-X request (bad table BAR, zero or over-large count)
  MsixProgramFailed            the controller write itself failed
```

**The bind succeeds but the interrupt never fires.** This is the hard one, and it only appears on real
hardware. The grant is valid, `poll` reports nothing, and the driver waits forever. It is not a broker
bug; it is a device or routing state the bind cannot see. The usual causes: on x86 INTx, the IO-APIC
redirection entry routes the GSI to a LAPIC destination that is not the CPU actually running (the boot
CPU's APIC id is not always 0, and a redirect delivered to destination 0 lands on a core that never
services it); the device's PCI command register has bus-master or INTx disabled, so it never asserts the
line; an MSI-X device whose global enable bit was never set; or a line left masked. The tool is `poll`:
if `poll` shows the interrupt pending but `wait` never returned, the wakeup path is at fault; if `poll`
never shows it pending, the interrupt is not reaching the vector and the fault is in the controller
routing or the device's own enable bits, which the driver inspects through its [MMIO](/docs/subsystems/hardware-broker/mmio/) register
window and its PCI config. This is exactly the shape of "the driver claimed the device and bound the IRQ
but no events arrive" on a laptop, where an i2c or xHCI interrupt routes to a destination the running CPU
is not listening on.

## Source map

```
  src/hardware/broker/irq/mod.rs        arch backend selection and the public surface
  src/hardware/broker/irq/bind.rs       INTx and MSI-X bind (x86)
  src/hardware/broker/irq/validate.rs   the pure MSI-X validators and error order
  src/hardware/broker/irq/types.rs      the request/grant types and the IrqBindError variants
  src/hardware/broker/irq/dispatch.rs   interrupt delivery to the waiting capsule
  src/hardware/broker/irq/aarch64/      GICv3 backend
  src/hardware/broker/irq/riscv64/      PLIC backend
```

Every reference above is verified against those trees. The kernel-side vector entry is on the
[IDT](/docs/subsystems/interrupts/idt/) page, the MSI-X table pages this path keeps out of the capsule are on the
[MMIO](/docs/subsystems/hardware-broker/mmio/) page, and the exit revocation wiring is on the [revocation](/docs/subsystems/hardware-broker/revocation/) page.
