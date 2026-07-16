---
title: "Contributing to capsule_vfs"
description: "This page is for a contributor who wants to change the vfs pool."
weight: 4
---
This page is for a contributor who wants to change the vfs pool. It covers where the source lives, which
folder owns which behaviour, the exact steps to add an operation, how to build and sign the capsule, and the
code standards a change has to meet. For what the pool does and how it is put together, read the
[README](/docs/userland/vfs/), the [wire protocol and operations](/docs/userland/vfs/protocol/), and the [store](/docs/userland/vfs/store/) pages in
this folder.

## Where the source lives

The capsule is at `userland/capsule_vfs/`. It is a `no_std`/`no_main` service capsule: `_start` initializes
the heap and calls `server::run`, which never returns ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)-`34`). The three top-level modules
are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)-`24`).

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the NOVF frame, ops, flags, bounds, the codec, and the errno set | you change the wire format, add an opcode, or add an errno |
| `src/server/` | the request loop, the dispatch table, the handlers, path handling, attestation | you add or change an operation's request handling |
| `src/store/` | the flat file store and the descriptor table | you change how files or descriptors are stored |

Inside `src/server/`, `handlers/` holds one file per op plus `util.rs` (the `split_caller` attestation and
`map_store_err`) and `path/` (`normalize`, `normalize_to_buffer`, `is_read_only`). Inside `src/store/`,
`fdtable/` holds one file per store method next to `types.rs` (the `Store`, `File`, `OpenFd`, `StoreError`,
and the bounds).

## Adding an operation

There are five edits, and the dispatch wiring plus the store method are the load-bearing ones. The existing
`stat` op is a clean reference for a read op; `chmod` is the reference for a mutating op that must honour the
`/capsules` guard.

1. Assign the next opcode in [`src/protocol/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L20) (the constants run `OP_OPEN 1` through `OP_CHMOD 15`)
   and re-export it from [`src/protocol/mod.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L27). Document the request and reply layout in a comment above
   the handler, the way `open.rs:26` and `stat.rs:24` do.

2. Write the handler as one file under `src/server/handlers/` (for example `stat.rs`). Call `split_caller`
   first so the op attests its caller (`stat.rs:27`), validate the fixed layout to `EINVAL` before touching
   the store (a zero or over-256 path length, a short payload, or non-UTF-8 path bytes, `stat.rs:31`-`44`),
   call the store method, and map its error through `map_store_err` (`stat.rs:55`). If the op mutates an
   existing entry and should honour the `/capsules` guard, `normalize` the path and check `is_read_only`
   before acting, the way `chmod.rs:43`-`46` and `truncate.rs:45`-`48` do. Re-export the handler from
   [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs) (declare the module, `mod.rs:17`-`33`, and re-export it, `mod.rs:35`-`49`).

3. Wire it into the dispatch table. Add its arm to the match in [`src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L28), threading
   `sender_pid` into the handler the way every other op does (`dispatch.rs:29`); an op that does not attest a
   caller is dispatched without it, as `OP_HEALTHCHECK` is (`dispatch.rs:43`). A word no arm matches already
   falls to the `_ =>` arm and is answered `EINVAL` (`dispatch.rs:44`).

4. Add the store method as one file under `src/store/fdtable/` (for example `chmod.rs`) and declare it in
   [`src/store/fdtable.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/fdtable.rs#L17)-`36`. Return a `StoreError` variant that already maps to an errno, or extend
   both `StoreError` ([`src/store/fdtable/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/fdtable/types.rs#L24)) and `map_store_err`
   ([`src/server/handlers/util.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/util.rs#L20)) together so no store error can reach a caller unmapped.

5. Mirror the op constant into the app-skeleton client
   ([`userland/app_skeleton/src/clients/vfs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/types.rs#L17)) so clients can call it, and add a case to
   `fs_proofs` (`userland/fs_proofs/`). The proofs `#[path]`-include the real capsule source, so a new op's
   handler, store method, path use, and codec are exercised off-target by the same code that ships
   ([`userland/fs_proofs/src/lib.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/fs_proofs/src/lib.rs#L30), [`src/vfs_protocol/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vfs_protocol/mod.rs#L21), [`src/vfs_store/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vfs_store/mod.rs#L24)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_vfs/Capsule.mk:18`.

```
  make nonos-mk-vfs               build the capsule ELF                         capsule.mk:158
  make nonos-mk-vfs-sign          id cert, manifest, and attestation trailer    capsule.mk:261
  make nonos-mk-vfs-verify        verify the signed manifest vs the trust anchor capsule.mk:263
  make nonos-mk-check-vfs-keys    assert the per-capsule signing keys exist      capsule.mk:184
```

For a running kernel that includes the vfs pool, `make nonos-mk-vfs-prod` builds under the
`microkernel-vfs` feature (`Makefile:925`), and `make nonos-mk-boot-vfs` runs the boot round-trip via
[`tests/boot/vfs_round_trip.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/tests/boot/vfs_round_trip.sh) (`Makefile:1393`-`1394`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns errors as an encoded
  negative-errno response, never a panic.
- The one `unsafe` block, the volatile zeroize, carries its safety justification
  ([`src/store/fdtable/zeroize.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/fdtable/zeroize.rs#L24)-`26`).
- One unit per file. New ops are one handler per file under `handlers/` and one store method per file under
  `fdtable/`, and `mod.rs`/`fdtable.rs` are used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1)-`15` and every other module.

## Source map

```
  userland/capsule_vfs/src/main.rs                    _start -> server::run; the three modules
  userland/capsule_vfs/src/protocol/types.rs          the opcode and flag constants
  userland/capsule_vfs/src/protocol/mod.rs            the protocol re-exports
  userland/capsule_vfs/src/server/handlers/           one handler per op + util.rs + path/
  userland/capsule_vfs/src/server/dispatch.rs         op -> handler
  userland/capsule_vfs/src/store/fdtable.rs           the store module declarations
  userland/capsule_vfs/src/store/fdtable/types.rs     StoreError and the bounds
  userland/capsule_vfs/Capsule.mk                     slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                 the nonos-mk-vfs[-sign|-verify] target templates
  Makefile                                            the -prod and boot round-trip targets
  userland/app_skeleton/src/clients/vfs/types.rs      the client op constants to mirror
  userland/fs_proofs/                                 the machine-checked proofs of this source
```

Every reference above is verified against those trees.
