---
title: "The virtqueue request and DMA engine"
description: "This page covers how a parsed request becomes a device transaction: the split-virtqueue layout, the header/data/status descriptor chain, the available-ring publish, and the noti..."
weight: 3
---
This page covers how a parsed request becomes a device transaction: the split-virtqueue layout, the
header/data/status descriptor chain, the available-ring publish, and the notify/wait/ack completion path. It
mirrors `src/queue/` (building and reading the ring) and `src/io/` (submitting and waiting). The client
protocol that feeds it is on the [client](/docs/userland/driver-virtio-blk/client/) page; the one-time queue setup that programs the ring
into the device is on the [bring-up](/docs/userland/driver-virtio-blk/bringup/) page.

## Queue state and layout

The `Queue` struct holds the region base, the queue size, the available and used ring offsets, the header
and data buffer pointers with their device physical addresses, the data buffer length, and the last used
index the driver has consumed ([`src/queue/layout.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L18)). `Queue::new` computes the ring offsets from the
negotiated queue size and zeroes the whole region before use ([`src/queue/layout.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L32)).

The region is a legacy split virtqueue laid out in one contiguous DMA region:

- the descriptor table at offset `VQ_DESC_OFFSET` = 0 ([`src/constants/queue.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L19));
- the available ring right after the descriptor table, at `VQ_DESC_OFFSET + queue_size * 16`
  ([`src/queue/layout.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L66));
- the used ring page-aligned after the available ring, at `align_up(avail + 6 + queue_size * 2, 4096)`
  ([`src/queue/layout.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L69)).

The whole region is `VQ_REGION_SIZE` = 16384 bytes ([`src/constants/queue.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L20)), which holds the largest
supported ring (256 entries) plus the page-aligned used ring. The driver uses a single request in flight, so
it always builds the chain from descriptor 0 and never manages a free-descriptor list.

## The request header

`post_request` is the entry point: it writes the request header, builds the descriptor chain, and publishes
the chain, all under one `unsafe` block ([`src/queue/post.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L23)). The header is a 16-byte virtio-blk request
header at header-buffer offset `HEADER_OFFSET` = 0: a 32-bit request type, a reserved 32-bit word, and the
64-bit LBA ([`src/queue/post/header.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/header.rs#L21), [`src/constants/queue.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L23)). The request type comes from the
`Direction`: `VIRTIO_BLK_T_IN` (0) for read, `VIRTIO_BLK_T_OUT` (1) for write, `VIRTIO_BLK_T_FLUSH` (4) for
flush ([`src/queue/post/direction.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/direction.rs#L24), [`src/constants/request.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/request.rs#L16)). The status byte at
`STATUS_OFFSET` = 64 is pre-set to `0xFF` before submission, so a device that never writes it back is
distinguishable from `S_OK` = 0 ([`src/queue/post/header.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/header.rs#L26), [`src/constants/queue.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L25)).

## The descriptor chain

`write_descriptor_chain` builds the chain from the descriptor table base, which is the region base plus
`VQ_DESC_OFFSET` ([`src/queue/post/descriptors.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L28)). Each descriptor is 16 bytes: an 8-byte physical
address, a 4-byte length, a 2-byte flags word, and a 2-byte next index ([`src/queue/post/descriptors.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L39)).
The chain is header, optional data, status.

| Descriptor | Points at | Length | Flags | Next | Source |
|---|---|---|---|---|---|
| 0 header | header buffer + `HEADER_OFFSET` | 16 | `NEXT` | 1 | `descriptors.rs:39` |
| 1 data (read/write) | data buffer | `nsectors * 512` | read: `NEXT | WRITE`; write: `NEXT` | 2 | `descriptors.rs:45` |
| status | header buffer + `STATUS_OFFSET` | 1 | `WRITE` | 0 | `descriptors.rs:57` |

For a flush the data descriptor is omitted entirely: the header chains straight to the status descriptor
written at descriptor slot 1 ([`src/queue/post/descriptors.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L32)). For read and write the data descriptor is
slot 1 and the status descriptor is slot 2 ([`src/queue/post/descriptors.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L36)). The read case sets
`VRING_DESC_F_WRITE` (2) on the data descriptor so the device fills the buffer; write leaves it
device-readable with only `VRING_DESC_F_NEXT` (1) ([`src/queue/post/descriptors.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L47),
[`src/constants/queue.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L17)). The data length is `nsectors.saturating_mul(SECTOR_SIZE)`, so an implausible
sector count saturates rather than wrapping ([`src/queue/post/descriptors.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L46)). The status descriptor is
always device-writable and always the tail with next index 0 ([`src/queue/post/descriptors.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L60)).

## Publishing the chain

`publish_avail` hands the chain to the device by bumping the available ring
([`src/queue/post/publish.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/publish.rs#L19)). The available ring is `[flags: u16, idx: u16, ring: [u16; queue_size]]`.
The handler writes the ring flags to 0, reads the current index, writes descriptor 0 into the ring slot at
`idx % queue_size`, then increments the index with a wrapping add ([`src/queue/post/publish.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/publish.rs#L22)). Because
the driver runs one request at a time, the slot the chain occupies always references descriptor 0.

## Submit, wait, ack

`submit` drives one request end to end ([`src/io/submit.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/submit.rs#L27)). It posts the chain, kicks the device with a
single write to the queue-notify register, then waits for completion.

| Step | What it does | Source |
|---|---|---|
| Post | `queue.post_request(dir, lba, nsectors)` | `submit.rs:35` |
| Notify | write `LEG_QUEUE_NOTIFY` (0x10) = 0 to kick the device | `submit.rs:36` |
| Snapshot IRQ | read the interrupt sequence via `mk_irq_poll` | `submit.rs:37` |
| Wait | loop until used index reaches target or IRQ sequence changes | `submit.rs:40` |
| Timeout | give up with `Timeout` after `MAX_YIELDS` = 200000 spins | `submit.rs:44` |
| Yield | `mk_yield` between polls, `Io` on a yield failure | `submit.rs:47` |
| Read status | read the device's status byte | `submit.rs:53` |
| Ack | `mk_irq_ack`, `Io` on failure | `submit.rs:54` |
| Map result | `S_OK` -> Ok, `S_IOERR` -> Io, `S_UNSUPP` -> Unsupported, else Io | `submit.rs:57` |

The wait is IRQ-driven with a used-ring fallback. It snapshots the interrupt sequence, computes the target
used index as `last_used + 1`, and breaks as soon as either the used index reaches the target or the
interrupt sequence advances, so a missed or coalesced interrupt still completes through the ring poll
([`src/io/submit.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/submit.rs#L38), [`src/io/read_seq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/read_seq.rs#L19)). On completion it records the new `last_used`, reads the
status byte the device wrote into the header buffer at `STATUS_OFFSET`, acknowledges the interrupt, and maps
`VIRTIO_BLK_S_OK` (0) to success, `S_IOERR` (1) to `Io`, and `S_UNSUPP` (2) to `Unsupported`, with any other
byte treated as `Io` ([`src/io/submit.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/submit.rs#L52), [`src/queue/used.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L24), [`src/constants/request.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/request.rs#L19)).

## Reading the result

The used-ring and status accessors live in [`src/queue/used.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs). `used_idx` reads the 16-bit used index at
the used-ring offset plus 2 (past the flags word) ([`src/queue/used.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L21)). `status_byte` reads the device's
status byte back from the header buffer ([`src/queue/used.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L24)). The data accessors are the safety hinge:
`data` and `data_mut` both clamp the requested length to the buffer's own `data_len` before forming the
slice, so a caller asking for more than the buffer holds gets a slice bounded to the mapping rather than one
that walks past it ([`src/queue/used.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L27)). The read handler copies out through `data`, so an over-large
length can never overrun the DMA region ([client](/docs/userland/driver-virtio-blk/client/)).

## Source map

```
  src/queue/layout.rs           the Queue struct, ring offsets, and the region zero
  src/queue/post.rs             post_request: header, chain, publish
  src/queue/post/header.rs      the 16-byte virtio-blk request header and the 0xFF status pre-set
  src/queue/post/direction.rs   Direction and its virtio request type
  src/queue/post/descriptors.rs the header/data/status descriptor chain
  src/queue/post/publish.rs     the available-ring bump
  src/queue/used.rs             used index, status byte, and bounded data access
  src/io/submit.rs              submit: notify, IRQ-poll wait with used-ring fallback, ack, result map
  src/io/read_seq.rs            mk_irq_poll wrapper for the interrupt sequence
  src/io/error.rs               BlkError: Io, Unsupported, Timeout
  src/constants/queue.rs        region size, offsets, sector size, descriptor flags
  src/constants/request.rs      the virtio-blk request types and status codes
  src/constants/regs.rs         LEG_QUEUE_NOTIFY
```

Every reference above is verified against those trees.
