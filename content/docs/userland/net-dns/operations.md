---
title: "Client operations and the NDNS protocol"
description: "Everything a client can ask the DNS capsule for crosses one boundary: the NDNS binary protocol over IPC."
weight: 1
---
Everything a client can ask the DNS capsule for crosses one boundary: the `NDNS` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop, the admin gate, and
the per-op handlers). A request arrives as a fixed 20-byte header plus an optional body, the server
validates and parses it, dispatches on a 16-bit opcode, and a handler replies with a 20-byte response
header and, for a resolve, an address body. For the identity table and the capability mask see the
[README](/docs/userland/net-dns/); for the DNS engine the resolve handlers reach, see the [resolver](/docs/userland/net-dns/resolver/) page,
and for the UDP client under it, the [transport](/docs/userland/net-dns/transport/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version. The parser rejects anything shorter than
the header, a wrong magic, or a version other than 1 ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). The `NDNS` magic is
`0x4E44_4E53` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E44_4E53` ("NDNS") (`header.rs:17`, checked at `parse_req.rs:31`) |
| version | 4 | u16 | must be `1` (`parse_req.rs:34`) |
| op | 6 | u16 | the opcode (`parse_req.rs:37`) |
| (reserved) | 8 | u16 | not read on the request path |
| request_id | 12 | u32 | echoed into the response header (`parse_req.rs:38`) |
| payload_len | 16 | u32 | request body length in bytes (`parse_req.rs:39`) |

The parser reads `payload_len`, adds it to the 20-byte header with a checked add so a hostile length cannot
overflow, and refuses the request with `E_BAD_LEN` if the received buffer is shorter than that total
([`src/server/parse_req.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L40)). On success it returns the parsed `op` and `request_id` and a slice pointing
at the body just past the header (`parse_req.rs:44`).

Every reply is a response header of the same 20 bytes: the same magic, version 1, the op echoed back, a
16-bit errno at offset 8, offsets 10 and 11 zeroed, the request id echoed at offset 12, and the reply
payload length at offset 16 ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)). A resolve reply carries an address body after that
header; every other op replies with the header alone. Replies go back to the requesting pid with
`mk_ipc_reply` ([`src/server/respond.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L38)).

## The request loop

`server::run` sizes one receive buffer and one transmit buffer, each to the header plus `IPC_PAYLOAD_MAX`
([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)). `IPC_PAYLOAD_MAX` is the 512-byte DNS response ceiling plus 64 bytes of op
framing slack ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)).

The loop receives a request with `mk_ipc_recv_from`, which also reports the sender pid
([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)). A receive of zero or fewer bytes, or a receive with a zero sender pid, is
skipped (`runner.rs:38`); the sender pid is what the admin gate keys authorization on, so a request with no
attributable sender is never served. A parse failure is skipped silently, so a malformed frame never reaches
a handler (`runner.rs:41`). A valid request is dispatched on its opcode, and an unrecognised opcode is
answered with `E_BAD_OP` (`runner.rs:48`).

## The five operations

The opcodes are defined in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and dispatched in [`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42).

| Op | Opcode | Request body | Reply body after header | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L21) |
| `OP_RESOLVE_A` | `2` | host name, 1..=255 bytes | 4-byte IPv4 on success | [`server/handlers/resolve_a.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/resolve_a.rs#L24) |
| `OP_RESOLVE_AAAA` | `3` | host name, 1..=255 bytes | 16-byte IPv6 on success | [`server/handlers/resolve_aaaa.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/resolve_aaaa.rs#L23) |
| `OP_FLUSH_CACHE` | `4` | none | none (status only), admin only | [`server/handlers/flush.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/flush.rs#L23) |
| `OP_SET_UPSTREAM` | `5` | 4-byte IPv4 resolver | none (status only), admin only | [`server/handlers/upstream.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/upstream.rs#L23) |

The opcode constants are `OP_HEALTHCHECK = 1`, `OP_RESOLVE_A = 2`, `OP_RESOLVE_AAAA = 3`,
`OP_FLUSH_CACHE = 4`, `OP_SET_UPSTREAM = 5` ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).

## Per-op behaviour

- `OP_HEALTHCHECK` replies `E_OK` with an empty body; it proves the server is alive and touches no state
  ([`src/server/handlers/health.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L22)).
- `OP_RESOLVE_A` reads the host name from the body, validates it is 1..=255 bytes of UTF-8
  (`E_NAME_INVALID` otherwise, [`src/server/handlers/resolve_common.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L29)), checks the answer cache, and on
  a hit writes the cached IPv4 and replies `E_OK` ([`src/server/handlers/resolve_a.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_a.rs#L30)). On a miss it mints
  a transaction id, builds an A query, exchanges it with the upstream over `net.udp`, caches the answer under
  its TTL, and replies with the 4-byte IPv4 (`resolve_a.rs:33`). The build, exchange, and cache all live on
  the [resolver](/docs/userland/net-dns/resolver/) page.
- `OP_RESOLVE_AAAA` is the same shape for a AAAA record but does not consult the IPv4 cache: it builds an
  AAAA query, exchanges it, and replies with the 16-byte IPv6 address on success
  ([`src/server/handlers/resolve_aaaa.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_aaaa.rs#L23)). The cache holds A records only.
- `OP_FLUSH_CACHE` is an administrative op. It is denied unless the sender is the `net.admin` principal
  (`E_PERM`, [`src/server/handlers/flush.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L24)); when authorized it expires every cache entry by ticking the
  cache with `u64::MAX` and replies `E_OK` (`flush.rs:28`).
- `OP_SET_UPSTREAM` is an administrative op. It is denied unless the sender is `net.admin` (`E_PERM`,
  [`src/server/handlers/upstream.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/upstream.rs#L24)); it requires a body of exactly 4 bytes (`E_BAD_LEN` otherwise,
  `upstream.rs:28`), and on success stores the new resolver IPv4 as the upstream and replies `E_OK`
  (`upstream.rs:34`).

## The admin gate

Cache flush and upstream change are tier-2 control ops, and both call `authz::admin` before they act
([`src/server/handlers/flush.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L24), [`src/server/handlers/upstream.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/upstream.rs#L24)). `admin` resolves the owner pid
the registry bound to the service name `net.admin` and compares it to the kernel-attested sender pid; a
lookup miss or a pid of zero denies ([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)). This is fail-closed by construction: no
capsule is spawned as `net.admin` today, so the lookup misses and every caller is denied, and a future
admin or settings principal registered under that name enables the ops with no handler change
([`src/server/authz.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L34)). The two resolve ops and the health check are open to any caller that can reach
the endpoint; only the two ops that change resolver policy are gated.

## The error set

All errno words are unsigned 16-bit values in the response header at offset 8 ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_OK           0   success
  E_BAD_MAGIC    1   wrong request magic (rejected in parse, request dropped)
  E_BAD_VERSION  2   wrong request version (rejected in parse, request dropped)
  E_BAD_OP       3   unrecognised opcode
  E_BAD_LEN      4   body length wrong for the op
  E_TIMEOUT      6   no usable response from the upstream within the deadline
  E_NXDOMAIN     7   the name does not exist
  E_SERVFAIL     8   the upstream failed, or the response could not be used
  E_NAME_INVALID 9   the host name is empty, over 255 bytes, non-UTF-8, or not encodable
  E_PERM        10   the caller is not the net.admin principal for a control op
```

`E_BAD_MAGIC` and `E_BAD_VERSION` are returned by the parser but never reach the wire on the inbound path: a
parse failure is dropped in the request loop rather than answered ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)), so a client
that sends a malformed frame gets no reply. They are surfaced errno values so the parser can name the reason
internally. There is no value `5`; the errno numbers are not contiguous
([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
the length field with a checked add, and drops anything malformed without replying
([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). A request with a zero sender pid is skipped, so every served request is
attributable to a caller ([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). The two policy-changing ops are gated on the
kernel-attested sender pid matching the `net.admin` principal, and default to denied because no such
principal exists yet ([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)). A resolve name is bounded to the 255-byte DNS wire limit
and checked as UTF-8 before it is encoded ([`src/server/handlers/resolve_common.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L29)). Transaction ids and
the local source port are drawn from the kernel entropy source, so a response is bound to the query id and
question before it is accepted ([`src/state.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L30), [`src/server/handlers/resolve_common.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L68)). There is no
panic path: the crate is `panic = "abort"` and every handler returns an errno word instead of unwinding
(`Cargo.toml:27`). A client never gets a handle to a NIC or to `net.udp`; it gets an address or an errno.

## Source map

```
  userland/capsule_net_dns/src/protocol/header.rs   MAGIC
  userland/capsule_net_dns/src/protocol/ops.rs      the five opcode constants
  userland/capsule_net_dns/src/protocol/errno.rs    E_OK, E_BAD_*, E_TIMEOUT, E_NXDOMAIN, E_SERVFAIL, E_NAME_INVALID, E_PERM
  userland/capsule_net_dns/src/protocol/limits.rs   IPC_PAYLOAD_MAX
  userland/capsule_net_dns/src/server/parse_req.rs  the magic/version/length check and the body slice
  userland/capsule_net_dns/src/server/runner.rs     the receive/parse/dispatch loop and the pid gate
  userland/capsule_net_dns/src/server/respond.rs    the response-header encoder and mk_ipc_reply
  userland/capsule_net_dns/src/server/authz.rs      the net.admin owner-pid gate on control ops
  userland/capsule_net_dns/src/server/handlers/     one file per op, plus resolve_common
  userland/capsule_net_dns/src/state.rs             the entropy-backed xid and local port
  userland/capsule_net_dns/Cargo.toml               panic = "abort"
  src/capabilities/types.rs                         the capability bits the mask decodes into
```

Every reference above is verified against those trees.
