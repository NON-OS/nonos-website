---
title: "The Syscall Boundary"
description: "A syscall crosses from a capsule in ring 3 into the kernel in ring 0, is decoded to a typed number, passes the capability contract, and dispatches to a handler."
weight: 2
---
A syscall crosses from a capsule in ring 3 into the kernel in ring 0, is decoded to a
typed number, passes the capability contract, and dispatches to a handler. What makes
the NØNOS boundary notable is that the capability check is not merely a runtime gate that
a handler could forget to call; it is a type-enforced precondition, so a handler cannot
run without proof that the check happened. This page documents the entry, the register
ABI, the number decode, the contract gate, and the witness type that enforces the check.
The code is under `src/arch/x86_64/syscall/` and `src/syscall/`.

## The instruction and the stub

On x86_64 the boundary is the `SYSCALL` instruction. `LSTAR` is programmed during core
init to point at an assembly entry stub, which saves the user state, switches to the
kernel `GS` and stack, translates the user register layout into the System V calling
convention, and calls `syscall_handler` ([`src/arch/x86_64/syscall/manager/entry.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/syscall/manager/entry.rs#L22)):

```
  #[no_mangle]
  syscall_handler(number, arg1..arg6) -> u64:
      sc = SyscallNumber::from_u64(number), else return -ENOSYS
      result = contract_dispatch(sc, SyscallArgs::new([arg1..arg6]))
      result.value as u64
```

It is `extern "C"` and `#[no_mangle]` because the assembly stub calls it by name. It is
the arch-specific bridge; everything past `contract_dispatch` is arch-neutral.

## The register ABI

Arguments follow the System V register order, with one substitution the `SYSCALL`
instruction forces:

```
  a0 -> RDI    a1 -> RSI    a2 -> RDX
  a3 -> R10    a4 -> R8     a5 -> R9
  syscall number -> RAX     return value -> RAX
```

`R10` stands in for `RCX` because `SYSCALL` clobbers `RCX` with the return address, so a
capsule places the fourth argument in `R10` and the stub moves it into place. The number
travels in `RAX` and the return value comes back in `RAX`, with errors returned as a
negative errno, which is why an unknown number returns `-ENOSYS` cast to `u64`.

## Number decode

The raw `u64` is decoded to a `SyscallNumber` (`src/syscall/numbers/`) before anything
else, and a value that does not correspond to a known syscall is rejected immediately
with `ENOSYS` rather than reaching the contract. The number scheme itself, four-character
ASCII tags packed into a word so they read as mnemonics in a trace, is documented on the
[numbers](/docs/subsystems/syscall/numbers/) page. Only a valid, typed `SyscallNumber` proceeds.

## The contract gate

`contract_dispatch` ([`src/syscall/contract/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs#L31)) is the single gate every
syscall passes, and its doc comment states that there is no other path that runs the
capability resolution:

```
  dispatch(number, args):
      cap = Capability::resolve(number, args)
      if cap is None:
          log the denial
          return EPERM
      invoke(number, args)      the router
```

It resolves the calling thread's capability against the requested syscall and its
arguments. If resolution fails, it logs a `CAP-DENY` with the pid and syscall and returns
`EPERM`, and the handler never runs. If it succeeds, it invokes the router with the raw
arguments. This is the one place `Capability::resolve` is called from, so every syscall in
the system goes through exactly this check.

## The capability witness

The mechanism that makes the check unforgettable is the `Capability` type
([`src/syscall/contract/capability.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/capability.rs#L30)):

```
  pub struct Capability { token: CapabilityToken }    the field is private

  Capability::resolve(number, args) -> Option<Capability>:
      proc = current process, else None
      ctx = ResolveContext { current_asid, boot_session_nonce, capsule_revocation_epoch }
      resolver_resolve(proc.token, number, args, ctx).ok()?
      Some(Capability { token })
```

The struct wraps a capability token behind a private field, and its only constructor is
`resolve`. User-space cannot build one, and in-kernel code outside the contract module
cannot either, because the field is private. As the source puts it, a handler that takes a
`Capability` therefore has executable proof that the check ran: the check is encoded in
the type, not left to a convention a caller might skip. `resolve` builds the resolve
context, the address-space id, the boot-session nonce, and the capsule's revocation
epoch, and runs the resolver chain over the process's token; only if that chain passes
does a `Capability` come into existence.

## The resolver chain

The five checks `resolve` runs, that the token's MAC verifies and it is unexpired and
unrevoked, that it is bound to this boot and this address space, that its revocation epoch
is current, and that the held bits permit this specific syscall, are the ordered resolve
chain documented in full on the [capabilities page](/docs/security/capabilities-and-tokens/).
The boundary here is where that chain is invoked; the capability model is where it is
defined. On success the router runs; the [router](/docs/subsystems/syscall/router/) page covers the dispatch to
the per-family handlers.

## Security analysis

The syscall entry is the one place ring 3 turns into ring 0, so it is the trust boundary for the whole
capsule model. Everything a capsule passes in registers is untrusted, and the boundary is built so that
untrusted input cannot reach a handler without first clearing a decode, a capability check, and (for any
pointer) a page walk. Three properties draw that line.

**A handler cannot run without proof of the capability check.** The mechanism is the `Capability` type
([`src/syscall/contract/capability.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/capability.rs#L30)), a struct that wraps a `CapabilityToken` behind a private field
whose only constructor is `Capability::resolve` (`capability.rs:35`). User-space cannot build one, and
neither can in-kernel code outside the contract module, because the field is private. `dispatch`
(`dispatch.rs:31`) is the sole caller of `resolve`, and its doc comment states there is no other path that
runs it. If `resolve` returns `None` the dispatch logs a `CAP-DENY` and returns `EPERM` before `invoke` is
ever reached (`dispatch.rs:34`). So the check is not a convention a handler might forget; it is encoded in the control
flow, and a handler that needs a capability takes the witness as evidence the five-step resolver chain ran.

**The number is decoded before anything else touches it.** `syscall_handler`
([`src/arch/x86_64/syscall/manager/entry.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/syscall/manager/entry.rs#L22)) turns the raw `RAX` value into a typed `SyscallNumber` with
`from_u64`, and an unrecognised tag returns `-ENOSYS` immediately (`entry.rs:31`) without building
`SyscallArgs` or entering the contract. A malformed number therefore cannot select a handler by index or
walk off the end of a table, because there is no table index in play: the decode is a lookup that yields
either a known enum variant or nothing.

**No user pointer is dereferenced on the strength of the register value alone.** The boundary passes the
six argument registers through untouched as a `SyscallArgs` array; it does not itself interpret any of them
as a pointer. When a handler needs to read or write a user buffer, it goes through the usercopy layer
(`src/usercopy/`), where `check_range` (`policy.rs:35`) rejects a null pointer, a length over the 64 MiB
`MAX_COPY_SIZE` cap, an address that overflows on `addr + len`, or a range crossing the canonical user
limit `0x0000_7FFF_FFFF_FFFF`, and then `validate` (`validate.rs:34`) walks every page in the range to
confirm it is present, user-accessible, and (for a write) writable before a single byte moves. The copy
itself runs through the direct map (`copy.rs`), so the kernel never dereferences the user virtual address
directly. A capsule passing a kernel pointer, an unmapped pointer, or a read-only pointer to a write gets
`EFAULT`, not a kernel fault.

The honest limit is that the boundary itself trusts the assembly stub to have switched `GS` and the stack
and to have saved user state correctly; that stub (`entry.rs` in the arch tree, set up by `init.rs`) is the
small amount of hand-written code the whole model rests on, and it is arch-specific rather than covered by
the type-level guarantees above.

## Debugging the boundary

Every rejection at or just past the boundary comes back to the capsule as a negative errno in `RAX`, and
the errno alone tells you which stage refused the call:

```
  -ENOSYS (38)   the number did not decode           entry.rs, before the contract
  -EPERM  (1)    the capability resolve failed        dispatch.rs, CAP-DENY logged
  -EFAULT (14)   a user pointer failed validation     usercopy, inside a handler
  -EINVAL (22)   a handler rejected the arguments     inside a handler
  -ENOMEM (12)   a handler could not allocate         inside a handler
```

The first distinction to draw is `ENOSYS` versus `EPERM`. `ENOSYS` means the tag in `RAX` is not a
registered syscall at all, so the fix is in the caller's number, not its capabilities. `EPERM` means the
number decoded fine but the resolver chain rejected the token, and this one leaves a trace: `dispatch`
calls `log_deny` (`dispatch.rs:43`), which prints `[CAP-DENY] pid=… syscall=…` with the pid and the typed
syscall name. So an `EPERM` is diagnosed by reading that line, then checking which resolver step failed:
the chain is token MAC, then boot-session binding, then address-space binding, then revocation epoch, then
the per-syscall bit ([`resolver/resolve.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/resolver/resolve.rs#L31)), and the corresponding `ResolverError` variant
([`resolver/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/resolver/error.rs)) names the reason (`TokenRevoked`, `BootSessionMismatch`, `AsidMismatch`,
`RevocationEpochStale`, or `SyscallNotPermitted`).

The second distinction is `EFAULT` versus `EPERM`, which are the two failures most easily confused because
both look like "the kernel refused me." `EPERM` is authority: the capsule does not hold the capability the
syscall requires, and it is caught at the contract before the handler runs, so no `CAP-DENY`-free path
reaches it. `EFAULT` is memory: the capability passed, the handler ran, and a user pointer argument failed
`validate_user_read` or `validate_user_write`. So the trace is different in kind. An `EPERM` with no
`CAP-DENY` line is impossible; an `EFAULT` never prints `CAP-DENY` because it happens after the gate. To
narrow an `EFAULT` further, the underlying `UsercopyError` ([`src/usercopy/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/error.rs)) distinguishes
`NullPointer`, `PageNotMapped`, `PageNotUser`, and `PageNotWritable`, all of which map to errno 14, so the
question "is the buffer unmapped, kernel-owned, or read-only for a write" is answerable from the variant
even though the errno collapses them to one number.

## Source map

```
  src/arch/x86_64/syscall/manager/entry.rs   syscall_handler, the arch bridge and ENOSYS decode
  src/arch/x86_64/syscall/manager/init.rs    LSTAR/STAR/SFMASK setup
  src/syscall/contract/dispatch.rs           the contract gate, log_deny, invoke
  src/syscall/contract/capability.rs         the Capability witness and resolve
  src/syscall/contract/resolver/             the ordered five-step resolve chain and ResolverError
  src/syscall/numbers/                        SyscallNumber and from_u64
  src/usercopy/policy.rs                      check_range, the null/overflow/limit/size rules
  src/usercopy/validate.rs                    validate_user_read / validate_user_write, the page walk
  src/usercopy/copy.rs                        copy_from_user / copy_to_user through the direct map
  src/usercopy/error.rs                       UsercopyError and its i32 errno mapping
```

Every reference above is verified against those trees. The ordered resolve chain and the per-syscall
capability table are on the [capabilities page](/docs/security/capabilities-and-tokens/), the tag
encoding is on the [numbers](/docs/subsystems/syscall/numbers/) page, and the family dispatch past the gate is on the
[router](/docs/subsystems/syscall/router/) page.
