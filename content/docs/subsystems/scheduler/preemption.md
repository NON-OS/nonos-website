---
title: "Scheduler: Preemption"
description: "The scheduler is preemptive and cooperative at once."
weight: 3
---
The scheduler is preemptive and cooperative at once. A process yields voluntarily at
natural wait points, and a periodic timer preempts one that overruns its slice. The
timer does not switch inline; it charges the running process's time slice and, when the
slice is spent or a realtime task is runnable, flags a reschedule that fires at the next
safe point. This page documents the tick, the time slice, the deferred-reschedule flag,
and the voluntary yield. The code is under `src/process/scheduler/preemption/`.

## The timer tick

The preemption timer fires at 100 Hz, one tick every 10 ms, and each tick runs `tick`
([`src/process/scheduler/preemption/tick.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/scheduler/preemption/tick.rs#L22)):

```
  tick():
      charge a tick against the current process's accounting
      scheduler tick_count += 1
      decrement CURRENT_TIME_SLICE (floored at zero)
      if the slice just reached zero:
          record a time-slice exhaustion
          if kernel_preempt() policy allows: NEED_RESCHEDULE = true
      if any realtime task is runnable: NEED_RESCHEDULE = true
```

Every tick charges the running process's per-process tick accounting, bumps the global
tick count, and decrements the current time slice. The slice is a countdown of ticks;
`fetch_update` floors it at zero so it never underflows. When the decrement takes the
slice to zero, the tick records the exhaustion and, if the preemption policy permits,
sets `NEED_RESCHEDULE`. Separately, if any realtime task is runnable, the tick sets
`NEED_RESCHEDULE` regardless of the current slice, so a realtime task does not have to
wait for the running process's slice to expire.

## The time slice

`CURRENT_TIME_SLICE` is the running process's remaining ticks. It is reset to
`DEFAULT_TIME_SLICE` when a process is dispatched, as the [context switch](/docs/subsystems/process/context-switch/)
does on first entry, and counts down one per tick. A slice of, for example, ten ticks at
100 Hz gives a process up to 100 ms on the CPU before the timer considers preempting it.
Because the slice is charged per tick rather than by wall-clock reading, a process that
blocks and yields before its slice expires simply gives up the rest of it, and the next
dispatch starts a fresh slice.

## Deferred reschedule

The tick runs in the timer interrupt, and it deliberately does not perform a context
switch there. Switching inside the ISR, in the middle of whatever the interrupted code
was doing, would be unsafe. Instead the tick sets the `NEED_RESCHEDULE` flag and returns,
and the actual switch happens later, at a safe return point where the kernel checks the
flag and calls the scheduler. This split, decide-to-preempt in the tick, switch at a safe
point, is what keeps preemption from corrupting the state of the code it interrupts. The
flag is a release-ordered store so the CPU that later reads it sees the decision.

## Voluntary yield

A process gives up the CPU voluntarily through `yield_now`
([`src/process/scheduler/preemption/yield_impl.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/scheduler/preemption/yield_impl.rs#L22)):

```
  yield_now():
      scheduler voluntary_yields += 1
      without_interrupts(|| contract_switch(SwitchIntent::Yield))
```

It records the voluntary yield and, with interrupts disabled across the whole operation,
invokes the scheduler switch contract with a `Yield` intent. Disabling interrupts is the
same discipline the paging and usercopy paths use: the save-select-switch sequence must
not be interrupted partway. This is the path underneath every natural wait point, an IPC
receive with nothing queued, a sleep, an IRQ wait, so a blocked capsule yields rather
than spins.

## The switch contract

Both the voluntary yield and the deferred preemption converge on the scheduler switch
contract (`src/process/scheduler/contract/`), invoked with a `SwitchIntent` that
distinguishes a voluntary yield from a forced preemption. The contract saves the current
process's context, calls [selection](/docs/subsystems/scheduler/selection/) to choose the next pid, and performs
the [context switch](/docs/subsystems/process/context-switch/) into it, or stays on the current
process if selection returns it. The intent lets the contract account for voluntary
versus involuntary switches, which show up as the `voluntary_switches` and
`involuntary_switches` counters on the PCB.

## Security analysis

Preemption runs in an interrupt, and it decides when to hand the CPU away, so its safety rests on not
switching where a switch would corrupt state and on not letting one process hold the CPU indefinitely.
Three properties hold.

**The tick never switches inline.** `tick` (`tick.rs:22`) charges accounting, decrements the slice, and
at most sets `NEED_RESCHEDULE` with a release-ordered store (`tick.rs:35`); it performs no context
switch. Switching inside the ISR, in the middle of whatever the interrupted code was doing, would run the
scheduler over a half-updated kernel state, so the decision is deferred to a safe return point where the
kernel checks the flag. This is the discipline that keeps preemption from corrupting the code it
interrupts, and it is why the flag is a `Release` store: the CPU that later reads it sees a fully-formed
decision.

**A runaway process is always preempted.** The slice is a countdown of ticks reset to
`DEFAULT_TIME_SLICE` (10, `state.rs:21`) on dispatch and floored at zero by `fetch_update`
(`tick.rs:25`) so it never underflows. When it reaches zero the tick records a
`time_slice_exhaustion` and, if `kernel_preempt()` policy allows, flags a reschedule. So a process that
never yields voluntarily still loses the CPU when its slice is spent: there is no way for a compute-bound
capsule to hold a core forever, which is the liveness property a preemptive scheduler owes the rest of
the system.

**Realtime work is not held hostage by the current slice.** If any realtime task is runnable, the tick
sets `NEED_RESCHEDULE` regardless of the running process's remaining slice
(`tick.rs:38`), so a realtime task does not have to wait out a normal task's slice. The honest boundary:
whether an exhausted slice actually forces a switch is gated on `sys::policy::kernel_preempt()`, so the
policy can decline to preempt a kernel-mode path, and the switch only happens once execution reaches a
safe point that checks the flag, so a long non-preemptible kernel section defers the switch until it
returns. The voluntary `yield_now` disables interrupts across the whole save-select-switch
(`yield_impl.rs:22`), the same interrupts-off discipline the paging and usercopy paths use, so the
sequence is not interrupted partway.

## Debugging preemption

The two failure shapes are a process that hogs the CPU and a process that is preempted when it should not
be. A capsule that never yields the core is a `NEED_RESCHEDULE` that is set but never acted on: the tick
did its job (check that `time_slice_exhaustions` in `SCHEDULER_STATS` is climbing) but the safe-point
check that consumes the flag is not being reached, which on a wedged kernel path means the code never
returned to where the flag is read. If `time_slice_exhaustions` is not climbing, the timer is not
ticking at all, or `CURRENT_TIME_SLICE` was never reset on dispatch and sits at zero doing nothing. A
realtime task that starts late despite being runnable is `has_realtime_tasks()` not reporting it, or the
reschedule flag being set but not consumed, the same safe-point question. The `voluntary_switches`
versus `involuntary_switches` counters on the PCB distinguish the two paths: a process accumulating only
involuntary switches is always being preempted rather than yielding, which is expected for a compute
capsule, while a process that should block but shows involuntary switches is failing to hit a voluntary
wait point and being timer-preempted out of a spin instead.

## Source map

```
  src/process/scheduler/preemption/tick.rs        the timer tick and the slice
  src/process/scheduler/preemption/yield_impl.rs   the voluntary yield
  src/process/scheduler/preemption/state.rs        CURRENT_TIME_SLICE, NEED_RESCHEDULE
  src/process/scheduler/contract/                  the switch contract and SwitchIntent
```

Every reference above is verified against those trees. The slice reset on dispatch happens in the
[context switch](/docs/subsystems/process/context-switch/); the selection the contract calls to pick the next pid is
on the [selection](/docs/subsystems/scheduler/selection/) page; the wait points that lead into `yield_now` are on the
[sleep and wake](/docs/subsystems/scheduler/sleep-wake/) page; and the `voluntary_switches` / `involuntary_switches` counters live
on the [PCB](/docs/subsystems/process/pcb/).
