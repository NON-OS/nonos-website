---
title: "The vfs Capsule"
description: "The vfs pool is the filesystem service the rest of the desktop reads and writes files through."
weight: 400
---
The vfs pool is the filesystem service the rest of the desktop reads and writes files through. It is a
signed userland service capsule, not a GUI app: it draws nothing, holds no hardware authority, and reaches
the system only through capability-checked IPC. It owns a flat, RAM-resident store of files and directories
plus a per-caller descriptor table, and it serves a POSIX-shaped operation set over its own wire protocol.
Its source is organized into three pillars, and this documentation mirrors that structure one page per
pillar so a page can be read beside the folder it describes.

The terminal, the file manager, and the text editor all open the same files in this one pool, which is why
a file the terminal writes appears in the file manager and opens in the editor. None of those clients holds
a filesystem of its own; each is a client that presents `CAP_VFS` at this capsule's boundary.

## Identity

Everything the kernel and the service registry need to name and reach the vfs pool comes from its
`Capsule.mk`. The values below are the file, not paraphrase.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `vfs` | `userland/capsule_vfs/Capsule.mk:5` |
| Service handle | `vfs` | `Capsule.mk:6` |
| Binary name | `vfs` | `Capsule.mk:9` |
| Namespace | `systems.nonos.vfs` | `Capsule.mk:11` |
| Service endpoint | `service:4104:vfs_pool` | `Capsule.mk:12` |
| Reply endpoint | `reply:4105:endpoint.4294967301` | `Capsule.mk:13` |
| Capability mask | `0x19` | `Capsule.mk:15` |
| Kernel mirror | `src/fs/vfs_capsule` | `Capsule.mk:16` |

The service name callers resolve is `vfs_pool` ([`userland/app_skeleton/src/clients/vfs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/types.rs#L17)), which
the kernel mirror registers on port 4104 ([`src/fs/vfs_capsule/spawn.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/vfs_capsule/spawn.rs#L29), `spawn.rs:30`). Replies go to
the fixed kernel reply endpoint `0x1_0000_0005` (decimal 4294967301,
[`src/protocol/types.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L48)), which the capsule sends every response to.

The mask `0x19` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | receive on its inbox and send replies (`types.rs:59`) |
| Memory | `0x0010` | map its own heap for the store (`types.rs:60`) |

That is `1 + 8 + 16 = 0x19` and nothing else. The `Capsule.mk` comment states the same decomposition and the
reason: `CAP_VFS` (the filesystem capability a client presents to reach a filesystem) is the caller-facing
gate, not this capsule's own bit; the vfs pool itself only needs IPC for the `mk_ipc_*` calls and Memory for
its heap (`Capsule.mk:1`, `Capsule.mk:14`). There is no `FileSystem` bit (64, `types.rs:62`), because it
*is* the filesystem rather than a client of one; no `Network` (4, `types.rs:58`), no `Crypto` (32,
`types.rs:61`), no `Debug` (256, `types.rs:64`); and nothing from the driver broker family (`Driver` 65536,
`Mmio` 131072, `Irq` 262144, `Dma` 524288, `Pio` 1048576, `types.rs:72`). That empty hardware grant is the
whole basis of the security posture: the most-fuzzed surface here, path handling and the protocol codec,
cannot reach a device, program DMA, or take an interrupt. Compromising the vfs pool yields the vfs pool's
mask and nothing more. The encrypted kernel [ramfs](/docs/userland/ramfs/) differs by storing ciphertext and
holding a crypto grant; this pool stores plaintext and relies on zeroization instead.

## The three pillars

The source under `userland/capsule_vfs/src/` is three top-level modules, and the documentation is one page
each. A request flows left to right: an IPC frame is decoded and dispatched by `server`, which validates the
op's fixed layout against the shapes defined in `protocol`, then acts on the flat `store`.

```
  protocol/   ->   server/   ->   store/
  the NOVF        the loop,       the flat file
  frame, ops,     dispatch,       table and the
  codec, errno    handlers        fd table
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/vfs/protocol/) | `src/protocol/` and `src/server/` | The NOVF frame and codec, the server loop, caller attestation, the operation table, and the complete reference for all fifteen ops with their payloads, replies, and errors. |
| [store.md](/docs/userland/vfs/store/) | `src/store/fdtable/` and `src/server/handlers/path/` | The flat store, the descriptor table and its ownership rule, path normalization, the read-only guard and its honest limits, zeroization, and the store bounds. |
| [contributing.md](/docs/userland/vfs/contributing/) | the whole tree | Where the source lives, the exact steps to add an operation, the build and sign targets, and the code standards. |
| [debugging.md](/docs/userland/vfs/debugging/) | runtime | The boot marker, the errno failure signatures, and where to look when a client cannot read a file. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initializes the heap (`mk_exit(1)` on failure) and calls
`server::run`, which never returns ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)-`34`). The kernel spawns the mirror as one of the first
capsules through the boot plan: `spawn_vfs` ([`src/userspace/init/spawn_plan/core.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L29)) calls
`boot::capsule("VFS", "vfs", ...)` (`core.rs:32`), which runs `capsule_boot::boot`. On success it logs
`[VFS] capsule spawned` and registers the capsule with the lifecycle table
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)-`30`); on failure it logs an `[ERROR]` line with the
`SpawnError` (`run.rs:32`). Once running, `server::run` allocates a 65556-byte buffer, builds the store,
seeds it, and loops receiving one frame at a time forever ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)-`43`). The
[debugging](/docs/userland/vfs/debugging/) page covers what a missing marker means.

## Source map

```
  userland/capsule_vfs/src/main.rs        heap init + server::run; the three modules
  userland/capsule_vfs/src/protocol/      NOVF frame, ops, flags, bounds, codec, errno
  userland/capsule_vfs/src/server/        the recv/decode/dispatch/reply loop and the handlers
  userland/capsule_vfs/src/store/         the flat store and the fd table
  userland/capsule_vfs/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs               the capability bit values behind mask 0x19
  src/fs/vfs_capsule/                     the kernel-side mirror and verified spawn
  src/userspace/init/spawn_plan/core.rs   spawn_vfs -> boot::capsule("VFS", "vfs", ...)
  src/userspace/init/capsule_boot/run.rs  the [VFS] capsule spawned / error path
  userland/app_skeleton/src/clients/vfs/  the vfs client the terminal, fm, and editor call
```

Every reference above is verified against those trees.
