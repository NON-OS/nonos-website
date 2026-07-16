---
title: "The Interrupt Descriptor Table"
description: "Every trap the CPU can take, a divide error, a page fault, a timer tick, a syscall, enters the kernel through one entry in the interrupt descriptor table."
weight: 1
---
Every trap the CPU can take, a divide error, a page fault, a timer tick, a syscall, enters
the kernel through one entry in the interrupt descriptor table. This page documents the
vector layout, how the table is built, the gate and stack assignments, and how it is loaded.
The code is under `src/interrupts/idt/`.

## The vector map

The 256 vectors are partitioned into fixed ranges ([`src/interrupts/idt/vectors.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/idt/vectors.rs)):

```
  0  .. 31    CPU exceptions        (divide error 0, page fault 14, double fault 8, ...)
  32 .. 47    legacy IRQ range      (irq_to_vector(n) = 32 + n)
  48 .. 0xEF  user-allocatable      (the dynamic vector pool)
  0x80        syscall gate          (the int 0x80 legacy path)
  0xFA .. 0xFF LAPIC vectors        (LINT1, LINT0, perf, thermal, error, spurious)
```

The named IRQ vectors sit in the legacy range: timer at 32, keyboard at 33, cascade at 34,
mouse at 44. `is_exception`, `is_irq`, and `is_user_allocatable` are the range predicates,
and `irq_to_vector` / `vector_to_irq` convert between an IRQ line and its vector. Two
classification tables travel with the map: `exception_has_error_code`, which marks the eight
exceptions the CPU pushes an error code for (double fault, invalid TSS, segment-not-present,
stack-segment, general protection, page fault, alignment check, control protection), and
`exception_is_fatal`, which marks the ones the kernel does not attempt to recover from.

## Building the table

The IDT is a single lazily-built global ([`src/interrupts/idt/table.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/idt/table.rs#L25)), constructed once
in `build_idt` in three passes:

```
  build_idt():
      configure_exceptions(idt)     vectors 0..31
      configure_irqs(idt)           timer, keyboard, mouse, broker IRQs
      configure_syscall(idt)        vector 0x80, DPL = ring 3
```

`configure_syscall` is the one entry deliberately reachable from user mode: it sets the
descriptor privilege level to ring 3 so a capsule can issue the legacy `int 0x80`, whereas
every other gate is ring 0 and a user attempt to invoke it faults. `configure_irqs` also
installs the hardware-broker IRQ entries, the vectors a claimed device's line is routed to,
from `arch::interrupt::broker` (`table.rs:162`).

## Gates and stacks

An entry is an interrupt gate or a trap gate ([`idt/entry.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/idt/entry.rs#L21)), the difference being
whether the CPU clears the interrupt flag on entry; `EntryOptions` carries the gate type, the
privilege level, the present bit, and an optional IST index, and `validate_ist_index` bounds
the index to 0 through 6 while `validate_handler_address` rejects a null handler.

Six exceptions run on dedicated interrupt-stack-table stacks rather than the interrupted
stack, so a fault taken in a fragile window lands on known-good memory:

```
  #DB debug           DEBUG_IST     a #DB in the kernel-entry window
  NMI                 NMI_IST       nested NMIs
  #DF double fault    DF_IST        recover from a stack overflow
  #GP general prot.   GP_IST        a CPL=3 #GP cannot land on a torn TSS.RSP0
  #PF page fault      PF_IST        guard-page handling
  #MC machine check   MC_IST        critical hardware errors
```

The IST constants come from the [GDT](/docs/subsystems/smp/) and are one-based hardware slots,
while the `x86_64` crate's `set_stack_index` is zero-based and adds one internally, which is
why each assignment subtracts one (`table.rs:54`). That off-by-one is deliberate and load
bearing: getting it wrong points an exception at the adjacent stack.

## The trampoline split

Not every exception is installed as a plain handler. The CPL=3-reachable exceptions, divide
error, debug, breakpoint, overflow, bound-range, invalid-opcode, stack-segment, general
protection, page fault, alignment check, and SIMD, are installed as naked assembly
trampolines by address (`set_handler_addr`), while the rest use the compiler's
`extern "x86-interrupt"` wrappers. The reason is `swapgs`: a handler that reads per-CPU state
through `gs` must run on the kernel GS base, and an exception entered directly from user mode
arrives on the user GS base. The [trampolines](/docs/subsystems/interrupts/trampolines/) page covers that mechanism;
the table just points the user-reachable vectors at them.

## Loading

`load` ([`idt/load.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/idt/load.rs#L23)) calls `IDT.load()` and records a loaded flag; the module also
re-exports the `enable_interrupts`, `disable_interrupts`, `without_interrupts`, and
`halt_loop` primitives the rest of the kernel uses to control the interrupt flag. The table
itself is immutable after construction, so loading it on each CPU installs the same vetted
set of gates.

## Security analysis

The IDT is the entire attack surface between ring 3 and ring 0: it names every way the CPU can enter
the kernel, and it is the first thing a capsule would want to bend if it could. It cannot, and four
properties draw that line.

**One user-reachable gate, and it is the syscall gate.** `build_idt` sets every descriptor at ring 0
except one. `configure_syscall` (`table.rs:171`) is the sole call to `set_privilege_level(Ring3)`, on
vector `0x80`. Every other gate keeps the default ring-0 DPL, so a capsule that executes `int 3`,
`int 14`, or any vector other than `0x80` takes a general protection fault rather than invoking the
handler, because the CPU checks the gate DPL against the caller's CPL. The exceptions the CPU itself
raises still deliver, but a capsule cannot *software-invoke* an arbitrary vector to reach a handler it
should not.

**The table is immutable after build.** `IDT` is a `lazy_static` built once (`table.rs:25`) and never
mutated; `load` (`load.rs`) only re-points the IDTR at that same vetted table on each CPU. There is no
runtime path a capsule can reach to install, replace, or redirect a vector. A driver that wants an
interrupt does not touch the IDT at all: it binds through the broker, and the broker installs only into
the pre-reserved broker vector slots (`install_broker_irq_entries`, `table.rs:162`), which point at
fixed `extern "x86-interrupt"` entries in kernel text. This is the in-kernel half of the guarantee the
[broker IRQ](/docs/subsystems/hardware-broker/irq/) page makes from the capsule side: the capsule programs nothing,
and there is nothing in the IDT for it to program.

**The fragile faults run on private stacks.** Six exceptions carry an IST index (`table.rs`), so the CPU
switches to a dedicated stack before pushing the trap frame. The point is isolation of the cases where
the interrupted stack cannot be trusted: `#DF` recovers from a stack overflow that has already made the
normal stack unusable, `#GP` on a ring-3 entry must not land on a `TSS.RSP0` that is being torn during a
context switch, `#PF` needs a known-good stack to run guard-page handling, and `#DB`, `NMI`, and `#MC`
each have their own reentrancy or timing hazard. The IST assignment subtracts one from the GDT constant
because `set_stack_index` is zero-based over one-based hardware slots (`table.rs:54`), and getting that
off-by-one wrong would silently aim a fatal fault at the neighbouring stack, so it is called out in the
handler's own safety comment.

**swapgs before any per-CPU read.** The user-reachable exceptions are installed by address as naked
trampolines rather than as compiler wrappers precisely so the kernel GS base is loaded before a handler
dereferences `gs`-relative state. An exception from ring 3 arrives on the user GS base, and a handler
that read the per-CPU block first would fault on its own access and storm; the [trampolines](/docs/subsystems/interrupts/trampolines/)
close that window. The honest boundary is that this is a discipline enforced by hand-written entry code,
not by the hardware: the correctness of every gs read downstream rests on the trampoline having swapped
first, which is why the trampoline split, not the handler body, is the security-relevant part of the
table.

## Debugging the IDT

Two failure shapes show up here, and they look nothing alike.

**A vector faults instead of running.** If a capsule (or kernel code) invokes a vector it may not, the
CPU raises `#GP`, and the general-protection trampoline dumps a line on the serial console (or the
framebuffer on a `NONOS_FBCONSOLE=1` build) through `dump_trap`:

```
  [TRAP GP] cpl=3 rip=… rsp=… cs=… ss=… rflags=… cr3=… asid=… pid=… err=…
```

The `cpl=3` says the fault came from user mode and the `err=` carries the selector index of whatever the
CPU refused, so a capsule that tried to `int` a ring-0 gate is diagnosed directly from the trap line
rather than from a mysterious hang. A `#GP` at `cpl=0` with a vector-shaped error code instead points at
a mis-built gate: a null handler (caught early by `validate_handler_address`) or an IST index out of the
zero-to-six range (`validate_ist_index`, which returns `"IST index must be 0-6"`).

**A vector runs on the wrong stack.** The IST off-by-one is the classic silent IDT bug. If an assignment
used the raw GDT constant without the `- 1`, the fault would deliver onto the adjacent IST slot, and the
symptom is not a clean panic but a corrupted trap frame or a nested fault when the fatal handler itself
runs on memory another handler owns. The tell is a double fault whose `[TRAP` line and
`dump_stack_info` report a stack pointer inside the wrong IST region; the fix is in `table.rs`, not in the
handler. Because the table is immutable, an IDT-level bug is always a build-time bug, so the first check
is always `build_idt` and its three configure passes, never a runtime mutation.

## Source map

```
  src/interrupts/idt/vectors.rs   the vector map and classification tables
  src/interrupts/idt/table.rs     build_idt, gate and IST assignment, the trampoline split
  src/interrupts/idt/entry.rs     GateType, EntryOptions, the validators
  src/interrupts/idt/load.rs      load and the interrupt-flag primitives
```

Every reference above is verified against those trees. The naked entry code the user-reachable vectors
point at is on the [trampolines](/docs/subsystems/interrupts/trampolines/) page, the handler bodies past the trampoline are on the
[handlers](/docs/subsystems/interrupts/handlers/) page, the broker vectors this table reserves are on the
[broker IRQ](/docs/subsystems/hardware-broker/irq/) page, and the IST slots come from the [GDT](/docs/subsystems/smp/).
