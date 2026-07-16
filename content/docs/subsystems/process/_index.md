---
title: "Process Model"
description: "What a process is in NØNOS, where processes live, how one is created and torn down, how the kernel enters and resumes it, and who supervises the whole set."
weight: 4
---
What a process is in NØNOS, where processes live, how one is created and torn down,
how the kernel enters and resumes it, and who supervises the whole set. A process is
a control block, an address space, a capability token, and a place in the scheduler;
these pages cover the process itself, while the [scheduler](/docs/subsystems/scheduler/) covers how
one is chosen to run.

| Page | What it covers |
|------|----------------|
| [pcb.md](/docs/subsystems/process/pcb/) | The `ProcessControlBlock` in full, organised by concern: identity, scheduling, address space, the authority fields, the kernel-to-user transition state, files, signals, and the POSIX-shaped bookkeeping. |
| [process-table.md](/docs/subsystems/process/process-table/) | The table of live processes, the per-CPU current process, PID allocation, the creation path, the initial control-block defaults, and threads versus processes. |
| [lifecycle.md](/docs/subsystems/process/lifecycle/) | The process states, creation into `Ready`, running and blocking, and the two-phase exit: teardown to zombie, then reap. |
| [context-switch.md](/docs/subsystems/process/context-switch/) | Entering a process for the first time, resuming a preempted user context, and resuming a kernel continuation, with the dispatch priority rule and the ring-3 entry. |
| [supervisor.md](/docs/subsystems/process/supervisor/) | The init process as the userspace supervisor with passive liveness, and the timer-driven kernel reaper that finalizes exited processes and reclaims their memory. |

The authority a process holds is the [capability model](/docs/security/capabilities-and-tokens/),
installed by the [verified-spawn gate](/docs/security/capsules-and-trust/); the memory
its address space is built from is the [memory subsystem](/docs/subsystems/memory/); and the point at
which a capsule's memory is scrubbed on exit is the [ZeroState guarantee](/docs/subsystems/memory/zeroization/).

## Sources

The code for this subsystem lives under `src/process/` (the PCB, the table, the exit
path, address-space lifecycle, and the scheduler), `src/arch/x86_64/context/` (the
context switch), and `src/userspace/init/` (the supervisor). Every page is verified
against those trees with `file:line` references.
