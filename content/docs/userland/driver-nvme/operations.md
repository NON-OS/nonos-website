---
title: "Client operations and the NNVM protocol"
description: "Everything a client can ask the NVMe driver for crosses one boundary: the NNVM binary protocol over IPC."
weight: 4
---
Everything a client can ask the NVMe driver for crosses one boundary: the `NNVM` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional payload, the server decodes and
dispatches it on a 16-bit opcode, and a handler encodes a 20-byte response header, a 4-byte status word,
and, for the data-bearing ops, a fixed payload. For the identity table and the capability mask see the
[README](/docs/userland/driver-nvme/); for how the handlers reach the device see the [queues](/docs/userland/driver-nvme/queues/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)). The
decoder rejects anything shorter than the header, a wrong magic, or a wrong version, returning `None` so
the caller answers `E_INVAL` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4e4e_564d` ("NNVM") (`header.rs:17`) |
| version | 4 | u16 | `VERSION = 1` (`header.rs:18`) |
| op | 6 | u16 | the opcode (`decode.rs:30`) |
| flags | 8 | u16 | request flags (`decode.rs:31`) |
| request_id | 12 | u32 | echoed into the response header (`decode.rs:32`) |
| payload_len | 16 | u32 | request payload length in bytes (`decode.rs:33`) |

Every reply is a response header of the same length (`RESP_HDR_LEN = HDR_LEN = 20`), followed by a 4-byte
little-endian status word, then any payload ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17), [`src/server/error.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L24)).
Status `0` means success; a negative status is one of the errno constants below. Replies go to the kernel
reply endpoint `0x1_0000_0011` with `mk_ipc_send` ([`src/server/error.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L26), [`src/protocol/endpoint.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L18)).

## The request loop

`server::run` sizes one receive buffer to the header plus the maximum read/write payload and one transmit
buffer to the response header, the status word, and that same maximum, so a single receive holds the
largest write and a single send holds the largest read ([`src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L30)). The loop polls the
MSI-X grant, receives a request, decodes it, and dispatches ([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)). A receive of zero
or fewer bytes is skipped, and a decode failure answers `E_INVAL` without touching the device
([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40), `runner.rs:46`).

`dispatch` opens with a guard: the five zero-payload query ops (`OP_HEALTHCHECK`, `OP_CONTROLLER_INFO`,
`OP_IDENTIFY_CONTROLLER`, `OP_IDENTIFY_NAMESPACE`, `OP_SMART_HEALTH`) are answered with `E_INVAL` if the
client sends any payload, before the op is handled ([`src/server/runner.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L56)). Each remaining op routes to
its handler, and an unrecognised opcode is answered with `E_INVAL` ([`src/server/runner.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L71)).

## The nine operations

The opcodes are defined in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and dispatched in [`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54).

| Op | Opcode | Request payload | Reply payload after status | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | none | none (status only) | [`server/handlers/health.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L19) |
| `OP_CONTROLLER_INFO` | `0x0002` | none | 52-byte register/setup snapshot | [`server/handlers/controller_info.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/controller_info.rs#L25) |
| `OP_IDENTIFY_CONTROLLER` | `0x0003` | none | 88-byte selected identity record | [`server/handlers/identify_controller.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/identify_controller.rs#L25) |
| `OP_IDENTIFY_NAMESPACE` | `0x0004` | none | 36-byte selected namespace record | [`server/handlers/identify_namespace.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/identify_namespace.rs#L25) |
| `OP_SMART_HEALTH` | `0x0005` | none | 177-byte selected health record | [`server/handlers/smart_health/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/smart_health/handle.rs#L29) |
| `OP_CAPACITY` | `0x0006` | none | 8-byte sector count | [`server/handlers/capacity.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/capacity.rs#L26) |
| `OP_READ_BLOCKS` | `0x0007` | 12-byte `lba(8), sectors(4)` | sector bytes (`sectors * 512`) | [`server/handlers/read.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/read.rs#L27) |
| `OP_WRITE_BLOCKS` | `0x0008` | 12-byte header + sector bytes | none (status only) | [`server/handlers/write.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/write.rs#L22) |
| `OP_FLUSH` | `0x0009` | none | none (status only) | [`server/handlers/flush.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/flush.rs#L21) |

The three status-only ops (`healthcheck`, `write`, `flush`) reply with the response header and the status
word alone through `reply_with_status` ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)). The six data-bearing ops build a longer
reply, described next.

## Payload detail on the data ops

- `OP_CONTROLLER_INFO` reads the register block live (`ControllerInfo::read`, not the cached snapshot) and
  packs `CAP` (u64), then `VS`, `CC`, `CSTS`, `AQA`, `INTMS`, `INTMC`, `CMBLOC`, `CMBSZ` (each u32), then
  the maximum queue entries (u16), and finally the timeout units, doorbell stride, min and max page shift,
  an NVM-supported flag, a ready flag, and a fatal flag as bytes with three trailing zero pad bytes
  ([`src/server/handlers/controller_info.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L26)). The layout is fixed at 52 bytes
  ([`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)).
- `OP_IDENTIFY_CONTROLLER` returns fields parsed once at bring-up: vendor and subsystem vendor id, the
  20-byte serial, the 40-byte model, the 8-byte firmware, version, optional-admin, namespace count, MDTS,
  the SQ and CQ entry sizes, optional-NVM, and the volatile-write-cache byte
  ([`src/server/handlers/identify_controller.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/identify_controller.rs#L25); parsed at [`src/admin/identity.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/identity.rs#L35)). Fixed at 88
  bytes ([`src/protocol/limits.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L19)).
- `OP_IDENTIFY_NAMESPACE` returns the cached NSID-1 record: nsid, size, capacity, and used in LBAs, the LBA
  size, metadata size, format index, and formatted-LBA count
  ([`src/server/handlers/identify_namespace.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/identify_namespace.rs#L25); parsed at [`src/admin/namespace.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/namespace.rs#L43)). Fixed at 36
  bytes ([`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20)).
- `OP_SMART_HEALTH` returns the cached SMART snapshot: the critical-warning byte, composite temperature in
  kelvin, spare and threshold, percentage-used, endurance-group warning, then ten 128-bit lifetime counters
  (data units read and written, host read and write commands, controller busy time, power cycles, power-on
  hours, unsafe shutdowns, media errors, error-log entries) and two 32-bit temperature-time counters
  ([`src/server/handlers/smart_health/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/smart_health/handle.rs#L29); parsed at [`src/admin/health/parse.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/health/parse.rs#L23)). Fixed at
  177 bytes ([`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21)).
- `OP_CAPACITY` returns the namespace sector count as a little-endian u64, or `E_NODEV` if no IO queue was
  brought up ([`src/server/handlers/capacity.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L27)). Fixed at 8 bytes ([`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24)).
- `OP_READ_BLOCKS` copies the fetched sectors out of the DMA data region into the reply after the status
  word ([`src/server/handlers/read.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L47)); `OP_WRITE_BLOCKS` copies the request's sector bytes into the DMA
  data region before submitting the write ([`src/server/handlers/write.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L36)).

## The error set

All errno words are little-endian negatives ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_INVAL    -22   bad op, or a query op carried a payload; also a bad sector count
  E_IO        -5   the NVM read/write/flush command completed with an error
  E_NXIO      -6   the requested LBA range runs past namespace capacity
  E_NODEV    -19   no usable IO queue was created at bring-up
  E_MSGSIZE  -90   the request length does not match the op's fixed layout
```

## Read and write bounds

The read and write handlers validate before touching the device. `rw_parse::parse` reads the 8-byte LBA
and the 4-byte sector count, rejects a zero count or a count above `MAX_SECTORS` (64) with `E_INVAL`, and
rejects `lba + sectors > capacity` with `E_NXIO`, using a checked add so the bound cannot overflow
([`src/server/handlers/rw_parse.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L20)). Both data ops fail with `E_NODEV` first if no IO queue exists
([`src/server/handlers/read.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L29), `write.rs:24`). Read then requires the request payload to be exactly the
12-byte header ([`src/server/handlers/read.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L33)); write requires the payload and the received body both to
be the 12-byte header plus exactly `sectors * 512` bytes before it copies anything into the DMA buffer
([`src/server/handlers/write.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L33)). A parse failure, an oversize count, an out-of-range LBA, or a wrong
length is refused with the matching errno and no command reaches the controller. A command that does reach
the controller but completes with an error status returns `E_IO`
([`src/server/handlers/read.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L40), `write.rs:43`, `flush.rs:27`).

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
rejects anything malformed with `E_INVAL` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)). The
zero-payload guard means a query op cannot smuggle a body ([`src/server/runner.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L56)). The read and write
parser bounds the sector count and the LBA range against the real namespace capacity with a checked add, so
a client can neither read nor write past the namespace nor overflow the bound
([`src/server/handlers/rw_parse.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L20)). Write requires an exact payload length before it copies anything
into the DMA buffer ([`src/server/handlers/write.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L33)). There is no panic path: the crate is
`panic = "abort"` and every handler returns an errno word instead of unwinding (`Cargo.toml:26`). A client
that wants block I/O must hold the capability to reach `driver.nvme0` and speak this protocol; it never
gets a handle to the controller.

## Source map

```
  userland/capsule_driver_nvme/src/protocol/header.rs     MAGIC, VERSION, HDR_LEN, the Request struct
  userland/capsule_driver_nvme/src/protocol/decode.rs     decode_request: magic/version check, field parse
  userland/capsule_driver_nvme/src/protocol/encode.rs     the response-header and status-word encoders
  userland/capsule_driver_nvme/src/protocol/ops.rs        the nine opcode constants
  userland/capsule_driver_nvme/src/protocol/errno.rs      E_INVAL, E_IO, E_NXIO, E_NODEV, E_MSGSIZE
  userland/capsule_driver_nvme/src/protocol/limits.rs     the fixed payload lengths and MAX_RW_PAYLOAD_BYTES
  userland/capsule_driver_nvme/src/protocol/endpoint.rs   SERVICE_NAME and KERNEL_REPLY_ENDPOINT
  userland/capsule_driver_nvme/src/server/runner.rs       the receive/decode/dispatch loop and IRQ poll
  userland/capsule_driver_nvme/src/server/error.rs        reply_with_status and reply_decode_failed
  userland/capsule_driver_nvme/src/server/handlers/       one file per op, plus rw_parse and the smart_health packer
  userland/capsule_driver_nvme/Cargo.toml                 panic = "abort"
  src/capabilities/types.rs                               the capability bits the mask decodes into
```

Every reference above is verified against those trees.
</content>
