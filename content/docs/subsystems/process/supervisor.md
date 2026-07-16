---
title: "The Supervisor and the Reaper"
description: "Two things watch over process lifetimes, and they operate at different levels."
weight: 6
---
Two things watch over process lifetimes, and they operate at different levels. The
init process, pid 1, is the userspace supervisor: it spawns every system capsule and
then runs a light residual loop, observing capsule liveness passively rather than
polling. The kernel reaper is the second half of exit: the preemption timer drains the
zombie pending-list and finalizes each dead process, reclaiming its memory. This page
documents both, and it completes the exit story the [lifecycle](/docs/subsystems/process/lifecycle/) page
began.

## Init, the userspace supervisor

`run_init` ([`src/userspace/init/entry.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L20)) is what pid 1 runs. It brings the whole
userland up in a fixed order and then hands off to its supervisor loop:

```
  run_init() -> !:
      spawn ramfs, then the core capsules that depend on it
      spawn the display core, the drivers, the vfs, the network stack
      spawn the desktop, the market, the apps
      lower_init_priority()      init drops to Priority::Low
      yield_after_spawns()       yield repeatedly to let them start
      launch_final_payload()
      init_loop()                the residual supervisor loop
```

The spawn order is a dependency order: the ramfs comes up first because later capsules
stage in it, the display core and drivers before the desktop that draws on them, the
network stack before the capsules that use it. Each is a [verified
spawn](/docs/security/capsules-and-trust/). Once everything is running, init lowers
its own priority to `Low` so it never competes with the capsules it launched, yields to
let them initialise, and enters the loop.

## The init loop

`init_loop` ([`src/userspace/init/supervisor/loop_impl.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L25)) is deliberately light, and
its doc comment states the liveness philosophy exactly:

```
  init_loop() -> !:
      loop:
          if a second has passed since the last tick:
              services::lifecycle::tick()
          yield_now()
```

It ticks the service lifecycle registry once per second and otherwise yields. The key
design point is what it does not do: the kernel does not actively probe capsules for
liveness. A capsule that has exited is observed as dead on its next IPC, through the
process state machine that already tracks it, so there is no health-check traffic and no
polling thread. The supervisor's job is to walk the lifecycle registry on a slow tick,
not to interrogate every capsule.

## The reaper: the second phase of exit

When a process exits, [teardown](/docs/subsystems/process/lifecycle/) marks it a zombie, releases its broker
resources, takes it off the run queue, and enqueues its pid on a pending list
([`src/process/exit/pending.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/exit/pending.rs#L18)). The pending list is drained and finalized by the
kernel reaper, and the reaper is driven by the preemption timer. On each tick the timer
interrupt calls `drain_pending_teardowns` ([`src/interrupts/isr/timer_trampoline.rs:193`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/isr/timer_trampoline.rs#L193)),
which is `drain`:

```
  drain():
      try_lock the pending list, else return           non-blocking in the ISR
      if empty, return
      take all pending pids
      for each: finalize_teardown(pid)
```

The `try_lock` matters: the reaper runs in the timer interrupt, so it must never block on
the pending-list lock, and if it cannot take it this tick it simply reaps on the next
one. Zombies are therefore finalized promptly, on the next timer tick after they are
enqueued, without a dedicated reaper thread.

## Finalizing a process

`finalize_teardown` ([`src/process/exit/finalize.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/exit/finalize.rs#L11)) does the reclaim that teardown
deferred:

```
  finalize_teardown(pid):
      address_space::lifecycle::release(pcb)      free and zero the frames
      release broker resources for the pid         devices, IRQ, DMA, PIO (again)
      unregister the pid's service endpoints
      unregister the pid's IPC inbox
      clear its interrupt context and FPU state
      reparent_orphans(pid)
      PROCESS_TABLE.terminate_process(pid)          remove it from the table
```

The first step is where a capsule's memory is actually scrubbed: `release` clears the
VMAs and calls the ASID-scoped cleanup that frees the leaf frames and page tables, and
every freed frame is zeroed on the way out, which is the mechanism behind the
[ZeroState guarantee](/docs/subsystems/memory/zeroization/). The broker release runs a second time
here, idempotently, so nothing the process held survives even if teardown was partial.
Its service endpoints and IPC inbox are unregistered so no message can be routed to a
dead process, its saved interrupt and FPU state are cleared, and finally its entry is
removed from the [process table](/docs/subsystems/process/process-table/).

## Reparenting orphans

Before the process leaves the table, `reparent_orphans(pid)` moves any children it still
has to a surviving parent, so a process that exits with live children does not leave them
pointing at a pid that is about to be freed. This is the standard orphan-reparenting a
process model needs, run at the moment the parent is finalized rather than left for the
children to discover.

## Security analysis

The supervisor and reaper sit at two trust levels, and the split is the point: init is unprivileged
userspace that only spawns and observes, while the reaper is the kernel half that actually reclaims and
scrubs. Three properties matter.

**The reaper never blocks the timer.** `drain` runs in the timer interrupt via
`drain_pending_teardowns` (`timer_trampoline.rs:193`) and takes the pending list with `try_lock`, not a
blocking lock (`pending.rs:26`): if it cannot take the list this tick it simply reaps on the next one.
This is the same interrupt discipline the [usercopy](/docs/subsystems/memory/usercopy/) and preemption paths use, a
path that runs at interrupt priority must never wait on a lock, and it means a contended pending list
delays a reap by one tick rather than wedging the timer.

**Finalize revokes and scrubs, idempotently.** `finalize_teardown` (`finalize.rs:11`) repeats every
broker release from teardown, the device claim, IRQ, DMA, and PIO `release_all_for_pid` calls, so nothing
the process held survives even if teardown was partial, and it clears the pid's saved interrupt and FPU
state (`clear_interrupt_context`, `clear_fpu_state`) so no stale register state is carried by a reused
pid. Its first step, `address_space::lifecycle::release`, is where the frames are actually freed and
zeroed, which is the mechanism behind the [ZeroState guarantee](/docs/subsystems/memory/zeroization/). It also
unregisters the pid's service endpoints and IPC inbox before removing it from the table, so no message
can be routed to a dead process.

**No live children left pointing at a freed parent.** `reparent_orphans(pid)` ([`core/init.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/core/init.rs#L40)) runs
before the parent leaves the table, moving any surviving children to a live parent, so a process that
exits with children does not leave them referencing a pid about to be freed. The honest boundary: init's
liveness model is passive by design. It does not probe capsules; a dead capsule is observed on its next
IPC through the state machine that already tracks it, so a capsule that exits and is never contacted
again is simply never noticed as dead by init, and it is the reaper, driven by the exit path enqueueing
it, not init, that reclaims its memory. Init running at `Priority::Low` means it never competes with the
capsules it launched, but it also means a busy system can starve the once-per-second lifecycle tick,
which the fairness discussion on the [selection](/docs/subsystems/scheduler/selection/) page frames.

## Debugging the supervisor and reaper

A process wedged in `Zombie` and never reaching `Terminated` is the headline reaper failure: the
pending list is not draining. The two causes are the timer not firing `drain_pending_teardowns` at all,
no ticks, or the `try_lock` in `drain` losing every tick to a held pending-list lock, in which case
zombies pile up but each individual reap still eventually runs. Because `drain` reaps all pending pids it
manages to take in one pass, a single stuck zombie is more likely a `finalize_teardown` that faulted
partway than a drain that never ran. A capsule's memory not being scrubbed after exit points at
`finalize_teardown`'s first step, `address_space::lifecycle::release`, not reaching the frame free, since
that is the only place the zeroing happens. A message routed to a dead pid, or an endpoint that still
resolves after exit, means `unregister_endpoints_for_pid` or `unregister_for_pid` did not run, which is a
finalize that returned early. On the init side, a system that boots but a later capsule never starts is a
spawn-order problem in `run_init` (`entry.rs:20`), a dependency spawned after the capsule that needs it,
and a lifecycle tick that stops advancing is init being starved at `Priority::Low` rather than the loop
itself failing.

## Source map

```
  src/userspace/init/entry.rs                    run_init, the capsule spawn order
  src/userspace/init/supervisor/loop_impl.rs      the init supervisor loop
  src/process/exit/pending.rs                     the zombie pending-list and drain
  src/process/exit/finalize.rs                    finalize_teardown
  src/interrupts/isr/timer_trampoline.rs          the timer-driven reap
  src/process/core/init.rs                        reparent_orphans
```

Every reference above is verified against those trees. The first phase of exit that enqueues the zombie
is on the [lifecycle](/docs/subsystems/process/lifecycle/) page; the broker releases finalize repeats are on the
[claim](/docs/subsystems/hardware-broker/claim/) page; the frame zeroing behind reclaim is on the
[zeroization](/docs/subsystems/memory/zeroization/) page; and the `Priority::Low` fairness note ties to the
[selection](/docs/subsystems/scheduler/selection/) page.
