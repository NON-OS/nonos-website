---
title: "USB MSC operations and the request loop"
description: "This page mirrors the plumbing pillars of capsuledriverusbmsc: the wire under src/protocol/, the request loop and handlers under src/server/, the descriptor probe under src/desc..."
weight: 1
---
This page mirrors the plumbing pillars of `capsule_driver_usb_msc`: the wire under `src/protocol/`, the
request loop and handlers under `src/server/`, the descriptor probe under `src/descriptors/`, and the
process-local accounting under `src/state/`. It is the operational contract of the capsule: how a request
is framed, routed, answered, and remembered. For the command wrappers themselves see the
[BOT and SCSI page](/docs/userland/driver-usb-msc/bot-scsi/); for the capsule as a whole and its identity see the
[overview](/docs/userland/driver-usb-msc/).

## The server loop

The capsule is a single-threaded request server. `_start` initializes the heap and calls `server::run`,
which never returns ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32), `:36`). `run` allocates one receive buffer and one transmit buffer,
each `HDR_LEN + IPC_PAYLOAD_MAX` bytes (20 + 1024), builds a fresh `State`, and enters the loop
([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28), `:29`, `:30`, [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)). Every request reuses those two
buffers; nothing is allocated per message.

Each iteration blocks on `mk_ipc_recv_from` against inbox 0, capturing the sender pid. A non-positive
length or a zero sender is dropped and the loop continues; otherwise the buffer is parsed and dispatched
([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37), `:38`, `:41`, `:42`). Replies go back to the captured sender pid through
`mk_ipc_reply` ([`src/server/respond.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L24), `:31`). The capsule makes no outbound IPC calls of its own; it
is a pure server that receives, decides, and replies. There is no `mk_pio_*`, `mk_dma_*`, `mk_mmio_*`,
`mk_irq_*`, or `mk_device_*` call anywhere in the tree.

## The NUMS envelope

The wire is a 20-byte header the capsule calls `NUMS`, followed by an operation-specific body. The header
is magic `0x4E554D53` ("NUMS"), a `u16` version of 1, the `u16` opcode, a `u16` flags field, a two-byte
pad, a `u32` request id, and a `u32` payload length ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17), `:18`, `:19`,
[`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23), `:28`, `:29`, `:30`, `:31`).

The parser is strict and fails closed. It rejects a buffer shorter than the header, a wrong magic or
version, and, decisively, any message whose declared payload length plus the header does not equal the
received length exactly ([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20), `:25`, `:32`, `:33`). A message that does not parse
is dropped silently by the loop, not answered ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)).

Every reply begins with the same header echoed back: the request's op, flags, and request id are copied,
the pad is zeroed, and the reply payload length is written ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)). After the header
comes a 4-byte little-endian signed status word, then any op-specific payload
([`src/protocol/encode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L29), [`src/server/respond.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L22), `:29`). Status `0` means success; a negative
status is one of the errno constants below.

## The eight opcodes

The opcode constants live in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17), and the dispatcher matches on the 16-bit opcode in
[`src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L22).

| Op | Opcode | Request body | Reply payload after status | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | empty | none (status `0`) | [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20) |
| `OP_PROBE_CONFIG` | `0x0002` | raw USB configuration descriptor | binding count then 8-byte records | [`src/server/handlers/probe_config.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L22) |
| `OP_BUILD_INQUIRY` | `0x0003` | empty | 31-byte BOT CBW for INQUIRY | [`src/server/handlers/build_inquiry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_inquiry.rs#L23) |
| `OP_BUILD_READ_CAPACITY10` | `0x0004` | empty | 31-byte BOT CBW for READ CAPACITY(10) | [`src/server/handlers/build_capacity.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_capacity.rs#L23) |
| `OP_BUILD_READ10` | `0x0005` | `lba_le32, blocks_le16` (6 bytes) | 31-byte BOT CBW for READ(10) | [`src/server/handlers/build_read.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_read.rs#L23) |
| `OP_BUILD_WRITE10` | `0x0006` | `lba_le32, blocks_le16` (6 bytes) | 31-byte BOT CBW for WRITE(10) | [`src/server/handlers/build_write.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_write.rs#L23) |
| `OP_ACCEPT_CSW` | `0x0007` | 13-byte BOT CSW | none; status carries the CSW status byte | [`src/server/handlers/accept_csw.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept_csw.rs#L22) |
| `OP_GET_STATE` | `0x0008` | empty | 48-byte counter snapshot | [`src/server/handlers/get_state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_state.rs#L21) |

The dispatch has one nuance worth stating plainly. The opcodes that must carry no body
(`OP_HEALTHCHECK`, `OP_BUILD_INQUIRY`, `OP_BUILD_READ_CAPACITY10`, `OP_GET_STATE`) are each guarded with a
`body.is_empty()` arm ([`src/server/dispatch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L23), `:25`, `:28`, `:34`). An unknown opcode with an empty
body falls to the `E_BAD_OP` arm, but an unknown opcode carrying a non-empty body falls to a final
catch-all that answers `E_INVAL`, not `E_BAD_OP` ([`src/server/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L35), `:38`). So "unknown op" is
reported as `E_BAD_OP` only when the body happens to be empty; otherwise the malformed-input answer wins.

## The errno set

The error codes are Linux-like negative errnos ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_INVAL     -22  malformed header, body, descriptor, or CSW signature
  E_BAD_OP    -38  unknown opcode with an empty body
  E_NO_MSC    -61  valid descriptor with no SCSI-transparent BOT interface
  E_OVERFLOW  -75  transfer block count above the bound
  E_PHASE     -84  CSW status byte out of range
```

## OP_PROBE_CONFIG and the descriptor probe

`OP_PROBE_CONFIG` is the one operation that takes real input to classify. The handler parses the body as a
USB configuration descriptor, and on success replaces the endpoint snapshot and encodes the bindings into
the reply ([`src/server/handlers/probe_config.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L23), `:25`, `:26`).

The parser under [`src/descriptors/parse.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs) requires at least 9 bytes with a configuration descriptor type
in `raw[1]`, reads the `wTotalLength` field, and refuses a total under 9 bytes or longer than the buffer
([`src/descriptors/parse.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L23), `:26`, `:27`). It then walks fixed-length records, rejecting any record
whose length is under 2 or that runs past the total ([`src/descriptors/parse.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L33), `:35`).

The walk hands each record to a visitor ([`src/descriptors/visitor.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/visitor.rs#L21)). An interface record sets the
current candidate only when the class triple matches mass storage / SCSI-transparent / Bulk-Only Transport
(`0x08` / `0x06` / `0x50`); a non-matching interface clears the candidate
([`src/descriptors/visitor.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/visitor.rs#L34), `:37`, [`src/descriptors/wire.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/wire.rs#L20), `:21`, `:22`). A bulk endpoint
record fills in the bulk-in or bulk-out address and its max packet size, keyed on the direction bit, and a
binding is emitted once both directions are present, up to `MAX_BINDINGS` (8)
([`src/descriptors/visitor.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/visitor.rs#L42), `:47`, `:54`, [`src/protocol/limits.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L19)). A descriptor with zero
bindings answers `E_NO_MSC`; a malformed one answers `E_INVAL` without mutating state
([`src/descriptors/parse.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L41), `:43`). The reply is a 32-bit binding count followed by 8-byte records of
`interface, bulk_in, bulk_out, pad, max_packet_in_le16, max_packet_out_le16`
([`src/descriptors/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/encode.rs#L19), `:23`).

## OP_ACCEPT_CSW and status accounting

`OP_ACCEPT_CSW` closes the loop on a transfer the caller ran. The handler parses the 13-byte CSW (that
parse lives on the [BOT and SCSI page](/docs/userland/driver-usb-msc/bot-scsi/)), folds it into the counters, and returns the CSW's own
status byte as the reply status ([`src/server/handlers/accept_csw.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept_csw.rs#L23), `:25`, `:26`). A parse failure
returns `E_INVAL` or `E_PHASE` instead ([`src/server/handlers/accept_csw.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept_csw.rs#L29)).

The fold is the accounting hook a recovery layer would read ([`src/state/ops.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L36)). A tag that does not
match the last issued tag bumps the phase-error counter; the residue is summed; then status `0` bumps
`csw_ok`, status `1` bumps `csw_failed`, and anything else bumps phase errors again
([`src/state/ops.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L37), `:40`, `:42`, `:43`, `:44`). The capsule does not act on any of this: it counts,
and a caller reads the counts back with `OP_GET_STATE` to decide whether the transport needs a reset. The
reset itself is not implemented here.

## Process-local state

Everything the capsule keeps is process-local and drops on normal userland teardown. `State` holds the
current endpoint binding table, the binding count, a monotonic tag pair, and pass/fail/phase/residue
counters ([`src/state/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/types.rs#L20)). It stores no product strings, serial numbers, raw descriptors, SCSI
payloads, or block data.

The tag counter is the BOT tag source. `next_tag` returns the current tag, advances with a wrapping add
that skips zero, and records the issued value as `last_tag` ([`src/state/ops.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L29), `:31`, `:32`). The
starting `next_tag` is 1 ([`src/state/types.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/types.rs#L37)). `install_bindings` replaces the snapshot and bumps the
probe count ([`src/state/ops.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L23)).

`OP_GET_STATE` serializes a 48-byte little-endian snapshot: `probes`, `csw_ok`, `csw_failed`,
`phase_errors` as u64s, then `binding_count` as a u32, then `residue_bytes` as a u64, then `last_tag` as a
u32 ([`src/state/snapshot.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/snapshot.rs#L20), `:21`, `:25`, `:26`, `:27`). That is the introspection surface a caller
uses to distinguish a transport that never bound from one that bound but is failing its transfers.

## Implemented versus stub, at this layer

The operational plumbing is complete and exercised: the strict envelope parse, the dispatch with its
empty-body guards, the descriptor walk with record bounds, the CSW accounting, and the counter snapshot
are all real. What is not here is any transport. `OP_ACCEPT_CSW` counts a phase error but takes no
recovery action, there is no USB reset path, and every binding and CBW is built for LUN 0 only (the
[BOT and SCSI page](/docs/userland/driver-usb-msc/bot-scsi/) shows the hard-coded LUN in each build handler). The operations layer
frames and remembers; it never moves a byte over the bus.

## Source map

```
  src/main.rs                  _start -> heap_init -> server::run
  src/protocol/header.rs       NUMS magic, version, 20-byte header, Request
  src/protocol/decode.rs       strict request parse (exact-length check)
  src/protocol/encode.rs       response header + status word
  src/protocol/ops.rs          the eight opcode constants
  src/protocol/errno.rs        E_INVAL / E_BAD_OP / E_NO_MSC / E_OVERFLOW / E_PHASE
  src/protocol/limits.rs       payload max, CBW/CSW lengths, binding cap, transfer bound
  src/server/runner.rs         the receive/parse/dispatch/reply loop
  src/server/dispatch.rs       opcode -> handler match, empty-body guards
  src/server/respond.rs        status and payload reply helpers
  src/server/handlers/         one file per op
  src/descriptors/parse.rs     configuration-descriptor walk with bounds
  src/descriptors/visitor.rs   interface class match + bulk endpoint binding
  src/descriptors/wire.rs      descriptor type and class/subclass/protocol constants
  src/descriptors/encode.rs    binding-count + 8-byte binding records
  src/state/types.rs           bindings, tag pair, pass/fail/phase/residue counters
  src/state/ops.rs             install_bindings, next_tag, accept_csw
  src/state/snapshot.rs        48-byte little-endian counter snapshot
```

Every reference above is verified against those trees.
