---
title: "The wire protocol and the operations"
description: "This page mirrors userland/capsulevfs/src/protocol/ and userland/capsulevfs/src/server/: the NOVF frame and its codec, the request loop, caller attestation, the dispatch table, ..."
weight: 2
---
This page mirrors `userland/capsule_vfs/src/protocol/` and `userland/capsule_vfs/src/server/`: the NOVF
frame and its codec, the request loop, caller attestation, the dispatch table, and the complete reference
for all fifteen operations. For the store the handlers act on, the descriptor table, and path handling, read
the [store](/docs/userland/vfs/store/) page. For the capsule's identity and mask, read the [README](/docs/userland/vfs/).

## The NOVF frame

A request is a framed message with a 20-byte header (`HDR_LEN`, [`src/protocol/types.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L50)) and a payload.
The header is little-endian throughout:

```
  offset  field         size
  0       magic         u32   0x4E4F5646 ("NOVF")   types.rs:17
  4       version       u16   1                     types.rs:18
  6       op            u16                          decode.rs:39
  8       flags         u16                          decode.rs:40
  10      (reserved)    u16                          (skipped by the decoder)
  12      request_id    u32                          decode.rs:41
  16      payload_len   u32   <= 65536               decode.rs:42
  20      payload       payload_len bytes            decode.rs:50
```

`decode_request` ([`src/protocol/decode.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L27)) rejects a buffer shorter than the header
(`DecodeError::Short`, `decode.rs:28`), a wrong magic (`BadMagic`, `decode.rs:32`), a wrong version
(`BadVersion`, `decode.rs:36`), and a `payload_len` over `MAX_PAYLOAD_BYTES` or a buffer shorter than header
plus payload (`BadLength`, `decode.rs:43`, `:47`). The response is built by `encode_response`
([`src/protocol/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L21)) with the same header shape, a reserved `u16` written as zero (`encode.rs:28`),
a `payload_len` of `4 + body.len()` (`encode.rs:22`), then a `status` i32 (0 or a negative errno) at offset
20, then the optional body.

The fixed bounds and flags (`types.rs:36`-`44`):

```
  MAGIC = 0x4E4F5646 ("NOVF")     VERSION = 1
  MAX_PATH_BYTES    = 256          MAX_DATA_BYTES  = 65536
  MAX_LIST_BYTES    = 65536        MAX_PAYLOAD_BYTES = 65536
  open flags:  O_CREATE = 1<<0     O_TRUNC = 1<<1     O_APPEND = 1<<2
  rmdir flag:  F_RECURSIVE = 1<<0  (in the request flags field, not the payload)
```

Every request payload begins with a four-byte little-endian caller pid (see
[caller attestation](#caller-attestation)); the operation layouts below are what follows that pid.

## The server loop

The loop ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)) is the shape every service capsule shares:

```
  run():
      buf   = vec![0; 65556]              // 64 KiB payload + header slack
      store = Store::new(); store.seed()
      loop:
          sender_pid = 0
          n = mk_ipc_recv_from(inbox 0, buf, MAX_MSG, 0, &sender_pid)   // kernel stamps sender_pid
          if n <= 0: continue
          resp = match decode_request(buf[..n]):
              Ok(req)  => dispatch(store, req, sender_pid)
              Err(_)   => encode_response(0, 0, 0, EINVAL, &[])
          mk_ipc_send(KERNEL_REPLY_ENDPOINT, resp)
```

`sender_pid` is the load-bearing argument: `mk_ipc_recv_from` returns the pid the kernel attested for the
message, not a value the sender chose, and that attested pid is threaded into every handler
(`runner.rs:33`, `runner.rs:39`). A frame that fails to decode is answered `EINVAL` rather than dropped, so
a malformed request does not stall the caller (`runner.rs:40`). The loop is single-threaded: there is no
shared state between callers other than the store and the fd table, and each request is served to
completion before the next is received.

## Caller attestation

Every handler except healthcheck runs `split_caller` ([`src/server/handlers/util.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/util.rs#L47)) before anything
else. Its rule, `resolve_caller` (`util.rs:32`), is the no-impersonation guarantee:

```
  resolve_caller(payload_pid, sender_pid):
      if sender_pid == 0:            payload_pid    // the kernel-side mirror is the TCB, trusted
      if payload_pid == sender_pid:  sender_pid     // a ring-3 caller must match its attested pid
      else:                          None -> EACCES // impersonation attempt
```

A ring-3 capsule's message carries the kernel-attested `sender_pid`, and the handler requires the payload's
claimed pid to equal it (`util.rs:36`); a mismatch is `EACCES` (`util.rs:52`-`54`). The one exception is the
kernel-side mirror (`sender_pid == 0`), the trusted computing base, which keeps the payload pid
(`util.rs:33`). A payload shorter than 4 bytes is `EINVAL` before the check (`util.rs:48`). `split_caller`
returns `(attested_pid, rest)`, and the attested pid is what the store keys descriptor ownership on.

## The dispatch table

Fifteen ops are defined ([`src/protocol/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L20)-`34`), each routed by `dispatch`
([`src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L27)) to exactly one handler; an unrecognised op is answered `EINVAL`
(`dispatch.rs:44`), so the surface is exactly these fifteen. Healthcheck is dispatched without the sender
pid because it never attests a caller (`dispatch.rs:43`).

```
  OP  name         request payload (after u32 caller_pid)         reply body
  1   OPEN         u8 path_len, path, u32 flags                   u32 fd
  2   CLOSE        u32 fd                                         (empty)
  3   READ         u32 fd, u32 max_bytes                          bytes read
  4   WRITE        u32 fd, data bytes                             u32 written
  5   STAT         u8 path_len, path                              u64 size, u32 flags, u64 mtime, u16 mode
  6   LIST         u8 prefix_len, prefix                          <u8 name_len><name> entries
  7   HEALTHCHECK  (none)                                         (empty)
  8   MKDIR        u8 path_len, path                              (empty)
  9   UNLINK       u8 path_len, path                              (empty)
  10  RENAME       u8 from_len, from, u8 to_len, to               (empty)
  11  COPY         u8 src_len, src, u8 dst_len, dst, u8 recursive (empty)
  12  RMDIR        u8 path_len, path (F_RECURSIVE via req flags)  (empty)
  13  TRUNCATE     u8 path_len, path, u64 size                    (empty)
  14  USAGE        (none)                                         u32 files, u64 bytes, u32 max_files
  15  CHMOD        u8 path_len, path, u16 mode                    (empty)
```

Every handler validates its fixed layout before touching the store: a zero or oversize path length, a short
payload, or non-UTF-8 path bytes is answered `EINVAL`. The store errors each handler can surface are mapped
to POSIX errnos by `map_store_err` ([`src/server/handlers/util.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/util.rs#L20)), so a caller sees familiar codes; the
[error mapping](#error-mapping) section lists the whole table.

## Operation reference

Each entry gives the opcode, the payload after the four-byte caller pid, the reply, and every error the
handler and its store call can return.

**OPEN (1)** `open.rs:27`. Payload: `u8 path_len, path, u32 flags`. Flags `O_CREATE`, `O_TRUNC`, `O_APPEND`
(`open.rs:54`-`56`). Reply body: `u32 fd`. The handler returns `EINVAL` on an empty rest, a zero or over-256
`path_len`, a payload too short for the path plus the 4 flag bytes, or non-UTF-8 (`open.rs:32`-`46`). It
calls `store.open(path, pid, create, truncate, append, true)`, the final `true` requesting write intent
(`open.rs:57`). The store ([`store/fdtable/open.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/open.rs#L23)) creates the file only if `O_CREATE` is set, else
`NotFound` (`ENOENT`, `open.rs:55`); a directory path is `IsDir` (`EISDIR`, `open.rs:37`); it computes
`writable = write && (mode & 0o200 != 0)` (`open.rs:39`), so opening a non-owner-writable file for write
yields no write permission, and `O_TRUNC` without a writable file is `AccessDenied` (`EACCES`,
`open.rs:41`); a full fd table is `Full` (`ENOSPC`, `open.rs:48`); a new file over the 2048 ceiling is `Full`
(`open.rs:58`). A new file is created mode `0o644` (`open.rs:65`), and `O_TRUNC` zeroizes the existing data
before clearing it (`open.rs:44`).

**CLOSE (2)** `close.rs:24`. Payload: `u32 fd`. Reply: empty. `EINVAL` if the rest is not exactly 4 bytes
(`close.rs:29`). The store `close` ([`store/fdtable/close.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/close.rs#L20)) frees the slot only through `slot_mut`,
which returns `BadFd` (`EBADF`) if the fd is out of range or not owned by this pid.

**READ (3)** `read.rs:24`. Payload: `u32 fd, u32 max_bytes`. Reply body: the bytes read. `EINVAL` if the
rest is not exactly 8 bytes (`read.rs:29`); `EMSGSIZE` if `max_bytes > MAX_DATA_BYTES` (`read.rs:34`). The
store `read` ([`store/fdtable/read.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/read.rs#L22)) resolves the fd for its owner (`BadFd` otherwise), copies at most
`max_bytes` from the current position, and advances the position; end of file returns fewer bytes, not an
error (`read.rs:28`-`29` in the store).

**WRITE (4)** `write.rs:24`. Payload: `u32 fd, data`. Reply body: `u32 written`. `EINVAL` if the rest is
under 4 bytes (`write.rs:29`); `EMSGSIZE` if `data.len() > MAX_DATA_BYTES` (`write.rs:34`). The store `write`
([`store/fdtable/write.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/write.rs#L20)) requires the fd's `writable` flag (`AccessDenied` otherwise, `write.rs:25`),
writes at `pos` or, for an append fd, at end of file (`write.rs:29`), grows the file with a zero-filled gap
if needed (`write.rs:35`), rejects a write past the 1 MiB ceiling as `Full` (`write.rs:31`), and advances
the position.

**STAT (5)** `stat.rs:26`. Payload: `u8 path_len, path`. Reply body: `u64 size, u32 flags, u64 mtime,
u16 mode` (22 bytes; `flags` is 1 for a directory, else 0, `stat.rs:49`). `EINVAL` on the usual length or
UTF-8 failures; `NotFound` (`ENOENT`) if the path is absent (`store query.rs:43`). For a directory the
reported `size` is the count of immediate children, not a byte length ([`store/fdtable/query.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/query.rs#L26)-`37`).

**LIST (6)** `list.rs:29`. Payload: `u8 prefix_len, prefix`. Reply body: concatenated
`<u8 name_len><name bytes>` entries, each directory name suffixed with `/`, capped at `MAX_LIST_BYTES` and
skipping any single name over 255 bytes ([`store/fdtable/query.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/query.rs#L47)-`63`). `EINVAL` on an empty rest, an
over-256 prefix, a truncated payload, or non-UTF-8 (`list.rs:34`-`46`). This is a raw prefix match over the
flat namespace, so the caller gets every stored path that begins with the prefix, not one directory level;
the [store](/docs/userland/vfs/store/) page explains why.

**HEALTHCHECK (7)** `healthcheck.rs:21`. No payload beyond the header is required; it echoes op, flags, and
request id with status 0 and an empty body. It does not call `split_caller`, so it is the one op that never
attests a caller (`dispatch.rs:43`).

**MKDIR (8)** `mkdir.rs:24`. Payload: `u8 path_len, path`. Reply: empty. `EINVAL` on the length or UTF-8
checks (`mkdir.rs:33`-`38`). The store `mkdir` ([`store/fdtable/mkdir.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/mkdir.rs#L23)) returns `Exists` (`EEXIST`) if
the exact path already exists (`mkdir.rs:24`), creates any missing parent components as mode `0o755`
directories (`mkdir.rs:37`-`43`), and returns `Full` (`ENOSPC`) if a create would pass the 2048 ceiling
(`mkdir.rs:34`).

**UNLINK (9)** `unlink.rs:24`. Payload: `u8 path_len, path`. Reply: empty. `EINVAL` on the usual checks. The
store `unlink` ([`store/fdtable/unlink.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/unlink.rs#L22)) returns `NotFound` if absent (`unlink.rs:23`), `NotEmpty`
(`ENOTEMPTY`) if the path is a non-empty directory (`unlink.rs:28`), closes any open fds pointing at it and
reindexes the survivors (`unlink.rs:31`-`37`), zeroizes its data (`unlink.rs:38`), and removes it.

**RENAME (10)** `rename.rs:24`. Payload: `u8 from_len, from, u8 to_len, to`. Reply: empty. `EINVAL` if either
length is zero, over 256, or truncates the payload, or on non-UTF-8 (`rename.rs:32`-`48`). The store `rename`
([`store/fdtable/rename.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/rename.rs#L22)) returns `NotFound` if the source is absent (`rename.rs:23`), `Exists` if the
destination exists (`rename.rs:24`), and for a directory rewrites every descendant's path prefix from `old/`
to `new/` (`rename.rs:38`-`44`).

**COPY (11)** `copy.rs:26`. Payload: `u8 src_len, src, u8 dst_len, dst, u8 recursive` (the recursive byte is
optional; absent or zero means non-recursive, `copy.rs:51`). Reply: empty. `EINVAL` on the length or UTF-8
checks (`copy.rs:34`-`50`). The store `copy` ([`store/fdtable/copy.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/copy.rs#L28)) returns `NotFound` if the source is
absent (`copy.rs:29`), `Exists` if the destination or any recursive descendant target exists (`copy.rs:30`,
`:61`), and `Full` if the additions would pass the 2048 ceiling (`copy.rs:34`, `:73`); a non-recursive
directory copy clones only the directory entry (`copy.rs:47`-`54`).

**RMDIR (12)** `rmdir.rs:27`. Payload: `u8 path_len, path`; the `F_RECURSIVE` bit lives in the request
*flags* field, not the payload (`rmdir.rs:43`). Reply: empty. `EINVAL` on the length or UTF-8 checks. The
store `rmdir` ([`store/fdtable/rmdir.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/rmdir.rs#L27)) returns `NotFound` if absent (`rmdir.rs:28`), `NotEmpty` if the
directory has children and `F_RECURSIVE` is clear (`rmdir.rs:33`), and otherwise removes the directory and
its whole subtree, closing open fds, reindexing survivors, and zeroizing removed data
(`rmdir.rs:40`-`59`).

**TRUNCATE (13)** `truncate.rs:26`. Payload: `u8 path_len, path, u64 size`. Reply: empty. `EINVAL` on the
length or UTF-8 checks (`truncate.rs:35`-`41`). This handler normalizes the path and applies the read-only
guard: `EACCES` if the normalized path is under `/capsules` (`truncate.rs:45`-`48`). The store `truncate`
([`store/fdtable/truncate.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/truncate.rs#L22)) returns `NotFound` if absent (`truncate.rs:23`), `IsDir` for a directory
(`truncate.rs:25`), `Full` if `size` exceeds 1 MiB (`truncate.rs:28`), zeroizes the dropped tail on a shrink
(`truncate.rs:33`), and zero-fills on a grow (`truncate.rs:35`).

**USAGE (14)** `usage.rs:25`. Payload: none beyond the caller pid. Reply body: `u32 file_count,
u64 bytes_used, u32 max_files` ([`store/fdtable/usage.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/usage.rs#L22)). The only error path is the attestation failure
returned by `split_caller` (`usage.rs:26`).

**CHMOD (15)** `chmod.rs:26`. Payload: `u8 path_len, path, u16 mode`. Reply: empty. `EINVAL` on the length or
UTF-8 checks (`chmod.rs:35`-`40`). Like truncate, it normalizes and applies the read-only guard: `EACCES`
under `/capsules` (`chmod.rs:43`-`46`). The store `chmod` ([`store/fdtable/chmod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/fdtable/chmod.rs#L21)) returns `NotFound` if
absent (`chmod.rs:22`) and otherwise sets `mode & 0o777` (`chmod.rs:23`).

## Error mapping

`map_store_err` ([`src/server/handlers/util.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/util.rs#L20)) maps the store's errors to the POSIX errnos in
[`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs):

```
  NotFound     -> ENOENT    (-2)     errno.rs:17
  BadFd        -> EBADF     (-9)     errno.rs:18
  AccessDenied -> EACCES    (-13)    errno.rs:19
  Exists       -> EEXIST    (-17)    errno.rs:20
  IsDir        -> EISDIR    (-21)    errno.rs:21
  Full         -> ENOSPC    (-28)    errno.rs:23
  NotEmpty     -> ENOTEMPTY (-39)    errno.rs:24
```

Two errnos are returned directly by handlers rather than through the store: `EINVAL` (-22, `errno.rs:22`)
for a malformed frame or payload, and `EMSGSIZE` (-90, `errno.rs:25`) for a read or write whose byte count
exceeds `MAX_DATA_BYTES` (`read.rs:35`, `write.rs:35`). Attestation itself returns `EACCES` on an
impersonation attempt and `EINVAL` on a too-short payload (`util.rs:49`, `:54`).

## Clients

The vfs pool speaks only its own NOVF protocol on the `vfs_pool` service; it makes no outbound IPC calls of
its own. Its clients reach it through the app-skeleton vfs client, whose op constants mirror the server's one
for one ([`userland/app_skeleton/src/clients/vfs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/types.rs#L17)-`33`): `OP_OPEN 1` through `OP_CHMOD 15`, the
same magic `0x4E4F5646`, the `O_CREATE`/`O_TRUNC` flags, and service name `vfs_pool`. Note the client omits
`OP_HEALTHCHECK 7` from its op list; it is a server-side liveness echo, not a client verb.

The clients in the tree are the terminal (every filesystem verb: `ls`, `cat`, `write`, `mkdir`, `mv`, `rm`,
`stat`, `find`, `du`, tab completion, and `> >> <` redirection), the file manager (its listing, metadata,
previews, and permission display), the text editor (open and save), and the sovereign std filesystem session
layer. Because all of them read and write the same pool, a file one writes is visible to the others.

## Source map

```
  userland/capsule_vfs/src/protocol/types.rs   NOVF frame, ops, flags, bounds, reply endpoint
  userland/capsule_vfs/src/protocol/decode.rs  decode_request (magic/version/length checks)
  userland/capsule_vfs/src/protocol/encode.rs  encode_response (header + status + body)
  userland/capsule_vfs/src/protocol/errno.rs   the POSIX errno constants
  userland/capsule_vfs/src/server/runner.rs    the recv/decode/dispatch/reply loop
  userland/capsule_vfs/src/server/dispatch.rs  op -> handler (unknown -> EINVAL)
  userland/capsule_vfs/src/server/handlers/    the 15 handlers + util.rs (split_caller, map_store_err)
  userland/capsule_vfs/src/store/fdtable/      the store methods each handler calls
  userland/app_skeleton/src/clients/vfs/types.rs   the client op constants
```

Every reference above is verified against those trees.
