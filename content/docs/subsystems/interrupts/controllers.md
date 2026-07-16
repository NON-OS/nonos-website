---
title: "Interrupt Controllers"
description: "Between a device line and the CPU vector sits an interrupt controller."
weight: 4
---
Between a device line and the CPU vector sits an interrupt controller. NØNOS supports two: the
legacy 8259 PIC, which it remaps out of the way of the CPU exception vectors, and the local
APIC, which is the preferred controller once it is up. This page documents both and the gate
that decides which one an acknowledgement goes to. The code is under `src/interrupts/pic/` and
`src/interrupts/apic/`.

## The 8259 PIC

The PIC delivers its lines starting at vector 8 by default, which collides with the CPU
exception vectors, so the first thing the kernel does is remap it. `pic::init`
([`src/interrupts/pic/init.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/pic/init.rs#L25)) runs the 8259 four-word initialization sequence on the
master and slave pair:

```
  save the current interrupt masks
  ICW1: begin init, expect ICW4          (master and slave)
  ICW2: master vector offset 0x20 (32)   slave offset 0x28 (40)
  ICW3: cascade wiring (slave on line 2)
  ICW4: 8086 mode
  restore the saved masks
```

After this the master's eight lines land on vectors 32 to 39 and the slave's on 40 to 47,
which is the legacy IRQ range the [IDT](/docs/subsystems/interrupts/idt/) reserves; timer IRQ 0 becomes vector 32,
keyboard IRQ 1 becomes vector 33. The remap preserves the masks that were in place rather than
unmasking everything, and the module exposes `mask_irq` / `unmask_irq` and `mask_all` for
line-level control, and `send_eoi` to acknowledge a line.

## The local APIC

The local APIC is the modern per-CPU controller, and the interrupts module's APIC surface is a
thin façade over the system APIC driver: `apic::init` delegates to `sys::apic::init`
([`src/interrupts/apic/init.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/apic/init.rs#L17)), `apic::send_eoi` to `sys::apic::eoi`, and `apic::is_enabled`
reports whether the APIC came up. The APIC is where the [SMP](/docs/subsystems/smp/tlb-shootdown/)
inter-processor interrupts and the LAPIC timer live; this module consumes it for the
end-of-interrupt path and leaves the bring-up to the driver.

## Choosing the controller

Every handler's acknowledgement goes through the same gate:

```
  if apic::is_enabled():  apic::send_eoi()
  else:                   pic::send_eoi(irq_line)
```

The kernel prefers the APIC and falls back to the PIC only when the APIC is not enabled. This
is the single decision that keeps the two controllers from disagreeing: an interrupt is
acknowledged to exactly one of them, chosen by whether the APIC is live, so a line is never
double-acknowledged or left hanging. In the normal boot the APIC comes up early and the PIC,
having been remapped to safe vectors, sits masked as a fallback rather than a participant.

## Security analysis

The controllers sit below the vector layer, so their security role is narrow but real: keep the
exception vectors clear, keep acknowledgement single-owner, and keep line programming out of userspace.
Three properties.

**The remap clears the exception range.** The PIC delivers on vectors 8 to 15 by default, which overlaps
the CPU exception vectors, so an unmapped PIC would let a spurious hardware line masquerade as a double
fault or a general protection fault. `pic::init` remaps the master to 32 and the slave to 40
([`pic/init.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pic/init.rs#L25)) before interrupts are ever enabled, so a hardware line can never land on an exception
vector. The remap also preserves the masks that were in place rather than unmasking everything, so
bring-up does not open lines the kernel is not ready to service.

**Acknowledgement goes to exactly one controller.** Every handler routes its EOI through the same gate:
`apic::send_eoi()` when `apic::is_enabled()`, else `pic::send_eoi(irq_line)`. Because the choice is made
by one predicate, a line is acknowledged to the live controller and only that one, so it is never
double-acknowledged or left hanging. In a normal boot the APIC comes up early and the remapped PIC sits
masked as a fallback, not a participant, which is why the two never disagree about whether a line was
serviced.

**Line programming is kernel-only.** The PIC mask registers and the IO-APIC redirection table are
touched only from these kernel modules and from the [broker IRQ](/docs/subsystems/hardware-broker/irq/) bind path; a
capsule reaches neither. The [MMIO](/docs/subsystems/hardware-broker/mmio/) grant path withholds the MSI-X table and
the broker owns the IO-APIC, so a driver capsule can ask for an interrupt but can never mask another
device's line, redirect a GSI, or change a destination. The honest boundary is that these façades are
thin: the APIC surface here is `init`, `eoi`, and `is_enabled` only, and the real bring-up, the LAPIC
destination programming, and x2APIC mode live in the [system APIC driver](/docs/subsystems/smp/tlb-shootdown/), so a
routing bug is almost always in that driver rather than in this end-of-interrupt façade.

## Debugging the controllers

Controller-level bugs are quiet, because a mis-routed or mis-acknowledged line does not fault, it just
fails to arrive or fails to arrive again. Two shapes cover almost all of it.

**A line fires once and then never again.** That is a missing or misdirected EOI. If a handler returns
without acknowledging, the controller holds the in-service bit and delivers nothing further on that line.
The check is that the handler's tail reached the EOI gate and that `apic::is_enabled()` reports the
controller the line actually came from; an APIC-delivered interrupt acknowledged to the PIC (or the
reverse) leaves the real controller un-cleared. A spurious vector on `0xFF` (`VECTOR_APIC_SPURIOUS`) is
the LAPIC's own signal that a line was withdrawn before it was serviced and is expected occasionally, not
a bug.

**A line is bound but silent.** This is the hard one and it only shows on real hardware. The broker
`MkIrqBind` succeeded, the grant is valid, but the interrupt never reaches the handler. The usual cause
is the IO-APIC destination. INTx bind reads `dest_apic_id = apic::id()`
([`src/hardware/broker/irq/bind.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/irq/bind.rs#L80)) and hands it to `program_route_external`
([`src/arch/x86_64/interrupt/ioapic/ops_route.rs:94`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/interrupt/ioapic/ops_route.rs#L94)), which builds `Rte::fixed(vector, dest_apic_id)` and
writes the destination into the top byte of the redirection entry's high dword
(`ops_route.rs:51`). The subtlety is that `apic::id()` returns the running CPU's real LAPIC id read from
`LAPIC_ID >> 24` (`ops_core.rs:22`), which is *not always 0*:
on real hardware the boot CPU's APIC id can be non-zero, so any code that hardcoded destination 0 would
route the line to a core that never services it and the interrupt would vanish with no error. The
diagnosis is to compare the destination field actually written into the redirection entry against the
APIC id of the CPU running the driver's wait loop; if they differ, the line is being delivered to a core
that is not listening. `ioapic_set_irq` does print `"[APIC] ERROR: GSI outside primary IOAPIC range"` when
the GSI falls outside the IO-APIC's pin range, which catches a bad GSI, but a wrong-but-in-range
destination is silent by nature. This is the controller-side view of the "claimed the device and bound
the IRQ but no events arrive" failure documented from the grant side on the
[broker IRQ](/docs/subsystems/hardware-broker/irq/) page.

## Source map

```
  src/interrupts/pic/init.rs           the 8259 remap sequence
  src/interrupts/pic/mask.rs           per-line and global masking
  src/interrupts/pic/eoi.rs            the PIC end-of-interrupt
  src/interrupts/apic/                 the façade over sys::apic (init, eoi, is_enabled)
  src/arch/x86_64/interrupt/ioapic/ops_route.rs  program_route_external, the redirection-entry destination
  src/arch/x86_64/interrupt/apic/ops_core.rs     apic::id(), the running LAPIC id
```

Every reference above is verified against those trees. The vectors these controllers deliver on are on
the [IDT](/docs/subsystems/interrupts/idt/) page, the EOI gate lives at the tail of every [handler](/docs/subsystems/interrupts/handlers/), the LAPIC
bring-up and IPIs are on the [SMP](/docs/subsystems/smp/tlb-shootdown/) page, and the bind path that programs the
IO-APIC destination is on the [broker IRQ](/docs/subsystems/hardware-broker/irq/) page.
