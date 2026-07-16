---
title: "Interrupts"
description: "How the CPU enters the kernel on a trap, and how the kernel gets back out."
weight: 11
---
How the CPU enters the kernel on a trap, and how the kernel gets back out. Every exception,
IRQ, and syscall gate is one entry in the interrupt descriptor table; the user-reachable
entries run through naked assembly trampolines that switch the per-CPU base and, for the timer,
snapshot the preempted capsule; the Rust handlers decide recovery; and two controllers deliver
and acknowledge the lines.

| Page | What it covers |
|------|----------------|
| [idt.md](/docs/subsystems/interrupts/idt/) | The vector map, `build_idt`, gate and IST assignment, the ring-3 syscall gate, and the naked-trampoline vs `x86-interrupt`-wrapper split. |
| [trampolines.md](/docs/subsystems/interrupts/trampolines/) | The `swapgs`-on-CPL3 pattern, the `fxsave` SIMD preservation, and the timer trampoline that captures the preempted capsule's `UserContext` for preemption. |
| [handlers.md](/docs/subsystems/interrupts/handlers/) | The page-fault demand/guard/terminate-vs-panic path, the double-fault halt, the IRQ handlers, and the shared interrupt-context and end-of-interrupt. |
| [controllers.md](/docs/subsystems/interrupts/controllers/) | The 8259 PIC remap to vectors 32-47, the local APIC façade, and the gate that acknowledges an interrupt to exactly one live controller. |
| [allocation.md](/docs/subsystems/interrupts/allocation/) | The runtime vector pool, the reserved-and-handler registry, the fixed reservations, and `allocate_vector` / `free_vector`. |
| [safety.md](/docs/subsystems/interrupts/safety/) | The RAII interrupt guard that restores prior state, and the per-CPU interrupt-context nesting depth read through `gs:8`. |

The property that runs through the section is that entry from ring 3 is never trusted to leave
the CPU in a safe state: the trampoline switches the GS base before any handler reads per-CPU
memory, the fatal exceptions run on dedicated stacks so a fault in a fragile window lands on
known-good memory, and the timer path captures enough state to resume a capsule exactly where
it was preempted. That last piece is the hinge of preemptive multitasking and is picked up by
the [scheduler](/docs/subsystems/scheduler/preemption/) and the [context switch](/docs/subsystems/process/context-switch/).

## Security analysis

The interrupt subsystem is the boundary the CPU crosses on every trap, so its security posture is the sum
of what the individual pages prove. Three properties hold across the whole section.

**Only one gate is reachable from ring 3.** The [IDT](/docs/subsystems/interrupts/idt/) sets every descriptor at ring 0 except the
syscall gate at `0x80`, so a capsule cannot software-invoke an arbitrary vector to reach a handler, and
it cannot install or redirect a vector because the table is immutable after build. A driver that wants a
device interrupt goes through the [broker](/docs/subsystems/hardware-broker/irq/), which programs the controller and
installs only into pre-reserved broker vector slots; the capsule programs nothing.

**Entry from ring 3 is never trusted to leave the CPU in a safe state.** The [trampolines](/docs/subsystems/interrupts/trampolines/)
swap to the kernel GS base before any handler reads per-CPU memory, preserve the interrupted FPU and SSE
state, and discard the CPU error-code word exactly where the vector calls for it. The fatal exceptions
run on dedicated IST stacks so a fault taken in a fragile window lands on known-good memory rather than a
torn stack.

**Faults fail closed and leave a redacted record.** The [handlers](/docs/subsystems/interrupts/handlers/) terminate a faulting
capsule and halt on an unrecoverable kernel fault, never patch around either, and every logged pointer
passes through `redact_address` so a fault log is not a KASLR oracle. Acknowledgement goes to exactly one
live [controller](/docs/subsystems/interrupts/controllers/), so a line is never double-acked or left hanging. The honest boundary
running through all of it is that the trampolines and the swapgs discipline are hand-maintained trusted
code: the hardware does not check that they swapped or saved correctly, so the safety of everything above
them is conditional on that entry code being right.

## Debugging interrupts

The console (serial, or the framebuffer on a `NONOS_FBCONSOLE=1` build) is the whole debugging surface,
and the fault vector picks the page. An unhandled exception prints the low-level `[TRAP …]` line from
`dump_trap` and then a structured critical log; the [handlers](/docs/subsystems/interrupts/handlers/) page decodes both, including
the three plain-language page-fault causes and the double-fault halt banner. A "bound but silent"
interrupt, where the [broker](/docs/subsystems/hardware-broker/irq/) bind succeeded but nothing arrives, is a
[controller](/docs/subsystems/interrupts/controllers/) routing problem, most often an IO-APIC destination aimed at a LAPIC id that
is not the running CPU (the boot CPU's APIC id is not always 0). A frozen scheduler with no ticks is an
interrupts-stuck-off critical section on the [safety](/docs/subsystems/interrupts/safety/) page, and a machine that wedges on the
first trap from ring 3 with no `[TRAP …]` line at all is a [trampoline](/docs/subsystems/interrupts/trampolines/) swapgs bug that
kills the trap machinery before it can report itself. Two failure returns from the vector pool,
`None` and the two `free_vector` strings, are covered on the [allocation](/docs/subsystems/interrupts/allocation/) page.

## Sources

The code for this subsystem lives under `src/interrupts/`: `idt/` (the table and vector map),
`isr/` (the naked trampolines and wrappers), `handlers/` (the exception and IRQ bodies),
`pic/` and `apic/` (the controllers), `allocation/` (the vector pool), `safety/` (the guard
and interrupt context), and `stats/` (the counters). The IST slots come from the
[GDT](/docs/subsystems/smp/), and the broker IRQ entries from `src/arch/x86_64/interrupt/broker`.
Every page is verified against those trees with `file:line` references.
