---
title: "Client operations and the NUDP protocol"
description: "Everything a client can ask the UDP capsule for crosses one boundary: the NUDP binary protocol over IPC."
weight: 1
---
Everything a client can ask the UDP capsule for crosses one boundary: the `NUDP` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional body, the server validates and
parses it, dispatches on a 16-bit opcode, and a handler replies with a 20-byte response header and, for
`recv`, a payload. For the identity table and the capability mask see the [README](/docs/userland/net-udp/); for the UDP
machinery the handlers reach, see the [datagram](/docs/userland/net-udp/datagram/) page, and for the port table they touch, the
[state](/docs/userland/net-udp/state/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version. The parser rejects anything shorter
than the header, a wrong magic, or a version other than 1 ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). The `NUDP` magic
is `0x4E55_4450` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E55_4450` ("NUDP") (`header.rs:17`, checked at `parse_req.rs:31`) |
| version | 4 | u16 | must be `1` (`parse_req.rs:34`) |
| op | 6 | u16 | the opcode (`parse_req.rs:37`) |
| (reserved) | 8 | u16 | not read on the request path |
| request_id | 12 | u32 | echoed into the response header (`parse_req.rs:38`) |
| payload_len | 16 | u32 | request body length in bytes (`parse_req.rs:39`) |

The parser reads `payload_len`, adds it to the 20-byte header with a checked add so a hostile length cannot
overflow, and refuses the request with `E_BAD_LEN` if the received buffer is shorter than that total
([`src/server/parse_req.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L40)). On success it returns the parsed `op` and `request_id` and a slice
pointing at the body just past the header (`parse_req.rs:44`).

Every reply is a response header of the same 20 bytes: the same magic, version 1, the op echoed back, a
16-bit errno at offset 8, the request id echoed at offset 12, and the reply payload length at offset 16
([`src/server/respond.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L24)). A `recv` reply carries a body after that header; every other op replies with
the header alone. Replies go back to the requesting pid with `mk_ipc_reply` ([`src/server/respond.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L58)).

## The request loop

`server::run` sizes one receive buffer and one transmit buffer, each to the header plus `IPC_PAYLOAD_MAX`,
so a single receive holds the largest send body and a single reply holds the largest recv payload
([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31)). `IPC_PAYLOAD_MAX` is the 1472-byte UDP payload ceiling plus 64 bytes of
op framing slack ([`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)).

The loop receives a request with `mk_ipc_recv_from`, which also reports the sender pid
([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). A receive of zero or fewer bytes, or a receive with a zero sender pid, is
skipped (`runner.rs:39`); the sender pid is what the port table keys ownership on, so a request with no
attributable sender is never served. A parse failure is skipped silently, so a malformed frame never
reaches a handler (`runner.rs:43`). A valid request is dispatched on its opcode, and an unrecognised opcode
is answered with `E_BAD_OP` (`runner.rs:50`).

## The five operations

The opcodes are defined in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and dispatched in [`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44).

| Op | Opcode | Request body | Reply body after header | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L21) |
| `OP_BIND` | `2` | 2-byte local port (LE) | none (status only) | [`server/handlers/bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/bind.rs#L23) |
| `OP_UNBIND` | `3` | 2-byte local port (LE) | none (status only) | [`server/handlers/unbind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/unbind.rs#L23) |
| `OP_SEND` | `4` | 2 src_port + 4 dst IPv4 + 2 dst_port + payload | none (status only) | [`server/handlers/send.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/send.rs#L27) |
| `OP_RECV` | `5` | 2-byte local port (LE) | 4 src IPv4 + 2 src_port + payload | [`server/handlers/recv/handle.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/recv/handle.rs#L27) |

The opcode constants are `OP_HEALTHCHECK = 1`, `OP_BIND = 2`, `OP_UNBIND = 3`, `OP_SEND = 4`,
`OP_RECV = 5` ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).

## Per-op behaviour

- `OP_HEALTHCHECK` replies `E_OK` with an empty body; it proves the server is alive and touches no state
  ([`src/server/handlers/health.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L22)).
- `OP_BIND` reads the 2-byte port and inserts a `BindEntry` owned by the sender pid into the port table. A
  body under 2 bytes is `E_BAD_LEN`; a port already held, or a full table, is `E_PORT_IN_USE`; success is
  `E_OK` ([`src/server/handlers/bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L23)). One owner per port is enforced by the table, described on the
  [state](/docs/userland/net-udp/state/) page.
- `OP_UNBIND` removes the binding for the sender pid and port. A body under 2 bytes is `E_BAD_LEN`; a
  binding that is not there is `E_NO_PORT`; success is `E_OK` ([`src/server/handlers/unbind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/unbind.rs#L23)). Only the
  owning pid can remove its own binding, because `remove` matches on both port and pid
  ([`src/state/table.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L51)).
- `OP_SEND` reads the 2-byte source port, the 4-byte destination IPv4, the 2-byte destination port, and the
  remaining payload. A body under 8 bytes or a payload over `UDP_PAYLOAD_MAX` (1472) is `E_BAD_LEN`; a
  source port the sender does not own is `E_NO_PORT`; a missing IP link is `E_NO_IP_LINK`; success is `E_OK`
  ([`src/server/handlers/send.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L27)). On success the handler builds the UDP segment and ships it to
  `net.ip`, both covered on the [datagram](/docs/userland/net-udp/datagram/) page.
- `OP_RECV` reads the 2-byte local port, checks the sender owns it (`E_NO_PORT` otherwise), and dequeues one
  received datagram for that bind. If the ring is empty it drains one segment from `net.ip` and retries
  once; still empty is `E_RX_EMPTY` ([`src/server/handlers/recv/handle.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/handle.rs#L27)). A delivered datagram is
  parsed and its source IPv4, source port, and payload are written after the response header
  ([`src/server/handlers/recv/deliver.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/deliver.rs#L26)).

## The error set

All errno words are unsigned 16-bit values in the response header at offset 8 ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_OK          0   success
  E_BAD_MAGIC   1   wrong request magic (rejected in parse, request dropped)
  E_BAD_VERSION 2   wrong request version (rejected in parse, request dropped)
  E_BAD_OP      3   unrecognised opcode
  E_BAD_LEN     4   body too short for the op, or a send payload over the MTU ceiling
  E_NO_PORT     5   the sender does not own the named port
  E_PORT_IN_USE 6   the port is already bound, or the bind table is full
  E_NO_IP_LINK  7   net.ip is not resolved, or the send/parse to net.ip failed
  E_RX_EMPTY    8   no datagram is queued for the bound port
```

`E_BAD_MAGIC` and `E_BAD_VERSION` are returned by the parser but never reach the wire on the inbound path:
a parse failure is dropped in the request loop rather than answered ([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)), so a
client that sends a malformed frame gets no reply. They are surfaced errno values so the parser can name the
reason internally. The reply-header encoder returns an `EMSGSIZE` (`-90`) sentinel to its caller if the
transmit buffer is too small to hold the header, but the buffers are sized to the maximum at startup so this
path is defensive ([`src/server/respond.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L22), `runner.rs:31`).

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
the length field with a checked add, and drops anything malformed without replying
([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). A request with a zero sender pid is skipped, so every served request is
attributable to a caller ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)). Port ownership is keyed on the kernel-attested sender
pid: bind records the pid, and send, recv, and unbind all require the sender to own the port they name, so
one capsule cannot send from, receive on, or unbind another capsule's port
([`src/server/handlers/send.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L41), [`recv/handle.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/recv/handle.rs#L33), `unbind.rs:29`). A send payload is bounded to the
1472-byte MTU ceiling before it is framed ([`src/server/handlers/send.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L37)). There is no panic path: the
crate is `panic = "abort"` and every handler returns an errno word instead of unwinding (`Cargo.toml:27`).
A client that wants datagram transport must hold the capability to reach `net.udp` and speak this protocol;
it never gets a handle to a NIC.

## Source map

```
  userland/capsule_net_udp/src/protocol/header.rs     MAGIC
  userland/capsule_net_udp/src/protocol/ops.rs        the five opcode constants
  userland/capsule_net_udp/src/protocol/errno.rs      E_OK, E_BAD_*, E_NO_PORT, E_PORT_IN_USE, E_NO_IP_LINK, E_RX_EMPTY
  userland/capsule_net_udp/src/protocol/limits.rs     UDP_PAYLOAD_MAX and IPC_PAYLOAD_MAX
  userland/capsule_net_udp/src/server/parse_req.rs    the magic/version/length check and the body slice
  userland/capsule_net_udp/src/server/runner.rs       the receive/parse/dispatch loop and the pid gate
  userland/capsule_net_udp/src/server/respond.rs      the response-header encoder and mk_ipc_reply
  userland/capsule_net_udp/src/server/handlers/       one file per op, plus the recv deliver/drain split
  userland/capsule_net_udp/src/state/table.rs         the pid-and-port ownership match
  userland/capsule_net_udp/Cargo.toml                 panic = "abort"
  src/capabilities/types.rs                           the capability bits the mask decodes into
```

Every reference above is verified against those trees.
