---
title: "Client operations and the NR69 protocol"
description: "Everything a client can ask the RTL8169 driver for crosses one boundary: the NR69 binary protocol over IPC."
weight: 4
---
Everything a client can ask the RTL8169 driver for crosses one boundary: the `NR69` binary protocol over
IPC. This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional body, the server decodes and
dispatches it on a 16-bit opcode, and a handler encodes a 20-byte response header, a 4-byte status word,
and, for the data-bearing ops, a payload. For the identity table and the capability mask see the
[README](/docs/userland/driver-rtl8169/); for how the handlers reach the device see the [bring-up](/docs/userland/driver-rtl8169/bring-up/) and
[rings](/docs/userland/driver-rtl8169/rings/) pages.

## The wire format

A request header is 20 bytes and begins with a magic and a version ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)). The magic
is `0x4E52_3639`, the ASCII `NR69`, and the version is `1` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17),
[`src/protocol/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L18)). The decoder rejects anything shorter than the header, a wrong magic, or a
wrong version, returning `None` so the server answers `E_INVAL` ([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20),
[`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E52_3639` ("NR69") (`decode.rs:23`) |
| version | 4 | u16 | `VERSION = 1` (`decode.rs:24`) |
| op | 6 | u16 | the opcode (`decode.rs:28`) |
| flags | 8 | u16 | request flags, echoed into the reply (`decode.rs:29`) |
| request_id | 12 | u32 | echoed into the response header (`decode.rs:30`) |
| payload_len | 16 | u32 | request payload length in bytes (`decode.rs:31`) |

Bytes 10 and 11 are not read on the request; the encoder writes them as a zero reserved u16 in the reply
([`src/protocol/encode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L24)). Every reply is a response header of the same length (`RESP_HDR_LEN = HDR_LEN
= 20`), followed by a 4-byte little-endian status word, then any payload ([`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19),
[`src/server/error.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L24)). Status `0` means success; a negative status is one of the errno constants below.
Replies go to the kernel reply endpoint `0x1_0000_000E` with `mk_ipc_send` ([`src/server/error.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L26),
[`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17)).

## The request loop

`server::run` sizes one receive buffer to the header plus the maximum Ethernet frame, and one transmit
buffer to the response header, the status word, and the larger of an RX reply (a 4-byte length prefix plus a
full frame) and the stats payload, so a single receive holds the largest transmit request and a single send
holds the largest received frame ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)). The loop receives a request on the service
inbox, skips a receive of zero or fewer bytes, decodes it, and dispatches ([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)). A
decode failure answers `E_INVAL` through `reply_decode_failed`, which sends a status-only reply with a
zeroed request record, without touching the device ([`src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L48),
[`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)).

Unlike the NVMe driver, the server loop does not poll an interrupt: it blocks in `mk_ipc_recv` on the
service inbox ([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)). The interrupt the driver binds at bring-up is acknowledged inside
the receive path ([`src/rx/recv_one.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L38)), not waited on in the loop.

## The six operations

The opcodes are defined in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and dispatched in [`src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L53). They match
the kernel-side client mirror one for one ([`src/hardware/rtl8169_capsule/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8169_capsule/protocol/ops.rs#L17)).

| Op | Opcode | Request payload | Reply payload after status | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L20) |
| `OP_LINK_STATUS` | `2` | none | 1-byte link flag | [`server/handlers/link_status.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/link_status.rs#L26) |
| `OP_MAC_ADDRESS` | `3` | none | 6-byte MAC | [`server/handlers/mac_address.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/mac_address.rs#L25) |
| `OP_TX_PACKET` | `4` | one Ethernet frame | none (status only) | [`server/handlers/tx_packet.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/tx_packet.rs#L23) |
| `OP_RX_PACKET` | `5` | none | 4-byte length prefix plus frame bytes | [`server/handlers/rx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/rx_packet.rs#L27) |
| `OP_STATS` | `6` | none | 48-byte register/cursor snapshot | [`server/handlers/stats.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/stats.rs#L29) |

An unrecognised opcode is answered with `E_INVAL` ([`src/server/runner.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L60)).

## Payload detail on each op

- `OP_HEALTHCHECK` replies with the response header and a zero status word alone; it is pure liveness and
  reads no register ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20), delegating to `reply_with_status`).
- `OP_LINK_STATUS` reads the PHY status register live, masks the link-up bit, and returns `1` if the link is
  up or `0` if it is down after the status word ([`src/server/handlers/link_status.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L27); the bit is
  `PHY_STATUS_LINK_UP = 1 << 1` at register `0x6C`, [`src/constants/regs.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L26), [`src/constants/regs.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L38)).
  Link down is an ordinary reported state, not an error.
- `OP_MAC_ADDRESS` copies the six MAC bytes the driver read once at bring-up into the reply
  ([`src/server/handlers/mac_address.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L29); the bytes are cached in `driver.mac`, read at
  [`src/init/mac.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac.rs#L21)).
- `OP_TX_PACKET` validates the frame and transmits it; the reply is a status word only (see the bounds
  below).
- `OP_RX_PACKET` polls the receive ring for one frame. On a frame it writes the frame length as a
  little-endian u32 prefix, then the frame bytes, and replies success; an empty ring replies `E_AGAIN`; a
  descriptor or interrupt error replies `E_IO` ([`src/server/handlers/rx_packet.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L29)).
- `OP_STATS` returns a non-mutating snapshot: twelve little-endian `u32` fields, `48` bytes total
  ([`src/server/handlers/stats.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L30), [`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24)). The fields are the command register, PHY
  status, ISR, IMR, RX config, TX config, RMS, the software `rx_cur` and `tx_cur` cursors, the RX and TX
  descriptor counts, and one reserved zero ([`src/server/handlers/stats.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L40)). It reads only registers that
  do not clear on access.

## The TX bounds

`OP_TX_PACKET` validates before touching the device ([`src/server/handlers/tx_packet.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L23)). It first
requires the header's `payload_len` field to equal the received body length, answering `E_MSGSIZE` on a
mismatch (`tx_packet.rs:24`). It then requires the body to be a valid Ethernet frame: at least
`MIN_ETHERNET_FRAME` (60) bytes, at most `MAX_ETHERNET_FRAME` (1514) bytes, and no larger than
`MAX_TX_PAYLOAD_BYTES` (also 1514), answering `E_INVAL` otherwise (`tx_packet.rs:28`;
[`src/constants/frame.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L21), [`src/constants/frame.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L22), [`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20)). Only a frame that
passes both checks reaches `tx::send`; a send that fails at the device returns `E_IO` (`tx_packet.rs:35`).

## The error set

The errno words are little-endian negatives ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_INVAL    -22   bad or unknown op, or a TX frame outside the size bounds
  E_IO        -5   a TX send failed, or an RX descriptor / interrupt error
  E_AGAIN    -11   OP_RX_PACKET found no frame ready (empty ring)
  E_MSGSIZE  -90   the TX payload_len field did not match the received body length
```

`E_AGAIN` is the RTL8169's normal "nothing to receive" answer, distinct from the NVMe driver's error set: an
empty receive ring is not a failure, it is a poll that came back empty ([`src/server/handlers/rx_packet.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L32)).

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
rejects anything malformed with `E_INVAL` ([`src/protocol/decode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L25), [`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)). The TX
handler checks the declared length against the received body and bounds the frame to a valid Ethernet size
before it copies a byte into a DMA buffer ([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24), `tx_packet.rs:28`), and the
send path copies exactly `frame.len()` bytes into a `2048`-byte per-descriptor buffer, so a bounded frame
cannot overrun its slot ([`src/tx/send.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L33), [`src/constants/queue.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L19)). On receive, the driver bounds
the reported length against the buffer size and the caller's output slice before copying, dropping and
rearming any descriptor that fails the check ([`src/rx/recv_one.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L49)). There is no panic path: the crate is
`panic = "abort"` and every handler returns a status word instead of unwinding (`Cargo.toml:21`). A client
that wants raw-frame access must hold the capability to reach `driver.rtl8169_0` and speak this protocol; it
never gets a handle to the NIC.

## Source map

```
  userland/capsule_driver_rtl8169/src/protocol/header.rs     MAGIC, VERSION, HDR_LEN, RESP_HDR_LEN, Request
  userland/capsule_driver_rtl8169/src/protocol/decode.rs     decode_request: magic/version check, field parse
  userland/capsule_driver_rtl8169/src/protocol/encode.rs     the response-header and status-word encoders
  userland/capsule_driver_rtl8169/src/protocol/ops.rs        the six opcode constants
  userland/capsule_driver_rtl8169/src/protocol/errno.rs      E_INVAL, E_IO, E_AGAIN, E_MSGSIZE
  userland/capsule_driver_rtl8169/src/protocol/limits.rs     the fixed payload lengths and MAX_TX_PAYLOAD_BYTES
  userland/capsule_driver_rtl8169/src/protocol/endpoint.rs   KERNEL_REPLY_ENDPOINT
  userland/capsule_driver_rtl8169/src/server/runner.rs       the receive/decode/dispatch loop
  userland/capsule_driver_rtl8169/src/server/error.rs        reply_with_status and reply_decode_failed
  userland/capsule_driver_rtl8169/src/server/handlers/       one file per op
  userland/capsule_driver_rtl8169/src/constants/frame.rs     the Ethernet frame size bounds
  userland/capsule_driver_rtl8169/Cargo.toml                 panic = "abort"
  src/hardware/rtl8169_capsule/protocol/ops.rs               the kernel-side opcode mirror
  src/capabilities/types.rs                                  the capability bits the mask decodes into
```

Every reference above is verified against those trees.
