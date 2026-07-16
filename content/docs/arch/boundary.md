---
title: "The Architecture Boundary"
description: "NØNOS runs on more than one instruction set, and it does so without scattering cfg branches through the kernel."
weight: 2
---
NØNOS runs on more than one instruction set, and it does so without scattering `cfg` branches through
the kernel. Generic code calls a small trait, `ArchOps`, through one type alias, and the build selects
which backend that alias resolves to. This page documents the boundary. The code is [`src/arch/abi.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/abi.rs)
and [`src/arch/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/mod.rs).

## One trait, one alias

The generic kernel never names an architecture. It calls the active backend through the `Arch` type
alias, which [`src/arch/mod.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/mod.rs#L46) selects by target:

```
  #[cfg(target_arch = "x86_64")]  pub type Arch = x86_64::abi::X86_64;
  #[cfg(target_arch = "aarch64")] pub type Arch = aarch64::abi::Aarch64;
  #[cfg(target_arch = "riscv64")] pub type Arch = riscv64::abi::Riscv64;
```

`Arch` implements `ArchOps`, so shared code writes `Arch::halt()` or `Arch::current_cpu_id()` and the
compiler resolves it to the backend for the target being built. Adding an architecture is adding a
backend type that implements the trait and a `cfg` arm here; no generic code changes. This is the
concrete form of the project's multi-architecture discipline: the shared path goes through the trait,
never into a per-arch module directly.

## The eight leaf primitives

`ArchOps` ([`src/arch/abi.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/abi.rs#L36)) is deliberately small, the eight primitives that genuinely cannot be
written portably:

```
  halt() -> !                          park the CPU forever
  enable_interrupts()   (unsafe)       unmask IRQs on this CPU
  disable_interrupts()  (unsafe)       mask IRQs on this CPU
  interrupts_enabled() -> bool         is the IRQ flag set
  current_cpu_id() -> u32              this CPU's stable id
  read_time_counter() -> u64           the monotonic per-CPU tick counter
  flush_tlb_one(addr)   (unsafe)       invalidate one TLB entry on this CPU
  switch_address_space(root) (unsafe)  install a page-table root on this CPU
```

Each is a single hardware operation with no portable expression: halting, the interrupt flag, the CPU
id, the cycle counter, a single-page TLB invalidation, and the page-table root switch. The unsafe ones
carry explicit contracts in the source, enable and disable must be paired or the CPU strands,
`flush_tlb_one` invalidates only the calling CPU (cross-CPU shootdown is the [SMP layer's](/docs/subsystems/smp/tlb-shootdown/)
job), and `switch_address_space` requires a valid root or it faults. `read_time_counter` returns
platform-defined units (TSC ticks, the generic timer, or `mtime`); callers that want wall-clock time go
through [`sys::clock`](/docs/subsystems/time-and-clock/) instead.

## Fail to link, not fail silently

The trait's design rule is stated in its own doc: the primitives are infallible, and an architecture
that cannot implement one yet must not have an `ArchOps` impl at all. The consequence is that a build
for an incomplete architecture fails to link rather than compiling and doing the wrong thing at runtime.
There is no default method that silently no-ops; a backend is complete or it does not exist as an
`Arch`. This is what lets the kernel treat `Arch::` calls as trustworthy on every target it actually
builds for.

## A narrow boundary on purpose

The boundary is intentionally small, and the source says why: this is the first phase, eight leaf
primitives, and the larger arch-specific concerns, IRQ vector allocation, MMIO, PIO, and DMA grants,
the syscall entry path, and the per-arch timer device, live behind their own boundaries rather than
being crammed into `ArchOps`. Some of those already exist as separate seams: the
[hardware broker](/docs/subsystems/hardware-broker/) gates PIO to x86_64, the
[syscall boundary](/docs/subsystems/syscall/boundary/) has its own arch bridge, and the
[interrupt](/docs/subsystems/interrupts/) controllers are arch-specific. `ArchOps` is the leaf
layer under all of them.

## Security analysis

The boundary's security value is not in what it does but in what it forbids. It is a chokepoint: the
generic kernel reaches the silicon only through eight named calls, so the entire arch-specific attack
surface visible to portable code is those eight primitives and nothing else. Two properties follow.

**Fail to link is a safety property, not just a build convenience.** A backend that cannot implement a
primitive has no `ArchOps` impl, so a build for an incomplete architecture does not link. There is no
default method that silently no-ops. This matters because the two unsafe primitives here,
`switch_address_space` and `flush_tlb_one`, are exactly the operations whose silent failure would break
isolation: a no-op CR3 switch would leave a capsule running in the previous address space, and a no-op
TLB flush would let a stale translation outlive the mapping it named. The discipline guarantees that on
any target the kernel actually builds for, these calls are real, so `Arch::` calls can be treated as
trustworthy rather than best-effort.

**The unsafe contracts are load-bearing.** The two isolation primitives carry explicit contracts in the
source. `switch_address_space` requires a valid page-table root or it faults, and callers honour that:
on x86_64 the scheduler proves the root before the switch (see the [x86_64 backend](/docs/arch/x86_64/)).
`flush_tlb_one` invalidates only the calling CPU by construction; cross-CPU invalidation is not this
primitive's job and is handled by the [SMP shootdown](/docs/subsystems/smp/tlb-shootdown/) layer, so a
caller that assumed one `flush_tlb_one` covered every core would leave stale translations on the others.
Keeping the boundary this narrow is what makes those two contracts auditable: there are only two of them,
and every use site is visible.

Because the boundary is a leaf, it is deliberately not where the interesting authority lives. IRQ vector
allocation, the MMIO, PIO, and DMA grants, and the syscall entry path are the operations a compromised
capsule would want, and they sit behind their own seams (the [hardware broker](/docs/subsystems/hardware-broker/),
the [syscall boundary](/docs/subsystems/syscall/boundary/)) with their own capability gates, not inside
`ArchOps`. The boundary carries no capability checks because nothing reaches it without having already
passed one.

## Debugging

Boundary problems show up at build time far more often than at runtime, which is the point of the
design.

**A link failure naming an `ArchOps` method.** This is the fail-to-link discipline working. A build for
an architecture whose backend does not yet implement a primitive fails to link on that method rather than
producing a kernel that misbehaves. The fix is to implement the missing primitive in the backend, not to
add a default; a default would reintroduce the silent-no-op hazard the discipline exists to prevent.

**A `cfg(target_arch)` or `crate::arch::x86_64::` outside `src/arch/`.** The static gate counts these:
`run-static-checks.sh` fails the build if generic code names an architecture directly or imports a
per-arch path, because that is an arch leak, the thing the boundary exists to prevent. The fix is to
route the call through `Arch::` or the appropriate seam rather than reaching into a backend module. This
is caught statically, before boot, by the CI gate documented on the
[workflows](/docs/build/workflows/) page.

**A stranded CPU after enabling interrupts.** `enable_interrupts` and `disable_interrupts` must be paired,
per their source contract; an unbalanced disable leaves the CPU masked and unresponsive to the preemption
timer. This is a caller bug, not a backend bug, and it presents as a hang rather than a fault.

## Source map

```
  src/arch/abi.rs         the ArchOps trait and its eight primitives
  src/arch/mod.rs         the cfg-selected Arch alias and the module gating
  src/arch/x86_64/abi.rs  the production backend implementing the trait
  src/arch/aarch64/abi/   the architecture-ready ARM backend
  src/arch/riscv64/abi/   the architecture-ready RISC-V backend
```

The x86_64 realisation of each primitive is on the [x86_64 backend](/docs/arch/x86_64/) page, the ARM and RISC-V
realisations are on the [aarch64](/docs/arch/aarch64/) and [riscv64](/docs/arch/riscv64/) pages, and the arch-gated
features that live outside the boundary are on the [platform discovery](/docs/arch/platform-discovery/) page.
