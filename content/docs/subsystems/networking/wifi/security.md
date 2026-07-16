---
title: "Security of the wireless stack"
description: "Networking is where a system meets the most hostile input it will ever see, and Wi-Fi is the worst case of it."
weight: 500
---
Networking is where a system meets the most hostile input it will ever see, and Wi-Fi is the worst
case of it. Before a single packet the user asked for arrives, the driver has parsed a firmware image,
a stream of beacons and management frames from every radio in range, and EAPOL key frames from an
access point it has not yet authenticated. Every one of those is attacker-influenced, and a bug in
parsing any of them is a bug reached from the air. This page documents how NØNOS contains that, layer
by layer, and where the trust boundaries and the keys actually sit. The short version is that the
wireless stack holds no kernel authority, the layers are isolated from each other, and the encryption
keys never enter the software that runs the protocol.

## The threat model

Assume every byte from outside the machine is chosen by an adversary. For the wireless stack that is:

```
  the firmware image        parsed by the driver before the link exists
  beacons, probe responses  parsed by the scanner, from every AP in range
  auth / assoc responses    parsed by the association state machine
  EAPOL key frames          parsed during the handshake, before the AP is trusted
  802.11 data frames        received and decrypted, then parsed as Ethernet
  IP / TCP / UDP packets    parsed by the stack, from anywhere on the network
```

The design goal is not that none of this parsing has bugs; it is that a bug in any of it is contained
to a ring-3 program holding only its own device, and reaches neither the kernel nor the other layers.

## No kernel authority

The entire stack runs in capsules, in ring 3. The kernel contains no NIC driver, no TCP/IP stack, and
no socket code. A capsule holds exactly the authority the [hardware broker](/docs/subsystems/hardware-broker/)
granted it, expressed as capabilities, and can do nothing outside them. The Wi-Fi driver's grants are
its device claim, one PCI-config write, one MMIO window, some DMA memory, and its interrupt, and that
is the whole of its power over the machine. It cannot touch a register it did not map, cannot read or
write memory it was not given, and cannot see a device it did not claim. A total compromise of the
driver yields control of one wireless chip and its granted DMA buffers, not the kernel, not the CPU's
privileged state, and not another capsule's memory.

This is the first and most important property, and it is structural: the driver could not escalate
even if every parser in it were exploitable, because the interfaces it can reach are the broker grants
and the IPC channels, and neither is the kernel's address space.

## The layers are isolated from each other

Containment is not just driver-versus-kernel; it is layer-versus-layer. The stack is deliberately split
into separate capsules, and each is a separate isolation domain:

```
    driver.rtl8821ce0   parses firmware, beacons, management and EAPOL frames, programs DMA
        |  IPC (Ethernet frames)
    net_core            parses IP, TCP, UDP; runs DHCP and DNS
        |  IPC (socket operations)
    net.sockets         the BSD socket API surface
        |  IPC
    net.nym             the optional anonymity overlay
```

Each seam is an IPC boundary, and each side sees only the other's messages, never its memory. The
driver parses the wire and hands net_core a plain Ethernet frame; a bug in the 802.11 or firmware
parsing cannot corrupt net_core, because net_core is a different address space reached only by a
message. net_core parses IP and TCP and hands net.sockets a socket result; a bug in the packet parsing
cannot corrupt the socket layer for the same reason. The maximal-isolation form of net_core goes
further and puts each protocol layer, L2, IP, TCP, UDP, DHCP, DNS, in its own capsule; the consolidated
form is the one that is runtime-proven. Either way, an application that opens a socket reaches a
capability-checked IPC service, not a kernel it must trust to parse the wire.

## Every DMA is granted and bounded

A network driver programs a device to write directly into memory, which is the most dangerous thing it
does, so DMA is a brokered capability, not an ambient power. The driver's DMA buffers are granted by
the [broker's DMA path](/docs/subsystems/hardware-broker/), tied to the device claim, and revoked with
it. The driver cannot point the device at arbitrary memory; it can only map buffers the broker gave it,
and the device can only reach those. The PCI command register that makes the device a bus master is
itself gated: the broker's allowlist ([`src/hardware/broker/pci/allowlist.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/pci/allowlist.rs)) permits exactly the
Memory-Space and Bus-Master bits and refuses everything else, so a driver cannot even ask for a device
configuration the broker did not sanction. The low-memory DMA pool that satisfies the 32-bit-descriptor
requirement is a kernel-owned range the driver draws from through the broker, not a region it can
address freely.

## The keys never enter the protocol software

The most security-relevant property of the Wi-Fi driver is where the encryption keys live. The driver
runs the WPA2 four-way handshake and derives the pairwise and group keys, but it does not keep them in
the data path and does not encrypt frames in software. It installs the keys into the radio's hardware
security CAM (`sec.rs`), and from then on the radio encrypts every transmitted frame and decrypts every
received one from the CAM, keyed by the peer address. The consequence is that the transmit and receive
paths, `RtlLink::send_tx` and `poll_rx`, deal only in plaintext Ethernet frames: they never hold the
temporal key, and the CCMP cipher runs in silicon, not in the parser-adjacent code. The key exists in
software only for the moment of the handshake that derives it and the install call that hands it to the
CAM; the frame-handling code that faces hostile input never touches it.

The handshake frames themselves go out unencrypted and on a robust rate, because the standard requires
it, they precede the keys, and the driver marks them with the "no security" descriptor type so the
radio does not try to encrypt them from a CAM slot that is not yet populated. The moment the handshake
completes and the keys are installed, the association is recorded and the data path switches to the
CAM-encrypted frames.

## The crypto is real and verified

The WPA2 and CCMP implementations are not stubs. The chip-independent nonos_wifi_core
crate carries the full key schedule, PBKDF2 to the pairwise master key, the PRF to the pairwise
transient key, the EAPOL key-frame construction and MIC, and the CCMP cipher with its AAD and nonce
construction, and each is checked byte-for-byte against the IEEE reference vectors in the crate's host
proofs. The state machine that runs the association verifies the message-3 MIC and the access point's
nonce before it trusts anything, and abandons the handshake on any mismatch. A wrong passphrase does not
half-connect; it fails the MIC check and the join is refused. Because the crypto is chip-independent, a
second Wi-Fi driver inherits the same verified implementation rather than reimplementing it.

## The trust chain to the capsule itself

A capsule only has the authority it was granted, but it also only runs if it was signed. The Wi-Fi
driver is a signed capsule: its ELF, its identity certificate, and its manifest are embedded and
verified before it is spawned (`src/hardware/rtl8821ce_capsule/`). So the chain is closed at both ends,
the capsule that runs is one the build signed, and the authority it holds is one the broker granted,
and neither the code nor its power is ambient.

## Anonymity as a layer, not a promise

For traffic that should not reveal its origin, the stack offers an overlay capsule, `net.nym`, that
carries a connection through a real mixnet rather than straight to the destination. It is a separate
isolation domain like every other layer, it is optional, and it is documented with the rest of the
[network services](/docs/subsystems/networking/services/). It is worth naming here only to be precise about the boundary: the
wireless stack's job is a contained, correct, encrypted link, and anonymity above that link is a
distinct capsule with its own guarantees, not a property of the driver.

## Why this shape

The recurring argument, driver in a capsule, layers isolated from each other, DMA and device access
brokered, keys in hardware, capsule signed, is one principle applied at every level: authority is
granted and bounded, never ambient, and the components that face hostile input hold the least of it.
The wireless stack is the sharpest test of that principle, because it faces the most hostile input of
anything in the system and programs the most dangerous hardware, and it is contained the same way
everything else is, by isolation and capability rather than by trusting the code to be correct.

## Source

```
  userland/capsule_driver_rtl8821ce/src/sec.rs        the hardware security CAM (key install/clear)
  userland/capsule_driver_rtl8821ce/src/link.rs       plaintext data path; the "no security" handshake TX
  userland/nonos_wifi_core/src/wpa/                    PBKDF2, the PRF, the PTK schedule
  userland/nonos_wifi_core/src/eapol/                  EAPOL key frames and the MIC
  userland/nonos_wifi_core/src/ccmp/                   the CCMP cipher, AAD and nonce
  src/hardware/broker/pci/allowlist.rs                the PCI command-register allowlist
  src/hardware/broker/dma/                             the brokered, claim-tied DMA
  src/hardware/rtl8821ce_capsule/                     the signed-capsule embed and spawn
```
