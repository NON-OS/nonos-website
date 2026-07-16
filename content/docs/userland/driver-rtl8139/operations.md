---
title: "Client operations and the NR89 protocol"
description: "Everything a client can ask the RTL8139 driver for crosses one boundary: the NR89 binary protocol over IPC."
weight: 7
---
Everything a client can ask the RTL8139 driver for crosses one boundary: the `NR89` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional payload, the server decodes and
dispatches it on a 16-bit opcode, and a handler encodes a 20-byte response header, a 4-byte status word, and,
for the data-bearing ops, a payload. This is the `NNET`-family protocol that the
[net_core](/docs/subsystems/networking/stack/) stack binds to: `link_status`, `mac_address`, `tx_packet`,
and `rx_packet` are the four operations a NIC device bridge needs. For the identity table and the capability
mask see the [README](/docs/userland/driver-rtl8139/); for how the handlers reach the hardware see the [buffers](/docs/userland/driver-rtl8139/buffers/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)). The decoder
rejects anything shorter than the header, a wrong magic, or a wrong version, returning `None` so the caller
answers `E_INVAL` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L53)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E52_3839` ("NR89") (`header.rs:17`) |
| version | 4 | u16 | `VERSION = 1` (`header.rs:18`) |
| op | 6 | u16 | the opcode (`decode.rs:28`) |
| flags | 8 | u16 | request flags (`decode.rs:29`) |
| request_id | 12 | u32 | echoed into the response header (`decode.rs:30`) |
| payload_len | 16 | u32 | request payload length in bytes (`decode.rs:31`) |

Bytes 10 and 11 are reserved and are written as zero in the response header ([`src/protocol/encode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L24)).
Every reply is a response header of the same length (`RESP_HDR_LEN = HDR_LEN = 20`), followed by a 4-byte
little-endian status word, then any payload ([`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19), [`src/protocol/limits.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L19)).
Status `0` means success; a negative status is one of the errno constants below. Replies go to the kernel
reply endpoint `0x1_0000_000D` with `mk_ipc_send` ([`src/server/error.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L26), [`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17)).

## The request loop

`server::run` sizes one receive buffer to the header plus the maximum Ethernet frame, and one transmit buffer
to the response header, the status word, and the larger of the RX payload (a 4-byte length prefix plus a
frame) or the 48-byte stats payload, so a single receive holds the largest transmit frame and a single send
holds the largest received frame or the stats block ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)). The loop receives a request
on the service inbox, decodes it, and dispatches ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39), `runner.rs:45`). A receive of
zero or fewer bytes is skipped, and a decode failure answers `E_INVAL` without touching the device
([`src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L46), `runner.rs:53`). Each op routes to its handler, and an unrecognised opcode is
answered with `E_INVAL` ([`src/server/runner.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L58), `runner.rs:65`).

## The six operations

The opcodes are defined in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and dispatched in [`src/server/runner.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L58).

| Op | Opcode | Request payload | Reply payload after status | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L20) |
| `OP_LINK_STATUS` | `2` | none | 1-byte link-up flag | [`server/handlers/link_status.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/link_status.rs#L27) |
| `OP_MAC_ADDRESS` | `3` | none | 6-byte MAC address | [`server/handlers/mac_address.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/mac_address.rs#L25) |
| `OP_TX_PACKET` | `4` | one Ethernet frame | none (status only) | [`server/handlers/tx_packet.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/tx_packet.rs#L23) |
| `OP_RX_PACKET` | `5` | none | 4-byte length prefix plus frame bytes | [`server/handlers/rx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/rx_packet.rs#L27) |
| `OP_STATS` | `6` | none | 48-byte register and cursor snapshot | [`server/handlers/stats.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/stats.rs#L29) |

`OP_HEALTHCHECK` replies with the response header and a zero status word alone through `reply_with_status`;
it is pure liveness and reads no register ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20), [`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)).

## Payload detail on the data ops

- `OP_LINK_STATUS` reads the `MSR` port register live and reports `1` when the `MSR_LINK_BAD` bit is clear,
  `0` when it is set; a port read failure answers status `-5` ([`src/server/handlers/link_status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L28)). The
  payload is one byte ([`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22)).
- `OP_MAC_ADDRESS` returns the six MAC bytes read once at bring-up and cached on the driver
  ([`src/server/handlers/mac_address.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L29); read at [`src/init/mac.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac.rs#L21)). The payload is six bytes
  ([`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21)).
- `OP_TX_PACKET` transmits the request body as one Ethernet frame. It requires the body length to equal the
  header's `payload_len` field, and the body to be at least `MIN_ETHERNET_FRAME` (60) and at most
  `MAX_ETHERNET_FRAME` (1514) bytes; a length mismatch is `E_MSGSIZE` and an out-of-range size is `E_INVAL`
  ([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24), `tx_packet.rs:28`; bounds at [`src/constants/frame.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L18)). On a
  successful send the status is `0`; a NIC send error is `E_IO` ([`src/server/handlers/tx_packet.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L35)).
- `OP_RX_PACKET` polls the receive ring for one frame. On a frame it writes a 4-byte little-endian length
  prefix and then the frame bytes after the status word; an empty ring answers `E_AGAIN`, and a descriptor or
  interrupt error answers `E_IO` ([`src/server/handlers/rx_packet.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L29), `rx_packet.rs:40`). The 4-byte
  prefix is `RX_PAYLOAD_PREFIX_LEN` ([`src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L23)).
- `OP_STATS` returns a non-mutating snapshot of twelve little-endian `u32` fields, 48 bytes total: `CMD`,
  `MSR`, `ISR`, `RCR`, `TCR`, `CAPR`, the four `TXSTATUS0..3` words, the software `rx_offset`, and the
  software `tx_cur` cursor ([`src/server/handlers/stats.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L47); length at [`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24)). It
  reads only registers that do not clear on access, so telemetry never perturbs the driver's own bookkeeping;
  a port read failure answers `E_IO` ([`src/server/handlers/stats.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L32)).

## The error set

All errno words are little-endian negatives ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_IO        -5   a NIC TX/RX fault, or a live port read failed
  E_AGAIN    -11   the receive ring is empty right now, poll again
  E_INVAL    -22   bad op, or a TX frame outside the 60..1514 bound
  E_MSGSIZE  -90   the TX body length does not match the header's payload_len
```

`E_AGAIN` is the load-bearing one for a NIC: an empty ring is the normal idle case, not an error, so the
stack polls `OP_RX_PACKET`, gets `E_AGAIN`, and comes back later without any device-fault handling.

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
rejects anything malformed with `E_INVAL` ([`src/protocol/decode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L25), [`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)). The TX
handler is the only op that carries a client body, and it checks two things before a byte reaches the NIC:
that the body length matches the declared `payload_len`, and that the frame size is within the Ethernet
bound, so a client can neither under-run nor over-run the transmit slot ([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24),
`tx_packet.rs:28`; the slot is 2048 bytes and 1514 is the ceiling, [`src/constants/dma.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/dma.rs#L20),
[`src/constants/frame.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L19)). The RX handler bounds every copy against the caller's buffer and the Ethernet
maximum inside the ring reader, so a malformed descriptor cannot spill past the reply buffer
([`src/rx/read_frame.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L42)). There is no panic path: the crate is `panic = "abort"` and every handler returns
an errno word instead of unwinding (`Cargo.toml:21`). A client that wants frame I/O must hold the capability
to reach `driver.rtl8139_0` and speak this protocol; it never gets a handle to the NIC or its ports.

## Source map

```
  userland/capsule_driver_rtl8139/src/protocol/header.rs     MAGIC, VERSION, HDR_LEN, the Request struct
  userland/capsule_driver_rtl8139/src/protocol/decode.rs     decode_request: magic/version check, field parse
  userland/capsule_driver_rtl8139/src/protocol/encode.rs     the response-header and status-word encoders
  userland/capsule_driver_rtl8139/src/protocol/ops.rs        the six opcode constants
  userland/capsule_driver_rtl8139/src/protocol/errno.rs      E_IO, E_AGAIN, E_INVAL, E_MSGSIZE
  userland/capsule_driver_rtl8139/src/protocol/limits.rs     the fixed payload lengths and MAX_TX_PAYLOAD_BYTES
  userland/capsule_driver_rtl8139/src/protocol/endpoint.rs   KERNEL_REPLY_ENDPOINT
  userland/capsule_driver_rtl8139/src/server/runner.rs       the receive/decode/dispatch loop
  userland/capsule_driver_rtl8139/src/server/error.rs        reply_with_status and reply_decode_failed
  userland/capsule_driver_rtl8139/src/server/handlers/       one file per op: health, link_status, mac_address, tx_packet, rx_packet, stats
  userland/capsule_driver_rtl8139/src/constants/frame.rs     MIN/MAX_ETHERNET_FRAME and MAC_LEN
  userland/capsule_driver_rtl8139/Cargo.toml                 panic = "abort"
  src/capabilities/types.rs                                  the capability bits the mask decodes into
```

Every reference above is verified against those trees.
