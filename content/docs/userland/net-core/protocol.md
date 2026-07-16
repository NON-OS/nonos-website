---
title: "The wire protocols"
description: "This page mirrors src/protocol/ and src/register.rs."
weight: 2
---
This page mirrors `src/protocol/` and [`src/register.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs). It documents the four binary protocols clients
speak to `net_core`, the shared header they all use, the op set and errno set per protocol, and the service
names and ports the capsule registers so a client can find each protocol. For the loop that receives these
requests and the handlers that answer them, read the [server](/docs/userland/net-core/server/) page; for the identity and the
capability mask, read the [README](/docs/userland/net-core/).

## One header, four magics

Every request and reply is a 20-byte little-endian header optionally followed by a payload. The header
layout is fixed ([`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19)): a 4-byte magic, a 2-byte version (always 1), a 2-byte op, a
2-byte status or reserved field, a 2-byte reserved field, a 4-byte request id, and a 4-byte payload length.
`HDR_LEN` is 20 ([`src/protocol/ops.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L20), [`src/server/parse_req.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L19)).

The magic selects which protocol the request belongs to, and the server dispatches on it
([`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52)):

| Magic | Value | Protocol | Source |
|---|---|---|---|
| `NNET` | `0x4E4E4554` | device link (driver-facing, not a registered service) | [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) |
| `NTCP` | `0x4E544350` | TCP sockets | [`src/protocol/tcp.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L17) |
| `NUDP` | `0x4E554450` | UDP sockets | [`src/protocol/udp.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L17) |
| `NDNS` | `0x4E444E53` | DNS resolver | [`src/protocol/dns.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/dns.rs#L17) |
| `NDHC` | `0x4E444843` | DHCP lease status | [`src/protocol/ops.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L18) |

The request writer and the response reader for the driver-facing `NNET` protocol are
`write_request` and `parse_response` ([`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19), [`src/protocol/header.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L33)); the
server side parses client requests with `parse` and encodes replies with `reply`, both documented on the
[server](/docs/userland/net-core/server/) page. A reply reuses the same header with the client's magic and op echoed back and the
status field set to an errno ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)).

## The services and their ports

After setup succeeds, `register::all` registers four service names, each at its own port, and prints a
marker ([`src/register.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L29)). These are the ports a client looks up to reach each protocol.

| Service | Port | Magic to use | Source |
|---|---|---|---|
| `net.tcp` | 4476 | `NTCP` | [`src/register.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L19), [`src/register.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L24) |
| `net.udp` | 4472 | `NUDP` | [`src/register.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L20), [`src/register.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L25) |
| `net.dhcp.client` | 4474 | `NDHC` | [`src/register.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L21), [`src/register.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L26) |
| `net.dns` | 4478 | `NDNS` | [`src/register.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L22), [`src/register.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L27) |

If all four register the capsule logs `[NET-CORE] registered net.tcp net.udp net.dhcp.client net.dns`;
otherwise it logs `[NET-CORE] registration partial failure` ([`src/register.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L35)). All four services are
served from the one service inbox in the request loop, so a client sends to the registered port and the
capsule routes by magic ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)).

## TCP (`NTCP`, service `net.tcp`)

The op constants are in [`src/protocol/tcp.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L19).

| Op | Value | Request payload | Reply payload | Source |
|---|---|---|---|---|
| `OP_CONNECT` | 3 | 4-byte IPv4 + 2-byte port | 4-byte app handle | [`src/protocol/tcp.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L20), [`src/server/handlers/tcp/connect.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/connect.rs#L43) |
| `OP_SEND` | 5 | 4-byte handle + data | 4-byte bytes-accepted | [`src/protocol/tcp.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L22), [`src/server/handlers/tcp/send.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/send.rs#L25) |
| `OP_RECV` | 6 | 4-byte handle | received bytes | [`src/protocol/tcp.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L23), [`src/server/handlers/tcp/recv.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/recv.rs#L25) |
| `OP_CLOSE` | 7 | 4-byte handle | none | [`src/protocol/tcp.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L24), [`src/server/handlers/tcp/close.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/close.rs#L25) |
| `OP_STATE` | 9 | 4-byte handle | 1-byte state code | [`src/protocol/tcp.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L25), [`src/server/handlers/tcp/state.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/state.rs#L25) |

`OP_LISTEN` (2) and `OP_ACCEPT` (4) are defined in the protocol module ([`src/protocol/tcp.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L19),
[`src/protocol/tcp.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L21)) but are not wired into the TCP dispatch, which handles only connect, send, recv,
close, and state ([`src/server/handlers/tcp/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/mod.rs#L29)). The 1-byte state code returned by `OP_STATE` maps
the smoltcp `tcp::State` enum: 0 Listen, 1 SynSent, 2 SynReceived, 3 Established, 4 CloseWait, 5 FinWait1,
6 FinWait2, 7 Closing, 8 TimeWait, 9 LastAck, and `0xFF` Closed ([`src/server/handlers/tcp/state.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/state.rs#L49)).

TCP errnos ([`src/protocol/tcp.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L27)): `E_OK` 0, `E_BAD_OP` 3, `E_BAD_LEN` 4, `E_NO_SOCKET` 5,
`E_RX_EMPTY` 11, `E_NOT_CONNECTED` 12.

## UDP (`NUDP`, service `net.udp`)

The op constants are in [`src/protocol/udp.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L19).

| Op | Value | Request payload | Reply payload | Source |
|---|---|---|---|---|
| `OP_BIND` | 2 | 2-byte local port | none | [`src/protocol/udp.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L19), [`src/server/handlers/udp/bind.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/bind.rs#L32) |
| `OP_UNBIND` | 3 | 2-byte local port | none | [`src/protocol/udp.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L20), [`src/server/handlers/udp/unbind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/unbind.rs#L23) |
| `OP_SEND` | 4 | 2-byte local port + 4-byte IPv4 + 2-byte port + data | none | [`src/protocol/udp.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L21), [`src/server/handlers/udp/send.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/send.rs#L26) |
| `OP_RECV` | 5 | 2-byte local port | 4-byte src IPv4 + 2-byte src port + data | [`src/protocol/udp.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L22), [`src/server/handlers/udp/recv.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/recv.rs#L26) |

UDP errnos ([`src/protocol/udp.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/udp.rs#L24)): `E_OK` 0, `E_BAD_OP` 3, `E_BAD_LEN` 4, `E_NO_SOCKET` 5,
`E_BIND_FAILED` 6, `E_RX_EMPTY` 8, `E_NOT_CONNECTED` 12.

## DNS (`NDNS`, service `net.dns`)

One op, `OP_RESOLVE_A` (2) ([`src/protocol/dns.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/dns.rs#L19)). The request payload is the hostname as raw UTF-8
bytes; the reply payload on success is the 4-byte IPv4 address of the first A record
([`src/server/handlers/dns/resolve_a.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L29), [`src/server/handlers/dns/resolve_a.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L59)). DNS errnos
([`src/protocol/dns.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/dns.rs#L21)): `E_OK` 0, `E_BAD_OP` 3, `E_NAME_INVALID` 9, `E_SERVFAIL` 10, `E_NO_LEASE` 11.
`E_NO_LEASE` is returned when there is no DHCP lease yet, so no DNS socket has been installed
([`src/server/handlers/dns/resolve_a.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L39)); `E_SERVFAIL` covers a query timeout or an empty answer
([`src/server/handlers/dns/resolve_a.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L50)).

## DHCP status (`NDHC`, service `net.dhcp.client`)

One op, `OP_LEASE_STATUS` (3) ([`src/protocol/ops.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L27)). It takes no request payload and returns an
18-byte body ([`src/server/handlers/dhcp_status.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dhcp_status.rs#L32)): a 1-byte state (3 bound, 1 unbound), then when
bound the 4-byte IPv4 address, a 1-byte prefix length, the 4-byte gateway, the 4-byte DNS server, and a
4-byte lease-seconds field. When unbound only the leading state byte is set ([`src/server/handlers/dhcp_status.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dhcp_status.rs#L43)).
This op shares the errno set of the base protocol ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)): `E_OK` 0, `E_BAD_MAGIC` 1,
`E_BAD_VERSION` 2, `E_BAD_OP` 3, `E_BAD_LEN` 4.

## Health (op 1, any magic)

`OP_HEALTHCHECK` (1) is checked before the magic dispatch, so it answers regardless of protocol
([`src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L50), [`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21)). It takes no payload and replies `E_OK`
with the request's own magic and op echoed back ([`src/server/handlers/health.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L23)).

## The driver-facing NNET protocol

`NNET` is not a service clients call; it is the protocol `net_core` speaks as a client to the NIC driver.
Its ops are `OP_LINK_STATUS` 2, `OP_MAC_ADDRESS` 3, `OP_TX_PACKET` 4, and `OP_RX_PACKET` 5
([`src/protocol/ops.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L22)). The [device](/docs/userland/net-core/device/) page documents how each is used.

## Source map

```
  userland/capsule_net_core/src/protocol/header.rs   write_request, parse_response, the 20-byte layout
  userland/capsule_net_core/src/protocol/ops.rs      HDR_LEN, MAGIC_NNET/NDHC, the NNET and lease ops
  userland/capsule_net_core/src/protocol/tcp.rs      MAGIC_NTCP, the TCP ops and errnos
  userland/capsule_net_core/src/protocol/udp.rs      MAGIC_NUDP, the UDP ops and errnos
  userland/capsule_net_core/src/protocol/dns.rs      MAGIC_NDNS, OP_RESOLVE_A, the DNS errnos
  userland/capsule_net_core/src/protocol/errno.rs    the base errno set behind NDHC and header faults
  userland/capsule_net_core/src/register.rs          the four net.* service names and their ports
  userland/capsule_net_core/src/server/runner.rs     the magic dispatch and the health short-circuit
  userland/capsule_net_core/src/server/respond.rs    the reply encoder that echoes magic and op
  userland/capsule_net_core/src/server/handlers/     the per-op handlers cited per row above
```

Every reference above is verified against those trees.
