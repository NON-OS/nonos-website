---
title: "The ramfs Capsule"
description: "capsuleramfs is the RAM-resident filesystem service behind the /ram tree."
weight: 400
---
`capsule_ramfs` is the RAM-resident filesystem service behind the `/ram` tree. It is a request and reply
IPC capsule that owns a map of files entirely in its own heap, and what sets it apart from a plain
in-memory store is that every file is held encrypted at rest. A file's bytes never sit in the capsule as
plaintext except transiently, inside a single decrypted buffer that lives only for the duration of one
read, write, or truncate. It holds no hardware authority: its capability envelope is IPC, Memory, and
Crypto and nothing else.

The source under `userland/capsule_ramfs/src/` is three top-level pillars, and this documentation mirrors
that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `ramfs` | `userland/capsule_ramfs/Capsule.mk:7` |
| Service handle | `ramfs` | `Capsule.mk:8` |
| Domain | `systems.nonos` | `Capsule.mk:9` |
| Namespace | `systems.nonos.ramfs` | `Capsule.mk:13` |
| Service endpoint | `service:4096:ramfs` | `Capsule.mk:14` |
| Reply endpoint | `reply:4097:endpoint.4294967297` | `Capsule.mk:15` |
| Capability mask | `0x38` | `Capsule.mk:17` |
| Kernel mirror | `src/fs/ramfs_capsule` | `Capsule.mk:18` |

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs). The manifest comment
states the arithmetic, and it holds: `0x08 | 0x10 | 0x20 = 0x38`, that is `8 + 16 + 32 = 56`.

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| IPC | `0x08` | receive requests and send replies on its endpoints | [`src/capabilities/types.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L59) |
| Memory | `0x10` | map its own heap for the file map | [`src/capabilities/types.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L60) |
| Crypto | `0x20` | draw random keys and nonces and seal file bytes | [`src/capabilities/types.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L61) |

There is no CoreExec bit (`0x01`) in the mask and no filesystem, network, driver, or graphics right. The
capsule cannot spawn processes, touch hardware, or reach any peer capsule. Compromising it yields its own
encrypted file map and nothing more, and even that map is ciphertext until a decrypt syscall the kernel
serves under the Crypto grant.

## The three pillars

Data flows inward. A request arrives on the IPC endpoint, the server decodes it and dispatches by opcode, a
handler resolves the caller's handle to a path, and the store seals or opens the file's bytes through the
crypto path.

```
  protocol/   ->   server/   ->   store/
  wire codec       dispatch       encrypted
  and opcodes      and handlers   file map
                                    |
                                    +-- store/crypto/  seal and open
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/ramfs/operations/) | `src/protocol/` and `src/server/` | The wire format, the eight-byte header, the five opcodes with their flags and payloads, the dispatch table, the handle table, and the per-operation handlers with their errno results. |
| [store.md](/docs/userland/ramfs/store/) | `src/store/` including `src/store/crypto/` | The in-heap file map, the decrypt-edit-reseal cycle behind read, write, and truncate, and the ChaCha20-Poly1305 crypto-at-rest model with its fresh keys and per-write nonces. |
| [contributing.md](/docs/userland/ramfs/contributing/) | the whole tree | Where to work, how to add an operation, the invariants a change must keep, and the build and code standards. |
| [debugging.md](/docs/userland/ramfs/debugging/) | runtime | The failure modes, what each errno means on the wire, and where to look when an open, a read, or a decrypt goes wrong. |

## Lifecycle

`_start` initializes the capsule heap and, on success, calls `server::run`, which never returns
([`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30), [`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34)). The runner allocates a fixed receive buffer, constructs an empty
`Store` and an empty `HandleTable`, and enters an unbounded loop: receive a message, decode it, dispatch
it, and send the reply to the kernel reply endpoint ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)). The store and handle table
persist across iterations for the life of the capsule; there is no persistence beyond the process, which is
the point of a RAM-resident filesystem.

## How `/ram` reaches this capsule

The `/ram` tree is not routed by the vfs capsule. It is routed by the kernel's own file descriptor layer.
When a path is opened, `fd_open` normalizes it and asks `is_capsule_path`, which returns true for exactly
`/ram` and any `/ram/` prefix ([`src/fs/ramfs_capsule/route.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/ramfs_capsule/route.rs#L18)). On a match the kernel takes the capsule
client path ([`src/fs/fd/table/open.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/fd/table/open.rs#L49)) and issues the request through `fs::ramfs_capsule::client`
rather than the local in-kernel ramfs. The vfs capsule is a peer service, not an intermediary; see
[../vfs/README.md](/docs/userland/vfs/) for how it differs, including that it stores plaintext and relies on
zeroization where ramfs encrypts at rest.

## Source map

The capsule source is `userland/capsule_ramfs/` and its manifest `userland/capsule_ramfs/Capsule.mk`. The
capability bits are defined in [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs). The kernel-side client, protocol mirror, and
path router live under `src/fs/ramfs_capsule/`. Every reference above is verified against those trees.
