---
title: "Contributing to capsule_entropy"
description: "This page is for a contributor who wants to change the entropy capsule."
weight: 3
---
This page is for a contributor who wants to change the entropy capsule. It covers where the source lives,
which folder owns which behaviour, the exact steps to add an operation, how to build and sign the
capsule, and the code standards a change has to meet. For what the capsule does and how it is put
together, read the [README](/docs/userland/entropy/), the [operations and protocol](/docs/userland/entropy/operations/) page, and the
[pool](/docs/userland/entropy/pool/) page in this folder.

## Where the source lives

The capsule is at `userland/capsule_entropy/`. It is a `no_std`/`no_main` service: `_start` initializes
the heap and, on success, calls `server::run`; a heap-init failure exits with code 1
([`userland/capsule_entropy/src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/main.rs#L29)). The three top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/server/` | the IPC loop, the op-to-handler dispatch, and the four handlers | you change the request flow or a handler |
| `src/protocol/` | the NOEN wire frame, the ops, the limits, and the error codes | you change the wire format or add an op or error |
| `src/pool/` | the four counters, the `RDRAND` fill, the stats encoding, the reseed counter | you change the accounting or the fill path |

The wire format under `src/protocol/` is authoritative, and the kernel-side mirror at
[`src/security/entropy_capsule/protocol.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/protocol.rs) must match it bit-for-bit; the capsule's own protocol comment
calls it out as authoritative ([`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17)).

## Adding an operation

There are four edits, and the wire-format mirror is the load-bearing one.

1. Add the opcode constant in [`src/protocol/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L30) and the matching constant in the kernel mirror
   [`src/security/entropy_capsule/protocol.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/protocol.rs#L28). The two must agree on the number.

2. Write the handler as one file under `src/server/handlers/`, next to the existing ones. A handler that
   touches the pool exposes `pub fn <op>(pool: &Pool, req: Request<'_>) -> Vec<u8>` (the shape of
   `get_random`, [`src/server/handlers/getrandom.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getrandom.rs#L27)); one that does not touch the pool takes only
   `req` (the shape of `healthcheck`, [`src/server/handlers/healthcheck.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/healthcheck.rs#L24)). Build the reply with
   `encode_response`, putting the status word first ([`src/protocol/encode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L25)). Re-export the handler
   from [`src/server/handlers/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L22).

3. Wire it into the match in [`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25). Add a `use` for the new op constant to the
   import list ([`src/server/dispatch.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L21)) and a match arm that calls the handler
   ([`src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L27)). A word no arm matches falls to the `_ =>` arm and returns `EINVAL`
   ([`src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L31)).

4. If the kernel needs to call the op, add a client under `src/security/entropy_capsule/client/` and
   re-export it from [`src/security/entropy_capsule/client/mod.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/client/mod.rs#L25). If the op must be
   capability-checked, gate it in [`src/security/entropy_capsule/capability.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs) the way `gate_read`
   (`capability.rs:23`) and `gate_reseed` (`capability.rs:35`) do; the pid comes from the kernel's
   process accounting, never from a caller-supplied payload (`capability.rs:24`).

Keep the counters honest. If a new op consumes or produces entropy, account for it in `src/pool/`
alongside the existing counters, and do not introduce a software mixer without saying so in
[pool.md](/docs/userland/entropy/pool/); the honesty of the randomness posture is a documented property of this capsule.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_entropy/Capsule.mk:20`.

```
  make nonos-mk-entropy               build the capsule ELF
  make nonos-mk-entropy-sign          id cert, manifest, attestation trailer
  make nonos-mk-entropy-verify        verify the signed artifacts against the trust anchor
  make nonos-mk-check-entropy-keys    assert the per-capsule signing keys exist
```

For a running kernel that embeds the entropy capsule, `make nonos-mk-entropy-prod` builds the
`microkernel-entropy` profile with the entropy artifacts baked in (`Makefile:915`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. The decoder is explicit that it never
  panics and never unwraps ([`src/protocol/decode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L28)), and the release profile is `panic = "abort"`
  (`Cargo.toml:25`).
- One unit per file. New handlers are one op per file under `src/server/handlers/`, and `mod.rs` is used
  only for re-exports, matching the existing tree ([`src/pool/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/mod.rs), [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_entropy/src/main.rs               _start -> server::run; the three modules
  userland/capsule_entropy/src/server/handlers/      one op per file; the handler shapes
  userland/capsule_entropy/src/server/dispatch.rs    the op -> handler match
  userland/capsule_entropy/src/protocol/types.rs     the op constants and the wire frame
  src/security/entropy_capsule/protocol.rs           the kernel mirror the wire format must match
  src/security/entropy_capsule/client/mod.rs         where a new kernel client is re-exported
  src/security/entropy_capsule/capability.rs         CAP_ENTROPY and CAP_ADMIN gates
  userland/capsule_entropy/Capsule.mk                slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                the nonos-mk-entropy[-sign|-verify] target templates
  Makefile                                           the nonos-mk-entropy-prod image target
```

Every reference above is verified against those trees.
