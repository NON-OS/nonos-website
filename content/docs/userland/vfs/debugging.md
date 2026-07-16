---
title: "Debugging capsule_vfs"
description: "This page lists the boot marker the vfs pool emits, the errno failure signatures a client sees, and where to look for each."
weight: 5
---
This page lists the boot marker the vfs pool emits, the errno failure signatures a client sees, and where to
look for each. For the shape of the pool see the [README](/docs/userland/vfs/), the
[wire protocol and operations](/docs/userland/vfs/protocol/), and the [store](/docs/userland/vfs/store/) pages in this folder.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[VFS] capsule spawned` from the capsule boot path: the `Ok` arm calls `boot_log::ok(prefix, "capsule
spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), formatted by [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33). If
that line is absent the capsule never started, and the `Err` arm logged an `[ERROR]` line through
`boot_log::error` instead (`run.rs:32`), which is the usual signature, manifest, or capability failure.

Because so much of the desktop reads files, a missing `[VFS]` marker cascades. Every client resolves the
`vfs_pool` service by name ([`userland/app_skeleton/src/clients/vfs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/types.rs#L17)); if the pool never
registered, those lookups return no pid and every open fails. So a boot that reaches the desktop but where
nothing can read a file is a vfs-did-not-register symptom, not an app bug. Confirm the marker before
suspecting a client.

## Failure signatures

Once the pool is registered, a failure surfaces as one of the errnos from `map_store_err`
([`src/server/handlers/util.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/util.rs#L20)) or the two errnos handlers return directly. Each has a distinct cause.

### EACCES

Three different causes share this code, and the op tells them apart:

- From any op, `EACCES` at the attestation step means the payload pid did not match the kernel-attested
  sender: an impersonation attempt (`util.rs:54`). The message never reached the store.
- From `chmod` or `truncate`, `EACCES` after attestation means the path normalized to somewhere under
  `/capsules` and the read-only guard refused it (`chmod.rs:44`, `truncate.rs:46`).
- From `write`, `EACCES` means the fd was opened without write permission, which for an existing file means
  its owner-write bit (`0o200`) was clear at open time ([`store/fdtable/open.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/open.rs#L39),
  [`store/fdtable/write.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/write.rs#L25)). The permission is fixed at open, so re-opening after a `chmod` is the fix,
  not retrying the write.

### EBADF

An fd used by a pid that did not open it, or an fd out of range ([`store/fdtable/lookup.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/lookup.rs#L24)-`34`). A wrong
owner and an empty slot both return `BadFd`, so a capsule cannot tell another caller's live fd from an
unused one. If a client sees `EBADF` on an fd it believes it opened, check that the same pid is issuing the
op; the store keys ownership on the attested pid, not the fd number.

### ENOSPC

One of the store bounds was hit: 2048 files, 256 open fds, or 1 MiB in a single file
([`store/fdtable/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/types.rs#L20)-`22`). A create, `mkdir`, or `copy` past 2048 entries, an open past 256 fds, or
a `write`/`truncate` past 1 MiB all map to `Full` and then `ENOSPC`.

### EMSGSIZE

A `read` or `write` asked for more than 64 KiB (`MAX_DATA_BYTES`) in one call (`read.rs:34`, `write.rs:34`).
This is a per-call byte cap, not a file-size limit; a client that needs more moves data in 64 KiB chunks,
advancing the fd position each call.

### ENOENT, EEXIST, EISDIR, ENOTEMPTY

The ordinary namespace errors: a path that is absent (`ENOENT`), a create or rename onto a name that already
exists (`EEXIST`), an op that expected a file but found a directory or vice versa (`EISDIR`), and an
`unlink`/`rmdir` of a non-empty directory without recursion (`ENOTEMPTY`). Because the namespace is flat and
most ops do not normalize (see the [store](/docs/userland/vfs/store/#the-path-model) page), an `ENOENT` on a path that looks
present is often a non-canonical path that failed the store's exact-name compare rather than a missing file;
check that the caller sent a canonical absolute path.

### EINVAL

A malformed frame (bad magic, wrong version, or a length that overruns the buffer, [`src/protocol/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs)),
a bad path length (zero or over 256), a truncated payload, or non-UTF-8 path bytes. A frame that fails to
decode is answered `EINVAL` by the loop rather than dropped ([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)), and an unrecognised
opcode is answered `EINVAL` by the dispatcher ([`src/server/dispatch.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L44)).

## Cross-checking against the proofs

The `fs_proofs` suite `#[path]`-includes the real capsule source, so the codec, path normalization, the
read-only guard, caller attestation, and the store are exercised off-target by the same code that ships
([`userland/fs_proofs/src/lib.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/fs_proofs/src/lib.rs#L30), [`src/vfs_protocol/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vfs_protocol/mod.rs#L21), [`src/vfs_store/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vfs_store/mod.rs#L24),
[`src/vfs_path_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vfs_path_tests.rs)). A protocol or path regression usually shows up in the proof suite before it boots,
so a `cargo test` in `fs_proofs` is the fastest way to localize a decode, normalize, or attestation change.

## Source map

```
  src/userspace/init/capsule_boot/run.rs           [VFS] capsule spawned / error path
  src/sys/boot_log/output.rs                       the boot_log::ok formatter
  userland/app_skeleton/src/clients/vfs/types.rs   the vfs_pool service name clients resolve
  userland/capsule_vfs/src/server/handlers/util.rs  split_caller (EACCES) and map_store_err
  userland/capsule_vfs/src/server/handlers/         per-op EINVAL validation and the guard checks
  userland/capsule_vfs/src/store/fdtable/lookup.rs  the fd ownership check behind EBADF
  userland/capsule_vfs/src/store/fdtable/types.rs   the bounds behind ENOSPC
  userland/capsule_vfs/src/protocol/decode.rs       the frame checks behind EINVAL
  userland/fs_proofs/                               the off-target proofs of this source
```

Every reference above is verified against those trees.
