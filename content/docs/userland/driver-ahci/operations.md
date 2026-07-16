---
title: "The AHCI operation surface"
description: "This page mirrors src/protocol/ and src/server/: the NAHC wire format, the request loop that decodes and dispatches it, the interrupt poll folded into that loop, and every one o..."
weight: 2
---
This page mirrors `src/protocol/` and `src/server/`: the `NAHC` wire format, the request loop that
decodes and dispatches it, the interrupt poll folded into that loop, and every one of the seven ops with
its opcode, payloads, and errno set. The driver is a pure server here. It never calls another userland
service; every inbound call is a block request on its endpoint and every reply goes back to the kernel
reply inbox. For the bring-up that produces the `Driver` this loop runs against, see
[bringup.md](/docs/userland/driver-ahci/bringup/); for the hardware path a read or write drives, see [engine.md](/docs/userland/driver-ahci/engine/); for
identity and the capability mask, see the [README](/docs/userland/driver-ahci/).

## The wire format

Every request and every reply begins with the same 20-byte header ([`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19),
[`src/protocol/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs), [`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)):

```
  offset  field         value / meaning                 source
  0..4    u32 magic     0x4e41_4843  "NAHC"              header.rs:17
  4..6    u16 version   1                                header.rs:18
  6..8    u16 op        the opcode                       decode.rs:30
  8..10   u16 flags     echoed back unchanged            decode.rs:31, encode.rs:23
  10..12  u16 reserved  written as zero on replies       encode.rs:24
  12..16  u32 request_id  echoed back unchanged          decode.rs:32, encode.rs:25
  16..20  u32 payload_len  bytes of body after the header  decode.rs:33
```

`decode_request` rejects anything shorter than the 20-byte header, then any frame whose first four bytes
are not `NAHC` or whose version is not 1, returning `None` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). A `None` decode
does not touch a port: the loop answers it with `E_INVAL` through the decode-failed path and moves on
([`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45), [`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)).

Replies reuse the request's `op`, `flags`, and `request_id`, set `reserved` and the payload length, and
begin the body with a 4-byte little-endian status word (`encode_response_header`, `write_status`,
[`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)). A non-negative status is success; a negative status is one of the errno
values below.

Errno values ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_OK       0     success
  E_IO      -5     command issued but the controller reported an error or timed out
  E_NXIO    -6     requested LBA range runs past the disk capacity
  E_NODEV  -19     no block port was brought up at setup
  E_INVAL  -22     bad opcode, bad magic/version, or a fixed-size op carried a payload
  E_MSGSIZE -90    request length did not match the op's declared layout
```

## The request loop

`server::run` sizes one receive buffer and one transmit buffer to the largest frame the protocol allows,
the 20-byte header plus a full `MAX_RW_PAYLOAD_BYTES` data transfer, and then loops forever
([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)). `MAX_RW_PAYLOAD_BYTES` is the 32 KiB data-buffer size,
`crate::constants::ata::DATA_BUF_BYTES` ([`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24), [`src/constants/ata.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L31)).

Each iteration does four things ([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)):

1. Poll the controller interrupt and advance the acked sequence (below).
2. Block on `mk_ipc_recv`; a non-positive length means no frame, so it continues.
3. Decode the header; a failed decode is answered `E_INVAL` and the loop continues.
4. Dispatch on `req.op`, passing the body slice after the header.

The dispatch is a single match ([`src/server/runner.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L55)). The fixed-size ops, `OP_HEALTHCHECK`,
`OP_CONTROLLER_INFO`, and `OP_PORT_LIST`, are guarded by a leading arm that rejects any of them carrying a
non-zero `payload_len` with `E_INVAL` before the handler runs ([`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57)). An opcode no
arm matches also falls to `E_INVAL` ([`src/server/runner.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L67)).

Every handler builds its reply into the shared `tx` buffer with `encode_response_header` and
`write_status` and sends it to `KERNEL_REPLY_ENDPOINT` with `mk_ipc_send`; the short path for a
status-only reply is `error::reply_with_status`, which encodes the header, writes the status, and sends
`RESP_HDR_LEN + 4` bytes ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)).

### The interrupt poll

The loop polls the controller interrupt each iteration through `mk_irq_poll` on the IRQ grant id; when
the returned sequence advances past the last acked value it acknowledges with `mk_irq_ack` and records
the new sequence ([`src/server/runner.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L71)). This keeps the interrupt drained but does not gate command
completion: completion is decided entirely by polling `PxCI` and the status registers inside the engine
(see [engine.md](/docs/userland/driver-ahci/engine/)). That separation is why a controller with no routed legacy interrupt line
still works.

## The operations

| Op | Opcode | Request payload | Reply payload | Errors | Handler |
|---|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | none | status word only | `E_INVAL` if payload present | `ops.rs:17`, [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_CONTROLLER_INFO` | 2 | none | status + 24-byte register record | `E_INVAL` if payload present | `ops.rs:18`, [`handlers/controller_info.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/controller_info.rs#L25) |
| `OP_PORT_LIST` | 3 | none | status + 4-byte count + 36-byte port entries | `E_INVAL` if payload present | `ops.rs:19`, [`handlers/port_list.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/port_list.rs#L26) |
| `OP_CAPACITY` | 4 | none | status + 8-byte sector count | `E_NODEV` if no port | `ops.rs:20`, [`handlers/capacity.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/capacity.rs#L26) |
| `OP_READ_BLOCKS` | 5 | 12-byte `lba, count` | status + `count * 512` bytes | `E_NODEV`, `E_MSGSIZE`, `E_INVAL`, `E_NXIO`, `E_IO` | `ops.rs:21`, [`handlers/read.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/read.rs#L28) |
| `OP_WRITE_BLOCKS` | 6 | 12-byte header + `count * 512` bytes | status word only | `E_NODEV`, `E_INVAL`, `E_NXIO`, `E_MSGSIZE`, `E_IO` | `ops.rs:22`, [`handlers/write.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/write.rs#L23) |
| `OP_FLUSH` | 7 | none | status word only | `E_NODEV`, `E_IO` | `ops.rs:23`, [`handlers/flush.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/flush.rs#L22) |

### Healthcheck

`OP_HEALTHCHECK` replies with a bare `E_OK` status word and touches no hardware
([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). It is the liveness probe: a reply at all means the capsule spawned,
completed setup, and is serving its endpoint.

### Controller info

`OP_CONTROLLER_INFO` re-reads the HBA global registers live at request time through
`ControllerInfo::read` and returns a 24-byte record: `CAP`, `GHC`, `PI`, `VS` (labelled `version`),
`CAP2`, and the port count in the first byte of a final 4-byte field
([`src/server/handlers/controller_info.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L25), [`src/controller/info.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L31)). The reply payload is the
4-byte status word plus that 24-byte record ([`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)).

### Port list

`OP_PORT_LIST` returns the snapshot taken at setup, not a live read. It writes a 4-byte port count capped
at `MAX_PORTS` (32), then for each implemented port a 36-byte record of index, implemented flag, present
flag, kind, and eight status registers: `PxSSTS`, `PxSIG`, `PxIS`, `PxCMD`, `PxTFD`, `PxSERR`, `PxSACT`,
`PxCI` ([`src/server/handlers/port_list.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/port_list.rs#L26), [`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20)). The kind byte is `1` for
SATA, `2` ATAPI, `3` SEMB, `4` port multiplier, `0` none, `255` unknown
([`src/constants/port.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/port.rs#L19)). Because it is the setup snapshot, port list is the probe for a disk that
never came up: check each entry's `present` flag and its `PxSSTS` and `PxSIG` to see what the controller
reported (see [debugging.md](/docs/userland/driver-ahci/debugging/)).

### Capacity

`OP_CAPACITY` returns the block port's identified sector count as an 8-byte little-endian value
([`src/server/handlers/capacity.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L26), [`src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L23)). If no port was brought up,
`driver.block` is `None` and the handler replies `E_NODEV` before building any payload
([`src/server/handlers/capacity.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L27)). The count itself is filled in by `IDENTIFY` at bring-up (see
[engine.md](/docs/userland/driver-ahci/engine/)).

### Read and write

Read and write share their parse and range check in `rw_parse::parse`. It reads the 8-byte LBA and 4-byte
sector count from the body, rejects a zero or over-`MAX_SECTORS` (64) count with `E_INVAL`, and rejects
any `lba + count` that overflows or exceeds the identified capacity with `E_NXIO`
([`src/server/handlers/rw_parse.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L20), [`src/constants/ata.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L30)). Both handlers reply `E_NODEV` first if
there is no block port ([`src/server/handlers/read.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L32), [`src/server/handlers/write.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L27)).

`OP_READ_BLOCKS` additionally requires `payload_len` to equal the 12-byte request length before parsing
([`src/server/handlers/read.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L34)). It calls `transfer(..., write=false)`, and on success copies the
completed `count * 512` bytes out of the DMA data region into the reply body after the status word
([`src/server/handlers/read.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L41)). A transfer error becomes `E_IO`.

`OP_WRITE_BLOCKS` parses first, then checks that both the body length and `payload_len` are exactly
`12 + count * 512` before it copies ([`src/server/handlers/write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L34)). It copies the request body into
the DMA data region, issues `transfer(..., write=true)`, and replies with a status word only, `E_OK` on
success or `E_IO` on failure ([`src/server/handlers/write.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L37)).

### Flush

`OP_FLUSH` issues `FLUSH CACHE EXT` with no data transfer and replies with a status word, `E_OK` or
`E_IO` ([`src/server/handlers/flush.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L22), [`src/engine/flush.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/flush.rs#L27)). It replies `E_NODEV` if there is no
block port.

## Validation order

The design validates a request as far as it can before touching hardware, so a malformed or out-of-range
request never reaches a port:

- bad magic or version: dropped in `decode_request`, answered `E_INVAL` ([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23)).
- a fixed-size op carrying a payload: `E_INVAL` from the guard arm ([`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57)).
- an unknown opcode: `E_INVAL` from the fallthrough arm ([`src/server/runner.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L67)).
- no block port for a data op: `E_NODEV` before any parse ([`src/server/handlers/capacity.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L27)).
- wrong length for read or write: `E_MSGSIZE` ([`src/server/handlers/read.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L34),
  [`src/server/handlers/write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L34)).
- zero or over-64 sector count: `E_INVAL` ([`src/server/handlers/rw_parse.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L26)).
- LBA range past capacity: `E_NXIO` ([`src/server/handlers/rw_parse.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L30)).

Only after all of those pass does a read, write, or flush reach the command engine, and a hardware error
or timeout there is the sole source of `E_IO`.

## Source map

```
  src/protocol/header.rs      the NAHC magic, version, and the 20-byte header shape
  src/protocol/decode.rs      decode_request: length, magic, and version checks
  src/protocol/encode.rs      encode_response_header and write_status
  src/protocol/ops.rs         the seven opcode constants
  src/protocol/errno.rs       E_OK, E_IO, E_NXIO, E_NODEV, E_INVAL, E_MSGSIZE
  src/protocol/limits.rs      the fixed payload sizes and MAX_RW_PAYLOAD_BYTES
  src/protocol/endpoint.rs    SERVICE_NAME and KERNEL_REPLY_ENDPOINT
  src/server/runner.rs        the request loop, the dispatch match, and the IRQ poll
  src/server/error.rs         reply_with_status and reply_decode_failed
  src/server/handlers/health.rs           OP_HEALTHCHECK
  src/server/handlers/controller_info.rs  OP_CONTROLLER_INFO, live register read
  src/server/handlers/port_list.rs        OP_PORT_LIST, the setup snapshot
  src/server/handlers/capacity.rs         OP_CAPACITY
  src/server/handlers/read.rs             OP_READ_BLOCKS
  src/server/handlers/write.rs            OP_WRITE_BLOCKS
  src/server/handlers/flush.rs            OP_FLUSH
  src/server/handlers/rw_parse.rs         the shared LBA/count parse and range check
  src/constants/ata.rs        MAX_SECTORS, SECTOR_SIZE, DATA_BUF_BYTES
  src/constants/port.rs       the port-kind byte values
  docs/subsystems/hardware-broker/irq.md  the mk_irq_poll / mk_irq_ack contract
```

Every reference above is verified against those trees.
