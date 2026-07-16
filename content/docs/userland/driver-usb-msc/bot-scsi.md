---
title: "Bulk-Only Transport and SCSI command construction"
description: "This page mirrors the two pillars that carry the driver's real work: the Bulk-Only Transport wrappers under src/bot/ and the SCSI command blocks under src/scsi/."
weight: 3
---
This page mirrors the two pillars that carry the driver's real work: the Bulk-Only Transport wrappers
under `src/bot/` and the SCSI command blocks under `src/scsi/`. Together they are what a build handler
calls to turn "read these blocks" into the exact 31 bytes a USB mass-storage device expects, and what
turns the 13 bytes that come back into a validated status. The [operations page](/docs/userland/driver-usb-msc/operations/) covers how
these get invoked and how the results are counted; the [overview](/docs/userland/driver-usb-msc/) covers the capsule as a
whole.

The honest framing first: this layer builds and validates the wire correctly, but it never sends it. A
build handler produces a Command Block Wrapper and returns it over IPC; the caller runs the bulk transfer
through xHCI and later hands the Command Status Wrapper back for validation. Nothing in `src/bot/` or
`src/scsi/` touches a bus.

## The Bulk-Only Transport shape

BOT wraps a SCSI command in a 31-byte Command Block Wrapper, moves the data over a bulk endpoint, then
reads a 13-byte Command Status Wrapper. The capsule owns both wrappers and neither transfer.

### The Command Block Wrapper

[`src/bot/cbw.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/cbw.rs) defines the `CommandBlockWrapper` struct and its serializer. The struct carries the tag,
the expected data-transfer length, a direction flag, the LUN, the CDB length, and 16 bytes of CDB
([`src/bot/cbw.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/cbw.rs#L23)). `write` lays out the standard 31-byte layout, all little-endian on the multi-byte
fields:

```
  offset  bytes  field
  0       4      signature  USBC  (0x43425355)   cbw.rs:19, :34
  4       4      tag        the monotonic BOT tag  cbw.rs:35
  8       4      data_len   expected transfer length  cbw.rs:36
  12      1      flags      0x80 IN, 0x00 OUT  cbw.rs:20, :21, :37
  13      1      lun        logical unit  cbw.rs:38
  14      1      cdb_len    CDB length in bytes  cbw.rs:39
  15      16     cdb        the SCSI command block  cbw.rs:40
```

The direction constants are `CBW_FLAG_IN = 0x80` and `CBW_FLAG_OUT = 0x00`
([`src/bot/cbw.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/cbw.rs#L20), `:21`). The signature and data length are written with `to_le_bytes`, so the CBW
framing is little-endian even though the CDB it carries is not; that split is called out below.

### The Command Status Wrapper

[`src/bot/csw.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/csw.rs) parses the 13-byte reply. It requires an exact length of 13, the signature `USBS`
(`0x53425355`), and a status byte no greater than 2 ([`src/bot/csw.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/csw.rs#L19), `:29`, `:33`, `:39`). A wrong
length or a bad signature returns `E_INVAL`; a status byte above 2 returns `E_PHASE`
([`src/bot/csw.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/csw.rs#L30), `:34`, `:40`). On a good parse it returns the echoed tag, the residue, and the
status byte ([`src/bot/csw.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/csw.rs#L36), `:37`, `:38`, `:42`). The parser only validates and decodes; the
accounting of tag mismatch and residue lives in [`src/state/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs) and is described on the
[operations page](/docs/userland/driver-usb-msc/operations/).

## The SCSI command blocks

Four CDBs are built, each a small pure function in [`src/scsi/cdb.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs) that returns a 16-byte buffer and the
active CDB length.

- INQUIRY: opcode `0x12` at byte 0, allocation length 36 at byte 4, CDB length 6
  ([`src/scsi/cdb.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs#L17), `:19`, `:20`, `:21`).
- READ CAPACITY(10): opcode `0x25` at byte 0, CDB length 10 ([`src/scsi/cdb.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs#L24), `:26`, `:27`).
- READ(10): opcode `0x28`, CDB length 10, built through the shared block-CDB helper
  ([`src/scsi/cdb.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs#L30), `:31`).
- WRITE(10): opcode `0x2A`, CDB length 10, same helper ([`src/scsi/cdb.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs#L34), `:35`).

The shared helper `block_cdb` writes the opcode at byte 0, the 32-bit LBA big-endian at bytes 2..6, and
the 16-bit transfer length big-endian at bytes 7..9, returning a CDB length of 10
([`src/scsi/cdb.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs#L38), `:40`, `:41`, `:42`, `:43`).

That is the full SCSI vocabulary the capsule speaks today. There is no MODE SENSE, no REQUEST SENSE, no
TEST UNIT READY, and no sense-data decoding. A device that fails a command reports it in the CSW status
byte, and the capsule counts that byte; it never issues a REQUEST SENSE to learn why.

## The endianness split

This is a real wire detail and easy to get wrong, so it is worth stating on its own. Two different byte
orders meet inside a single request.

- The IPC request body carries the LBA and block count little-endian. `block_request` reads them with
  `from_le_bytes` ([`src/scsi/validate.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/validate.rs#L23), `:24`).
- The SCSI CDB inside the CBW carries the LBA and transfer length big-endian, as SCSI requires.
  `block_cdb` writes them with `to_be_bytes` ([`src/scsi/cdb.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/cdb.rs#L41), `:42`).
- The surrounding CBW framing (signature, tag, data length) is little-endian again
  ([`src/bot/cbw.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/cbw.rs#L34), `:35`, `:36`).

So a READ(10) request arrives little-endian over IPC, the capsule swaps the LBA and count to big-endian
inside the CDB, and wraps the result in a little-endian CBW. The capsule performs that swap so the caller
does not have to.

## The transfer-length guard

READ(10) and WRITE(10) share one validation gate before anything is built. `block_request` requires the
body to be exactly 6 bytes, the block count to be non-zero, and the count not to exceed
`MAX_TRANSFER_BLOCKS` (128); otherwise it returns `E_INVAL` for a bad shape or zero count and `E_OVERFLOW`
for a count over the bound ([`src/scsi/validate.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/validate.rs#L20), `:25`, `:28`, `:29`, [`src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L23)).
The build handlers call it first and bail with the guard's errno on failure
([`src/server/handlers/build_read.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_read.rs#L24), `:25`, [`src/server/handlers/build_write.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_write.rs#L24), `:25`).

The `data_len` written into the CBW is `blocks * BLOCK_BYTES`, and `BLOCK_BYTES` is a fixed 512
([`src/server/handlers/build_read.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_read.rs#L29), [`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22)). The block size is a constant, not
read from the device; a device with a different logical block size is out of scope for this slice.

## How a build handler ties it together

Each build handler is the same short shape: ask `scsi` for a CDB, ask `state` for a fresh tag, fill a
`CommandBlockWrapper`, serialize it into the reply after the header and status word, and reply. INQUIRY is
an IN transfer of 36 bytes, READ CAPACITY(10) an IN transfer of 8 bytes; both take no body
([`src/server/handlers/build_inquiry.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_inquiry.rs#L24), `:28`, [`src/server/handlers/build_capacity.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_capacity.rs#L24), `:28`).
READ(10) is an IN transfer and WRITE(10) an OUT transfer, each after the 6-byte guard, each with
`data_len = blocks * 512` ([`src/server/handlers/build_read.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_read.rs#L28), `:29`, `:33`,
[`src/server/handlers/build_write.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_write.rs#L28), `:29`, `:33`).

Every build handler hard-codes `lun: 0` ([`src/server/handlers/build_inquiry.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_inquiry.rs#L29),
[`src/server/handlers/build_capacity.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_capacity.rs#L29), [`src/server/handlers/build_read.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_read.rs#L34),
[`src/server/handlers/build_write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_write.rs#L34)). There is no multi-LUN support: a device that exposes more than
one logical unit is only ever addressed at LUN 0. That is a deliberate limit of this slice, not a bug.

## Implemented versus stub, at this layer

Implemented and correct on the wire: the 31-byte CBW writer with its little-endian framing, the 13-byte
CSW parser with signature and status validation, the four CDB builders, the big-endian LBA and count
swap, and the bounded transfer guard. What is missing is everything past framing. There is no transfer
call, so a built CBW is returned rather than sent; there is no UASP, no SCSI sense decode, and no support
for any LUN other than 0. READ(10) and WRITE(10) are not placeholder stubs, because they build a correct,
bounded, byte-accurate CBW; but they are not end-to-end I/O either, because the transfer that would make
them read or write real data is the caller's job through xHCI and is not part of this capsule.

## Source map

```
  src/bot/cbw.rs           31-byte Command Block Wrapper struct and writer (USBC, LE framing)
  src/bot/csw.rs           13-byte Command Status Wrapper parser (USBS, status <= 2)
  src/bot/mod.rs           re-exports CommandBlockWrapper, the flags, parse, CommandStatus
  src/scsi/cdb.rs          INQUIRY, READ CAPACITY(10), READ(10), WRITE(10) CDBs (BE LBA/count)
  src/scsi/validate.rs     6-byte block-request guard (LE body, non-zero, <= 128)
  src/scsi/mod.rs          re-exports the CDB builders and block_request
  src/protocol/limits.rs   CBW/CSW lengths, BLOCK_BYTES 512, MAX_TRANSFER_BLOCKS 128
  src/server/handlers/build_inquiry.rs    INQUIRY CBW (IN, 36, LUN 0)
  src/server/handlers/build_capacity.rs   READ CAPACITY(10) CBW (IN, 8, LUN 0)
  src/server/handlers/build_read.rs       READ(10) CBW (IN, blocks*512, LUN 0)
  src/server/handlers/build_write.rs      WRITE(10) CBW (OUT, blocks*512, LUN 0)
```

Every reference above is verified against those trees.
