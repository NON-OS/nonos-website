---
title: "Device bring-up and broker grants"
description: "This page covers how the driver goes from a cold start to a live device: it finds the virtio-blk device on the broker's list, claims it, takes the register, interrupt, and DMA g..."
weight: 1
---
This page covers how the driver goes from a cold start to a live device: it finds the virtio-blk device on
the broker's list, claims it, takes the register, interrupt, and DMA grants in order, walks the legacy
virtio handshake, and probes capacity. It mirrors [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/setup/`, [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs), and
`src/regs/`. For the request path that runs on top of a live device see the [queue](/docs/userland/driver-virtio-blk/queue/) page; for the
client protocol see [client](/docs/userland/driver-virtio-blk/client/). The broker's own view of each grant is in
[claim](/docs/subsystems/hardware-broker/claim/), [mmio](/docs/subsystems/hardware-broker/mmio/),
[irq](/docs/subsystems/hardware-broker/irq/), and [dma](/docs/subsystems/hardware-broker/dma/).

## Discovery

`find_virtio_blk` lists broker devices through `mk_device_list` into a fixed 32-entry buffer and returns the
first that matches ([`src/discover.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L27)). A match is virtio vendor `0x1AF4` on a PCI bus with device id
`0x1001` (transitional) or `0x1042` (modern) ([`src/discover.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L52), [`src/constants/pci.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L16)). A matching
record with no interrupt pin or an unrouted line (`irq_line == 0xFF`) is skipped, so the driver never binds
to a device it cannot get interrupts from ([`src/discover.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L37)). It then picks the first BAR with a
non-zero size whose kind is PIO or MMIO, and returns a `Found` carrying the device id, the interrupt line,
and the register BAR index, kind, and size ([`src/discover.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L57)).

## The bring-up transaction

`setup::run` is the ordered transaction ([`src/setup/sequence.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L23)). Each step depends on the grant the
previous one produced, and each failure rolls back the grants already taken through the `rollback` helpers,
so a failed bring-up leaves the device unclaimed and no grants leaked.

| Step | Call | Produces | Rollback on failure | Source |
|---|---|---|---|---|
| Discover | `find_virtio_blk` | `Found` | none (nothing taken) | `sequence.rs:24` |
| Claim | `claim::claim` | claim epoch | none | `sequence.rs:25` |
| Registers | `registers::grant` | `RegisterGrant` | release device | `sequence.rs:26` |
| IRQ | `irq::bind` | `IrqBindOut` | release regs, device | `sequence.rs:27` |
| DMA queue | `dma::map_queue` | queue region | unbind irq, release regs, device | `sequence.rs:28` |
| DMA header | `dma::map_header` | header region | unmap queue, then base | `sequence.rs:29` |
| DMA data | `dma::map_data` | data region | unmap header, then queue, then base | `sequence.rs:31` |
| Negotiate | `bring_up` | queue size | virtio `FAILED` bit | `sequence.rs:40` |
| Probe and arm | read capacity, ack irq | `Driver` | error return | `sequence.rs:50` |

### Claim

`claim::claim` calls `mk_device_claim` and returns the claim epoch, a `u64`, on success
([`src/setup/claim.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L17)). The epoch is the broker's anti-stale linchpin: every later grant quotes it, and
a grant quoting an old epoch after a release is rejected
([claim](/docs/subsystems/hardware-broker/claim/)). The claim is exclusive, so once it succeeds no other
capsule can be mapping this device's BARs or taking its interrupts underneath the driver.

### Registers

`registers::grant` maps the register BAR according to its kind ([`src/setup/registers.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers.rs#L42)). An MMIO BAR
goes through `mk_mmio_map` with the length page-rounded up ([`src/setup/registers.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers.rs#L51)); a port BAR goes
through `mk_pio_grant` ([`src/setup/registers.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers.rs#L63)). Either way the result is wrapped in a `RegisterGrant`
enum, and `RegisterGrant::regs` turns it into a `Regs` handle so the rest of the driver reads registers the
same way regardless of BAR kind ([`src/setup/registers.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers.rs#L29)). A map failure releases the device claim
before returning ([`src/setup/registers.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers.rs#L54)). Register access is uncached device memory, never RAM
([mmio](/docs/subsystems/hardware-broker/mmio/)).

### IRQ

`irq::bind` binds the device interrupt, trying legacy INTx on the discovered line first through
`mk_irq_bind`, and falling back to MSI-X with the `MK_IRQ_BIND_MSIX` flag if that fails
([`src/setup/irq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L19)). A total failure releases the register grant and then the device claim before
returning ([`src/setup/irq.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L27)). The grant delivers the device interrupt on a kernel-owned vector; the
capsule waits and acknowledges through syscalls and never touches the interrupt controller
([irq](/docs/subsystems/hardware-broker/irq/)).

### DMA

Three `mk_dma_map` calls allocate the three device-visible regions in order, and each rolls back all prior
grants on failure:

- the virtqueue ring, `VQ_REGION_SIZE` = 16384 bytes ([`src/setup/dma/map_queue.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/map_queue.rs#L20));
- the request header buffer, `HEADER_BUF_LEN` = 4096 bytes ([`src/setup/dma/map_header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/map_header.rs#L20));
- the data buffer, `DATA_BUF_LEN` = 64 * 512 = 32768 bytes ([`src/setup/dma/map_data.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/map_data.rs#L20),
  [`src/constants/queue.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L26)).

Each region carries a `user_va` the driver writes through and a `device_addr` the device programs into its
descriptors, allocated and zeroed by the broker before the capsule sees it
([dma](/docs/subsystems/hardware-broker/dma/)). The rollback chain is layered: `rollback::base` unbinds
the irq, releases the registers, and releases the device; `rollback::queue` unmaps the queue then calls
`base`; `rollback::header` unmaps the header then calls `queue` ([`src/setup/dma/rollback.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/rollback.rs#L18)). The
ordering is the reverse of acquisition, so teardown mirrors bring-up.

## The virtio handshake

`bring_up` walks the legacy virtio status handshake over the register BAR ([`src/init.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L25)). The status
byte at `LEG_STATUS` (0x12) is driven through the standard sequence, and features are negotiated narrowly.

| Step | What it writes or reads | Source |
|---|---|---|
| Reset | status = 0 | `init.rs:27` |
| Acknowledge | status |= `ACKNOWLEDGE` (1) | `init.rs:28` |
| Driver | status |= `DRIVER` (2) | `init.rs:30` |
| Read features | host features from `LEG_HOST_FEATURES` (0x00) | `init.rs:31` |
| Offer features | write back only `VIRTIO_BLK_F_FLUSH` (bit 9) if host advertised it | `init.rs:32` |
| Features-ok | status |= `FEATURES_OK` (8), then re-read | `init.rs:35` |
| Features rejected | if `FEATURES_OK` cleared, set `FAILED` (0x80) and abort | `init.rs:37` |
| Select queue 0 | `LEG_QUEUE_SEL` (0x0E) = 0 | `init.rs:41` |
| Read queue size | `LEG_QUEUE_NUM` (0x0C); reject 0, `<3`, or `> max_supported` | `init.rs:42` |
| Program PFN | `LEG_QUEUE_PFN` (0x08) = queue_phys >> 12 | `init.rs:52` |
| Driver-ok | status |= `DRIVER_OK` (4) | `init.rs:53` |

The only feature the driver offers back is `VIRTIO_BLK_F_FLUSH`, and only if the device advertised it
([`src/init.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L21), [`src/init.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L32)); everything else is masked off, so the device runs in its simplest
legacy mode. The queue size must be at least 3 (a chain needs header, data, and status descriptors) and at
most `Queue::max_supported_size()` = `MAX_QUEUE_SIZE` = 256 ([`src/init.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L47), [`src/constants/queue.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L16)).
The status-register writes on the two abort paths set the `FAILED` bit so the device knows the driver gave
up ([`src/init.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L38), [`src/init.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L44), [`src/init.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L48)).

## Probe and arm

After `DRIVER_OK`, `setup::run` reads `capacity_sectors` from the legacy config capacity register at offset
`0x14` as a 64-bit value and rejects a zero capacity ([`src/setup/sequence.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L50),
[`src/constants/regs.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L23)). `r64` is assembled from two 32-bit reads, low word then high
([`src/regs/state/r64.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state/r64.rs#L20)). It then acknowledges the initial interrupt with `mk_irq_ack` and returns a
`Driver` holding the IRQ grant id, the `Queue`, the `Regs` handle, and the capacity
([`src/setup/sequence.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L54), [`src/setup/driver.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L18)). From this point the [queue](/docs/userland/driver-virtio-blk/queue/) engine and the
[client](/docs/userland/driver-virtio-blk/client/) server take over.

## The register abstraction

`Regs` hides whether the BAR is MMIO or PIO behind one type. It holds a `RegIo` that is either an MMIO base
pointer or a PIO grant id ([`src/regs/io.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/io.rs#L16), [`src/regs/state/types.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state/types.rs#L18)). The sized accessors
(`r8`/`r16`/`r32`/`r64` and `w8`/`w16`/`w32`) each match on the `RegIo`: an MMIO access is a volatile
read or write at `base + offset`, a PIO access is a `mk_pio_read`/`mk_pio_write` through the grant with the
width in bytes ([`src/regs/state/r32.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state/r32.rs#L23), [`src/regs/pio.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/pio.rs#L17)). This is why the mask carries both `Mmio`
and `Pio`: the driver takes whichever BAR the device exposes and reads it uniformly, and the handshake and
the queue notify above are written through the same `Regs` handle without caring which one backs it.

## Source map

```
  src/discover.rs             find_virtio_blk: vendor/device match, irq check, register BAR pick
  src/constants/pci.rs        VIRTIO_VENDOR_ID, VIRTIO_BLK_TRANSITIONAL, VIRTIO_BLK_MODERN
  src/setup/sequence.rs       the ordered bring-up transaction and the capacity probe
  src/setup/claim.rs          mk_device_claim and the epoch
  src/setup/registers.rs      the MMIO/PIO register grant and RegisterGrant enum
  src/setup/irq.rs            INTx-then-MSI-X bind with rollback
  src/setup/dma/map_queue.rs  the queue ring region
  src/setup/dma/map_header.rs the request header region
  src/setup/dma/map_data.rs   the data region
  src/setup/dma/rollback.rs   the layered base/queue/header rollback chain
  src/setup/driver.rs         the Driver struct handed back on success
  src/init.rs                 bring_up: the legacy status handshake and feature negotiation
  src/constants/status.rs     ACKNOWLEDGE, DRIVER, DRIVER_OK, FEATURES_OK, FAILED
  src/constants/regs.rs       the legacy register offsets
  src/constants/queue.rs      MAX_QUEUE_SIZE and the region sizes
  src/regs/io.rs              the RegIo enum (MMIO pointer or PIO grant)
  src/regs/state/             the Regs type and its sized accessors
  src/regs/pio.rs             mk_pio_read/mk_pio_write wrappers
```

Every reference above is verified against those trees.
