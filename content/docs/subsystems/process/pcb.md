---
title: "The Process Control Block"
description: "Every process in NØNOS is a ProcessControlBlock (src/process/core/pcb.rs:31)."
weight: 2
---
Every process in NØNOS is a `ProcessControlBlock` ([`src/process/core/pcb.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/core/pcb.rs#L31)). It
is a large structure, and this page organises it by concern rather than listing it
top to bottom: identity, scheduling, address space, authority, the kernel-to-user
transition, files, signals, and the POSIX-shaped bookkeeping. Two groups are the
NØNOS-specific core, the authority fields and the transition fields, and the rest
give a process the Linux-shaped semantics that let unmodified user code run. The
whole structure is shared behind `Arc`, so its fields are individually synchronised:
atomics for single hot values, a `Mutex` for state mutated together, and an `RwLock`
for the read-heavy capability token.

## Identity and hierarchy

```
  pid    Pid          the process id, immutable
  tgid   AtomicU32    thread-group id (the thread leader's pid)
  ppid   AtomicU32    parent pid
  pgid   AtomicU32    process-group id
  sid    AtomicU32    session id
  name   Mutex<String>
  thread_group  Option<Arc<ThreadGroup>>
```

`pid` is the only identity field that never changes; the rest of the hierarchy is
atomic so it can be reparented or moved between groups and sessions without a lock.
The `thread_group`, when present, is a shared `ThreadGroup` that the thread-related
predicates consult: `is_thread` is true when the group has more than one member or
this pid is not the group's `tgid`, and `is_group_leader` is true when this pid leads
its group (`pcb.rs:205`).

## Scheduling

```
  state       Mutex<ProcessState>    Ready, Running, Sleeping, Terminated, ...
  priority    Mutex<Priority>        Idle, Low, Normal, High, RealTime
  nice        AtomicI32              POSIX nice value
  rt_priority AtomicU32              realtime priority
  policy      AtomicU32              scheduling policy
  processor   AtomicU32              last CPU it ran on
  cpus_allowed AtomicU64             affinity mask
  voluntary_switches / involuntary_switches   AtomicU64
  wchan       AtomicU64              what it is blocked on
```

`state` and `priority` are the two the [scheduler](/docs/subsystems/scheduler/) reads on every
selection, held under `Mutex` because a state transition often changes more than one
thing at once. The switch counters and `processor` are the scheduler's own
bookkeeping, and `cpus_allowed` bounds which CPUs the process may run on.

## Address space

```
  memory      Mutex<MemoryState>      code range, VMAs, resident page count
  mmap_va     Mutex<MmapVa>           the mmap-region allocator
  cr3         AtomicU64               this process's page-table root
  memory_info Mutex<ProcessMemoryInfo>
  stack_base  AtomicU64
  tls_base    AtomicU64
```

`memory` is the record the [fault handlers](/docs/subsystems/memory/faults/) and the exit
teardown walk: it holds the code range and the virtual memory areas. `cr3` is the
page-table root loaded on a context switch into this process, and `mmap_va` tracks
the region from which `mmap` hands out addresses. `tls_base` and `stack_base` have
their own atomic accessors so the thread-local and stack pointers can be read and set
without taking the memory lock.

## Authority

These four fields are the runtime side of the [capability model](/docs/security/capabilities-and-tokens/),
and the source comments state their contract exactly (`pcb.rs:44`):

```
  capability_token        RwLock<Arc<CapabilityToken>>   the source of truth
  caps_bits               AtomicU64                       a derived bitmap cache
  caps_manifest_installed AtomicBool                      one-shot install gate
  revocation_epoch        AtomicU64                       per-capsule revoke counter
```

The `capability_token` is authoritative; `caps_bits` is a bitmap cache kept in sync by
`process::caps` so that the bitmap-only readers, IPC routing and inheritance, stay a
single atomic load rather than taking the token lock. `caps_manifest_installed` is the
one-shot gate: the PCB is born holding an inheritance-derived token, and
[verified spawn](/docs/security/capsules-and-trust/)'s `install_spawn` flips this flag
exactly once to swap in the manifest-derived token, so a stale spawn path cannot
re-issue authority. `revocation_epoch` is bumped by `process::caps::revoke` and minted
into every token, and the syscall [resolver](/docs/security/revocation/) compares a
token's epoch against it to reject authority minted before the most recent revoke.

## The kernel-to-user transition

These fields hold everything the architecture layer needs to enter or resume user
mode, and their comments are the authority on the multi-arch shape (`pcb.rs:100`):

```
  kernel_stack_top    AtomicU64            TSS RSP0; 0 means no user mode expected
  syscall_user_rsp    AtomicU64            user RSP captured on syscall entry
  pending_user_entry  Mutex<Option<UserEntry>>   first-entry-to-user record
  saved_user_context  Mutex<Option<SavedUser>>   preemption snapshot
  kstkesp / kstkeip   AtomicU64
  arch_fpu            (aarch64/riscv64 only)     per-PCB FP/SIMD slot
```

`kernel_stack_top` is the kernel stack installed into the TSS on a context switch, and
a value of zero is meaningful: it marks a process with no user mode expected, and the
scheduler hook refuses to dispatch a pending user entry for it. `pending_user_entry` is
the record consumed the first time the process drops to ring 3; on x86_64 it is the
`iretq` five-tuple, and on aarch64 and riscv64 it carries that architecture's entry
shape (ELR, SP_EL0, SPSR and the per-task kernel SP on aarch64; sepc, sstatus, user SP
and kernel SP on riscv64). `saved_user_context` is the snapshot the trap-entry path
writes when a user task is preempted, the general registers plus the return frame, and
it is what the resume path restores. `syscall_user_rsp` exists because a blocking
syscall parks the user RSP in per-CPU state, and if another task runs on the same CPU
before the syscall returns, that per-CPU slot has to be restored from the PCB. On
aarch64 and riscv64 the PCB carries a per-task FP/SIMD slot for the lazy-enable path,
while x86 keeps its FPU state in a pid-keyed side table instead, so there is no such
field there. This is where the process model and the [context switch](/docs/subsystems/process/context-switch/)
meet.

## Files, IPC, and signals

```
  fd_table    ProcessFdTable            open file descriptors
  umask       Mutex<u32>
  root_dir / cwd   Mutex<String>
  io_bitmap   Mutex<[u8; 8192]>          x86 port-IO permission bitmap
  reply_inbox RwLock<Option<&'static str>>   the process's IPC reply inbox
  signals     Mutex<SignalState>
  pending_signals  AtomicU64
  exit_signal / alarm_time_ms
```

The `fd_table` is the process's descriptor table, and `umask`, `root_dir`, and `cwd`
are the filesystem context. `io_bitmap` is the 8 KiB x86 port-IO permission bitmap
that backs [PIO grants](/docs/subsystems/hardware-broker/): a driver that holds a port grant has
the corresponding bits cleared here so the CPU permits its `in`/`out`. `reply_inbox`
is the name of the private [IPC](/docs/subsystems/ipc/) inbox this process receives replies on, and
`signals` with `pending_signals` is the POSIX signal state.

## Bookkeeping and compatibility

The remaining fields give a process the shape unmodified POSIX-style code expects:
`argv` and `envp`, `creds` (`ProcessCredentials`), `time_info` and `io_stats`,
`start_time_ms` and `exit_code`, `tty_nr` and `tty_pgrp`, `clone_flags`,
`clear_child_tid` and `set_child_tid`, `no_new_privs` and `seccomp`, `thread_count`,
and a `flags` word whose top bit is the continued flag managed by `was_continued`,
`set_continued`, and `clear_continued` (`pcb.rs:217`). A separate group of counters,
`zk_proofs_generated`, `zk_proving_time_ms`, `zk_proofs_verified`,
`zk_verification_time_ms`, and `zk_circuits_compiled`, tracks the process's use of the
in-kernel zero-knowledge machinery.

## Key methods

Beyond the field accessors, `terminate(code)` (`pcb.rs:193`) records the exit code and
sets the state to `Terminated(code)` in one step, `set_name` truncates a new name to
256 bytes, and the identity accessors (`pid`, `parent_pid`, `process_group`,
`session_id`, `thread_group_id`, `exit_status`) read their atomics with the
appropriate ordering. The lifecycle that creates and destroys a PCB is on the
[lifecycle](/docs/subsystems/process/lifecycle/) page, and the table that holds every live PCB is on the
[process table](/docs/subsystems/process/process-table/) page.

## Security analysis

The PCB is where a process's authority lives, so most of its security weight is in the authority group
and the kernel-to-user transition group, not the POSIX bookkeeping. Three properties matter.

**Authority is single-sourced and epoch-checked.** The `capability_token`
(`RwLock<Arc<CapabilityToken>>`, `pcb.rs:44`) is the source of truth; `caps_bits` is only a derived
bitmap cache kept in sync by `process::caps` so hot readers do a single atomic load instead of taking the
token lock. The two never disagree by construction because one mutator maintains both. Authority cannot
be re-granted quietly: `caps_manifest_installed` is a one-shot `AtomicBool` that
[verified spawn](/docs/security/capsules-and-trust/)'s `install_spawn` flips exactly once to swap the
inheritance-derived token for the manifest-derived one, so a stale spawn path cannot re-issue authority.
And `revocation_epoch`, bumped by `process::caps::revoke` and minted into every token, lets the syscall
[resolver](/docs/security/revocation/) reject a token whose epoch predates the most recent revoke, so
authority minted before a revoke is dead even if the token is still held.

**Port-IO authority defaults to none.** `io_bitmap` (`pcb.rs:100`) is the 8 KiB x86 permission bitmap
the CPU consults on `in`/`out`, and it is born all-ones, every port denied. A [PIO grant](/docs/subsystems/hardware-broker/)
works by clearing the specific bits it authorises, so a process with no grant can execute no port I/O at
all. This is least-authority made concrete in hardware: the default is deny, and the broker grant is the
only thing that opens a port.

**The kernel-to-user fields are what make ring transitions safe.** `kernel_stack_top` of zero is
meaningful (`pcb.rs:100`): it marks a process with no user mode expected, and the context-switch hook
refuses to drop it to ring 3 without a kernel stack for the next trap to land on. `pending_user_entry`
is consumed once on first entry so the transition is one-shot, and `syscall_user_rsp` exists precisely
because a blocking syscall parks the user RSP in per-CPU state that another task on the same CPU would
overwrite, so it has to be restored from the PCB. The honest boundary: the PCB is shared behind `Arc`
with per-field synchronisation (atomics, a `Mutex` for state mutated together, an `RwLock` for the
read-heavy token), so a field read outside its intended lock, or two fields expected to be consistent
read across a transition, sees per-field atomicity, not a snapshot of the whole block. The invariants
hold because each subsystem takes the field's own lock, not because the PCB is globally consistent.

## Debugging the PCB

Most PCB-level bugs surface as a mismatch between a field and the behaviour it should drive. A capsule
that is refused an operation it was granted, or granted one it was not, is a `caps_bits` versus
`capability_token` divergence: the token is authoritative, so read it, and if the bitmap disagrees the
bug is a mutation that touched one and not the other outside `process::caps`. A syscall that fails with a
revoked-authority error after the capsule believed it still held the capability is the `revocation_epoch`
check firing: the token was minted before the last `revoke`, which is correct behaviour, and the trace
to follow is who called `revoke`. A driver whose `in`/`out` faults with a general-protection despite
holding a port grant points at `io_bitmap`, the grant cleared the wrong bits or was never applied, since
the default of all-ones denies everything. A process that will not enter user mode is the
`kernel_stack_top == 0` case, read on the [context switch](/docs/subsystems/process/context-switch/) page. The `terminate(code)`
method (`pcb.rs:193`) sets `Terminated(code)` in one step, so a PCB in `Terminated` that skipped `Zombie`
went through direct termination rather than the graceful two-phase exit, which narrows where to look.

## Source map

```
  src/process/core/pcb.rs        the ProcessControlBlock and its methods
  src/process/core/types.rs      ProcessState, Priority, MemoryState, and the info types
  src/process/core/thread_group.rs   the shared ThreadGroup
  src/process/caps.rs             the authority-field mutators
```

Every reference above is verified against those trees. The authority fields tie into the
[capability model](/docs/security/capabilities-and-tokens/) and [revocation](/docs/security/revocation/);
the transition fields are consumed on the [context switch](/docs/subsystems/process/context-switch/) page; the `io_bitmap`
default is set during creation on the [process table](/docs/subsystems/process/process-table/) page; and the lifecycle that
constructs and tears down a PCB is on the [lifecycle](/docs/subsystems/process/lifecycle/) page.
