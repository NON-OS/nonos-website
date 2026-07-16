---
title: "Controller bring-up and the broker grants"
description: "Before the driver can move a single frame, it has to find its NIC, take exclusive ownership of it, map its registers, enable bus mastering, bind its interrupt, allocate its DMA ..."
weight: 5
---
Before the driver can move a single frame, it has to find its NIC, take exclusive ownership of it, map its
registers, enable bus mastering, bind its interrupt, allocate its DMA rings, soft-reset the chip, read its
MAC, and turn it on. That path is two ordered sequences: the grant acquisition in [`src/setup/sequence.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L25),
and the device programming in [`src/init/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L24). This page mirrors both together with the folders they
lean on: [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) and `src/discover/` (finding the device), `src/setup/` (the broker calls and the
built `Driver`), `src/init/` (reset, MAC, and enable), [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs) (register access), and `src/constants/`
(the offsets and bit definitions). The transmit and receive rings the programming steps set up live on the
[rings](/docs/userland/driver-rtl8169/rings/) page; the broker syscalls themselves are documented on the
[claim](/docs/subsystems/hardware-broker/claim/), [MMIO](/docs/subsystems/hardware-broker/mmio/),
[DMA](/docs/subsystems/hardware-broker/dma/), and [IRQ](/docs/subsystems/hardware-broker/irq/) pages.

Each grant step is a broker call, and a failure rolls back the grants already taken and returns an error, so
a partly built driver never serves IPC ([`src/main.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L44), [`src/main.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L48)).

## Step 1: discover the device

`find_rtl8169` calls `mk_device_list` for the block-and-network device set, walks up to 32 records, and
returns the first that passes three filters ([`src/discover.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L37)). A record is supported when its vendor is
Realtek (`0x10EC`), its bus kind is PCI, its device id is one of the RTL8169 family
(`0x8161, 0x8162, 0x8167, 0x8168, 0x8169`), its PCI class is network (`0x02`), and its subclass is Ethernet
(`0x00`) ([`src/discover/support.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/support.rs#L24), [`src/constants/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L17), [`src/constants/pci.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L18)). It must also
report a usable interrupt, a non-zero IRQ pin and an IRQ line other than `0xFF` ([`src/discover.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L47)), and
it must expose an MMIO BAR of at least `0x100` bytes, the first of which is picked as the register BAR
([`src/discover/bar_mmio.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/bar_mmio.rs#L19)). Discovery also records the device's declared BAR command bits, an MMIO or
PIO summary used later to preserve the PCI command register ([`src/discover/bar_command.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/bar_command.rs#L19)). No match
means `_start` exits `EXIT_SETUP_FAILED`.

Two things differ from the NVMe discovery. The match is by explicit vendor-and-device-id list, not by a
class/prog-if triple, because the RTL8169 family is identified by its Realtek device ids. And the BAR size
floor is `0x100`, not the NVMe `0x4000`, because the NIC's register file is small.

## Step 2 through 6: the broker grants

`setup::run` acquires the grants in order, each scoped to the claim epoch, and hands the results to the built
`Driver` ([`src/setup/sequence.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L25)).

1. **Claim.** `claim::claim` calls `mk_device_claim` on the device id and returns a claim epoch, failing if
   the broker returns a non-positive value ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19)). The epoch is the token every later
   broker call must present, so a stale or revoked claim fails cleanly. See
   [device claim and epochs](/docs/subsystems/hardware-broker/claim/).
2. **Bus master.** `pci::enable_bus_master` ors the discovered command bits with `MK_PCI_CMD_BUS_MASTER`
   and writes them to the PCI command register `MK_PCI_CFG_COMMAND` with `mk_pci_config_write`, so the
   controller may DMA ([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23)). On failure it releases the device and returns an error
   ([`src/setup/pci.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L26)).
3. **Map the register BAR.** `mmio::map` calls `mk_mmio_map` for the discovered BAR index at its full size
   (at least `0x100`) and returns a user virtual address, a length, and a grant id
   ([`src/setup/mmio.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L21)). On failure it releases the device ([`src/setup/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L25)). `Regs::new` wraps
   the returned address for volatile 8/16/32-bit register access ([`src/regs.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L25)). See
   [MMIO grants](/docs/subsystems/hardware-broker/mmio/).
4. **Bind the interrupt.** `irq::bind` calls `mk_irq_bind` for the discovered IRQ line and returns a grant id
   and a vector ([`src/setup/irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L21)). On failure it unmaps the MMIO grant and releases the device before
   returning ([`src/setup/irq.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L24)). Unlike the NVMe driver's best-effort MSI-X bind, a failed bind here is
   fatal to setup. See [IRQ grants](/docs/subsystems/hardware-broker/irq/).
5. **Allocate the DMA rings and buffers.** `dma::map_all` maps four DMA regions through `mk_dma_map`, each
   page-rounded: the RX descriptor ring, the RX buffer pool, the TX descriptor ring, and the TX buffer pool
   ([`src/setup/dma.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L39), [`src/setup/dma.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L29)). Each region returns a user VA and a broker-issued device
   address. If any of the four fails, `rollback::after` unmaps the DMA regions taken so far, unbinds the IRQ,
   unmaps the MMIO grant, and releases the device, in that order ([`src/setup/dma.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L45),
   [`src/setup/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L21)). See [DMA grants](/docs/subsystems/hardware-broker/dma/).

The built `Driver` owns the device id, the six grant ids (MMIO, IRQ, and the four DMA regions), the register
accessor, a zeroed MAC, and the `RxRing` and `TxRing` cursors built from the DMA user VAs and device
addresses ([`src/setup/sequence.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L32), [`src/setup/driver.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L23)).

## Step 7 through 11: bring the device up

With the grants in hand, `init::bring_up` programs the chip ([`src/init/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L24)).

1. **Soft reset.** `reset::run` writes `CMD_RESET` (`0x10`) to the command register `0x37` and polls it low,
   spinning up to a million iterations before returning a timeout ([`src/init/reset.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L22),
   [`src/constants/regs.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L20), [`src/constants/regs.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L31)). The controller clears the bit itself when the
   reset completes.
2. **Read the MAC.** `mac::read` reads six bytes from `REG_MAC0` (`0x00`) and rejects an all-zero or
   all-`0xFF` address as invalid, caching a valid MAC into `driver.mac` ([`src/init/mac.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac.rs#L21),
   [`src/init/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L26)). This both learns the hardware address and confirms the register block responds.
3. **Program the RX ring.** `rx_setup::program` fills all sixteen RX descriptors with a buffer device
   address, the buffer size, the `OWN` bit set (handing them to the NIC), and the `EOR` end-of-ring bit on
   the last, then writes the receive max size `RMS`, the RX descriptor ring device address into
   `REG_RXDESC_ADDR_LO/HI` (`0xE4`/`0xE8`), and the RX config accepting physical-match, multicast, and
   broadcast frames with the DMA burst fields ([`src/init/rx_setup.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L27)). The descriptor layout is on the
   [rings](/docs/userland/driver-rtl8169/rings/) page.
4. **Program the TX ring.** `tx_setup::program` fills all sixteen TX descriptors with a buffer device address
   and the `EOR` bit on the last but leaves `OWN` clear (the driver owns them until it sends), then writes
   the TX descriptor ring device address into `REG_TXDESC_ADDR_LO/HI` (`0x20`/`0x24`) and the TX config with
   the inter-frame-gap and DMA-burst fields ([`src/init/tx_setup.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L25)).
5. **Enable.** `bring_up` clears any pending interrupt by writing `0xFFFF` to the ISR (`0x3E`), unmasks the
   RX-ok, RX-error, TX-ok, and TX-error sources in the IMR (`0x3C`), and sets `CMD_RX_ENABLE | CMD_TX_ENABLE`
   in the command register, starting the receive and transmit engines ([`src/init/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L29),
   [`src/constants/regs.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L45)).

## The broker grants the capsule holds

The driver reaches hardware only through grants, each scoped to the claim epoch. The wrappers are thin: a
grant is a syscall result and a matching unmap.

| Grant | Held by | What it is |
|---|---|---|
| Device claim | `Driver.device_id` | the exclusive hold on the PCI function; the root of every other grant ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19)) |
| MMIO | `Driver.mmio_grant` | the register BAR mapped into the capsule as a user VA ([`src/setup/mmio.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L21)) |
| IRQ | `Driver.irq_grant` | the bound device interrupt, acknowledged in the receive path ([`src/setup/irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L21)) |
| DMA (x4) | `Driver.rx_ring_grant`, `rx_buffer_grant`, `tx_ring_grant`, `tx_buffer_grant` | the four broker-issued buffers with user VAs and device addresses ([`src/setup/dma.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L39)) |

The capsule programs the controller only with the broker-issued device addresses of its rings and buffers,
never a physical address it chose ([`src/init/rx_setup.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L43), [`src/init/tx_setup.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L36)).

## The register block

`Regs` is a base address plus volatile 8/16/32-bit reads and writes ([`src/regs.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L19)). The offsets and bit
definitions live in [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs): `MAC0` at `0x00`, the TX descriptor address at `0x20`/`0x24`,
the command register at `0x37`, the transmit poll at `0x38`, the IMR at `0x3C`, the ISR at `0x3E`, the TX and
RX config at `0x40` and `0x44`, the PHY status at `0x6C`, the receive max size at `0xDA`, and the RX
descriptor address at `0xE4`/`0xE8` ([`src/constants/regs.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L17)). The command bits (`RESET`, `RX_ENABLE`,
`TX_ENABLE`), the transmit-poll high-priority-queue bit, the config fields, the link-up bit, the interrupt
sources, and the descriptor `OWN`/`EOR`/`FS`/`LS`/length bits are all defined there
([`src/constants/regs.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L31)).

## Grant teardown

The `Driver` exposes `release`, which unmaps the four DMA regions, unbinds the IRQ, unmaps the MMIO grant,
and releases the device claim, in that reverse order ([`src/setup/driver.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L38)). It is called when
`init::bring_up` fails after the grants were taken ([`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)), and `setup::run` itself rolls back
through `rollback::after` if a DMA allocation fails mid-sequence ([`src/setup/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L21)). Because the
server loop never returns, an explicit release runs only on an early error exit; the kernel also revokes
every grant tied to the claim when the process dies, so a crash cannot leak a claim, a mapping, or a DMA
buffer (see [revocation](/docs/subsystems/hardware-broker/revocation/)).

## Security posture at bring-up

This driver holds real hardware authority, so the trust question is not whether it can reach hardware but how
tightly that reach is bounded. The broker bounds it the same four ways it bounds the NVMe driver, each
visible in the sequence above. The claim is device-scoped and epoch-gated, so the capsule can only act on the
one NIC it claimed and cannot use a stale claim ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19);
[claim.md](/docs/subsystems/hardware-broker/claim/)). The MMIO grant is exactly the discovered BAR of that
function at a broker-chosen user address, so the driver never sees a physical address or another device's
registers ([`src/setup/mmio.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L21)). Each DMA region is a separate grant with its own device address returned
by the broker, and the controller is programmed only with those addresses ([`src/setup/dma.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L39),
[`src/init/rx_setup.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L43)). Every grant is released on the error path and again by the kernel on process
death ([`src/setup/driver.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L38)).

The honest caveat is the absence of an IOMMU on the current target. Bus mastering is enabled
([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23)) and the controller is handed device addresses for its rings and buffers, but nothing
in hardware forces the NIC to confine its DMA to those buffers. The trust boundary here is the device itself:
a correct RTL8169 only reads and writes the descriptor and buffer addresses the driver programmed, and the
driver only ever programs broker-issued DMA device addresses. A malicious or buggy NIC could DMA outside its
buffers, and without an IOMMU the broker cannot prevent that. This is the same universal DMA caveat that
applies to every hardware driver capsule, not something specific to the RTL8169. It matters a little more for
a NIC than for a disk, because every received frame is attacker-influenced input, which is exactly why the
[network stack](/docs/subsystems/networking/drivers/) keeps this driver in its own capsule holding nothing
but its device's grants.

## Source map

```
  userland/capsule_driver_rtl8169/src/discover.rs         find_rtl8169: the mk_device_list scan and filters
  userland/capsule_driver_rtl8169/src/discover/support.rs the vendor / id / class match
  userland/capsule_driver_rtl8169/src/discover/bar_mmio.rs the register-BAR pick
  userland/capsule_driver_rtl8169/src/discover/bar_command.rs the PCI command-bit summary
  userland/capsule_driver_rtl8169/src/setup/sequence.rs   the ordered grant acquisition and the built Driver
  userland/capsule_driver_rtl8169/src/setup/claim.rs      mk_device_claim -> epoch
  userland/capsule_driver_rtl8169/src/setup/pci.rs        the bus-master command write
  userland/capsule_driver_rtl8169/src/setup/mmio.rs       mk_mmio_map for the register BAR
  userland/capsule_driver_rtl8169/src/setup/irq.rs        mk_irq_bind for the device interrupt
  userland/capsule_driver_rtl8169/src/setup/dma.rs        mk_dma_map for the four rings and buffers
  userland/capsule_driver_rtl8169/src/setup/rollback.rs   reverse-order grant rollback on a mid-sequence failure
  userland/capsule_driver_rtl8169/src/setup/driver.rs     the Driver struct and release
  userland/capsule_driver_rtl8169/src/init/run.rs         bring_up: reset, MAC, ring programming, enable
  userland/capsule_driver_rtl8169/src/init/reset.rs       the soft reset and its poll
  userland/capsule_driver_rtl8169/src/init/mac.rs         the MAC read and validity check
  userland/capsule_driver_rtl8169/src/init/rx_setup.rs    RX descriptor fill and RX config
  userland/capsule_driver_rtl8169/src/init/tx_setup.rs    TX descriptor fill and TX config
  userland/capsule_driver_rtl8169/src/regs.rs             Regs: volatile 8/16/32-bit access over the BAR
  userland/capsule_driver_rtl8169/src/constants/regs.rs   register offsets and command / config / descriptor bits
  userland/capsule_driver_rtl8169/src/constants/pci.rs    the Realtek vendor id and the RTL8169 device ids
```

Every reference above is verified against those trees.
