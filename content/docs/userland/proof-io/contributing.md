---
title: "Contributing to proof_io"
description: "This page is the map a change follows: where the source is, how it is laid out, how to build and sign it, and the standards a patch has to meet."
weight: 2
---
This page is the map a change follows: where the source is, how it is laid out, how to build and sign it,
and the standards a patch has to meet. For the identity and lifecycle read the [overview](/docs/userland/proof-io/); for
the guarantee the capsule asserts read [what-it-proves.md](/docs/userland/proof-io/what-it-proves/).

## Module map

`proof_io` is one file, [`userland/capsule_proof_io/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs), and it stays one file on purpose: the
proof is small, self-contained, and predates the global allocator, so there is nothing to modularize. The
file has three clear parts.

```
  main.rs
    expectations   BAD_TAG, MDBG_TAG, the four RETIRED tags, and the fixed
                   PASS and FAIL marker strings          (main.rs:22)
    assertions     the _start body: the 1024x time loop, then the three
                   malformed MkDebug calls, then the retired-tag loop, each
                   with its own exit code                 (main.rs:37)
    reporting      the mk_debug marker write and the mk_exit status that
                   carries the verdict off the process    (main.rs:64)
```

Every syscall goes through the userspace libc: the safe `mk_time_millis`, `mk_debug`, and `mk_exit`
wrappers, plus the raw `mk_syscall_raw` (a re-export of `call_raw`) that lets the proof hit the boundary
with numbers the safe wrappers would refuse to send ([`userland/libc/src/lib.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/lib.rs#L81)).

## How to extend it

A new assertion is a new block in `_start`, added in order with its own exit code and its own `FAIL`
marker, and its expected-value constants added to the expectations block above it (`main.rs:37`,
`main.rs:22`). Keep the shape the existing checks use: send at the boundary, compare against the exact
errno the ABI promises, and on mismatch write a specific `[SYSCALL-PROOF] FAIL <name>` line and
`mk_exit` a distinct non-zero code (`main.rs:44`, `main.rs:45`). The current codes are 1 through 5; a new
check takes the next number, and its name is added to the `PASS` line so a pass still lists every check
that ran (`main.rs:28`, `main.rs:65`).

Do not reach for `alloc`. The capsule is built without it (see below), so a change that allocates will not
link. Do not add IPC or a service loop either: the proof is one-shot by design and never serves its
declared endpoints (`README.md`). If a change needs a capability the capsule does not hold, it does not
belong here; the mask is `0x19` and the kernel spawn mirror requests exactly `CoreExec | IPC | Memory`
and nothing else ([`src/userspace/capsule_proof_io/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_proof_io/spawn.rs#L49)).

## Build, sign, and run

The capsule is built and signed through the shared capsule macro, which materializes a fixed target set
for every slug from its `Capsule.mk` (`nonos-mk/capsule.mk:1`). The slug is `proof-io`
(`userland/capsule_proof_io/Capsule.mk:7`), so the targets are:

| Target | What it does | Source |
|---|---|---|
| `make nonos-mk-proof-io` | build the userland ELF for `x86_64-nonos-user` | `nonos-mk/capsule.mk:182` |
| `make nonos-mk-proof-io-sign` | sign the id cert, manifest, and zk attestation trailer | `nonos-mk/capsule.mk:261` |
| `make nonos-mk-proof-io-verify` | re-verify the manifest against the baked trust anchor | `nonos-mk/capsule.mk:263` |
| `make nonos-mk-check-proof-io-keys` | assert the publisher seeds and pubs exist | `nonos-mk/capsule.mk:184` |

The manifest re-signs whenever the ELF changes, so `payload_hash` never drifts from the binary
(`nonos-mk/capsule.mk:221`). Unlike most capsules, `proof_io` builds without `alloc`: its `Capsule.mk`
sets `CAPSULE_BUILD_STD := core` and clears the build-std features, because `_start` predates the global
allocator and never calls `alloc`, which keeps the ELF minimal
(`userland/capsule_proof_io/Capsule.mk:21`, `nonos-mk/capsule.mk:80`). To boot the proof, build the
kernel under the `microkernel-proof-io` feature with `make nonos-mk-proof-io-prod`, which pulls in the
proof artifacts and checks the signing key (`Makefile:897`). The boot entry then calls
`spawn_proof_io_capsule` under the `nonos-user-entry-proof` feature ([`src/userspace/init/entry.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L41)).

## Code standards

- No `std`, and no `alloc`. The capsule is `#![no_std]` `#![no_main]` and links only `core`
  (`main.rs:17`, `userland/capsule_proof_io/Capsule.mk:21`).
- No panics. `_start` is a straight-line sequence of checks that either passes or `mk_exit`s with a
  distinct code; there is no unwinding path (`main.rs:37`).
- Compare against the exact errno the ABI names, not a sign or a range. The value of each check is that
  `-38`, `-14`, and `-22` are asserted literally (`main.rs:44`, `main.rs:48`, `main.rs:52`).
- Keep the marker strings fixed and greppable. The harness matches `[SYSCALL-PROOF] PASS` and the
  specific `FAIL` lines by exact text (`main.rs:28`).
- Run `cargo fmt` and `cargo clippy` before sending a change.

## Source map

```
  userland/capsule_proof_io/src/main.rs      the single-file proof: expectations, assertions, reporting
  userland/capsule_proof_io/Capsule.mk       slug, ports, 0x19 mask, core-only build
  userland/libc/src/lib.rs                    the mk_* wrappers and the raw re-export
  nonos-mk/capsule.mk                         the build/sign/verify/keys target macro
  Makefile                                    the proof-io prod kernel target
  src/userspace/capsule_proof_io/spawn.rs     the kernel spawn mirror and requested caps
  src/userspace/init/entry.rs                 the gated boot-entry spawn call
```

Every reference above is verified against those trees.
