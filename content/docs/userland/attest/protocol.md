---
title: "The Protocol"
description: "This page mirrors userland/capsuleattest/src/protocol/."
weight: 2
---
This page mirrors `userland/capsule_attest/src/protocol/`. It defines the wire format the capsule speaks:
a fixed 20-byte header, the five opcodes, the error codes, the parse and response builders, and the buffer
limits. Nothing here allocates or blocks; the module is pure framing over byte slices. The module re-exports
its public surface from [`src/protocol/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L24).

Back to the [hub](/docs/userland/attest/).

## The header

The header is a 20-byte NCMP-style frame. The three constants that define it live in
[`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17):

```
  MAGIC    u32   0x41545354 ("ATST")
  VERSION  u16   1
  HDR_LEN  usize 20
```

The layout, as written by `encode.rs` and read by `decode.rs`
([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23), [`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)):

```
  offset 0    magic       u32   0x41545354 ("ATST")
  offset 4    version     u16   1
  offset 6    op          u16   the operation opcode
  offset 8    flags       u16   echoed back in the reply
  offset 10   reserved    u16   zero-filled on reply    (encode.rs:24)
  offset 12   request_id  u32   echoed back in the reply
  offset 16   payload_len u32   length of the payload that follows
```

The parsed form is a three-field `Request` carrying the op, the flags, and the request_id
([`src/protocol/header.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L21)); the magic, version, reserved, and payload_len are validated at parse time
and not carried forward.

## Parsing a request

`parse` takes the received buffer and returns either the `Request` and its payload slice, or the same
`Request` (as far as it could be read) and an error status ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). It validates in
this order:

1. A buffer shorter than the 20-byte header is rejected with `E_BAD_LEN` before any field is read
   (`decode.rs:20`). The `Request` returned in this case is a zeroed placeholder (`decode.rs:41`).
2. The op, flags, and request_id are read from their offsets so they can be echoed back even on error
   (`decode.rs:23`).
3. A magic other than `0x41545354` is rejected with `E_BAD_MAGIC` (`decode.rs:28`).
4. A version other than 1 is rejected with `E_BAD_VERSION` (`decode.rs:31`).
5. A buffer shorter than the header plus the declared `payload_len` is rejected with `E_BAD_LEN`
   (`decode.rs:35`).

On success it returns the payload slice `buf[20..20 + payload_len]` (`decode.rs:38`). For this capsule
every operation carries no request payload, so that slice is normally empty and the router ignores it
([`src/server/handlers/router.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L25)). The little-endian field readers `u16_le` and `u32_le` are the only
byte arithmetic in the module (`decode.rs:45`, `decode.rs:49`).

## Building a response

Two functions in [`src/protocol/encode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs) build every reply. `response_header` writes the 20-byte header,
reusing the request's `op`, `flags`, and `request_id`, zero-filling the reserved field, and stamping the
outgoing `payload_len` (`encode.rs:19`). `write_status` writes the 4-byte little-endian status word
immediately after the header, at offset 20 (`encode.rs:29`).

Every reply therefore begins with the echoed header and a status word. A status of 0 means success; a
negative status is one of the error codes below. The `respond` helpers in the server module wrap these two
builders into the status-only and with-payload reply shapes; see [operations.md](/docs/userland/attest/operations/).

## Opcodes

Five opcodes, all with no request payload ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)):

| Op | Value | Meaning |
|----|-------|---------|
| `OP_HEALTHCHECK` | `0x0001` | liveness ping |
| `OP_PROOF_SUMMARY` | `0x0002` | product name, tagline, version |
| `OP_PROOF_INVARIANTS` | `0x0003` | the six invariants |
| `OP_PROOF_BOOT` | `0x0004` | boot timestamp and fixed label |
| `OP_PROOF_CAPSULE_LIST` | `0x0005` | the authored capsule-mask table |

The `PROOF_` prefix names the subject of the statements, the system's proofs and properties, not a proof
computed on demand. What each opcode returns and why it is authored rather than computed is covered in
[operations.md](/docs/userland/attest/operations/) and [attestation-data.md](/docs/userland/attest/attestation-data/).

## Error codes

The negative status words the capsule can return ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

| Status | Value | Meaning | Where |
|--------|-------|---------|-------|
| `E_INVAL` | `-22` | a reply would not fit the output buffer | `errno.rs:17`, e.g. `proof_boot.rs:25`, `proof_invariants.rs:31`, `proof_capsule_list.rs:43` |
| `E_BAD_OP` | `-38` | the opcode is not one of the five | `errno.rs:18`, `router.rs:35` |
| `E_BAD_MAGIC` | `-71` | header magic is not `0x41545354` | `errno.rs:19`, `decode.rs:28` |
| `E_BAD_LEN` | `-90` | buffer shorter than the header, or a short payload | `errno.rs:20`, `decode.rs:20`, `decode.rs:35` |
| `E_BAD_VERSION` | `-93` | header version is not 1 | `errno.rs:21`, `decode.rs:31` |

## Limits

Two size constants bound the module ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)):

```
  STATUS_LEN       4        the 4-byte status word after the header
  IPC_PAYLOAD_MAX  65536    the 64 KiB receive and reply buffer size
```

`STATUS_LEN` is the fixed prefix every reply payload carries. `IPC_PAYLOAD_MAX` is the size of both buffers
the server allocates once at startup ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)); every handler bounds-checks its writes
against it and returns `E_INVAL` rather than overrunning.

## Source map

```
  src/protocol/mod.rs      the module's public re-exports
  src/protocol/header.rs   MAGIC 0x41545354, VERSION 1, HDR_LEN 20, the Request struct
  src/protocol/decode.rs   parse: validate magic/version/length, return Request + payload
  src/protocol/encode.rs   response_header + write_status
  src/protocol/ops.rs      the five opcodes 0x0001..0x0005
  src/protocol/errno.rs    the E_* status codes
  src/protocol/limits.rs   STATUS_LEN 4, IPC_PAYLOAD_MAX 64 KiB
```

Every reference above is verified against `userland/capsule_attest/src/protocol/`.
</content>
