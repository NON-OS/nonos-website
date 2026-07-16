---
title: "Operations and the wire protocol"
description: "This page covers the request surface of capsuledriveri2cpci: the NI2C envelope the driver speaks, the six opcodes, the status words, and the per-op handlers."
weight: 1
---
This page covers the request surface of `capsule_driver_i2c_pci`: the `NI2C` envelope the driver speaks,
the six opcodes, the status words, and the per-op handlers. It mirrors `src/protocol/` (the wire format)
and `src/server/` (the receive loop and the handlers). For the identity and capability mask see the
[README](/docs/userland/driver-i2c-pci/); for the transfer engine that two of these operations drive see
[transfer-engine.md](/docs/userland/driver-i2c-pci/transfer-engine/).

## The server loop

The server is a blocking receive loop ([`src/server/runner.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L14)). It allocates a fixed receive and
transmit buffer of `HDR_LEN + IPC_PAYLOAD_MAX` bytes (20 + 256, [`src/protocol/limits.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L1)), receives
from the service inbox with the sender pid, parses the header, and dispatches on the opcode. A message
that fails to parse or comes from pid 0 is dropped silently ([`src/server/runner.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L20)). Every reply is
sent back to that pid through `mk_ipc_reply` ([`src/server/respond.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L6)).

## The NI2C envelope

The wire header is the shared capsule envelope: magic `0x4E49_3243` ("NI2C"), version `1`, a 2-byte
opcode, an 8-byte request id, and a 4-byte body length, 20 bytes total ([`src/protocol/header.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L1)). All
multi-byte integers are little-endian. The decoder rejects a short buffer, a wrong magic or version, or a
body length that runs past the buffer ([`src/protocol/decode.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L4), `decode.rs:9`, `decode.rs:15`).

A reply is the 20-byte header, then a 4-byte signed status word, then an optional body; the encoder
writes the same magic and version and sets the length field to `4 + body.len()`
([`src/protocol/encode.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L3)).

## Status words

The status word is a signed 32-bit errno ([`src/protocol/errno.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L1)):

```
  E_OK        0     success
  E_BUSY    -16     controller master still active before the transfer
  E_INVAL   -22     malformed request body or out-of-range address/length
  E_BAD_OP  -38     unknown opcode
  E_TIMEOUT -110    controller or transfer did not complete in the iteration budget
  E_NACK   -121     device did not acknowledge (DesignWare TX abort)
```

## Dispatch

Six opcodes are defined ([`src/protocol/ops.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L1)). The four fixed-width read operations are gated on an
empty body in the dispatch match; a non-empty body on one of them, or an unknown opcode with a non-empty
body, falls through to `E_INVAL`, and an unknown opcode with an empty body replies `E_BAD_OP`
([`src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L35), `runner.rs:46`, `runner.rs:49`).

| Opcode | Name | Body in | Body out | Handler |
|---|---|---|---|---|
| 1 | `OP_HEALTHCHECK` | empty | 1 byte `1` | [`src/server/handlers/health.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L4) |
| 2 | `OP_CONTROLLER_INFO` | empty | 64-byte identity | [`src/server/handlers/controller.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller.rs#L5) |
| 3 | `OP_REGISTER_SNAPSHOT` | empty | 40 bytes (ten u32) | [`src/server/handlers/snapshot.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/snapshot.rs#L6) |
| 4 | `OP_TIMING_INFO` | empty | 28 bytes (seven u32) | [`src/server/handlers/timing.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/timing.rs#L6) |
| 5 | `OP_TRANSFER` | 8-byte head + write | read length + abort + read bytes | [`src/server/handlers/transfer.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L6) |
| 6 | `OP_PROBE` | 1 byte address | 1 byte present/absent | [`src/server/handlers/probe.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L6) |

### OP_HEALTHCHECK (opcode 1)

Empty body in, `E_OK` with a single byte `1` out ([`src/server/handlers/health.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L5)). The liveness probe;
it reads no registers.

### OP_CONTROLLER_INFO (opcode 2)

Empty body in, `E_OK` with a 64-byte body carrying the cached identity with no register reads
([`src/server/handlers/controller.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller.rs#L5)):

```
  [ 0.. 8)  device_id     u64   broker device id
  [ 8..10)  pci_device    u16   PCI device id
  [10..14)  clock_hz      u32   source clock
  [14..22)  claim_epoch   u64   claim epoch
  [22..30)  mmio_grant    u64   MMIO grant id
  [30..38)  irq_grant     u64   IRQ grant id
  [38..42)  irq_vector    u32   bound broker vector
  [42..64)  family        utf8  family name, up to 22 bytes
```

The family name is copied in truncated to 22 bytes ([`src/server/handlers/controller.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller.rs#L15)).

### OP_REGISTER_SNAPSHOT (opcode 3)

Empty body in, `E_OK` with a 40-byte body of ten little-endian u32 values
([`src/server/handlers/snapshot.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/snapshot.rs#L7)). The first four are the values cached at init (`comp_type`,
`comp_param`, `enabled`, `status`); the remaining six are live reads of `IC_CON` (0x00),
`IC_INTR_MASK` (0x30), `IC_RAW_INTR_STAT` (0x34), `IC_TXFLR` (0x74), `IC_RXFLR` (0x78), and `IC_ENABLE`
(0x6C), whose offsets are in [`src/constants/mod.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L6). These are side-effect-free status reads.

### OP_TIMING_INFO (opcode 4)

Empty body in, `E_OK` with a 28-byte body of seven u32 values: the source clock, then live reads of the
standard-mode SCL high/low counts (`IC_SS_SCL_HCNT` 0x14, `IC_SS_SCL_LCNT` 0x18), the fast-mode counts
(`IC_FS_SCL_HCNT` 0x1C, `IC_FS_SCL_LCNT` 0x20), and the RX/TX FIFO thresholds (`IC_RX_TL` 0x38, `IC_TX_TL`
0x3C) ([`src/server/handlers/timing.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/timing.rs#L7)). This is how a client reads back the clock program the driver
applied during bring-up, which is why the "no SCL clock" check in [debugging.md](/docs/userland/driver-i2c-pci/debugging/) uses it.

### OP_TRANSFER (opcode 5)

Request: an 8-byte fixed head followed by the write bytes
([`src/server/handlers/transfer.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L22)):

```
  [0]      addr        u8    7-bit target address
  [1]      reserved    u8
  [2..4)   write_len   u16
  [4..6)   read_len    u16
  [6..8)   flags       u16   bit 0 = FLAG_RESTART_ON_READ
  [8..]    write       write_len bytes
```

The parser rejects a body shorter than 8, or one whose length is not exactly `8 + write_len`, with
`E_INVAL` ([`src/server/handlers/transfer.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L23), `transfer.rs:30`). `FLAG_RESTART_ON_READ` (bit 0,
[`src/transaction/types/flags.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/flags.rs#L16)) inserts a repeated-start before the first read of a write-then-read
transaction; see [transfer-engine.md](/docs/userland/driver-i2c-pci/transfer-engine/). Write and read are each bounded to 64 bytes
([`src/protocol/limits.rs:2`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L2), [`src/transaction/types/valid_lengths.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/types/valid_lengths.rs#L18)).

Reply on success: `E_OK` with a body whose first u16 is the read length, then a 4-byte DesignWare abort
source (zero on a clean transfer), then the read bytes at offset 8
([`src/server/handlers/transfer.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L36)). The handler then hands the request to the transfer engine and
maps its error straight to a status word: `E_BUSY`, `E_TIMEOUT`, `E_NACK`, or `E_INVAL`
([`src/server/handlers/transfer.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L44)).

### OP_PROBE (opcode 6)

Request: a single byte, the 7-bit address; a body that is not one byte, or an address over `0x7F`, is
`E_INVAL` ([`src/server/handlers/probe.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L7)). The probe runs a one-byte read transfer and maps the
outcome: a completed transfer replies `E_OK` with `[1]` (present), a NACK replies `E_OK` with `[0]`
(absent), and any other error is surfaced as its errno ([`src/transaction/engine/probe.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/probe.rs#L23),
[`src/server/handlers/probe.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L11)). The distinction matters: a clean NACK is a definite "nobody home",
not a bus failure.

## Source map

```
  userland/capsule_driver_i2c_pci/src/protocol/header.rs    NI2C magic, version, 20-byte header
  userland/capsule_driver_i2c_pci/src/protocol/decode.rs    header parse and bounds checks
  userland/capsule_driver_i2c_pci/src/protocol/encode.rs    reply framing
  userland/capsule_driver_i2c_pci/src/protocol/ops.rs       the six opcode constants
  userland/capsule_driver_i2c_pci/src/protocol/errno.rs     the status words
  userland/capsule_driver_i2c_pci/src/protocol/limits.rs    IPC_PAYLOAD_MAX and the 64-byte transfer bounds
  userland/capsule_driver_i2c_pci/src/server/runner.rs      the receive loop and the dispatch match
  userland/capsule_driver_i2c_pci/src/server/respond.rs     reply send
  userland/capsule_driver_i2c_pci/src/server/handlers/      health, controller, snapshot, timing, transfer, probe
  userland/capsule_driver_i2c_pci/src/constants/mod.rs      the DesignWare register offsets
  userland/capsule_driver_i2c_pci/src/transaction/          the engine that OP_TRANSFER and OP_PROBE drive
```

Every reference above is verified against those trees.
