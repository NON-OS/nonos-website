---
title: "Contributing to capsule_payment"
description: "This page is for a contributor changing the payment capsule."
weight: 4
---
This page is for a contributor changing the payment capsule. It covers where the source lives, which
folder owns which behaviour, the exact steps to add an operation, how to build and sign the capsule, and
the code standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/payment/), the [operations](/docs/userland/payment/operations/) page, and the [signing](/docs/userland/payment/signing/) page in this
folder.

## Where the source lives

The capsule is at `userland/capsule_payment/`. It is a `no_std`/`no_main` service: `_start` initializes
the heap and enters `server::run`, which never returns ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)). The three top-level modules are
declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the wire codec: header decode, reply framing, the opcodes and errnos | you change the frame format or add an opcode constant |
| `src/server/` | the recv/dispatch/send loop, the four handlers, the receipt marshalers, keyring discovery and the sign call, the token registry | you change what an operation does or how a receipt is assembled |
| `src/store/` | `State`: the per-payer nonce map and the bounded outbox | you change nonce ordering, the outbox bound, or the drain semantics |

Inside `src/server/`, `handlers/` holds the four operation bodies, `token/` holds the static registry and
its encoder, and the marshaling helpers (`fields`, `record`, `word32`, `u64_word`, `addr20`, `epoch`,
`expiry`) plus `discover` and `sign_call` sit directly under `server/` ([`src/server/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs#L17)).

## Adding an operation

There are three edits, and the dispatch wiring is the load-bearing one. The default arm already returns
`EINVAL` for an unknown opcode, so a missing arm fails closed.

1. Add the opcode constant in [`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17), next to the existing `OP_*` values, and
   re-export it from [`src/protocol/mod.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L23).
2. Write the handler as one file under `src/server/handlers/`, exposing a `pub fn` that takes the
   `Request` (and `&mut State` if it touches state) and returns a `Vec<u8>` built with `encode_response`,
   the way `pay.rs` and `drain.rs` do. Re-export it from [`src/server/handlers/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L22).
3. Wire the opcode into the match in [`src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L26).

Keep the receipt marshaling helpers as the single source of the on-wire layout. If an operation touches
the receipt fields, the keyring request in [`src/server/sign_call.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sign_call.rs), the drained record in
[`src/server/record.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/record.rs), and the `ReceiptInput` in [`src/server/fields.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/fields.rs) must stay in lockstep with the
field order; the [operations](/docs/userland/payment/operations/) and [signing](/docs/userland/payment/signing/) pages spell out the byte offsets
those three share.

## Build and sign

The per-slug make targets are generated from the shared capsule macro (`nonos-mk/capsule.mk:158`) from the
slug `payment`, and the capsule is wired into the build because the top-level Makefile includes its
`Capsule.mk` (`Makefile:653`).

```
  make nonos-mk-payment                build the capsule ELF                       capsule.mk:182
  make nonos-mk-payment-sign           id cert, manifest, attestation trailer      capsule.mk:261
  make nonos-mk-payment-verify         verify artifacts vs the trust anchor        capsule.mk:263
  make nonos-mk-check-payment-keys     assert the per-capsule signing keys exist   capsule.mk:184
```

The `-sign`, `-verify`, and `-check-<slug>-keys` targets are declared `.PHONY` together with the base
target at `capsule.mk:158`. There is no `nonos-mk-payment-prod` or desktop-image target for this capsule,
because it is not part of any desktop profile and is not spawned at boot; the [README](/docs/userland/payment/) states
what that means.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as an
  errno in the reply status, never a panic; the release profile is `panic = "abort"`
  (`Cargo.toml:26`).
- One unit per file. New operations are one handler per file under `src/server/handlers/`, and `mod.rs` is
  used only for re-exports, matching [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs) and [`src/store/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/mod.rs).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  existing module.

## Source map

```
  userland/capsule_payment/src/main.rs              _start -> heap_init -> server::run; the three modules
  userland/capsule_payment/src/protocol/            the opcodes, header decode, and reply framing
  userland/capsule_payment/src/server/handlers/     the four operation bodies
  userland/capsule_payment/src/server/              the marshalers, keyring discovery, and the sign call
  userland/capsule_payment/src/store/               State: the nonce map and the bounded outbox
  userland/capsule_payment/Capsule.mk               slug, ports, mask; includes the generated targets
  userland/capsule_payment/Cargo.toml               the panic = "abort" release profile
  nonos-mk/capsule.mk                               the nonos-mk-payment[-sign|-verify] target templates
  Makefile                                          includes the capsule at line 653
```

Every reference above is verified against those trees.
