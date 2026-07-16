---
title: "Controller bring-up and the broker grants"
description: "Before the driver can serve a single block, it has to find its controller, take exclusive ownership of it, map its registers, wake it up, and learn what it is."
weight: 2
---
Before the driver can serve a single block, it has to find its controller, take exclusive ownership of it,
map its registers, wake it up, and learn what it is. That whole path is one ordered sequence in
[`src/setup/sequence.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L30), and this page mirrors it together with the folders it leans on: `src/setup/`
(the sequence and the broker calls), [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) (finding the device), `src/controller/` (decoding
the register block), `src/dma/` and `src/handles/` (the grant wrappers), `src/regs/` (register access), and
`src/constants/` (the offsets and bit definitions). The submission and completion machinery the admin steps
drive lives on the [queues](/docs/userland/driver-nvme/queues/) page; the broker syscalls themselves are documented on the
[claim](/docs/subsystems/hardware-broker/claim/), [MMIO](/docs/subsystems/hardware-broker/mmio/),
[DMA](/docs/subsystems/hardware-broker/dma/), and [IRQ](/docs/subsystems/hardware-broker/irq/) pages.

Each step is a broker call or a controller register step, and a failure returns an `NvmeError` that maps to
an exit code ([`src/error/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L30)), so a partly built driver never serves IPC.

## The bring-up sequence

1. **Discover.** `find_nvme` calls `mk_device_list` for the block device class and returns the first PCI
   function whose bus kind is PCI and whose class/subclass/prog-if is `01/08/02` (NVMe) with an MMIO BAR0 of
   at least `0x4000` bytes ([`src/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L32), [`src/discover.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L49), [`src/constants/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L17)). No match
   is `DeviceNotFound`.
2. **Claim.** `mk_device_claim` on that device id returns a claim epoch ([`src/setup/claim.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L21)). The epoch
   is the token every later broker call must present, so a stale or revoked claim fails cleanly. A refusal
   is `ClaimFailed`. See [device claim and epochs](/docs/subsystems/hardware-broker/claim/).
3. **Bus master.** `mk_pci_config_write` sets the bus-master bit in the PCI command register
   (`MK_PCI_CFG_COMMAND`, `MK_PCI_CMD_BUS_MASTER`) so the controller may DMA ([`src/setup/pci.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L21)). On
   failure the device is released and the error propagates ([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23), [`src/setup/sequence.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L33)).
4. **Map BAR0.** `mk_mmio_map` maps BAR index 0 for its full size and returns a user virtual address, a
   length, and a grant id ([`src/setup/mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L22), [`src/constants/pci.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L18)). On failure the device is
   released ([`src/setup/mmio.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L26)). `Regs::new` wraps the returned address for volatile 32/64-bit register
   access ([`src/regs/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/mmio.rs#L25)). See [MMIO grants](/docs/subsystems/hardware-broker/mmio/).
5. **Bind MSI-X.** `mk_irq_bind` with `MK_IRQ_BIND_MSIX` requests one vector ([`src/setup/irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L21)). This
   is best-effort: the driver polls every completion and never blocks on the interrupt, so a failed bind
   continues in polling mode with a zero grant, which `BrokerHandles::drop` unbinds harmlessly
   ([`src/setup/irq.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L24)). See [IRQ grants](/docs/subsystems/hardware-broker/irq/).
6. **Sanity-check the register block.** `ControllerInfo::read` reads `CAP`, `VS`, `CC`, `CSTS`, `AQA`, and
   the two interrupt-mask and two CMB registers ([`src/controller/info/read.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info/read.rs#L24)), and
   `is_nvme_register_block` requires `CAP != 0`, `VS != 0`, and a non-zero max-queue-entries before the
   mapping is trusted ([`src/setup/sequence.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L42), [`src/controller/info/is_nvme_register_block.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info/is_nvme_register_block.rs#L21)). A
   failure is `UnsupportedController`.
7. **Reset.** `reset_to_disabled` writes `CC = 0` and polls `CSTS.RDY` low, bailing on `CSTS.CFS`
   (controller fatal) with `UnsupportedController` ([`src/admin/controller.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L24), [`src/admin/controller.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L41)).
8. **Admin queues.** `AdminQueue::allocate` maps three DMA regions through `mk_dma_map`: a 4 KiB submission
   queue, a 4 KiB completion queue, and a 4 KiB shared identify/log scratch buffer
   ([`src/admin/queue/allocate.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/allocate.rs#L23), [`src/admin/queue/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/constants.rs#L18)). `program_registers` writes `AQA`
   with 64 entries each, then the device addresses of the admin SQ and CQ into `ASQ` and `ACQ`
   ([`src/admin/queue/registers.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/registers.rs#L23)). See [DMA grants](/docs/subsystems/hardware-broker/dma/).
9. **Enable.** `enable` first requires the controller's minimum page shift to be 12 (4 KiB pages) or returns
   `UnsupportedPageSize`, then writes `CC.EN | IOSQES=64 | IOCQES=16` and polls `CSTS.RDY` high
   ([`src/admin/controller.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L29), [`src/constants/regs.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L30)).
10. **Identify Controller.** An Identify (CNS 1) admin command writes 4 KiB into the scratch DMA, and
    `ControllerIdentity::parse` extracts the fields ([`src/admin/queue/identify_controller.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/identify_controller.rs#L24),
    [`src/admin/command/identify_controller.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/command/identify_controller.rs#L20), [`src/admin/identity.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/identity.rs#L35)).
11. **Identify Namespace.** If the controller reports at least one namespace, an Identify (CNS 0) for NSID 1
    is issued and parsed; otherwise the namespace record is `absent()`
    ([`src/setup/sequence.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L53), [`src/admin/namespace.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/namespace.rs#L30)).
12. **SMART/health.** A Get Log Page (LID `0x02`, NSID `0xffffffff`, 512 bytes) fills the scratch DMA and
    `SmartHealth::parse` snapshots it ([`src/admin/queue/log.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/log.rs#L27), [`src/admin/command/get_log_page.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/command/get_log_page.rs#L20)).
13. **IO queue pair.** Only if NSID 1 reports a 512-byte LBA and a non-zero size does the driver bring up an
    IO queue ([`src/setup/sequence.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L63)); otherwise `driver.io` is `None` and every block op later answers
    `E_NODEV`. The queue engine itself is on the [queues](/docs/userland/driver-nvme/queues/) page.

The built `Driver` owns the admin queue, the broker handles, the register accessor, the three parsed
records, and the optional IO queue ([`src/setup/driver.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L22)).

## The broker grants the capsule holds

The driver reaches hardware only through grants, each scoped to the claim epoch. The wrappers are thin: a
grant is a syscall result and a `Drop` that revokes it.

| Grant | Wrapper | What it is |
|---|---|---|
| Device claim | `BrokerHandles` | the exclusive hold on the PCI function; the root of every other grant ([`src/handles/broker_handles.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles.rs#L17)) |
| MMIO | `BrokerHandles` | BAR0 mapped into the capsule as a user VA ([`src/setup/mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L22)) |
| IRQ | `BrokerHandles` | one MSI-X vector, or a zero grant when the bind fails ([`src/setup/irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L21)) |
| DMA | `DmaRegion` | one broker-issued buffer with a user VA and a device address ([`src/dma/region.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L21)) |

`DmaRegion::map` calls `mk_dma_map` and stores the grant id, the user VA, and the device address; a refusal
is `BrokerCallFailed` ([`src/dma/region.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L28)). The capsule programs the controller only with the
broker-issued device addresses, never a physical address it chose ([`src/admin/queue/registers.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/registers.rs#L23)).

## The register block

`Regs` is a base address plus volatile 32/64-bit reads and writes ([`src/regs/mmio.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/mmio.rs#L19)). The offsets and
bit definitions live in [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs): `CAP` at `0x00`, `VS` at `0x08`, `CC` at `0x14`, `CSTS` at
`0x1c`, `AQA` at `0x24`, `ASQ` at `0x28`, `ACQ` at `0x30`, and the doorbell base at `0x1000`
([`src/constants/regs.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L17)). The `CAP` field decoders in [`src/constants/cap.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/cap.rs) unpack the maximum queue
entries (zero-based, so plus one), the timeout, the doorbell stride, an NVM-supported bit, and the minimum
and maximum page shifts (each a raw nibble plus 12) ([`src/constants/cap.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/cap.rs#L17)). `ControllerInfo` exposes
those through named methods (`src/controller/info/`), and `OP_CONTROLLER_INFO` re-reads the block live to
answer a client ([`src/server/handlers/controller_info.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L26)).

## Grant teardown

The `Driver` owns a `BrokerHandles` and the DMA regions, so ownership drives revocation. On drop,
`BrokerHandles` unbinds the IRQ, unmaps the MMIO grant, and releases the device claim, in that reverse
order ([`src/handles/broker_handles_drop.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_drop.rs#L21)), and every `DmaRegion` unmaps itself
([`src/dma/region.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L46)). Because the server loop never returns, this runs only on an early error exit; the
kernel also revokes every grant tied to the claim when the process dies, so a crash cannot leak a claim, a
mapping, or a DMA buffer (see [revocation](/docs/subsystems/hardware-broker/revocation/)).

## Security posture at bring-up

This driver holds real hardware authority, so the trust question is not whether it can reach hardware but
how tightly that reach is bounded. The broker bounds it in four ways, each visible in the sequence above.
The claim is device-scoped and epoch-gated, so the capsule can only act on the one NVMe function it claimed
and cannot use a stale claim ([`src/setup/claim.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L21); [claim.md](/docs/subsystems/hardware-broker/claim/)).
The MMIO grant is exactly BAR0 of that function at a broker-chosen user address, so the driver never sees a
physical address or another device's registers ([`src/setup/mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L22)). Each DMA region is a separate
grant with its own device address returned by the broker, and the controller is programmed only with those
addresses ([`src/dma/region.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L28), [`src/admin/queue/registers.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/registers.rs#L23)). Every grant is revoked on drop and
again by the kernel on process death ([`src/handles/broker_handles_drop.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_drop.rs#L21)).

The honest caveat is the absence of an IOMMU on the current target. Bus mastering is enabled
([`src/setup/pci.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L21)) and the controller is handed device addresses for its queues and data buffer, but
nothing in hardware forces the controller to confine its DMA to those buffers. The trust boundary here is
the device itself: a correct NVMe controller only reads and writes the addresses the driver programmed into
its commands, and the driver only ever programs broker-issued DMA device addresses. A malicious or buggy
controller could DMA outside its buffers, and without an IOMMU the broker cannot prevent that. This is the
same universal DMA caveat that applies to every hardware driver capsule, not something specific to NVMe.

## Source map

```
  userland/capsule_driver_nvme/src/setup/sequence.rs      the whole ordered bring-up
  userland/capsule_driver_nvme/src/setup/claim.rs         mk_device_claim -> epoch
  userland/capsule_driver_nvme/src/setup/pci.rs           the bus-master config write
  userland/capsule_driver_nvme/src/setup/mmio.rs          mk_mmio_map for BAR0
  userland/capsule_driver_nvme/src/setup/irq.rs           best-effort MSI-X bind
  userland/capsule_driver_nvme/src/setup/driver.rs        the built Driver struct
  userland/capsule_driver_nvme/src/discover.rs            mk_device_list scan and the NVMe match
  userland/capsule_driver_nvme/src/controller/            ControllerInfo: read and decode the register block
  userland/capsule_driver_nvme/src/admin/controller.rs    reset_to_disabled and enable
  userland/capsule_driver_nvme/src/dma/region.rs          DmaRegion: mk_dma_map wrapper and Drop unmap
  userland/capsule_driver_nvme/src/handles/               BrokerHandles: claim/MMIO/IRQ and reverse-order Drop
  userland/capsule_driver_nvme/src/regs/mmio.rs           Regs: volatile access over the BAR0 mapping
  userland/capsule_driver_nvme/src/constants/regs.rs      register offsets and CC/CSTS bits
  userland/capsule_driver_nvme/src/constants/cap.rs       CAP field decoders
  userland/capsule_driver_nvme/src/constants/pci.rs       the PCI class and BAR size floor
  userland/capsule_driver_nvme/src/error/types.rs         NvmeError and the exit-code mapping
```

Every reference above is verified against those trees.
</content>
