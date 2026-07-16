---
title: "Scheduler: Sleep and Wake"
description: "A process that has nothing to do does not spin waiting for it."
weight: 4
---
A process that has nothing to do does not spin waiting for it. It sleeps: it comes off
the run queue, records when or why it should wake, and yields the CPU. It is woken
either by an explicit event, a message delivered or an interrupt fired, or by the timer
when a deadline it was waiting on passes. This is the machinery underneath IPC blocking,
IRQ waiting, and timed sleeps. This page documents the sleeping set, going to sleep,
waking, and the timer-driven deadline wake. The code is
[`src/process/scheduler/dispatch/sleep.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/scheduler/dispatch/sleep.rs).

## The sleeping set

Sleeping processes are held in a map from pid to wake time
([`src/process/scheduler/dispatch/sleep.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/scheduler/dispatch/sleep.rs#L22)):

```
  static SLEEPING_PROCESSES: RwLock<BTreeMap<u32, u64>>    pid -> wake_time_ms
```

The value is the wall-clock millisecond a timed sleeper should wake. A process waiting on
an event rather than a deadline is still recorded here so the scheduler knows it is
asleep; its entry is removed when the event wakes it. The map is behind a reader-writer
lock, so the common read, the timer scanning for expired sleepers, does not block other
readers.

## Going to sleep

`sleep_until` (`sleep.rs:24`) puts a process to sleep:

```
  sleep_until(pid, wake_time_ms):
      SLEEPING_PROCESSES.insert(pid, wake_time_ms)
      set the process state to Sleeping
      remove it from the run queue
```

Three things happen together: the pid is recorded with its wake time, its state becomes
`Sleeping`, and it is taken off the [run queue](/docs/subsystems/scheduler/selection/) so the selector will not
consider it. After this the process is invisible to scheduling until something wakes it,
which is what makes a blocked capsule cost nothing: it is not scanned, not dispatched,
and not consuming a slice.

## Waking

`wake_process` (`sleep.rs:33`) is the reverse, and it is careful to wake only a process
that is actually asleep:

```
  wake_process(pid):
      remove the pid from SLEEPING_PROCESSES
      if the process state is Sleeping:
          set it to Ready
          add it back to the run queue
          scheduler wakeups += 1
```

It removes the sleeping entry, and only if the process is genuinely in the `Sleeping`
state does it flip it to `Ready`, put it back on the run queue, and count the wakeup. The
state check means a spurious or duplicate wake of a process that is already running or
ready does nothing, so waking is safe to call from any path that might have raced with
another waker.

## The timer-driven deadline wake

Timed sleepers are woken by `check_sleeping_processes` (`sleep.rs:68`), which the
scheduler runs from the timer:

```
  check_sleeping_processes():
      now = timestamp_millis()
      under the read lock, collect up to 64 pids whose wake_time <= now
      for each collected pid: wake_process(pid)
```

It snapshots the expired sleepers into a fixed 64-element array while holding only the
read lock, then releases the lock and wakes each, so it never calls `wake_process`, which
takes the write lock, while still holding the read lock. The fixed array means the scan
allocates nothing, which suits a path the timer drives; the tradeoff is that a burst of
more than 64 sleepers expiring in the same instant is woken across several calls rather
than all at once, which the following ticks resolve.

## The two ways a process wakes

Putting it together, a sleeping process wakes one of two ways. An explicit event calls
`wake_process` directly: an [IPC](/docs/subsystems/ipc/) send that delivers to a waiting receiver
wakes it, and an interrupt that a driver was waiting on wakes the driver. A deadline
wakes through `check_sleeping_processes`: a process that called `sleep_until` with a
future time, including a receive with a timeout, is woken when that time passes. Either
way the process returns to `Ready` and rejoins the run queue, and the
[selector](/docs/subsystems/scheduler/selection/) picks it up on a later pass.

## Security analysis

Sleep and wake are the liveness path: a blocked capsule must cost nothing while asleep and must reliably
come back when its event arrives. The properties here are about not losing a wakeup and not corrupting
state by waking the wrong thing. Three hold.

**A sleeping process consumes no scheduling resource.** `sleep_until` (`sleep.rs:24`) records the pid,
sets its state to `Sleeping`, and removes it from the run queue, all together, so the selector never
considers it: it is not scanned, not dispatched, and not charged a slice. This is what makes a blocked
capsule genuinely free rather than a spinner, and it is the mechanism underneath every IPC-receive,
IRQ-wait, and timed sleep, so a capsule waiting on an event does not steal CPU from one doing work.

**Waking is idempotent and state-guarded.** `wake_process` (`sleep.rs:33`) removes the sleeping entry
and only flips the process to `Ready` and re-queues it if its state is actually `Sleeping`
(`sleep.rs:39`). A spurious or duplicate wake of a process that is already running or ready does nothing.
This is what makes wake safe to call from any path that might race another waker, an IPC delivery and a
timeout expiring at nearly the same instant, without double-queuing the pid or dragging a running process
back to `Ready` underneath itself.

**The timer scan never deadlocks on the sleeping map.** `check_sleeping_processes` (`sleep.rs:68`)
snapshots expired sleepers into a fixed 64-element array while holding only the read lock, then releases
the lock before calling `wake_process`, which takes the write lock. So the deadline scan never calls a
write-locking function while holding the read lock, and the fixed array means the timer-driven path
allocates nothing. The honest boundary: the 64-entry cap means a burst of more than 64 sleepers expiring
in the same instant is woken across several timer calls rather than all at once, so a heavily-loaded
deadline instant is spread over a few ticks, which the following ticks resolve. And because the state
guard in `wake_process` is the only thing that makes a wake take effect, a wakeup delivered to a process
that is not yet `Sleeping`, a wake that races ahead of the `sleep_until` that would have parked it, is
silently dropped, which is the classic lost-wakeup shape a caller has to order against.

## Debugging sleep and wake

A process that is stuck asleep forever is the headline failure, and there are two distinct causes. The
lost wakeup: the waker called `wake_process` before `sleep_until` set the state to `Sleeping`, so the
state guard (`sleep.rs:39`) saw a non-`Sleeping` process and did nothing, and the later `sleep_until`
then parked the process with no one left to wake it. The fix is ordering, park before the event can be
signalled, not in the wake path. The other cause is a timed sleeper whose deadline passed but who was in
a burst of more than 64 expiring at once: it is woken a tick or two later, so a small delay under a
thundering deadline is expected, but a permanent stall is not and points at `check_sleeping_processes`
not being called from the timer at all. Use `is_sleeping(pid)` to confirm the process is actually in the
sleeping set, and `get_remaining_sleep(pid)` to read its wake time: a wake time in the past with the pid
still sleeping means the deadline scan is not running; no entry at all means it was already woken and the
stall is elsewhere (likely it woke to `Ready` but selection is starving it, see
[selection](/docs/subsystems/scheduler/selection/)). The `wakeups` counter in `SCHEDULER_STATS` climbing without the target
process becoming `Ready` means the wake landed on a process not in `Sleeping` state, the lost-wakeup
signature again.

## Source map

```
  src/process/scheduler/dispatch/sleep.rs    the sleeping set, sleep_until, wake_process,
                                              check_sleeping_processes
  src/process/scheduler/dispatch/wakeup.rs   wakeup helpers
```

Every reference above is verified against those trees. The run queue a woken process rejoins and the
selector that picks it up are on the [selection](/docs/subsystems/scheduler/selection/) page; the timer that drives
`check_sleeping_processes` is the same tick documented on the [preemption](/docs/subsystems/scheduler/preemption/) page; the
`Sleeping` and `Ready` states these transitions move between are on the
[lifecycle](/docs/subsystems/process/lifecycle/) page; and the IPC and IRQ waits that call `sleep_until` are the wait
points noted on the [PCB](/docs/subsystems/process/pcb/)'s `wchan`.
