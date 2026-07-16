---
title: "Controller bring-up and the broker grants"
description: "Before the driver can move a single frame, it has to find its NIC, take exclusive ownership of it, get a port window and DMA buffers for it, wake it up, and learn its MAC address."
weight: 4
---
Before the driver can move a single frame, it has to find its NIC, take exclusive ownership of it, get a port
window and DMA buffers for it, wake it up, and learn its MAC address. That path is two ordered stages: a
grant-acquisition sequence in [`src/setup/sequence.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L24) that builds the `Driver`, and a device-init sequence
in [`src/init/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L24) that resets and programs the NIC. This page mirrors both together with the folders
they lean on: [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) (finding the device), `src/setup/` (the broker calls and rollback),
[`src/pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pio.rs) (checked port access), `src/init/` (reset, MAC, RX/TX programming), and `src/constants/` (the
register offsets, bits, and DMA sizes). The receive ring and transmit slots the init steps program live on the
[buffers](/docs/userland/driver-rtl8139/buffers/) page; the broker syscalls themselves are documented on the
[claim](/docs/subsystems/hardware-broker/claim/), [PIO](/docs/subsystems/hardware-broker/pio/),
[DMA](/docs/subsystems/hardware-broker/dma/), and [IRQ](/docs/subsystems/hardware-broker/irq/) pages.

Each step is a broker call or a controller register step, and a failure at any point rolls back the grants
already taken and returns an error, so a partly built driver never serves IPC.

## The grant sequence

1. **Discover.** `find_rtl8139` calls `mk_device_list` and walks up to 32 records, returning the first whose
   vendor is Realtek (`0x10EC`), whose bus kind is PCI, whose device id is `0x8139`, and whose PCI class and
   subclass are network/ethernet (`0x02`/`0x00`) ([`src/discover.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L36), [`src/discover/support.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/support.rs#L24);
   ids at [`src/constants/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L17)). The record must also report a real INTx line (`irq_pin != 0` and
   `irq_line != 0xFF`) and a port BAR of at least `0x60` bytes, whose index is returned as `pio_bar_index`
   ([`src/discover.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L46), [`src/discover/bar_pio.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/bar_pio.rs#L19)). No match returns `None`, which `setup::run` maps to
   an error ([`src/setup/sequence.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L25)).
2. **Claim.** `claim::claim` calls `mk_device_claim` on the device id and returns a claim epoch, treating any
   non-positive result as a failure ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19)). The epoch is the token every later broker call
   must present, so a stale or revoked claim fails cleanly. See
   [device claim and epochs](/docs/subsystems/hardware-broker/claim/).
3. **Bus master.** `pci::enable` writes the PCI command register with the device's existing command bits plus
   `MK_PCI_CMD_BUS_MASTER`, so the NIC may DMA into the ring and slots ([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23)). The existing
   bits come from the discovery record's BAR kinds ([`src/discover/bar_command.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/bar_command.rs#L19)). On failure the device
   is released and the error propagates ([`src/setup/pci.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L30)).
4. **PIO grant.** `pio_grant::grant` calls `mk_pio_grant` for the discovered port BAR index and returns a
   `PioGrantOut` with the granted grant id ([`src/setup/pio_grant.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio_grant.rs#L23)). This is the window the checked port
   accessor drives; on failure the device is released ([`src/setup/pio_grant.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio_grant.rs#L24)). See
   [PIO grants](/docs/subsystems/hardware-broker/pio/).
5. **Bind INTx.** `irq::bind` calls `mk_irq_bind` with the device's `irq_line` and returns an `IrqBindOut`
   ([`src/setup/irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L21)). On failure it releases the PIO grant and the device before returning
   ([`src/setup/irq.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L25), `irq.rs:31`). See [IRQ grants](/docs/subsystems/hardware-broker/irq/).
6. **Map DMA.** `dma::map_all` maps two DMA regions through `mk_dma_map`, each rounded up to a page: the
   receive buffer (`RX_BUF_BYTES`) and the transmit buffer (`TX_BUF_BYTES`) ([`src/setup/dma.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L39),
   `dma.rs:29`). Because the RTL8139 programs its buffer addresses into 32-bit registers, `map_all` rejects
   any device address above `u32::MAX` with an error after rolling back both regions
   ([`src/setup/dma.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L53)). See [DMA grants](/docs/subsystems/hardware-broker/dma/).

The built `Driver` owns the device id, the four grant ids (PIO, IRQ, RX DMA, TX DMA), the user virtual and
device addresses of both DMA regions, the software `rx_offset` and `tx_cur` cursors, the checked `Pio`
accessor, and the MAC buffer ([`src/setup/driver.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L22)).

## The init sequence

With the grants held, `init::bring_up` programs the NIC through the port window
([`src/init/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L24)):

1. **Reset.** `reset::run` writes `CMD_RESET` to the command register and polls up to a million iterations for
   the reset bit to clear, returning a timeout error if it never does ([`src/init/reset.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L20)).
2. **Read MAC.** `mac::read` reads the six MAC bytes from `REG_MAC0..+5` and rejects an all-zero or all-ones
   address as invalid, otherwise caching it on the driver ([`src/init/mac.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac.rs#L21)).
3. **Program RX.** `rx_setup::program` zeroes the software `rx_offset`, writes the receive buffer's device
   address into `RBSTART`, sets the initial `CAPR`, and writes `RCR` to accept physical, multicast, and
   broadcast frames with the wrap bit and unlimited DMA burst set ([`src/init/rx_setup.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L24)). The ring
   arithmetic behind `CAPR` is on the [buffers](/docs/userland/driver-rtl8139/buffers/) page.
4. **Program TX.** `tx_setup::program` writes each of the four transmit slot device addresses into
   `TXADDR0..3`, zeroes the software `tx_cur`, and writes `TCR` with the unlimited DMA burst
   ([`src/init/tx_setup.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L21)).
5. **Unmask and enable.** It clears any pending interrupt by writing `0xFFFF` to `ISR`, unmasks the RX/TX and
   overflow sources in `IMR`, and finally writes the command register with RX-enable and TX-enable set
   ([`src/init/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L29)). After this the NIC is live and the server loop can serve frames.

If any init step returns an error, `main` calls `driver.release()` to revoke every grant and exits with code
`3` ([`src/main.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L43)).

## Checked port access

The RTL8139 has no MMIO register block. Every register touch goes through `Pio`, a thin wrapper over the port
grant that offers 8/16/32-bit reads and writes ([`src/pio.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pio.rs#L24)). Each call forwards to `mk_pio_read` or
`mk_pio_write` with the grant id, the register offset, and the width, and maps a negative kernel result to an
error string ([`src/pio.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pio.rs#L53), `pio.rs:62`). The capsule never executes an `in` or `out` instruction itself;
the kernel does, after bounds-checking the offset and width against the granted window, which is why this
driver holds `Pio` and not I/O-port privilege. The offsets and bit constants live in [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs):
the command register at `0x37`, `CAPR` at `0x38`, `IMR` at `0x3C`, `ISR` at `0x3E`, `TCR` at `0x40`, `RCR` at
`0x44`, `MSR` at `0x58`, the four transmit-status words from `0x10`, the four transmit-address words from
`0x20`, and `RBSTART` at `0x30` ([`src/constants/regs.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L17)).

## The broker grants the capsule holds

The driver reaches hardware only through grants, each scoped to the claim epoch.

| Grant | Field | What it is |
|---|---|---|
| Device claim | `device_id` | the exclusive hold on the PCI function; the root of every other grant ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19)) |
| PIO | `pio_grant` | the port window for the NIC's register BAR ([`src/setup/pio_grant.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio_grant.rs#L23)) |
| IRQ | `irq_grant` | the bound INTx line ([`src/setup/irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L21)) |
| RX DMA | `rx_grant` | the receive buffer, a user VA and a 32-bit device address ([`src/setup/dma.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L45)) |
| TX DMA | `tx_grant` | the four transmit slots, a user VA and a 32-bit device address ([`src/setup/dma.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L49)) |

The capsule programs the NIC only with the broker-issued device addresses, never a physical address it chose:
`RBSTART` takes `rx_device_addr` and each `TXADDR` takes a computed offset into `tx_device_addr`
([`src/init/rx_setup.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L26), [`src/init/tx_setup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L23)).

## Rollback and teardown

Every setup step that can fail undoes the grants taken before it. The PCI, PIO, and IRQ steps release their
predecessors inline on failure ([`src/setup/pci.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L31), [`src/setup/pio_grant.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio_grant.rs#L25), [`src/setup/irq.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L32)),
and the DMA step calls `rollback::after_irq`, which unmaps any DMA regions taken so far, unbinds the IRQ,
releases the PIO grant, and releases the device, in that reverse order ([`src/setup/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L21)). After the
driver is built, `Driver::release` performs the same reverse-order revocation on an init failure: it unmaps
the TX and RX DMA, unbinds the IRQ, releases the PIO grant, and releases the device ([`src/setup/driver.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L39)).
The kernel also revokes every grant tied to the claim when the process dies, so a crash cannot leak a claim, a
port window, an IRQ binding, or a DMA buffer (see
[revocation](/docs/subsystems/hardware-broker/revocation/)).

## Security posture at bring-up

This driver holds real hardware authority, so the trust question is not whether it can reach hardware but how
tightly that reach is bounded. The broker bounds it in four ways, each visible in the sequence above. The
claim is device-scoped and epoch-gated, so the capsule can only act on the one RTL8139 function it claimed and
cannot use a stale claim ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19); [claim.md](/docs/subsystems/hardware-broker/claim/)). The
port grant is exactly the NIC's register BAR window; the capsule calls `MkPioRead`/`MkPioWrite` and the kernel
bounds-checks every offset against it, so the driver reaches its own device's ports and nothing else, not the
PCI config ports or another device ([`src/setup/pio_grant.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio_grant.rs#L23);
[pio.md](/docs/subsystems/hardware-broker/pio/)). Each DMA region is a separate grant with its own device
address returned by the broker, and the NIC is programmed only with those addresses
([`src/setup/dma.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L39), [`src/init/rx_setup.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L26)). Every grant is revoked on the rollback path and again by
the kernel on process death ([`src/setup/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L21), [`src/setup/driver.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L39)).

The honest caveat is the absence of an IOMMU on the current target. Bus mastering is enabled
([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23)) and the NIC is handed device addresses for its receive ring and transmit slots, but
nothing in hardware forces the controller to confine its DMA to those buffers. The driver does what it can in
software: it requires both DMA device addresses to fit in 32 bits before it programs them, matching the
RTL8139's 32-bit address registers, and it never hands the device an address it did not get from the broker
([`src/setup/dma.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L53)). But the trust boundary here is the device itself: a correct RTL8139 only DMAs into
the ring and slot addresses the driver programmed, and a malicious or buggy NIC could DMA outside them, which
without an IOMMU the broker cannot prevent. This is the same universal DMA caveat that applies to every
hardware driver capsule, not something specific to the RTL8139.

## Source map

```
  userland/capsule_driver_rtl8139/src/discover.rs           mk_device_list scan and the RTL8139 match
  userland/capsule_driver_rtl8139/src/discover/support.rs   vendor/device/class match
  userland/capsule_driver_rtl8139/src/discover/bar_pio.rs   the port BAR pick
  userland/capsule_driver_rtl8139/src/discover/bar_command.rs  the existing PCI command bits
  userland/capsule_driver_rtl8139/src/setup/sequence.rs     the ordered grant acquisition
  userland/capsule_driver_rtl8139/src/setup/claim.rs        mk_device_claim -> epoch
  userland/capsule_driver_rtl8139/src/setup/pci.rs          the bus-master config write
  userland/capsule_driver_rtl8139/src/setup/pio_grant.rs    mk_pio_grant for the register BAR
  userland/capsule_driver_rtl8139/src/setup/irq.rs          mk_irq_bind for the INTx line
  userland/capsule_driver_rtl8139/src/setup/dma.rs          mk_dma_map for the RX and TX buffers, 32-bit check
  userland/capsule_driver_rtl8139/src/setup/rollback.rs     the reverse-order grant rollback
  userland/capsule_driver_rtl8139/src/setup/driver.rs       the built Driver and Driver::release teardown
  userland/capsule_driver_rtl8139/src/pio.rs                Pio: checked port access over the grant
  userland/capsule_driver_rtl8139/src/init/run.rs           the reset -> MAC -> RX -> TX -> enable sequence
  userland/capsule_driver_rtl8139/src/init/reset.rs         CMD_RESET and the poll
  userland/capsule_driver_rtl8139/src/init/mac.rs           the MAC read and validity check
  userland/capsule_driver_rtl8139/src/init/rx_setup.rs      RBSTART, CAPR, RCR programming
  userland/capsule_driver_rtl8139/src/init/tx_setup.rs      TXADDR0..3 and TCR programming
  userland/capsule_driver_rtl8139/src/constants/regs.rs     register offsets and command/ISR/RCR/TCR bits
  userland/capsule_driver_rtl8139/src/constants/pci.rs      the Realtek vendor and RTL8139 device ids
  userland/capsule_driver_rtl8139/src/constants/dma.rs      RX_BUF_BYTES and TX_BUF_BYTES
```

Every reference above is verified against those trees.
