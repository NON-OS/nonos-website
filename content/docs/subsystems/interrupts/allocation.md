---
title: "Vector Allocation"
description: "The fixed vectors, the exceptions, the legacy IRQs, the syscall gate, are assigned at build time."
weight: 5
---
The fixed vectors, the exceptions, the legacy IRQs, the syscall gate, are assigned at build
time. The rest of the vector space is a pool the kernel hands out at runtime, for example when
the hardware broker routes a claimed device's line to a fresh vector. This page documents that
pool. The code is under `src/interrupts/allocation/`.

## The registry

The allocator's state is one global registry ([`src/interrupts/allocation/registry.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/allocation/registry.rs#L21)),
two parallel arrays indexed by vector:

```
  struct Registry {
      reserved: [bool; 256],                    // is this vector taken
      handlers: [Option<NoErrorHandler>; 256],  // its handler, if registered
  }
```

A vector is available only if it is neither reserved nor has a handler. The registry is behind
an `RwLock`, so allocation takes the write lock and the availability query takes the read lock.

## What is reserved

`init` ([`allocation/init.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/allocation/init.rs#L20)) marks the fixed part of the space as reserved before any
dynamic allocation can happen:

```
  reserve vectors 0 .. RESERVED_VECTORS_END (32)   // all CPU exceptions
  reserve TIMER_VECTOR    (32)
  reserve KEYBOARD_VECTOR (33)
  reserve SYSCALL_VECTOR  (0x80)
```

The first thirty-two vectors are the CPU exceptions and are never allocatable. The timer,
keyboard, and syscall vectors are individually reserved on top, because they have fixed
handlers installed in the [IDT](/docs/subsystems/interrupts/idt/) and must not be handed to a dynamic requester.

## Allocating and freeing

`allocate_vector` ([`allocation/allocator.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/allocation/allocator.rs#L20)) walks upward from the first non-reserved
vector and claims the first free slot:

```
  allocate_vector():
      for vector in RESERVED_VECTORS_END ..= 255:
          if not reserved[vector] and handlers[vector] is None:
              reserved[vector] = true
              return Some(vector)
      None                                  // pool exhausted
```

`free_vector` refuses to free anything below `RESERVED_VECTORS_END` and refuses to free a
vector that was not allocated, then clears both the reserved flag and the handler. The
allocation starts at 32 rather than at the user-allocatable range's nominal start, so the
legacy IRQ vectors are claimable by a requester that owns the corresponding line, while the
individually-reserved timer, keyboard, and syscall vectors within that range stay off limits.
The failure modes are explicit, `None` when the pool is exhausted and an error string when a
free is invalid, rather than silent wraparound.

## Security analysis

The vector pool is small and its safety story is mostly about not handing out something that is already
in use, but the fixed-vector guarantee it enforces is load bearing. Three properties.

**The exceptions are never allocatable.** `init` reserves vectors 0 through 31 before any dynamic
allocation can run (`init.rs`), and both `allocate_vector` and `free_vector` refuse to cross
`RESERVED_VECTORS_END` (32): the allocator scans upward from 32 (`allocator.rs:23`) and `free_vector`
returns `"cannot free reserved vector"` for anything below it (`allocator.rs:35`). So no runtime
requester can ever be handed a CPU exception vector or free one out from under the fixed handlers, which
means a dynamic allocation can never shadow the page-fault or double-fault gate.

**Availability is a two-array conjunction.** A vector is available only if it is neither `reserved` nor
holds a registered handler (`allocator.rs:25`). Allocation takes the `RwLock` write lock and flips the
reserved bit atomically with the check, so two racing allocators cannot both claim the same vector; the
availability query takes the read lock. The timer, keyboard, and syscall vectors are individually
reserved on top of the exception range (`init.rs`) because they carry fixed handlers in the [IDT](/docs/subsystems/interrupts/idt/)
and must not be dispensed even though they sit inside the otherwise-claimable legacy IRQ span.

**Failure is explicit, not silent.** `allocate_vector` returns `None` when the pool is exhausted rather
than wrapping around, and `free_vector` returns `"vector not allocated"` for a double free
(`allocator.rs:42`), so a bug in a caller surfaces as a handled error rather than as a reused vector. The
honest boundary is that this registry is the kernel's own bookkeeping, not a capability check: it tracks
which vectors are taken, but the authority to route a device's line to a vector lives in the
[broker IRQ](/docs/subsystems/hardware-broker/irq/) bind path, which is what ties a vector to a claimed device. A
caller that allocates a vector still has to be trusted kernel code; the registry stops collisions, not
privilege escalation.

## Debugging vector allocation

The allocator is deterministic, so its two failure returns tell you exactly what went wrong.

```
  allocate_vector() -> None                 the pool 32..=255 is exhausted (every slot reserved or handled)
  free_vector(v)    -> "cannot free reserved vector"   v is below 32 (an exception or fixed vector)
  free_vector(v)    -> "vector not allocated"          v was never reserved (double free or stale id)
```

A `None` from `allocate_vector` under a growing device count means the broker vector pool or the dynamic
range genuinely filled, and the fix is capacity, not a bug; because allocation scans from 32 upward, the
first free slot is always returned, so the allocated vectors cluster low and a `None` really does mean
full. The two `free_vector` strings separate a caller that computed the wrong vector (below 32) from a
caller that freed twice or freed a vector it never held, which is usually a lifecycle bug where a grant
was released and then released again. Because the registry is behind an `RwLock`, a hang taking the write
lock during allocation points at a handler that is holding the read lock across a blocking call rather
than at the allocator itself.

## Source map

```
  src/interrupts/allocation/registry.rs   the reserved and handler arrays
  src/interrupts/allocation/init.rs        reserving the fixed vectors
  src/interrupts/allocation/allocator.rs   allocate_vector, free_vector, is_vector_available
  src/interrupts/allocation/handlers.rs    register_handler, get_handler, unregister_handler
  src/interrupts/allocation/types.rs       RESERVED_VECTORS_END and the fixed vector constants
```

Every reference above is verified against those trees. The fixed handlers this pool reserves around are
installed on the [IDT](/docs/subsystems/interrupts/idt/) page, and the broker bind path that consumes dynamically-routed vectors is
on the [broker IRQ](/docs/subsystems/hardware-broker/irq/) page.
