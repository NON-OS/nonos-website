---
title: "Device Claim and Epochs"
description: "Before a capsule can touch a device, it must claim it, and a device can be claimed by only one capsule at a time."
weight: 2
---
Before a capsule can touch a device, it must claim it, and a device can be claimed by only
one capsule at a time. The claim is the root authority every later grant is checked against:
an MMIO mapping, a DMA buffer, an IRQ binding, or a port grant is only issued to the pid that
holds the claim, and only while the claim's epoch is still current. This page documents the
claim table and the epoch. The code is [`src/hardware/broker/claim.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/claim.rs).

## The claim

A `Claim` ([`src/hardware/broker/claim.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/claim.rs#L23)) binds a device to a holder and stamps it with an
epoch:

```
  struct Claim { pid: u32, device_id: u64, epoch: u64 }
```

The claims live in one global `Mutex<Vec<Claim>>`, and `claim` (`claim.rs:48`) refuses a
device that is already claimed:

```
  claim(pid, device_id):
      if any claim has this device_id:  AlreadyClaimed
      epoch = next_epoch()
      push Claim { pid, device_id, epoch }
      return epoch
```

Exclusivity is the first property: `AlreadyClaimed` means one capsule cannot claim a device
another already holds, so two drivers can never both be issued grants for the same hardware.
The claim errors, `UnknownDevice`, `AlreadyClaimed`, `NotHolder`, `NotClaimed`, are the four
distinct ways a claim operation can be refused.

## The epoch

The epoch is a monotonic counter (`claim.rs:39`) bumped on every successful claim. Its purpose
is to invalidate stale authority across a release-and-reclaim cycle. When a capsule claims a
device it receives the epoch; every grant request it later makes carries that `claim_epoch`,
and every grant path re-checks it:

```
  claim = lookup(device_id)          else NotClaimed
  if claim.pid != pid:               NotClaimed
  if claim.epoch != req.claim_epoch: StaleEpoch
```

If the device is released and claimed again, by the same capsule or a different one, the new
claim gets a fresh epoch, so any grant request still quoting the old epoch is rejected with
`StaleEpoch`. This closes the window where a capsule (or a bug) holds a grant handle from a
prior ownership and tries to use it after the device has changed hands. The epoch check appears
verbatim at the head of the [MMIO](/docs/subsystems/hardware-broker/mmio/), [DMA](/docs/subsystems/hardware-broker/dma/), and [IRQ](/docs/subsystems/hardware-broker/irq/) paths.

## Release

`release` (`claim.rs:60`) drops a claim, but only for the holder: a `pid` that is not the
recorded holder gets `NotHolder`, and a device that is not claimed gets `NotClaimed`. Voluntary
release is one path; the other is `release_all_for_pid` (`claim.rs:74`), which retains only the
claims not held by a given pid and is called from the process exit path so a dying capsule
cannot leak a device claim. The [revocation](/docs/subsystems/hardware-broker/revocation/) page covers how the claim drop is
coordinated with dropping the grants that depended on it.

## Security analysis

The claim is the root of the hardware-authority tree, so its two properties propagate to every grant in
the system. Every [MMIO](/docs/subsystems/hardware-broker/mmio/), [DMA](/docs/subsystems/hardware-broker/dma/), [IRQ](/docs/subsystems/hardware-broker/irq/), and [PIO](/docs/subsystems/hardware-broker/pio/) path opens with the
same `lookup(device_id)` then `pid` then `epoch` check, which means a weakness in the claim would be a
weakness in all four. Three properties hold it.

**Exclusivity.** `AlreadyClaimed` guarantees a device has at most one holder, so two capsules can never
both be issued grants for the same hardware. This is what makes a driver capsule's ownership of its
device meaningful: nothing else can be mapping its BARs or taking its interrupts underneath it.

**The epoch is the anti-stale linchpin.** It is a single monotonic counter bumped on every successful
claim, and every grant carries the epoch it was issued under. When a device is released and re-claimed,
by the same capsule or a different one, the new claim gets a fresh epoch, so any grant handle quoting the
old epoch fails `StaleEpoch` at its own path. This closes the use-after-release window a capability system
must close: a stale grant from a prior ownership cannot be replayed against the device after it changed
hands. The check is verbatim at the head of all four grant classes, so there is exactly one place the
rule lives.

**Holder-only mutation.** `release` refuses a `pid` that is not the recorded holder (`NotHolder`), so a
capsule cannot drop or churn another capsule's claim to force a re-claim. The claim table is a single
global mutex, so claim and release are serialized and the epoch counter never races. The involuntary
path, `release_all_for_pid` from process exit, guarantees a dying capsule leaks no claim.

## Debugging device claims

The four `ClaimError` variants each name a distinct situation, and two of them are the common bring-up
failures. A driver whose claim retry loop never exits (the yield-and-retry in every driver's `main.rs`)
is being refused one of two ways. **`AlreadyClaimed`** means another capsule already holds the device:
either two drivers were spawned for the same hardware, or a previous instance did not release it. This
is a spawn-plan problem, not a device problem. **`UnknownDevice`** means the `device_id` is not in the
broker table at all, which is a discovery problem one layer down: the device was never enumerated from
PCI or recovered from ACPI, so no driver can claim it. The tool for the second case is a
`NONOS_DEVICE_CENSUS=1` build, which renders the broker device table to the framebuffer and holds, so you
can read off whether the device is present before any driver runs. Separately, a `StaleEpoch` seen not at
claim but at a *grant* means the device changed hands between the claim and the grant, a release race
worth tracing. `NotHolder` and `NotClaimed` on a release are the mirror: releasing a device you do not
hold, or one nobody holds.

## Source map

```
  src/hardware/broker/claim.rs   Claim, the epoch counter, claim / release / release_all_for_pid,
                                 and the ClaimError variants
```

Every reference above is verified against that file. The four grant classes that re-check this claim and
epoch are on the [MMIO](/docs/subsystems/hardware-broker/mmio/), [DMA](/docs/subsystems/hardware-broker/dma/), [IRQ](/docs/subsystems/hardware-broker/irq/), and [PIO](/docs/subsystems/hardware-broker/pio/) pages; the exit wiring
that calls `release_all_for_pid` is on the [revocation](/docs/subsystems/hardware-broker/revocation/) page.
