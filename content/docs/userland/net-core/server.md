---
title: "The request server"
description: "This page mirrors src/server/. It documents the single request loop that both pumps the stack and answers clients, the header parse and the magic dispatch, the reply encoder, an..."
weight: 3
---
This page mirrors `src/server/`. It documents the single request loop that both pumps the stack and answers
clients, the header parse and the magic dispatch, the reply encoder, and every handler behind the ops the
[protocol](/docs/userland/net-core/protocol/) page lists. For the wire formats those handlers decode, read the
[protocol](/docs/userland/net-core/protocol/) page; for the state tables they read and write, read the [iface](/docs/userland/net-core/iface/) page.

## One loop, poll then serve

The whole server is one loop that never returns ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)). Each iteration does two things
in order: it pumps the smoltcp stack once, then it waits a bounded time for one client request and answers
it. Pumping first means the stack advances even when no client is calling, so DHCP, retransmits, and
incoming data keep moving ([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37), [iface](/docs/userland/net-core/iface/)).

The receive is `mk_ipc_recv_from` on the service inbox with a 50 ms poll timeout, which also yields the
sender's pid ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)). A non-positive length or a zero sender pid is skipped
([`src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L46)); the zero-pid guard matters because every handler scopes a socket to the pid
that owns it, so an unattributed message is never served. The buffers are allocated once outside the loop at
`HDR_LEN + IPC_BUF_MAX` bytes, where `IPC_BUF_MAX` is 1024 ([`src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L34),
[`src/server/parse_req.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L20)).

## Parse and dispatch

`parse` validates the 20-byte header before any handler sees the request ([`src/server/parse_req.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L29)). It
rejects a short buffer with `E_BAD_LEN`, a version other than 1 with `E_BAD_VERSION`, and a declared payload
length that overflows or exceeds the received bytes with `E_BAD_LEN` ([`src/server/parse_req.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L30)). On
success it returns a `Request` carrying the magic, op, and request id, plus a body slice sized exactly to
the declared payload length ([`src/server/parse_req.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L44)). A parse failure drops the message silently and
the loop continues ([`src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L49)).

Dispatch is two-level ([`src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L50)). `OP_HEALTHCHECK` (1) is matched first, before the magic,
so it answers for any protocol ([`src/server/handlers/health.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L23)). Otherwise the magic selects the
protocol module: `NDHC` to `dhcp_status::dispatch`, `NTCP` to `tcp::dispatch`, `NUDP` to `udp::dispatch`,
`NDNS` to `dns::dispatch` ([`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52)). An unknown magic is answered with `E_BAD_MAGIC`
([`src/server/runner.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L65)). Each protocol's `dispatch` then matches the op and answers `E_BAD_OP` for one
it does not handle (for example [`src/server/handlers/tcp/mod.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/mod.rs#L36)).

## Encoding a reply

Every handler ends by calling `reply` ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). It writes the 20-byte header into the
reused `tx` buffer with the client's magic and op echoed back, the version fixed to 1, the errno in the
status field, the request id copied through, and the payload length set, then copies the body and sends with
`mk_ipc_reply` to the sender pid ([`src/server/respond.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L30)). Echoing the magic and op back lets a client
match a reply to its request; copying the request id through lets it match across concurrent calls.

## The TCP handlers

All five are keyed on a 4-byte application handle the client got from `OP_CONNECT`, and every one resolves
that handle through `handles::get(app_handle, sender_pid)`, which returns the socket only if the caller owns
it ([`src/handles.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L35), [iface](/docs/userland/net-core/iface/)). A handle the caller does not own answers `E_NO_SOCKET`.

- `connect` allocates an ephemeral local port from 49152 up, builds a smoltcp `tcp::Socket` with 8 KiB rx
  and tx buffers, calls `connect`, and on success allocates an app handle in the socket table and returns it
  ([`src/server/handlers/tcp/connect.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/connect.rs#L43)). A connect error answers `E_NOT_CONNECTED`; a full socket table
  answers `E_NO_SOCKET` and removes the socket it just added ([`src/server/handlers/tcp/connect.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/connect.rs#L78)).
- `send` copies the payload after the handle into the socket's send buffer and returns the byte count smoltcp
  accepted ([`src/server/handlers/tcp/send.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/send.rs#L41)); a failure answers `E_NOT_CONNECTED`.
- `recv` drains up to `IPC_BUF_MAX` bytes from the socket and returns them, or `E_RX_EMPTY` when nothing is
  buffered ([`src/server/handlers/tcp/recv.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/recv.rs#L40)).
- `close` calls `close` on the socket and frees the app handle from the table ([`src/server/handlers/tcp/close.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/close.rs#L40)).
- `state` reads the smoltcp connection state and returns the 1-byte code the [protocol](/docs/userland/net-core/protocol/) page
  lists ([`src/server/handlers/tcp/state.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/state.rs#L40)).

## The UDP handlers

UDP sockets are keyed on the caller's pid and the local port, not on an opaque handle, through the
`udp_ports` table ([`src/udp_ports.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs#L43), [iface](/docs/userland/net-core/iface/)).

- `bind` builds a smoltcp `udp::Socket` with 16-slot, 4 KiB packet buffers, binds the requested local port,
  and inserts it into the port table; a bind error answers `E_BIND_FAILED` and a full table `E_NO_SOCKET`
  ([`src/server/handlers/udp/bind.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/bind.rs#L32)).
- `send` looks up the socket by local port, then sends the payload to the destination IPv4 and port carried
  in the request ([`src/server/handlers/udp/send.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/send.rs#L26)); a send error answers `E_NOT_CONNECTED`.
- `recv` returns one datagram prefixed with the 4-byte source IPv4 and 2-byte source port, clamped to
  `IPC_BUF_MAX - 6` bytes, or `E_RX_EMPTY` when none is queued ([`src/server/handlers/udp/recv.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/recv.rs#L26)).
- `unbind` removes the socket from the smoltcp set and the port table ([`src/server/handlers/udp/unbind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/unbind.rs#L23)).

## The DNS handler

`resolve_a` reads the hostname as UTF-8, rejecting empty or non-UTF-8 with `E_NAME_INVALID`
([`src/server/handlers/dns/resolve_a.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L30)). It starts a smoltcp DNS A query against the socket installed
when the lease arrived, answering `E_NO_LEASE` if there is no DNS socket yet
([`src/server/handlers/dns/resolve_a.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L34)). It then loops, pumping the stack and polling for the answer,
until the query resolves or a 3000 ms deadline passes, cancelling the query and answering `E_SERVFAIL` on
timeout ([`src/server/handlers/dns/resolve_a.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L41)). On success it replies with the first IPv4 address
([`src/server/handlers/dns/resolve_a.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L59)). This is the one handler that blocks the loop while it waits,
bounded by that deadline.

## The DHCP status and health handlers

`dhcp_status::dispatch` serves `OP_LEASE_STATUS` by encoding the 18-byte lease body from the shared lease
state and replying `E_OK` ([`src/server/handlers/dhcp_status.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dhcp_status.rs#L49)). `encode_body` is also called from the
DHCP event path as a self-check marker ([`src/server/handlers/dhcp_status.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dhcp_status.rs#L32), [iface](/docs/userland/net-core/iface/)).
`health::handle` replies `E_OK` with no body and the request's own magic and op
([`src/server/handlers/health.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L23)).

## Source map

```
  userland/capsule_net_core/src/server/runner.rs        the poll-then-serve loop and the magic dispatch
  userland/capsule_net_core/src/server/parse_req.rs     the header validation and the Request/body split
  userland/capsule_net_core/src/server/respond.rs       the reply encoder
  userland/capsule_net_core/src/server/handlers/mod.rs  the handler module list
  userland/capsule_net_core/src/server/handlers/health.rs      OP_HEALTHCHECK
  userland/capsule_net_core/src/server/handlers/dhcp_status.rs OP_LEASE_STATUS and encode_body
  userland/capsule_net_core/src/server/handlers/tcp/          connect, send, recv, close, state
  userland/capsule_net_core/src/server/handlers/udp/          bind, unbind, send, recv
  userland/capsule_net_core/src/server/handlers/dns/          resolve_a
  userland/capsule_net_core/src/handles.rs              the TCP handle-to-socket ownership check
  userland/capsule_net_core/src/udp_ports.rs            the UDP pid+port socket lookup
```

Every reference above is verified against those trees.
