---
title: "Client operations and the NIP4 protocol"
description: "Everything a client can ask the IPv4 capsule for crosses one boundary: the NIP4 binary protocol over IPC."
weight: 2
---
Everything a client can ask the IPv4 capsule for crosses one boundary: the `NIP4` binary protocol over
IPC. This page mirrors `src/protocol/` (the wire format) and `src/server/` (the request loop, the
per-op handlers, and the authorization tiers). A request arrives as a fixed 20-byte header plus an
optional body, the server decodes and dispatches it on a 16-bit opcode, and a handler encodes a 20-byte
response header carrying an errno and, for the query and poll ops, a body. For the identity table and
the capability mask see the [README](/docs/userland/net-ip/); for the IPv4 build and parse the packet ops drive see
the [ipv4](/docs/userland/net-ip/ipv4/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version. The magic is `NIP4`, the value that
distinguishes this service from `net.l2`, `net.udp`, and the rest; the envelope shape itself is the
shared header ([`src/protocol/header.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L23)). The decoder rejects anything shorter than the header, a
wrong magic, or a version other than 1, and rejects a payload length that would run past the received
bytes, using a checked add so the bound cannot overflow ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E49_5034` ("NIP4") (`header.rs:23`, `parse_req.rs:31`) |
| version | 4 | u16 | must be 1 (`parse_req.rs:34`) |
| op | 6 | u16 | the opcode (`parse_req.rs:37`) |
| errno | 8 | u16 | zero on a request; the status on a reply (`respond.rs:37`) |
| reserved | 10 | u16 | zero (`respond.rs:38`) |
| request_id | 12 | u32 | echoed into the response header (`parse_req.rs:38`, `respond.rs:39`) |
| payload_len | 16 | u32 | body length in bytes (`parse_req.rs:39`, `respond.rs:40`) |

Every reply is a response header of the same 20 bytes, with the errno written into the header rather
than a separate status word, followed by any body ([`src/server/respond.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L24)). Errno `0` (`E_OK`)
means success; a non-zero value is one of the constants below. Replies go straight to the attested
sender pid with `mk_ipc_reply` ([`src/server/respond.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L58)).

## The request loop

`server::run` sizes one receive buffer and one transmit buffer to the header plus `IPC_PAYLOAD_MAX`,
which is the IPv4 MTU plus a 64-byte margin so a caller can wrap a full datagram in one envelope
without splitting ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33), [`src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L23)). The loop receives a request
with the sender pid, skips a receive of zero or fewer bytes or a pid of zero, parses the header, and
dispatches on the opcode; a parse failure is dropped silently rather than answered
([`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37)). An unrecognised opcode is answered with `E_BAD_OP`
([`src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L53)).

## The seven operations

The opcodes are defined in [`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21) and dispatched in [`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45).

| Op | Opcode | Request body | Reply body after header | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none | [`server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L21) |
| `OP_GET_CONFIG` | `2` | none | 17-byte interface snapshot | [`server/handlers/get_config.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/get_config.rs#L28) |
| `OP_SET_CONFIG` | `3` | 9-byte address/prefix/gateway | none | [`server/handlers/set_config.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/set_config.rs#L28) |
| `OP_SEND_PACKET` | `4` | 4 dst + 1 protocol + payload | none | [`server/handlers/send_packet.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/send_packet.rs#L25) |
| `OP_POLL_PACKET` | `5` | 0 or 1 protocol filter byte | src/dst/protocol + payload | [`server/handlers/poll_packet/poll.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/poll_packet/poll.rs#L28) |
| `OP_ROUTE_ADD` | `6` | 9-byte network/prefix/gateway | none | [`server/handlers/route_add.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/route_add.rs#L26) |
| `OP_ROUTE_CLEAR` | `7` | none | none | [`server/handlers/route_clear.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/route_clear.rs#L23) |

## Body detail on each op

- `OP_HEALTHCHECK` answers `E_OK` with an empty body: server liveness (`health.rs:21`).
- `OP_GET_CONFIG` packs the live interface state into 17 bytes: 6-byte MAC, 4-byte IPv4, 1-byte prefix,
  4-byte gateway, and the 2-byte MTU little-endian (`get_config.rs:24`). Each field is read from the
  shared `IFACE` state under its own lock or atomic (`get_config.rs:29`).
- `OP_SET_CONFIG` installs a lease: 4-byte IPv4, 1-byte prefix, 4-byte gateway. It stores the address,
  prefix, and gateway into `IFACE`, and if the gateway is non-zero it seeds a default route (network
  `0.0.0.0`, prefix 0) through it (`set_config.rs:42`). The body must be exactly 9 bytes or the op
  returns `E_BAD_LEN` (`set_config.rs:33`).
- `OP_SEND_PACKET` takes a 4-byte destination, a 1-byte protocol number, and the payload, and hands
  them to the egress path, mapping the egress error to an errno: `NoConfig` to `E_NO_CONFIG`, `NoRoute`
  to `E_NO_ROUTE`, `NoNeighbour` to `E_NO_NEIGHBOUR`, and an L2 or build failure to `E_L2_FAULT`
  (`send_packet.rs:34`). A body shorter than 5 bytes returns `E_BAD_LEN` (`send_packet.rs:26`).
- `OP_POLL_PACKET` returns one queued or freshly-polled inbound packet as 4-byte source, 4-byte
  destination, 1-byte protocol, then the payload ([`poll_packet/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll_packet/deliver.rs#L24)). An empty body means
  "any protocol"; a single byte filters to that protocol number; anything longer is `E_BAD_PACKET`
  ([`poll_packet/select.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll_packet/select.rs#L20)). The poll path is detailed below.
- `OP_ROUTE_ADD` installs a route: 4-byte network, 1-byte prefix, 4-byte gateway, where a gateway of
  all zeroes means on-link (`route_add.rs:41`). A full table returns `E_TABLE_FULL` (`route_add.rs:42`).
- `OP_ROUTE_CLEAR` empties the route table (`route_clear.rs:28`).

## The poll path

`OP_POLL_PACKET` is the pull side of ingress. It first parses the optional protocol filter, then tries
the receive queue: if a matching packet is already queued it is delivered immediately
([`poll_packet/poll.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll_packet/poll.rs#L33)). Otherwise, if `net.l2` is known, it polls up to `POLL_BUDGET` (8) frames
from L2, routing each through ingress: a frame that parses to a matching packet is delivered, a
non-matching packet is pushed onto the queue and polling continues, a non-IPv4 or not-for-us or
ICMP-absorbed frame is skipped, an empty L2 ring ends the loop, and a malformed packet or L2 fault
returns an errno ([`poll_packet/poll.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll_packet/poll.rs#L40), [`poll_packet/route.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll_packet/route.rs#L31)). With no `net.l2` known the op
returns `E_NO_CONFIG`; an exhausted budget with nothing to deliver returns `E_RX_EMPTY`
([`poll_packet/poll.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll_packet/poll.rs#L37), `poll.rs:48`). The queue is bounded, so a push onto a full queue drops the
packet rather than growing memory ([`src/state/rx_queue.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/rx_queue.rs#L26)).

## Authorization tiers

Two of the control ops are gated on the attested `sender_pid`, not just on holding the service
handle. Authorization compares the kernel-attested sender pid against the owner pid the service
registry bound to a named service ([`src/server/authz.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L34)).

- `OP_SET_CONFIG` is allowed only when the sender is the `net.dhcp.client` service; any other caller is
  refused with `E_PERM` ([`src/server/handlers/set_config.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_config.rs#L29)). This keeps the interface lease under
  the DHCP client's authority rather than any capsule that can reach `net.ip`.
- `OP_ROUTE_ADD` and `OP_ROUTE_CLEAR` are tier-2 administrative ops, allowed only for the `net.admin`
  service ([`src/server/authz.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L42), `route_add.rs:27`, `route_clear.rs:24`). No capsule is spawned as
  `net.admin` today, so the registry lookup misses and every caller is denied by default; a future
  admin principal registered under that name enables these ops with no handler change
  ([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)).

The remaining ops, healthcheck, get-config, send-packet, and poll-packet, are open to any caller that
can reach the service.

## The error set

All errnos are 16-bit values written into the response header `errno` field. They are part of the wire
contract: a live value is retired and added, never renumbered ([`src/protocol/errno.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L22)).

```
  E_OK           0   success
  E_BAD_MAGIC    1   wrong protocol magic in the request header
  E_BAD_VERSION  2   header version was not 1
  E_BAD_OP       3   unrecognised opcode
  E_BAD_LEN      4   body length did not match the op's fixed layout
  E_NO_CONFIG    5   no IPv4 address, or no net.l2, is configured yet
  E_NO_ROUTE     6   no route matched the destination
  E_NO_NEIGHBOUR 7   ARP could not resolve the next hop
  E_L2_FAULT     8   net.l2 refused or failed the frame, or the build failed
  E_BAD_PACKET   9   a polled frame did not parse, or the poll filter was malformed
  E_RX_EMPTY    10   the poll budget was exhausted with nothing to deliver
  E_TABLE_FULL  11   the 16-entry route table was full
  E_PERM        12   the sender is not authorized for this control op
```

`E_BAD_MAGIC` and `E_BAD_VERSION` are defined and used inside the parser, which drops a bad request
rather than replying ([`src/server/parse_req.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L32)); the ones a client observes on a reply are the
dispatch and handler errnos.

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. The header parse validates magic and
version and bounds the declared payload length with a checked add before any handler runs
([`src/server/parse_req.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L31)). The two sensitive control ops are pinned to a specific attested caller
service, and the administrative pair fails closed when no such principal exists
([`src/server/authz.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L34)). Every handler validates its body length against a fixed layout before it
reads any field (`set_config.rs:33`, `send_packet.rs:26`, `route_add.rs:31`). There is no panic path:
the crate is `panic = "abort"` and every handler returns an errno rather than unwinding
(`Cargo.toml:32`). A client that wants IPv4 service must reach `net.ip` and speak this protocol; it
never gets a handle to the NIC, which lives behind `net.l2`.

## Source map

```
  userland/capsule_net_ip/src/protocol/header.rs     MAGIC ("NIP4")
  userland/capsule_net_ip/src/protocol/ops.rs        the seven opcode constants
  userland/capsule_net_ip/src/protocol/errno.rs      E_OK and the twelve error constants
  userland/capsule_net_ip/src/protocol/limits.rs     IPC_PAYLOAD_MAX and the MTU margin
  userland/capsule_net_ip/src/server/runner.rs       the receive/parse/dispatch loop
  userland/capsule_net_ip/src/server/parse_req.rs    the 20-byte header parse and its checks
  userland/capsule_net_ip/src/server/respond.rs      the response-header encoder and mk_ipc_reply
  userland/capsule_net_ip/src/server/authz.rs        the registry-pid authorization and admin gate
  userland/capsule_net_ip/src/server/handlers/       one file per op, plus the poll_packet subtree
  userland/capsule_net_ip/src/state/rx_queue.rs      the bounded receive queue behind the poll path
  userland/capsule_net_ip/Cargo.toml                 panic = "abort"
  src/capabilities/types.rs                          the capability bits the mask decodes into
```

Every reference above is verified against those trees.
</content>
