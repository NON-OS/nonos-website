---
title: "DMA Grants"
description: "A device that does bus-master DMA needs memory it can reach by physical address: descriptor rings, queues, framebuffers."
weight: 4
---
A device that does bus-master DMA needs memory it can reach by physical address: descriptor
rings, queues, framebuffers. `MkDmaMap` allocates that memory, zeroes it, maps it into the
capsule for CPU access, and hands back both the user virtual address and the device-visible
physical address. The size a capsule can request is capped per device class. This page
documents the path and its limits. The code is under `src/hardware/broker/dma/`.

## Contents

- [The mapping path](#the-mapping-path)
- [The per-class ceiling](#the-per-class-ceiling)
- [Records and revocation](#records-and-revocation)
- [Security analysis](#security-analysis)
- [Debugging DMA grants](#debugging-dma-grants)
- [Source map](#source-map)

## The mapping path

`map_for_caller` ([`src/hardware/broker/dma/map/mod.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/dma/map/mod.rs#L27)) is a four-step transaction, and it
owns the rollback chain so a failure at any step leaves nothing behind:

```
  map_for_caller(pid, req):
      claim_epoch = validate(req, pid)         else fail
      pages       = req.length / PAGE_SIZE
      phys_start  = alloc_and_zero(pages)       else fail
      user_va     = install(pages, phys_start)  else { free(phys_start); fail }
      record DmaGrant { grant_id, pid, device_id, claim_epoch, phys_start, user_va, length }
      return { user_va, device_addr: phys_start, length, grant_id }
```

`validate` runs the same claim and epoch check as the other grant classes and additionally
bounds the length against the class ceiling. The frames are allocated and zeroed before the
capsule ever sees them, so a DMA buffer never hands the device or the capsule a previous
tenant's bytes. The `install` step maps the frames into the capsule's address space for CPU
access; if it fails, the just-allocated frames are freed before returning, which is why the
allocation and the install are split into their own files with the top function as the
transaction boundary. The returned `device_addr` is the physical start the device programs into
its descriptors.

## The per-class ceiling

A capsule cannot request an unbounded DMA region. `dma_page_limit_for_class`
([`dma/limits.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/limits.rs#L31)) sets a page ceiling per device class, and a request over its class ceiling
is rejected with `BadLengthForClass`:

```
  RNG / INPUT / SERIAL   1 page          NETWORK              64 pages
  AUDIO                  16 pages         USB host (xHCI)      256 pages
  BLOCK                  1024 pages       DISPLAY              8192 pages
  anything unclassified  16 pages (the conservative fallback)
```

The ceilings are sized to the real need of each class, a network descriptor ring or an NVMe
submission and completion queue fits inside its ceiling, a random-number descriptor does not
need more than a page, and a display primary surface is framebuffer sized (8192 pages covers one
3840x2160 ARGB surface). The point is that a misbehaving capsule pays the cost of its own
over-request at its own class ceiling rather than being able to exhaust physical memory through
the DMA path.

## Records and revocation

The grant is recorded as a `DmaGrant` ([`dma/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/types.rs#L20)) carrying the grant id, holder,
device, epoch, physical start, user VA, and length. Revocation mirrors the MMIO paths:
`unmap_grant`, `release_for_device`, and `release_all_for_pid` ([`dma/release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/release.rs)), each of which
unmaps the user pages and frees the frames, with the self-context decision described on the
[revocation](/docs/subsystems/hardware-broker/revocation/) page. Because the frames are broker-allocated (not device BAR
memory), releasing a DMA grant returns real RAM to the frame allocator.

## Security analysis

DMA is the broker's most safety-critical grant, because a device programmed with a physical address
reads and writes real RAM without going through the paging that contains the capsule. Three software
bounds contain it, and one hardware bound is honestly absent.

The **zero-scrub is an information-leak barrier.** `alloc_and_zero` ([`dma/map/alloc.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/map/alloc.rs)) does not trust
the allocator's best-effort `ZERO` flag; it re-scrubs the whole run through the direct map with a
volatile write loop (`zero_run`) before the frames leave the kernel, so a DMA buffer never hands the
device or the capsule a previous tenant's bytes. Releasing a grant returns the frames to the allocator,
and the next tenant scrubs them again.

The **per-class ceiling is a memory-exhaustion bound.** DMA frames are real RAM, not device BAR space,
so an unbounded request would let a capsule drain physical memory through a legitimate syscall.
`dma_page_limit_for_class` caps each class at its real need and refuses an over-request with
`BadLengthForClass` before any allocation happens, so the cost of an over-request falls on the
requester at its own class ceiling.

The **epoch is a use-after-release bound.** Every grant carries the claim epoch, and `validate` rejects
a request whose epoch does not match the current claim (`StaleEpoch`), so a capsule cannot keep using a
`device_id` after its claim lapsed and was re-taken by another capsule.

The **honest boundary is the IOMMU.** NØNOS carries an `IommuDomain` abstraction (`src/memory/iommu/`),
but its hardware backend is behind the `nonos-arch-iommu` feature and is not engaged in the shipping
builds, so the `device_addr` the broker returns is a raw physical address and a device can in principle
DMA to any physical address regardless of the grant. The broker bounds what a *capsule* may allocate and
program; it does not bound what a *malicious or buggy device* does once it is running. DMA safety
therefore rests on the three software bounds above plus the assumption of non-malicious device hardware,
and enabling the IOMMU backend is the path to closing that gap.

## Debugging DMA grants

The DMA path narrates every failure on the console (serial, or the framebuffer on a `NONOS_FBCONSOLE=1`
build), and each line maps to one `DmaMapError` ([`dma/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/types.rs)), so a driver that cannot get its rings
tells you which check failed instead of just not starting:

```
  [DMA] validate not-claimed       NotClaimed         the pid does not hold the device claim
  [DMA] validate stale-epoch       StaleEpoch         the claim was released and re-taken
  [DMA] validate unknown-device    UnknownDevice      the device_id is not in the broker table
  [DMA] validate bad-length        BadLength          zero or misaligned length
  [DMA] validate bad-length-class  BadLengthForClass  over the per-class page ceiling
  [DMA] alloc no-memory            NoMemory           no contiguous run of that many frames
  [DMA] install no-va-space        NoVaSpace          no room in the capsule's user MMIO window
  [DMA] install map-failed         (map error)        the page install itself failed
```

On the allocation failure the broker also prints `[DMA] free-frames=… max-run=… range=…`: the
free-frame count, the largest contiguous run available, and the managed range. So a `no-memory` line
tells you whether the request was merely too large for the current fragmentation (`max-run` smaller than
the request) or whether memory is genuinely exhausted (`free-frames` near zero). The display pool prints
`[DMA] display pool base=… pages=…` at init, or `[DMA] display pool unavailable` if no high run was
found. Read together these turn a silent "the device driver will not start" into a named stage:
`not-claimed` is a claim-ordering bug, `stale-epoch` is a release race, `bad-length-class` is an
over-request, and `no-memory` with a small `max-run` is fragmentation rather than exhaustion.

## Source map

```
  src/hardware/broker/dma/map/mod.rs       the transaction boundary and rollback
  src/hardware/broker/dma/map/validate.rs  claim, epoch, alignment, class-length checks
  src/hardware/broker/dma/map/alloc.rs     allocate and zero frames (the zero-scrub)
  src/hardware/broker/dma/map/install.rs   map the frames into the capsule
  src/hardware/broker/dma/limits.rs        the per-class page ceilings
  src/hardware/broker/dma/pool.rs          the high-memory display surface pool
  src/hardware/broker/dma/types.rs         DmaGrant and the DmaMapError variants
  src/hardware/broker/dma/release.rs       revocation
  src/memory/iommu/                        the IommuDomain abstraction (feature nonos-arch-iommu)
```

Every reference above is verified against those trees. The claim and epoch these checks rest on are on
the [device claim](/docs/subsystems/hardware-broker/claim/) page, the user MMIO window the install competes for is on the
[MMIO](/docs/subsystems/hardware-broker/mmio/) page, and the revocation paths are on the [revocation](/docs/subsystems/hardware-broker/revocation/) page.
