---
title: "Revocation and Lifecycle"
description: "Every grant the broker issues is revocable, and a capsule that exits with grants still held does not leak them."
weight: 7
---
Every grant the broker issues is revocable, and a capsule that exits with grants still held does
not leak them. This is the property that keeps device authority from outliving the capsule that
holds it: a claim, and every MMIO, DMA, IRQ, and PIO grant that depended on it, is torn down when
the capsule releases the device, and unconditionally when the capsule dies. This page ties the
per-class revocation paths together, spells out the teardown each class performs, and explains how
revocation interacts with the [claim](/docs/subsystems/hardware-broker/claim/) epoch. The per-class code is in each class's
`release` module; the exit wiring is in `src/process/exit/`.

## Contents

- [Three ways a grant ends](#three-ways-a-grant-ends)
- [What each class tears down](#what-each-class-tears-down)
- [The self-context decision](#the-self-context-decision)
- [Voluntary release: MkDeviceRelease](#voluntary-release-mkdevicerelease)
- [Exit wiring](#exit-wiring)
- [Revocation and the epoch](#revocation-and-the-epoch)
- [Security analysis](#security-analysis)
- [Debugging revocation](#debugging-revocation)
- [Source map](#source-map)

## Three ways a grant ends

Each grant class exposes the same three revocation entry points. The names differ slightly across
classes, so the exact function per class matters:

```
  single grant, by the holder pid:   MMIO/DMA/IRQ  unmap_grant     PIO  release_grant
  every grant tied to one device:     release_for_device
  every grant a pid still holds:      release_all_for_pid
```

All three enforce holder ownership. A single-grant revoke calls the class's `remove`, which looks
the grant up by id and returns `NotHolder` if the requesting pid is not the recorded holder
(`grant.rs:117` for MMIO, and the mirror in each class's records module). The device and pid drains
match on the holder pid as well: `drain_for_device` (`grant.rs:99`) keeps only grants that are
neither `pid == pid && device_id == device_id`, and `drain_for_pid` (`grant.rs:81`) keeps only
grants whose pid differs. A capsule can only revoke its own grants. The `drain_*` helpers remove
the matching records from the global table and return them, so the caller can undo the underlying
resource: unmap the MMIO or DMA pages, free the DMA frames, unbind the IRQ vector, forget the PIO
window.

## What each class tears down

The four classes revoke very different underlying resources, so the teardown per class is worth
naming exactly.

**MMIO** ([`mmio/release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/mmio/release.rs)) unmaps the user pages of the grant. `unmap_one` ([`mmio/release.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/mmio/release.rs#L56))
calls `unmap_user_mmio` on the grant's `user_va` for its `length`, which walks the pages and, per
the paging manager, emits a per-asid SMP TLB shootdown ([`memory/paging/manager/api/mapping.rs:149`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/memory/paging/manager/api/mapping.rs#L149)).
Nothing physical is freed, because MMIO pages point at device BAR memory the broker never owned;
only the mapping is torn down.

**DMA** ([`dma/release.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/release.rs#L61)) does three ordered steps in `teardown`: scrub the buffer, unmap the
user pages, then free the frames. `scrub_buffer` ([`dma/release.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/release.rs#L80)) zeroes the whole run through
the kernel direct map with a volatile write loop before the frames go back, so the next tenant of
those frames cannot read the prior holder's bytes. `unmap_user_dma`
([`memory/paging/manager/api/mapping.rs:187`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/memory/paging/manager/api/mapping.rs#L187)) drops the pages and shoots down the TLB. Then
`pool::free` returns the frames to the DMA display pool, or `free_contiguous` returns them to the
global allocator if they were not pool frames. DMA is the one class where revocation returns real
RAM.

**IRQ** ([`irq/release.rs:84`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/release.rs#L84)) unwinds by grant kind. An INTx grant masks the IO-APIC line
(`ioapic::mask(irq_source, true)`), flips the GSI owner back to free with
`ioapic::release_gsi_from_capsule`, then deactivates and frees the broker slot
([`irq/release.rs:91`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/release.rs#L91)). The IO-APIC redirection entry itself is left programmed on purpose: the line
is masked and the next bind for the same GSI overwrites it. An MSI-X grant calls
`teardown_msix_vector` to mask the per-vector entry and zero the table entry so a stale message
cannot be re-armed, then frees the slot; when the last MSI-X grant for a device is dropped
(`count_msix_for_device == 0`), the kernel issues a full `disable_msix_for_device` so the
device-side enable bit returns to its post-reset state ([`irq/release.rs:104`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/irq/release.rs#L104)). The broker vector
pool stays reserved in the IO-APIC `VEC_ALLOC` for the life of the kernel; the broker's slot bitmap
is the source of truth for which vectors are in use, so the teardown frees the slot but not the
underlying vector reservation.

**PIO** ([`pio/release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pio/release.rs)) simply removes the grant record. There is no physical port state the
kernel holds on the grant's behalf, so once the record is gone every subsequent `MkPioRead` and
`MkPioWrite` against that grant id fails the holder lookup; that is the entire teardown
([`pio/release.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pio/release.rs#L17)).

## The self-context decision

Unmapping a user page requires touching the holder's page tables, which are only directly reachable
when the holder's address space is the active one. The MMIO and DMA revocation paths take an
`unmap_pages` flag so the caller controls this:

```
  release_all_for_pid(pid, unmap_pages):        // mmio/release.rs:45, dma/release.rs:53
      drained = drain_for_pid(pid)
      if unmap_pages:  unmap each grant's user pages   // holder is the active address space
      (mmio also) drop the pid's device claims
```

When the holder is current, the pages are unmapped directly and the TLB is shot down. When the
holder is a different address space (a cross-pid teardown), the unmap is skipped and the
address-space teardown drops the page-table entries wholesale, which is both correct and cheaper
than walking a foreign address space page by page. Dereferencing a foreign address space here would
walk the wrong page tables entirely, so skipping is not an optimization but a correctness
requirement. DMA still scrubs and frees its frames even when `unmap_pages` is false, because the
scrub goes through the kernel direct map (not the user mapping) and the frames must return to the
allocator regardless. The MMIO release additionally drops the pid's device claims in the same call
([`mmio/release.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/mmio/release.rs#L52) calls `claim::release_all_for_pid`), so on the pid drain the claim and its
dependent MMIO grants disappear together. The IRQ and PIO releases have no user mapping to unmap, so
they take no such flag.

## Voluntary release: MkDeviceRelease

A capsule that is done with a device calls `MkDeviceRelease`, handled by `sys_device_release`
([`src/syscall/microkernel/device.rs:88`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/device.rs#L88)). The order there is deliberate: it drains all four grant
classes for the device first, then drops the claim:

```
  sys_device_release(device_id):
      broker::release_for_device(pid, device_id)       // MMIO grants + unmap + TLB
      broker::irq_release_for_device(pid, device_id)   // IRQ vectors
      broker::dma_release_for_device(pid, device_id)   // DMA grants + scrub + free
      broker::pio_release_for_device(pid, device_id)   // PIO windows
      broker::release_device(pid, device_id)           // drop the claim, return epoch
```

The caller's CR3 is active on this path, so the MMIO and DMA unmaps and their TLB shootdowns run
in-context. Grants are torn down before the claim is dropped, which means there is never a moment
where the claim is gone but a live mapping into the device's BAR remains. `release_device`
(`claim.rs:60`) is holder-checked: a pid that is not the recorded holder gets `NotHolder`
(`ERRNO_PERM`), and a device nobody holds gets `NotClaimed` (`ERRNO_NODEV`).

## Exit wiring

The exit path revokes all four grant classes so a dying capsule cannot leak any of them. Process
teardown calls each class's release with the self-context flag set to whether the dying capsule's
address space is currently active ([`src/process/exit/teardown.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/exit/teardown.rs#L32)):

```
  current = CURRENT_PID == pid
  broker::release_all_for_pid(pid, current)     // MMIO grants + device claims
  broker::irq_release_all_for_pid(pid)          // IRQ bindings
  broker::dma_release_all_for_pid(pid, current) // DMA grants + frames
  broker::pio_release_all_for_pid(pid)          // PIO windows
```

The finalize path ([`src/process/exit/finalize.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/exit/finalize.rs#L18)) runs the same four releases with the flag set
to `false`, after `address_space::lifecycle::release` has already dropped the address space, so the
unmap is correctly skipped and the frames are still scrubbed and freed. PIO is gated on
`target_arch = "x86_64"` there (`finalize.rs:21`), matching the x86-only PIO submodule. Either way,
a capsule cannot exit while still holding a device: the claim is dropped (via the MMIO pid drain),
the register windows are unmapped, the DMA frames return to the allocator, and the interrupt vectors
are unbound.

## Revocation and the epoch

Revocation does not itself stamp an epoch. The [claim](/docs/subsystems/hardware-broker/claim/) epoch is a single monotonic counter
bumped only on a successful `claim` (`claim.rs:41`); `release` and the drains do not touch it. The
interaction runs the other way: revocation drops the claim, and the *next* claim on that device gets
a fresh epoch. That is what makes a stale grant handle from a prior ownership useless. A grant
record carries the `claim_epoch` it was issued under (`grant.rs:42` for MMIO, mirrored in each
class), and every grant path re-checks it against the current claim at the head of the request. If a
device is released and re-claimed, any request still quoting the old epoch is rejected with
`StaleEpoch` before it does anything. So revocation and the epoch together close the window: exit and
`MkDeviceRelease` tear the actual mappings down synchronously, and the epoch bump on the next claim
neutralizes any grant handle that somehow outlived the teardown. Device authority is bounded by the
life of the holder and by the current ownership epoch, never longer.

## Security analysis

Revocation is where a capability system either keeps its promises or leaks. Four properties hold it.

**Synchronous teardown, not deferred.** Both `MkDeviceRelease` and the exit path unmap the user
pages and shoot down the TLB in the same call, in the holder's active address space, before the
claim is dropped. There is no window in which the claim is gone but a live BAR mapping or a
programmed DMA descriptor address remains reachable. Grants are always torn down before the claim
they depended on.

**Holder-only revocation.** Every single-grant revoke goes through `remove`, which returns
`NotHolder` if the caller is not the recorded holder, and the device and pid drains match on the
holder pid. A capsule cannot revoke, and therefore cannot disturb, another capsule's grants.

**No leak on exit.** The exit path revokes all four classes unconditionally for the dying pid, and
the MMIO pid drain also drops the device claim, so a capsule that dies mid-operation leaves neither
a claim nor a mapping nor a bound vector nor a DMA frame behind. The finalize path repeats the same
four releases after the address space is gone, covering the case where teardown ran before the AS
was reaped.

**The epoch backstops the mapping teardown.** Even if a grant handle somehow survived (a bug, a
racing request), the epoch check at the head of every grant path rejects it with `StaleEpoch` once
the device has been re-claimed, because the new claim carries a higher epoch. The teardown is the
primary defense; the epoch is the backstop.

The one honest boundary is shared with [DMA](/docs/subsystems/hardware-broker/dma/): revocation unmaps the CPU-side view and frees
the frames, but it cannot recall a DMA transaction a device already has in flight against a physical
address, because the IOMMU backend is not engaged in the shipping builds. Revocation bounds what the
capsule can reach; it does not bound a device that is mid-burst.

## Debugging revocation

Revocation failures are quiet by design, so the useful signals are indirect.

The `MkDeviceRelease` path emits a bounded trace for pid 7 (`device.rs:32`): `[DEV-RELEASE] enter`
on entry and `[DEV-RELEASE] ok` when the claim drop succeeds, capped at 24 lines. A missing `ok`
after `enter` means `release_device` returned an error, which for a legitimate holder is a claim
bookkeeping bug worth tracing; the four grant drains before it cannot fail (they return counts, not
errors).

A grant that appears to survive a release almost always is a different grant. Because grant ids are
handed out from a monotonic counter (`grant.rs:57`) and never reused, a capsule that releases and
re-claims a device gets fresh grant ids and a fresh epoch; a stale handle used afterward fails
`StaleEpoch` at its own path, which is the [claim](/docs/subsystems/hardware-broker/claim/) page's diagnostic, not a revocation
bug. The mirror case is a use-after-release that does *not* fail cleanly on real hardware: the CPU
mapping is gone, but a device left doing bus-master DMA against the freed physical frames keeps
writing RAM. That is the IOMMU gap, visible as memory corruption after a driver exits without
quiescing its device, and it is diagnosed by stopping the device's DMA engine before release, not by
anything the broker prints.

## Source map

```
  src/hardware/broker/mmio/release.rs                MMIO revocation and the self-context unmap
  src/hardware/broker/dma/release.rs                 DMA revocation: scrub, unmap, free
  src/hardware/broker/irq/release.rs                 IRQ INTx/MSI-X teardown and slot free
  src/hardware/broker/pio/release.rs                 PIO record removal
  src/hardware/broker/grant.rs                       the MMIO grant table, remove and the drains
  src/hardware/broker/claim.rs                       release and release_all_for_pid for claims
  src/memory/paging/manager/api/mapping.rs           unmap_user_mmio / unmap_user_dma and the TLB shootdown
  src/syscall/microkernel/device.rs                  MkDeviceRelease: four drains then claim drop
  src/process/exit/teardown.rs                       the four-class revoke on exit with the self-context flag
  src/process/exit/finalize.rs                       the finalize-path revoke after the address space is gone
```

Every reference above is verified against those trees.
