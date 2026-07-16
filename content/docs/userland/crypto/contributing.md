---
title: "Contributing to capsule_crypto"
description: "This page is for a contributor who wants to change the crypto pool."
weight: 5
---
This page is for a contributor who wants to change the crypto pool. It covers where the source lives,
which folder owns what, the exact steps to add a primitive end to end, how to build and sign the capsule,
and the code standards a change has to meet. For what the capsule does and how it is put together, read
the [README](/docs/userland/crypto/), the [operation reference](/docs/userland/crypto/operations/), the [server loop](/docs/userland/crypto/server/), the
[primitives](/docs/userland/crypto/primitives/), and the [kernel seam](/docs/userland/crypto/transport/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_crypto/`. It is a `no_std`/`no_main` service: `_start` inits the heap
and enters `server::run` ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). The two top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|--------|------|---------------|
| `src/protocol/` | the wire: the NOCX frame, decode, encode, errno, and every opcode and size constant | you change the frame, add an op number, or add a limit |
| `src/server/` | the loop, the dispatch match, and the buffer wipe | you change how requests are received, routed, or wiped |
| `src/server/handlers/` | one file per primitive plus the shared AEAD frame and hand-written HMAC/HKDF | you add or change a primitive |

Inside `src/protocol/`, the opcodes are split: ops 1 through 13 and the AEAD and Ed25519 size constants
are in `types.rs:20`, and ops 14 through 20 with their constants are in `primitives.rs:17`. Inside
`src/server/handlers/`, `aead_frame/` holds the shared seal/open parse and the degenerate-nonce guard, and
`hmac_core.rs` holds the HMAC that both `hmac_sha256.rs` and `hkdf_sha256.rs` build on.

## Adding a primitive

There are four capsule-side edits, and if a kernel caller should reach the op there is a fifth block. The
dispatch wiring is the load-bearing one.

1. Assign an opcode. If it fits the original block, add the constant to [`src/protocol/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L20);
   otherwise add it to [`src/protocol/primitives.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/primitives.rs#L17) alongside the later ops, and put any size constant
   next to it. Re-export the new names through [`src/protocol/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L26) or `:34`.

2. Write the handler as one file under `src/server/handlers/`, exposing
   `pub fn name(req: Request<'_>) -> Vec<u8>` that validates its payload, computes, and returns
   `encode_response(op, req.flags, req.request_id, status, body)`. Follow the existing shape: bound the
   input against a named constant and return `EMSGSIZE`/`EINVAL` on a bad frame
   ([`src/server/handlers/sha256_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sha256_hash.rs#L23) is the reference), and for a verify op return a status with an
   empty body ([`src/server/handlers/ed25519_verify.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/ed25519_verify.rs#L69)). If the payload has an internal frame, parse it
   with checked `get` calls so a short buffer is an error, not a panic ([`aead_frame/common.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/common.rs#L20)).

3. Declare the module and re-export the handler in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17) and `:37`.

4. Wire the opcode into the match in [`src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L29), and add the opcode to the
   `use crate::protocol::{...}` import at the top of that file (`dispatch.rs:20`).

5. If a kernel-side caller should reach it, add a client under `src/security/crypto_capsule/client/`,
   re-export it in [`client/mod.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/mod.rs#L37), call `gate_hash()?` first
   ([`src/security/crypto_capsule/capability.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/capability.rs#L22)), and add the syscall plumbing under the crypto syscall
   dispatch plus the `nonos_libc` shim under `userland/libc/src/crypto/`. The three ops without a client
   today (P-256, P-384, SHA-384) are exactly this missing block.

## Build and sign

The per-slug make targets are generated from the `NONOS_CAPSULE_RULES` template (`nonos-mk/capsule.mk:156`)
and pulled in through `userland/capsule_crypto/Capsule.mk:19`.

```
  make nonos-mk-crypto              build the capsule ELF                     capsule.mk:182
  make nonos-mk-crypto-sign         id cert, manifest, attestation trailer    capsule.mk:261
  make nonos-mk-crypto-verify       verify artifacts vs the trust anchor      capsule.mk:263
  make nonos-mk-check-crypto-keys   assert the per-capsule signing keys exist capsule.mk:184
```

For a bootable image that includes the pool, and a boot harness that exercises it:

```
  make nonos-mk-crypto-prod         crypto-profile kernel image     Makefile:920
  make nonos-mk-boot-crypto-hash    hash round-trip boot harness    Makefile:1390
```

`nonos-mk-crypto-prod` builds with `KERNEL_FEATURES := microkernel-crypto` (`Makefile:920`);
`nonos-mk-boot-crypto-hash` runs [`tests/boot/crypto_hash_round_trip.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/tests/boot/crypto_hash_round_trip.sh) (`Makefile:1391`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as a
  status code, never a panic; the release profile is `panic = "abort"` (`Cargo.toml:37`).
- One unit per file. New primitives are one op per file under `handlers/`, and `mod.rs` is used only for
  re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/server/dispatch.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L1) and every other module.

## Source map

```
  userland/capsule_crypto/src/main.rs              _start -> heap_init -> server::run; the two modules
  userland/capsule_crypto/src/protocol/types.rs, primitives.rs   the opcodes and size constants
  userland/capsule_crypto/src/protocol/mod.rs      the re-exported protocol surface
  userland/capsule_crypto/src/server/dispatch.rs   the op -> handler match to extend
  userland/capsule_crypto/src/server/handlers/mod.rs   the per-handler module list and re-exports
  userland/capsule_crypto/src/server/handlers/sha256_hash.rs, ed25519_verify.rs   the reference handler shapes
  userland/capsule_crypto/Cargo.toml               the crate deps and the panic = "abort" profile
  userland/capsule_crypto/Capsule.mk               slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                              the nonos-mk-crypto[-sign|-verify] target template
  src/security/crypto_capsule/                      the kernel client to extend for a new gated caller
```

Every reference above is verified against those trees.
