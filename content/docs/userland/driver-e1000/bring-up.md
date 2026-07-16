---
title: "Controller bring-up and the broker grants"
description: "Before the driver can move a single frame, it has to find its NIC, take exclusive ownership of it, map its registers, bind its interrupt, allocate the DMA memory for its rings a..."
weight: 3
---
Before the driver can move a single frame, it has to find its NIC, take exclusive ownership of it, map its
registers, bind its interrupt, allocate the DMA memory for its rings and buffers, reset the device, bring the
link up, and learn its MAC. That path is two ordered stages: `setup::run` takes every broker grant
([`src/setup/sequence.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L31)), and `init::bring_up` programs the hardware against those grants
([`src/init/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L26)). This page mirrors both together with the folders they lean on: `src/setup/` (the
grant handshake), [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) (finding the device), `src/init/` (reset, link, MAC, filter, ring
programming), [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs) (register access), and `src/constants/` (the offsets and bit definitions). The
descriptor rings the RX/TX steps program live on the [queues](/docs/userland/driver-e1000/queues/) page; the broker syscalls
themselves are documented on the [claim](/docs/subsystems/hardware-broker/claim/),
[MMIO](/docs/subsystems/hardware-broker/mmio/), [DMA](/docs/subsystems/hardware-broker/dma/), and
[IRQ](/docs/subsystems/hardware-broker/irq/) pages.

Each step is a broker call or a controller register step, and a failure returns an error that the entry point
maps to a distinct exit code, so a partly built driver never serves IPC ([`src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L42)).

## Stage one: the broker handshake

`setup::run` is the ordered grant sequence ([`src/setup/sequence.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L31)).

1. **Discover.** `find_e1000` calls `mk_device_list` and returns the first record whose vendor is Intel
   (`0x8086`), whose bus kind is PCI, whose device id is in the e1000 table, and whose class/subclass is
   network/Ethernet (`02/00`) ([`src/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L32), [`src/discover.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L55), [`src/constants/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L17)). The
   record must have a real interrupt (a non-zero IRQ pin, an IRQ line other than `0xFF`) and an MMIO BAR0
   with a non-zero size; the returned `Found` carries the device id, the IRQ line, and the BAR0 size
   ([`src/discover.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L43)). No match returns `None`, which the sequence turns into `"no e1000 device"`.
2. **Claim.** `claim::claim` calls `mk_device_claim` on that device id and returns the broker's per-claim
   epoch ([`src/setup/claim.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L22)). The epoch is the token every later broker call presents, so a stale or
   revoked claim fails cleanly. A refusal is `"claim failed"`. See
   [device claim and epochs](/docs/subsystems/hardware-broker/claim/).
3. **Map BAR0.** `mmio::map` page-rounds the BAR0 size and calls `mk_mmio_map` for BAR index 0, returning a
   user virtual address, a length, and a grant id; on failure it releases the claim so the broker is left
   clean ([`src/setup/mmio.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L29), [`src/constants/pci.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L25)). `Regs::new` wraps the returned address for
   volatile 32-bit register access ([`src/regs.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L31)). See [MMIO grants](/docs/subsystems/hardware-broker/mmio/).
4. **Bind the interrupt.** `irq::bind` calls `mk_irq_bind` with the device's INTx line and returns a grant id
   and vector; on failure it unmaps the MMIO grant and releases the claim in reverse
   ([`src/setup/irq.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L26)). MSI-X migration is a separate slice. Note that the grant is taken and released but
   never serviced in the request loop: the server blocks on `mk_ipc_recv` and finds completions by polling,
   so the IRQ is held for correctness of teardown, not used as a wake path today (see the
   [README](/docs/userland/driver-e1000/) discrepancy note). See [IRQ grants](/docs/subsystems/hardware-broker/irq/).
5. **Allocate the four DMA regions.** `dma::map_rings_and_buffers` takes four grants in order: the RX
   descriptor ring, the RX buffer pool, the TX descriptor ring, and the TX buffer pool, each page-rounded
   through `mk_dma_map` ([`src/setup/dma.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L47), [`src/constants/queue.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L22)). Each region returns a user VA
   and a broker-issued device address. If any allocation fails, `rollback::after` unmaps every prior DMA
   grant in reverse, unbinds the IRQ, unmaps the MMIO grant, and releases the claim, so the broker never
   holds a partial setup ([`src/setup/dma.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L53), [`src/setup/rollback.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L25)). See
   [DMA grants](/docs/subsystems/hardware-broker/dma/).

The built `Driver` owns one grant id per broker primitive, the two ring device addresses, the register
accessor, the cached MAC, and the RX and TX ring cursors ([`src/setup/driver.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L28)).

## Stage two: hardware bring-up

`init::bring_up` programs the device against the grants setup took, in order: reset, EEPROM MAC, receive-
address filter, RX ring, TX ring ([`src/init/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L26)).

1. **Reset and link.** `reset::run` sets `CTRL.RST` and spins until the self-clearing bit drops or a generous
   budget expires, returning `"CTRL.RST did not self-clear"` on timeout. It then masks every interrupt cause
   through `IMC`, reads `ICR` to clear any latched bits, clears `CTRL.LRST`, and sets `CTRL.SLU | CTRL.ASDE`
   to set the link up and let the device auto-negotiate speed and duplex ([`src/init/reset.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L30),
   [`src/constants/status.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L17)).
2. **EEPROM MAC.** `eeprom::read_mac` reads the first three 16-bit EEPROM words through the `EERD` register,
   writing each word address with the start bit set and polling the done bit, and assembles the six MAC bytes
   little-endian ([`src/init/eeprom.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/eeprom.rs#L28), [`src/constants/status.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L36)). A word that never signals done
   returns `"EERD did not signal DONE"`. The result is cached in `driver.mac` for `OP_MAC_ADDRESS`.
3. **Receive-address filter.** `mac_filter::program` writes the MAC into the primary receive-address pair
   `RAL0`/`RAH0` with the address-valid bit set, then zeros all 128 entries of the multicast table array
   because the device leaves them undefined out of reset; without the clear the NIC would accept random
   multicast traffic ([`src/init/mac_filter.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac_filter.rs#L28), [`src/constants/regs.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L47)).
4. **RX ring.** `rx_setup::program` zeros the descriptor ring, primes every slot with its buffer device
   address from the pool, programs the ring base (`RDBAL`/`RDBAH`), length, head, and tail, then enables the
   receiver through `RCTL` with broadcast-accept, a 2048-byte buffer size, and strip-FCS set
   ([`src/init/rx_setup.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L29)). The ring mechanics are on the [queues](/docs/userland/driver-e1000/queues/) page.
5. **TX ring.** `tx_setup::program` zeros the descriptor ring, programs the base, length, head, and tail,
   writes the IEEE 802.3 full-duplex inter-packet gap into `TIPG`, and enables the transmitter through `TCTL`
   with pad-short-packet, the default collision threshold, and the full-duplex collision distance
   ([`src/init/tx_setup.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L33), [`src/constants/status.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L29)).

If any bring-up step fails, `_start` calls `driver.release()` to return every grant before exiting
([`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46)).

## The broker grants the capsule holds

The driver reaches hardware only through grants, each scoped to the claim epoch. The wrappers are thin.

| Grant | What it is | Source |
|---|---|---|
| Device claim | the exclusive hold on the PCI function; the root of every other grant | [`src/setup/claim.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L22) |
| MMIO | BAR0 mapped into the capsule as a user VA | [`src/setup/mmio.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L32) |
| IRQ | the device INTx line bound to a broker slot (held, not serviced) | [`src/setup/irq.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L28) |
| DMA RX ring | the receive descriptor ring, with a device address | [`src/setup/dma.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L53) |
| DMA RX buffers | the receive buffer pool | [`src/setup/dma.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L57) |
| DMA TX ring | the transmit descriptor ring, with a device address | [`src/setup/dma.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L61) |
| DMA TX buffers | the transmit buffer pool | [`src/setup/dma.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L65) |

The capsule programs the controller only with the broker-issued device addresses, never a physical address
it chose ([`src/init/rx_setup.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L40), [`src/init/tx_setup.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L42)).

## Grant teardown

`Driver::release` drops every grant in the reverse order setup took it: the TX buffer, TX ring, RX buffer,
and RX ring DMA regions, then the IRQ, the MMIO grant, and finally the device claim ([`src/setup/driver.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L49)).
Each broker call is best-effort: an error from a doubly-dropped grant is harmless because the broker has
already revoked it. `release` runs on an early bring-up failure ([`src/main.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L47)); the server loop never
returns, and the kernel also revokes every grant tied to the claim when the process dies, so a crash cannot
leak a claim, a mapping, or a DMA buffer (see [revocation](/docs/subsystems/hardware-broker/revocation/)).

## Security posture at bring-up

This driver holds real hardware authority, so the trust question is not whether it can reach hardware but how
tightly that reach is bounded. The broker bounds it the same four ways the NVMe driver is bounded, each
visible above. The claim is device-scoped and epoch-gated, so the capsule can act only on the one NIC it
claimed and cannot use a stale claim ([`src/setup/claim.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L22);
[claim.md](/docs/subsystems/hardware-broker/claim/)). The MMIO grant is exactly BAR0 of that function at a
broker-chosen user address, so the driver never sees a physical address or another device's registers
([`src/setup/mmio.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L32)). Each of the four DMA regions is a separate grant with its own device address
returned by the broker, and the controller's ring bases are programmed only with those addresses
([`src/setup/dma.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L47), [`src/init/rx_setup.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L40)). Every grant is released on an early exit and again by the
kernel on process death ([`src/setup/driver.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L49)).

The honest caveat is the absence of an IOMMU on the current target. The e1000 is a bus-mastering DMA device:
the driver hands it device addresses for its descriptor rings and its receive and transmit buffer pools, but
nothing in hardware forces the NIC to confine its DMA to those buffers. The trust boundary here is the device
itself: a correct e1000 controller only reads and writes the ring and buffer addresses the driver programmed,
and the driver only ever programs broker-issued DMA device addresses. A malicious or buggy NIC could DMA
outside its buffers, and without an IOMMU the broker cannot prevent that. This is the same universal DMA
caveat that applies to every hardware driver capsule, not something specific to the e1000.

## Source map

```
  userland/capsule_driver_e1000/src/setup/sequence.rs   the ordered broker handshake
  userland/capsule_driver_e1000/src/setup/claim.rs      mk_device_claim -> epoch
  userland/capsule_driver_e1000/src/setup/mmio.rs       mk_mmio_map for BAR0, release-on-fail
  userland/capsule_driver_e1000/src/setup/irq.rs        mk_irq_bind on the INTx line, reverse rollback
  userland/capsule_driver_e1000/src/setup/dma.rs        the four DMA grants and reverse rollback
  userland/capsule_driver_e1000/src/setup/rollback.rs   reverse-order grant teardown on partial setup
  userland/capsule_driver_e1000/src/setup/driver.rs     the built Driver struct and release()
  userland/capsule_driver_e1000/src/discover.rs         mk_device_list scan and the Intel NIC match
  userland/capsule_driver_e1000/src/init/run.rs         the bring-up orchestrator
  userland/capsule_driver_e1000/src/init/reset.rs       CTRL.RST, IMC/ICR quiesce, link up
  userland/capsule_driver_e1000/src/init/eeprom.rs      the EERD MAC read
  userland/capsule_driver_e1000/src/init/mac_filter.rs  RAL0/RAH0 and the multicast-table clear
  userland/capsule_driver_e1000/src/init/rx_setup.rs    RDBA/RDLEN/RDH/RDT and RCTL enable
  userland/capsule_driver_e1000/src/init/tx_setup.rs    TDBA/TDLEN/TDH/TDT, TIPG, and TCTL enable
  userland/capsule_driver_e1000/src/regs.rs             Regs: volatile 32-bit access over BAR0
  userland/capsule_driver_e1000/src/constants/regs.rs   register offsets in BAR0
  userland/capsule_driver_e1000/src/constants/status.rs CTRL/STATUS/RCTL/TCTL/EERD bit definitions
  userland/capsule_driver_e1000/src/constants/pci.rs    the Intel vendor id, e1000 device table, BAR index
  userland/capsule_driver_e1000/src/main.rs             the setup/bring-up exit-code mapping
```

Every reference above is verified against those trees.
