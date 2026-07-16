---
title: "The operation interface"
description: "This page mirrors src/protocol/ and the request-loop front of src/server/."
weight: 2
---
This page mirrors `src/protocol/` and the request-loop front of `src/server/`. It is the boundary
`net.sockets` talks to: the `NTCP` wire format, the loop that receives and dispatches, the nine operations
and their payloads, and the errno set every reply carries. For what an op does to a live connection, read
the [connections](/docs/userland/net-tcp/connections/) page; for how a segment leaves for `net.ip`, read the [ip-link](/docs/userland/net-tcp/ip-link/)
page.

## The NTCP wire format

Every request and reply begins with a fixed twenty-byte header, defined in one place as `HDR_LEN`
([`src/server/parse_req.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L19), [`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). The magic is `NTCP`, stored as the little-endian
`u32` `0x4E544350` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)).

```
  offset  size  field
  0       4     magic    "NTCP" little-endian (0x4E544350)
  4       2     version  always 1
  6       2     op       OP_* opcode
  8       2     errno    reply status; 0 in a request
  10      2     reserved zeroed
  12      4     request_id  echoed back unchanged
  16      4     payload_len bytes of body after the header
```

The parser rejects a short buffer with `E_BAD_LEN`, a wrong magic with `E_BAD_MAGIC`, a version other than 1
with `E_BAD_VERSION`, and a `payload_len` that overflows or runs past the buffer with `E_BAD_LEN`; it
returns the body as a slice bounded to exactly `payload_len` ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). A reply reuses
the same layout: `respond` writes the magic, version 1, the op, the errno, a zeroed reserved word, the
echoed `request_id`, and the reply `payload_len`, then sends the header plus body back to the sender by pid
with `mk_ipc_reply` ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)). The IPC payload is bounded at `IPC_PAYLOAD_MAX`, which is
one maximum segment plus sixty-four bytes of slack ([`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)); the segment payload itself
is capped at `SEGMENT_PAYLOAD_MAX = 1460` ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)).

## The request loop

`server::run` allocates one receive and one transmit buffer of `HDR_LEN + IPC_PAYLOAD_MAX` and loops
forever ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)). Each turn does three things in order:

1. Run the timer tick: reap due TimeWait timers, scan the retransmit queue, and drain every pending inbound
   segment from `net.ip` ([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37), [`src/server/tick.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L24)). This is what makes progress
   between client calls, so a connection advances even when no op arrives.
2. Compute a receive budget and block on `mk_ipc_recv_from` for that long ([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). The
   budget is zero when the table is idle, otherwise the time to the next timer deadline clamped to `[10,
   250]` milliseconds, so an idle capsule parks and a busy one wakes on its own timers ([`src/server/tick.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L44)).
3. Parse the request and dispatch on the opcode to a handler ([`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45)). A parse failure or
   an empty receive is skipped silently; an unknown op replies `E_BAD_OP` ([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54)).

The dispatch maps `OP_CLOSE` and `OP_SHUTDOWN` to the same close handler; the other seven ops each have
their own handler module ([`src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L46)).

## The operations

The opcodes are `u16` constants ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)). Handles are the per-connection identifiers the
table mints; see the [state](/docs/userland/net-tcp/state/) page.

| Op | Value | Request body | Reply body | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | none | none | [`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21) |
| `OP_LISTEN` | 2 | `u16` port | `u32` listener handle | [`src/server/handlers/listen.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L24) |
| `OP_CONNECT` | 3 | `[u8;4]` ip, `u16` port | `u32` connection handle | [`src/server/handlers/connect/reply.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/reply.rs#L24) |
| `OP_ACCEPT` | 4 | `u32` listener handle | `u32` child handle | [`src/server/handlers/accept.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept.rs#L28) |
| `OP_SEND` | 5 | `u32` handle, bytes | none | [`src/server/handlers/send.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L24) |
| `OP_RECV` | 6 | `u32` handle | stream bytes | [`src/server/handlers/recv.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L28) |
| `OP_CLOSE` | 7 | `u32` handle | none | [`src/server/handlers/close.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L27) |
| `OP_SHUTDOWN` | 8 | `u32` handle | none | [`src/server/handlers/close.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L27) |
| `OP_STATE` | 9 | `u32` handle | `u8` state code | [`src/server/handlers/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/state.rs#L23) |

### Health

`OP_HEALTHCHECK` replies `E_OK` with an empty body; it is the liveness probe and touches no state
([`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21)).

### Listen and accept

`OP_LISTEN` reads a `u16` port, checks no listener already owns it (`E_PORT_IN_USE`), and inserts a
`State::Listen` control block owned by the caller, replying the new handle ([`src/server/handlers/listen.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L24)).
A missing or short body is `E_BAD_LEN`. `OP_ACCEPT` takes the listener handle and pops one ready child from
that listener's accept queue, replying the child handle; while it waits it drains the receive path up to a
fixed number of tries and yields between them, and returns `E_RX_EMPTY` if none is ready
([`src/server/handlers/accept.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept.rs#L28)). Children are enqueued when the handshake completes on a passively
opened connection, worked through on the [connections](/docs/userland/net-tcp/connections/) page.

### Connect

`OP_CONNECT` is a multi-file handler under `src/server/handlers/connect/`. `body::parse` reads the four-byte
destination IP and `u16` port, requiring at least six body bytes ([`src/server/handlers/connect/body.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/body.rs#L20)).
`open::connection` allocates an ephemeral local port, derives the ISS, builds a `SynSent` control block, and
inserts it ([`src/server/handlers/connect/open.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/open.rs#L20)). `reply::handle` sends the SYN, then `wait::established`
blocks until the connection reaches `Established` or an eight-second deadline expires, replying the handle on
success and `E_TIMEOUT` on failure after removing the dead entry ([`src/server/handlers/connect/reply.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/reply.rs#L24),
[`src/server/handlers/connect/wait.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/wait.rs#L27)).

### Send and receive

`OP_SEND` reads the `u32` handle and treats the rest of the body as stream bytes, rejecting a body under
four bytes or a payload over `SEGMENT_PAYLOAD_MAX` with `E_BAD_LEN` ([`src/server/handlers/send.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L24)). It
requires the connection be `Established`; it enqueues the bytes into the send buffer and pumps the sender,
replying `E_OK`, or `E_TIMEOUT` if the send buffer is full, `E_CLOSED` if the connection is not established,
and `E_NO_SOCKET` if the handle is unknown. `OP_RECV` reads the `u32` handle and pops one buffered payload
from the receive queue, draining the receive path and yielding while it waits; it replies the bytes on
success, `E_NO_SOCKET` if the handle is unknown, and `E_RX_EMPTY` if nothing arrived within the wait
([`src/server/handlers/recv.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L28)).

### Close, shutdown, and state

`OP_CLOSE` and `OP_SHUTDOWN` share one handler. From `Established` or `CloseWait` it advances the send
sequence past the FIN, moves to `FinWait1` or `LastAck`, queues the FIN for retransmit, and sends it,
replying `E_OK`; from any other state it just removes the entry ([`src/server/handlers/close.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L27)). An
unknown handle is `E_NO_SOCKET`. `OP_STATE` replies a single byte, the numeric `State` discriminant, and is
the probe a client uses to watch a connection walk the machine ([`src/server/handlers/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/state.rs#L23)); the code
values are listed on the [connections](/docs/userland/net-tcp/connections/) page.

## The errno set

Every reply carries a `u16` errno at offset 8 ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

| Errno | Value | Meaning |
|---|---|---|
| `E_OK` | 0 | success |
| `E_BAD_MAGIC` | 1 | header magic was not `NTCP` |
| `E_BAD_VERSION` | 2 | header version was not 1 |
| `E_BAD_OP` | 3 | opcode not recognized |
| `E_BAD_LEN` | 4 | body too short, too long, or overflowing |
| `E_NO_SOCKET` | 5 | handle not owned by the caller |
| `E_PORT_IN_USE` | 6 | a listener already holds the port |
| `E_TIMEOUT` | 8 | connect or send did not complete in time |
| `E_CLOSED` | 10 | operation invalid in the connection's state |
| `E_RX_EMPTY` | 11 | no accepted child or received bytes ready |

`E_BAD_MAGIC` and `E_BAD_VERSION` are produced by the parser and cause the loop to skip the request rather
than reply, so in practice they surface only if a handler chooses to re-encode them; the length, socket,
port, timeout, closed, and empty errnos are what a client sees on the wire ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27),
[`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44)).

## Source map

```
  userland/capsule_net_tcp/src/protocol/header.rs   the NTCP magic
  userland/capsule_net_tcp/src/protocol/ops.rs      the nine opcode constants
  userland/capsule_net_tcp/src/protocol/errno.rs    the errno set
  userland/capsule_net_tcp/src/protocol/limits.rs   SEGMENT_PAYLOAD_MAX and IPC_PAYLOAD_MAX
  userland/capsule_net_tcp/src/server/runner.rs     the receive loop and the dispatch match
  userland/capsule_net_tcp/src/server/parse_req.rs  the request header parser
  userland/capsule_net_tcp/src/server/respond.rs    the reply header encoder and mk_ipc_reply
  userland/capsule_net_tcp/src/server/tick.rs       the timer tick and the recv budget
  userland/capsule_net_tcp/src/server/handlers/     one handler per op
```

Every reference above is verified against those trees.
