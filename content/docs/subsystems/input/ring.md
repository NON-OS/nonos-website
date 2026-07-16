---
title: "The Input Ring"
description: "All input in NØNOS funnels through one bounded ring in the kernel."
weight: 1
---
All input in NØNOS funnels through one bounded ring in the kernel. Driver capsules post events
into it; a single router capsule drains it. The kernel owns only this ring, the sequence counter,
and the single wakeup slot; the policy of routing events to windows lives in the router capsule.
This page documents the ring. The code is [`src/kernel_core/surface_registry/input_ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs), and the
event layout and capacity live in [`src/kernel_core/surface_registry/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/types.rs).

## A bounded MPSC ring

The ring is multi-producer, single-consumer: many driver capsules (keyboard, mouse, touch) post,
and one `input_router` capsule drains. It is a fixed array behind a `spin::Mutex`
(`input_ring.rs:27` for the struct, `input_ring.rs:33` for the static):

```
  struct Ring {
      head: usize,                       // producer index, next slot to write
      tail: usize,                       // consumer index, next slot to read
      buf:  [InputEvent; INPUT_RING_CAP] // INPUT_RING_CAP = 1024
  }
```

`head` is the write cursor and `tail` is the read cursor, both plain `usize` fields protected by the
mutex rather than atomics (`input_ring.rs:28-29`). The buffer is a flat array of 1024 `InputEvent`
values allocated inline in the static, so there is no heap and no allocation on the input path. The
capacity constant is `INPUT_RING_CAP = 1024` in `types.rs:18`; it is a fixed compile-time size, and
the ring stores at most `INPUT_RING_CAP - 1 = 1023` live events because the head-meets-tail
condition is reserved to mean full (see Posting below).

Both posting and draining take the same mutex, but each critical section is short: a post writes one
event and advances one index, a drain copies a bounded batch. The single-consumer side means the
router capsule does its own per-source fan-out after draining, keeping that policy out of the
kernel. That intent is stated in the module comment at `input_ring.rs:22-25`.

## The event record

Each slot is an `InputEvent`, a `#[repr(C)]` `Copy` struct (`types.rs:42-53`):

```
  struct InputEvent {
      kind:         u16    // event class, set by the producing driver
      flags:        u16    // modifier / state bits, set by the producing driver
      code:         u32    // key code, button, or scancode
      x:            i32     // absolute coordinate
      y:            i32     // absolute coordinate
      delta_x:      i32     // relative motion
      delta_y:      i32     // relative motion
      timestamp_ns: u64     // producer timestamp
  }
```

The struct is `#[repr(C)]` so its layout is stable across the syscall boundary, and it derives
`Default` (`types.rs:41`), which the drain path uses to zero-fill its scratch buffer. The kernel
never interprets `kind`, `flags`, or `code`; it copies the record verbatim. The meaning of those
fields is a contract between the driver capsules that fill them and the router capsule that reads
them, not something the kernel enforces. The static initializer for the ring fills every slot with
an all-zero `InputEvent` (`input_ring.rs:36-45`).

## Posting

`post_input` (`input_ring.rs:55`) enqueues one event, or drops it if the ring is full:

```
  post_input(ev):
      lock ring                                     // input_ring.rs:57
      next = (head + 1) % INPUT_RING_CAP            // input_ring.rs:58
      if next == tail:                              // full
          DROPPED += 1 (Relaxed); return OutOfSlots // input_ring.rs:59-61
      buf[head] = ev; head = next                   // input_ring.rs:63-65
      unlock                                        // lock dropped here, input_ring.rs:66
      SEQ.fetch_add(1, Release)                     // input_ring.rs:67
      waiter = WAITER.swap(0, AcqRel)               // input_ring.rs:69
      if waiter != 0: wake_process(waiter)          // input_ring.rs:70-72
      return Ok                                     // input_ring.rs:73
```

The fullness test is `next == tail`, where `next` is `head + 1` modulo capacity. That is the
classic one-slot-reserved scheme: when advancing head would make it collide with tail, the ring is
treated as full and the event is refused. This is why usable capacity is 1023, not 1024.

A full ring drops the new event and bumps a `DROPPED` counter rather than blocking the producer
(`input_ring.rs:59-61`). This is drop-new, not drop-oldest: the event that arrives when the ring is
full is the one discarded, and everything already queued is preserved in order. A driver posting
from an interrupt-driven path must never stall, so back-pressure surfaces as a lost event and an
incremented counter, not a hang. The producer sees this as `RegistryError::OutOfSlots`
(`types.rs:58`), which the syscall layer maps to `ENOMEM` (`input_ops.rs:60`).

The mutex is released at the end of the inner block (`input_ring.rs:66`) before `SEQ` is bumped and
the waiter is woken, so the wakeup and the sequence publish happen outside the lock. The store to
`SEQ` uses `Release` ordering (`input_ring.rs:67`) so that a consumer that reads `SEQ` with
`Acquire` and sees the new value is guaranteed to also see the event bytes written under the lock.
The waiter is fetched with a single `swap(0, AcqRel)` (`input_ring.rs:69`): reading and clearing the
waiter is one atomic step, so a post consumes the armed waiter exactly once and two concurrent posts
cannot both wake the same registration.

`post_input` also calls `mark_once(&FIRST_INPUT_POST, b"input_post_first")` (`input_ring.rs:68`),
which records a one-shot bring-up marker the first time any event is posted. `mark_once` swaps the
flag to true and only emits the marker on the first transition (`mark_once.rs:19-23`), so this costs
one atomic swap on every subsequent post and nothing more.

## The sequence number and the waiter

The ring exposes a monotonic sequence number and a single waiter slot, both `AtomicU64` statics
(`input_ring.rs:49-50`):

```
  input_seq() -> u64            SEQ.load(Acquire)          input_ring.rs:76-78
  arm_input_waiter(pid: u32)    WAITER.store(pid, Release) input_ring.rs:80-84
  clear_input_waiter()          WAITER.store(0, Release)   input_ring.rs:91-93
```

`SEQ` increments on every successful post and never on a drop, so it counts events accepted into the
ring, not events offered. A pid of 0 in `WAITER` means no waiter is armed; `post_input` treats a
swapped-out value of 0 as "nobody to wake" (`input_ring.rs:70`). There is exactly one waiter slot
because there is exactly one consumer.

The sequence number is what lets the consumer wait on an edge without missing events. The consumer
records the sequence it last saw, arms itself as the waiter, and re-checks; if the sequence
advanced, there is new input to drain. Arming before the re-check closes the lost-wakeup window: an
event that lands between the check and the sleep still bumps `SEQ` and still swaps out the waiter, so
the consumer either sees the advanced sequence or gets woken. A post wakes exactly the one armed
waiter through the scheduler (`wake_process`), which flips a sleeping process to ready and puts it
back on the run queue (`sleep.rs:33` onward). See the [scheduler sleep and wake
page](/docs/subsystems/scheduler/sleep-wake/).

## Draining

`drain_input` (`input_ring.rs:95`) copies as many queued events as fit into the caller's buffer and
advances the tail:

```
  drain_input(out):
      if out.is_empty(): return 0                 // input_ring.rs:96-98
      lock ring                                   // input_ring.rs:99
      n = 0
      while n < out.len() and tail != head:       // input_ring.rs:101
          out[n] = buf[tail]                      // input_ring.rs:102
          tail = (tail + 1) % INPUT_RING_CAP      // input_ring.rs:103
          n += 1
      return n                                    // input_ring.rs:106
```

Draining is bounded by the caller's buffer, so the consumer pulls a batch, processes it, and comes
back. The empty-output guard at the top returns 0 without taking the lock (`input_ring.rs:96-98`).
Nothing in the kernel interprets the events; they are copied out verbatim in FIFO order for the
router to classify.

## Invariants the code enforces

- The ring holds at most `INPUT_RING_CAP - 1` events; the `next == tail` full test reserves one slot
  (`input_ring.rs:59`).
- `head` and `tail` are only ever read or written under `RING.lock()`
  (`input_ring.rs:57`, `input_ring.rs:99`), so there is no torn index and no lost update between a
  concurrent post and drain.
- Both indices advance strictly modulo `INPUT_RING_CAP`, so neither can point outside the buffer
  (`input_ring.rs:58`, `input_ring.rs:103`).
- `SEQ` is monotonic and moves only on an accepted post (`input_ring.rs:67`); a dropped event never
  advances it.
- The waiter is consumed at most once per post via `swap` (`input_ring.rs:69`), so a single event
  never double-wakes and a stale waiter cannot linger past the post that observes it.
- Events leave the ring in the order they entered; the drain walks `tail` forward one slot at a time
  (`input_ring.rs:101-103`).

## Syscall surface

Three syscalls sit on top of the ring, dispatched in
[`src/syscall/dispatch/router/input_ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs) and tagged in [`src/syscall/numbers/defs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/defs.rs):

```
  MkInputEventPost   ("MIEP", defs.rs:96)   do_post   input_ops.rs:53   -> post_input
  MkInputEventDrain  ("MIED", defs.rs:97)   do_drain  input_ops.rs:64   -> drain_input
  MkInputEventWait   ("MIEW", defs.rs:98)   do_wait   input_ops.rs:83   -> arm/seq/clear
```

`do_post` reads one `InputEvent` from user memory with `read_user_value`, returns `EFAULT` on a bad
pointer, and maps a full ring to `ENOMEM` (`input_ops.rs:53-62`). `do_drain` clamps the requested
count to `MAX_DRAIN = 64` (`input_ops.rs:32`, `input_ops.rs:68`), drains into a kernel scratch array
of `InputEvent::default()`, then copies exactly `n * size_of::<InputEvent>()` bytes back to user
space with `copy_to_user`, returning `EFAULT` if that write fails (`input_ops.rs:64-81`). A single
drain syscall therefore returns at most 64 events regardless of what the caller asks for.

`do_wait` is the blocking edge-trigger (`input_ops.rs:83-111`). It validates the user output
pointer, resolves the caller pid, then loops: arm the waiter, read `input_seq()`, and return if the
sequence moved off `last_seq` or the timeout elapsed. A `timeout_ms` of 0 means it re-arms and
sleeps in `DEFAULT_WAIT_MS = 50` ms slices (`input_ops.rs:33`, `input_ops.rs:103-104`) rather than
blocking forever, so even a wait with no timeout wakes periodically to re-check. It sleeps with
`sleep_until` and then `yield_now` (`input_ops.rs:108-109`), and on return it writes the observed
sequence back to the caller.

## Security analysis

Who may write to the ring is gated by capability, not left open. The cap table maps each syscall to
a predicate in `src/syscall/contract/cap_table/mk.rs:78-80`:

```
  MkInputEventPost  -> caps.can_input_source()
  MkInputEventDrain -> caps.can_ipc()
  MkInputEventWait  -> caps.can_ipc()
```

`can_input_source` grants only to a capsule holding `InputSource`, `Irq`, or `Admin`
(`token/types.rs:166-170`); `can_ipc` requires a valid token holding `IPC`
(`ipc.rs:25`). The gate is enforced before the handler runs: `check_syscall_allowed` calls
`cap_table::is_allowed` and returns `SyscallNotPermitted` if no family claims the number
(`resolver/check_syscall.rs:27-29`, `cap_table/mod.rs:30-36`). So posting is restricted to the
handful of signed driver capsules that were granted an input-source or IRQ capability, and draining
is restricted to capsules with IPC, in practice the single input router.

A malicious or buggy driver that does hold the post capability cannot forge another driver's
identity in the ring, because the ring carries no producer identity at all: an `InputEvent` is just
the eight opaque fields above, and the router treats every accepted event the same way. What such a
driver can do is flood the ring with its own events. Because posting is non-blocking and drop-new,
a flood cannot stall the kernel or any other producer: once the ring is full, further posts return
`OutOfSlots`/`ENOMEM` and are discarded rather than overwriting queued events or overrunning the
consumer. The blast radius of a hostile input source is therefore its own share of the 1023 usable
slots plus a rising drop count, not a hang and not corruption of another source's events. The
kernel does not rate-limit per producer, so a single high-rate source can still crowd out others
inside the shared ring; per-source fairness, if wanted, is the router's job after drain, as the
module comment notes (`input_ring.rs:22-25`).

Back-pressure never propagates to the producer as a block. The only signals a producer gets are the
`OutOfSlots` return and, indirectly, the fact that events stop being accepted; there is no flow
control that slows a driver down. This is deliberate for interrupt-context posters that must not
sleep.

## Debugging

There is one internal signal that the ring is dropping events: the `DROPPED` counter
(`input_ring.rs:48`), incremented with `Relaxed` ordering on every full-ring post
(`input_ring.rs:60`). Note that as written the counter is only ever incremented, never read back
by any code in the tree, so today it is a breakpoint or memory-inspection target rather than a
queryable statistic. A rising `DROPPED` under a debugger means the consumer is not draining fast
enough, or is not running at all, and input is being lost at the tail of the producers.

To tell an overflow from a stall, compare the cursors and the sequence:

- If `head` and `tail` are far apart and `head + 1 == tail` (modulo capacity), the ring is full and
  every further post is being dropped: the consumer has stopped draining. Watch `SEQ` climb while
  `tail` stays put.
- If `head == tail`, the ring is empty and any consumer stall is upstream: no producer is posting.
  `SEQ` will be flat.
- If `SEQ` is advancing but the router never wakes, check `WAITER`: a value of 0 means nothing is
  armed, so posts have nobody to wake, and the router must re-arm through `MkInputEventWait`. A
  nonzero `WAITER` that never clears means the wake path is not reaching the scheduler.

Two one-shot bring-up markers bracket the path: `input_post_first` fires on the first accepted post
(`input_ring.rs:68`) and `input_drain_first` fires on the first drain that returns events
(`input_ops.rs:79`). Seeing the first without the second means events are entering the ring but the
router is not pulling them out, which is the classic full-ring overflow signature. Under the
`input-probe-inject` feature, `arm_input_waiter` also sets a `INPUT_CONSUMER_READY` flag
(`input_ring.rs:82-84`) that the injector polls (`inject.rs:31-33`), giving a deterministic way to
confirm the consumer armed itself before any synthetic input is posted.

## Source map

```
  src/kernel_core/surface_registry/input_ring.rs   the ring, post, drain, sequence, waiter, markers
  src/kernel_core/surface_registry/types.rs        InputEvent, INPUT_RING_CAP, RegistryError
  src/kernel_core/surface_registry/mod.rs          re-exports of the ring API
  src/kernel_core/surface_registry/inject.rs       optional input-probe-inject synthetic poster
  src/syscall/dispatch/router/input_ops.rs         the post/drain/wait syscall handlers
  src/syscall/dispatch/router/dispatch_fn.rs       routing of the three input syscalls
  src/syscall/numbers/defs.rs                      MkInputEventPost/Drain/Wait tags
  src/syscall/contract/cap_table/mk.rs             capability gate for the three syscalls
  src/capabilities/token/types.rs                  can_input_source predicate
  src/syscall/caps/checks/ipc.rs                   can_ipc predicate
  src/syscall/contract/cap_table/mod.rs            is_allowed total cap table
  src/syscall/contract/resolver/check_syscall.rs   enforcement of the cap gate
  src/process/scheduler/dispatch/sleep.rs          sleep_until, wake_process
  src/sys/bench/mark_once.rs                        one-shot bring-up markers
```

Every reference above is verified against those trees.
