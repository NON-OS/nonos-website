---
title: "The receive ring and transmit slots"
description: "The RTL8139 moves frames through DMA memory the driver owns: a single circular receive buffer the NIC fills as frames arrive, and four fixed transmit slots the driver fills and ..."
weight: 8
---
The RTL8139 moves frames through DMA memory the driver owns: a single circular receive buffer the NIC fills
as frames arrive, and four fixed transmit slots the driver fills and the NIC drains. This page mirrors the two
folders that own that machinery: `src/rx/` (the circular buffer reader) and `src/tx/` (the four slots and the
completion poll), together with the sizes in [`src/constants/dma.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/dma.rs) and the register bits in
[`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs). How the buffers are first allocated and programmed is on the [bring-up](/docs/userland/driver-rtl8139/bring-up/)
page; the client ops that call into them are on the [operations](/docs/userland/driver-rtl8139/operations/) page.

## The DMA layout

The two DMA regions are sized once ([`src/constants/dma.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/dma.rs#L17)):

```
  RX_BUF_DATA_BYTES = 32 KiB                        the ring the NIC writes into
  RX_BUF_BYTES      = 32 KiB + 16 + 2048            data + descriptor slack + one-frame overrun margin
  TX_SLOT_COUNT     = 4                             the four transmit descriptors
  TX_SLOT_BYTES     = 2048                          one slot, larger than a 1514-byte frame
  TX_BUF_BYTES      = 4 * 2048                       the whole transmit region
```

The receive buffer is one contiguous 32 KiB ring with extra tail room so the NIC can finish writing a frame
that started near the end without the driver needing per-descriptor wrap handling; the wrap bit in `RCR` lets
the controller run a frame past the 32 KiB boundary into that slack (`RCR_WRAP`, [`src/constants/regs.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L48),
set at [`src/init/rx_setup.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L30)). The transmit region is four equal 2048-byte slots, each larger than the
1514-byte maximum Ethernet frame so a frame never straddles a slot.

## The receive ring

The RTL8139 receive buffer is a byte ring. The NIC writes each frame as a 4-byte header (a 16-bit receive
status and a 16-bit length) followed by the frame bytes, and it keeps its own write pointer; the driver keeps
a read pointer, the software `rx_offset`, and tells the hardware how far it has consumed through the `CAPR`
register.

Reading one frame is `recv_one` ([`src/rx/recv_one.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L26)):

1. It reads the interrupt-status register `ISR`, and if any bit is set it acknowledges those bits by writing
   them back (the RTL8139 clears interrupt sources on write-back) ([`src/rx/recv_one.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L27)).
2. If any of the RX-error, RX-overflow, or RX-FIFO-overflow bits was set, it acks the IRQ grant and returns a
   receive error ([`src/rx/recv_one.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L31)).
3. It reads the command register, and if the `CMD_RX_BUF_EMPTY` bit is set the ring holds no complete frame,
   so it acks the IRQ and returns `Ok(None)`, which the handler turns into `E_AGAIN`
   ([`src/rx/recv_one.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L35)).
4. Otherwise it hands off to `read_frame` ([`src/rx/recv_one.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L39)).

`read_frame` reads the descriptor at the current `rx_offset` out of the ring, validates it, copies the frame,
and advances ([`src/rx/read_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L28)). It reads the 16-bit status and 16-bit raw length with `ring_u16`,
and rejects a descriptor whose receive-OK status bit is clear or whose raw length is four or fewer bytes,
acking the IRQ and returning an error ([`src/rx/read_frame.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L35)). The real frame length is the raw length
minus the 4-byte CRC the NIC includes, and a frame larger than the Ethernet maximum or the caller's buffer is
refused before any copy ([`src/rx/read_frame.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L41)). A valid frame is copied out with `copy_ring`, then
`advance` moves the cursor and the IRQ is acked ([`src/rx/read_frame.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L46)).

### Wrap arithmetic

The ring reads and the cursor advance are all modulo the 32 KiB data size, which is what makes the buffer
circular. `ring_u8` masks every byte offset by `RX_BUF_DATA_BYTES` before the volatile read, so a read that
runs off the logical end folds back to the start ([`src/rx/ring_u8.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/ring_u8.rs#L19)), and `ring_u16` composes two such
reads little-endian ([`src/rx/ring_u16.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/ring_u16.rs#L19)). `advance` computes the next offset as the current offset plus
the raw length plus the 4-byte header, rounded up to a 4-byte boundary and taken modulo the data size, then
programs `CAPR` as that offset minus 16, again modulo the data size ([`src/rx/advance.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/advance.rs#L22)). The minus-16 is
the RTL8139's quirk: `CAPR` trails the true read position by 16 bytes, and `rx_setup` seeds the same
expression at bring-up so the first read starts clean ([`src/init/rx_setup.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L34)).

## The four transmit slots

Transmit is four descriptors used round-robin. Each slot has a status/command register (`TXSTATUS0..3` at
`0x10`, `0x14`, `0x18`, `0x1C`) and an address register (`TXADDR0..3` at `0x20`, `0x24`, `0x28`, `0x2C`), and
the address registers are programmed once at bring-up with the four slot device addresses
([`src/init/tx_setup.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L21)). The driver keeps a software cursor, `tx_cur`, naming the next slot to use.

Sending one frame is `send` ([`src/tx/send.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L24)):

1. It copies the frame bytes into the current slot's user virtual address, `tx_user_va + tx_cur *
   TX_SLOT_BYTES`, with a non-overlapping copy ([`src/tx/send.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L25)).
2. A release compiler fence orders the buffer write before the register write that starts the DMA
   ([`src/tx/send.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L30)).
3. It writes the frame length into the slot's status register, which is the RTL8139's start-transmit trigger
   ([`src/tx/send.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L32)).
4. It polls the same status register for completion, then advances `tx_cur` to the next slot modulo four
   ([`src/tx/send.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L33)).

`poll_done` spins up to a million iterations reading the slot status behind an acquire fence: it returns a
transmit error if the abort or underrun bit is set, success once the transmit-OK bit is set, and a timeout
error if neither lands within the budget ([`src/tx/poll_done.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/poll_done.rs#L24)). The status bits are `TX_STATUS_OK`
(bit 15), `TX_STATUS_UNDERRUN` (bit 14), and `TX_STATUS_ABORT` (bit 30) ([`src/constants/regs.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L52)).

## Where the copy boundary sits

The frame bytes cross the userland/DMA boundary in exactly two places, and both are bounded. On receive,
`copy_ring` copies `frame_len` bytes out of the ring into the caller's reply buffer one masked byte at a time,
and `frame_len` was already checked against both the Ethernet maximum and the caller's buffer length before
the copy began ([`src/rx/copy_ring.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/copy_ring.rs#L19), [`src/rx/read_frame.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L42)). On transmit, `send` copies exactly
`frame.len()` bytes into the slot, and the TX handler already bounded that length to the 60..1514 Ethernet
range, which is smaller than the 2048-byte slot, so the copy cannot overrun ([`src/tx/send.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L28),
[`src/server/handlers/tx_packet.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L28)). The NIC's own DMA stays inside the ring and the slots because those
are the only addresses programmed into `RBSTART` and the `TXADDR` registers.

## Where the interrupt fits

The INTx binding is a wake hint and an accounting mechanism, not the correctness path for a single poll. The
receive path reads and acknowledges the RTL8139's `ISR` bits directly over PIO and acks the broker IRQ grant
with `mk_irq_ack` on every outcome, whether it found a frame, found the ring empty, or hit an error
([`src/rx/recv_one.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L32), [`src/rx/read_frame.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L48)). Correctness comes from the `CMD_RX_BUF_EMPTY` check and
the descriptor validation, so a client that simply polls `OP_RX_PACKET` drains the ring correctly regardless
of interrupt timing.

## Source map

```
  userland/capsule_driver_rtl8139/src/constants/dma.rs      RX and TX buffer sizes, slot count and size
  userland/capsule_driver_rtl8139/src/constants/regs.rs     CAPR, RCR/TCR bits, ISR bits, TX status bits
  userland/capsule_driver_rtl8139/src/rx/recv_one.rs        the ISR read, empty check, and error gate
  userland/capsule_driver_rtl8139/src/rx/read_frame.rs      the descriptor read, validation, copy, and advance
  userland/capsule_driver_rtl8139/src/rx/advance.rs         the rx_offset advance and CAPR write
  userland/capsule_driver_rtl8139/src/rx/copy_ring.rs       the bounded ring-to-reply copy
  userland/capsule_driver_rtl8139/src/rx/ring_u8.rs         the modulo-masked volatile byte read
  userland/capsule_driver_rtl8139/src/rx/ring_u16.rs        the little-endian 16-bit ring read
  userland/capsule_driver_rtl8139/src/tx/send.rs            the slot copy, fence, trigger, and cursor advance
  userland/capsule_driver_rtl8139/src/tx/poll_done.rs       the completion poll and the TX status decode
  userland/capsule_driver_rtl8139/src/init/rx_setup.rs      the CAPR seed and RCR accept mask
  userland/capsule_driver_rtl8139/src/init/tx_setup.rs      the four TXADDR programming
  userland/capsule_driver_rtl8139/src/server/handlers/tx_packet.rs  the frame-size bound before send
```

Every reference above is verified against those trees.
