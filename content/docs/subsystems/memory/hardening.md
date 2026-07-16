---
title: "Memory Hardening"
description: "Beyond mapping memory correctly, the memory subsystem enforces a set of safety invariants: no page is ever both writable and executable, guard pages catch access that runs off t..."
weight: 7
---
Beyond mapping memory correctly, the memory subsystem enforces a set of safety
invariants: no page is ever both writable and executable, guard pages catch access
that runs off the end of a region, stack canaries catch overflow, and allocation
tracking catches double-free and use-after-free. The write-execute rule is enforced
on the mapping path itself; the rest is managed by a single hardening manager with a
running tally of every violation it has seen. This page documents each, and in
particular it is where the W^X enforcement point named on the
[paging manager](/docs/subsystems/memory/paging-manager/) page is actually located. The code is under
`src/memory/hardening/`, and the enforcement gate is in the paging manager.

## Write-execute exclusion, and where it is enforced

The invariant is that no page is both writable and executable. It is enforced at the
moment a mapping is installed, in `map_page_in_asid`
([`src/memory/paging/manager/mapping/map_in_asid.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/paging/manager/mapping/map_in_asid.rs#L37)):

```
  map_page_in_asid(asid, va, pa, permissions, size, stats):
      if not initialized                    -> NotInitialized
      if permissions.is_wx_violation()      -> WXViolation
      pte_flags = permissions.to_pte_flags()
      install the mapping, record the stat
```

The check runs before the page-table entry is computed, so a permission set that is
both `WRITE` and `EXECUTE` is rejected with `PagingError::WXViolation` and no PTE is
ever written for it. This is the real gate: the paging manager will not install a W+X
page into any address space, so the invariant holds by construction of every mapping
rather than by a scan after the fact. The permission-model side of it, the
`is_wx_violation` predicate, is on the paging page; this is the enforcement.

The hardening manager carries a second form of the same check for callers that reason
in terms of writable and executable booleans rather than a permission set,
`validate_wx_permissions` ([`src/memory/hardening/manager/validation.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/memory/hardening/manager/validation.rs#L18)):

```
  validate_wx_permissions(addr, writable, executable):
      if writable and executable:
          increment the W^X violation counter
          return Err("W^X violation: memory cannot be both writable and executable")
```

It is exposed as `validate_memory_permissions` ([`hardening/manager/api.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hardening/manager/api.rs#L20)), and a
rejection here also bumps the `wx_violations` statistic so the manager can report how
many attempts it has refused.

## Guard pages

A guard page is an address the manager marks so that any access to it is a detected
violation rather than a silent read or write. They are added and removed through the
API ([`hardening/manager/api.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hardening/manager/api.rs#L50)):

```
  add_guard_page(addr, guard_type)     insert a GuardPage of one page at addr
  remove_guard_page(addr)              remove it, error if not present
  check_guard_page_access(addr)        true if addr is a guard page (+ counter)
```

`add_guard_page` records a `GuardPage { addr, size: PAGE_SIZE, protection_type }` in a
map keyed by address. `check_guard_page_access` (`api.rs:28`) tests whether a faulting
address is in that map, and if it is, increments the guard-violation counter and
returns true, so the fault path can treat a guard-page hit as a deliberate boundary
being crossed rather than an ordinary fault. Guard pages are how the manager turns the
region just past a stack or a buffer into a tripwire.

## Stack canaries

Stack overflow is caught with canaries ([`hardening/manager/api.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hardening/manager/api.rs#L78)):

```
  setup_stack_canary(stack_base, stack_size):
      value = generate_stack_canary()
      record StackCanary { value, stack_base, stack_size }
      write value volatile at stack_base + stack_size - 8
      return value
  check_stack_canary(stack_base)   verify the canary is intact
  clear_stack_canary(stack_base)   remove it
```

`setup_stack_canary` generates a canary value, records it, and writes it with a
volatile store eight bytes below the top of the stack, the location a write that ran
off the end of the stack would overwrite first. `check_stack_canary`
(`check_stack_integrity`) reads it back and fails if it has changed, which is the
signal that the stack overflowed into its guard word. The volatile write ensures the
compiler cannot elide the canary store as dead.

## Allocation tracking

The manager tracks allocations to catch lifetime errors (`api.rs:37`):

```
  track_allocation(addr, size)     record a live allocation
  track_deallocation(addr)         retire it, detecting a double free
  validate_heap_integrity(addr, size)   detect heap corruption over a range
```

`track_allocation` records an allocation and `track_deallocation` retires it; a
deallocation of an address that is not currently tracked is a double free, and an
access to a retired address is a use-after-free, both of which the tracker can detect
and count. `validate_heap_integrity` runs `detect_heap_corruption` over a range to find
metadata that has been overwritten.

## The violation tally

Every check above feeds one running snapshot (`api.rs:64`):

```
  HardeningStatsSnapshot
    guard_violations  wx_violations  stack_overflows  heap_corruptions
    double_frees      use_after_free
    total_guard_pages  active_canaries  tracked_allocations
```

`get_hardening_stats` returns it, so the number of W^X mappings refused, guard pages
hit, canaries broken, and lifetime errors caught is observable at runtime, alongside
the count of guard pages, canaries, and allocations currently tracked.

## The CPU protection bits

The software checks above are backed by hardware enforcement the manager turns on at init.
`init_module_memory_protection` ([`hardening/manager/verify/protection.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hardening/manager/verify/protection.rs#L20)) sets three control-register
bits and is called from `init_all_memory_subsystems` ([`memory/unified/system.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/memory/unified/system.rs#L32)):

```
  init_module_memory_protection():
      enable_write_protection()          set CR0.WP  (bit 16)
      cr4 |= CR4_SMEP                    set CR4.SMEP (bit 20)
      cr4 |= CR4_SMAP                    set CR4.SMAP (bit 21)
```

`enable_write_protection` ([`paging/tlb/write_protect.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/paging/tlb/write_protect.rs#L18)) sets `CR0.WP`, so a read-only page is
read-only even to ring 0: the kernel cannot accidentally write through a mapping it marked read-only,
which is what makes the read-only mappings the manager installs actually enforced. `CR4.SMEP` stops
the kernel from fetching instructions out of any user page, and `CR4.SMAP` stops it from reading or
writing user pages except through an explicit `stac`/`clac` window. SMAP is why the [usercopy](/docs/subsystems/memory/usercopy/)
boundary reaches user bytes through the direct map rather than dereferencing the user pointer: with
SMAP on, a direct kernel-mode load from a user address faults. The bits are set only if not already
set, so re-init is safe.

## Security analysis

Hardening is defence in depth: the mapping path and the allocators are already correct, and this
subsystem adds invariants that turn a bug that slips past them into a caught, counted event rather
than a silent corruption. Four properties carry that.

**W^X holds by construction.** The real gate is `map_page_in_asid` ([`mapping/map_in_asid.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/mapping/map_in_asid.rs#L37)),
which rejects any `permissions.is_wx_violation()` set with `PagingError::WXViolation` before it
computes a page-table entry. No page in any address space is ever both writable and executable,
because no such PTE is ever written, not because a scan catches it after the fact. The
`validate_wx_permissions` form (`validation.rs:18`) is the same rule for callers reasoning in
booleans, and both feed the `wx_violations` counter. Combined with SMEP and NX on the device and DMA
helpers, a writable page is never a code-injection target.

**Kernel writes respect read-only, kernel fetches respect user.** `CR0.WP`, `CR4.SMEP`, and
`CR4.SMAP` move three of these guarantees from convention into the hardware. Without WP the kernel
could write through its own read-only mappings; without SMEP it could be tricked into executing a
user page; without SMAP it could dereference an unvalidated user pointer. Turning all three on is
what makes the W^X and usercopy boundaries enforced rather than merely intended. The honest boundary:
the code assumes the CPU supports these bits and sets them unconditionally, it does not branch on a
CPUID probe here, so on hardware lacking SMEP/SMAP the write to `CR4` is a no-op for those bits and
the software checks are the only line left.

**Guard pages and canaries are overrun tripwires.** A guard page (`api.rs:50`) marks an address so
that a fault on it is reported as a deliberate boundary crossing (`check_guard_page_access`,
`api.rs:28`) rather than an ordinary miss, and the page-fault path checks it first
(`page_fault.rs:63`). A stack canary (`api.rs:78`) is a value written with a volatile store eight
bytes below the top of a stack, the first thing an overflow overwrites, and `check_stack_canary`
fails if it changed. Both catch an off-the-end write that the mapping permissions alone would not.

**Lifetime errors are detectable and counted.** `track_allocation` / `track_deallocation`
(`api.rs:37`) let the manager name a double free (deallocating an untracked address) and a
use-after-free (touching a retired one), and the frame allocator has its own hard `DoubleFree` check
underneath. The honest limit throughout this subsystem is that the tracker and canaries are a
best-effort layer the caller must actually invoke; they are not automatic on every allocation, so
they catch the paths that opt in. The W^X gate and the CPU bits, by contrast, are unconditional.

## Debugging hardening

The hardening subsystem is designed to make a violation visible rather than fatal-and-silent, so the
first tool is the running tally. `get_hardening_stats` returns the `HardeningStatsSnapshot`
(`api.rs:64`) with one counter per class:

```
  guard_violations   a guard page was hit          (add_guard_page had marked it)
  wx_violations      a W+X mapping was refused      (map_in_asid or validate_wx_permissions)
  stack_overflows    a canary came back changed
  heap_corruptions   detect_heap_corruption fired over a tracked range
  double_frees       a deallocation of an untracked address
  use_after_free     an access to a retired address
  total_guard_pages  active_canaries  tracked_allocations   what is currently live
```

A non-zero `wx_violations` with the system still running means the gate did its job: a caller tried
to map a W+X page and was refused with `WXViolation`, no PTE was written, and the count is the
evidence. On the fault side, the exact strings come from the page-fault handler, not this module:
`Guard page violation detected` (`page_fault.rs:64`) is printed when a faulting address matches a
registered guard page, and the "Attempted to execute from non-executable page" line on a
`KERNEL PANIC` is an NX or W^X hit reaching hardware. So a guard-page overrun shows up twice, as a
console line at the fault and as an increment of `guard_violations`, and reading them together
distinguishes a deliberate tripwire from an ordinary miss. The W^X refusal string itself,
`"W^X violation: memory cannot be both writable and executable"` (`validation.rs:26`), is what a
caller sees when it asks for a writable-executable mapping.

## Where this connects

The W^X gate sits on the [paging manager](/docs/subsystems/memory/paging-manager/)'s install path, so it
applies to every mapping the manager makes, including the ones the
[fault handlers](/docs/subsystems/memory/faults/) install, and the guard-page check is consulted first by the
[page-fault handler](/docs/subsystems/memory/faults/). The guard pages and canaries protect the
per-process kernel stacks the [page allocator](/docs/subsystems/memory/page-allocator/) carves and the
[heap](/docs/subsystems/memory/heap/). The SMAP bit set here is what forces the [usercopy](/docs/subsystems/memory/usercopy/)
boundary to go through the direct map. The W^X invariant is also one of the properties the
[verification stack](/docs/architecture/verification/) proves at the encoding level,
in the kernel isolation proofs.

## Source map

```
  src/memory/paging/manager/mapping/map_in_asid.rs    the W^X enforcement gate
  src/memory/hardening/manager/validation.rs           validate_wx_permissions, guard test
  src/memory/hardening/manager/api.rs                  the hardening surface
  src/memory/hardening/manager/verify/protection.rs    CR0.WP / SMEP / SMAP enablement
  src/memory/paging/tlb/write_protect.rs               enable_write_protection (CR0.WP)
  src/memory/hardening/types/                          GuardPage, StackCanary, snapshots
  src/memory/hardening/stats/record.rs                 the violation counters
```

Every reference above is verified against those trees. The W^X predicate is on the
[paging manager](/docs/subsystems/memory/paging-manager/) page, the guard-page consumer is the [page-fault handler](/docs/subsystems/memory/faults/),
and the SMAP-gated copy boundary is on the [usercopy](/docs/subsystems/memory/usercopy/) page.
