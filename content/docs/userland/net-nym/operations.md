---
title: "The Nym Operations"
description: "This page documents the NYM1 wire protocol and the server that answers it: the request header, the receive loop, the authorization gate that separates control from data ops, the..."
weight: 3
---
This page documents the `NYM1` wire protocol and the server that answers it: the request header, the
receive loop, the authorization gate that separates control from data ops, the sixteen ops with their
payloads, and the errno set. It mirrors `src/protocol/` and `src/server/`. For the packet a data send
builds, read the [packet](/docs/userland/net-nym/packet/) page; for the tables the ops touch, read the [state](/docs/userland/net-nym/state/) page.

## The NYM1 request

Every request and reply carries the same twenty-byte header, parsed in [`src/server/parse_req.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L26) and
written back in [`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23):

```
  offset  size  field
  0       4     magic = NYM1 (0x4E594D31)   protocol/header.rs:17
  4       2     version = 1                 parse_req.rs:33
  6       2     op                          parse_req.rs:41
  8       2     errno (reply only)          respond.rs:27
  10      2     reserved, zero              respond.rs:28
  12      4     request_id (echoed back)    parse_req.rs:41, respond.rs:29
  16      4     payload_len                 parse_req.rs:36, respond.rs:30
  20      ..    payload
```

The parser rejects a short buffer with `E_BAD_LEN`, a wrong magic with `E_BAD_MAGIC`, and any version other
than 1 with `E_BAD_VERSION` (`parse_req.rs:27`). It then reads `payload_len`, adds it to the header length
with a checked add, and rejects a buffer that does not hold the declared body, so a truncated or overlong
frame never reaches a handler (`parse_req.rs:37`). The reply reuses the same layout, filling in the errno at
offset 8 and the reply payload length at offset 16 (`respond.rs:23`). This is the same shape the source
README sketches, but note the magic is `NYM1`, not the README's `NNYM`.

## The receive loop

`server::run` allocates one receive and one transmit buffer, each `20 + IPC_PAYLOAD_MAX` bytes, and loops
forever ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)). `IPC_PAYLOAD_MAX` is `WIRE_PACKET_MAX + 64`, that is `365 + 2048 + 64`
bytes, sized to hold a full outbound wire packet plus header slack ([`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22)). Each pass
receives from the service inbox with `mk_ipc_recv_from`, capturing the kernel-attested sender pid
(`runner.rs:33`). A receive of zero or a sender pid of zero is dropped without a reply (`runner.rs:34`); a
parse failure is dropped silently (`runner.rs:37`); and an op the dispatcher does not recognize falls through
to an `E_BAD_OP` reply (`runner.rs:39`). The dispatcher is a flat match on the op word, one arm per handler,
returning `false` for an unknown op ([`src/server/handlers/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L24)). The sender pid threads through
every handler, because it is both the ownership key for a session and the principal the authorization gate
checks.

## Control versus data, and the authorization gate

The ops split into two classes. Data ops act on the caller's own sessions, keyed by the sender pid, and any
caller may issue them for its own sessions. Control ops reconfigure the shared capsule, the gateway, the node
directory, the trusted authority, and the cover timing, and they are gated. The gate is in
[`src/server/authz.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs): `admin(sender_pid)` looks up the pid the registry bound to the service name
`net.admin` and returns true only if it equals the caller (`authz.rs:38`). No capsule is spawned as
`net.admin` today, so the lookup misses and every control op is denied with `E_PERM` (deny by default); a
future admin principal registered under that name enables them with no handler change (`authz.rs:34`). The
gated ops each call `admin` first and reply `E_PERM` on a miss: `OP_SET_GATEWAY`
([`src/server/handlers/gateway.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/gateway.rs#L27)), `OP_SET_TOPOLOGY` ([`src/server/handlers/set_topology.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_topology.rs#L25)),
`OP_SET_AUTHORITY` ([`src/server/handlers/set_authority.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_authority.rs#L24)), `OP_SET_TIMING`
([`src/server/handlers/set_timing.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_timing.rs#L24)), and `OP_SYNC_DIRECTORY` ([`src/server/handlers/sync_directory.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sync_directory.rs#L28)).
`OP_SET_CREDENTIAL` is deliberately not gated: a credential is per-application and its trust comes from the
Ed25519 signature, not from who submits it ([`src/server/handlers/set_credential.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_credential.rs#L25)).

## The sixteen ops

The opcodes are constants in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17). Each handler is one file under
`src/server/handlers/`.

| Op | Value | Class | Body in | Reply body | Purpose |
|---|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | any | empty | none | Liveness; always `E_OK` (`health.rs:21`). |
| `OP_SET_GATEWAY` | 2 | admin | ip4 + u16 port + u8 mode | none | Connect a gateway and make it current (`gateway.rs:26`). |
| `OP_OPEN_SESSION` | 3 | data | empty | u32 session id | Mint a session key and allocate a session (`open.rs:26`). |
| `OP_SEND` | 4 | data | u32 id + payload | none | Wrap a datagram and send it to the gateway (`send.rs:29`). |
| `OP_RECV` | 5 | data | u32 id | payload bytes | Drain the gateway and return a queued datagram (`recv.rs:24`). |
| `OP_COVER_TICK` | 6 | data | empty or u32 id | none | Emit cover packets on the caller's sessions (`cover.rs:26`). |
| `OP_CLOSE` | 7 | data | u32 id | none | Zeroize and drop a session (`close.rs:23`). |
| `OP_SET_TOPOLOGY` | 8 | admin | signed directory | none | Install a signed node directory (`set_topology.rs:24`). |
| `OP_SET_CREDENTIAL` | 9 | any | signed credential | none | Install the caller's access credential (`set_credential.rs:25`). |
| `OP_CREATE_SURB` | 10 | data | u32 id (+ u64 ttl) | u32 surb id + 32-byte tag | Mint a single-use reply block (`surb.rs:26`). |
| `OP_SEND_REPLY` | 11 | data | u32 surb + 32 tag + payload | none | Consume a SURB and send a reply on its session (`send_reply.rs:25`). |
| `OP_SET_TIMING` | 12 | admin | u16 burst + u16 jitter | none | Set the cover burst count and delay jitter (`set_timing.rs:23`). |
| `OP_SET_AUTHORITY` | 13 | admin | 32-byte pubkey | none | Set the trusted directory-signing key (`set_authority.rs:23`). |
| `OP_SYNC_DIRECTORY` | 14 | admin | HTTP source or empty | none | Fetch and install a directory over `net.tcp` (`sync_directory.rs:27`). |
| `OP_TOPOLOGY_STATUS` | 15 | any | empty | 28-byte status | Report directory status, epoch, and validity window (`topology_status.rs:24`). |
| `OP_TIMING_STATUS` | 16 | any | empty | 16-byte status | Report the cover-timing policy and next cover time (`timing_status.rs:24`). |

### The bring-up ops

`OP_SET_AUTHORITY` installs a single 32-byte Ed25519 public key as the trusted directory signer; an all-zero
or wrong-length body is rejected with `E_BAD_LEN`, and installing a new authority resets every session
because the trust root changed underneath them (`set_authority.rs:27`). `OP_SET_TOPOLOGY` installs a signed
node directory directly from the request body, and `OP_SYNC_DIRECTORY` fetches one over `net.tcp` from an
HTTP source and installs it; both run the same verify-and-store path and both reset sessions on success
(`set_topology.rs:28`, `sync_directory.rs:56`). `OP_SET_GATEWAY` parses an IPv4 address, a port, and a
transport mode (`0` raw TCP, `1` WebSocket, default WebSocket), connects to the gateway, and replaces the
current gateway, closing the old one (`gateway.rs:53`). The directory and gateway machinery lives on the
[directory](/docs/userland/net-nym/directory/) and [transport](/docs/userland/net-nym/transport/) pages.

### The session ops

`OP_OPEN_SESSION` draws a fresh 32-byte session key from `crypto_random` and asks the table to allocate a
session; the allocation fails, and the reply carries the reason, if there is no gateway (`E_NO_GATEWAY`), no
directory (`E_NO_TOPOLOGY`), a stale directory (`E_TOPOLOGY_EXPIRED`), no credential (`E_NO_CREDENTIAL`), or
the 32-session table is full (`E_TABLE_FULL`); on success it returns the u32 session id (`open.rs:31`).
`OP_SEND` reads the session id and up to `MIX_PAYLOAD_MAX` (1024) payload bytes, wraps them into a wire
packet, and hands it to the gateway (`send.rs:29`); the encode path is on the [packet](/docs/userland/net-nym/packet/) page.
`OP_RECV` drains any bytes waiting on the gateway stream, decodes and decrypts whole packets into the owning
session's receive queue, and returns one queued datagram, replying `E_RX_EMPTY` when nothing is queued and
`E_NO_SESSION` for a session the caller does not own (`recv.rs:24`, `recv_drain.rs:27`). `OP_CLOSE` zeroizes
the session key and removes the session, replying `E_NO_SESSION` if the caller does not own it
(`close.rs:23`).

### Cover traffic and the reply path

`OP_COVER_TICK` emits cover packets. With an empty body it targets every session the caller owns; with a
four-byte body it targets one session (`cover.rs:44`). It first asks the timing policy whether a cover burst
is due, and if not it replies `E_OK` without sending, so a client can poll it on a timer without flooding
(`cover.rs:31`). When due, it sends `cover_burst` random-filled packets per session, each flagged
`FLAG_COVER` so the receiver drops it after decode rather than queueing it (`cover.rs:54`). `OP_CREATE_SURB`
mints a single-use reply block bound to one of the caller's sessions and its credential, returning a 4-byte
SURB id and a 32-byte HMAC tag (`surb.rs:26`); `OP_SEND_REPLY` consumes a SURB by id and tag and sends the
reply on the session the SURB named, flagged `FLAG_REPLY` (`send_reply.rs:25`). The SURB store is on the
[state](/docs/userland/net-nym/state/) page.

### The status ops

`OP_TOPOLOGY_STATUS` returns a 28-byte body: a status code (0 missing, 1 ready, 2 expired, 3 clock error, 4
untrusted authority) followed by the directory epoch and its not-before and not-after timestamps, or zeros
when no directory is installed (`topology_status.rs:24`). `OP_TIMING_STATUS` returns a 16-byte body: the
cover burst count, the delay jitter, and the next scheduled cover time in milliseconds
(`timing_status.rs:24`). Both are ungated read-only reports.

## The errno set

The errno constants are in [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17), returned in the reply header at offset 8.

| Errno | Value | Meaning |
|---|---|---|
| `E_OK` | 0 | Success. |
| `E_BAD_MAGIC` | 1 | Request magic was not `NYM1`. |
| `E_BAD_VERSION` | 2 | Request version was not 1. |
| `E_BAD_OP` | 3 | Unrecognized opcode. |
| `E_BAD_LEN` | 4 | Body too short, too long, or malformed for the op. |
| `E_NO_TCP` | 5 | `net.tcp` not found, or a gateway send or fetch failed. |
| `E_NO_GATEWAY` | 6 | No gateway is set. |
| `E_TABLE_FULL` | 7 | The 32-session table is full. |
| `E_NO_SESSION` | 8 | No session the caller owns matches the id. |
| `E_CRYPTO` | 9 | A crypto syscall or clock read failed. |
| `E_RX_EMPTY` | 10 | No datagram is queued on the session. |
| `E_NO_TOPOLOGY` | 11 | No node directory is installed. |
| `E_NO_CREDENTIAL` | 12 | No access credential is installed. |
| `E_NO_ROUTE` | 13 | No route could be selected from the directory. |
| `E_CREDENTIAL_EXPIRED` | 14 | The credential is past its expiry. |
| `E_GATEWAY_PROTO` | 15 | The WebSocket handshake or framing failed. |
| `E_TOPOLOGY_AUTH` | 16 | A directory or credential signature did not verify. |
| `E_TOPOLOGY_STALE` | 17 | The directory is expired or superseded. |
| `E_AUTHORITY_MISSING` | 18 | No trusted directory authority is set. |
| `E_AUTHORITY_UNTRUSTED` | 19 | The signer is not the trusted authority. |
| `E_DIRECTORY_PROTO` | 20 | The directory HTTP fetch or body was malformed. |
| `E_DIRECTORY_SOURCE` | 21 | No directory HTTP source is configured. |
| `E_TOPOLOGY_EXPIRED` | 22 | The directory is expired at open time. |
| `E_PERM` | 23 | A control op was refused by the authorization gate. |

A handler never panics: every parse and every crypto or clock call returns an errno word, and the release
profile is `panic = "abort"` as a backstop (`Cargo.toml:26`). The source README lists four ops and says the
operational ones return `E_NOTSUP`; there is no `E_NOTSUP` in the code, and the operational ops are
implemented, so that part of the README no longer describes the capsule.

## Source map

```
  userland/capsule_net_nym/src/protocol/header.rs   the NYM1 magic
  userland/capsule_net_nym/src/protocol/ops.rs      the sixteen opcode constants
  userland/capsule_net_nym/src/protocol/errno.rs    the errno constants
  userland/capsule_net_nym/src/protocol/limits.rs   IPC_PAYLOAD_MAX and the wire sizes
  userland/capsule_net_nym/src/server/runner.rs     the receive loop and the buffers
  userland/capsule_net_nym/src/server/parse_req.rs  the request header parse
  userland/capsule_net_nym/src/server/respond.rs    the reply header write and mk_ipc_reply
  userland/capsule_net_nym/src/server/authz.rs      the net.admin authorization gate
  userland/capsule_net_nym/src/server/handlers/dispatch.rs  the op match
  userland/capsule_net_nym/src/server/handlers/     one handler file per op
  userland/capsule_net_nym/src/server/handlers/io.rs  the body-field read helpers
  userland/capsule_net_nym/Cargo.toml               panic = "abort"
```

Every reference above is verified against those trees.
