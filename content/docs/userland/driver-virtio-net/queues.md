---
title: "The RX and TX virtqueue engine"
description: "This page covers how frames move through the device once it is live: the two split virtqueues, the RX prime and refill, the TX post/notify/wait path, the used-ring reader, and t..."
weight: 4
---
This page covers how frames move through the device once it is live: the two split virtqueues, the RX
prime and refill, the TX post/notify/wait path, the used-ring reader, and the 10-byte virtio-net header
that fronts every frame. It mirrors `src/queue/` (the ring state and the ring writers), [`src/rx.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs)
(pulling a received frame), and [`src/tx.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs) (sending one). The client protocol that drives it is on the
[operations](/docs/userland/driver-virtio-net/operations/) page; the one-time queue setup that programs the rings into the device is on
the [bring-up](/docs/userland/driver-virtio-net/bringup/) page.

## Two queues, not one

Unlike the block driver's single request queue, the NIC has two: a receive queue at index 0 (`Q_RX`) and
a transmit queue at index 1 (`Q_TX`) ([`src/constants/queue.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L27)). Each has its own DMA ring region, its
own packet-buffer region, and its own state struct. The RX ring holds `RX_QUEUE_SIZE` = 64 descriptors
over 64 buffers; the TX ring holds `TX_QUEUE_SIZE` = 8 descriptors over 8 buffers
([`src/constants/queue.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L30)). Each packet buffer is `2048` bytes ([`src/constants/queue.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L48)).

Both queues share the same legacy split-virtqueue layout, laid out with fixed offsets inside a 12288-byte
region: the descriptor table at `VQ_DESC_OFFSET` = 0, the available ring at `VQ_AVAIL_OFFSET` = 4096, and
the used ring at `VQ_USED_OFFSET` = 8192 ([`src/constants/queue.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L34)). Fixing the offsets at page
boundaries keeps the largest ring (64 entries, 1024 bytes of descriptors) comfortably inside its page and
lets every accessor address a ring by a constant offset rather than a computed one.

## Queue state

`RxQueue` and `TxQueue` each hold the ring region virtual address and physical address, the packet-buffer
virtual and physical base, the per-buffer length, the buffer count, and the last-used index the driver
has consumed ([`src/queue/rx_queue.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx_queue.rs#L19), [`src/queue/tx_queue.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx_queue.rs#L19)). `RxQueue` also carries a
`pending_refill` slot and `TxQueue` a `next_avail` counter. Both are built by `queues::build` after
`program_queue` returns the negotiated size, which becomes the buffer count
([`src/setup/queues.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/queues.rs#L30)). `region_phys` is read by `_start` to reject a queue that never mapped
([`src/queue/rx_queue.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx_queue.rs#L55), [`src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L52)).

## Priming RX

`RxQueue::prime` fills the RX ring once, at bring-up, so the device has buffers to receive into
([`src/queue/post.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L24)). For each of the `buf_count` buffers it writes a descriptor at slot `i`: the
buffer physical address (`buf_phys + buf_len * i`), the buffer length, the `VRING_DESC_F_WRITE` (2) flag
so the device fills it, and a zero next index; then it writes descriptor index `i` into available-ring
slot `i` ([`src/queue/post.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L28)). Finally it sets the available index to `buf_count`, publishing all of
them at once ([`src/queue/post.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L37)). Every RX descriptor is device-writable because the device is the
producer on receive.

## Reading a received frame

`take_one` pulls at most one frame off the used ring ([`src/rx.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L37)). It first completes any deferred
refill from the previous call, returning that buffer's descriptor to the available ring through `refill`
([`src/rx.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L38), [`src/queue/refill.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/refill.rs#L23)). It reads the used index; if it equals `last_used` the ring is
empty and it returns `None` ([`src/rx.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L41)). Otherwise it reads the used element at the current ring
position to get the descriptor id and the byte length the device wrote ([`src/rx.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L46),
[`src/queue/used.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L31)).

The frame slice is the safety hinge. Only if the device-reported length exceeds `VIRTIO_NET_HDR_LEN` = 10
does the frame carry a payload; the payload length is the reported length minus the header, but clamped
to the buffer capacity minus the header, so a device that reports an oversized length cannot make the
driver form a slice past the RX buffer ([`src/rx.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L52)). It advances `last_used`, stashes the consumed
descriptor id in `pending_refill` to be returned on the next call, and returns a `Frame` borrowing the
payload bytes (or an empty slice when the length was header-only) ([`src/rx.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L63)). The virtio-net header
is stripped here: the caller sees only the Ethernet frame.

## Refilling RX

`refill` returns a consumed buffer to the device by writing its descriptor id into the next available-ring
slot and bumping the available index with a wrapping add ([`src/queue/refill.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/refill.rs#L23)). The one-deep
`pending_refill` in `take_one` means a buffer is not returned until the call after it was consumed, which
keeps the just-read slice valid while the handler copies it into the reply. After every `OP_RX_PACKET` the
handler re-kicks the RX queue notify so the device picks up whatever was just refilled
([`src/server/handlers/rx_packet.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L28)).

## Sending a frame

`tx::send` drives one transmit end to end ([`src/tx.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs#L31)). The wire length is the frame padded up to
`MIN_ETHERNET_FRAME` = 60 if it is shorter, plus the 10-byte virtio-net header ([`src/tx.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs#L32)).

| Step | What it does | Source |
|---|---|---|
| Backpressure | if the ring is full, yield until a slot frees or timeout | `tx.rs:39` |
| Pick slot | `next_avail % buf_count` | `tx.rs:46` |
| Zero and copy | zero the buffer, copy the frame in past the 10-byte header | `tx.rs:48` |
| Post | `post_packet(slot, total)` writes the descriptor and available ring | `tx.rs:54` |
| Notify | write `LEG_QUEUE_NOTIFY` (0x10) = `Q_TX` to kick the device | `tx.rs:56` |
| Advance | `next_avail = next_avail + 1` (the completion target) | `tx.rs:58` |
| Wait | loop until the used index reaches the target or timeout | `tx.rs:61` |
| Timeout | give up with `Timeout` after `MAX_YIELDS` = 200000 spins | `tx.rs:65` |
| Ack | `mk_irq_ack`, `IrqAck` on failure | `tx.rs:72` |

The backpressure check computes outstanding descriptors as `next_avail - used_idx` and waits while that
reaches the buffer count, so a full ring blocks rather than overwrites an in-flight buffer
([`src/tx.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs#L39)). Before copying, the buffer is zeroed so the virtio-net header and any pad bytes are
clean; the header is left all zeroes, which is valid for a legacy device with no offload features
negotiated ([`src/tx.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs#L48), [`src/queue/used.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L46)). `post_packet` writes a single device-readable
descriptor at the slot (flags 0, no `WRITE`, no `NEXT`), publishes it into the available ring at
`idx % buf_count`, and bumps the index ([`src/queue/post_packet.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post_packet.rs#L26)). The wait is a used-index poll with
a `mk_yield` between spins; on completion it records `last_used` and acknowledges the interrupt
([`src/tx.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs#L71)). A `Timeout` or a failed ack surfaces to the handler as `E_IO`
([`src/server/handlers/tx_packet.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L35)).

## The virtio-net header

Every frame on the wire, in and out, is fronted by a `VIRTIO_NET_HDR_LEN` = 10-byte virtio-net header
([`src/constants/frame.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L32)). On transmit the driver zeroes it and copies the Ethernet frame after it,
which is the legacy no-offload form ([`src/tx.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs#L48)). On receive the driver skips it: `take_one` returns a
slice starting `VIRTIO_NET_HDR_LEN` into the buffer and reports the length past it
([`src/rx.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L57)). The header never crosses the IPC boundary; clients on the [operations](/docs/userland/driver-virtio-net/operations/)
page see and send only bare Ethernet frames.

## Reading the used ring

The used-ring accessors live in [`src/queue/used.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs). `used_idx` reads the 16-bit used index at the
used-ring offset plus 2, past the flags word, and both queues share the reader
([`src/queue/used.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L27), [`src/queue/used.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L42)). `used_elem_at` reads the 8-byte used element (a 4-byte
descriptor id and a 4-byte length) at the ring position, which RX uses to find which buffer the device
filled and how much ([`src/queue/used.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L31)). `TxQueue::buffer_mut` forms the writable slice for a slot,
clamping the requested length to the per-buffer length so the copy in `send` cannot run past the TX
buffer ([`src/queue/used.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L46)).

## Source map

```
  src/queue/rx_queue.rs         the RxQueue struct, queue size, region_phys
  src/queue/tx_queue.rs         the TxQueue struct, queue size, region_phys
  src/queue/post.rs             RxQueue::prime: fill the RX ring at bring-up
  src/queue/refill.rs           RxQueue::refill: return a consumed buffer
  src/queue/post_packet.rs      TxQueue::post_packet: write a TX descriptor and publish
  src/queue/used.rs             used index, used element, and the bounded TX buffer slice
  src/queue/clear.rs            clear_region: zero a ring region before use
  src/rx.rs                     take_one: pull a frame past the virtio-net header, deferred refill
  src/tx.rs                     send: pad, zero, copy, post, notify, wait, ack
  src/constants/queue.rs        queue indices, sizes, offsets, buffer lengths, VRING_DESC_F_WRITE
  src/constants/frame.rs        VIRTIO_NET_HDR_LEN, MIN_ETHERNET_FRAME, MAX_ETHERNET_FRAME
  src/constants/regs.rs         LEG_QUEUE_NOTIFY
```

Every reference above is verified against those trees.
