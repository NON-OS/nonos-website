---
title: "Client operations and the NNET protocol"
description: "This page covers the client-facing half of the driver: the wire format a client speaks, the receive loop that decodes and dispatches it, and the five operations with their bound..."
weight: 3
---
This page covers the client-facing half of the driver: the wire format a client speaks, the receive
loop that decodes and dispatches it, and the five operations with their bounds and replies. It mirrors
`src/protocol/` (the wire format) and `src/server/` (the loop and the handlers). For the device side see
the [bring-up](/docs/userland/driver-virtio-net/bringup/) and [queues](/docs/userland/driver-virtio-net/queues/) pages; for identity and the capability mask see the
[overview](/docs/userland/driver-virtio-net/).

## The receive loop

`server::run` never returns. It sizes a receive buffer at `HDR_LEN + MAX_ETHERNET_FRAME` (20 + 1514)
and a transmit buffer large enough for the widest reply, `RESP_HDR_LEN + STATUS_LEN + RX_PAYLOAD_PREFIX_LEN
+ VIRTIO_NET_HDR_LEN + MAX_ETHERNET_FRAME`, then loops on `mk_ipc_recv_from` ([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)).
Unlike a fixed-endpoint server, `mk_ipc_recv_from` returns the sender's pid, and every reply goes back to
that pid; the driver never chooses a reply target from the message body.

| Step | What it does | Source |
|---|---|---|
| Receive | block on `mk_ipc_recv_from` into the rx buffer, capturing `sender_pid` | `runner.rs:44` |
| Empty | continue on a non-positive length or a zero sender pid | `runner.rs:45` |
| Decode | parse the 20-byte NNET header | `runner.rs:49` |
| Decode failed | reply `E_INVAL` with a zeroed stub, continue | `runner.rs:52` |
| Dispatch | match `req.op` to a handler | `runner.rs:57` |
| Unknown opcode | reply `E_INVAL` | `runner.rs:63` |

The body handed to the transmit handler is `&rx[HDR_LEN..len]`, everything after the header
(`runner.rs:56`). The one receive buffer and the one transmit buffer are reused for every request, which
is consistent with the one-request-at-a-time server (`runner.rs:39`).

## The NNET header

Every request and every reply begins with the same 20-byte header. Magic is `0x4E4E_4554` ("NNET"),
version is `1` ([`src/protocol/header.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L30)). The `decode_request` parser reads the fields in
little-endian and rejects a buffer that is short, has the wrong magic, or the wrong version, returning
`None` ([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23)); the server turns that `None` into `E_INVAL`.

| Offset | Size | Field | Source |
|---|---|---|---|
| 0 | 4 | magic `0x4E4E_4554` | `decode.rs:27` |
| 4 | 2 | version `1` | `decode.rs:31` |
| 6 | 2 | op | `decode.rs:35` |
| 8 | 2 | flags | `decode.rs:36` |
| 10 | 2 | reserved | not read on decode |
| 12 | 4 | request_id | `decode.rs:37` |
| 16 | 4 | payload_len | `decode.rs:38` |

The `Request` struct carries only `op`, `flags`, `request_id`, and `payload_len`; magic and version are
validated and dropped ([`src/protocol/header.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L36)). `encode_response_header` writes the same layout
back, echoing the request's op and flags, zeroing the reserved word, carrying the request_id, and
setting the reply's `payload_len` ([`src/protocol/encode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L24)). A reply body is a 4-byte little-endian
status word first (`write_status`, [`src/protocol/encode.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L34)), then any payload. Ok is `0`; the error
codes are `E_INVAL` (-22), `E_IO` (-5), `E_AGAIN` (-11), and `E_MSGSIZE` (-90) ([`src/protocol/errno.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L24)).

Every reply is sent with `mk_ipc_reply` to the pid that `mk_ipc_recv_from` reported
([`src/server/error.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L24)). `reply_with_status` encodes the header, writes the status, and sends a
`RESP_HDR_LEN + STATUS_LEN` reply; `reply_decode_failed` does the same with a zeroed request stub for a
message that never parsed ([`src/server/error.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L27), [`src/server/error.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L33)).

## The five operations

The five opcodes are defined in one file ([`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21)).

| Op | Opcode | Request body | Reply payload | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | none | status word only | [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_LINK_STATUS` | 2 | none | status word + 1-byte link flag | [`handlers/link_status.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/link_status.rs#L24) |
| `OP_MAC_ADDRESS` | 3 | none | status word + 6-byte MAC | [`handlers/mac_address.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mac_address.rs#L23) |
| `OP_TX_PACKET` | 4 | one Ethernet frame | status word only | [`handlers/tx_packet.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/tx_packet.rs#L23) |
| `OP_RX_PACKET` | 5 | none | status word + 4-byte length + frame | [`handlers/rx_packet.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/rx_packet.rs#L26) |

An unknown opcode is answered `E_INVAL` ([`src/server/runner.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L63)).

### OP_HEALTHCHECK (1)

Liveness only. The handler writes status `0` and replies; it touches neither the device nor the queues,
so a reply proves the server loop is running ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)).

### OP_LINK_STATUS (2)

Reports whether the link is up. If the device negotiated `VIRTIO_NET_F_STATUS`, the handler reads the
16-bit net-config status word at the driver's cached `net_status_offset` and tests `VIRTIO_NET_S_LINK_UP`
(1); if the feature was not negotiated it reports the link up unconditionally
([`src/server/handlers/link_status.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L25), [`src/constants/regs.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L37)). The reply is the status word
followed by one byte, `1` for up and `0` for down (`link_status.rs:34`). The status offset is computed
once at bring-up as the config base plus 6, where the config base shifts by 4 when MSI-X is in use
([`src/setup/sequence.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L42), [`src/setup/sequence.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L70)).

### OP_MAC_ADDRESS (3)

Reports the device MAC. The handler writes status `0`, then copies the driver's cached 6-byte MAC after
the status word ([`src/server/handlers/mac_address.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L27)). The MAC is read once at bring-up from the
legacy config MAC register, and only if `VIRTIO_NET_F_MAC` was negotiated; otherwise it is all zeroes
([`src/setup/config.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/config.rs#L24), [`src/constants/regs.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L33)).

### OP_TX_PACKET (4)

Transmit one Ethernet frame. The body is the frame, and the parser enforces three bounds before any DMA:
`payload_len` must equal the body length, else `E_MSGSIZE`; the body must be non-empty and no larger than
`MAX_ETHERNET_FRAME` = 1514, else `E_INVAL`; and it must not exceed `MAX_TX_PAYLOAD_BYTES` (also 1514),
else `E_MSGSIZE` ([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24)). On a valid request the handler calls `tx::send`,
which copies the frame behind a virtio-net header into the next TX slot, notifies the device, and waits
for completion; success replies status `0` and any send error replies `E_IO` (`tx_packet.rs:33`). The
transmit path is on the [queues](/docs/userland/driver-virtio-net/queues/) page.

### OP_RX_PACKET (5)

Poll one received frame. The handler pulls a frame with `rx::take_one` and re-kicks the RX queue notify,
then, if a frame was available, replies with the status word, a 4-byte little-endian length prefix, and
the frame bytes ([`src/server/handlers/rx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L27)). An empty ring is not an error: it replies
`E_AGAIN` so the caller polls again (`rx_packet.rs:34`). The frame length in the prefix is the payload
past the virtio-net header, and the frame slice is bounded to the RX buffer by `take_one` before it
reaches the handler ([`src/rx.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L52)). net_core drives this op in its poll loop, treating a non-zero
status as no-frame ([`userland/capsule_net_core/src/device/rx.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_core/src/device/rx.rs#L45)).

## Reply shape

The two config replies (link, mac) and the frame reply build the payload in place in the tx buffer and
send the exact length, not the whole buffer. Link sends `RESP_HDR_LEN + STATUS_LEN + LINK_STATUS_PAYLOAD_LEN`
([`src/server/handlers/link_status.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L35)), mac sends `RESP_HDR_LEN + STATUS_LEN + MAC_ADDRESS_PAYLOAD_LEN`
([`src/server/handlers/mac_address.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L29)), and rx sends `RESP_HDR_LEN + STATUS_LEN + RX_PAYLOAD_PREFIX_LEN
+ frame_len` ([`src/server/handlers/rx_packet.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L47)). The status-only replies (health, tx, and every
error) go through `reply_with_status`, which always sends `RESP_HDR_LEN + STATUS_LEN`
([`src/server/error.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L30)). The layout constants live in one file, keyed off the frame constants
([`src/protocol/limits.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L26)).

## Source map

```
  src/protocol/header.rs      the 20-byte NNET header, magic, version, Request struct
  src/protocol/decode.rs      decode_request and the little-endian field readers
  src/protocol/encode.rs      encode_response_header and write_status
  src/protocol/errno.rs       E_INVAL, E_IO, E_AGAIN, E_MSGSIZE
  src/protocol/ops.rs         the five opcodes
  src/protocol/limits.rs      STATUS_LEN, the payload-length and prefix constants
  src/protocol/mod.rs         the protocol re-exports
  src/server/runner.rs        the receive loop and opcode dispatch
  src/server/error.rs         reply, reply_with_status, reply_decode_failed
  src/server/handlers/health.rs       OP_HEALTHCHECK
  src/server/handlers/link_status.rs  OP_LINK_STATUS
  src/server/handlers/mac_address.rs  OP_MAC_ADDRESS
  src/server/handlers/tx_packet.rs    OP_TX_PACKET
  src/server/handlers/rx_packet.rs    OP_RX_PACKET
  src/constants/frame.rs      MAX_ETHERNET_FRAME, MAC_LEN, VIRTIO_NET_HDR_LEN
  src/constants/regs.rs       VIRTIO_NET_S_LINK_UP
  userland/capsule_net_core/src/device/    the net_core rx/tx callers of these ops
```

Every reference above is verified against those trees.
