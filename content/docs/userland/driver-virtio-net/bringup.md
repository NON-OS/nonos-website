---
title: "Device bring-up and broker grants"
description: "This page covers how the driver goes from a cold start to a live device: it finds the virtio-net device on the broker's list, claims it, takes the register, interrupt, and four ..."
weight: 2
---
This page covers how the driver goes from a cold start to a live device: it finds the virtio-net device
on the broker's list, claims it, takes the register, interrupt, and four DMA grants in order, walks the
legacy virtio handshake, reads the MAC, and programs both queues. It mirrors `src/discover/`,
`src/setup/`, `src/init/`, and `src/regs/`. For the frame path that runs on top of a live device see the
[queues](/docs/userland/driver-virtio-net/queues/) page; for the client protocol see [operations](/docs/userland/driver-virtio-net/operations/). The broker's own view
of each grant is in [claim](/docs/subsystems/hardware-broker/claim/),
[mmio](/docs/subsystems/hardware-broker/mmio/), [irq](/docs/subsystems/hardware-broker/irq/), and
[dma](/docs/subsystems/hardware-broker/dma/).

## Discovery

`find_virtio_net` lists broker devices through `mk_device_list` into a fixed 32-entry buffer and returns
the first that matches ([`src/discover/find_virtio_net.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/find_virtio_net.rs#L24)). A match is virtio vendor `0x1AF4` on a PCI
bus with device id `0x1000` (transitional) or `0x1041` (modern) ([`src/discover/is_match.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/is_match.rs#L21),
[`src/constants/pci.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L22)). Discovery deliberately does not filter on the interrupt pin or line: q35
firmware often leaves `irq_line` at `0xFF`, and `irq::bind` prefers MSI-X and only falls back to the
legacy line, so filtering on those fields here would discard MSI-X-capable NICs before bind could run and
leave setup looping forever ([`src/discover/find_virtio_net.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/find_virtio_net.rs#L32)). This is the one place where the
virtio-net driver's discovery differs from the block driver's, and the comment in the source records why.
It then picks the first BAR with a non-zero size whose kind is PIO or MMIO, and returns a `Found` carrying
the device id, the interrupt line, and the register BAR index, kind, and size
([`src/discover/first_register_bar.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/first_register_bar.rs#L19), [`src/discover/found.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/found.rs#L17)).

## The bring-up transaction

`setup::run` is the ordered transaction ([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)). Each step emits a `[net-setup]`
stage marker over `mk_debug` before it runs, so a stuck bring-up names the step it died on
([`src/setup/stage.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/stage.rs#L19)). Each DMA step rolls back all prior grants on failure through the shared
`rollback::after` helper, so a failed bring-up leaves the device unclaimed and no grants leaked.

| Step | Call | Produces | Rollback on failure | Source |
|---|---|---|---|---|
| Discover | `find_virtio_net` | `Found` | none (nothing taken) | `sequence.rs:29` |
| Claim | `claim::claim` | claim epoch | none | `sequence.rs:31` |
| Registers | `registers::map` | `RegisterGrant` | release device | `sequence.rs:33` |
| IRQ | `irq::bind` | `(IrqBindOut, msix)` | release regs, device | `sequence.rs:35` |
| DMA | `dma_set::map` | four regions | unbind irq, release regs, device | `sequence.rs:37` |
| Negotiate | `negotiate` | feature bits | virtio `FAILED` bit | `sequence.rs:40` |
| Read MAC | `config::read_mac` | 6-byte MAC | none | `sequence.rs:43` |
| Queues | `queues::build` | `(RxQueue, TxQueue)` | virtio `FAILED` bit | `sequence.rs:45` |
| Prime and arm | `rx.prime`, `driver_ok`, RX notify, irq ack | `Driver` | error return | `sequence.rs:46` |

### Claim

`claim::claim` calls `mk_device_claim` and returns the claim epoch, a `u64`, on success
([`src/setup/claim.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L22)). The epoch is the broker's anti-stale linchpin: every later grant quotes it,
and a grant quoting an old epoch after a release is rejected
([claim](/docs/subsystems/hardware-broker/claim/)). The claim is exclusive, so once it succeeds no
other capsule can be mapping this device's BARs or taking its interrupts underneath the driver.

### Registers

`registers::map` maps the register BAR according to its kind ([`src/setup/registers/map.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/map.rs#L24)). An MMIO
BAR goes through `mk_mmio_map` with the length page-rounded up ([`src/setup/registers/grant_mmio.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant_mmio.rs#L23));
a port BAR goes through `mk_pio_grant` ([`src/setup/registers/grant_pio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant_pio.rs#L22)). Either way the result is
wrapped in a `RegisterGrant` enum, and `RegisterGrant::regs` turns it into a `Regs` handle so the rest of
the driver reads registers the same way regardless of BAR kind ([`src/setup/registers/regs.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/regs.rs#L21)). A map
failure, or an unsupported BAR kind, releases the device claim before returning
([`src/setup/registers/grant_mmio.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant_mmio.rs#L29), [`src/setup/registers/map.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/map.rs#L29)). Register access is uncached
device memory, never RAM ([mmio](/docs/subsystems/hardware-broker/mmio/)).

### IRQ

`irq::bind` binds the device interrupt, trying legacy INTx on the discovered line first through
`mk_irq_bind`, and falling back to MSI-X with the `MK_IRQ_BIND_MSIX` flag and one vector if that fails
([`src/setup/irq.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L28)). The boolean it returns records whether MSI-X won, because MSI-X shifts the
device config layout by 4 bytes and the caller uses that to place the MAC and status offsets
([`src/setup/irq.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L32), [`src/setup/sequence.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L42)). A total failure releases the register grant and then
the device claim before returning ([`src/setup/irq.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L36)). The grant delivers the device interrupt on a
kernel-owned vector; the capsule waits and acknowledges through syscalls and never touches the interrupt
controller ([irq](/docs/subsystems/hardware-broker/irq/)).

### DMA

`dma_set::map` allocates four device-visible regions in order, and each rolls back all prior grants on
failure ([`src/setup/dma_set.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma_set.rs#L29)):

- the RX virtqueue ring, `VQ_REGION_SIZE` = 12288 bytes ([`src/setup/dma/rx_queue.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/rx_queue.rs#L23),
  [`src/constants/queue.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L37));
- the RX buffers, `RX_BUFFER_LEN * RX_DESC_COUNT` = 2048 * 64 = 131072 bytes
  ([`src/setup/dma/rx_buffer.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/rx_buffer.rs#L31), [`src/constants/queue.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L48));
- the TX virtqueue ring, another `VQ_REGION_SIZE` = 12288 bytes ([`src/setup/dma/tx_queue.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/tx_queue.rs#L23));
- the TX buffer, `TX_BUFFER_LEN * TX_DESC_COUNT` page-rounded, 2048 * 8 = 16384 bytes
  ([`src/setup/dma/tx_buffer.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/tx_buffer.rs#L33), [`src/constants/queue.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L49)).

Each region carries a `user_va` the driver writes through and a `device_addr` the device programs into
its descriptors, allocated and zeroed by the broker before the capsule sees it
([dma](/docs/subsystems/hardware-broker/dma/)). The rollback is one shared helper: `rollback::after`
unmaps each already-taken DMA grant in reverse, unbinds the irq, releases the registers, and releases the
device, and each map site passes it the grant ids taken so far
([`src/setup/dma/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/rollback.rs#L21), [`src/setup/dma/tx_buffer.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma/tx_buffer.rs#L38)). The ordering is the reverse of
acquisition, so teardown mirrors bring-up.

## The virtio handshake

`negotiate` walks the legacy virtio status handshake over the register BAR ([`src/init/negotiate.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/negotiate.rs#L24)).
The status byte at `LEG_STATUS` (0x12) is driven through the standard sequence, and features are
negotiated narrowly.

| Step | What it writes or reads | Source |
|---|---|---|
| Reset | status = 0 | `negotiate.rs:26` |
| Acknowledge | status = `ACKNOWLEDGE` (1) | `negotiate.rs:27` |
| Driver | status |= `DRIVER` (2) | `negotiate.rs:28` |
| Read features | host features from `LEG_HOST_FEATURES` (0x00) | `negotiate.rs:29` |
| Offer features | write back only `VIRTIO_NET_F_MAC` and `VIRTIO_NET_F_STATUS` masked against host | `negotiate.rs:30` |
| Features-ok | status |= `FEATURES_OK` (8), then re-read | `negotiate.rs:33` |
| Features rejected | if `FEATURES_OK` cleared, set `FAILED` (0x80) and abort | `negotiate.rs:35` |

The only features the driver offers back are `VIRTIO_NET_F_MAC` (bit 5) and `VIRTIO_NET_F_STATUS`
(bit 16), and each only if the host advertised it ([`src/init/negotiate.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/negotiate.rs#L30), [`src/constants/regs.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L33));
everything else is masked off, so the device runs in its simplest legacy mode. The function returns the
accepted feature bits, which the caller uses to decide whether to read the MAC and where to place the
config offsets ([`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41), [`src/setup/config.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/config.rs#L20)). If the device clears `FEATURES_OK`
after the driver set it, the driver sets the `FAILED` bit and returns `virtio-net: features-ok rejected`
([`src/init/negotiate.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/negotiate.rs#L37)).

`DRIVER_OK` is not set here. It is deferred until after both queues are programmed and RX is primed, so
the device sees a fully-armed driver before it is told to run: `driver_ok` sets the bit at the end of
bring-up ([`src/init/driver_ok.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/driver_ok.rs#L20), [`src/setup/sequence.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L47)).

## Programming the queues

`queues::build` zeroes both ring regions, programs each queue into the device, and constructs the
`RxQueue`/`TxQueue` state ([`src/setup/queues.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/queues.rs#L23)). `program_queue` selects the queue with
`LEG_QUEUE_SEL` (0x0E), reads the device's max ring size from `LEG_QUEUE_NUM` (0x0C), validates it, and
writes the ring physical page frame into `LEG_QUEUE_PFN` (0x08) ([`src/init/program_queue.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/program_queue.rs#L20)). The
validation rejects a zero max size, a ring physical address that is not page-aligned, or one whose page
frame does not fit 32 bits (`queue_phys >> 44 != 0`), setting the device `FAILED` bit and returning
`virtio-net: invalid queue` on any of them ([`src/init/program_queue.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/program_queue.rs#L29)). The negotiated size is the
minimum of the device max and the driver's hint, `RX_QUEUE_SIZE` = 64 for RX and `TX_QUEUE_SIZE` = 8 for
TX ([`src/init/program_queue.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/program_queue.rs#L33), [`src/constants/queue.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L30)).

## Read the MAC and arm

`config::read_mac` reads six bytes from the config MAC register, one byte at a time, but only if
`VIRTIO_NET_F_MAC` was negotiated; otherwise it returns zeroes ([`src/setup/config.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/config.rs#L24)). The MAC
register base is `LEG_MAC` (0x14), shifted up by 4 when MSI-X is active, and the link-status word sits at
base plus 6 ([`src/setup/sequence.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L42), [`src/setup/sequence.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L70)). After the queues are built,
`rx.prime` publishes every RX descriptor into the available ring, `driver_ok` sets `DRIVER_OK`, the driver
kicks the RX queue with a `LEG_QUEUE_NOTIFY` (0x10) write, and `mk_irq_ack` acknowledges the initial
interrupt; a failed ack returns `virtio-net: irq ack failed` ([`src/setup/sequence.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L46)). It then hands
back a `Driver` holding the register grant, the IRQ and four DMA grant ids for teardown, the two queues,
the `Regs` handle, the MAC, and the status support flag with its offset ([`src/setup/driver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L24)). From
this point the [queues](/docs/userland/driver-virtio-net/queues/) engine and the [operations](/docs/userland/driver-virtio-net/operations/) server take over.

## The register abstraction

`Regs` hides whether the BAR is MMIO or PIO behind one type. It holds a `RegIo` that is either an MMIO
base pointer or a PIO grant id ([`src/regs/io.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/io.rs#L18), [`src/regs/regs_type.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/regs_type.rs#L20)). The sized accessors
(`r8`/`r16`/`r32` and `w8`/`w16`/`w32`) each match on the `RegIo`: an MMIO access is a volatile read or
write at `base + offset`, a PIO access is a `mk_pio_read`/`mk_pio_write` through the grant with the width
in bytes ([`src/regs/r32.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/r32.rs#L24), [`src/regs/pio_read.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/pio_read.rs#L19)). This is why the mask carries both `Mmio` and
`Pio`: the driver takes whichever BAR the device exposes and reads it uniformly, and the handshake and
the queue notifies above are written through the same `Regs` handle without caring which one backs it.

## Source map

```
  src/discover/find_virtio_net.rs   the vendor/device match and the no-irq-filter comment
  src/discover/is_match.rs          VIRTIO_VENDOR_ID and the transitional/modern device ids
  src/discover/first_register_bar.rs  the register BAR pick
  src/constants/pci.rs              VIRTIO_NET_TRANSITIONAL, VIRTIO_NET_MODERN, VIRTIO_VENDOR_ID
  src/setup/sequence.rs             the ordered bring-up transaction and the config offsets
  src/setup/stage.rs                the [net-setup] stage markers
  src/setup/claim.rs                mk_device_claim and the epoch
  src/setup/registers/             the MMIO/PIO register grant and the RegisterGrant enum
  src/setup/irq.rs                  INTx-then-MSI-X bind with rollback and the msix flag
  src/setup/dma_set.rs              the four-region DMA transaction
  src/setup/dma/                    the RX/TX ring and buffer maps and the shared rollback
  src/setup/config.rs               read_mac and feature_enabled
  src/setup/driver.rs              the Driver struct handed back on success
  src/init/negotiate.rs             the legacy status handshake and feature negotiation
  src/init/program_queue.rs         queue select, size validation, and PFN program
  src/init/driver_ok.rs             the deferred DRIVER_OK
  src/constants/status.rs           ACKNOWLEDGE, DRIVER, DRIVER_OK, FEATURES_OK, FAILED
  src/constants/regs.rs             the legacy register offsets and the feature bits
  src/constants/queue.rs            VQ_REGION_SIZE, queue sizes, buffer lengths
  src/regs/                         the Regs type, the RegIo enum, and the sized accessors
```

Every reference above is verified against those trees.
