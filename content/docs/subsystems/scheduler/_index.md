---
title: "Scheduler"
description: "How NØNOS chooses which process runs, when it is preempted, and how a blocked process gives up the CPU and gets it back."
weight: 6
---
How NØNOS chooses which process runs, when it is preempted, and how a blocked process
gives up the CPU and gets it back. The scheduler is cooperative and preemptive at once:
processes yield at natural wait points, a timer preempts one that overruns, and a blocked
process sleeps off the run queue rather than spinning. The [process model](/docs/subsystems/process/)
covers what a process is; this section covers how one is picked to run.

| Page | What it covers |
|------|----------------|
| [selection.md](/docs/subsystems/scheduler/selection/) | The FIFO run queue and the selection policy: a strict five-band priority walk (`RealTime > High > Normal > Low > Idle`) with per-band round-robin, and the fallback that keeps the current process running. |
| [preemption.md](/docs/subsystems/scheduler/preemption/) | The 100 Hz timer tick, the time slice, the deferred `NEED_RESCHEDULE` flag that defers the switch to a safe point, the voluntary `yield_now`, and the switch contract. |
| [sleep-wake.md](/docs/subsystems/scheduler/sleep-wake/) | The sleeping set, `sleep_until` and `wake_process`, and the timer-driven deadline wake, the machinery under IPC blocking, IRQ waiting, and timed sleeps. |

The switch itself, entering or resuming a process on a CPU, is the
[context switch](/docs/subsystems/process/context-switch/), and the timer that drives preemption and
the deadline wake is the [preemption timer](/docs/subsystems/interrupts/).

## Sources

The code for this subsystem lives under `src/process/scheduler/`: `selection/` (the
policy), `dispatch/` (the run queue and sleep), `preemption/` (the tick and yield), and
`contract/` (the switch contract). Every page is verified against those trees with
`file:line` references.
