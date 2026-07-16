---
title: "The Process Table"
description: "The process table holds every live process, a per-CPU current-pid tracks which process is running on each CPU, and a small allocator hands out process ids."
weight: 3
---
The process table holds every live process, a per-CPU current-pid tracks which
process is running on each CPU, and a small allocator hands out process ids. This
page documents the table and its queries, the per-CPU current process, PID
allocation, and the creation path that builds a `ProcessControlBlock` and registers
it. The code is under `src/process/core/table/`.

## The table

The table is a vector of reference-counted PCBs behind a reader-writer lock
([`src/process/core/table/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/core/table/types.rs#L56)):

```
  ProcessTable { inner: RwLock<Vec<Arc<ProcessControlBlock>>> }
  static PROCESS_TABLE: ProcessTable = ...
```

Every process is an `Arc<ProcessControlBlock>`, so the table shares ownership rather
than holding the only copy, and a caller that looks a process up gets an `Arc` it can
hold across a lock drop. The queries are all linear scans under the read lock
(`types.rs:60`):

```
  add(pcb)                 push a new process
  find_by_pid(pid)         the PCB with that pid, if live
  get_all_processes()      a clone of the whole vector
  get_children_of(ppid)    every process whose parent is ppid
  has_children(pid)        whether any process has this pid as parent
  is_active_pid / is_active_name   membership tests
```

The structure is a plain vector, so lookups are `O(n)` in the number of live
processes. That is a deliberate fit for the workload: a NØNOS system runs on the order
of dozens of capsules, not thousands of processes, so a linear scan under a shared
read lock is simpler and contends less than a map would, and the read lock lets the
common case, many concurrent lookups, proceed in parallel.

## The current process, per CPU

Which process is running is not a single global; it is per-CPU
(`types.rs:25`):

```
  CurrentPid { slots: [AtomicU32; MAX_CPUS] }
  static CURRENT_PID: CurrentPid = ...
```

`load`, `store`, and `swap` all operate on `slots[cpu_id()]`, the slot for the CPU
making the call, so each core independently records the process it is currently
running. This is what makes "the current process" correct under SMP: two cores can run
two different processes at the same time, and each reads its own current pid from its
own slot with no coordination. The [scheduler](/docs/subsystems/scheduler/) updates this slot on
every context switch, and `current_pid()` throughout the kernel reads it.

## PID allocation

New ids come from a monotonic counter with wraparound and a liveness check
(`types.rs:93`):

```
  allocate_tid():
      lock the PID allocation mutex
      loop:
          current = NEXT_PID
          NEXT_PID = (current >= u32::MAX - 1) ? 1 : current + 1
          pid = current == 0 ? 1 : current
          if pid is not an active pid -> return Some(pid)
          after 65536 attempts -> log exhaustion, return None
```

`NEXT_PID` starts at 1 and advances on each allocation, wrapping back to 1 rather than
overflowing. Because the space wraps, a candidate id could still belong to a live
process, so the allocator checks `is_active_pid` and skips it, and it gives up after a
bounded number of attempts rather than looping forever if the space is genuinely full.
The allocation is serialised by a dedicated mutex so two cores cannot hand out the same
id.

## Creating a process

`create_process` builds a PCB and registers it ([`src/process/core/table/create.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/core/table/create.rs#L26)):

```
  create_process_with_mem(name, state, prio, mem_kb):
      if name is empty -> Err
      pid = NEXT_PID.fetch_add(1)
      parent = current pid
      caps = compute_inherited_caps(pid, parent)
      pcb = build_pcb(pid, parent, name, state, prio, mem_kb/4, caps)
      address_space::lifecycle::allocate(pcb)
      caps::rebind_address_space(pcb)          re-mint the token with the real ASID
      PROCESS_TABLE.add(pcb)
```

The new process inherits its capabilities from its parent through
`compute_inherited_caps`, then `build_pcb` constructs the full control block, an address
space is allocated for it, and its capability token is re-minted so `subject_asid`
reflects the real address space rather than the zero the base mint left. That re-mint
returns an error if the boot session nonce is not yet set, so a process cannot be
created without it, the same fail-closed rule the [signing path](/docs/security/signing-and-mac/)
enforces. Only after all of that does the PCB join the table. Note that this is the
generic process constructor; a verified capsule goes through the
[spawn pipeline](/docs/security/capsules-and-trust/), which additionally swaps the
inherited token for the manifest-derived one through the one-shot `install_spawn` gate.

## The initial control block

`build_pcb` (`create.rs:76`) sets every field's initial value, and several of the
defaults are worth stating because they are security-relevant:

```
  token           minted for pid over the inherited caps (fail-closed on boot nonce)
  io_bitmap       [0xFF; 8192]     every port denied; a PIO grant clears bits to allow
  kernel_stack_top 0               no user mode until a kernel stack is allocated
  pending_user_entry / saved_user_context   None
  exit_signal     17               SIGCHLD to the parent on exit
  cpus_allowed    !0               all CPUs
  umask           0o022            root_dir and cwd "/"
  memory.next_va  0x0000_4000_0000  the base mmap hands out from
```

The io_bitmap default is the important one: it is all ones, which on x86 means every
port is denied, so a fresh process has no port-IO permission at all, and a
[PIO grant](/docs/subsystems/hardware-broker/) works by clearing the specific bits it authorises.
`kernel_stack_top` starts zero, which the scheduler reads as "no user mode expected"
until a kernel stack is allocated, and the token is minted at construction so the PCB is
never live without authenticated authority.

## Threads versus processes

`spawn_thread` (`create.rs:58`) creates a schedulable thread inside the current process
rather than a new process. The thread inherits the parent's address space through
`address_space::lifecycle::inherit`, so it runs on the same CR3, joins the parent's
thread group by copying its `tgid`, and takes a caller-provided user entry point and
stack. The distinction that matters for teardown is stated in the source comment: a
thread has no VMAs of its own, so tearing it down frees nothing of the shared address
space, which belongs to the process and is only reclaimed when the last member exits.
Unlike a process, a thread is given its kernel stack and initial user context inline
and added straight to the run queue.

## Security analysis

The table decides what "the current process" means and hands out the identity every authority check keys
on, so its correctness under SMP and its no-live-without-a-token rule are the security properties. Three
hold.

**Per-CPU current pid, no cross-core confusion.** `CURRENT_PID` is not a global; it is
`[AtomicU32; MAX_CPUS]` (`types.rs:25`), and `load`, `store`, and `swap` all index `slots[cpu_id()]`, the
calling CPU's own slot. So two cores running two processes each read their own current pid with no
coordination, and no core can be tricked into acting as another core's current process. Every kernel path
that asks "who is calling" resolves it through this per-CPU slot, which is what makes an authority check
attributed to the right capsule under real parallelism.

**A process never joins the table without an authenticated token.** `create_process`
([`table/create.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/create.rs#L26)) builds the PCB with a token minted for the pid, then re-mints it through
`caps::rebind_address_space` so `subject_asid` reflects the real address space, and only then calls
`PROCESS_TABLE.add`. The re-mint fails closed if the boot session nonce is not set, so a process cannot
be created before the session is established, the same fail-closed rule the
[signing path](/docs/security/signing-and-mac/) enforces. `build_pcb` (`create.rs:76`) sets the
security-relevant defaults: `io_bitmap` all-ones (every port denied), `kernel_stack_top` zero (no user
mode until a stack is allocated), and a token minted at construction, so a PCB is never live without
authority.

**PID allocation cannot collide across cores or alias a live process.** `allocate_tid`
(`types.rs:93`) advances `NEXT_PID` under a dedicated mutex, so two cores cannot hand out the same id, and
because the u32 space wraps back to 1 rather than overflowing, a candidate could still name a live
process; the allocator checks `is_active_pid` and skips it, giving up after `MAX_ATTEMPTS` (65536) rather
than looping forever. The honest boundary: the queries are `O(n)` linear scans under a read lock, which
is a deliberate fit for dozens of capsules, not thousands of processes, and the table shares ownership
through `Arc`, so a lookup returns an `Arc` a caller can hold across a lock drop. A pid returned by a
lookup is a live-at-lookup snapshot; the process can exit while the caller holds the `Arc`, which keeps
the PCB alive but does not keep it schedulable.

## Debugging the process table

The wrong current pid on one CPU under SMP, an authority check attributed to the wrong capsule, points
straight at the per-CPU `CURRENT_PID` slot and whether the [scheduler](/docs/subsystems/scheduler/) updated
`slots[cpu_id()]` on the last switch rather than a global. PID allocation returning `None` is the
exhaustion path: `allocate_tid` logs `[PROCESS] PID space exhausted after 65536 attempts`
(`types.rs:107`) when every candidate in a full sweep was already active, which on a dozens-of-capsules
system means pids are being allocated but never reaped, so the trail leads to the reaper, not the
allocator. A process that seems to exist but no lookup finds it, or the reverse, is an `add` that never
ran or a `terminate_process` that ran early: `find_by_pid` scans only live entries, so a pid missing from
`get_all_processes` was either never added, created before the boot nonce (the fail-closed `create_process`
error), or already removed by finalize. A capsule that comes up with unexpected port access or reaches
user mode when it should not is a `build_pcb` default gone wrong: the two to check are `io_bitmap`
(all-ones is correct) and `kernel_stack_top` (zero until a stack is allocated).

## Source map

```
  src/process/core/table/types.rs    ProcessTable, CurrentPid, PID allocation
  src/process/core/table/create.rs   create_process, spawn_thread, build_pcb
  src/process/core/table/inherit.rs  compute_inherited_caps
  src/process/core/table/ops.rs      the table operation wrappers
```

Every reference above is verified against those trees. The per-CPU current pid is updated by the
[scheduler](/docs/subsystems/scheduler/selection/) on every switch; the token minted at creation and its fail-closed
rule are on the [capability](/docs/security/capabilities-and-tokens/) and
[signing](/docs/security/signing-and-mac/) pages; the verified capsule path that swaps the inherited
token for the manifest one is on the [capsule trust](/docs/security/capsules-and-trust/) page; and the
`build_pcb` defaults are read on the [PCB](/docs/subsystems/process/pcb/) and [context switch](/docs/subsystems/process/context-switch/) pages.
