---
title: "The Context Switch"
description: "Switching into a process means one of three things: entering it for the very first time, which drops fresh to ring 3 at its ELF entry point; resuming a user context that was pre..."
weight: 5
---
Switching into a process means one of three things: entering it for the very first
time, which drops fresh to ring 3 at its ELF entry point; resuming a user context that
was preempted; or resuming a kernel context, a syscall that blocked and now continues.
The dispatcher decides which, and getting the priority wrong, resuming a stale user
frame when a live kernel continuation exists, is a real bug the code specifically
guards against. This page documents the dispatch, the first-entry path, and the per-CPU
state each touches. The code is under `src/arch/x86_64/context/switch/`, and it is the
x86_64 realisation of an arch-neutral operation.

## The three ways in

A process can be entered three ways, and the PCB carries the state for each. A
first entry consumes `pending_user_entry`, the frame built at creation. A user resume
restores `saved_user_context`, the snapshot the trap path wrote when the process was
preempted. A kernel resume restores a saved interrupt context for a pid that was inside
the kernel, typically blocked in a syscall, when it was scheduled out.

## The dispatcher

`switch_to_user_pcb_x86_64` ([`src/arch/x86_64/context/switch/dispatch.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/context/switch/dispatch.rs#L39)) picks the
right one in a fixed order:

```
  switch_to_user_pcb_x86_64(pid):
      pcb = find_by_pid(pid), else return
      if try_first_entry(pcb, pid)                     -> done
      if pid has a saved interrupt (kernel) context:
          resume_kernel_thread(pcb, pid)               -> done
      if try_resume(pcb, pid)                          -> done  (user context)
      resume_kernel_thread(pcb, pid)                    (fallback)
```

The order encodes a correctness rule the source states directly. A pid that blocked
inside a syscall can hold both a stale user-mode trap snapshot and a live kernel resume
context at once. The kernel context must win: resuming the stale user frame would
re-enter user mode at some arbitrary old RIP and skip the syscall continuation
entirely. So the dispatcher checks for a saved kernel context before it tries the user
resume, and only falls through to the user path when there is no kernel context to
continue. First entry is tried first because a freshly created process has a
`pending_user_entry` and nothing else.

## First entry

`try_first_entry` ([`src/arch/x86_64/context/switch/first_entry.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/context/switch/first_entry.rs#L28)) is the one-time
transition to ring 3, and it returns false if the process has no pending entry so the
dispatcher moves on:

```
  try_first_entry(pcb, pid):
      frame = pcb.pending_user_entry.take(), else return false
      kstack = pcb.kernel_stack_top
      if kstack == 0 -> state = Terminated(-1), return true
      install kstack as the TSS kernel stack for this CPU (gdt::set_kernel_stack)
        on failure -> Terminated(-1), return true
      set the per-CPU kernel stack
      if pcb.cr3 != 0:
          switch_to_process_address_space(pid)
          on failure (a thread with no ASID entry) load the inherited CR3 directly
      state = Running; CURRENT_PID = pid; reset the time slice to DEFAULT
      FPU: restore saved state if any, else init_fpu
      return_to_usermode(frame)      iretq to ring 3
```

Taking `pending_user_entry` makes the first entry one-shot: the frame is consumed, so a
later switch into the same process goes through the resume paths instead. The kernel
stack is a precondition, not an option: `kernel_stack_top` of zero means no kernel stack
was allocated, and rather than enter user mode with nowhere for a syscall or interrupt
to land, the process is marked `Terminated(-1)`. When a stack is present it is installed
as this CPU's TSS kernel stack (RSP0), which is where the CPU switches to on the next
trap from ring 3.

The address-space switch carries a thread special case. `switch_to_process_address_space`
looks the process up by pid to find its ASID and load its CR3, but a thread shares its
parent's address space and has no ASID entry of its own, so that lookup misses; the code
then loads the inherited CR3 directly. Only after the stack and address space are in
place does the process become `Running`, become this CPU's current pid, and get a fresh
time slice, and then `return_to_usermode` executes the `iretq` that drops to ring 3 at
the frame's entry point.

## Floating point

Just before entering user mode, first entry restores the process's saved FPU and SIMD
state if it has any, and otherwise calls `init_fpu` to bring the unit up from a clean
state (`first_entry.rs:61`). The clean init matters: a wrong initial `MXCSR` leaves SSE
exceptions unmasked and can trap every floating-point capsule, so `init_fpu` sets a
correct control word rather than leaving a zeroed one. The resume paths restore the
per-process FPU state the same way.

## Multi-architecture

The dispatch and first-entry logic here are x86_64. The state they consume,
`pending_user_entry` and `saved_user_context`, is defined per architecture in the PCB:
on x86_64 the entry is the `iretq` five-tuple and the snapshot is fifteen general
registers plus that frame; on aarch64 and riscv64 they carry that architecture's entry
and trap shape, and those backends have their own equivalents of `return_to_usermode`
and the resume path. The scheduler that decides which pid to switch to, and calls into
here, is arch-neutral; this file is where its decision becomes an actual ring transition
on x86_64.

## Security analysis

A context switch is a privilege boundary as much as a scheduling event: it decides where the CPU
lands next and in which address space, so a mistake here reads or runs one capsule's state under
another capsule's authority. Three properties keep it honest.

**No privilege escalation on entry.** The one path that drops to ring 3 is `try_first_entry`
(`first_entry.rs:28`), and it enters user mode only through `return_to_usermode`, an `iretq` over a
frame the process was created with, never a synthesised one. Before that `iretq` it makes the kernel
stack a hard precondition: `kernel_stack_top` of zero means no landing pad for the next trap, and rather
than enter ring 3 with nowhere for a syscall or interrupt to return, the process is marked
`Terminated(-1)` and the switch aborts. The TSS RSP0 is set to that stack (`gdt::set_kernel_stack`)
before the transition, so a trap from the new ring-3 code lands on a kernel stack the kernel chose, not
on whatever the capsule left in RSP.

**Address-space isolation is re-established before the process runs.** `try_first_entry` loads the
process's own page-table root, `switch_to_process_address_space(pid)` for a real address space
([`api/address_space.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/api/address_space.rs#L40)) or the inherited CR3 loaded directly for a thread, and only then sets state
`Running` and does the `iretq`. The CR3 is switched while still in the kernel half, so the incoming
capsule sees only its own low-half user mappings plus the shared high-half kernel; it cannot observe the
outgoing capsule's user pages because the root that mapped them is no longer live. A thread is the one
deliberate exception: it shares its parent's CR3 on purpose, which the resume comment states outright.

**The kernel continuation cannot be skipped.** The dispatch order in
`switch_to_user_pcb_x86_64` (`dispatch.rs:39`) checks `INTERRUPT_SAVED_CONTEXTS` for a saved kernel
context before it tries the user resume, because a pid that blocked inside a syscall can hold both a
stale user-mode trap snapshot and a live kernel resume context at once. Resuming the stale user frame
would re-enter ring 3 at an arbitrary old RIP and skip the syscall continuation, which is the bug the
ordering exists to prevent. The honest boundary: this file is the x86_64 realisation only. The
FPU/SIMD restore is state-clearing, not a covert-channel scrub, and cross-CPU consistency of the saved
contexts rests on the map's own locking, not on anything this path adds.

## Debugging the context switch

The dispatcher emits a `[DISPATCH]` serial trace (`dispatch.rs:26`) that names which of the three ways
in it took for a given pid: `kernel ctx`, `user ctx`, or `fallback kernel`. The trace is gated to a
handful of pids and the first 64 events, so it is a bring-up aid, not a running log, but it is the first
thing to read when a process is entered wrong. A capsule that was mid-syscall and comes back running at
the wrong instruction is the classic symptom of the priority rule being violated: expect `kernel ctx`
in the trace, and a `user ctx` there for a pid that should have resumed in the kernel is the bug. A
process that vanishes the instant it is first scheduled, never reaching its ELF entry, is almost always
the kernel-stack precondition firing: `try_first_entry` marks it `Terminated(-1)` when
`kernel_stack_top` is zero or `gdt::set_kernel_stack` fails, so the process is dead before the `iretq`,
and the thing to check is whether creation allocated its kernel stack. A fault taken during the switch
itself, a page fault as the new CR3 loads or the `iretq` frame is read, points at a corrupt
`pending_user_entry` or a CR3 that does not map the entry point; because the FPU is brought up from a
clean `init_fpu` when the process has no saved state (`first_entry.rs:61`), a floating-point capsule
that traps immediately on entry instead points back at the MXCSR init, not at the switch.

## Source map

```
  src/arch/x86_64/context/switch/dispatch.rs     the dispatch and its priority rule
  src/arch/x86_64/context/switch/first_entry.rs   the one-time entry to ring 3
  src/arch/x86_64/context/switch/resume.rs        resuming a preempted user context
  src/arch/x86_64/context/switch/kernel_thread.rs  resuming a kernel context
  src/process/scheduler/selection/switching.rs     the scheduler-side switch
```

Every reference above is verified against those trees. The PCB fields this path consumes,
`pending_user_entry`, `saved_user_context`, `kernel_stack_top`, `cr3`, are documented on the
[PCB](/docs/subsystems/process/pcb/) page; the scheduler decision that calls in here is on the
[selection](/docs/subsystems/scheduler/selection/) and [preemption](/docs/subsystems/scheduler/preemption/) pages; and the
address-space root it loads is set up during creation on the [lifecycle](/docs/subsystems/process/lifecycle/) page.
