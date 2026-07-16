---
title: "Operations and the wire protocol"
description: "This page mirrors src/protocol/ and src/server/."
weight: 1
---
This page mirrors `src/protocol/` and `src/server/`. Together they are the front half of the capsule: the
protocol module defines the on-wire framing and opcodes, and the server module receives messages, decodes
them, dispatches by opcode, and runs the five operation handlers. The back half, the encrypted store, is
covered in [store.md](/docs/userland/ramfs/store/).

## The message frame

Every request and every response begins with an eight-byte little-endian header, `HDR_LEN = 8`
([`src/protocol/types.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L28)).

A request header is sequence, opcode, and a reserved field:

```
  offset  size  field
  0       4     seq      request sequence number (u32 le)
  4       2     op       opcode (u16 le)
  6       2     reserved must be zero
```

`decode_request` refuses any buffer shorter than the header and any frame whose reserved field is nonzero,
returning `None` so the runner drops it silently ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). On success it returns a
`Request` borrowing the payload that follows the header ([`src/protocol/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L30),
[`src/protocol/decode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L29)).

A response header is the echoed sequence and a signed status, followed by the payload:

```
  offset  size  field
  0       4     seq      echoed from the request (u32 le)
  4       4     status   i32 le: >= 0 on success, negative errno on failure
  8       ..    payload  operation-specific bytes
```

`encode_response` builds exactly that: seq, then `status.to_le_bytes()`, then the payload
([`src/protocol/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L21)). The status doubles as a length on the read path, where a non-negative value
is the number of bytes returned.

The payload readers `read_u16_le`, `read_u32_le`, and `read_u64_le` are bounds-checked with
`checked_add` and `slice::get`, so a short or malformed payload yields `None` rather than a panic
([`src/protocol/decode.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L32)).

## The five operations

The opcodes are fixed constants ([`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17)):

| Op | Value | Handler | Request payload after header | Success reply payload |
|----|-------|---------|------------------------------|-----------------------|
| open | 1 | `handlers::open` | `flags:u32`, `path_len:u16`, `path:bytes` | `handle:u64` |
| close | 2 | `handlers::close` | `handle:u64` | empty |
| read | 3 | `handlers::read` | `handle:u64`, `offset:u64`, `count:u32` | up to `count` bytes, status is the length |
| write | 4 | `handlers::write` | `handle:u64`, `offset:u64`, `data:bytes` | empty, status is bytes written |
| truncate | 5 | `handlers::truncate` | `handle:u64`, `length:u64` | empty |

Open carries two flags ([`src/protocol/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L23)):

| Flag | Value | Effect |
|------|-------|--------|
| `OPEN_FLAG_CREATE` | `0x1` | create the file if it does not exist; without it a missing path is `ENOENT` |
| `OPEN_FLAG_TRUNCATE` | `0x2` | truncate the file to zero length after opening |

## Receive, decode, dispatch

The runner is the single loop. It builds an 8192-byte receive buffer, an empty `Store`, and an empty
`HandleTable`, then repeats: `mk_ipc_recv_from` blocks for a message and reports the sender pid; a
non-positive length is skipped; the bytes are decoded, and a decode miss is skipped; the request is
dispatched with the store, the handle table, and the sender pid; and the response is sent to
`KERNEL_REPLY_ENDPOINT` ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)). That endpoint constant is `0x1_0000_0001`, which is
`4294967297`, the value named in the reply endpoint in the manifest ([`src/protocol/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L26)).

Dispatch is a flat match on the opcode. Open, read, write, and truncate each receive the store, the handle
table, the request, and the sender pid; close needs only the handle table. Any unknown opcode is answered
with `EINVAL` ([`src/server/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L32)).

## The handle table

An open returns an opaque `u64` handle, not a path. The `HandleTable` maps each handle to a path and the
pid of the process that opened it, capped at `MAX_HANDLES = 1024` ([`src/handles.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L20)). Handle ids start
at 1 and advance with `wrapping_add`, so id 0 is never issued ([`src/handles.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L41)).

Ownership is enforced on every use. `path_for` and `remove` reject a handle whose stored owner pid does not
match the sender, returning `HandleError::Denied` ([`src/handles.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L49), [`src/handles.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L58)). One process
cannot read, write, truncate, or close another process's handle. There is a deliberate exception: a sender
pid of 0, the kernel, bypasses the owner check, which is how the kernel-side client operates on behalf of
callers. A full table returns `None` from `insert`, which the open handler turns into `EMFILE`
([`src/handles.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L38)).

## The handlers

Each handler validates its payload length first, resolves state, and encodes a response. All of them fail
closed with an errno rather than panicking.

Open parses `flags` and `path_len`, bounds-checks that the payload actually holds `path_len` bytes, and
rejects non-UTF-8 paths with `EINVAL` ([`src/server/handlers/open.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/open.rs#L47)). If the file is absent and
`OPEN_FLAG_CREATE` is not set it answers `ENOENT`; otherwise it creates the file through `store.ensure`,
mapping a store error to `EIO` ([`src/server/handlers/open.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/open.rs#L51)). If `OPEN_FLAG_TRUNCATE` is set it
truncates to zero. It then inserts a handle owned by the sender and returns the id, or `EMFILE` if the
table is full ([`src/server/handlers/open.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/open.rs#L62)).

Read parses handle, offset, and count, resolves the path under ownership, and calls `store.read_at`. The
returned bytes are the payload and their length is the status ([`src/server/handlers/read.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L46)).

Write parses handle and offset, treats the remainder of the payload as the data, resolves the path, and
calls `store.write_at`. The status is the number of bytes written ([`src/server/handlers/write.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L47)).

Truncate parses handle and length, resolves the path, and calls `store.truncate`
([`src/server/handlers/truncate.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/truncate.rs#L46)).

Close parses the handle and removes it from the table, which also enforces ownership
([`src/server/handlers/close.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L30)).

## The errno set

The status field carries a small fixed set of signed errno values ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

| Name | Value | Meaning in this capsule |
|------|-------|-------------------------|
| `ENOENT` | -2 | file or handle not found |
| `EIO` | -5 | a store or crypto operation failed (`StoreError::CryptoFailure`) |
| `EACCES` | -13 | the handle belongs to another process (`HandleError::Denied`) |
| `EINVAL` | -22 | malformed request: short payload, bad UTF-8 path, or unknown opcode |
| `EMFILE` | -24 | the handle table is full (1024 handles) |

`StoreError` has exactly two variants, `NotFound` and `CryptoFailure`, mapped to `ENOENT` and `EIO`
respectively by the read, write, and truncate handlers ([`src/store/types.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L33)).

## Source map

The wire codec, opcodes, flags, and errno constants are `src/protocol/` (`types.rs`, `decode.rs`,
`encode.rs`, `errno.rs`, `mod.rs`). The receive loop, dispatch table, and five handlers are `src/server/`
(`runner.rs`, `dispatch.rs`, `handlers/`). The handle table is [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs). The store and crypto
symbols named here are defined under `src/store/`, documented in [store.md](/docs/userland/ramfs/store/). Every reference above
is verified against those trees.
