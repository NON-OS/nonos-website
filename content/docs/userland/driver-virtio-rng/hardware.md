---
title: "Hardware bring-up"
description: "Before the capsule can serve a single byte it has to find its device, take it from the broker, map its registers, bind its interrupt, allocate its DMA, and walk the virtio init ..."
weight: 3
---
Before the capsule can serve a single byte it has to find its device, take it from the broker, map its
registers, bind its interrupt, allocate its DMA, and walk the virtio init handshake. This page covers
discovery under `src/discover/`, the ordered broker chain under `src/setup/`, the virtio handshake in
[`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs), and the register accessor under `src/regs/`. For the frame the device fills once it is up
see the [request queue](/docs/userland/driver-virtio-rng/queue/); for the IPC surface see [operations](/docs/userland/driver-virtio-rng/operations/).

The capsule holds no hardware primitive of its own. Every step here is a broker syscall from `nonos_libc`,
and the broker enforces the claim, the epoch, and the grant bounds. The broker subsystem pages are the
authority on those checks: [device claim](/docs/subsystems/hardware-broker/claim/),
[MMIO](/docs/subsystems/hardware-broker/mmio/), [IRQ](/docs/subsystems/hardware-broker/irq/), and
[DMA](/docs/subsystems/hardware-broker/dma/).

## Discovery

`find_virtio_rng` lists up to 32 device records through `mk_device_list` and returns the first that
matches ([`src/discover/find.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/find.rs#L23), `find.rs:21`). A match is a PCI device whose vendor is `0x1AF4` and
whose device id is either the transitional `0x1005` or the modern `0x1044` ([`src/discover/is_match.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/is_match.rs#L19),
[`src/constants/pci.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L22)). The candidate must also advertise an interrupt pin and a usable line
(`irq_pin != 0`, `irq_line != 0xFF`) and expose at least one MMIO or PIO register BAR; the first such BAR
becomes the register window ([`src/discover/find.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/find.rs#L31), [`src/discover/first_register_bar.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/first_register_bar.rs#L18)). The
`Found` record carries the device id, IRQ line, and the register BAR index, kind, and size
([`src/discover/found.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/found.rs#L16)).

`first_register_bar` walks the record's BARs in order, skips a zero-size BAR, and returns the index, kind,
and size of the first MMIO or PIO BAR it finds ([`src/discover/first_register_bar.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/first_register_bar.rs#L19),
`first_register_bar.rs:24`). A device with no usable register BAR yields `None`, which drops it from the
match.

## The broker chain

`setup::run` ([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26)) runs the broker primitives in a fixed order, and each phase
rolls back every earlier grant in reverse order on failure so the broker never holds a partial setup.

### 1. Claim

`claim::claim` calls `mk_device_claim` and returns the claim epoch, or `Err` if the broker refused
([`src/setup/claim.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L24)). The epoch is the root authority every later grant is checked against; it must
travel with every register, IRQ, and DMA call, and a release-and-reclaim by anyone else invalidates a
stale grant handle. The broker refuses a device another capsule already holds
(see [device claim](/docs/subsystems/hardware-broker/claim/)).

### 2. Registers

`registers::grant` maps the register window ([`src/setup/registers/grant.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant.rs#L22)). It dispatches on the
discovered BAR kind: an MMIO BAR calls `mk_mmio_map` for the page-rounded BAR length, and a PIO BAR calls
`mk_pio_grant` ([`src/setup/registers/grant.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant.rs#L23), `grant_mmio.rs:24`, `grant_pio.rs:22`). An unsupported
BAR kind returns an error ([`src/setup/registers/grant.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant.rs#L26)). The resulting `RegisterGrant` is an enum
over the two transports ([`src/setup/registers/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/types.rs#L19)); its `regs()` hides the transport behind a
uniform `Regs` accessor ([`src/setup/registers/regs.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/regs.rs#L20)), and its `release()` unmaps or releases through
the matching call ([`src/setup/registers/release.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/release.rs#L20)). On its own failure each grant path releases the
device claim before returning ([`src/setup/registers/grant_mmio.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant_mmio.rs#L27), `grant_pio.rs:24`). The broker
withholds a device's MSI-X table from any MMIO mapping, which is what keeps interrupt programming in the
kernel (see [MMIO](/docs/subsystems/hardware-broker/mmio/)).

### 3. IRQ

`irq::bind` binds the device interrupt ([`src/setup/irq.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L28)). It tries legacy INTx first with the
discovered line; on a platform where the line's GSI is not routed it falls back to MSI-X vector 1
([`src/setup/irq.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L30), `irq.rs:34`). On a total failure it releases the register grant and the device
claim before returning ([`src/setup/irq.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L36)). The broker leaves the source masked, and the capsule
unmasks it with `mk_irq_ack` once the queue is programmed ([`src/setup/sequence.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L50)). The capsule never
touches the interrupt controller or the MSI-X table (see [IRQ](/docs/subsystems/hardware-broker/irq/)).

### 4. DMA

Two grants. `dma::map_queue` allocates the two-page virtqueue region (`VQ_REGION_SIZE = 8192`), and
`dma::map_buffer` allocates the one-page entropy buffer (`ENTROPY_BUF_LEN = 4096`) ([`src/setup/dma.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L30),
`dma.rs:47`, [`src/constants/queue.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L27), `queue.rs:29`). Each `mk_dma_map` returns both the user virtual
address and the device-visible physical address in a `DmaMapOut` ([`src/setup/dma.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L36), `dma.rs:54`). On
failure each rolls back every prior grant in reverse order: a queue-map failure unbinds the IRQ, releases
the registers, and releases the claim; a buffer-map failure additionally unmaps the queue region first
([`src/setup/dma.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L39), `dma.rs:57`). The RNG device class ceiling is one page, which is exactly what the
entropy buffer needs (see [DMA](/docs/subsystems/hardware-broker/dma/)).

## The virtio handshake

`bring_up` walks the legacy virtio status register in the spec-mandated order ([`src/init.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L28)):

1. Write status 0 to reset, then `ACKNOWLEDGE`, then `DRIVER` ([`src/init.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L30)).
2. Read host features but negotiate none: guest features are cleared to zero, because virtio-rng needs no
   feature bit to function and clearing them keeps the contract tight ([`src/init.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L38), `init.rs:39`).
3. Write `FEATURES_OK` and read the status back; if the device did not keep the bit, write `FAILED` and
   return an error ([`src/init.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L42), `init.rs:44`).
4. Select queue 0 and read its max size; a queue max of zero means the device advertises no requestq, so
   write `FAILED` and refuse to drive it ([`src/init.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L49), `init.rs:51`).
5. Program the queue PFN as the physical page index (`queue_phys >> 12`), not the byte address, because the
   legacy transport expects a page frame number ([`src/init.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L58)).
6. Write `DRIVER_OK` and return the negotiated queue size ([`src/init.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L61)).

The status bits (`ACKNOWLEDGE=1`, `DRIVER=2`, `DRIVER_OK=4`, `FEATURES_OK=8`, `FAILED=0x80`) and the
register offsets come from the virtio 1.x legacy interface ([`src/constants/status.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L22),
[`src/constants/regs.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L20)).

## The register accessor

`Regs` is the uniform read/write interface over the register window, and it hides whether the window is
MMIO or PIO ([`src/regs/state.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state.rs#L19)). The inner `RegIo` enum is either an MMIO base pointer or a PIO grant
id ([`src/regs/io.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/io.rs#L17)). An MMIO access is a `read_volatile`/`write_volatile` at the base plus offset; a
PIO access goes through `mk_pio_read`/`mk_pio_write` with the grant id and the access width
([`src/regs/state.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state.rs#L31), [`src/regs/pio.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/pio.rs#L17), `pio.rs:24`). The `Regs` type exposes 8-, 16-, and 32-bit
reads and writes (`r8`/`r16`/`r32`, `w8`/`w16`/`w32`), and every virtio register touch in `init.rs` and
`fill.rs` goes through it ([`src/regs/state.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state.rs#L31), `state.rs:52`).

## The live driver

The state the server loop holds is a `Driver` carrying the device id, claim epoch, register grant, IRQ
grant id, both DMA grant ids, the `Queue`, and the `Regs` accessor ([`src/setup/driver.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L28)). Its
`release` drops every grant in reverse order (buffer DMA, queue DMA, IRQ, registers, claim), best-effort,
so the kernel sees a clean teardown even on a voluntary exit ([`src/setup/driver.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L44)). A doubly-dropped
grant is harmless because the broker has already revoked it, and the kernel's `release_all_for_pid` on
process exit guarantees a dying capsule leaks no claim, mapping, vector, or DMA region
(see [revocation](/docs/subsystems/hardware-broker/revocation/)).

## Source map

```
  userland/capsule_driver_virtio_rng/src/discover/find.rs             list up to 32 records, first match
  userland/capsule_driver_virtio_rng/src/discover/is_match.rs         vendor 0x1AF4 + device 0x1005/0x1044
  userland/capsule_driver_virtio_rng/src/discover/first_register_bar.rs   first MMIO/PIO BAR
  userland/capsule_driver_virtio_rng/src/discover/found.rs            the Found record
  userland/capsule_driver_virtio_rng/src/setup/sequence.rs            the ordered broker chain
  userland/capsule_driver_virtio_rng/src/setup/claim.rs               mk_device_claim + epoch
  userland/capsule_driver_virtio_rng/src/setup/registers/             MMIO-or-PIO grant, regs, release
  userland/capsule_driver_virtio_rng/src/setup/irq.rs                 INTx then MSI-X fallback
  userland/capsule_driver_virtio_rng/src/setup/dma.rs                 queue + buffer grants, reverse rollback
  userland/capsule_driver_virtio_rng/src/setup/driver.rs              Driver: live grants + reverse release
  userland/capsule_driver_virtio_rng/src/init.rs                      the virtio legacy init handshake
  userland/capsule_driver_virtio_rng/src/regs/state.rs                the MMIO/PIO Regs accessor
  userland/capsule_driver_virtio_rng/src/regs/pio.rs                  mk_pio_read / mk_pio_write
  userland/capsule_driver_virtio_rng/src/constants/pci.rs             vendor and device ids
  userland/capsule_driver_virtio_rng/src/constants/regs.rs            legacy register offsets
  userland/capsule_driver_virtio_rng/src/constants/status.rs          virtio status bits
```

Every reference above is verified against those trees.
