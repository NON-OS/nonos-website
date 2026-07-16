---
title: "What proof_io Proves"
description: "proofio asserts one thing: the syscall boundary between a CPL3 capsule and the microkernel behaves exactly as the ABI promises."
weight: 1
---
`proof_io` asserts one thing: the syscall boundary between a CPL3 capsule and the microkernel behaves
exactly as the ABI promises. A legal call succeeds every time, and a malformed or retired call is refused
with the precise error the contract names. The whole proof is one `_start` in
[`userland/capsule_proof_io/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs); this page walks each assertion against the kernel path it
depends on. For the capsule's identity and lifecycle read the [overview](/docs/userland/proof-io/).

The five assertions run in order, and any failure exits immediately with a distinct code and a
`[SYSCALL-PROOF] FAIL ...` marker (`main.rs:37`). Reaching the end prints
`[SYSCALL-PROOF] PASS time-loop invalid-number invalid-pointer invalid-size retired-enosys` and exits 0
(`main.rs:28`, `main.rs:64`, `main.rs:65`).

## A legal call always succeeds

The proof calls `mk_time_millis()` 1024 times and requires every return to be non-negative; a single
negative return prints `FAIL loop` and exits 1 (`main.rs:38`). `mk_time_millis` is a safe libc wrapper
over the real syscall ([`userland/libc/src/lib.rs:82`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/lib.rs#L82)). Running it 1024 times exercises the full
user-to-kernel-and-back round trip repeatedly, so the assertion is not "one call worked once" but "the
boundary is stable across a thousand crossings." This is the positive control: if it fails, nothing below
is meaningful.

## An unknown number is refused with ENOSYS

The proof sends a made-up syscall tag, `BAD_TAG = 0x2144_4142`, straight at the boundary through
`mk_syscall_raw`, and requires the kernel to return `-38` (`ENOSYS`); anything else prints
`FAIL invalid-number` and exits 2 (`main.rs:22`, `main.rs:44`). `mk_syscall_raw` is a re-export of
`call_raw`, the raw path that lets the proof send numbers the safe wrappers would never emit
([`userland/libc/src/lib.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/lib.rs#L81)). On the kernel side, an unknown tag has no registry entry, so
`lookup_id` returns `None` ([`src/syscall/abi/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/mod.rs#L31)) and the number never resolves to a
`SyscallNumber` ([`src/syscall/numbers/convert.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/convert.rs#L22)). The kernel errno for a missing call is
`ERRNO_NOSYS = -38` ([`src/syscall/microkernel/errnos.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/errnos.rs#L30)), which is exactly the value the proof
requires. This is what stops a capsule from reaching a call that does not exist.

## A bad user pointer is refused with EFAULT

The proof invokes the real `MkDebug` tag, `MDBG_TAG = 0x4742_444d`, with a deliberately invalid buffer
pointer of `1` and a length of `8`, and requires `-14` (`EFAULT`); otherwise it prints `FAIL
invalid-pointer` and exits 3 (`main.rs:23`, `main.rs:48`). The kernel `MkDebug` handler
`sys_mk_debug` takes the non-null, non-zero-length request past the length gate and then validates the
user buffer with `validate_user_read`; a pointer the caller cannot legally read returns `ERRNO_FAULT`,
which is `-14` ([`src/syscall/microkernel/debug.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/debug.rs#L40), [`src/syscall/microkernel/errnos.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/errnos.rs#L26)). This is
what stops a capsule from handing the kernel a pointer into memory it does not own.

## An over-length is refused with EINVAL

The proof calls `MkDebug` again, this time with a valid pointer (the `PASS` string) but a length of
`257`, and requires `-22` (`EINVAL`); otherwise it prints `FAIL invalid-size` and exits 4
(`main.rs:52`). The handler bounds a debug line to `MAX_LEN = 256` bytes and returns `ERRNO_INVAL` for
anything longer, before it ever touches the buffer ([`src/syscall/microkernel/debug.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/debug.rs#L30),
[`src/syscall/microkernel/debug.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/debug.rs#L37)). `257` is one byte over the ceiling, so it is the tightest test
of the bound. `ERRNO_INVAL` is `-22` ([`src/syscall/microkernel/errnos.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/errnos.rs#L29)). This is what stops a
capsule from steering the kernel into an over-length copy.

## Retired calls stay dead

Finally the proof loops over four tags that were once real syscalls and have since been removed from the
ABI, `RETIRED = [0x4E47_5343, 0x474F_4C44, 0x444F_4D41, 0x5243_5347]` (the old CryptoSign, DebugLog,
AdminModLoad, and GraphicsSurfaceCreate numbers), and requires each to return `-38` (`ENOSYS`) like any
other unknown tag; a live one prints `FAIL retired-enosys` and exits 5 (`main.rs:24`, `main.rs:57`).
A removed call has no registry entry, so it resolves through the same `lookup_id` miss as any invented
number and yields `ERRNO_NOSYS = -38` ([`src/syscall/abi/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/mod.rs#L31), [`src/syscall/microkernel/errnos.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/errnos.rs#L30)).
This is what proves a retired number cannot be resurrected by a caller reaching for the old tag.

## Why these five, and nothing more

Together the assertions cover the two ways a boundary can betray a trust model: it can fail to serve a
legal call, or it can serve a call it should have refused. The time loop covers the first. The unknown
number, bad pointer, over-length, and retired tags cover the second across the three refusal reasons the
ABI names, `ENOSYS`, `EFAULT`, and `EINVAL`. The proof draws no window and holds no state; its verdict is
the marker line and the exit status, both readable from boot serial (`README.md`).

## Source map

```
  userland/capsule_proof_io/src/main.rs      the five assertions, exit codes, and marker strings
  userland/libc/src/lib.rs                    the mk_time_millis, mk_debug, mk_exit, and raw re-exports
  src/syscall/abi/mod.rs                      lookup_id, the registry miss that yields an unknown tag
  src/syscall/numbers/convert.rs              from_u64 over the registry
  src/syscall/microkernel/debug.rs            the MkDebug length gate and user-pointer validation
  src/syscall/microkernel/errnos.rs           ENOSYS -38, EFAULT -14, EINVAL -22
```

Every reference above is verified against those trees.
