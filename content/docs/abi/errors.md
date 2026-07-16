---
title: "Error Codes"
description: "Every syscall returns an i64. A non-negative value is success. A negative value is an error, and its magnitude is a POSIX errno number. This page lists the codes the kernel retu..."
weight: 2
---
Every syscall returns an `i64`. A non-negative value is success. A negative value
is an error, and its magnitude is a POSIX errno number. This page lists the codes
the kernel returns, how they are encoded, and what causes the common ones. It is
the companion to the [syscall reference](/docs/abi/syscalls/).

---

## Return convention

A handler produces a `SyscallResult` whose `value` field is the `i64` returned
([`src/syscall/types/result.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/types/result.rs)):

```
  SyscallResult::error(errno) = value of -(errno)
  is_error()                  = value < 0
```

The entry stub casts that `i64` into `RAX` as a `u64`
([`src/arch/x86_64/syscall/manager/entry.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/syscall/manager/entry.rs#L22)), so a negative result reaches
userspace as a large unsigned value that a client reinterprets as a signed
negative. The rule for a caller is simple: treat the return as `i64`, and any
value below zero is an error whose magnitude is the errno below.

```
  return >= 0    success: a length, a pid, a handle, a count, or zero
  return <  0    error:   -errno
```

## The codes

The microkernel error constants are defined as negative `i64` values
([`src/syscall/microkernel/errnos.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/errnos.rs#L22)). Their magnitudes are the standard POSIX
numbers:

| Constant | Value | POSIX | Meaning in NØNOS |
|----------|-------|-------|------------------|
| ERRNO_PERM | -1 | EPERM | Capability denied, or not the owner of a broker grant. |
| ERRNO_NOENT | -2 | ENOENT | No such inbox, service, or object. |
| ERRNO_NOMEM | -12 | ENOMEM | A ring or table was full, or an allocation failed. |
| ERRNO_ACCES | -13 | EACCES | Access refused by policy. |
| ERRNO_FAULT | -14 | EFAULT | A user pointer argument was not readable or writable. |
| ERRNO_BUSY | -16 | EBUSY | The resource is in use, for example a device already claimed. |
| ERRNO_NODEV | -19 | ENODEV | No such device. |
| ERRNO_INVAL | -22 | EINVAL | An argument was out of range or malformed. |
| ERRNO_NOSYS | -38 | ENOSYS | Unknown syscall number, or a number with no handler. |
| ERRNO_NOTSUP | -95 | EOPNOTSUPP | The operation is not supported in this state. |
| ERRNO_TIMEDOUT | -110 | ETIMEDOUT | A blocking call reached its deadline with no event. |
| ERRNO_STALE | -116 | ESTALE | A handle refers to a freed or reused object, for example a stale surface handle. |

## What causes the common ones

### EPERM (-1)

The capability gate denied the call. It is returned from the dispatcher when the
resolver chain fails ([`src/syscall/contract/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs#L36)): the token did not
hold the required capability, the token failed to authenticate, or its session,
address space, or revocation binding did not hold. For a broker grant call it is
also returned when the caller does not own the grant it named, even with the
right capability bit. When a driver gets `EPERM` on `MkIrqPoll`, check both that
the manifest declared `Irq` and that the poll names the grant the bind returned.

### EFAULT (-14)

A user pointer was bad. Every syscall that reads or writes user memory validates
the pointer first (`src/usercopy`). `validate_user_read` and
`validate_user_write` walk the range and confirm each page is mapped, user
accessible, and writable where needed; any failure becomes `EFAULT`. The typed
accessors `read_user_value` and `write_user_value` additionally require the
pointer to be aligned for the type, and a misaligned pointer is also `EFAULT`. A
null pointer where one is required is `EFAULT` as well.

### ENOENT (-2)

A name did not resolve. `MkServiceLookup` returns it when the service is not in
the registry ([`src/syscall/microkernel/ipc/lookup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/ipc/lookup.rs)); `MkIpcRecv` returns it
when the target inbox does not exist ([`src/syscall/microkernel/ipc/recv.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/ipc/recv.rs)).

### ETIMEDOUT (-110)

A blocking call ran out of time. `MkIpcRecv` and `MkIpcCall` return it when the
timeout elapses with no message ([`src/syscall/microkernel/ipc/recv.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/ipc/recv.rs)). A
`timeout_ms` of zero on `MkIpcCall` is not "no timeout"; it selects the default of
five seconds.

### ENOMEM (-12)

A bounded resource was exhausted. `MkMmap` returns it when virtual address space
allocation fails ([`src/syscall/microkernel/memory/mmap.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/memory/mmap.rs)); inbox and endpoint
registration return it when their tables are full. The input ring drops events
rather than returning this; the others are hard limits.

### EINVAL (-22)

An argument was malformed: a zero-length buffer where one is required, an unknown
device id, an out-of-range value. It is the catch-all for a request the kernel can
parse but will not act on.

---

## Security analysis

The error convention is part of the security boundary, not just an ergonomics
detail. A syscall that touches user memory validates the pointer before it
dereferences it, and any failure of that walk becomes `EFAULT` rather than a
kernel fault. `validate_user_read` and `validate_user_write` confirm each page in
the range is mapped, user accessible, and writable where the call needs to write
(`src/usercopy`); the typed accessors add an alignment requirement, so a
misaligned or null pointer is refused the same way. The consequence is that a
capsule cannot use a bad pointer argument to make the kernel read or write memory
it should not, and cannot distinguish, from the return value alone, a page it does
not own from one that is merely unmapped. Both are `EFAULT`.

`EPERM` is the errno the capability gate produces, and it is deliberately opaque
in the same way. It is returned whether the token lacked the bit, failed to
authenticate, or, for a grant call, named a grant it does not own
([`src/syscall/contract/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs#L36)). A caller learns that it was refused, not
which internal check refused it, so probing the boundary does not leak the shape
of another capsule's authority. `ESTALE` closes a narrower hole: a handle that
refers to a freed or reused slot is rejected rather than silently resolving to
whatever now occupies the slot, which is what lets surface and grant handles carry
an epoch and still be safe to hand back to userspace.

The one deliberate non-error is worth stating. The input ring drops events under
pressure rather than returning `ENOMEM` to the poster
([`src/syscall/microkernel/memory/mmap.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/memory/mmap.rs) is the hard-limit path for the calls
that do fail this way). A driver posting input cannot wedge the kernel by
overrunning the ring; it loses events, and the sequence number the router reads
tells it that a gap happened.

## Debugging by errno

Read the return as an `i64` and the sign tells you which half of the boundary you
are in: a non-negative value is a length, pid, handle, or count, and a negative
value is `-errno` from the table above. The five you will see most while bringing
a capsule up each point at a specific place to look. `EPERM` is a manifest or
grant-ownership problem, checked at the dispatcher. `EFAULT` is a bad pointer
argument, checked in `src/usercopy` before the handler runs. `ENOENT` is a name
that did not resolve, from `MkServiceLookup` when the service is not registered or
`MkIpcRecv` when the inbox does not exist
([`src/syscall/microkernel/ipc/lookup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/ipc/lookup.rs), [`src/syscall/microkernel/ipc/recv.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/ipc/recv.rs)).
`ETIMEDOUT` is a blocking IPC call that ran out its deadline, and a `timeout_ms`
of zero on `MkIpcCall` selects the five-second default rather than blocking
forever. `ENOSYS` is the one that is not a denial: the number had no handler, which
in practice means `MkIrqWait`, so a driver stuck there is wired against a wait that
never fires and should use the poll-and-ack loop instead.

## Source map

```
  src/syscall/microkernel/errnos.rs      the ERRNO_* constants and their values
  src/syscall/types/result.rs            SyscallResult and the negate-on-error rule
  src/arch/x86_64/syscall/manager/entry.rs  the i64-into-RAX cast at the boundary
  src/usercopy                            the pointer validation that yields EFAULT
  src/syscall/microkernel/ipc/{lookup,recv}.rs  the ENOENT and ETIMEDOUT sources
```

Every value and cause above is mirrored from those files. The capability bit each
call requires, and the gate that turns a missing bit into `EPERM`, are on
[the syscall page](/docs/abi/syscalls/).

## A note on layering

There are two error spellings in the tree. The microkernel handlers use the
negative `ERRNO_*` constants above and return them directly. The contract layer
uses positive POSIX names and `SyscallResult::error`, which negates them. Both
produce the same thing in `RAX`: a negative `i64` whose magnitude is the POSIX
number. From a capsule's point of view there is one convention, the table above,
and the internal spelling does not matter.
