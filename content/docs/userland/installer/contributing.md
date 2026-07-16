---
title: "Contributing to capsule_installer"
description: "This page is for a contributor who wants to change the installer."
weight: 4
---
This page is for a contributor who wants to change the installer. It covers where the source lives, which
module owns which behaviour, the exact steps to add an operation, how to build and sign the capsule, and
the code standards a change has to meet. For what the installer does and how it is put together, read the
[README](/docs/userland/installer/), the [operations](/docs/userland/installer/operations/), and the [verified-load](/docs/userland/installer/verified-load/) pages in
this folder.

## Where the source lives

The capsule is at `userland/capsule_installer/`. It is a `no_std`/`no_main` server capsule: `_start`
initializes the heap and calls `server::run`, exiting with code 1 if the heap fails
([`userland/capsule_installer/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/main.rs#L28)). The two top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the wire codec: the frame, the op and errno constants, `Request` | you change the frame format or add an op or errno constant |
| `src/server/` | the loop, the dispatch table, service discovery, the field decoders, and the handlers | you change how a request is served or add an operation |

Inside `src/server/`, `handlers/` holds one file per operation body, `dispatch.rs` routes an opcode to a
handler, `runner.rs` is the receive/dispatch/reply loop, `discover.rs` and `pay_call.rs` are the payment
service lookup and settlement call, `fields.rs`/`word32.rs`/`addr20.rs` are the `InstallReq` decoder and
byte extractors, and `selfinstall.rs` is the feature-gated boot self-verification
([`src/server/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs#L17)).

## Adding an operation

There are three edits, and the dispatch wiring is the load-bearing one.

1. Define the opcode as a `pub const OP_<NAME>: u16` in [`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17), next to the existing
   four, and re-export it from the `pub use types::{...}` list in [`src/protocol/mod.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L23).

2. Write the handler as one file under `src/server/handlers/`, exposing
   `pub fn <name>(req: Request<'_>) -> Vec<u8>` that returns an `encode_response`
   ([`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21) is the smallest reference shape; the load handlers show the
   bounds-checked pattern for a body). Bounds-check the payload before indexing it, fold every offset with
   `checked_add`, and return `encode_response(req.seq, EINVAL, &[])` on any malformed input, the way both
   load handlers do ([`src/server/handlers/load_store.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_store.rs#L33),
   [`src/server/handlers/load_by_name.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_by_name.rs#L43)). Re-export it from [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).

3. Wire it into the match in [`src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L26). Add a `OP_<NAME> => handlers::<name>(req)` arm.
   Leave the `_ =>` arm as the `EINVAL` fall-through so any opcode you do not handle is rejected cleanly
   ([`src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L31)).

If the new operation performs a load, build a `CapsuleLoadRequest` and call `mk_capsule_load` exactly as
the existing load handlers do, keeping the artifact blobs owned by the handler's stack frame across the
syscall ([`src/server/handlers/load_by_name.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_by_name.rs#L65), `:78`, `:80`). Never verify anything in the handler;
verification is the kernel's, and duplicating it here would be a second source of truth. See the
[verified-load](/docs/userland/installer/verified-load/) page for why.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_installer/Capsule.mk:21`.

```
  make nonos-mk-installer              build the capsule ELF               capsule.mk:182
  make nonos-mk-installer-sign         id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-installer-verify       verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-installer-keys   assert the per-capsule signing keys exist  capsule.mk:184
```

The top-level `Makefile` includes the installer's `Capsule.mk` and folds its verify and artifacts into the
image build (`Makefile:654`, `Makefile:724`, `Makefile:1077`).

The `nonos-autorun-install` feature is a cargo feature on the capsule (`Cargo.toml:26`) and is set as a
default build feature in `Capsule.mk:13`. It compiles the headless self-verification in
[`src/server/selfinstall.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/selfinstall.rs); it adds no callable operation, so it does not change the wire protocol.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as an
  `encode_response` with a negative status, never a panic; the release profile is `panic = "abort"`
  (`Cargo.toml:33`).
- One unit per file. New operations are one handler per file under `src/server/handlers/`, and `mod.rs`
  is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_installer/src/main.rs        _start -> heap_init -> server::run; the two modules
  userland/capsule_installer/src/protocol/      the frame codec and the op/errno constants
  userland/capsule_installer/src/server/        the loop, dispatch, discovery, and handlers
  userland/capsule_installer/src/server/handlers/   one file per operation body
  userland/capsule_installer/src/server/selfinstall.rs   the nonos-autorun-install self-verification
  userland/capsule_installer/Capsule.mk         slug, ports, mask; includes the generated targets
  userland/capsule_installer/Cargo.toml         the feature flag and the panic=abort profile
  nonos-mk/capsule.mk                           the nonos-mk-installer[-sign|-verify] target templates
  Makefile                                      the image-build include and artifact folding
```

Every reference above is verified against those trees.
