---
title: "The Process Lifecycle"
description: "A process moves through a fixed set of states from the moment it is created to the moment its memory is reclaimed."
weight: 4
---
A process moves through a fixed set of states from the moment it is created to the
moment its memory is reclaimed. This page documents the states, how a process is
created in a runnable but not-yet-running state, how it runs and blocks, and how it
exits in two phases: a teardown that releases everything it held and marks it a
zombie, and a reap that frees and zeros its memory. The state enum is in
[`src/process/core/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/core/types.rs), creation is in the [verified-spawn
gate](/docs/security/capsules-and-trust/), and exit is under `src/process/exit/`.

## The states

```
  ProcessState
    New              constructed, not yet runnable
    Ready            in the run queue, waiting for a CPU
    Running          executing on a CPU
    Sleeping         blocked on a wait, off the run queue
    Stopped          stopped, typically by a signal
    Zombie(code)     exited, resources released, awaiting reap
    Terminated(code) fully torn down
```

`Running`, `Ready`, and `Sleeping` are the three the [scheduler](/docs/subsystems/scheduler/)
moves a process between during its life; `Zombie` and `Terminated` are the two ends
of exit. The `Zombie` and `Terminated` variants carry the exit code, so a parent
reaping a child reads the code from the state itself.

## Creation

A process is not born running. The [verified-spawn](/docs/security/capsules-and-trust/)
install path creates the `ProcessControlBlock` in the `Ready` state, loads the ELF into
a fresh address space, installs exactly the verified capability bits, allocates the
kernel and user stacks, builds the initial user context as the PCB's
`pending_user_entry`, registers the capsule's endpoints, and adds the pid to the tail
of the run queue. Nothing about the process runs until the scheduler reaches it, and
the first time it does, the [context switch](/docs/subsystems/process/context-switch/) consumes
`pending_user_entry` to drop it to ring 3 at its ELF entry point. Creation therefore
produces a fully-formed, authority-bearing, runnable process that has executed no
instructions yet.

## Running and blocking

Once runnable, the process alternates between `Ready` and `Running` under the
scheduler: it is dispatched to a CPU, runs until it yields or is preempted, and goes
back on the run queue. When it waits, on an [IPC](/docs/subsystems/ipc/) receive with nothing
queued, an IRQ, or an explicit sleep, it transitions to `Sleeping` and comes off the
run queue entirely, so a blocked capsule does not spin. A later delivery or a passed
deadline wakes it back to `Ready`. The [scheduler](/docs/subsystems/scheduler/) page documents
those transitions and the sleep and wake machinery in full.

## Exit, phase one: teardown

Exit begins at `exit_and_yield` ([`src/process/exit/exit_and_yield.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/exit/exit_and_yield.rs#L26)), and its doc
comment names every site that calls it: the `MkExit` syscall, the default action of a
kill signal, and the ring-3 fault handlers, in other words every place where the
capsule's user address space is gone and there is nowhere for an `iretq` to return to.
It tears the current process down and then yields forever, since the context it was
called from is dead:

```
  exit_and_yield(exit_code, by_signal) -> !:
      teardown(current_pid, exit_code, by_signal)
      loop: select_next_process and switch to it, else idle the CPU
```

`teardown` ([`src/process/exit/teardown.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/exit/teardown.rs#L21)) does the release work and is idempotent,
returning immediately if the process is already a zombie or terminated:

```
  teardown(pid, exit_code, by_signal):
      if already Zombie or Terminated -> return
      release surfaces owned by the pid, and forget its attach mappings
      release every broker resource: devices, IRQs, DMA, PIO grants
      defer the kernel-stack release (cannot free the stack it is on)
      store the exit code, set state = Zombie(exit_code)
      remove the pid from the run queue and clear it as current
      clear its preemption ticks
      enqueue the pid for the reaper
```

The order matters for correctness. A dying capsule's [broker](/docs/subsystems/hardware-broker/)
grants, its claimed devices, bound IRQs, DMA buffers, and port-IO grants, are all
released here, so a device a crashed driver held is returned rather than stranded. Its
[surfaces](/docs/subsystems/graphics/) are released. The kernel stack cannot be freed while the
CPU is still executing on it, so its release is deferred. Only then is the process
marked `Zombie`, taken off the run queue, and enqueued for the reaper. After teardown
returns, `exit_and_yield` never comes back: it selects another process and switches to
it, or idles.

## Exit, phase two: reap

Teardown leaves the process a zombie with its resources released but its memory still
mapped. The reaper drains the pending list and reclaims that memory through
`address_space` release, which clears the process's VMAs and then calls
`cleanup_address_space(asid)` ([`src/process/address_space/lifecycle/release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/address_space/lifecycle/release.rs)). That
ASID-scoped teardown frees the leaf frames and the page tables through
`frame_alloc::deallocate_frame`, and every freed frame is zeroed by `zero_frame` on the
way out. This is the point at which a capsule's memory is actually scrubbed, and it is
why the [ZeroState guarantee](/docs/subsystems/memory/zeroization/) is the composition of exit
returning the frames and the allocator zeroing them, rather than a dedicated exit-time
wipe. Once its memory is reclaimed and its exit code collected, the process's entry is
removed from the [process table](/docs/subsystems/process/process-table/).

## Direct termination

Separately from the two-phase exit, `terminate(code)` on the PCB
([`src/process/core/pcb.rs:193`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/core/pcb.rs#L193)) records the exit code and sets the state directly to
`Terminated(code)` in one step. This is the harder, immediate transition used where a
process must be marked dead without going through the graceful teardown, and it is the
state a reaped process ends in.

## Security analysis

The lifecycle is where a capsule's authority is granted and, more importantly, where it is taken back.
An exit that leaves anything behind is an authority leak, so the teardown ordering is the security
property, not just housekeeping. Three properties hold.

**Exit revokes every hardware authority the capsule held.** `teardown` (`teardown.rs:21`) calls
`release_all_for_pid` across all four broker grant classes: the device claims (`broker::release_all_for_pid`),
bound IRQs (`irq_release_all_for_pid`), DMA buffers (`dma_release_all_for_pid`), and port-IO grants
(`pio_release_all_for_pid`), plus the surfaces the pid owned. So a device a crashed driver held is
returned rather than stranded, and because the claim table drops the claim, no stale grant handle from
the dead pid can be replayed. This is the process-side half of the [broker claim](/docs/subsystems/hardware-broker/claim/)'s
`release_all_for_pid` contract. The reaper repeats every one of these releases idempotently in
`finalize_teardown`, so nothing survives even if the first pass was partial.

**Teardown is idempotent and self-fencing.** `teardown` returns immediately if the process is already
`Zombie` or `Terminated` (`teardown.rs:26`), so a double exit, an `MkExit` racing a kill signal racing a
fault, releases resources exactly once. It marks the process `Zombie`, removes it from the run queue, and
clears it as current before enqueueing it for the reaper, so a dead pid cannot be selected again. The
kernel stack it is still executing on cannot be freed inline, so that release is deferred rather than
skipped, which avoids freeing the ground under the running context.

**Memory is scrubbed on reclaim, not merely unmapped.** The zombie still has its frames mapped after
teardown; the reaper's `address_space::lifecycle::release` clears the VMAs and calls
`cleanup_address_space(asid)` ([`address_space/lifecycle/release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/address_space/lifecycle/release.rs)), which frees every leaf frame and
page table through `frame_alloc::deallocate_frame`, and each freed frame is zeroed by `zero_frame` on the
way out. This is why the [ZeroState guarantee](/docs/subsystems/memory/zeroization/) is the composition of exit
returning frames and the allocator zeroing them, not a dedicated wipe. The honest boundary: the scrub
happens at reclaim time on the reaper's tick, so between teardown and reap the frames are unmapped from
the dead process but not yet zeroed; they are not reachable by any live capsule in that window because
they are no longer in any live address space, but the zeroing is a reclaim event, not an exit event.

## Debugging the lifecycle

The state itself is the primary diagnostic: a process wedged in `Zombie(code)` has been torn down but
not yet reaped, which points at the reaper not running, the timer-driven `drain` never draining the
pending list (see the [supervisor](/docs/subsystems/process/supervisor/) page). A process stuck in `Sleeping` that should have
woken is a lost wakeup, traced on the [sleep and wake](/docs/subsystems/scheduler/sleep-wake/) page, not here. The
exit code travels inside the state, `Zombie(-1)` or `Terminated(-1)` is the sentinel the context-switch
path writes when a process has no kernel stack, so a capsule that dies at first entry with code `-1`
rather than its own exit code was killed by the [context switch](/docs/subsystems/process/context-switch/), not by its own
`MkExit`. A leaked device after a driver crash, the device still shows `AlreadyClaimed` to a fresh
driver, means teardown's broker release did not run or the pid was never marked exiting; because the
release is by pid, the check is whether `teardown` was reached for that pid at all, and the idempotent
repeat in `finalize_teardown` is the backstop. `exit_and_yield` never returns by construction
(`exit_and_yield.rs:26`), so if a caller appears to continue past it, the call was skipped, not the exit.

## Source map

```
  src/process/core/types.rs                          the ProcessState enum
  src/process/exit/exit_and_yield.rs                  the exit entry point
  src/process/exit/teardown.rs                        the resource-release teardown
  src/process/exit/pending.rs                         the reaper's pending list
  src/process/address_space/lifecycle/release.rs      address-space reclaim
  src/kernel_core/process_spawn/capsule_spawn/        creation (verified spawn install)
```

Every reference above is verified against those trees. The reaper that drains the pending list and runs
`finalize_teardown` is on the [supervisor](/docs/subsystems/process/supervisor/) page; the broker `release_all_for_pid` this
path drives is on the [claim](/docs/subsystems/hardware-broker/claim/) page; the frame zeroing behind reclaim is on
the [zeroization](/docs/subsystems/memory/zeroization/) page; and the PCB whose state field these transitions move is
on the [PCB](/docs/subsystems/process/pcb/) page.
