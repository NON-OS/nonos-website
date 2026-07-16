---
title: "The riscv64 Backend"
description: "riscv64 is the third backend, architecture-ready like aarch64: it implements the full ArchOps boundary and carries the RISC-V machinery (the PLIC, SBI, the MMU, the mtime timer)..."
weight: 5
---
riscv64 is the third backend, architecture-ready like [aarch64](/docs/arch/aarch64/): it implements the full
`ArchOps` boundary and carries the RISC-V machinery (the PLIC, SBI, the MMU, the `mtime` timer), so the
kernel compiles and links for 64-bit RISC-V. This page documents it. The code is under
`src/arch/riscv64/`.

## The ArchOps implementation

The `Riscv64` backend ([`src/arch/riscv64/abi/archops.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/riscv64/abi/archops.rs#L24)) implements the eight primitives by
delegation, the same shape as the other two backends:

```
  halt()                -> halt::halt()
  enable_interrupts()   -> irq_enable::enable()        (SIE in sstatus)
  disable_interrupts()  -> irq_disable::disable()
  interrupts_enabled()  -> irq_state::enabled()
  current_cpu_id()      -> cpu_id::current()           (the hart id)
  read_time_counter()   -> time::counter()             (mtime / the time CSR)
  flush_tlb_one(addr)   -> tlb::flush_one(addr)         (sfence.vma)
  switch_address_space  -> address_space::switch(root) (satp)
```

The CPU id is the hart id, the RISC-V hardware thread identifier, and the time counter reads the
`time` counter (the memory-mapped `mtime`). Address-space switch writes the `satp` register and the TLB
flush is `sfence.vma`, the RISC-V primitives corresponding to CR3/invlpg on x86 and TTBR/TLBI on ARM.

## The RISC-V machinery

The riscv64 tree ([`src/arch/riscv64/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/riscv64/mod.rs#L17)) carries the platform modules:

```
  plic        the Platform-Level Interrupt Controller (external sources)
  sbi         the Supervisor Binary Interface (firmware calls: console, IPI, timer)
  mmu         the Sv39/Sv48 page-table format
  timer       the mtime counter (the ArchOps time counter)
  interrupts  the trap and interrupt handling
  fpu         floating-point state
  uart        the serial console
  context     task context save/restore
  security    the arch security state
```

The PLIC is the RISC-V interrupt controller and the backend for the
[hardware broker's](/docs/subsystems/hardware-broker/irq/) IRQ grants on RISC-V, and SBI is the interface
to the machine-mode firmware, used for the console, inter-hart interrupts, and the timer, where x86 would
use direct hardware access and ARM would use PSCI. The MMU module implements the RISC-V page-table format
behind the shared [paging](/docs/subsystems/memory/paging-manager/) manager.

## Maturity

Like aarch64, riscv64 is architecture-ready rather than production: the `ArchOps` impl and the platform
modules exist so the kernel builds and links, guaranteed complete by the fail-to-link discipline of the
[boundary](/docs/arch/boundary/), but it has not been through the runtime bring-up and validation that x86_64 has.
It follows the same plan: architecture-ready, then QEMU, then hardware. This page documents the code that
is there.

## Security analysis

The security statement mirrors [aarch64](/docs/arch/aarch64/), scoped by the same maturity. riscv64 implements the
full `ArchOps` contract, so the two isolation primitives are real on this target: `switch_address_space`
writes `satp` and `flush_tlb_one` issues `sfence.vma`, and the fail-to-link discipline of the
[boundary](/docs/arch/boundary/) guarantees they exist rather than silently no-opping. The kernel's isolation
model depends on those two calls doing real work, and on riscv64 they do.

The same caveat applies as on ARM: the Sv39/Sv48 translation regime, the PLIC routing that backs the
[hardware broker's](/docs/subsystems/hardware-broker/irq/) IRQ grants on RISC-V, and the trap and
interrupt handling have not been through runtime bring-up and hardware validation. The isolation
properties are asserted by construction, not proven on silicon. Read x86_64 as the enforced path and
riscv64 as architecture-ready.

Two RISC-V specifics are worth noting for a security reader. First, SBI is a call into machine-mode
firmware for the console, inter-hart interrupts, and the timer; that firmware sits below the supervisor
the kernel runs in, so it is part of the trusted base on this target in a way x86 direct hardware access
is not. Second, the CPU id is the hart id, the hardware thread identifier the PLIC and the IPI path
reason about, so the same route-by-the-id-you-observe correctness edge holds as on the other backends.

## Debugging

riscv64 is pre-runtime, so its failure modes today are compile-and-link shaped, with hardware-shaped ones
expected once bring-up starts.

**A link failure on an `ArchOps` method for riscv64.** The fail-to-link discipline again: the backend
must implement every primitive. The delegation layout maps a missing primitive to a specific module (the
`satp` switch in `address_space`, `sfence.vma` in `tlb`, the SIE bit in `irq_enable`), and the fix is to
complete that module, not to add a default.

**No console output on bring-up.** The console can come up two ways on RISC-V: the `uart` module for a
memory-mapped serial device, or SBI console calls into firmware. A silent bring-up points at whichever
one the platform uses. On a fresh target the console is the first thing to prove and the primary
debugging instrument.

**A trap storm or an unhandled trap.** RISC-V funnels exceptions and interrupts through a trap vector;
the `interrupts` module owns it. A repeating trap that is not decoded points there rather than at the
generic layers above, which are written once and reach the platform through the arch seam.

## Source map

```
  src/arch/riscv64/abi/archops.rs   the ArchOps backend, delegating to the modules below
  src/arch/riscv64/abi/             the per-primitive modules (cpu_id, time, tlb, address_space, irq_*)
  src/arch/riscv64/plic/            the Platform-Level Interrupt Controller, the IRQ backend on RISC-V
  src/arch/riscv64/sbi/             the Supervisor Binary Interface (console, IPI, timer)
  src/arch/riscv64/mmu/             the Sv39/Sv48 page-table format behind the shared paging manager
  src/arch/riscv64/timer/, interrupts/, uart/   mtime, trap handling, serial console
  src/arch/fdt/                     the flattened-device-tree platform discovery this backend uses
```

The `ArchOps` contract is on the [boundary](/docs/arch/boundary/) page, the device-tree discovery is on the
[platform discovery](/docs/arch/platform-discovery/) page, and the PLIC's role as the IRQ backend is on the
[IRQ](/docs/subsystems/hardware-broker/irq/) page. Every reference is verified against `src/arch/riscv64/`.
