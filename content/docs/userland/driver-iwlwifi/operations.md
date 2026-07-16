---
title: "Client operations and the NIWF protocol"
description: "Everything a client can ask the Wi-Fi driver for crosses one boundary: the NIWF binary protocol over IPC."
weight: 6
---
Everything a client can ask the Wi-Fi driver for crosses one boundary: the `NIWF` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional payload, the server parses and
dispatches it on a 16-bit opcode, and a handler encodes a 20-byte response header carrying a signed errno,
followed by a fixed payload. Every one of the seven operations is read-only or reports staged state; none of
them transmits, associates, or scans. For the identity table and the capability mask see the
[README](/docs/userland/driver-iwlwifi/); for how the bring-up produced the state these handlers report see the
[bring-up](/docs/userland/driver-iwlwifi/bring-up/) and [firmware](/docs/userland/driver-iwlwifi/firmware/) pages.

## The wire format

A request header is 20 bytes and begins with a magic and a version ([`src/protocol/header.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L9)). The parser
rejects anything shorter than the header, a wrong magic, or a wrong version, returning `None` so the server
skips the request without touching the device ([`src/protocol/decode.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L11), [`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E49_5746` ("NIWF" little-endian) (`header.rs:9`) |
| version | 4 | u16 | `VERSION = 1` (`header.rs:10`) |
| op | 6 | u16 | the opcode (`decode.rs:20`) |
| (reserved) | 8 | u16 | not read by the parser |
| request_id | 12 | u32 | echoed into the response header (`decode.rs:20`) |
| payload_len | 16 | u32 | request payload length in bytes (`decode.rs:15`) |

The parser also rejects a `payload_len` that would run past the received buffer, using a saturating
subtraction so the bound cannot underflow ([`src/protocol/decode.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L16)). The body it returns is exactly the
`payload_len` bytes after the header (`decode.rs:21`).

Every reply is a response header of the same 20-byte length, encoded by `response`
([`src/protocol/encode.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L11)): the magic, the version, the request's opcode echoed back, the signed errno in
the flags field at offset 8, the echoed `request_id`, and the payload length, followed by the payload. All
multi-byte integers are little-endian. The reply is sent to the requesting pid with `mk_ipc_reply`
([`src/server/respond.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L14)).

## The request loop

`server::run` sizes one receive buffer and one transmit buffer each to the header plus `IPC_PAYLOAD_MAX`
(256 bytes) ([`src/server/runner.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L22), [`src/protocol/limits.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L9)). The loop receives one request with
`mk_ipc_recv_from` from the service inbox, skips a receive of zero or fewer bytes or one from pid 0, parses
it, and dispatches ([`src/server/runner.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L25)). A parse failure is skipped silently, since a malformed
header has no request id to reply to ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31)).

`dispatch` matches the opcode with an empty-body guard on every arm: each of the seven ops is handled only
`if body.is_empty()` ([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)). An opcode that is recognised but carries a body, and any
unrecognised opcode, both fall through: an unknown op with an empty body is answered `E_BAD_OP`, and
anything with a non-empty body is answered `E_INVAL` ([`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47), `runner.rs:50`). So a
client cannot smuggle a payload into a fixed-width query.

## The seven operations

The opcodes are defined in [`src/protocol/ops.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L9) and dispatched in [`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37). Every op
takes no request payload.

| Op | Opcode | Reply payload after the header errno | Handler |
|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | none (errno only) | [`server/handlers/health.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L12) |
| `OP_DEVICE_INFO` | `0x0002` | 32-byte device record | [`server/handlers/device.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/device.rs#L13) |
| `OP_FIRMWARE_INFO` | `0x0003` | name length, blob size, and the name bytes | [`server/handlers/firmware.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/firmware.rs#L13) |
| `OP_RF_STATE` | `0x0004` | 8-byte RF-kill flag and live `GP_CNTRL` | [`server/handlers/rf.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/rf.rs#L13) |
| `OP_DMA_STATE` | `0x0005` | 56-byte grant metadata | [`server/handlers/dma.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/dma.rs#L13) |
| `OP_FIRMWARE_STAGE` | `0x0006` | 32-byte staging record, or `E_FW_INVALID` | [`server/handlers/firmware_stage.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/firmware_stage.rs#L6) |
| `OP_ALIVE_WAIT` | `0x0007` | 8-byte seen flag and interrupt word | [`server/handlers/alive.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/alive.rs#L6) |

## Payload detail on each op

- `OP_HEALTHCHECK` replies with the header carrying `E_OK` and no payload ([`src/server/handlers/health.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L13)).
  It confirms the capsule is up and serving; it does not re-probe the device.
- `OP_DEVICE_INFO` packs a fixed 32-byte record: the broker device id (u64), the PCI device id (u16), the
  hardware revision read at bring-up (u32 at offset 12), the firmware family as a u32 at offset 16, and the
  `GP_CNTRL` value captured at bring-up as a u32 at offset 20 ([`src/server/handlers/device.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/device.rs#L14)). The hw
  revision and `GP_CNTRL` are the values from setup, not a live re-read.
- `OP_FIRMWARE_INFO` reports the firmware blob that family selection chose: a u32 name length (clamped to
  `FW_NAME_MAX`, 64), the blob's byte length as a u64, and the name bytes starting at offset 16, with the
  reply trimmed to `16 + n` bytes ([`src/server/handlers/firmware.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/firmware.rs#L14), [`src/protocol/limits.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L10)). This
  reports the selected blob; it does not mean the firmware was delivered to the device.
- `OP_RF_STATE` returns an 8-byte record: the `rf_kill` flag derived at bring-up as a u32, then a live read
  of the `CSR_GP_CNTRL` register ([`src/server/handlers/rf.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rf.rs#L14)). The second word is the one live register
  read in the whole protocol, so a client polling this op sees the current general-control state.
- `OP_DMA_STATE` returns the 56-byte broker grant metadata: the DMA grant id, the DMA user virtual address,
  the DMA device address, the DMA length, the claim epoch, the MMIO grant id, and the IRQ grant id, each a
  u64 ([`src/server/handlers/dma.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dma.rs#L14)). This is the staging window a firmware transfer would use.
- `OP_FIRMWARE_STAGE` runs the staging on demand: it calls `Driver::stage_firmware`, and on success returns
  a 32-byte record with the firmware major/minor/api versions, the build number, the INIT, runtime, and
  paging section counts, and the total staged byte count ([`src/server/handlers/firmware_stage.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/firmware_stage.rs#L15)). On a
  TLV parse or staging failure it returns `E_FW_INVALID` with no payload (`firmware_stage.rs:9`). The
  [firmware](/docs/userland/driver-iwlwifi/firmware/) page covers what staging does and does not do.
- `OP_ALIVE_WAIT` polls the interrupt-status register for the firmware alive bit and returns an 8-byte
  record: a one-byte seen flag and the last interrupt word as a u32 at offset 4
  ([`src/server/handlers/alive.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/alive.rs#L10)). The errno is `E_OK` when the bit was seen and `E_TIMEOUT` when the
  poll spun out (`alive.rs:13`). Because nothing in this capsule kicks the firmware transfer, the timeout is
  the expected result on current hardware, and the errno is honest about it.

## The error set

All errno words are signed little-endian negatives in the header flags field ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_OK          0   success
  E_BAD_OP    -38   a recognised-shape request with an unknown opcode and an empty body
  E_INVAL     -22   any request that carried a non-empty body
  E_TIMEOUT  -110   OP_ALIVE_WAIT spun out without seeing the alive bit
  E_FW_INVALID -84  OP_FIRMWARE_STAGE could not parse or stage the firmware
```

## Security posture at this boundary

The server is the only inbound surface, and it is defensive without being able to do much harm, because
every op is read-only or stages into the capsule's own DMA buffer. It validates the header magic and version
and skips anything malformed ([`src/protocol/decode.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L11)). The empty-body guard on every dispatch arm means
a query op cannot smuggle a body, and a non-empty body is refused with `E_INVAL` before any handler runs
([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)). There is no client-supplied length, offset, or address anywhere in the
protocol: no op takes a request payload, so there is no parsing of attacker-influenced integers into a
device access. The one write the protocol performs is the firmware alive poll acknowledging the interrupt it
observed ([`src/firmware/alive.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/alive.rs#L9)), which writes back the exact bits it read. There is no panic path: the
crate is `panic = "abort"` and every handler returns an errno word instead of unwinding
(`Cargo.toml:25`). A client that wants to reach `driver.iwlwifi0` must hold the capability to speak to it;
it never gets a handle to the controller.

## Source map

```
  userland/capsule_driver_iwlwifi/src/protocol/header.rs     MAGIC, VERSION, HDR_LEN, the Request struct
  userland/capsule_driver_iwlwifi/src/protocol/decode.rs     parse: magic/version check, payload bound, field parse
  userland/capsule_driver_iwlwifi/src/protocol/encode.rs     response: the header + errno encoder
  userland/capsule_driver_iwlwifi/src/protocol/ops.rs        the seven opcode constants
  userland/capsule_driver_iwlwifi/src/protocol/errno.rs      E_OK, E_BAD_OP, E_INVAL, E_TIMEOUT, E_FW_INVALID
  userland/capsule_driver_iwlwifi/src/protocol/limits.rs     IPC_PAYLOAD_MAX and FW_NAME_MAX
  userland/capsule_driver_iwlwifi/src/server/runner.rs       the receive/parse/dispatch loop and the empty-body guard
  userland/capsule_driver_iwlwifi/src/server/respond.rs      send: response encode plus mk_ipc_reply
  userland/capsule_driver_iwlwifi/src/server/handlers/       one file per op
  userland/capsule_driver_iwlwifi/src/firmware/alive.rs      the alive poll behind OP_ALIVE_WAIT
  userland/capsule_driver_iwlwifi/Cargo.toml                 panic = "abort"
  src/capabilities/types.rs                                  the capability bits the mask decodes into
```

Every reference above is verified against those trees.
