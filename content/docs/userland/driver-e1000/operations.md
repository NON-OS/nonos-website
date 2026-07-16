---
title: "Client operations and the NE10 protocol"
description: "Everything a client can ask the e1000 driver for crosses one boundary: the NE10 binary protocol over IPC."
weight: 6
---
Everything a client can ask the e1000 driver for crosses one boundary: the `NE10` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional payload, the server decodes and
dispatches it on a 16-bit opcode, and a handler encodes a 20-byte response header, a 4-byte status word,
and, for the data-bearing ops, a payload. For the identity table and the capability mask see the
[README](/docs/userland/driver-e1000/); for how the frame handlers reach the rings see the [queues](/docs/userland/driver-e1000/queues/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)). The
decoder rejects anything shorter than the header, a wrong magic, or a wrong version, returning `None` so the
loop answers `E_INVAL` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L49)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E45_3130` ("NE10") (`header.rs:17`) |
| version | 4 | u16 | `VERSION = 1` (`header.rs:18`) |
| op | 6 | u16 | the opcode (`decode.rs:31`) |
| flags | 8 | u16 | request flags, echoed into the reply (`decode.rs:32`) |
| request_id | 12 | u32 | echoed into the response header (`decode.rs:33`) |
| payload_len | 16 | u32 | request payload length in bytes (`decode.rs:34`) |

Every reply is a response header of the same length (`RESP_HDR_LEN = HDR_LEN = 20`), followed by a 4-byte
little-endian status word, then any payload ([`src/protocol/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L20), [`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24)). The
response header echoes the request's op, flags, and request_id so the kernel client can match the reply, and
carries the reply's payload length ([`src/protocol/encode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L24)). Status `0` means success; a negative
status is one of the errno constants below. Replies go to the kernel reply endpoint `0x1_0000_000C` with
`mk_ipc_send` ([`src/server/error.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L30), [`src/protocol/endpoint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L22)).

## The request loop

`server::run` sizes one receive buffer to the header plus the maximum Ethernet frame and one transmit buffer
to the response header, the status word, and the larger of the receive payload (a 4-byte length prefix plus
a frame) or the stats record, so a single receive holds the largest transmit frame and a single send holds
the largest received frame or the stats snapshot ([`src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L34)). The loop blocks on
`mk_ipc_recv`, skips a receive of zero or fewer bytes, decodes the header, and dispatches
([`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42)). A decode failure answers `E_INVAL` without touching the device
([`src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L50)).

Before dispatch, the loop enforces one envelope invariant: the declared `payload_len` plus the header must
equal the number of bytes actually received, or the request is refused with `E_MSGSIZE`
([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54)). Only then is the body sliced and the op routed. An unrecognised opcode is
answered with `E_INVAL` ([`src/server/runner.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L67)).

## The six operations

The opcodes are defined in [`src/protocol/ops.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L23) and dispatched in [`src/server/runner.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L60).

| Op | Opcode | Request payload | Reply payload after status | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`src/server/handlers/health.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L22) |
| `OP_LINK_STATUS` | `2` | none | 1 byte, `1` up / `0` down | [`src/server/handlers/link_status.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L32) |
| `OP_MAC_ADDRESS` | `3` | none | 6 bytes, the hardware MAC | [`src/server/handlers/mac_address.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L29) |
| `OP_TX_PACKET` | `4` | one Ethernet frame | none (status only) | [`src/server/handlers/tx_packet.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L26) |
| `OP_RX_PACKET` | `5` | none | 4-byte length prefix then the frame | [`src/server/handlers/rx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L27) |
| `OP_STATS` | `6` | none | 48-byte register/ring snapshot | [`src/server/handlers/stats.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L27) |

The kernel-side network client calls only ops 1 through 5 ([`src/hardware/e1000_capsule/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/protocol/ops.rs#L21));
`OP_STATS` is a capsule-side telemetry op with no kernel caller yet, noted on the [README](/docs/userland/driver-e1000/).

## Payload detail on the data ops

- `OP_LINK_STATUS` reads the live `STATUS.LU` bit and returns one byte, `1` if link is up and `0` if down.
  The register is sampled on every call, so a topology change between two probes is observable to the client
  ([`src/server/handlers/link_status.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L36), [`src/constants/status.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L22)).
- `OP_MAC_ADDRESS` returns the six bytes the driver cached from the EEPROM at bring-up
  ([`src/server/handlers/mac_address.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L33); read at [`src/init/eeprom.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/eeprom.rs#L28)). The kernel client treats an
  all-zero MAC as a hard error so a misprogrammed receive-address pair never silently passes validation.
- `OP_TX_PACKET` copies the request frame into the next TX buffer, posts a descriptor, rings the tail
  doorbell, and polls the per-descriptor done bit before replying success; it replies `E_IO` if the
  descriptor never completes within the poll budget ([`src/server/handlers/tx_packet.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L38); the ring is on
  the [queues](/docs/userland/driver-e1000/queues/) page).
- `OP_RX_PACKET` consumes the next completed receive descriptor. On a good frame it writes a 4-byte
  little-endian length prefix then the frame bytes and replies success; on an empty ring it replies
  `E_AGAIN`; on a descriptor the ring flagged bad (wrong end-of-packet, error bits, or an out-of-bound
  length) it recycles the descriptor and replies `E_IO` ([`src/server/handlers/rx_packet.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L28),
  [`src/queue/rx.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L47)).
- `OP_STATS` reads seven live registers (`STATUS`, `RCTL`, `TCTL`, `RDH`, `RDT`, `TDH`, `TDT`) and appends
  the RX head cursor, the TX tail cursor, the RX and TX descriptor counts, and one reserved zero word,
  packing twelve little-endian `u32` values into the 48-byte record ([`src/server/handlers/stats.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L38),
  [`src/protocol/limits.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L29)). It is side-effect-free.

## The error set

All errno words are little-endian negatives ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_INVAL   -22   bad op, a malformed header, or a frame outside the 60..1514 size window
  E_IO       -5   a TX completion never landed, or an RX descriptor was flagged bad
  E_AGAIN   -11   OP_RX_PACKET found the receive ring empty
  E_MSGSIZE -90   the declared payload_len did not match the received body length
```

`E_AGAIN` is the normal "queue empty" path for `OP_RX_PACKET`; the kernel client surfaces it as an empty
receive rather than a hard error, using the same errno-to-error mapper for every NIC capsule
([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

## Frame bounds

The transmit handler validates before touching the device. It first re-checks that the declared
`payload_len` equals the received body, then rejects any frame shorter than `MIN_ETHERNET_FRAME` (60 bytes)
or longer than `MAX_ETHERNET_FRAME` (1514 bytes, the 1500-byte MTU plus the 14-byte Ethernet header) with
`E_INVAL`, so a misbehaving caller cannot drive the TX DMA buffer past its 2048-byte slot
([`src/server/handlers/tx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L27), [`src/constants/frame.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L26)). Only a frame inside that window is
copied into the buffer and posted. On the receive side the ring itself bounds the length: a descriptor whose
reported length is zero or above `MAX_ETHERNET_FRAME` is treated as bad and never copied out
([`src/queue/rx.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L59)).

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
rejects anything malformed with `E_INVAL` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). The envelope-length check means a
client cannot under- or over-declare its payload ([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54)), and the transmit handler bounds
the frame size to the legal Ethernet window before it copies anything into the DMA buffer
([`src/server/handlers/tx_packet.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L31)). The receive path never trusts the device length: it clamps against
`MAX_ETHERNET_FRAME` and drops any frame the hardware flagged with an error before it leaves the capsule
([`src/queue/rx.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L59)). There is no panic path: the crate is `panic = "abort"` and every handler returns an
errno word instead of unwinding (`Cargo.toml:29`). A client that wants frame transport must hold the
capability to reach `driver.e1000_0` and speak this protocol; it never gets a handle to the controller.

## Source map

```
  userland/capsule_driver_e1000/src/protocol/header.rs     MAGIC, VERSION, HDR_LEN, the Request struct
  userland/capsule_driver_e1000/src/protocol/decode.rs     decode_request: magic/version check, field parse
  userland/capsule_driver_e1000/src/protocol/encode.rs     the response-header and status-word encoders
  userland/capsule_driver_e1000/src/protocol/ops.rs        the six opcode constants
  userland/capsule_driver_e1000/src/protocol/errno.rs      E_INVAL, E_IO, E_AGAIN, E_MSGSIZE
  userland/capsule_driver_e1000/src/protocol/limits.rs     the fixed per-op payload sizes
  userland/capsule_driver_e1000/src/protocol/endpoint.rs   KERNEL_REPLY_ENDPOINT
  userland/capsule_driver_e1000/src/server/runner.rs       the receive/decode/envelope/dispatch loop
  userland/capsule_driver_e1000/src/server/error.rs        reply_with_status and reply_decode_failed
  userland/capsule_driver_e1000/src/server/handlers/       one file per op: health, link_status, mac_address, tx_packet, rx_packet, stats
  userland/capsule_driver_e1000/src/constants/frame.rs     the 60..1514 Ethernet size window
  userland/capsule_driver_e1000/Cargo.toml                 panic = "abort"
  src/hardware/e1000_capsule/protocol/ops.rs               the kernel client's op set (1 through 5)
  src/capabilities/types.rs                                the capability bits the mask decodes into
```

Every reference above is verified against those trees.
