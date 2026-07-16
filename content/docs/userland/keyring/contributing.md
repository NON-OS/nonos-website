---
title: "Contributing to capsule_keyring"
description: "This page is for a contributor who wants to change the keyring."
weight: 7
---
This page is for a contributor who wants to change the keyring. It covers where the source lives, which
folder owns which behaviour, the exact steps to add an operation, how to build and sign the capsule, and the
code standards a change has to meet. For what the keyring does and how it is put together, read the
[README](/docs/userland/keyring/), the [operations](/docs/userland/keyring/operations/), the [store](/docs/userland/keyring/store/), and the [signing](/docs/userland/keyring/signing/)
pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_keyring/`. It is a `no_std`/`no_main` service capsule: `_start`
initializes the heap and enters `server::run`, which never returns
([`userland/capsule_keyring/src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/main.rs#L29)). The three top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). There is no window, no filesystem, and no network; the capsule holds keys and answers
requests about them.

## Module map

| Folder | Owns | Touch it when |
|--------|------|---------------|
| `src/protocol/` | the wire frame, the op constants, the errno set | you add an opcode or change the frame |
| `src/server/` | the loop, dispatch, the handlers, the RLP and EIP builders, the scratch wipes | you change how a request is handled or add a handler |
| `src/store/` | the key store, the `KeyEntry` model, the owner-checked operations, the wipes | you change the store model or add a store operation |

Inside `src/server/`, `handlers/` holds one file per operation, `eip1559/` and `eip712/` hold the message
builders, `rlp/` holds the RLP primitives, and `wallet_rail/` holds the static rail table. Inside
`src/store/`, `types/` holds the model (the `Store`, `KeyEntry`, `KeyType`, and constants) and the top-level
files hold the operations, one per file.

## Adding an operation

There are four edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17). Keep the numbering contiguous; the wire numbers
   are load-bearing for callers (login, the wallet, and payment all hardcode them).

2. Write the handler as one file per op under `src/server/handlers/`, exposing
   `pub fn op(store: &mut Store, req: Request<'_>, sender_pid: u32) -> Vec<u8>` that returns an encoded
   response ([`src/server/handlers/retrieve.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/retrieve.rs#L22) is the reference shape). Length-check the payload first
   and reply `EINVAL` on a bad length; read `payload_pid` and call `resolve_caller` before touching any key
   (`retrieve.rs:28`); scope every store access to the resolved caller pid. Return errors with
   `encode_response(req.seq, ERRNO, &[])`, never a panic.

3. Re-export the handler from [`src/server/handlers/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L32) and add a match arm in
   [`src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L28) that routes the new opcode to it.

4. If the op touches the store, add the owner-checked method under `src/store/`, one file per operation the
   way [`store/lock.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/lock.rs) and [`store/eth_secret.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/eth_secret.rs) are split, and re-export it through [`src/store/mod.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/mod.rs#L30).
   The method takes a `caller_pid`, looks the id up (returning `StoreError::NotFound` if absent), compares
   `owner_pid` (returning `AccessDenied` on mismatch), then acts.

If the op handles a secret, wipe every transient copy with `zeroize32` ([`src/server/zeroize.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/zeroize.rs#L17)) or a
volatile loop on every return path, including the error branches, matching the existing signers
([`src/server/handlers/sign_eth_transfer.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sign_eth_transfer.rs#L55), `:60`). A wallet secret must never appear in a reply body.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_keyring/Capsule.mk:20`.

```
  make nonos-mk-keyring               build the capsule ELF               capsule.mk:182
  make nonos-mk-keyring-sign          id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-keyring-verify        verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-keyring-keys    assert the per-capsule signing keys exist   capsule.mk:184
```

For a bootable image and a round-trip test:

```
  make nonos-mk-keyring-prod          kernel profile with microkernel-keyring   Makefile:910
  make nonos-mk-boot-keyring          the boot round-trip harness               Makefile:1384
```

`nonos-mk-boot-keyring` runs [`tests/boot/keyring_round_trip.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/tests/boot/keyring_round_trip.sh) (`Makefile:1385`) and is part of
`make nonos-mk-test` (`Makefile:1478`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as a
  negative status through `encode_response`, never a panic.
- One unit per file. New operations are one handler per file under `handlers/` and one store method per file
  under `store/`, and `mod.rs` is used only for re-exports, matching the existing tree.
- Wipe every secret on every branch. A new path that reads a secret must zero it before it returns, on the
  success and the error branches alike, the way the signers do.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_keyring/src/main.rs             _start -> server::run; the three modules
  userland/capsule_keyring/src/protocol/types.rs   the opcode constants
  userland/capsule_keyring/src/server/handlers/    one file per op
  userland/capsule_keyring/src/server/handlers/mod.rs   the handler re-exports
  userland/capsule_keyring/src/server/dispatch.rs  the op -> handler match
  userland/capsule_keyring/src/server/caller.rs    resolve_caller
  userland/capsule_keyring/src/server/zeroize.rs   the scratch wipe
  userland/capsule_keyring/src/store/mod.rs        the store re-exports
  userland/capsule_keyring/Capsule.mk              slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                              the nonos-mk-keyring[-sign|-verify] target templates
  Makefile                                         the -prod and -boot image and round-trip targets
```

Every reference above is verified against those trees.
