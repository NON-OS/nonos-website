---
title: "The descriptor rings and the DMA engine"
description: "The e1000 moves frames through two descriptor rings in DMA memory."
weight: 5
---
The e1000 moves frames through two descriptor rings in DMA memory. To transmit, the driver copies a frame
into a transmit buffer, writes a descriptor pointing at it, and bumps the transmit tail register; the NIC
DMAs the frame out and sets a done bit in the descriptor. To receive, the NIC DMAs an incoming frame into a
receive buffer and sets a done bit in the pre-posted descriptor; the driver reads the descriptor, copies the
frame out, and hands the descriptor back by bumping the receive tail. This page mirrors `src/queue/` (the
descriptor layout and the two ring cursors) together with the setup and handler code that programs and drives
them. How the rings are first allocated and enabled is on the [bring-up](/docs/userland/driver-e1000/bring-up/) page; the client ops
that call into the rings are on the [operations](/docs/userland/driver-e1000/operations/) page.

## The descriptor layout

Both descriptor types are the legacy 16-byte 8254x form, `repr(C)` with a compile-time size assertion so a
field reorder cannot silently change the wire layout the device reads ([`src/queue/layout.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L46)). The
device-side fields are written by the NIC, the driver-side fields by the capsule.

A receive descriptor is a 64-bit buffer address, a 16-bit length, a checksum, a status byte, an error byte,
and a special field ([`src/queue/layout.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L23)). A transmit descriptor is a 64-bit buffer address, a 16-bit
length, a checksum-offset byte, a command byte, a status byte, a checksum-start byte, and a special field
([`src/queue/layout.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L34)).

The status and command bits the driver uses are one file of constants ([`src/constants/queue.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L31)):

```
  RX_STATUS_DD   1 << 0   descriptor done: the NIC wrote a frame here
  RX_STATUS_EOP  1 << 1   end of packet
  TX_CMD_EOP     1 << 0   end of packet
  TX_CMD_IFCS    1 << 1   insert the frame check sequence
  TX_CMD_RS      1 << 3   report status: set DD when this descriptor completes
  TX_STATUS_DD   1 << 0   descriptor done: the NIC transmitted this frame
```

## Ring sizing and the DMA pools

Both rings hold 32 descriptors of 16 bytes each, and each ring has a matching pool of 32 buffers of 2048
bytes ([`src/constants/queue.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L17)). The four sizes become the four DMA grants setup takes: an RX ring, an RX
buffer pool, a TX ring, and a TX buffer pool ([bring-up](/docs/userland/driver-e1000/bring-up/), [`src/setup/dma.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L47)). The 2048-byte
buffer matches the `RCTL` buffer-size setting programmed at RX enable, so a full 1514-byte Ethernet frame
fits in one buffer with room to spare ([`src/init/rx_setup.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L45), [`src/constants/status.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L26)).

Each ring cursor knows the user VA of its descriptor ring, the user VA and device address of its buffer pool,
and its position. The RX ring holds a `head` cursor, the TX ring a `tail` cursor ([`src/queue/rx.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L22),
[`src/queue/tx.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx.rs#L28)). The per-slot buffer address is computed as the pool base plus the slot index times the
2048-byte buffer length, for both the device address the NIC uses (`buffer_phys`) and the user VA the capsule
copies through (`buffer_va`) ([`src/queue/rx.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L39), [`src/queue/tx.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx.rs#L48)).

## The transmit path

`OP_TX_PACKET` validates the frame size, then drives the TX ring ([`src/server/handlers/tx_packet.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L26),
[operations](/docs/userland/driver-e1000/operations/)):

1. Copy the frame into the buffer for the current tail slot with a non-overlapping copy
   ([`src/server/handlers/tx_packet.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L38)).
2. `TxRing::post` writes the descriptor at the tail: the buffer device address, the frame length, and the
   command byte `EOP | IFCS | RS`, clears the status, and advances the tail modulo 32, returning the index it
   used ([`src/queue/tx.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx.rs#L56)).
3. Ring the doorbell: write the register `TDT` with the next tail so the NIC knows a descriptor is ready
   ([`src/server/handlers/tx_packet.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L43), [`src/constants/regs.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L45)).
4. Poll the posted descriptor's `TX_STATUS_DD` bit until the NIC sets it, up to a fixed budget of one million
   spins; a completion that never lands returns `E_IO` ([`src/server/handlers/tx_packet.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L48),
   [`src/queue/tx.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx.rs#L67)). Because `TX_CMD_RS` was set, the NIC writes the done bit back when the frame is out.

The done-bit poll is what makes the interrupt unnecessary: the driver never waits on the IRQ, it watches the
descriptor the device writes.

## The receive path

The receiver runs the other way. At bring-up every descriptor is primed with a buffer device address and the
tail is set to the last valid index, so all 32 slots are available to the NIC ([`src/init/rx_setup.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L35)).
`OP_RX_PACKET` consumes one completed descriptor ([`src/server/handlers/rx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L27)):

1. `RxRing::consume` reads the descriptor at the head. If its `RX_STATUS_DD` bit is clear the ring is empty
   and it returns `None`, which the handler answers with `E_AGAIN` ([`src/queue/rx.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L47)).
2. On a done descriptor it snapshots the status, error, and length, clears the descriptor's status and error
   so the slot can be reused, and advances the head modulo 32 ([`src/queue/rx.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L52)).
3. It then screens the frame: a descriptor that is not end-of-packet, that has any error bit set, that
   reports a zero length, or that reports a length above `MAX_ETHERNET_FRAME` is returned with a length of
   zero, which the handler treats as a bad frame, recycles by writing the descriptor index into `RDT`, and
   answers `E_IO` ([`src/queue/rx.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L59), [`src/server/handlers/rx_packet.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L35)).
4. On a good frame the handler writes a 4-byte little-endian length prefix, copies the frame out of the
   buffer, recycles the descriptor by writing its index into `RDT` so the NIC can reuse the slot, and sends
   the reply ([`src/server/handlers/rx_packet.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L42), [`src/constants/regs.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L39)).

Recycling by writing the consumed index into `RDT` is what keeps the ring supplied: the tail always trails the
head by the descriptors the driver has handed back, so the NIC is never starved of a place to DMA the next
frame.

## Why the interrupt is not on the ring path

The IRQ grant is bound at setup and released at teardown, but neither ring is driven by it. The transmit path
polls the transmit done bit and the receive path polls the receive done bit, both against DMA memory the
device writes, so a bound-but-unserviced interrupt is not a correctness gap: the rings work in pure polling
mode. This is the discrepancy noted on the [README](/docs/userland/driver-e1000/) against the source README's "IRQ completion
path" language: the completion mechanism here is the descriptor status bit, not the interrupt.

## The stats snapshot

`OP_STATS` reads the live ring registers without touching a descriptor: `RDH` and `RDT` for the receive ring,
`TDH` and `TDT` for the transmit ring, plus the driver's own `head` and `tail` cursors and the two descriptor
counts ([`src/server/handlers/stats.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L38)). Comparing the device head/tail against the driver cursors is the
direct way to see whether the rings are advancing, which the [debugging](/docs/userland/driver-e1000/debugging/) page uses.

## Source map

```
  userland/capsule_driver_e1000/src/queue/layout.rs     the 16-byte RxDesc and TxDesc and the size asserts
  userland/capsule_driver_e1000/src/queue/rx.rs         RxRing: consume, buffer_phys/va, the head cursor and frame screen
  userland/capsule_driver_e1000/src/queue/tx.rs         TxRing: post, done, buffer_phys/va, the tail cursor
  userland/capsule_driver_e1000/src/constants/queue.rs  ring counts, buffer sizes, and the DD/EOP/RS bits
  userland/capsule_driver_e1000/src/init/rx_setup.rs    priming the RX descriptors and RDBA/RDLEN/RDH/RDT
  userland/capsule_driver_e1000/src/init/tx_setup.rs    zeroing the TX descriptors and TDBA/TDLEN/TDH/TDT
  userland/capsule_driver_e1000/src/server/handlers/tx_packet.rs  the copy, post, TDT doorbell, and done poll
  userland/capsule_driver_e1000/src/server/handlers/rx_packet.rs  the consume, frame screen, copy, and RDT recycle
  userland/capsule_driver_e1000/src/server/handlers/stats.rs      the live ring-register snapshot
  userland/capsule_driver_e1000/src/constants/regs.rs   RDT and TDT and the other ring register offsets
```

Every reference above is verified against those trees.
