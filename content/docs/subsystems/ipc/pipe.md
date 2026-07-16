---
title: "Pipes"
description: "The inbox path carries discrete messages between capsules."
weight: 4
---
The inbox path carries discrete messages between capsules. The pipe is the other IPC
primitive: an anonymous byte FIFO behind a pair of file descriptors, the substrate for the
POSIX-shaped pipe the filesystem and file-descriptor table expose. It is a byte stream, not
a message queue, and it does not carry a sender identity or a MAC; it is a buffer with a
read end and a write end. The code is under `src/ipc/pipe/`.

## The buffer

A `Pipe` ([`src/ipc/pipe/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/pipe/types.rs#L26)) is a fixed-capacity ring buffer with independent read
and write positions and separate closed and non-blocking flags for each end:

```
  struct Pipe {
      buffer:          Vec<u8>,    // capacity bytes, allocated once
      read_pos, write_pos: usize,  // ring cursors
      bytes_available: usize,
      capacity:        usize,
      read_closed, write_closed:     bool,
      read_nonblock, write_nonblock: bool,
  }
```

The default capacity is `PIPE_BUF_SIZE = 65536` (`types.rs:20`), and the number of live
pipes is bounded by `MAX_PIPES = 1024`. The buffer is allocated at creation and never
grows; `space_available` is `capacity - bytes_available`, and the cursors wrap modulo the
capacity.

## Create, read, write

`create_pipe` ([`src/ipc/pipe/api.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/pipe/api.rs#L21)) allocates a pipe id, inserts the pipe into the
global table, and hands back two descriptors, a read fd and a write fd, each recorded in
the fd-to-pipe map with a flag marking which end it is
(`ENFILE`-style capacity error `24` if the table is full):

```
  create_pipe() -> (read_fd, write_fd)
```

`pipe_read` and `pipe_write` (`api.rs:43`, `api.rs:74`) look the fd up, enforce the end,
reading on a write fd or writing on a read fd is `EBADF`, and act on the ring:

- A read from an empty pipe returns `0` if the write end is closed (end of stream) and
  `EAGAIN` otherwise (`api.rs:58`). A non-empty read copies up to `min(buf, available)`
  bytes, advancing the read cursor.
- A write to a pipe whose read end is closed is `EPIPE` (`api.rs:89`); a write to a full
  pipe is `EAGAIN`. Otherwise it copies up to `min(buf, space)` bytes, advancing the write
  cursor.

Both are partial: they move as many bytes as fit and report the count, leaving the caller
to loop. The `is_broken` predicate (`types.rs:59`) is the end-of-stream condition, write
end closed and nothing left buffered.

## Where it is used

The pipe primitive is consumed by the filesystem and the process fd table
(`src/fs/pipe/`, [`src/process/fd_table.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/fd_table.rs)), which layer the blocking policy, the fd
lifecycle, and the syscall surface on top. Within IPC this module owns only the buffer and
the byte transfer; the message-passing path between capsules is the [inbox](/docs/subsystems/ipc/inbox/), not
the pipe. The two coexist: pipes give a capsule a stream fd it can hand to a child or wire
into a filter, and inboxes give the kernel a permission-checked, sender-attested message
channel.

## Security analysis

The pipe is the deliberately unprivileged IPC primitive, and its security story is mostly about what it
is *not*. Unlike the [inbox](/docs/subsystems/ipc/inbox/), it carries no sender identity, no MAC, and no capability check;
it is a buffer reached through file descriptors, and its safety comes from the fd table's ownership of
those descriptors rather than from anything the pipe itself authenticates. Two properties hold, and the
boundary is the important part.

**Bounded and fixed-size.** The buffer is `Vec<u8>` allocated once at `PIPE_BUF_SIZE = 65536`
(`types.rs:20`) and never grown; `space_available` is `capacity - bytes_available` and the cursors wrap
modulo the capacity (`api.rs:96`). A write to a full pipe is `EAGAIN`, not a reallocation, so a fast
writer against a slow reader stalls at the buffer bound rather than growing kernel memory. The number of
live pipes is itself bounded by `MAX_PIPES = 1024` (`create_pipe_with_size`, `api.rs:27`), which returns
an `ENFILE`-style `24` when the table is full, so pipe creation cannot exhaust the kernel either.

**End-enforced descriptors.** Each fd is recorded in the fd-to-pipe map with a flag for which end it is
(`api.rs:38`), and the transfer functions enforce it: reading on a write fd or writing on a read fd is
`EBADF` (`api.rs:48`, `api.rs:79`), as is an fd not in the map at all. A capsule can only move bytes in
the direction the descriptor it holds allows.

The honest boundary, stated plainly because it is the whole point: the pipe does not authenticate its
peers and does not check a capability. Whoever holds the write fd can write and whoever holds the read
fd can read, and the pipe knows nothing about which capsule that is. The security of a pipe is entirely
the security of who was handed its descriptors, which is the process fd table's concern
([`src/process/fd_table.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/fd_table.rs)) and the spawn plan that wires a child's fds. This is why the message channel
between capsules is the inbox, not the pipe: the inbox is where sender attestation and the capability
check live. The pipe is a stream a capsule already trusts its counterpart on, typically a parent wiring
a child or a filter in a shell pipeline, not a channel for reaching an arbitrary capsule.

## Debugging pipes

The pipe's whole error surface is four values and every one names a concrete condition, so a failing
pipe call is unambiguous. `EBADF` from `pipe_read` or `pipe_write` (`api.rs:43`, `api.rs:74`) means one
of two things: the fd is not in the fd-to-pipe map, or it is but the caller used the wrong end (read on
a write fd or the reverse). Since the end is fixed at `create_pipe`, an `EBADF` on an fd you believe is
valid is almost always an end mix-up, not a closed pipe. `EAGAIN` is the flow-control signal and means
different things on each side: from a read it is an empty pipe whose write end is still open
(`read_from_pipe`, `api.rs:63`), from a write it is a full buffer (`write_to_pipe`, `api.rs:94`); both
say "come back later," and a caller looping on `EAGAIN` forever is a peer that stopped draining or
filling, not a broken pipe. The two definitive conditions are the end-of-stream pair: a read of `0` on
an empty pipe means the write end is closed (`api.rs:60`), the real EOF, and a write to a pipe whose read
end is closed is `EPIPE` (`api.rs:91`), the broken-pipe case. The `is_broken` predicate (`types.rs:59`),
write end closed with nothing buffered, is the same condition the read side reports as `0`. So a stream
that hangs versus one that ended is read straight off the return: repeated `EAGAIN` is a live but idle
peer, a `0` read or `EPIPE` write is a closed counterpart.

## Source map

```
  src/ipc/pipe/types.rs     the ring buffer, PIPE_BUF_SIZE, MAX_PIPES, EAGAIN / EBADF / EPIPE, is_broken
  src/ipc/pipe/api.rs       create_pipe, pipe_read, pipe_write, the end and flow-control checks
  src/ipc/pipe/registry.rs  the pipe and fd tables
  src/ipc/pipe/close.rs     pipe_close, non-blocking mode
```

Every reference above is verified against those trees. The blocking policy, fd lifecycle, and syscall
surface layered on top live in the filesystem pipe (`src/fs/pipe/`) and the process fd table
([`src/process/fd_table.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/fd_table.rs)); the sender-attested, capability-checked message channel that the pipe
deliberately is not is the [inbox](/docs/subsystems/ipc/inbox/).
