---
title: "The store, the fd table, and paths"
description: "This page mirrors userland/capsulevfs/src/store/fdtable/ and userland/capsulevfs/src/server/handlers/path/: the flat file store, the descriptor table and the ownership rule that..."
weight: 3
---
This page mirrors `userland/capsule_vfs/src/store/fdtable/` and
`userland/capsule_vfs/src/server/handlers/path/`: the flat file store, the descriptor table and the
ownership rule that isolates callers, the seed, path normalization, the read-only guard and its honest
limits, the store bounds, and zeroization. For the wire protocol and the operation reference the handlers
call into, read the [protocol](/docs/userland/vfs/protocol/) page. For identity and the mask, read the [README](/docs/userland/vfs/).

## The store model

The `Store` ([`src/store/fdtable/types.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/fdtable/types.rs#L53)) is two vectors, files and open descriptors:

```
  struct Store  { files: Vec<File>, fds: Vec<Option<OpenFd>> }                    // types.rs:53

  struct File   { name: String, data: Vec<u8>, is_dir: bool, mode: u16, mtime: u64 }   // types.rs:37
  struct OpenFd { file_idx: usize, owner_pid: u32, pos: usize, append: bool, writable: bool }  // types.rs:45

  MAX_FILES = 2048    MAX_OPEN_FDS = 256    MAX_FILE_BYTES = 1 << 20 (1 MiB)       // types.rs:20-22
```

The namespace is flat: a `File`'s `name` is its full absolute path, and directories are `File`s with
`is_dir` set. There is no inode tree, so `find` is an exact-name linear search ([`store/fdtable/lookup.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/lookup.rs#L20))
and `list` filters by path prefix rather than walking a directory. A file is at most one mebibyte, there are
at most 2048 files, and at most 256 descriptors open at once; exceeding any is `StoreError::Full`, which maps
to `ENOSPC`. `Store::new` preallocates the 256 fd slots to `None` at construction
([`store/fdtable/new.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/new.rs#L22)-`28`), and `Default` forwards to it ([`store/fdtable/default.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/default.rs#L20)).

The store is RAM-resident and nothing persists across a reboot; this is the application filesystem the
desktop lives in, deliberately volatile. File timestamps come from `mk_time_millis` through `now_ms`, which
clamps a negative syscall result to 0 before the kernel clock is up, so a file carries no known timestamp
rather than a garbage one ([`store/fdtable/time.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/time.rs#L22)-`29`). Occupancy is reported by `usage`: the current
entry count, the total bytes held, and the entry ceiling ([`store/fdtable/usage.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/usage.rs#L22)).

## The seed

At startup `seed` ([`store/fdtable/seed.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/seed.rs#L27)) creates `/docs` and an empty `/capsules`, plus three files
`/readme.txt`, `/docs/about.txt`, and `/docs/demo.txt` (`seed.rs:28`-`36`). `/capsules` starts empty on
purpose: the installer lands verified capsule artifacts there at runtime (reading
`/capsules/<name>.{elf,cert,manifest,trailer}`) rather than baking them into the image (`seed.rs:29`-`33`).
Seeded files are mode `0o644` (`seed.rs:45`), and the seed helper refuses to exceed `MAX_FILES` or duplicate
a name (`seed.rs:40`).

## File-descriptor ownership

A descriptor is bound to the pid that opened it. `entry` and `slot_mut`
([`src/store/fdtable/lookup.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/fdtable/lookup.rs#L24), `:36`) resolve an fd only for its owner:

```
  entry(fd, owner_pid):
      if fd >= fds.len():                       BadFd
      match fds[fd]:
          Some(e) if e.owner_pid == owner_pid:  Ok(e)
          Some(_):                              BadFd     // wrong owner
          None:                                 BadFd     // empty slot
```

So a capsule cannot read or write through a descriptor another capsule opened, even by guessing the fd
number, because the store checks the attested owner pid on every access, and a wrong owner is
indistinguishable from a bad fd (`BadFd` -> `EBADF`). This is the second isolation boundary after
[caller attestation](/docs/userland/vfs/protocol/#caller-attestation): attestation stops impersonation at the request, fd
ownership stops it at the descriptor. `read` and `write` both pull the owner pid through `entry` before
touching data ([`store/fdtable/read.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/read.rs#L24), [`store/fdtable/write.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/write.rs#L22)), `close` frees the slot only through
`slot_mut` ([`store/fdtable/close.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/close.rs#L21)), and the attested pid comes from `split_caller`, not the payload.

## Write permission

Write permission is decided once, at open. `store.open` computes
`writable = write && (self.files[file_idx].mode & 0o200 != 0)` ([`store/fdtable/open.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/open.rs#L39)), so a descriptor
is writable only if the caller asked for write intent and the file's owner-write bit is set. A `write`
through a non-writable fd is `AccessDenied` ([`store/fdtable/write.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/write.rs#L25)), and `O_TRUNC` on a file that is
not writable is `AccessDenied` at open (`open.rs:40`). This owner-write bit is the one place `mode` is a real
permission; the [honest gaps](#honest-gaps) section states plainly what it is not.

## The path model

Paths are absolute strings that name a whole entry; there is no per-caller current directory in the vfs
pool. The shell's `cwd` lives in the terminal, and the terminal resolves paths to absolute before it calls.
The canonicalizer `normalize_to_buffer` ([`src/server/handlers/path/normalize_to_buffer.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/path/normalize_to_buffer.rs#L17)) folds a raw
path into a single leading-slash form: it always starts the output with `/` (`normalize_to_buffer.rs:19`),
collapses runs of `/` (`:23`), drops empty and `.` components (`:31`), and pops one component per `..`
without ever escaping the root (`:34`-`48`). `normalize` wraps it into an owned `String`
([`src/server/handlers/path/normalize.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/path/normalize.rs#L22)).

The important subtlety is where normalization actually runs. Only the `truncate` and `chmod` handlers call
`normalize` before acting (`truncate.rs:45`, `chmod.rs:43`); those are the two ops that carry the read-only
guard. Every other op, that is `open`, `read`, `write`, `stat`, `list`, `mkdir`, `unlink`, `rename`, `copy`,
and `rmdir`, passes the caller's path bytes straight to the store, where `find` does an exact string compare
(`lookup.rs:21`). So callers are expected to send already-canonical absolute paths, which the app-skeleton
vfs client and the terminal's `cwd::resolve` do, and the store's flat-name compare means a non-canonical path
simply does not match any stored entry rather than reaching a different one. The
[honest gaps](#honest-gaps) note this directly.

## The read-only guard

The signed-capsule tree is protected on the two ops that can rewrite an existing file's mode or length.
`is_read_only` ([`src/server/handlers/path/is_read_only.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/path/is_read_only.rs#L17)) treats `/capsules` and everything under it as
non-writable:

```
  is_read_only(path):  path == "/capsules" || path.starts_with("/capsules/")
```

Because `chmod` and `truncate` normalize first (`chmod.rs:43`, `truncate.rs:45`), the guard runs on the
canonical path, so a trailing slash (`/capsules//x`) or a traversal round-trip (`/capsules/../capsules/x`)
both normalize back under `/capsules` and are refused with `EACCES`.

The honest limit, stated again in the gaps section, is that the guard is not wired into `write`, `unlink`,
`rename`, or `rmdir`. It is a chmod-and-truncate protection, not a blanket write barrier on `/capsules`. In
practice the tree is seeded empty and the installer, not a client, populates it, so the exposure is bounded;
but the guard should not be read as a general immutability guarantee on `/capsules`.

## Zeroization

When a file's data is freed or truncated, it is zeroed first ([`src/store/fdtable/zeroize.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/fdtable/zeroize.rs#L22)):

```
  zeroize(buf):
      for byte in buf:  write_volatile(byte, 0)   // zeroize.rs:27
      compiler_fence(SeqCst)                       // zeroize.rs:30
```

The volatile write plus the fence stops the optimizer from eliding the erase as a dead store, so a deleted or
truncated file's contents cannot linger in reclaimed heap to be read back by a later allocation. It runs on
unlink (`unlink.rs:38`), on the removed subtree in rmdir (`rmdir.rs:51`), on the dropped tail in truncate
(`truncate.rs:33`), and on `O_TRUNC` at open (`open.rs:44`). The one `unsafe` block in the capsule is this
volatile write, and it carries its safety justification (`zeroize.rs:24`-`26`). This is the per-file half of
the ZeroState posture, mirroring the kernel [ramfs](/docs/userland/ramfs/)'s zero-on-drop; the difference is
that ramfs also encrypts at rest, while this pool stores plaintext and relies on zeroization alone.

## The store bounds

The bounds are the store's defence against a caller exhausting it through one oversize request or a flood:

- A single file is at most `MAX_FILE_BYTES` (1 MiB); `write` and `truncate` past it are `Full`
  (`write.rs:31`, `truncate.rs:28`).
- The store holds at most `MAX_FILES` (2048) entries; a create, `mkdir`, or `copy` past it is `Full`
  (`open.rs:58`, `mkdir.rs:34`, `copy.rs:34`, `:73`).
- At most `MAX_OPEN_FDS` (256) descriptors are open at once; an open past it is `Full` (`open.rs:48`).
- A single request payload is at most `MAX_PAYLOAD_BYTES` (64 KiB), enforced by the decoder, and a
  `read`/`write` byte count over `MAX_DATA_BYTES` (64 KiB) is `EMSGSIZE` (`read.rs:34`, `write.rs:34`).

## Honest gaps

Stated plainly:

- The namespace is flat: a file's name is its full path and there is no inode tree, so `list` is a raw
  prefix scan and returns every stored path under the prefix, not one directory level
  ([`store/fdtable/query.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/query.rs#L47)).
- Only `chmod` and `truncate` normalize the path and apply the `/capsules` read-only guard; the other
  mutating ops (`write`, `unlink`, `rename`, `rmdir`, and `mkdir`) pass the caller's path straight through
  and rely on callers sending canonical absolute paths, with the store's exact-name compare meaning a
  non-canonical path fails to match rather than reaching a different entry ([`store/fdtable/lookup.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/lookup.rs#L21)).
- `mode` is a real permission for exactly one thing, the owner-write bit checked at open (`open.rs:39`). It
  is not a full user/group/other model, and there is no ownership check on `stat`, on reading a mode-000
  file's metadata, or on `list`.
- There are no symlinks and no file locks.
- There is no persistence: the store is in RAM and vanishes on reboot, which is the point. This is the
  RAM-resident application filesystem, not an on-disk store.

## Source map

```
  userland/capsule_vfs/src/store/fdtable/types.rs    Store, File, OpenFd, StoreError, the bounds
  userland/capsule_vfs/src/store/fdtable/new.rs      preallocates the 256 fd slots
  userland/capsule_vfs/src/store/fdtable/lookup.rs   find, entry, slot_mut (the ownership check)
  userland/capsule_vfs/src/store/fdtable/open.rs     create + writable computation + fd allocation
  userland/capsule_vfs/src/store/fdtable/read.rs     position-advancing read
  userland/capsule_vfs/src/store/fdtable/write.rs    writable check, append, grow, 1 MiB ceiling
  userland/capsule_vfs/src/store/fdtable/query.rs    stat and list
  userland/capsule_vfs/src/store/fdtable/seed.rs     the seeded /docs, /capsules, and starter files
  userland/capsule_vfs/src/store/fdtable/time.rs     now_ms clamp to 0 before the clock is up
  userland/capsule_vfs/src/store/fdtable/zeroize.rs  the volatile erase
  userland/capsule_vfs/src/server/handlers/path/     normalize, normalize_to_buffer, is_read_only
```

Every reference above is verified against those trees.
