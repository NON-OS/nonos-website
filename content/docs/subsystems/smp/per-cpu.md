---
title: "SMP: Per-CPU Data and CPU Identity"
description: "On a multicore machine each CPU has its own private per-CPU structure, and each CPU can identify which core it is through the architecture boundary."
weight: 1
---
On a multicore machine each CPU has its own private per-CPU structure, and each CPU can
identify which core it is through the architecture boundary. This page documents the
per-CPU data, how a CPU learns its own identity, and the per-CPU address-space id that
scopes TLB shootdowns. The code is under `src/smp/`. The kernel supports up to
`MAX_CPUS = 256` ([`src/smp/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/constants.rs#L17)).

## The per-CPU structure

Each CPU has a `PerCpuData`, page-aligned so it sits on its own cache lines and page
([`src/smp/percpu/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/percpu/types.rs#L29)):

```
  #[repr(C, align(4096))]
  PerCpuData
    self_ptr                u64        pointer to this structure
    cpu_id / apic_id        u32        the dense index and the hardware APIC id
    current_process         AtomicU64  the process running on this CPU
    current_thread          AtomicU64
    kernel_stack_top        u64        this CPU's kernel stack
    user_stack_saved        u64
    syscall_scratch         [u64; 4]   scratch for the syscall trampoline
    irq_nesting             u32        interrupt nesting depth
    sched_lock_held         u32
    random_state            AtomicU64  per-CPU RNG state
    last_tick_tsc           AtomicU64
    interrupt_disable_depth u32
    active_asid             AtomicU32  the address space executing here
    _reserved               padding to a full 4096-byte page
```

The structure holds exactly the state that must be private to a CPU: which process and
thread it is running, its kernel stack, its syscall scratch, its interrupt nesting and
disable depth, and its own RNG state. Because it is per-CPU, these are read and written
without locking or atomics for the fields only ever touched by the owning CPU, and with
atomics for the ones another CPU may read, such as `current_process` and `active_asid`.
The page alignment keeps one CPU's structure off another's cache lines.

## CPU identity

A CPU learns which core it is through the arch boundary ([`src/smp/cpu.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/cpu.rs#L22)):

```
  cpu_id():
      id = arch::cpu::get_cpu_id()          APIC id, MPIDR_EL1, or hart id
      apic_to_cpu_id(id).unwrap_or(0)        map the hardware id to a dense index
```

`get_cpu_id` is the arch-neutral call: on x86_64 it reads the Local APIC id, on aarch64
`MPIDR_EL1`, on riscv64 the hart id. Those hardware ids are not necessarily dense or
zero-based, so `apic_to_cpu_id` maps the hardware id to a dense `0..CPU_COUNT` index by
scanning the CPU descriptors, and that dense index is what the rest of the kernel uses,
for example to index the per-CPU current-pid array in the [process table](/docs/subsystems/process/process-table/).
`is_bsp` (`cpu.rs:53`) reports whether the calling CPU is the bootstrap processor by
comparing its hardware id against the recorded `BSP_APIC_ID`.

## The active address space

The `active_asid` field is the one other CPUs read, and it exists for TLB coherency
([`percpu/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/percpu/types.rs#L19)). It records the address-space id currently executing on this CPU,
updated by `paging::manager::switch_address_space` on every context switch into a
process. The reserved value `ASID_NONE` (zero) means no user CR3 is active on this CPU,
which is the state at boot before any process runs and after a CPU has driven a process
off without yet loading another. The [TLB shootdown](/docs/subsystems/smp/tlb-shootdown/) broadcaster reads
these to decide which CPUs a per-address-space invalidation needs to reach: a user-VA
flush does not need to reach a CPU whose `active_asid` is `ASID_NONE` or a different
address space, while kernel-VA flushes are not ASID-keyed and reach every online CPU.

## Security analysis

Per-CPU state is a correctness and isolation mechanism rather than a privilege boundary: none of it is
reachable from ring 3. Its properties are about keeping one CPU's state from corrupting another's and
about a CPU knowing which core it actually is. Three hold.

**Per-CPU isolation is by page-aligned ownership, not by locking.** `PerCpuData` is `#[repr(C,
align(4096))]` ([`src/smp/percpu/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/percpu/types.rs#L29)), so each CPU's structure sits on its own cache lines and its
own page. The fields only ever touched by the owning CPU (kernel stack, syscall scratch, interrupt
nesting and disable depth, RNG state) are read and written without locking or atomics, which is sound
precisely because no other CPU touches them. The handful another CPU may read (`current_process`,
`active_asid`) are atomics. The isolation is structural: a CPU indexes its own record and does not reach
into another's, so there is no shared mutable field to race on for the non-atomic ones.

**A CPU's identity is derived from hardware, then made dense, not assumed.** `cpu_id`
([`src/smp/cpu.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/cpu.rs#L22)) reads the hardware id through the arch facade (`get_cpu_id`, the Local APIC id on
x86_64) and maps it to a dense `0..CPU_COUNT` index with `apic_to_cpu_id` by scanning the CPU
descriptors. This matters because the boot CPU's APIC id is not guaranteed to be 0: firmware assigns APIC
ids, and the dense index the rest of the kernel uses to index per-CPU arrays is a separate space from the
hardware id. `is_bsp` (`cpu.rs:53`) reflects this honestly by comparing `get_cpu_id()` against the
recorded `BSP_APIC_ID` (stored from `apic::id()` during `init_bsp`, [`src/smp/init/bsp.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/init/bsp.rs#L31)) rather than
against 0. Assuming the BSP is APIC id 0, or that hardware ids are dense, would be a bug on hardware where
IOAPIC routing and firmware numbering do not line up with that assumption; the map is what makes the code
correct regardless.

**`active_asid` is the only field published for cross-CPU reads, and it is an atomic with a defined
idle value.** It records the address space executing on this CPU, updated by
`switch_address_space` on every context switch, and `ASID_NONE` (zero) means no user CR3 is active
([`percpu/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/percpu/types.rs#L19)). The [TLB shootdown](/docs/subsystems/smp/tlb-shootdown/) filter reads it to decide which CPUs a
per-address-space invalidation must reach. The honest boundary is that the correctness of every per-CPU
read rests on the kernel GS base being loaded first: `current()` reaches the structure through that base,
so a read before the swapgs on an entry path would index the wrong CPU. That discipline is the
trampoline's and the entry paths' responsibility, not something this module re-checks.

## Debugging per-CPU state

Per-CPU bugs rarely print; they show as one core behaving differently from the others, so they are
diagnosed by asymmetry. The startup path does log identity, which is the anchor for everything else:
`init_bsp` prints `[SMP] BSP initialized: APIC ID=<n>, <k> CPUs detected` ([`src/smp/init/bsp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/init/bsp.rs)), and AP
bring-up prints `[SMP] AP <cpu_id> online (APIC <n>)` ([`src/smp/init/ap_unit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/init/ap_unit.rs)). Read together these
tell you the mapping from dense `cpu_id` to hardware APIC id that `apic_to_cpu_id` built, which is the
first thing to check when a per-CPU array looks like it is indexing the wrong core.

The characteristic failure modes:

- **A wrong or duplicated `cpu_id`.** If two CPUs resolve to the same dense index, `apic_to_cpu_id` found
  two descriptors with the same APIC id or the descriptor table was misfilled during bring-up. The
  symptom is two cores sharing one per-CPU record, which corrupts stacks and scheduler state. The
  `[SMP] AP ... online (APIC ...)` lines are where you confirm each APIC id is distinct.
- **`is_bsp` disagreeing with expectation.** On hardware where the BSP is not APIC id 0, code that assumed
  the BSP is core 0 will act on the wrong CPU while `is_bsp` (which compares against the recorded
  `BSP_APIC_ID`) stays correct. A divergence between the two is the tell that some other code hard-coded
  0 instead of asking `is_bsp`.
- **A per-CPU read returning another core's data.** This is almost always a GS-base problem on an entry
  path (a read before swapgs), not a bug in this module, and it presents as one core's counters or
  `active_asid` being wrong while the others are fine. The fix is on the entry/trampoline path that runs
  before the GS base is loaded.

## Source map

```
  src/smp/percpu/types.rs       PerCpuData and ASID_NONE
  src/smp/percpu/operations.rs  current() and the per-CPU accessors
  src/smp/cpu.rs                cpu_id, apic_to_cpu_id, is_bsp
  src/smp/init/bsp.rs           init_bsp, BSP_APIC_ID recorded from apic::id()
  src/smp/init/ap_unit.rs       AP descriptor configuration and the online log
  src/smp/constants.rs          MAX_CPUS
```

Every reference above is verified against those trees. The AP bring-up that fills these descriptors is on
the [TLB shootdown](/docs/subsystems/smp/tlb-shootdown/) page's neighbours in this section, the `active_asid` field is
consumed by the [TLB shootdown](/docs/subsystems/smp/tlb-shootdown/) filter, and the dense `cpu_id` indexes the per-CPU
current-pid array in the [process table](/docs/subsystems/process/process-table/).
