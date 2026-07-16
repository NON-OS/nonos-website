---
title: "The User/Kernel Copy Boundary"
description: "When the kernel reads or writes a capsule's memory, syscall arguments, an IPC payload, a buffer a driver passed down, it never dereferences the user pointer directly."
weight: 8
---
When the kernel reads or writes a capsule's memory, syscall arguments, an IPC
payload, a buffer a driver passed down, it never dereferences the user pointer
directly. It validates the range against a pure policy, walks the page tables to
confirm every page is present with the right permission, and then transfers the
bytes through the physical direct map, with interrupts disabled so the mapping the
walk approved cannot change before the copy uses it. This is the surface the
[Kani proofs](/docs/architecture/verification/) exercise for panic-freedom and
bounds. The module is layered so that each concern lives in one file, and the code
is under `src/usercopy/`.

Dereferencing a raw user pointer in kernel mode is the classic way a kernel is
compromised. The pointer could be null, unmapped, non-canonical, or aimed at the
kernel's own address range, and following it either faults in kernel context or
turns the kernel into a confused deputy writing where a capsule could not. The
boundary here removes the raw dereference entirely: the user virtual address is a
value to be validated, and the actual memory access goes through the kernel's
direct map at the physical frame the page tables resolve to.

## The range policy

The innermost layer is a pure function over an address and a length, with no page
walking and no permission decision ([`src/usercopy/policy.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/policy.rs#L35)):

```
  USER_SPACE_END = 0x0000_7FFF_FFFF_FFFF
  MAX_COPY_SIZE  = 64 MiB

  check_range(addr, len):
      if addr == 0                       -> NullPointer
      if len > MAX_COPY_SIZE              -> SizeTooLarge
      if len == 0                        -> Ok(None)
      end = addr.checked_add(len - 1)    -> AddressOverflow on wrap
      if end > USER_SPACE_END             -> InvalidAddress
      Ok(Some(UserRange { start_page, end_page }))    aligned down to pages
```

Five things are decided here and nowhere else, so every caller errors the same way:
a null base is rejected, a length above the 64 MiB cap is rejected, a zero length is
a successful no-op, an address plus length that overflows a `u64` is rejected before
it can wrap, and a range whose last byte lies above the canonical user limit is
rejected. That last check is the one that keeps a user copy inside user space: the
end of the range must be at or below `USER_SPACE_END`, so a buffer that would run off
the top of user memory into the non-canonical gap or the kernel half never passes.
The function returns the page-aligned range for the next layer to walk, or `None`
when there is nothing to copy.

## The per-page walk

The next layer applies the range policy and then walks the pages
([`src/usercopy/validate.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/validate.rs#L34)):

```
  validate(addr, len, need_write):
      range = check_range(addr, len)?     None -> Ok, nothing to copy
      for each page from range.start_page to range.end_page:
          if need_write: translate_write(page)?
          else:          translate_read(page)?
```

`validate_user_read` calls this with `need_write = false` and `validate_user_write`
with `true`. For every page the range touches, it asks the walker
(`src/usercopy/walk/`) to resolve the page and confirm it is present and carries the
required permission: `translate_read` for a read, `translate_write` for a write. A
page that is not present, or is present but lacks the needed permission, fails the
walk and the whole validation fails. The page loop advances with a saturating add and
breaks if the address wraps to zero, so it terminates even at the very top of the
address space. After `validate` returns `Ok`, every page of the range is known to be
a present, correctly-permissioned user page.

## The copy

The outer layer validates and then transfers, and it never touches the user pointer
as a pointer ([`src/usercopy/copy.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/copy.rs#L27)):

```
  copy_from_user(user_ptr, dst):
      run_without_interrupts(||
          validate_user_read(user_ptr, dst.len())?
          copy_from_user_directmap(user_ptr, dst))

  copy_to_user(user_ptr, src):
      run_without_interrupts(||
          validate_user_write(user_ptr, src.len())?
          copy_to_user_directmap(user_ptr, src))
```

The transfer goes through `copy_from_user_directmap` and `copy_to_user_directmap`
([`src/usercopy/direct.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/direct.rs)), which the module documentation states copy through the
direct map after validation has cleared the range and access policy, so the user
virtual address is never dereferenced. The kernel reaches the user's bytes at the
physical frame the walk resolved, through the direct map, not by following the user
pointer in the current address space.

## Why interrupts are disabled

The whole validate-then-copy sequence runs inside `run_without_interrupts`. That is
what closes the time-of-check-to-time-of-use gap. If a timer interrupt could fire
between the page walk and the copy, the faulting process could be preempted and its
mappings changed, so the page the walk approved might not be the page the copy
touches. Holding interrupts off across both steps means the mapping validated is the
mapping used. It also keeps the copy from being interrupted partway and re-entering
the paging paths, matching the interrupt discipline the
[paging manager](/docs/subsystems/memory/paging-manager/) uses.

## Errors and the wider module

The error type is `UsercopyError` ([`src/usercopy/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/error.rs)): the range policy returns
`NullPointer`, `SizeTooLarge`, `AddressOverflow`, and `InvalidAddress`, and the walk
adds its presence and permission failures. Around the byte-slice copies documented
here, the module also provides typed value copies, string copies with the same range
rules ([`src/usercopy/string.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/usercopy/string.rs)), and the low-level direct-map helpers, all built on
the same `check_range` and `walk` foundation so they all agree on what a valid user
range is.

## Security analysis

Dereferencing a raw user pointer in kernel mode is the classic kernel-compromise primitive, and this
boundary exists to remove it entirely. Four properties draw the bound.

**The range is confined to user space, before any access.** `check_range` (`policy.rs:35`) is a pure
function that rejects a null base (`NullPointer`), a length over the 64 MiB cap (`SizeTooLarge`), and an
`addr + len` that overflows a `u64` (`AddressOverflow`) before it can wrap, and requires the last byte
to lie at or below `USER_SPACE_END` (`0x0000_7FFF_FFFF_FFFF`), else `InvalidAddress`. That last check is
what keeps a copy inside user space: a buffer that would run off the top of user memory into the
non-canonical gap or the kernel half never passes. Because this is one pure function, every caller,
byte copies, typed copies, string copies, errors the same way.

**Every page is confirmed present and correctly permissioned.** `validate` (`validate.rs:34`) walks
each page of the range and asks the walker to resolve it and confirm the required access:
`translate_read` for a read, `translate_write` for a write. A page that is not present fails
(`PageNotMapped`), a page not accessible from userspace fails (`PageNotUser`), and a write to a
non-writable page fails (`PageNotWritable`). So the kernel never writes where the capsule itself could
not, which is the confused-deputy case this closes. The walk uses the faulting process's own page-table
root ([`walk/root.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/walk/root.rs)), so it is checking the capsule's real mappings, not the kernel's.

**The access goes through the direct map, never through the user pointer.** After validation,
`copy_from_user_directmap` and `copy_to_user_directmap` (`direct.rs`) reach the user's bytes at the
physical frame the walk resolved, addressed through the kernel direct map. The user virtual address is
a value that was validated, never a pointer that is dereferenced. This is also what SMAP requires: with
`CR4.SMAP` set by the [hardening](/docs/subsystems/memory/hardening/) subsystem, a direct kernel-mode load from a user address
would fault, so the direct-map route is not just cleaner, it is the route SMAP leaves open.

**The check and the copy are one atomic unit.** The whole validate-then-copy runs inside
`run_without_interrupts` (`copy.rs:27`), which closes the time-of-check-to-time-of-use gap: if a timer
interrupt could fire between the walk and the copy, the process could be preempted and its mappings
changed, so the page the walk approved might not be the page the copy touches. Holding interrupts off
means the mapping validated is the mapping used. The honest boundary: the walk resolves the mapping as
it stands at validation time under interrupts-off, so within the copy it is stable, but this boundary
protects the *kernel* from a hostile user pointer; it does not by itself serialise a user thread racing
its own buffer on another CPU, which is the caller's concern.

## Debugging the copy boundary

Every rejection is a `UsercopyError` (`error.rs`) with a `Display` string and an errno, so a failed
copy tells you which stage refused it and what the syscall returns:

```
  NullPointer        "null pointer"                          -14 (EFAULT)   addr == 0
  InvalidAddress     "invalid user address"                  -14            last byte above USER_SPACE_END
  AddressOverflow    "address overflow"                      -14            addr + len wrapped
  MisalignedAddress  "misaligned user address"               -14
  PageNotMapped      "page not mapped"                       -14            a page in the range is absent
  PageNotUser        "page not accessible from userspace"    -14            a kernel-only page in range
  PageNotWritable    "page not writable"                     -14            a write to a read-only page
  PageTableCorrupt   "page table outside directmap"          -14            a walk hit a bad table pointer
  PageFault          "page fault during access"              -14
  NoProcessContext   "no process context"                   -3  (ESRCH)    no current process to walk
  SizeTooLarge       "copy size too large"                  -12 (ENOMEM)   len > MAX_COPY_SIZE (64 MiB)
  InvalidUtf8        "invalid UTF-8 string"                 -22 (EINVAL)   a string copy that is not UTF-8
```

Almost everything collapses to `EFAULT` (`-14`) at the syscall boundary, which is deliberate: a
capsule passing a bad pointer gets a single "bad address" answer regardless of how it was bad, so the
precise reason is for the kernel-side log, not the capsule. The variants that distinguish a *policy*
rejection from a *walk* rejection are the tell: `NullPointer`, `InvalidAddress`, `AddressOverflow`, and
`SizeTooLarge` come from `check_range` before any page is touched, so they mean the range itself was
illegal (a null, an out-of-user-space, or an oversize buffer). `PageNotMapped`, `PageNotUser`, and
`PageNotWritable` come from the per-page walk, so they mean the range was legal but the capsule's
mappings did not back it with the required permission, which is the usual "capsule handed a buffer it
had not faulted in or had mapped read-only" case. `PageTableCorrupt` ("page table outside directmap")
is the one that signals something deeper: a page-table pointer that does not lie in the direct map,
which is a corrupted or hostile page-table state rather than an ordinary bad buffer. `NoProcessContext`
means the copy was attempted with no current process to resolve a root against, an ordering bug in the
caller.

## Verification

This boundary is one of the surfaces the verification stack proves rather than just
tests. The Kani harnesses in the kernel proof crates check that the validation and
copy paths are panic-free and undefined-behaviour-free over bounded inputs, and the
runnable proofs check the range invariants, so the guarantee that a user copy stays
within user space and never dereferences an unvalidated pointer is machine-checked,
not only asserted here.

## Source map

```
  src/usercopy/policy.rs    check_range, the pure range rules and the limits
  src/usercopy/validate.rs  validate_user_read / validate_user_write, the page walk
  src/usercopy/copy.rs      copy_from_user / copy_to_user
  src/usercopy/direct.rs    the direct-map transfer helpers
  src/usercopy/walk/        the page-table walk and permission decision
  src/usercopy/error.rs     UsercopyError, its Display strings and errnos
```

Every reference above is verified against those trees. The SMAP bit that forces the direct-map route is
set on the [hardening](/docs/subsystems/memory/hardening/) page, the interrupt discipline matches the
[paging manager](/docs/subsystems/memory/paging-manager/)'s, and the Kani proofs are on the
[verification stack](/docs/architecture/verification/) page.
