---
title: "VFS Routing and Path Security"
description: "Above the filesystems is a dispatcher that decides which one serves a path, and in front of every path is validation that stops traversal out of the tree."
weight: 3
---
Above the filesystems is a dispatcher that decides which one serves a path, and in front of every
path is validation that stops traversal out of the tree. This page documents the VFS routing and the
path defenses. The code is under `src/fs/vfs/`, `src/fs/fd/`, and `src/fs/path/`.

## Routing

The VFS layer ([`src/fs/vfs/vfs_core.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/vfs/vfs_core.rs)) is a thin in-kernel dispatcher that routes a path to a
backing filesystem by prefix. `read_file` is representative:

```
  read_file(path):
      if data_rel(path):  blockfs_volume::read_all(path)   // "/data" -> on-disk blockfs
      else:               ramfs::read_file(path)           // everything else -> in-kernel RAMFS
```

And the file-descriptor layer (`src/fs/fd/`) routes the `/ram` tree to the capsule client:

```
  open(path):
      normalize + validate the path
      if is_capsule_path(path):  capsule_client::open(path, flags)   // "/ram" -> ramfs_capsule (IPC)
      else:                      in-kernel RAMFS open
```

So there are three destinations: `/ram` goes over IPC to the [ramfs capsule](/docs/subsystems/storage/vfs-capsule/), `/data`
goes to the on-disk [blockfs](#the-on-disk-store) store, and everything else is the in-kernel
[RAMFS](/docs/subsystems/storage/ramfs/). The mount table is a small vector of mount points. The dispatcher itself does no
storage; it decides who does.

## The on-disk store

The `/data` prefix is served by a real on-disk block filesystem, `blockfs`
(`src/fs/blockfs/`): a superblock with a generation, geometry, and a BLAKE3 digest for integrity, a
directory format, and block allocation, optionally encrypted per block through `cryptoblock`
(a 512-byte sector split into a 12-byte nonce, a 16-byte tag, and 484 bytes of ciphertext). It is
honest to record that this on-disk path is dormant in the normal microkernel boot: nothing mounts
`/data` unless an application explicitly reads it, so blockfs and its cryptoblock encryption are built
and correct but off the hot path, which is RAM-resident. The `cryptofs` ephemeral encrypted-file
module is initialized at startup but likewise not on the standard I/O path. The live filesystem is
RAM; the on-disk store is the persistent backend for the code that asks for it.

## Path validation

Every path is validated before use ([`src/fs/path/validate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/path/validate.rs)). `validate_path` rejects the malformed,
and `validate_path_secure` adds the traversal check:

```
  validate_path(path):
      reject empty, len > MAX_PATH_LEN (4096), any NUL byte,
             or a component longer than MAX_COMPONENT_LEN (255)

  validate_path_secure(path):
      validate_path(path)
      n = normalize_path(path)
      if n starts with "../" or n == "..":  TraversalAttempt
```

`normalize_path` collapses `.` and `//` and resolves `..` without ever escaping the root, and
`join_secure` refuses an absolute child and rejects a join whose normalized result does not stay under
the parent. Together these stop the classic path-traversal escapes: a `..` that would climb above the
root, a `//` or `.` obfuscation, or an absolute path smuggled in as a relative one. A null byte, which
could truncate a path at a lower layer, is rejected outright.

## Verification

The path canonicalization and the capsule filesystem's access rules are not just asserted, they are
tested against the real source. The `fs_proofs` crate (`userland/fs_proofs/`) includes the actual
capsule filesystem handlers via `#[path]` and runs them: normalization removes `.` and `//` and
resolves `..`, the read-only guard on the signed-capsule directory cannot be bypassed by a trailing
slash or a `..` round-trip, the wire protocol decodes hostile input without panicking, and a fuzz
suite drives millions of inputs. It also includes Kani harnesses for machine-checked proofs. Because
it compiles the production handler source rather than a copy, the proofs are about the code that runs.

## Security analysis

The VFS layer is where a path first meets the storage stack, and its job is to decide who serves a path
and to make sure the path itself cannot climb out of its tree before any filesystem sees it. It holds
no storage of its own and reaches no device, so its security surface is the routing decision and the
path defenses, not a broker grant.

The **path defenses stop traversal before dispatch.** `validate_path` ([`src/fs/path/validate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/path/validate.rs))
rejects the malformed outright: empty, over `MAX_PATH_LEN` (4096), any NUL byte, or a component over
`MAX_COMPONENT_LEN` (255). `validate_path_secure` then normalizes and refuses a result that starts with
`../` or equals `..`, so a traversal that would climb above the root is `TraversalAttempt` before a
filesystem is chosen. `normalize_path` collapses `.` and `//` and resolves `..` without ever escaping
the root, and `join_secure` (`normalize.rs`, `join.rs`) refuses an absolute child and a join whose
normalized result leaves the parent. The NUL-byte rejection matters specifically because a null could
truncate a path at a lower C-string layer, so it is caught here rather than trusted downstream.

The **routing is a fixed prefix decision, not caller-controlled dispatch.** `read_file`
(`vfs_core.rs`) sends `/data` to the on-disk blockfs and everything else to RAMFS, and the fd layer
(`src/fs/fd/`) sends `/ram` to the capsule client over IPC. A caller does not get to name which backend
handles its path; the prefix does, and the dispatcher itself stores nothing. This keeps the block layer
and the disk drivers off the path entirely unless a path actually names `/data`.

The **on-disk store is dormant on the normal boot, and that is the point.** The `/data` prefix is
served by blockfs (`src/fs/blockfs/`), a real on-disk filesystem with a superblock carrying a
generation, geometry, and a BLAKE3 digest for integrity, plus optional per-block encryption through
`cryptoblock` (a 512-byte sector as a 12-byte nonce, a 16-byte tag, and 484 bytes of ciphertext).
Nothing mounts `/data` in the ordinary microkernel boot, so blockfs and its block drivers are built and
correct but off the hot path, which is RAM-resident. When something does read `/data`, it reaches the
same signed block-driver capsules documented on the [block layer](/docs/subsystems/storage/block-device/#security-analysis)
page, with all of their per-device grant scoping and the same honest IOMMU boundary.

The **honest boundary is that these defenses are canonicalization, not authorization.** The path checks
stop a name from escaping its tree; they do not decide whether the caller may read the file, which is
the filesystem capsule's attested-caller job (see the
[filesystem capsule](/docs/subsystems/storage/vfs-capsule/#caller-attestation) page). The VFS layer guarantees the path is
well-formed and stays under root; per-caller access lives above it.

## Debugging VFS routing and paths

Because the VFS layer is a dispatcher and a validator, its failures are decisions rather than device
bring-up, and the two questions are which backend a path selected and why a path was rejected.

**Which backend served the path.** A read that returns unexpected content or nothing is most often a
routing outcome: `/ram` went over IPC to the [ramfs capsule](/docs/subsystems/storage/vfs-capsule/), `/data` went to blockfs,
and everything else went to the in-kernel [RAMFS](/docs/subsystems/storage/ramfs/). So before suspecting a filesystem bug,
confirm the prefix, because the three destinations are genuinely different stores. A `/data` read that
hangs or errors is the only one that reaches a block-driver capsule, so its failures are the
[block layer](/docs/subsystems/storage/block-device/#debugging-the-block-layer) signatures, not a VFS bug.

**Why a path was rejected.** A rejected path returns a specific reason from validation rather than a
generic error: an over-length path or component, an embedded NUL, or a `TraversalAttempt` from a `..`
that normalized above the root. The distinction to draw is between a malformed path (`validate_path`
rejected it) and a hostile one (`validate_path_secure` caught the traversal after normalization), since
the fix differs: the first is a caller passing a bad string, the second is a caller trying to escape.

**Confirming the defenses actually hold.** The path canonicalization and the capsule filesystem's
access rules are not just asserted; the `fs_proofs` crate (`userland/fs_proofs/`) compiles the real
handler source via `#[path]` and runs it, proving normalization removes `.` and `//` and resolves
`..`, that the read-only guard cannot be bypassed by a trailing slash or a `..` round-trip, and that
the wire protocol decodes hostile input without panicking, plus a fuzz suite and Kani harnesses.
Because it builds the production handler rather than a copy, a green `fs_proofs` run is evidence about
the code that actually runs, which is the tool to reach for when a traversal defense is in doubt.

## Source map

```
  src/fs/vfs/vfs_core.rs        the prefix router (/data, else RAMFS)
  src/fs/fd/                     the fd table and the /ram capsule routing
  src/fs/path/validate.rs        validate_path, validate_path_secure, MAX_PATH_LEN, MAX_COMPONENT_LEN
  src/fs/path/normalize.rs, join.rs   normalize_path and join_secure
  src/fs/blockfs/, cryptoblock/  the dormant on-disk store and its per-block encryption
  userland/fs_proofs/            the verification crate (normalization, guard, protocol, fuzz, Kani)
```

Every reference above is verified against those trees. The RAM default this routes to is on the
[RAMFS](/docs/subsystems/storage/ramfs/) page, the IPC-routed `/ram` capsule on the [filesystem capsule](/docs/subsystems/storage/vfs-capsule/) page,
and the block drivers behind `/data` on the [block layer](/docs/subsystems/storage/block-device/) page.
