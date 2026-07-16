---
title: "Debugging the ramfs capsule"
description: "The capsule speaks only in request and reply frames, so almost every failure shows up as a status value on the wire or as a request that never gets a reply."
weight: 4
---
The capsule speaks only in request and reply frames, so almost every failure shows up as a status value on
the wire or as a request that never gets a reply. This page maps symptoms to the code that produced them.
Read [operations.md](/docs/userland/ramfs/operations/) for the frame layout and the full errno set.

## Read the status field first

On any operation, the four bytes at offset 4 of the reply are a signed `i32` status
([`src/protocol/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L21)). A non-negative value is success, and on read and write it is also a length.
A negative value is one of five errno codes ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

| Status | Name | Most likely cause |
|--------|------|-------------------|
| -2 | ENOENT | opened a missing path without `OPEN_FLAG_CREATE`, or used a handle the table does not hold |
| -5 | EIO | a `crypto_random`, `crypto_encrypt`, or `crypto_decrypt` syscall returned negative |
| -13 | EACCES | the handle belongs to a different process pid than the sender |
| -22 | EINVAL | short or malformed payload, non-UTF-8 path, or an unknown opcode |
| -24 | EMFILE | the handle table hit its 1024-handle cap |

## No reply at all

If a request produces no response, the runner dropped it before dispatch. Two things cause that. Either the
frame was shorter than the eight-byte header or its reserved field at offset 6 was nonzero, so
`decode_request` returned `None` and the loop skipped it ([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23)); or the IPC receive
itself returned a non-positive length and was skipped ([`src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L35)). Check that the sender is
zeroing the reserved `u16` in the header and sending at least eight bytes.

## EINVAL when the request looks right

`EINVAL` comes from length checks and parsing, not from state. Confirm the payload actually reaches the
declared size: open needs at least six bytes and then `6 + path_len` bytes for the path
([`src/server/handlers/open.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/open.rs#L33)), read needs 20 ([`src/server/handlers/read.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L26)), write and truncate
need 16 ([`src/server/handlers/write.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L30), [`src/server/handlers/truncate.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/truncate.rs#L30)), and close needs 8
([`src/server/handlers/close.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L23)). A path that is not valid UTF-8 also yields `EINVAL` on open
([`src/server/handlers/open.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/open.rs#L47)). An opcode outside 1 through 5 falls through the dispatch match to
`EINVAL` ([`src/server/dispatch.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L38)).

## EACCES on a handle you own

The handle table stamps each handle with the opening process pid and checks it on every read, write,
truncate, and close ([`src/handles.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L49)). `EACCES` means the sender pid on the request does not match the
stored owner. If the caller is the kernel it should present pid 0, which bypasses the check; a nonzero pid
that does not match will be denied. Confirm the request is coming from the process that opened the handle.

## EIO and the crypto path

`EIO` is always a `StoreError::CryptoFailure` ([`src/store/types.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L33)), and there are exactly three places
it originates, all guarded by a negative syscall return:

- key or nonce generation failed: `fresh_key` or `fresh_nonce` got a negative `crypto_random`
  ([`src/store/crypto/fresh_key.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/fresh_key.rs#L24), [`src/store/crypto/fresh_nonce.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/fresh_nonce.rs#L24)).
- a seal failed: `crypto_encrypt` returned negative ([`src/store/crypto/seal.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/seal.rs#L36)).
- an open failed: `crypto_decrypt` returned negative ([`src/store/crypto/open.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/open.rs#L36)).

A decrypt failure on data that was written successfully points at tampered or corrupted ciphertext: the
ChaCha20-Poly1305 tag check failed. Because there is no AAD and the nonce is stored beside the ciphertext,
the usual culprit is memory corruption of the `File` rather than a wrong nonce.

## Empty reads that should return data

A read that returns zero bytes with a success status is not an error. The store returns an empty vector
when the file's ciphertext is empty ([`src/store/read.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/read.rs#L26)), when the offset is at or past the plaintext
length ([`src/store/read.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/read.rs#L32)), or when the clamped window is empty. Check the offset and count against the
actual file size, remembering that a fresh `ensure` leaves the file empty until the first write.

## Short writes and file growth

Write returns the length of the data it was handed, not the new file size ([`src/store/write.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/write.rs#L50)). If a
write extends past the current end the store zero-fills the gap before splicing ([`src/store/write.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/write.rs#L41)),
so a write at a high offset silently grows the file. This is intended; it is not a bug to chase.

## Source map

The status and errno definitions are [`src/protocol/encode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs) and [`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs). The decode and
receive guards are [`src/protocol/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs) and [`src/server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs). The handler length checks are under
`src/server/handlers/`. Ownership is [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs). The crypto failure sites are `src/store/` and
`src/store/crypto/`. Every reference above is verified against those trees.
