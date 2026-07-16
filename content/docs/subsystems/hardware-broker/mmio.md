---
title: "MMIO Grants"
description: "A driver capsule needs to reach its device's registers, which live behind a physical BAR."
weight: 3
---
A driver capsule needs to reach its device's registers, which live behind a physical BAR. The
broker is the one in-kernel path that maps a slice of a device BAR into a capsule's address
space, and it does so only for the claim holder, only within the BAR, and never over the
device's MSI-X table. This page documents `MkMmioMap` and its revocation. The code is under
`src/hardware/broker/mmio/` and [`src/hardware/broker/grant.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/grant.rs).

## The mapping path

`map_for_caller` ([`src/hardware/broker/mmio/map.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/mmio/map.rs#L44)) is the whole path, five ordered steps,
and on any rejection no mapping is installed and no record is made:

```
  1. reject unknown flags, zero length, unaligned offset/length
  2. resolve the caller's claim; verify pid and epoch (StaleEpoch)
  3. resolve the device and BAR; verify it is an MMIO BAR
  4. compute [phys_start, phys_end); verify it is contained in the BAR
  5. clamp against the MSI-X table; reserve user VA; install pages; record
```

Every arithmetic step is checked: `phys_start = bar.base + offset`, `phys_end = phys_start +
length`, and the BAR end are all `checked_add`, and `phys_end > bar_end` is `BadRange`. A
request can only ever map memory that is inside the BAR of a device the caller holds; it cannot
name an arbitrary physical address, because the physical base comes from the kernel's device
table, not from the request. The offset and length must be page aligned, and the BAR base
itself must be page aligned, so a mapping never straddles a page it should not.

## The user window

The mapped pages land in a dedicated per-capsule MMIO virtual region, `[USER_MMIO_BASE,
USER_MMIO_END)` (`grant.rs:135`), carved by `reserve_user_va` (`grant.rs:145`). The allocator
adds a guard page between adjacent grants (`grant.rs:147`), so a runaway access off the end of
one grant faults into an unmapped page rather than spilling into the next grant. The pages are
installed by `map_user_mmio` with user, read-write, uncached, and no-execute attributes
(`map.rs:100`): a device register window is data the capsule reads and writes, never code it
executes, and uncached because it is device memory, not RAM.

## The MSI-X exclusion

A device's MSI-X interrupt table often shares a BAR with its registers. Exposing that table to
the capsule would let it program its own interrupt vectors and bypass the [IRQ](/docs/subsystems/hardware-broker/irq/) bind
allowlist, so the mapping is clamped to stop at the page below the table. `safe_length`
([`mmio/msix_exclusion.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/mmio/msix_exclusion.rs#L35)) computes the clamp: a request that overlaps the MSI-X table or its
pending-bit array is trimmed to end at the page boundary before the protected region, and a
request that starts inside the protected region clamps to zero length and is refused with
`WouldExposeMsixTable`. A device like xHCI whose registers share the BAR still maps everything
up to the table; only the table pages themselves are withheld, because the kernel programs them
on the capsule's behalf during MSI-X bind.

## The grant record and revocation

The successful mapping is recorded as an `MmioGrant` (`grant.rs:37`) in the global grant table,
carrying the grant id, the holder pid, the device, the claim epoch, the physical start, the user
VA, and the length. That record is the authority for undoing the mapping later. Three revocation
entry points exist ([`mmio/release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/mmio/release.rs)): `unmap_grant` for a single grant by the holder,
`release_for_device` for every grant on one device, and `release_all_for_pid` for every grant a
pid owns. Each unmaps the user pages when the holder's address space is the active one and skips
the unmap otherwise, letting address-space teardown drop the page-table entries wholesale; the
[revocation](/docs/subsystems/hardware-broker/revocation/) page covers that self-context decision and the exit wiring.

## Security analysis

MMIO is easier to reason about than [DMA](/docs/subsystems/hardware-broker/dma/) because the mapped pages land in the capsule's own
address space and are contained by paging: a capsule can touch only what the broker mapped, and the
mapping is bounded to a slice of a BAR the capsule holds. Four properties draw that bound.

**Bounded to a claimed BAR.** The physical base comes from the kernel's device table, not the request,
so a mapping can only name memory inside the BAR of a device the caller claims; it cannot forge an
arbitrary physical address. The arithmetic is all `checked_add`, and `phys_end > bar_end` is `BadRange`,
so an off-by-one cannot walk past the BAR into another device's registers or into RAM.

**MSI-X withheld.** The single most important clamp. A device's MSI-X table usually shares the register
BAR, and mapping it would let the capsule program its own interrupt vectors and bypass the [IRQ](/docs/subsystems/hardware-broker/irq/)
bind allowlist entirely. `safe_length` trims any request to stop at the page below the table, or refuses
it with `WouldExposeMsixTable` if it starts inside, so the capsule drives its device but the kernel
keeps the vector programming. This is what makes a userspace driver's interrupts trustworthy: the driver
can never point an interrupt at a vector it was not bound.

**Guard-page isolation.** Adjacent grants are separated by an unmapped guard page (`grant.rs`), so a
runaway access off the end of one grant faults into nothing rather than spilling into the next grant's
registers.

**Data, not code.** The pages are mapped user, read-write, uncached, and no-execute (`map.rs`). No-execute
means a capsule cannot execute out of its device mapping, so a writable BAR window is not a code-injection
path; uncached is correctness, because it is device memory and not RAM. The epoch closes the same
use-after-release gap as the other grants (`StaleEpoch`). Unlike DMA, MMIO needs no IOMMU discussion: the
reach is CPU-side and paging-contained, so a compromised capsule can only touch the BAR slice it was
granted, minus the MSI-X table.

## Debugging MMIO grants

`map_for_caller` prints a stage marker as it clears each step, so a partial trace on the console (or the
framebuffer on a `NONOS_FBCONSOLE=1` build) tells you exactly how far a mapping got before it was refused:

```
  [MMIO] claim     claim + epoch resolved      (absent -> NotClaimed / StaleEpoch)
  [MMIO] device    device + BAR resolved       (stops here -> BadBarIndex / NotMmioBar)
  [MMIO] msix      MSI-X info looked up
  [MMIO] msix ok   the clamp passed            (stops before -> WouldExposeMsixTable)
  [MMIO] va        user VA reserved
  [MMIO] reserve   guard-padded region carved  (stops here -> no user VA space)
  [MMIO] map       pages installed             (stops here -> page install failed)
  [MMIO] record    grant recorded, returns
```

The markers are printed in order and `[MMIO] record` is the last, so seeing `record` means the driver
got its registers, and the missing marker names the step that blocked it: a trace that reaches
`[MMIO] msix` but not `[MMIO] msix ok` is an MSI-X overlap, a trace that reaches `[MMIO] va` but not
`[MMIO] map` is a page-install failure, and no `[MMIO] claim` at all is a claim-ordering or epoch problem.
This is how a driver that comes up on QEMU but not on real hardware is diagnosed: the trace stops at the
step the real BAR layout broke.

## Source map

```
  src/hardware/broker/mmio/map.rs             the five-step mapping path
  src/hardware/broker/mmio/msix_exclusion.rs  the MSI-X table clamp (safe_length)
  src/hardware/broker/mmio/types.rs           MmioGrant and the MmioMapError variants
  src/hardware/broker/mmio/release.rs         unmap_grant / release_for_device / release_all_for_pid
  src/hardware/broker/grant.rs                the MmioGrant table and the guard-padded user VA region
```

Every reference above is verified against those trees. The claim and epoch are on the
[device claim](/docs/subsystems/hardware-broker/claim/) page, the interrupt allowlist the MSI-X clamp protects is on the [IRQ](/docs/subsystems/hardware-broker/irq/)
page, and the self-context unmap decision is on the [revocation](/docs/subsystems/hardware-broker/revocation/) page.
