---
title: "Interrupt Safety"
description: "Two small mechanisms keep interrupt handling from tripping over itself: an RAII guard that disables interrupts for a critical section and restores the prior state exactly, and a..."
weight: 6
---
Two small mechanisms keep interrupt handling from tripping over itself: an RAII guard that
disables interrupts for a critical section and restores the prior state exactly, and a per-CPU
record of whether the CPU is currently inside an interrupt handler. This page documents both.
The code is under `src/interrupts/safety/`.

## The interrupt guard

`InterruptGuard` ([`src/interrupts/safety/guard.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/safety/guard.rs#L20)) is a scoped critical section. On
creation it reads the current interrupt-enable flag, disables interrupts if they were enabled,
and remembers what it found; on drop it re-enables them only if they had been enabled:

```
  InterruptGuard::new():
      was_enabled = interrupts_enabled()      // read IF from RFLAGS
      if was_enabled: cli
  Drop:
      if was_enabled: sti
```

Restoring the prior state rather than unconditionally enabling is what makes the guard safe to
nest: a guard taken inside another guard's section finds interrupts already disabled, records
that, and leaves them disabled on drop, so the outer section is not cut short. The flag is read
straight from `RFLAGS` with `pushfq`, and the enable and disable are `sti` and `cli`; the guard
restores state even on an unwinding path because it lives in `Drop`.

## Interrupt context

Separately, each handler records that its CPU is in interrupt context. `set_interrupt_context`
([`src/interrupts/safety/context.rs:74`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/safety/context.rs#L74)) returns a guard that bumps a per-CPU nesting depth and
sets a per-CPU in-interrupt flag; the guard's `Drop` decrements the depth and clears the flag
only when the outermost handler exits:

```
  set_interrupt_context():
      depth[cpu] += 1
      in_interrupt[cpu] = true
      -> InterruptContext { cpu }
  Drop:
      if depth[cpu] drops to 0:  in_interrupt[cpu] = false
```

`in_interrupt_context()` lets code elsewhere ask whether it is running inside a handler, which
matters for choosing between a path that may sleep and one that must not. The state is
per-CPU, indexed by a CPU id read from the per-CPU data block at `gs:8` (the `cpu_id` field
sits just past the self-pointer at offset 0); the read requires the kernel GS base to be
loaded, which is exactly what the [trampolines](/docs/subsystems/interrupts/trampolines/) guarantee before any Rust
handler runs. The depth counter, rather than a bare boolean, is what makes the flag correct
under nesting: a higher-priority interrupt taken inside a handler increments the depth, and the
flag stays set until the last one unwinds.

## Security analysis

These two mechanisms are internal correctness aids, not privilege boundaries, but their correctness is
what keeps kernel critical sections from being cut short and keeps sleep-in-atomic bugs out of interrupt
context. Three properties.

**The guard restores, it does not force.** `InterruptGuard` remembers whether interrupts were enabled at
entry and only re-enables on drop if they were (`guard.rs:36`), reading the flag straight from `RFLAGS`
with `pushfq`. That is what makes it safe to nest: a guard taken inside another guard's section finds
interrupts already off, records that, and leaves them off on drop, so the outer section is never
truncated. Because the restore lives in `Drop`, it holds on an early return or an unwinding path, so a
critical section cannot leak interrupts-disabled state to the code that follows it.

**The depth counter, not a boolean, tracks nesting.** `set_interrupt_context` bumps a per-CPU
`INTERRUPT_DEPTH` and sets the `IN_INTERRUPT` flag; the guard's `Drop` clears the flag only when the
depth returns to zero (`context.rs:63`). A higher-priority interrupt taken inside a handler increments
the depth and the flag stays set until the last one unwinds, so `in_interrupt_context()` stays honest
under nesting. That flag is the thing that lets code elsewhere refuse to sleep on a path that must not,
so a false negative there would be a real bug, which is why it is a counter and not a bare bool.

**The per-CPU read depends on a loaded kernel GS.** The CPU id comes from `gs:8`
(`context.rs:41`), the `cpu_id` field just past the self-pointer at offset 0 in the per-CPU block. The
read is only correct once the kernel GS base is loaded, which is exactly the guarantee the
[trampolines](/docs/subsystems/interrupts/trampolines/) provide before any Rust handler runs. The honest boundary is that this is a
hard dependency, not a checked one: if a handler ran before the swapgs, `gs:8` would read the user GS
base and index the wrong CPU's counters. The `% MAX_CPUS` on the read keeps a garbage id from indexing
out of bounds, but it cannot make a wrong id right, so the safety of this whole module is conditional on
the trampoline discipline above it. Neither mechanism is reachable from ring 3; both are kernel-internal.

## Debugging interrupt safety

Bugs here are timing bugs and they rarely print, so they are diagnosed by their shape rather than by a
message.

**Interrupts stuck off.** If a critical section leaves interrupts disabled after it should have restored
them, the symptom is a dead CPU: no timer ticks, no preemption, the scheduler frozen. The cause is
almost always a guard that was `mem::forget`-ed or a manual `cli` without a matching `sti`, not
`InterruptGuard` itself, since the guard restores in `Drop`. The check is whether the `RFLAGS` IF bit is
set where it should be; a guard whose `was_enabled` captured the wrong prior state (for instance taken
with interrupts already off and expected to enable them) will correctly leave them off, which looks like
a hang but is the guard doing exactly what it promised.

**A stuck in-interrupt flag.** If `in_interrupt_context()` reports true outside any handler, an
`InterruptContext` was leaked (dropped depth never reached zero), and code that consults the flag to pick
a non-sleeping path will keep choosing it forever. Because the flag is per-CPU and indexed by `gs:8`, a
flag that is wrong on one core but right on others points at that core's GS base being wrong when
`set_interrupt_context` ran, which loops back to the trampoline: a handler that read `gs:8` before its
swapgs would bump the wrong CPU's depth. So a per-CPU-asymmetric interrupt-context bug is a trampoline or
GS-base bug seen through this counter, and the fix is on the [trampolines](/docs/subsystems/interrupts/trampolines/) page, not
here.

## Source map

```
  src/interrupts/safety/guard.rs     InterruptGuard, the cli/sti critical section
  src/interrupts/safety/context.rs   per-CPU interrupt-context depth and flag, cpu_id via gs:8
```

Every reference above is verified against those trees. The kernel GS base this module's `gs:8` read
depends on is established by the [trampolines](/docs/subsystems/interrupts/trampolines/), the handlers that take an interrupt
context at entry are on the [handlers](/docs/subsystems/interrupts/handlers/) page, and the per-CPU block layout comes from the
[SMP](/docs/subsystems/smp/) setup.
