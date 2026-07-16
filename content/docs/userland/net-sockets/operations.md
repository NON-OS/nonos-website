---
title: "The operation interface"
description: "This page mirrors src/protocol/ and the request-loop front of src/server/."
weight: 2
---
This page mirrors `src/protocol/` and the request-loop front of `src/server/`. It is the boundary
`net.sockets` presents to callers: the `NSKT` wire format, the loop that receives and dispatches, the
eleven operations and their payloads, and the errno set every reply carries. For what a handle op reads or
mutates in the table, read the [handles](/docs/userland/net-sockets/handles/) page; for how an op leaves for a transport capsule,
read the [transports](/docs/userland/net-sockets/transports/) page.

## The NSKT wire format

Every request and reply begins with a fixed twenty-byte header, defined in one place as `HDR_LEN`
([`src/server/parse_req.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L19), [`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). The magic is `NSKT`, stored as the
little-endian `u32` `0x4E534B54` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)).

```
  offset  size  field
  0       4     magic       "NSKT" little-endian (0x4E534B54)
  4       2     version     always 1
  6       2     op          OP_* opcode
  8       2     errno       reply status; 0 in a request
  10      2     reserved    zeroed
  12      4     request_id  echoed back unchanged
  16      4     payload_len bytes of body after the header
```

The parser rejects a buffer shorter than the header with `E_BAD_LEN`, a wrong magic with `E_BAD_MAGIC`, a
version other than 1 with `E_BAD_VERSION`, and a `payload_len` that overflows or runs past the buffer with
`E_BAD_LEN`; it returns the body as a slice bounded to exactly `payload_len`
([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). A reply reuses the same layout: `respond` writes the magic, version 1, the
op, the errno, a zeroed reserved word, the echoed `request_id`, and the reply `payload_len`, then sends the
header plus body back to the sender by pid with `mk_ipc_reply` ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)). This is the
same twenty-byte frame the NØNOS standard library builds when it opens a socket
([`userland/sdk/nonos_std/src/net/proto/wire.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/sdk/nonos_std/src/net/proto/wire.rs#L34)).

## The request loop

`server::run` allocates one receive and one transmit buffer of `HDR_LEN + 1536` and loops forever
([`src/server/runner.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L26), [`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)). Each turn does three things in order:

1. Block on `mk_ipc_recv_from` for the next request, recording the sender pid ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)).
   The pid is the kernel-attested caller identity, and it is what every handle is scoped to; a receive that
   returns nothing or a zero sender is skipped ([`src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L34)).
2. Parse the request header and body. A parse failure is skipped silently rather than answered, because a
   malformed frame has no trustworthy `request_id` to echo ([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)).
3. Dispatch on the opcode to a handler ([`src/server/handlers/dispatch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L23)). A recognized op runs its
   handler and the dispatcher returns `true`; an unknown op returns `false`, and the loop replies `E_BAD_OP`
   with the echoed `request_id` ([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38), [`src/server/handlers/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L36)).

Unlike the transport capsules, the loop runs no timer tick between requests: `net.sockets` holds no timers
of its own, because every timed thing, a connect deadline, a retransmit, a TimeWait, lives in the transport
capsule it dispatches to. It parks in `mk_ipc_recv_from` until a client calls.

## The operations

The opcodes are `u16` constants ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)). Handles are the per-socket identifiers the
table mints; see the [handles](/docs/userland/net-sockets/handles/) page. Every handler is one file under `src/server/handlers/`,
and the dispatch maps each op to exactly one ([`src/server/handlers/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L24)).

| Op | Value | Request body | Reply body | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | none | none | [`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21) |
| `OP_SOCKET` | 2 | `u16` family, `u16` kind | `u32` handle | [`src/server/handlers/socket.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L23) |
| `OP_BIND` | 3 | `u32` handle, `[u8;4]` ip, `u16` port | none | [`src/server/handlers/bind.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L25) |
| `OP_LISTEN` | 4 | `u32` handle | none | [`src/server/handlers/listen.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L25) |
| `OP_ACCEPT` | 5 | `u32` handle | `u32` child handle | [`src/server/handlers/accept.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept.rs#L25) |
| `OP_CONNECT` | 6 | `u32` handle, `[u8;4]` ip, `u16` port | none | [`src/server/handlers/connect.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L25) |
| `OP_SEND` | 7 | `u32` handle, bytes | none | [`src/server/handlers/send.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L25) |
| `OP_RECV` | 8 | `u32` handle | payload bytes | [`src/server/handlers/recv.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L25) |
| `OP_CLOSE` | 9 | `u32` handle | none | [`src/server/handlers/close.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L25) |
| `OP_GETSOCKOPT` | 10 | `u32` handle | 16-byte status block | [`src/server/handlers/getsockopt.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getsockopt.rs#L23) |
| `OP_SETSOCKOPT` | 11 | `u32` handle, `u16` level, `u16` opt | none | [`src/server/handlers/setsockopt.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/setsockopt.rs#L28) |

The body fields are read with the bounds-checked helpers `u16_at`, `u32_at`, and `ip4_at`, each of which
returns `E_BAD_LEN` when the requested slice runs past the body ([`src/server/handlers/io.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/io.rs#L19)). A handler
that reads a field the request did not supply fails cleanly with a length error rather than reading past
the buffer.

### Health

`OP_HEALTHCHECK` replies `E_OK` with an empty body; it is the liveness probe and touches no state
([`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21)).

### Socket

`OP_SOCKET` reads a `u16` family and a `u16` kind. The only accepted family is `4`, the IPv4 marker;
anything else is `E_BAD_FAMILY` ([`src/server/handlers/socket.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L24)). The kind maps `1` to `Stream`, `2` to
`Datagram`, and `3` to `Mixnet`, and any other value is `E_BAD_KIND` ([`src/server/handlers/socket.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L29)).
On success it opens a new socket in the table for the caller pid and replies the fresh `u32` handle, or
`E_TABLE_FULL` if the 256 slots are exhausted ([`src/server/handlers/socket.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L36)).

### Bind

`OP_BIND` reads the handle, a four-byte IP that it validates but does not store, and a `u16` port
([`src/server/handlers/bind.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L42)). For a `Datagram` socket it binds the port on `net.udp` and returns
`E_NO_TRANSPORT` if that fails; for other kinds it just records the local port. It marks the socket bound
and stores its local port, replying `E_OK`, or `E_NO_HANDLE` for a handle the caller does not own
([`src/server/handlers/bind.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L31)).

### Listen and accept

`OP_LISTEN` reads the handle and requires a `Stream` socket that has already been bound; otherwise it is
`E_NOT_BOUND` ([`src/server/handlers/listen.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L31)). It calls `tcp::listen` on `net.tcp` with the bound
port, stores the returned transport handle, marks the socket listening, and replies `E_OK`, or
`E_NO_TRANSPORT` if the TCP listen fails ([`src/server/handlers/listen.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L35)). `OP_ACCEPT` reads the
listener handle, reads its transport handle, and calls `tcp::accept` on `net.tcp`; on a ready child it
opens a fresh `Stream` socket for the caller, stores the child transport handle, marks it bound, and
replies the new local handle, or `E_NO_TRANSPORT` when no child is ready and `E_TABLE_FULL` if the table
is full ([`src/server/handlers/accept.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept.rs#L30)).

### Connect

`OP_CONNECT` reads the handle, the destination IP, and the destination port, and records the remote address
on the socket ([`src/server/handlers/connect.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L30)). A `Datagram` socket needs no connection and returns
`E_OK` at once. A `Mixnet` socket sets the Nym gateway to the given address and opens a Nym session,
storing the session as the transport handle, or `E_NO_TRANSPORT` if `net.nym` was never discovered
([`src/server/handlers/connect.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L35), [`src/server/handlers/connect.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L59)). Any other kind is `Stream`: it
calls `tcp::connect` on `net.tcp` and stores the returned connection as the transport handle, replying
`E_OK` or `E_NO_TRANSPORT` ([`src/server/handlers/connect.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L44)). An unknown handle is `E_NO_HANDLE`.

### Send and receive

`OP_SEND` requires at least four body bytes for the handle, then treats the rest as the payload
([`src/server/handlers/send.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L26)). It dispatches by kind: a `Stream` socket with a live transport handle
sends over `net.tcp`, a `Datagram` socket with both a local and a remote address sends over `net.udp`, and
a `Mixnet` socket with a live session sends over `net.nym`; a socket that is not in a sendable state is
`E_NOT_CONNECTED`, an unknown handle is `E_NO_HANDLE`, and a transport-level failure is `E_NO_TRANSPORT`
([`src/server/handlers/send.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L41)). `OP_RECV` reads the handle and dispatches the same way, reading from
`net.tcp`, `net.udp`, or `net.nym` into the reply body and replying the byte count; a `Datagram` socket
with no local port or a socket in the wrong state is `E_NOT_CONNECTED`, an unknown handle is `E_NO_HANDLE`,
and a transport failure is `E_NO_TRANSPORT` ([`src/server/handlers/recv.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L42)).

### Close

`OP_CLOSE` reads the handle, loads the socket, and tears down its transport before releasing the local
slot: a `Stream` socket with a live transport handle is closed on `net.tcp`, a bound `Datagram` socket is
unbound on `net.udp`, and a `Mixnet` socket with a live session is closed on `net.nym`; any transport
failure is `E_NO_TRANSPORT` ([`src/server/handlers/close.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L34)). It then removes the slot from the table
and replies `E_OK`, or `E_NO_HANDLE` if the handle was unknown or already gone
([`src/server/handlers/close.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L51)).

### Options

`OP_GETSOCKOPT` reads the handle and replies a sixteen-byte status block: the kind as a `u32`, a flags word
packing bound, listening, has-remote, and has-transport bits, the transport handle, and a zeroed word
([`src/server/handlers/getsockopt.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getsockopt.rs#L38)). An unknown handle is `E_NO_HANDLE`. `OP_SETSOCKOPT` reads the
handle, a `u16` level, and a `u16` option; the only accepted pair is the mixnet cover-tick level and option
([`src/server/handlers/setsockopt.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/setsockopt.rs#L25)). It requires a `Mixnet` socket with a live session and a
discovered `net.nym`, then issues the cover request on the session, replying `E_OK`, or `E_BAD_LEN` for an
unrecognized level or option and `E_NO_TRANSPORT` for a socket that cannot carry it
([`src/server/handlers/setsockopt.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/setsockopt.rs#L55)).

## The errno set

Every reply carries a `u16` errno at offset 8 ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

| Errno | Value | Meaning |
|---|---|---|
| `E_OK` | 0 | success |
| `E_BAD_MAGIC` | 1 | header magic was not `NSKT` |
| `E_BAD_VERSION` | 2 | header version was not 1 |
| `E_BAD_OP` | 3 | opcode not recognized |
| `E_BAD_LEN` | 4 | body too short, too long, or overflowing |
| `E_NO_HANDLE` | 5 | handle not owned by the caller |
| `E_NO_TRANSPORT` | 6 | the transport capsule refused or is not reachable |
| `E_TABLE_FULL` | 7 | the 256-slot socket table is full |
| `E_BAD_FAMILY` | 8 | socket family was not 4 (IPv4) |
| `E_BAD_KIND` | 9 | socket kind was not stream, datagram, or mixnet |
| `E_NOT_BOUND` | 10 | listen on a socket that was not bound |
| `E_NOT_CONNECTED` | 12 | send or recv on a socket with no usable transport state |

`E_BAD_MAGIC` and `E_BAD_VERSION` are produced by the parser, which causes the loop to skip the request
rather than reply, so in practice a client sees the length, handle, transport, table, family, kind, bound,
and connected errnos; the magic and version errnos surface only if a handler chooses to re-encode them
([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27), [`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)).

## Source map

```
  userland/capsule_net_sockets/src/protocol/header.rs   the NSKT magic
  userland/capsule_net_sockets/src/protocol/ops.rs      the eleven opcode constants
  userland/capsule_net_sockets/src/protocol/errno.rs    the errno set
  userland/capsule_net_sockets/src/server/runner.rs     the receive loop
  userland/capsule_net_sockets/src/server/parse_req.rs  the request header parser
  userland/capsule_net_sockets/src/server/respond.rs    the reply header encoder and mk_ipc_reply
  userland/capsule_net_sockets/src/server/handlers/dispatch.rs  the opcode-to-handler match
  userland/capsule_net_sockets/src/server/handlers/io.rs        the bounds-checked body readers
  userland/capsule_net_sockets/src/server/handlers/             one handler per op
  userland/sdk/nonos_std/src/net/proto/wire.rs          the standard-library frame builder over the same wire
```

Every reference above is verified against those trees.
