---
title: "Contributing to capsule_market"
description: "This page is for a contributor who wants to change the market."
weight: 5
---
This page is for a contributor who wants to change the market. It covers where the source lives, which
folder owns which behaviour, the steps to add an op, how to build and sign the capsule, and the code
standards a change has to meet. For what the market does and how it is put together, read the
[README](/docs/userland/market/), the [protocol](/docs/userland/market/protocol/) page, the [verification](/docs/userland/market/verification/) page, and the
[readiness](/docs/userland/market/readiness/) page.

## Where the source lives

The capsule is at `userland/capsule_market/`. It is a `no_std`/`no_main` userland service: `_start`
initializes the heap, constructs an empty store, constructs the verifier the build selected, and hands both
by reference to `server::run`, which never returns ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41), [`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46), [`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)).
The seven top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the wire header, op discriminants, errnos, and the request/response codecs | you change the frame, add an op number, or add an errno |
| `src/server/` | the recv/decode/dispatch/reply loop and every handler | you change how a request is routed or what a handler replies |
| `src/ingest/` | blob decode plus the verification pipeline and its four errors | you change how an index is accepted or refused |
| `src/verify/` | the `Verifier` trait and its two implementations | you change the signature backend |
| `src/bootstrap_trust/` | the baked trusted operator keys and the trust test | you rotate or add a trusted operator |
| `src/install_ready/` | the six-field readiness evaluator and the running-arch triple | you change what makes a release installable |
| `src/store/` | the single accepted index and its read/write helpers | you change the stored state or its lookups |

The `mod.rs` files are re-export only. One unit per file: each handler, each store operation, and each
codec helper is its own file, and the folder groups them.

## Adding an op

There are three edits.

1. Add the op discriminant in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17). Op numbers are the only routing key, so a new op is
   a new `u16` constant next to the existing six.

2. Write the handler as its own module under `src/server/handlers/`, following the existing shape: pull the
   accepted index or return `E_NODATA`, parse the body with a length-prefix helper or return `E_INVAL`,
   assemble the reply into the transmit slot with `body_slot`, and send it with `reply_with_body`.
   [`src/server/handlers/get_app/handle.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_app/handle.rs#L28) is the shortest full example of a data reply, and
   [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20) is the shortest example of a status-only reply. Re-export the handler
   from [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).

3. Wire the op into the dispatch match in [`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57). An unmatched op already falls to the
   `_ => reply_status(&mut tx, &req, E_INVAL)` arm (`runner.rs:64`), so the new arm is what makes the op
   reachable.

If the change is a new signature backend rather than a new op, it is a new type implementing `Verifier`
([`src/verify/trait_def.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/trait_def.rs#L23)) and a matching `#[cfg]` arm in [`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34); do not verify signatures
inline in a handler. See the [verification](/docs/userland/market/verification/) page for the trait contract.

## Build and sign

The per-slug make targets are generated from the `NONOS_CAPSULE_RULES` template
(`nonos-mk/capsule.mk:156`, `capsule.mk:158`) and pulled in through
`userland/capsule_market/Capsule.mk:20`, which is itself included from the top-level `Makefile:652`.

```
  make nonos-mk-market               build the capsule ELF                    capsule.mk:182
  make nonos-mk-market-sign          id cert, manifest, attestation trailer   capsule.mk:261
  make nonos-mk-market-verify        verify signed artifacts vs trust anchor  capsule.mk:263
  make nonos-mk-check-market-keys    assert the per-capsule signing keys exist capsule.mk:184
```

The manifest and attestation are built from `CAPSULE_REQUIRED_CAPS`, which the template passes as both
`--required-caps` and `--capability-mask` (`nonos-mk/capsule.mk:230`, `capsule.mk:254`). That is the value
declared `0x19` in `Capsule.mk:17`; note the arithmetic-slip caveat on the [README](/docs/userland/market/) identity
table, since the runtime spawn requests only `0x18`.

For a running kernel that includes the market:

```
  make nonos-mk-market-prod          full profile under the microkernel-market feature   Makefile:930
```

Two host targets support the kernel-side smoke path: `make nonos-mk-market-smoke` builds the capsule under
a smoketest-trust key (`Makefile:760`) and `make nonos-mk-market-fixtures` generates the signed index
fixtures the smoke embeds (`Makefile:798`), both driven through the host `marketplace-index` CLI
(`Makefile:780`). The capsule depends on the `marketplace_abi` rlib, which the Makefile rebuilds before the
market when the ABI changes (`Makefile:747`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns errors as errnos
  through `reply_status`, never a panic; the release profile is `panic = "abort"` (`Cargo.toml:37`).
- One unit per file. New handlers are one module per op under `src/server/handlers/`, and `mod.rs` is used
  only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  existing module.

## Source map

```
  userland/capsule_market/src/main.rs               _start -> server::run; the seven modules and verifier selection
  userland/capsule_market/src/protocol/ops.rs       the op discriminants
  userland/capsule_market/src/server/handlers/      the per-op handlers and their mod.rs re-exports
  userland/capsule_market/src/server/runner.rs      the dispatch match
  userland/capsule_market/src/verify/trait_def.rs   the Verifier trait
  userland/capsule_market/Capsule.mk                slug, ports, capability mask; includes the generated targets
  nonos-mk/capsule.mk                               the NONOS_CAPSULE_RULES target template
  Makefile                                          the -prod, -smoke, -fixtures, and ABI targets
```

Every reference above is verified against those trees.
