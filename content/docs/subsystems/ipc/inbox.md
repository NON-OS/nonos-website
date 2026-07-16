---
title: "Inboxes"
description: "The substrate under every message a capsule receives is the inbox: a named, bounded queue with an explicit owner."
weight: 1
---
The substrate under every message a capsule receives is the inbox: a named, bounded queue
with an explicit owner. A capsule does not share memory with another capsule and cannot
name another capsule's address space; the only way one reaches another is to enqueue a
message on a registered inbox, and the kernel decides whether that enqueue is allowed. This
page documents the inbox itself, the registry that owns them, the fail-closed enqueue, and
the lifecycle tie to process teardown. The code is under `src/ipc/nonos_inbox/`.

## The inbox

An `Inbox` ([`src/ipc/nonos_inbox/inbox.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/nonos_inbox/inbox.rs#L32)) is a mutex-guarded `VecDeque<IpcMessage>`
with a fixed capacity and an owner pid:

```
  struct Inbox {
      queue:    Mutex<VecDeque<IpcMessage>>,
      capacity: usize,
      owner:    u32,       // 0 = kernel-owned, else the capsule pid
      stats:    InboxStats,
  }
```

Enqueue is non-blocking and bounded: `try_enqueue` pushes only if `len < capacity`,
otherwise it records a drop and hands the message back (`inbox.rs:75`). There is no
unbounded growth and no blocking inside the lock; a full inbox is a fast, visible failure,
not a memory leak or a stall. Dequeue pops the front and records the dequeue. The queue is
FIFO, and the capacity is chosen at registration within fixed bounds,
`MIN_INBOX_CAPACITY = 16`, `DEFAULT_INBOX_CAPACITY = 1024`, `MAX_INBOX_CAPACITY = 65536`
(`registry.rs:39`).

## The registry

Inboxes live in one global registry, a `BTreeMap<String, Arc<Inbox>>` behind an `RwLock`
(`registry.rs:48`), keyed by name. Two names matter: `proc.<pid>`, the canonical
per-process inbox a capsule drains, and the kernel-owned reply inboxes the spawn pipeline
sets up. The registry's defining rule, stated in its own module doc, is that **there is no
auto-registration on the send or receive paths**. An inbox exists only because something
explicitly created it:

```
  register_inbox(name, owner_pid)            capsule-owned, fails if name taken
  register_or_get_bootstrap_inbox(name)      kernel-owned reply inbox, idempotent
```

`register_inbox` (`registry.rs:85`) rejects an empty name, rejects a capacity outside the
bounds, and rejects a name that is already registered, so a caller cannot silently take
over an existing queue. `register_or_get_bootstrap_inbox` (`registry.rs:118`) is the only
path that creates an inbox without a capsule pid; it stamps the owner as
`KERNEL_OWNER = 0` and is reserved for the reply inboxes the
[spawn pipeline](/docs/subsystems/process/lifecycle/) pre-registers for the kernel to drain. It must
not be called from a normal send or receive.

## Fail-closed enqueue

Routing into an inbox goes through `try_enqueue_strict` (`registry.rs:164`), which fails
closed on three distinct conditions rather than papering over any of them:

```
  try_enqueue_strict(name, msg):
      inbox = registry.get(name)          else MissingInbox
      if owner != KERNEL_OWNER
         and process_table.find_by_pid(owner) is None:
              return DeadOwner
      inbox.try_enqueue(msg)              else QueueFull
```

`MissingInbox` means no such queue was ever registered. `DeadOwner` means the queue exists
but the capsule that owned it has fallen out of `PROCESS_TABLE`, which is what closes the
race where a destination exits between a caller's service lookup and its enqueue: the
kernel refuses to deliver into a dead capsule's queue. `QueueFull` means the bounded queue
is at capacity. Each maps to a distinct errno at the syscall layer, so the sender learns
which of the three happened. A kernel-owned inbox (`owner == 0`) skips the liveness check,
because its drainer is the kernel itself and never exits.

## Draining and the receive loop

A receiver drains its own inbox with `try_dequeue_existing`, which returns `None` on an
empty or absent queue and never creates one. The blocking behavior lives a layer up, in the
receive syscall ([`src/syscall/microkernel/ipc/recv.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/ipc/recv.rs#L58)): it checks the inbox exists
(`ENOENT` if not), then loops, dequeue, and if empty either returns `ETIMEDOUT` past the
deadline or calls `sched::sleep_until` and re-checks on wake, yielding between spins. The
sender wakes a sleeping receiver explicitly after a successful enqueue, so a blocked
receiver does not spin against an empty queue. The [scheduler](/docs/subsystems/scheduler/sleep-wake/)
sleep and wake are the mechanism; the inbox is the rendezvous.

## Lifecycle

When a capsule exits, `process::exit::teardown` calls `unregister_for_pid(pid)`
(`registry.rs:147`), which removes that capsule's `proc.<pid>` inbox and drops whatever was
still queued. The kernel-owned reply inboxes (`endpoint.<n>`) are deliberately left in
place so a respawn reuses them; stale replies are filtered by the transport's generation
re-check rather than by tearing the inbox down. This is why the `DeadOwner` check exists:
between a capsule exiting and a caller noticing, the strict enqueue is the backstop that
refuses delivery to the departed owner.

## Security analysis

The inbox is the reachability substrate: a capsule shares no memory with another and can name no other
address space, so the entire surface one capsule presents to another is a message enqueued on a named,
owned queue that the kernel decides to accept or refuse. Three properties draw that bound.

**A name is created, never conjured on the path.** The registry's stated rule is that there is no
auto-registration on send or receive (`registry.rs` module doc): an inbox exists only because
`register_inbox` or `register_or_get_bootstrap_inbox` made it. `register_inbox` (`registry.rs:85`)
rejects an empty name, a capacity outside `MIN_INBOX_CAPACITY = 16 .. MAX_INBOX_CAPACITY = 65536`, and a
name already taken, so a caller cannot silently take over an existing queue by re-registering it. The
only path that mints an inbox without a capsule pid is `register_or_get_bootstrap_inbox`
(`registry.rs:118`), which stamps `KERNEL_OWNER = 0` and is reserved for the reply inboxes the
[spawn pipeline](/docs/subsystems/process/lifecycle/) sets up. Because a send cannot bring a queue into existence,
naming a queue that does not exist is a clean `MissingInbox`, not an accidental new endpoint.

**Every enqueue is fail-closed and owner-checked.** Routing goes through `try_enqueue_strict`
(`registry.rs:164`), which refuses on three distinct conditions rather than papering over any: an absent
name is `MissingInbox`, a queue whose owner pid has fallen out of `PROCESS_TABLE` is `DeadOwner`, and a
full bounded queue is `QueueFull`. The `DeadOwner` check is the one that closes the exit race: between a
destination capsule exiting and a caller noticing, the kernel refuses to deliver into a dead capsule's
queue, so a message cannot be dropped into a departed owner's inbox and later mis-drained by whatever
reuses the pid. A kernel-owned inbox (`owner == 0`) skips the liveness check because its drainer is the
kernel, which never exits.

**Bounded, non-blocking, no unbounded growth.** `try_enqueue` pushes only when `len < capacity` and
otherwise records a drop and hands the message back (`inbox.rs:75`), all under the queue's own mutex with
no blocking inside the lock. A full inbox is a fast visible `QueueFull`, not a memory leak and not a
stall that a sender could induce to wedge a receiver. This is what makes a capsule's inbox a bounded
resource: a hostile or runaway sender fills the queue and then gets refused, it does not grow the
kernel's memory without limit or hold a lock a receiver needs.

The honest boundary: the inbox authenticates the *owner* of a queue and its *liveness*, and it enforces
the bound, but it does not itself decide whether a given sender is allowed to reach a given endpoint.
That decision is the capability check on the [routing](/docs/subsystems/ipc/routing/) path, which runs before the strict
enqueue. An inbox that is registered, live, and not full will accept whatever routing hands it; keeping
the wrong sender out is routing's job, not the queue's.

## Debugging inboxes

The three strict-enqueue variants each become a distinct errno at the syscall boundary, so a failed send
tells you which of them fired: `MissingInbox` and `DeadOwner` both map to `ESRCH` (`-3`) and `QueueFull`
maps to `EAGAIN` (`-11`) at `kernel_route_ipc_corr` (`kernel_ipc.rs:90`). The two `ESRCH` cases are
worth separating in your head even though they share an errno: `MissingInbox` means the destination name
was never registered, which upstream is usually a service that never called register or an endpoint
resolved to the wrong name, while `DeadOwner` means the queue is there but its capsule has exited, which
is the race the check exists to catch. `EAGAIN` means the receiver is not draining fast enough and the
bounded queue filled, which is a throughput problem, not a wiring problem.

On the receive side the tells are different. `sys_ipc_recv` returns `ENOENT` (`-2`) if the inbox does
not exist when the loop starts (`recv.rs:65`), which for an `endpoint != 0` recv means the caller does
not own that endpoint or it was never registered. A recv that returns `ETIMEDOUT` (`-110`) after its
deadline (`recv.rs:80`) drained nothing in time, which pairs with the sender side: if the sender's route
was refused, the message never arrived and the receiver simply times out, so a hung-looking call is
diagnosed by looking at what the *sender* got, not the receiver. For the traced pids the receive loop
prints `[IPC-RECV] ... enter`, `dequeue`, `missing inbox`, `before yield`, and `after yield`
(`recv.rs:32`), and the send path prints `[IPC-SEND] pid= ep= len= target=` (`send.rs:36`), so a hung
IPC call versus a rejected one is read off the trace: a send trace with no matching route, or a recv
stuck cycling `before yield`/`after yield` with no `dequeue`, is a receiver waiting on a message that a
refused or misrouted send never delivered.

## Source map

```
  src/ipc/nonos_inbox/inbox.rs         the bounded per-owner queue, try_enqueue
  src/ipc/nonos_inbox/registry.rs      the global name -> inbox map, strict enqueue, capacity bounds, lifecycle
  src/ipc/nonos_inbox/error.rs         InboxError and the three StrictEnqueueError variants
  src/syscall/microkernel/ipc/recv.rs  the blocking receive loop and its ENOENT / ETIMEDOUT returns
  src/ipc/kernel_ipc.rs                where the strict-enqueue variants become ESRCH / EAGAIN
```

Every reference above is verified against those trees. The capability check that runs before the enqueue
and the wake that pairs with the receive loop are on the [routing](/docs/subsystems/ipc/routing/) page, the message that
gets enqueued is on the [envelope](/docs/subsystems/ipc/envelope/) page, and the reply inboxes the spawn pipeline
pre-registers are set up by the [spawn pipeline](/docs/subsystems/process/lifecycle/).
