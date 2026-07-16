---
title: "The Block Device Layer"
description: "Under any on-disk filesystem is a block device, and NØNOS presents one uniform block interface over three real backends: NVMe, AHCI, and virtio-blk."
weight: 1
---
Under any on-disk filesystem is a block device, and NØNOS presents one uniform block interface over
three real backends: NVMe, AHCI, and virtio-blk. The kernel side is a thin dispatcher; the drivers
themselves are signed capsules reached over IPC. This page documents the backend selection and the
block operations. The code is under `src/hardware/block_device/`.

## The backend

A `Backend` (`backend.rs:18`) names the three supported controllers, and `selected` (`select.rs:23`)
picks one at first use by probing for capacity in a fixed order:

```
  selected():   // memoized in a Once
      if nvme_capsule::capacity() > 0:  Nvme
      if ahci_capsule::capacity() > 0:  Ahci
      else:                             VirtioBlk
```

NVMe is preferred, then AHCI, then virtio-blk as the fallback that a QEMU guest usually presents.
The choice is made once and cached, so every later operation goes to the same backend. Each of the
three is a real driver, not a stub: NVMe, AHCI, and virtio-blk are all implemented as capsules under
`src/hardware/`, spawned at boot.

## Block operations

The block interface is `read`, `write`, `flush`, `capacity`, and `geometry`, and each dispatches to
the selected backend's capsule client. `read` (`read.rs:24`) is representative:

```
  read(lba, out):
      match selected():
          VirtioBlk => virtio_blk_capsule::read_blocks(lba, out)
          Ahci      => ahci_capsule::read_blocks(lba, out)
          Nvme      => nvme_capsule::read_blocks(lba, out)
```

The call reaches the driver capsule, which owns the controller through the
[hardware broker](/docs/subsystems/hardware-broker/) and performs the actual device I/O, then copies the
sectors back. This is real hardware access, not an in-memory shim: the block layer is a dispatcher
that forwards a logical block address and a buffer to whichever driver capsule owns the disk. The
geometry is 512-byte sectors (`geometry.rs`), and the errors from each backend are normalized to one
`BlockDeviceError` through the per-backend `map_*_error` functions so a caller sees one error type.

## Where drivers live

The driver capsules are the same kind of ring-3 capsule as everything else: they claim their
controller through the broker, map its registers and set up DMA rings for the queues, and serve block
reads and writes over IPC. The block layer documented here is the kernel-side seam that a filesystem
calls; the driver-side is a capsule. This keeps the disk driver out of the kernel proper, so a bug in
an NVMe or AHCI driver is contained in a capsule rather than being a kernel fault.

## Security analysis

A block driver is the most authority-heavy capsule in the storage stack, because unlike a HID
report parser it does reach hardware directly. What contains it is that the authority is scoped to
one device and minted through the broker, and the block layer above it never runs driver code in the
kernel.

The **driver holds only its own device's grants.** Each driver capsule is spawned with a fixed
capability mask ([`src/hardware/nvme_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/nvme_capsule/spawn.rs#L51), [`ahci_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ahci_capsule/spawn.rs),
[`virtio_blk_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/virtio_blk_capsule/spawn.rs)): IPC, Memory, Driver, DeviceEnum, Mmio, Irq, and Dma, which decodes to
`0xF8018` for NVMe and AHCI, and `0x1F8018` for virtio-blk because it additionally holds Pio for the
legacy virtio I/O ports (bits from [`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)). Those capabilities let it claim a
device and mint MMIO, IRQ, and DMA grants, but the broker checks every grant against the claim epoch,
so a driver can only map the BAR, bind the IRQ, and program the DMA of the one device it claimed. It
cannot reach across to another controller's registers, and a second capsule that tried to claim an
already-claimed device is refused. The NVMe setup shows the scoping directly: `find_nvme`
(`discover.rs:32`) enumerates only `CLASS_BLOCK` devices, `claim` ([`setup/claim.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/claim.rs)) takes the epoch,
and `mmio::map` ([`setup/mmio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/mmio.rs)) maps `NVME_BAR_INDEX` under that epoch and rolls the claim back if
the map fails.

The **DMA buffers are broker-zeroed and ceiling-bounded.** The queues and data buffers a driver
programs into the controller are `mk_dma_map` grants ([`dma/region.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/region.rs#L28) for NVMe, [`setup/dma.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/dma.rs) for
virtio-blk), which the broker allocates, scrubs, and hands back with a device-visible physical
address. A block driver cannot request an unbounded region: the BLOCK class ceiling is 1024 pages
([`src/hardware/broker/dma/limits.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/dma/limits.rs#L40)), so an NVMe submission and completion queue pair
([`admin/queue/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/admin/queue/types.rs#L20), the `sq` and `cq` DMA regions) plus its data buffers fit inside the
ceiling and a runaway request is refused with `BadLengthForClass` before any RAM is allocated. Each
`DmaRegion` unmaps itself on drop ([`dma/region.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/region.rs#L46)), so the frames return to the allocator when the
driver exits or the region goes out of scope.

The **block layer above the drivers runs no driver code.** `src/hardware/block_device/` is a
dispatcher, not a driver: `selected` (`select.rs:23`) picks a backend once by probing capacity, and
`read` / `write` / `flush` forward a logical block address and a buffer to the capsule client
(`read.rs:24`). A filesystem calling `read_all` never executes NVMe or AHCI register code in the
kernel; it sends an IPC request to the capsule that owns the disk. So a parsing or queue bug in a disk
driver is a fault in a ring-3 capsule the kernel can tear down, not a kernel fault.

The **honest boundary is the same IOMMU gap as every DMA grant.** The `device_addr` the broker returns
to a block driver is a raw physical address, because the IOMMU backend is behind the
`nonos-arch-iommu` feature and is not engaged in shipping builds (see the
[DMA grants](/docs/subsystems/hardware-broker/dma/#security-analysis) page). The broker bounds what the driver
capsule may allocate and program, but it does not bound what the controller does once the driver has
handed it a descriptor: a compromised or buggy storage controller can in principle DMA to any physical
address regardless of the grant. Block-driver DMA safety therefore rests on the per-device grant
scoping and the zero-scrub plus the assumption of non-malicious controller hardware, and enabling the
IOMMU backend is the path to closing that last gap.

## Debugging the block layer

A disk that never appears has one of a small number of causes, and because the driver is a capsule
reached over the broker and IPC, each cause shows up as a different line rather than a silent hang. On
a machine with a serial port the boot log carries it; a `NONOS_FBCONSOLE=1` build mirrors the same log
to the framebuffer (`src/sys/boot_log/`).

**Did the driver capsule spawn.** Each driver is spawned through `capsule_boot::boot`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which prints `capsule spawned` on success and
`boot_log::error(...)` with the spawn reason on failure, tagged with the driver's prefix
(`[DRIVER-NVME]`, `[DRIVER-AHCI]`, `[DRIVER-VIRTIO-BLK]` from [`spawn_plan/drivers_storage.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/drivers_storage.rs) and
`drivers_virtio_io.rs`). An absent `[DRIVER-NVME] capsule spawned` line means the capsule's ELF failed
signature verification or its manifest asked for a capability outside policy, and no driver ran.

**Did the driver find its device, or fail a grant.** A spawned driver that still serves no capacity
exited during setup, and the exit code names the stage. For NVMe those codes are explicit
([`error/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/error/types.rs#L30)): `DeviceNotFound` (30) means `mk_device_list(CLASS_BLOCK, ...)`
(`discover.rs:34`) returned nothing, so the firmware never enumerated an NVMe controller into the
broker table ([`src/hardware/broker/table/list.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/table/list.rs)); `ClaimFailed` (31) means another capsule already
holds the device; and `BrokerCallFailed` (32) means an MMIO or DMA grant was refused. A DMA grant
refused over the class ceiling narrates itself on the broker side as `[DMA] validate bad-length-class`
(`BadLengthForClass`, [`dma/map/mod.rs:76`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dma/map/mod.rs#L76)), and a grant against a lapsed claim as
`[DMA] validate stale-epoch`, using the same marker vocabulary as the [DMA grants](/docs/subsystems/hardware-broker/dma/#debugging-dma-grants)
page. So a driver that dies at DMA setup tells you whether it over-requested or raced a claim release.

**Is the IRQ the problem, and does it matter.** For NVMe the answer is that it usually does not:
`irq::bind` ([`setup/irq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/irq.rs)) treats the MSI-X bind as best effort and, on a failed bind, continues in
polling mode with a zero grant, because the command path polls every completion rather than waiting on
the interrupt. So an NVMe controller that comes up but delivers no interrupt still serves reads. AHCI
and virtio-blk take their own IRQ grants under the claim epoch, and a silent-but-bound interrupt on
those is the same GSI-to-vector routing question as any other device (the [IOAPIC](/docs/subsystems/interrupts/)).

**Driver-spawn failure versus device-enumeration failure.** These are the two failures that look alike
from the desktop, and the log tells them apart. A missing `[DRIVER-*] capsule spawned` line is a
spawn-side failure: verification or capability policy stopped the capsule before it ran, and no amount
of correct hardware helps. A spawned driver that exits with `DeviceNotFound` is an enumeration-side
failure: the capsule ran but the broker device table held no matching controller, which is a
firmware/PCI problem rather than a driver bug, because `find_nvme` filters on
`pci_class == PCI_CLASS_STORAGE`, `pci_subclass == PCI_SUBCLASS_NVM`, and `pci_progif == PCI_PROGIF_NVME`
(`discover.rs:49`) and none matched. The first is fixed in the capsule or its signature; the second is
fixed in what the firmware exposes.

## Source map

```
  src/hardware/block_device/backend.rs   the Backend enum
  src/hardware/block_device/select.rs    the NVMe -> AHCI -> virtio probe
  src/hardware/block_device/read.rs, write.rs, flush.rs   the dispatched operations
  src/hardware/block_device/geometry.rs, capacity.rs      512-byte geometry and size
  src/hardware/nvme_capsule/, ahci_capsule/, virtio_blk_capsule/   the kernel-side embeds and spawns
  userland/capsule_driver_nvme/          the NVMe driver: discover.rs, setup/ (claim, mmio, irq),
                                         dma/region.rs, admin/queue/ (sq/cq), nvm/, error/types.rs
  userland/capsule_driver_ahci/          the AHCI driver: setup/, controller/scan_ports.rs, server/
  userland/capsule_driver_virtio_blk/    the virtio-blk driver: setup/dma.rs, queue/, io/, server/
  src/hardware/broker/dma/limits.rs      the BLOCK class DMA ceiling (1024 pages)
  src/hardware/broker/table/list.rs      list_by_class, the broker device table drivers enumerate
  src/capabilities/types.rs              the capability bits the driver masks decode to
  src/userspace/init/spawn_plan/         drivers_storage.rs, drivers_virtio_io.rs (the spawn markers)
```

Every reference above is verified against those trees. The grant syscalls the drivers rest on are
specified on the [hardware broker](/docs/subsystems/hardware-broker/) pages, the DMA ceiling and its markers
on the [DMA grants](/docs/subsystems/hardware-broker/dma/) page, and the filesystems that sit above the block layer
on the [VFS routing](/docs/subsystems/storage/vfs-and-paths/) page.
