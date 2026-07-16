---
title: "Contributing to the ramfs capsule"
description: "This page covers where to work in the tree, how to make the common kinds of change without breaking the protocol or the crypto invariants, and the build and code standards the c..."
weight: 3
---
This page covers where to work in the tree, how to make the common kinds of change without breaking the
protocol or the crypto invariants, and the build and code standards the capsule holds itself to. Read
[operations.md](/docs/userland/ramfs/operations/) and [store.md](/docs/userland/ramfs/store/) first; this page assumes you know the layout.

## Where the work goes

| You are changing | Work in | Also touch |
|------------------|---------|------------|
| the wire format or an opcode | `src/protocol/` | the kernel mirror `src/fs/ramfs_capsule/protocol/` must stay byte-identical |
| dispatch or a handler | `src/server/` | usually nothing else |
| the file map or an operation's semantics | `src/store/` | the handler that calls it, if its result shape changes |
| the crypto model | `src/store/crypto/` | nothing else; keep the wrappers thin |
| handle ownership or limits | [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs) | nothing else |

The single most important rule: the on-wire protocol has two implementations, the capsule server here and
the kernel client under `src/fs/ramfs_capsule/`. They are not generated from one source. Any change to the
header, an opcode, a flag, a payload layout, or an errno value must be made in both, or the two sides stop
agreeing and every request fails to decode.

## Adding an operation

1. Assign the next opcode in [`src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs) and add it to the `pub use` in
   [`src/protocol/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs).
2. Add the matching constant and encoder in the kernel mirror `src/fs/ramfs_capsule/protocol/`.
3. Add a handler under `src/server/handlers/`, re-export it from [`handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mod.rs), and add the arm to the
   match in [`src/server/dispatch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs).
4. Validate the payload length before reading any field, and use the bounds-checked `read_*_le` helpers so
   a short payload returns `EINVAL` rather than panicking.
5. If the operation touches file bytes, resolve the handle through `handles.path_for` under the sender pid
   so ownership is enforced, then call into the store; never touch the `BTreeMap` directly from a handler.

## Invariants a change must keep

- No panics. Every handler and every store method returns a result or an errno. Length checks come before
  field reads; buffer sizes are computed with saturating or checked arithmetic.
- Fail closed. An unknown opcode, a malformed payload, or a crypto failure is answered with an errno, never
  by leaking or by faulting.
- Plaintext is transient. The store must never hold a decrypted buffer past the single operation that needs
  it. If you add a code path that decrypts, it must drop the plaintext before returning.
- A fresh nonce per seal. If you add or change a path that calls `seal`, it must first call `fresh_nonce`
  and store the result on the file. Reusing a nonce under a file's fixed key is a break, not a style nit.
- Ownership is not optional. Any operation on an existing handle goes through the owner check. The only
  bypass is sender pid 0, the kernel; do not add others.
- No new capabilities. The mask is IPC, Memory, Crypto. If a change seems to need a filesystem, network, or
  driver right, the design is wrong for this capsule; that work belongs behind a peer service.

## Build and standards

The capsule is `no_std` and `no_main` with `extern crate alloc`; there is no standard library
([`src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L17)). Use `core` and `alloc` only. Keep files small and single-purpose, the way the tree
already is: one handler per file, one crypto primitive per file. Every file carries the AGPL header. Run
`cargo fmt` and keep `cargo clippy` clean before proposing a change.

## Source map

The protocol lives in `src/protocol/` and its kernel twin in `src/fs/ramfs_capsule/protocol/`. The server
and handlers are `src/server/`. The store and crypto are `src/store/`. The handle table is
[`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs) and the entry point is [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs). Every reference above is verified against those
trees.
