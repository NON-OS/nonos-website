---
title: "The RTL8821CE driver capsule"
description: "The driver is a single capsule, driver.rtl8821ce0, whose source is userland/capsuledriverrtl8821ce/."
weight: 2
---
The driver is a single capsule, `driver.rtl8821ce0`, whose source is `userland/capsule_driver_rtl8821ce/`.
This page covers the parts that are the same for any device: how it finds and claims the chip, how its
source is laid out, how it reports progress on a machine with no serial port, and the serve loop and
IPC protocol it presents once the radio is up. The chip-specific bring-up, firmware, MAC, PHY, rings,
and association, is the rest of this section.

## Entry and the bring-up shape

The capsule entry is `_start` in [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs). It initialises the heap and then does two things, in
this order, and this order is deliberate:

```
  _start:
      heap_init()
      (mapped, stage) = bring_up()      // take the chip as far up as it will go
      serve::run(mapped, stage)         // then serve forever, whatever "as far" was
```

`bring_up` (`main.rs`) runs the cold-start sequence, claim and map, power on, firmware, MAC init, and
stops at the first step that fails, returning how far it got as a `Stage`. `serve::run` (`serve.rs`)
then serves forever regardless. This split is the driver's single most important design decision, and
it exists because the target has no serial port. A driver that exits or hangs on a bring-up failure
disappears: the service never registers, and from userland it is indistinguishable from a chip that
was never there. So the driver never exits and never hangs in bring-up. It records the stage it
reached and serves anyway, and the [Settings panel](/docs/userland/capsules-catalog/) reads that
stage back over IPC and shows it on screen. Every on-silicon failure in this driver was found because
the failing stage was legible, not because a debugger was attached.

The `Stage` enum (`serve.rs`) is the vocabulary:

```
  Ready          firmware, MAC, PHY and the rings are up; the radio scans
  NotClaimed     the device could not be claimed or its registers mapped
  PowerFailed    the power-on sequence never reached readiness
  DeadMmio       the register window read back dead after power-on
  FirmwareFailed the firmware download or the engine enable did not complete
  NoDma          bring-up succeeded but the TX/RX DMA could not be mapped
  EfuseFailed    the efuse never read back, so the PHY was left unconfigured
```

## Finding the device

PCI enumeration is the broker's; the driver receives a device list and picks its chip out of it. The
important detail is which memory window it maps. The RTL8821CE exposes its control registers through
PCI base address register 2, not register 0, and it also exposes a smaller I/O window that is not the
one to use. A driver that assumed BAR 0, as a wired NIC driver reasonably might, maps the wrong window
and every register read comes back as noise.

`discover.rs` therefore does not assume a BAR index. It scans the device's base address registers and
selects the first memory-mapped one with a non-zero size:

```
  find(record):
      for i in 0 .. bar_count:
          if record.bars[i] is memory-mapped and size != 0:
              return Found { device_id, bar_index: i, bar_size }
```

The `bar_index` it returns is carried through to the MMIO map, so the driver maps whatever BAR the
chip actually put its registers behind. On the RTL8821CE that is BAR 2.

## Claiming and mapping

With the device identified, [`setup/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/mod.rs) acquires it through the broker in three grants:

```
  1. claim the device by its device id                      (mk_device_claim)
  2. write the PCI command register                         (mk_pci_config_write)
  3. map the register window named by bar_index as MMIO     (mk_mmio_map)
```

The command-register write is the second place a wired-NIC assumption bites. The driver enables two
bits and no more:

```
  command = MEMORY_SPACE | BUS_MASTER
```

It does not set the I/O-space bit. The broker's PCI allowlist ([`src/hardware/broker/pci/allowlist.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/pci/allowlist.rs))
permits exactly Memory-Space and Bus-Master and rejects anything else, so a driver that folded the
I/O-space bit into the command word, again, as a driver that also used the I/O BAR reasonably might,
has its whole command write refused and never becomes a bus master, and a NIC that is not a bus master
cannot DMA. The driver uses only the MMIO BAR, so it asks for only Memory-Space and Bus-Master, and
the write is granted.

The result of `setup::run` is a `Mapped`: the register handle (`Regs`, a thin wrapper over the mapped
MMIO window in `regs.rs`), the device id, and the claim epoch. The device id and claim epoch are
carried because every later DMA map is made against that same claim, so the broker can tie the DMA
grants to the live claim and revoke them together.

## The source map

The capsule is large, and the source is one concern per file, grouped by bring-up stage. The top-level
modules under `userland/capsule_driver_rtl8821ce/src/`:

```
  main.rs        _start, and bring_up(): the cold-start sequence and its Stage result
  discover.rs    BAR selection: find the memory window the registers live behind
  setup/         claim the device, set the command register, map the MMIO window
  bringup.rs     the power-on probe: run the MAC power sequence and read the chip back
  pwr/           the MAC power-on/off sequence engine (the power-state table executor)
  regs.rs        Regs, the typed MMIO accessor (read8/16/32, write8/16/32)
  efuse.rs       read the board facts the PHY needs: cut, package, RF front-end option

  fwload.rs      firmware download orchestration (see firmware.md)
  fw/            the firmware machinery: header parse, section split, reserved-page
                 staging, the DDMA channel, the completion protocol

  mac/           MAC init: the register-table engine, the init table, and the TRX
                 config that enables the transmit and receive engines

  phy/           the baseband and radio: power, the register tables, the receive-path
                 enable and antenna switch, transmit power, channel and RF tuning

  ring/  tx/  rx/  the transmit and receive DMA rings and descriptors (see rings.md)

  link.rs        RtlLink: the LinkPort net_core drives, and RtlKeys, the CAM key store
  assoc.rs       the association driver: run the MLME to a keyed link (see scan-and-associate.md)
  scan.rs        ScanResults: the deduplicated network list a scan collects
  sec.rs         the hardware security CAM: install and clear CCMP keys
  serve.rs       the serve loop, the background scanner, and the control protocol
  status.rs      one-line progress on the framebuffer console (the no-serial lifeline)
```

The shared, chip-independent half of the driver, the 802.11 frame formats, the association state
machine, the WPA2 key schedule, and the CCMP cipher, is not here: it is the nonos_wifi_core
crate, and the driver depends on it.

## The serve loop

Once bring-up returns, `serve::run` builds the radio and enters the loop. Building the radio
(`build_radio`) maps the four DMA regions the data path needs (the TX ring and its buffers, the RX
ring and its buffers), runs the PHY bring-up, reads the station MAC the efuse autoloaded into the
MAC-ID register, and constructs an `RtlLink` over all of it. If bring-up did not reach `Ready`, or the
rings will not map, the radio is left `Down` and the loop still runs, so the panel can still read the
stage.

The loop waits for a request, and while no request is pending it advances the background scanner one
step:

```
  loop:
      n = mk_ipc_recv(inbox, buf, IDLE_TIMEOUT_MS)     // wait up to 100ms for a request
      if n > 0:
          served = netif::serve(request, link)         // a net_core link op?
          if served: reply
          else: reply(control(request))                // else the Wi-Fi control family
      if radio is Up and not associated:
          scanner.drain(link)                          // pull beacons off the ring
          if n <= 0: scanner.advance()                 // and, on an idle tick, hop channel
```

Two request families arrive on the one inbox, and they are told apart by their magic number. The first
is net_core's link protocol; the second is the Wi-Fi control protocol the Settings panel speaks. The
scanner is covered in scan-and-associate.md; the two protocols are below.

## The net_core link protocol

To [net_core](/docs/subsystems/networking/stack/), this capsule is just a NIC: it speaks the same `LinkPort` contract every
NØNOS network driver speaks, defined in `nonos_wifi_core::netif`. Four operations are the whole
contract, and `netif::serve` answers them against the driver's `RtlLink`:

```
  magic = 0x4E4E4554 ("NNET"), 20-byte header, little-endian

  LINK_STATUS  (2)   is the station associated and carrying data?
  MAC_ADDRESS  (3)   the station MAC, once associated
  TX_PACKET    (4)   take this Ethernet frame and transmit it
  RX_PACKET    (5)   hand back the next received Ethernet frame, or "again"
```

The contract is deliberately in terms of Ethernet frames. net_core hands the driver an Ethernet frame
to transmit and receives Ethernet frames back; it never learns that the driver turned each one into an
802.11 data frame, addressed it to the access point, and let the radio encrypt it from the CAM. That
translation is `RtlLink`'s `send_tx` and `poll_rx` (`link.rs`), and it is where the wireless link
disappears from net_core's point of view. Before the station is associated, `poll_rx` returns nothing,
because there is no data traffic yet and the received frames are beacons the scanner wants, and
`send_tx` refuses, because there is no link to transmit on.

## The Wi-Fi control protocol

The second family is how the Settings panel scans and connects. It is a small request/reply protocol
distinct from net_core's, tagged with its own magic so the two never collide:

```
  magic = 0x57494649 ("WIFI"), 10-byte header (magic, u16 op, u32 request-id)

  OP_CONNECT     (1)  join a network: body is [ssid_len][ssid][pass_len][pass]
  OP_DISCONNECT  (2)  drop the association and clear the keys
  OP_SCAN        (3)  return the networks the background scanner has collected
  OP_STATUS      (4)  return the bring-up Stage (the panel's window into a serial-less boot)
```

`OP_STATUS` is answered instantly with the one-byte stage. `OP_SCAN` is answered instantly from the
background scanner's running picture, with the receive-pipeline counters ahead of the network list so
an empty scan is diagnosable on screen. `OP_CONNECT` is the one that blocks: it runs the whole join,
covered in scan-and-associate.md. The service registers under the name
`driver.rtl8821ce0`, and the panel finds it by that name through the service registry.

## Source

```
  userland/capsule_driver_rtl8821ce/src/main.rs        _start and bring_up()
  userland/capsule_driver_rtl8821ce/src/discover.rs    BAR selection
  userland/capsule_driver_rtl8821ce/src/setup/mod.rs   claim, command register, MMIO map
  userland/capsule_driver_rtl8821ce/src/serve.rs       serve loop, Stage, the two protocols
  userland/capsule_driver_rtl8821ce/src/link.rs        RtlLink (LinkPort) and RtlKeys (CAM)
  userland/nonos_wifi_core/src/netif/                  the LinkPort contract and netif::serve
  src/hardware/broker/pci/allowlist.rs                 the PCI command-register allowlist
  src/hardware/rtl8821ce_capsule/                      the kernel-side spawn and embed
```
