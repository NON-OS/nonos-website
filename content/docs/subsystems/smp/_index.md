---
title: "SMP"
description: "How NØNOS runs on more than one CPU: the per-CPU data each core keeps private, how a core identifies itself through the architecture boundary, and the cross-CPU TLB invalidation..."
weight: 7
---
How NØNOS runs on more than one CPU: the per-CPU data each core keeps private, how a
core identifies itself through the architecture boundary, and the cross-CPU TLB
invalidation that keeps address spaces coherent when a mapping changes.

| Page | What it covers |
|------|----------------|
| [per-cpu.md](/docs/subsystems/smp/per-cpu/) | The page-aligned `PerCpuData`, CPU identity through the arch boundary (APIC id, MPIDR, hart id) mapped to a dense index, and the per-CPU `active_asid` that scopes TLB shootdowns. |
| [tlb-shootdown.md](/docs/subsystems/smp/tlb-shootdown/) | The IPI broadcast-and-wait that invalidates a mapping across every CPU, the acknowledging IPI handler, the `invlpg` and CR3-reload primitives, and how the address-space scope is decided a layer up. |

Multicore bring-up, starting the application processors from the bootstrap processor,
lives under `src/smp/init/` (the BSP and AP init) and `src/smp/trampoline/` (the real-mode
trampoline the APs start from), and the inter-processor interrupt machinery the shootdown
uses is under `src/smp/ipi/`. The per-CPU current process this section's `active_asid`
complements is on the [process table](/docs/subsystems/process/process-table/) page.

## Sources

The code for this subsystem lives under `src/smp/`: `percpu/` (the per-CPU data), `cpu.rs`
(identity), `tlb.rs` (shootdown), `ipi/` (inter-processor interrupts), `init/` (bring-up),
and `trampoline/` (the AP start trampoline). Every page is verified against those trees
with `file:line` references.
