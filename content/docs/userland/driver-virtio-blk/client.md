---
title: "Client operations and the NBLK protocol"
description: "This page covers the client-facing half of the driver: the wire format a client speaks, the receive loop that decodes and dispatches it, and the five operations with their bound..."
weight: 2
---
This page covers the client-facing half of the driver: the wire format a client speaks, the receive loop
that decodes and dispatches it, and the five operations with their bounds and replies. It mirrors
`src/protocol/` (the wire format) and `src/server/` (the loop and the handlers). For the device side see
the [bring-up](/docs/userland/driver-virtio-blk/bringup/) and [queue](/docs/userland/driver-virtio-blk/queue/) pages; for identity and the capability mask see the
[overview](/docs/userland/driver-virtio-blk/).

## The receive loop

`server::run` never returns. It sizes a receive buffer at `HDR_LEN + MAX_RW_PAYLOAD_BYTES` (20 + 32768) and
a transmit buffer at `RESP_HDR_LEN + STATUS_LEN + MAX_RW_PAYLOAD_BYTES`, then loops on `mk_ipc_recv`; a
non-positive length yields and retries ([`src/server/runner.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L26)). A message that decodes is dispatched on
its opcode; a message that fails to decode is answered `E_INVAL` with a zeroed request stub and the loop
continues ([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)).

| Step | What it does | Source |
|---|---|---|
| Receive | block on `mk_ipc_recv` into the rx buffer | `runner.rs:31` |
| Empty | yield and retry on a non-positive length | `runner.rs:32` |
| Decode | parse the 20-byte NBLK header | `runner.rs:37` |
| Decode failed | reply `E_INVAL` with a zeroed stub, continue | `runner.rs:40` |
| Dispatch | match `req.op` to a handler | `runner.rs:45` |
| Unknown opcode | reply `E_INVAL` | `runner.rs:51` |

The body handed to a handler is `&rx[HDR_LEN..len]`, everything after the header (`runner.rs:44`). The one
receive buffer and the one transmit buffer are reused for every request, which is consistent with the
single-request-in-flight design (`runner.rs:28`).

## The NBLK header

Every request and every reply begins with the same 20-byte header. Magic is `0x4E42_4C4B` ("NBLK"), version
is `1` ([`src/protocol/header.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L16)). The `decode_request` parser reads the fields in little-endian and
rejects a buffer that is short, has the wrong magic, or the wrong version, returning `None`
([`src/protocol/decode.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L17)); the server turns that `None` into `E_INVAL`.

| Offset | Size | Field | Source |
|---|---|---|---|
| 0 | 4 | magic `0x4E42_4C4B` | `decode.rs:21` |
| 4 | 2 | version `1` | `decode.rs:25` |
| 6 | 2 | op | `decode.rs:29` |
| 8 | 2 | flags | `decode.rs:30` |
| 10 | 2 | reserved | not read on decode |
| 12 | 4 | request_id | `decode.rs:31` |
| 16 | 4 | payload_len | `decode.rs:32` |

The `Request` struct carries only `op`, `flags`, `request_id`, and `payload_len`; magic and version are
validated and dropped ([`src/protocol/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L20)). `encode_response_header` writes the same layout back,
echoing the request's op, flags, and request_id, zeroing the reserved word, and setting the reply's
`payload_len` ([`src/protocol/encode.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L17)). A reply body is a 4-byte little-endian status word first
(`write_status`, [`src/protocol/encode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L26)), then any payload. Ok is `0`; the error codes are `E_INVAL`
(-22), `E_IO` (-5), `E_MSGSIZE` (-90), and `E_NXIO` (-6) ([`src/protocol/errno.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L16)).

The reply always goes to the fixed kernel endpoint. `reply_with_status` encodes the header, writes the
status, and sends to `KERNEL_REPLY_ENDPOINT` `0x1_0000_0008` through `mk_ipc_send`
([`src/server/error.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L20), [`src/protocol/endpoint.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L16)). The driver never chooses a reply target from the
request; every reply lands on that one endpoint, which the kernel owns.

## The five operations

The five opcodes are defined in one file ([`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16)).

| Op | Opcode | Request body | Reply payload | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | none | status word only | [`handlers/health.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L18) |
| `OP_CAPACITY` | 2 | none | status word + 8-byte sector count | [`handlers/capacity.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/capacity.rs#L22) |
| `OP_READ_BLOCKS` | 3 | 12-byte block header | status word + read bytes | [`handlers/read/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/read/handle.rs#L24) |
| `OP_WRITE_BLOCKS` | 4 | 12-byte block header + data | status word only | [`handlers/write/handle.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/write/handle.rs#L23) |
| `OP_FLUSH` | 5 | none | status word only | [`handlers/flush.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/flush.rs#L21) |

An unknown opcode is answered `E_INVAL` ([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51)).

### OP_HEALTHCHECK (1)

Liveness only. The handler writes status `0` and replies; it touches neither the device nor the queue, so a
reply proves the server loop is running ([`src/server/handlers/health.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L18)).

### OP_CAPACITY (2)

Reports the device's sector count. The handler writes status `0`, then appends the driver's cached
`capacity_sectors` as 8 little-endian bytes, for a payload of `STATUS_LEN + CAPACITY_PAYLOAD_LEN` = 12 bytes
after the header ([`src/server/handlers/capacity.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L22), [`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21)). The capacity is read
once at bring-up and cached in the `Driver`; it is not re-read per request
([`src/setup/sequence.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L50), [`src/setup/driver.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L22)).

### OP_READ_BLOCKS (3)

The 12-byte block header is `lba` (u64 at offset 0) then `nsectors` (u32 at offset 8)
([`src/server/handlers/read/request.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L36)). The parser enforces the bounds before any DMA: the body must be
at least `READ_REQ_LEN` (12) and `payload_len` must equal 12, else `E_MSGSIZE`; `nsectors` must be non-zero
and at most `MAX_SECTORS_PER_REQUEST` = 64, else `E_INVAL`; and `lba + nsectors` must not exceed
`capacity_sectors`, else `E_NXIO`, with the addition itself `checked_add` so an overflow is `E_INVAL`
([`src/server/handlers/read/request.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L33), [`src/constants/queue.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L22)). On a valid request the handler
submits a read to the device, then copies `nsectors * 512` bytes out of the DMA data buffer into the reply
after the status word ([`src/server/handlers/read/handle.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/handle.rs#L32), [`src/server/handlers/read/reply.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/reply.rs#L22)).
Device `Unsupported` maps to `E_INVAL`, any other submit error to `E_IO`
([`src/server/handlers/read/handle.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/handle.rs#L42)).

### OP_WRITE_BLOCKS (4)

Same 12-byte header, followed by the data to write. The parser requires the body to be exactly
`RW_HEADER_LEN + nsectors * 512` bytes and `payload_len` to match, else `E_MSGSIZE`; the `nsectors` and
capacity bounds are identical to read ([`src/server/handlers/write/request.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write/request.rs#L42)). The handler copies the
body's data region into the DMA buffer, submits a write, and replies with the status word alone
([`src/server/handlers/write/handle.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write/handle.rs#L31)). Ok is `0`, `Unsupported` is `E_INVAL`, any other error is `E_IO`.

### OP_FLUSH (5)

Forces a device flush. The handler submits a flush with `lba` and `nsectors` both zero and replies with the
status word ([`src/server/handlers/flush.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L22)). Flush is only meaningful if the device advertised the
flush feature at negotiation; a device that reports the request unsupported yields `E_INVAL`, any other
failure `E_IO` ([`src/server/handlers/flush.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L23)).

## Handler shape

The two simple ops (health, capacity) and the two status-only ops (write, flush) are one file each; read
and write are a directory with `handle.rs`, `request.rs`, and, for read, `reply.rs`, splitting parse from
submit from reply ([`src/server/handlers/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L16)). A parse function returns `Result<_, i32>` where the
error is the negative errno to reply with, and the handler turns a parse error straight into a
`reply_with_status` ([`src/server/handlers/read/handle.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/handle.rs#L27)). This keeps every bounds check in one place,
ahead of any DMA, which is the property the [overview](/docs/userland/driver-virtio-blk/#isolation) leans on.

The payload-carrying replies (capacity, read) build the reply in place in the tx buffer and send the exact
length rather than the whole buffer: capacity sends `RESP_HDR_LEN + STATUS_LEN + CAPACITY_PAYLOAD_LEN`
([`src/server/handlers/capacity.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L29)), read sends `RESP_HDR_LEN + STATUS_LEN + bytes_n`
([`src/server/handlers/read/reply.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/reply.rs#L28)). The read reply slices the DMA buffer through
`queue.data(bytes_n)`, which itself clamps to the buffer length, so the copy can never read past the
mapping ([`src/server/handlers/read/reply.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/reply.rs#L26), [`src/queue/used.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L27)).

## Source map

```
  src/protocol/header.rs      the 20-byte NBLK header, magic, version, Request struct
  src/protocol/decode.rs      decode_request and the little-endian field readers
  src/protocol/encode.rs      encode_response_header and write_status
  src/protocol/errno.rs       E_INVAL, E_IO, E_MSGSIZE, E_NXIO
  src/protocol/ops.rs         the five opcodes
  src/protocol/limits.rs      STATUS_LEN, RW_HEADER_LEN, READ_REQ_LEN, payload ceilings
  src/protocol/endpoint.rs    KERNEL_REPLY_ENDPOINT
  src/protocol/mod.rs         the protocol re-exports
  src/server/runner.rs        the receive loop and opcode dispatch
  src/server/error.rs         reply_with_status and reply_decode_failed
  src/server/handlers/health.rs    OP_HEALTHCHECK
  src/server/handlers/capacity.rs  OP_CAPACITY
  src/server/handlers/read/        OP_READ_BLOCKS: handle, request, reply
  src/server/handlers/write/       OP_WRITE_BLOCKS: handle, request
  src/server/handlers/flush.rs     OP_FLUSH
  src/constants/queue.rs      MAX_SECTORS_PER_REQUEST, SECTOR_SIZE
```

Every reference above is verified against those trees.
