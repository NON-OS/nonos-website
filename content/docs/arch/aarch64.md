---
title: "The aarch64 Backend"
description: "aarch64 is an architecture-ready backend: it implements the full ArchOps boundary and carries the ARM-specific machinery (the GIC, PSCI, the MMU, the generic timer), so the kern..."
weight: 4
---
aarch64 is an architecture-ready backend: it implements the full `ArchOps` boundary and carries the
ARM-specific machinery (the GIC, PSCI, the MMU, the generic timer), so the kernel compiles and links for
64-bit ARM. It is the next target after x86_64 in the multi-architecture plan, ahead of runtime bring-up
on QEMU and then hardware. This page documents it honestly. The code is under `src/arch/aarch64/`.

## The ArchOps implementation

The `Aarch64` backend ([`src/arch/aarch64/abi/archops.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/aarch64/abi/archops.rs#L24)) implements the same eight primitives as
x86_64, delegating each to a dedicated backend module:

```
  halt()                -> halt::halt()
  enable_interrupts()   -> irq_enable::enable()        (unmask via DAIF)
  disable_interrupts()  -> irq_disable::disable()
  interrupts_enabled()  -> irq_state::enabled()
  current_cpu_id()      -> cpu_id::current()           (MPIDR affinity)
  read_time_counter()   -> time::counter()             (the generic timer)
  flush_tlb_one(addr)   -> tlb::flush_one(addr)
  switch_address_space  -> address_space::switch(root) (TTBR)
```

The structure is deliberately the same as the other backends: the `ArchOps` impl is a thin delegation
layer, and the real per-operation code lives in a focused module, so a reader can find the ARM interrupt
masking in `irq_*`, the CPU id derivation from MPIDR in `cpu_id`, and the translation-table-base switch
in `address_space`.

## The ARM machinery

Beyond the eight primitives, the aarch64 tree ([`src/arch/aarch64/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/aarch64/mod.rs#L17)) carries the modules the
platform needs:

```
  gic         the Generic Interrupt Controller (GICv3 SPIs)
  psci        Power State Coordination Interface (CPU on/off)
  mmu         the ARM page-table format and translation regime
  timer       the generic timer (the ArchOps time counter)
  exceptions  the exception vector table and handlers
  fpu         floating-point / SIMD state
  uart        the serial console
  context     task context save/restore
  security    the arch security state
```

These are the aarch64 analogues of the x86_64 machinery: the GIC plays the role of the IO-APIC and LAPIC
(and is the backend for the [hardware broker's](/docs/subsystems/hardware-broker/irq/) IRQ grants on ARM),
PSCI starts secondary CPUs where x86 uses the trampoline, and the MMU module implements the ARM
page-table format behind the same [paging](/docs/subsystems/memory/paging-manager/) manager.

## Maturity

It is worth being precise about status. aarch64 is *architecture-ready*, not production: it implements
`ArchOps` and the platform modules exist, so the kernel builds and links for the target, which is what
the fail-to-link discipline of the [boundary](/docs/arch/boundary/) guarantees. It has not been through the same
runtime bring-up and hardware validation as x86_64. The plan is x86_64 in production first, then aarch64
and riscv64 to architecture-ready, then QEMU bring-up, then hardware. This page documents the code that
exists; it does not claim aarch64 is a proven runtime target yet.

## Security analysis

The honest security statement for aarch64 is scoped by its maturity. The backend implements the same
`ArchOps` contract as x86_64, so the same structural guarantees apply at the boundary: the two isolation
primitives, `switch_address_space` (TTBR) and `flush_tlb_one`, exist and are real, because the
fail-to-link discipline of the [boundary](/docs/arch/boundary/) would refuse to build the target if they did not.
That is what "architecture-ready" buys on the security side: the isolation calls the kernel depends on
are present and typed, not stubbed out to no-ops.

What it does not yet buy is validated runtime enforcement. The ARM address-translation regime (the MMU
module and its TTBR switch), the GICv3 interrupt routing that backs the
[hardware broker's](/docs/subsystems/hardware-broker/irq/) IRQ grants on ARM, and the exception vector
table have not been through the same runtime bring-up and hardware validation as the x86_64 path. The
same isolation properties are intended to hold, but on aarch64 they are asserted by construction and not
yet proven on hardware. Anyone reasoning about the trust boundary should read x86_64 as the enforced
path and aarch64 as the architecture-ready one, exactly as the maturity ladder states.

One structural point does carry over cleanly: the CPU id is derived from MPIDR affinity, the ARM
analogue of the APIC id, so the same correctness edge as x86_64 applies. The id the kernel reasons about
is the one the GIC routes by, which is what an interrupt-routing path needs to be safe.

## Debugging

Because aarch64 is pre-runtime, its failure modes are compile-and-link shaped today, with hardware-shaped
ones expected once bring-up begins.

**A link failure on an `ArchOps` method for aarch64.** This is the fail-to-link discipline: the backend
must implement every primitive or the target does not build. The delegation layout is deliberate here, so
a missing primitive maps to a specific module (interrupt masking in `irq_*`, the MPIDR id in `cpu_id`,
the TTBR switch in `address_space`), and the fix is to complete that module, not to add a default.

**No serial output on bring-up.** The first thing to come up on a new target is the console. The `uart`
module is the ARM serial console; if it is misconfigured the kernel can be running with nothing to show
for it. On this backend the console is the primary debugging instrument, the same role serial plays in
the QEMU run lanes on the [workflows](/docs/build/workflows/) page.

**Secondary CPUs never start.** PSCI is how aarch64 brings up secondary cores, where x86 uses the
trampoline. A single-core-only bring-up on ARM points at PSCI rather than at the generic SMP layer, which
is written once and calls through the arch seam.

## Source map

```
  src/arch/aarch64/abi/archops.rs   the ArchOps backend, delegating to the modules below
  src/arch/aarch64/abi/             the per-primitive modules (cpu_id, time, tlb, address_space, irq_*)
  src/arch/aarch64/gic/             the Generic Interrupt Controller (GICv3), the IRQ backend on ARM
  src/arch/aarch64/psci/            secondary-CPU power control
  src/arch/aarch64/mmu/             the ARM page-table format behind the shared paging manager
  src/arch/aarch64/timer/, exceptions/, uart/   generic timer, exception vectors, serial console
  src/arch/fdt/                     the flattened-device-tree platform discovery this backend uses
```

The `ArchOps` contract these delegate to is on the [boundary](/docs/arch/boundary/) page, the device-tree
discovery is on the [platform discovery](/docs/arch/platform-discovery/) page, and the GIC's role as the IRQ
backend is on the [IRQ](/docs/subsystems/hardware-broker/irq/) page. Every reference is verified against
`src/arch/aarch64/`.
