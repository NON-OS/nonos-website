---
title: "Client operations and the NDHC protocol"
description: "Everything a client can ask the DHCP capsule for crosses one boundary: the NDHC binary protocol over IPC."
weight: 1
---
Everything a client can ask the DHCP capsule for crosses one boundary: the `NDHC` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop and the per-op
handlers). A request arrives as a fixed 20-byte header plus an optional body, the server validates and parses
it, dispatches on a 16-bit opcode, and a handler replies with a 20-byte response header and, for status, a
body. For the identity table and the capability mask see the [README](/docs/userland/net-dhcp/); for the acquisition ladder
the handlers drive, see the [lease](/docs/userland/net-dhcp/lease/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version. The parser rejects anything shorter than
the header, a wrong magic, or a version other than 1 ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). The `NDHC` magic is
`0x4E44_4843` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E44_4843` ("NDHC") (`header.rs:17`, checked at `parse_req.rs:31`) |
| version | 4 | u16 | must be `1` (`parse_req.rs:34`) |
| op | 6 | u16 | the opcode (`parse_req.rs:37`) |
| errno | 8 | u16 | zero on the request path; the errno slot on the reply |
| (reserved) | 10 | u16 | not read on the request path |
| request_id | 12 | u32 | echoed into the response header (`parse_req.rs:38`) |
| payload_len | 16 | u32 | request body length in bytes (`parse_req.rs:39`) |

The parser reads `payload_len`, adds it to the 20-byte header, and refuses the request with `E_BAD_LEN` if
the received buffer is shorter than that total ([`src/server/parse_req.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L40)). On success it returns the
parsed `op` and `request_id` and a slice pointing at the body just past the header (`parse_req.rs:44`). Every
field is little-endian.

Every reply is a response header of the same 20 bytes: the same magic, version 1, the op echoed back, a
16-bit errno at offset 8, the request id echoed at offset 12, and the reply payload length at offset 16
([`src/server/respond.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L24)). A `lease_status` reply carries an 18-byte body after that header; every other op
replies with the header alone. Replies go back to the requesting pid with `mk_ipc_reply`
([`src/server/respond.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L58)).

## The request loop

`server::run` sizes one receive buffer and one transmit buffer, each to the header plus 256 bytes, which is
ample for the fixed lease ops and the 18-byte status body ([`src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L30)). The loop receives a
request with `mk_ipc_recv_from`, which also reports the sender pid ([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). A receive of
zero or fewer bytes, or a receive with a zero sender pid, is skipped, so a request with no attributable sender
is never served (`runner.rs:39`). A parse failure is skipped silently, so a malformed frame never reaches a
handler (`runner.rs:43`). A valid request is dispatched on its opcode, and an unrecognised opcode is answered
with `E_BAD_OP` (`runner.rs:50`).

## The five operations

The opcodes are defined in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and dispatched in [`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44).

| Op | Opcode | Request body | Reply body after header | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L21) |
| `OP_LEASE_REQUEST` | `2` | none | none (status only) | [`server/handlers/lease_request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/lease_request.rs#L22) |
| `OP_LEASE_STATUS` | `3` | none | 18-byte lease snapshot | [`server/handlers/lease_status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/lease_status.rs#L28) |
| `OP_LEASE_RELEASE` | `4` | none | none (status only) | [`server/handlers/lease_release.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/lease_release.rs#L29) |
| `OP_LEASE_RENEW` | `5` | none | none (status only) | [`server/handlers/lease_renew.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/lease_renew.rs#L30) |

The opcode constants are `OP_HEALTHCHECK = 1`, `OP_LEASE_REQUEST = 2`, `OP_LEASE_STATUS = 3`,
`OP_LEASE_RELEASE = 4`, `OP_LEASE_RENEW = 5` ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).

## Per-op behaviour

- `OP_HEALTHCHECK` replies `E_OK` with an empty body; it proves the server is alive and touches no state
  ([`src/server/handlers/health.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L22)).
- `OP_LEASE_REQUEST` runs the full DORA ladder synchronously by calling `dora::acquire`, and maps the result
  to an errno: `Ok` is `E_OK`, `NoLink` is `E_NO_LINK`, `Timeout` is `E_TIMEOUT`, `Nak` is `E_NAK`
  ([`src/server/handlers/lease_request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_request.rs#L22)). The ladder itself is on the [lease](/docs/userland/net-dhcp/lease/) page.
- `OP_LEASE_STATUS` reads the client state and the cached lease under their mutexes and writes an 18-byte
  snapshot after the header: a 1-byte state code (0 Init, 1 Selecting, 2 Requesting, 3 Bound, 4 Renewing), the
  4-byte IPv4, the 1-byte prefix, the 4-byte gateway, the 4-byte DNS, and the 4-byte lease lifetime in
  seconds little-endian ([`src/server/handlers/lease_status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_status.rs#L28)). It always replies `E_OK`.
- `OP_LEASE_RENEW` reissues a `DHCPREQUEST` for the already-bound address against the original server id and,
  on ACK, refreshes the lease lifetime; a NAK collapses the state to Init and returns `E_NAK`, a timeout
  returns `E_TIMEOUT`, and any transport or install failure returns `E_NO_LINK`
  ([`src/server/handlers/lease_renew.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_renew.rs#L30)). It also returns `E_NO_LINK` before doing anything if setup has
  not completed or no lease is bound (`lease_renew.rs:34`, `lease_renew.rs:40`).
- `OP_LEASE_RELEASE` sends a `DHCPRELEASE` if a lease is bound, clears the interface in `net.ip`, resets the
  lease and client state, and replies `E_OK`; a release with no lease bound succeeds idempotently
  ([`src/server/handlers/lease_release.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_release.rs#L29)). It returns `E_NO_LINK` only if setup has not completed
  (`lease_release.rs:33`).

## The error set

All errno words are unsigned 16-bit values in the response header at offset 8 ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

```
  E_OK          0   success
  E_BAD_MAGIC   1   wrong request magic (rejected in parse, request dropped)
  E_BAD_VERSION 2   wrong request version (rejected in parse, request dropped)
  E_BAD_OP      3   unrecognised opcode
  E_BAD_LEN     4   received buffer shorter than the declared header + body
  E_NO_LINK     5   no reachable L2/IP link, setup incomplete, or an install failure
  E_TIMEOUT     6   the DISCOVER or REQUEST wait ran out of its poll budget
  E_NAK         7   the server answered a DHCPREQUEST with a DHCPNAK
```

`E_BAD_MAGIC` and `E_BAD_VERSION` are returned by the parser but never reach the wire on the inbound path: a
parse failure is dropped in the request loop rather than answered ([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)), so a client
that sends a malformed frame gets no reply. They are surfaced errno values so the parser can name the reason
internally. The reply-header encoder returns an `EMSGSIZE` (`-90`) sentinel to its caller if the transmit
buffer is too small to hold the header and body, but the buffer is sized at startup so this path is defensive
([`src/server/respond.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L22), `runner.rs:31`).

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and the
length field, and drops anything malformed without replying ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)). A request with a
zero sender pid is skipped, so every served request is attributable to a caller ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)).
There is no panic path: the crate is `panic = "abort"` and every handler returns an errno word instead of
unwinding (`Cargo.toml:30`). A rejected or incomplete lease never mutates `net.ip`: the acquisition path only
installs after an ACK carries a non-zero `yiaddr`, and a NAK or timeout resets client state to Init without
touching the IP layer ([`src/dora/acquire.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L41), `acquire.rs:58`). A client that wants a lease managed must
hold the capability to reach `net.dhcp.client` and speak this protocol; it never gets a handle to a NIC or a
raw frame.

## Source map

```
  userland/capsule_net_dhcp/src/protocol/header.rs     MAGIC
  userland/capsule_net_dhcp/src/protocol/ops.rs        the five opcode constants
  userland/capsule_net_dhcp/src/protocol/errno.rs      E_OK, E_BAD_*, E_NO_LINK, E_TIMEOUT, E_NAK
  userland/capsule_net_dhcp/src/server/parse_req.rs    the magic/version/length check and the body slice
  userland/capsule_net_dhcp/src/server/runner.rs       the receive/parse/dispatch loop and the pid gate
  userland/capsule_net_dhcp/src/server/respond.rs      the response-header encoder and mk_ipc_reply
  userland/capsule_net_dhcp/src/server/handlers/       one file per lease op
  userland/capsule_net_dhcp/src/dora/acquire.rs        the reject-does-not-install rule
  userland/capsule_net_dhcp/Cargo.toml                 panic = "abort"
  src/capabilities/types.rs                            the capability bits the mask decodes into
```

Every reference above is verified against those trees.
