---
title: "The socket handle model"
description: "This page mirrors src/sockets/. It is the socket abstraction itself: what a socket is in this capsule, how a handle is minted and scoped to its owner, and the fixed table the ha..."
weight: 3
---
This page mirrors `src/sockets/`. It is the socket abstraction itself: what a socket is in this capsule,
how a handle is minted and scoped to its owner, and the fixed table the handlers read and mutate through.
For the ops that drive these handles, read the [operations](/docs/userland/net-sockets/operations/) page; for the transport state a
handle points at, read the [transports](/docs/userland/net-sockets/transports/) page.

## What a socket is here

A socket in `net.sockets` is a small control block, not a connection. The heavy state, the sequence space,
the datagram queue, the mixnet session, lives in the transport capsule; the socket record holds only the
policy this capsule owns and a handle into that transport. The record is a `Socket`
([`src/sockets/table/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/types.rs#L24)):

```
  key               SocketKey { pid, handle }   the owner and the local handle
  kind              Kind                        Stream, Datagram, or Mixnet
  local             Option<LocalAddr4>          the bound local port, if any
  remote            Option<RemoteAddr4>         the connect destination, if any
  transport_handle  u32                         the handle the transport minted, 0 if none
  bound             bool                        set by bind or by accept
  listening         bool                        set by listen
```

`Kind` is the socket family in the BSD sense, a three-variant enum with no data
([`src/sockets/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/types.rs#L17)): `Stream` maps to `net.tcp`, `Datagram` to `net.udp`, and `Mixnet` to
`net.nym`. It is chosen once at `OP_SOCKET` from the `u16` kind field and never changes; every later op
branches on it to pick a backend. `LocalAddr4` is a bound port and `RemoteAddr4` is a destination IP and
port ([`src/sockets/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/types.rs#L30)); the capsule keeps IPv4 addressing only, which is why `OP_SOCKET` accepts
only family 4.

The `transport_handle` is the load-bearing field. It is `0` on a fresh socket and stays `0` for a datagram
socket, which is addressed by its local and remote ports rather than a connection handle. For a stream
socket it becomes the `net.tcp` connection or listener handle after connect, listen, or accept; for a
mixnet socket it becomes the `net.nym` session after connect. The `getsockopt` flags word exposes whether
it is set, alongside the bound, listening, and has-remote bits ([`src/server/handlers/getsockopt.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getsockopt.rs#L53)),
so a client can read a socket's shape without guessing.

## The handle and its owner

A handle is not a bare integer; it is half of a `(pid, handle)` pair ([`src/sockets/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/types.rs#L24)). The `pid`
is the kernel-attested sender the receive loop recorded ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)), and the `handle` is a
process-global counter value the table hands out. Every table operation matches on both fields, so a handle
minted for one caller is invisible to another even if the numeric value collides: `with` and `close` both
require `s.key.handle == key.handle && s.key.pid == key.pid` before they touch a slot
([`src/sockets/table/lookup.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/lookup.rs#L29), [`src/sockets/table/close.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/close.rs#L25)). This is the per-pid isolation the
capsule promises: a compromised caller cannot name another caller's socket, because the pid half of the key
is stamped by the kernel, not supplied in the request.

The `handle` value comes from a single `AtomicU32` counter that starts at 1 and only ever increments
([`src/sockets/table/types.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/types.rs#L42), [`src/sockets/table/open.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/open.rs#L25)). Because it is monotonic and never
reused within a boot, a stale handle from a closed socket does not alias a live one; a request carrying it
misses in the table and gets `E_NO_HANDLE`. The `0` value is reserved as the "no transport handle" sentinel
in the `Socket` record, so the counter starting at 1 keeps a real handle from ever colliding with that
sentinel.

## The table

The table is a fixed array of `TABLE_CAP = 256` optional slots behind a `spin::Mutex`, plus the handle
counter ([`src/sockets/table/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/types.rs#L22), [`src/sockets/table/types.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/types.rs#L35)). It is a single process-global
`static SOCKETS` constructed at compile time ([`src/sockets/table/types.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/types.rs#L46)), so there is one table for
the whole capsule holding every caller's sockets, distinguished only by the pid in each key. The fixed
array means the capsule allocates no per-socket heap for the records themselves and cannot grow without
bound; a caller that opens sockets without closing them eventually fills the array and gets
`E_TABLE_FULL`, which caps the memory a hostile client can pin.

Three operations, one file each, are the whole table interface.

`open` mints the next handle from the counter, builds a fresh `Socket` with `bound` and `listening` false,
`transport_handle` zero, and no local or remote address, then scans for the first empty slot and stores it,
returning the new key or `None` if all 256 are taken ([`src/sockets/table/open.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/open.rs#L24),
[`src/sockets/table/open.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/open.rs#L38)). It is called by `OP_SOCKET` for a client-created socket and by `OP_ACCEPT`
for the child a completed handshake yields, so an accepted connection is an ordinary socket in the same
table with its own handle.

`with` is the read-modify-write path every handler uses. It locks the table, finds the slot whose key
matches both the pid and the handle, and runs a closure against a mutable reference to the `Socket`,
returning the closure's result, or `None` when no slot matches ([`src/sockets/table/lookup.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/lookup.rs#L22)). Because
the closure runs under the lock, a handler's read of the kind, its update of a transport handle, and its
flag changes are one atomic step against the table; two concurrent requests on the same socket cannot
interleave a half-updated record.

`close` locks the table, finds the matching slot, sets it to `None`, and returns whether it found one
([`src/sockets/table/close.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/close.rs#L22)). It is the last step of `OP_CLOSE`, run only after the transport teardown
succeeds, so a slot is freed for reuse exactly when its transport state is gone. The returned boolean is
what lets `OP_CLOSE` answer `E_NO_HANDLE` for a double close.

## Source map

```
  userland/capsule_net_sockets/src/sockets/mod.rs           the module re-exports
  userland/capsule_net_sockets/src/sockets/types.rs         Kind, SocketKey, LocalAddr4, RemoteAddr4
  userland/capsule_net_sockets/src/sockets/table/mod.rs     the table module re-exports
  userland/capsule_net_sockets/src/sockets/table/types.rs   the Socket block, TABLE_CAP, the mutex table, the counter
  userland/capsule_net_sockets/src/sockets/table/open.rs    open: mint a handle and take a slot
  userland/capsule_net_sockets/src/sockets/table/lookup.rs  with: the locked read-modify-write on a keyed slot
  userland/capsule_net_sockets/src/sockets/table/close.rs   close: free the matching slot
  userland/capsule_net_sockets/src/server/handlers/getsockopt.rs  the flags word that exposes a socket's shape
  userland/capsule_net_sockets/src/server/runner.rs         where the attested pid half of a key comes from
```

Every reference above is verified against those trees.
