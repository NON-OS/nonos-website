---
title: "Wi-Fi"
description: "How NØNOS reaches a wireless network. A Wi-Fi adapter is a far larger machine than a wired NIC: it carries its own firmware, a baseband processor, a radio front end, and a link ..."
weight: 400
---
How NØNOS reaches a wireless network. A Wi-Fi adapter is a far larger machine than a wired NIC: it
carries its own firmware, a baseband processor, a radio front end, and a link layer that must
authenticate and encrypt before a single IP packet moves. NØNOS drives all of it from a capsule. The
driver is a signed userland program that reaches the hardware only through hardware-broker grants,
brings the chip up from cold silicon to a receiving radio, scans the air, runs the WPA2 association
and four-way handshake itself, and then presents an ordinary Ethernet interface to
[net_core](/docs/subsystems/networking/stack/) over IPC. The kernel holds none of it beyond the broker grants and the IPC.

This section documents the wireless stack in full detail, one layer at a time. The first driver
brought up on real silicon is the Realtek RTL8821CE, a PCIe 802.11ac part, and the pages below follow
it from the PCI probe to a keyed link.

| Page | What it covers |
|------|----------------|
| [driver.md](/docs/subsystems/networking/wifi/driver/) | The RTL8821CE capsule: device discovery, the capability model, the module layout, and the serve loop that presents the interface. |
| [firmware.md](/docs/subsystems/networking/wifi/firmware/) | Loading the on-chip 8051 firmware: reserved-page staging, the DDMA channel, the completion-bit protocol, and the sub-4GB DMA requirement. |

## The shape of the stack

A wired NIC driver is small because the hardware is small: a receive ring, a transmit ring, and a MAC
address. A Wi-Fi driver is large because the hardware is large, and because the link layer above the
frames is a protocol in its own right. NØNOS splits the work so that the chip-specific parts and the
chip-independent parts live in different places.

```
    application                        opens a socket
        |
    net.sockets  (capsule)             BSD socket API
        |  IPC
    net_core     (capsule)             smoltcp: IP, TCP, UDP, DHCP, DNS
        |  IPC  (Ethernet frames, the NicDevice bridge)
    driver.rtl8821ce0  (capsule)       this section
        |
        +-- chip driver               PCI, firmware, MAC, PHY, radio, DMA rings
        +-- nonos_wifi_core           802.11 framing, MLME, WPA2, CCMP  (shared)
        |
    hardware broker  (kernel)          MMIO, DMA, IRQ, PCI-config, device-claim grants
        |
    RTL8821CE                          the PCIe 802.11ac silicon
```

Everything above the driver capsule is the ordinary NØNOS network stack and does not know the link is
wireless: [net_core](/docs/subsystems/networking/stack/) receives Ethernet frames and has no idea they were 802.11 data
frames a moment earlier, decrypted by the radio's CAM. Everything below the IPC boundary is this
section. Inside the driver capsule, the chip-specific code (registers, firmware, DMA) is separated
from the chip-independent code (nonos_wifi_core: the 802.11 frame formats, the
association state machine, the WPA2 key schedule, the CCMP cipher), so a second Wi-Fi chip reuses the
protocol brain and supplies only new register programming.

## The capability model

The driver is a capsule, so it holds exactly the authority the [hardware broker](/docs/subsystems/hardware-broker/)
granted it and nothing more. It runs in ring 3. It cannot touch a register it did not map, cannot DMA
to memory it was not given, and cannot see a device it did not claim. Concretely, the capsule is
granted, through the broker:

```
  device-claim      the RTL8821CE at PCI 10EC:C821, by device id
  PCI-config write  to set the command register (memory space + bus master)
  MMIO map          the controller register window (BAR 2)
  DMA map           coherent memory for the firmware staging, the TX/RX rings, and the buffers
  IRQ bind          the device interrupt (the serve loop polls; the grant is held for completeness)
```

The manifest that requests these is the capsule's `Capsule.mk`, and the kernel-side spawn that embeds
and launches the signed capsule is `src/hardware/rtl8821ce_capsule/`. A driver that parses hostile
input at every layer, a firmware image on flash, beacons and management frames off the air, EAPOL key
frames from an access point it has not yet trusted, is the exact case the capability model exists for:
a bug anywhere in that parsing is contained to a ring-3 program holding only its device, not the
kernel.

## The bring-up, at a glance

The driver takes the chip from power-on to a keyed link in a fixed sequence, and each step is a page in
this section. The order matters: the chip will look healthy while being deaf or mute if a step is
skipped, and several of the on-silicon bugs found bringing this driver up were exactly that.

```
  1. claim + map        claim the device, map BAR 2, set the command register     driver.md
  2. power on           run the MAC power-on sequence, confirm the chip answers   mac-and-phy.md
  3. firmware           stage and DDMA the 8051 firmware, confirm it boots        firmware.md
  4. MAC init           the register tables, then enable the TRX engines          mac-and-phy.md
  5. PHY / radio        power the baseband, load the tables, switch the antenna   mac-and-phy.md
                        to the receive amplifier, set transmit power, tune a channel
  6. rings              program the TX/RX rings, reset the DMA interface           rings.md
  7. scan               hop the channels, collect beacons                         scan-and-associate.md
  8. associate          authenticate, associate, run the four-way handshake,      scan-and-associate.md
                        install the keys into the CAM
  9. serve              present the Ethernet interface to net_core                driver.md
```

## Verification

Every claim in this section is verified against the driver source. The register offsets and bit values
are the ones the code writes, cross-checked against the Realtek reference driver (`rtw88`) they were
reimplemented from; the reimplementation is fresh, so the tree stays license-clean, and every layer
ships a host proof in `userland/rtl8821ce_proofs/` that runs the real driver logic against a modeled
device. The bring-up sequence is not theoretical: it is the sequence that took a retail laptop from
"RTL not present" to a scanned, listed home network on real silicon.

## Source

```
  userland/capsule_driver_rtl8821ce/       the chip driver capsule
  userland/nonos_wifi_core/                the shared 802.11 / WPA2 / CCMP crate
  userland/rtl8821ce_proofs/               the host proofs
  src/hardware/rtl8821ce_capsule/          the kernel-side spawn and signed-capsule embed
  userland/capsule_settings/src/wifi/      the Settings panel that scans and connects
```
