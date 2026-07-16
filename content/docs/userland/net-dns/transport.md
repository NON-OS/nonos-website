---
title: "The UDP client and bring-up"
description: "This page mirrors src/udpclient/ (the IPC client that carries DNS datagrams to net.udp) and src/setup.rs (bring-up)."
weight: 3
---
This page mirrors `src/udp_client/` (the IPC client that carries DNS datagrams to `net.udp`) and
[`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) (bring-up). It is the layer the resolve exchange reaches when it needs the wire: the DNS
engine builds a query, and this client ships it to the UDP transport capsule and reads the reply back. For
the exchange loop that drives it see the [resolver](/docs/userland/net-dns/resolver/) page; for the request protocol above it,
the [operations](/docs/userland/net-dns/operations/) page. For where DNS sits above UDP and IP in the stack, see the
[networking subsystem](/docs/subsystems/networking/).

## DNS has no socket of its own

This capsule holds no network device and speaks no UDP header. Every byte it sends or receives crosses IPC
to the UDP transport capsule, `net.udp`, and `src/udp_client/` is that client. It speaks the same 20-byte v1
`NUDP` request envelope the UDP capsule serves, with magic `0x4E55_4450`, version 1, and a 20-byte header
([`src/udp_client/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/header.rs#L17)). Three UDP opcodes matter to DNS: `OP_BIND = 2`, `OP_SEND = 4`, and
`OP_RECV = 5` ([`src/udp_client/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/header.rs#L20)). The DNS capsule is a client of the UDP capsule exactly the way
a ping tool or a wallet is a client of the DNS capsule.

## The NUDP envelope codec

`write` and `parse` are the envelope codec. `write` lays down the magic, version, opcode, a zeroed reserved
field, the request id, and the payload length, all little-endian ([`src/udp_client/header.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/header.rs#L24)). `parse`
validates the magic and version and reads back the opcode, the 16-bit errno at offset 8, the request id, and
the payload length, returning `None` on a short buffer or a wrong magic or version
([`src/udp_client/header.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/header.rs#L33)). The DNS capsule uses fixed request ids per call site (`1` for bind, `2` for
send, `3` for recv) because it issues one call at a time and matches the reply by opcode rather than by id
([`src/udp_client/bind.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/bind.rs#L30), [`src/udp_client/send.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/send.rs#L39), [`src/udp_client/recv.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/recv.rs#L43)).

## Binding a local port

`bind` reserves the DNS capsule's local UDP source port on `net.udp` so replies to its queries have
somewhere to land. It writes an `OP_BIND` request with the 2-byte local port and issues a synchronous
`mk_ipc_call` ([`src/udp_client/bind.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/bind.rs#L28)). A transport error is `Send`, a reply that does not parse or
whose opcode is not `OP_BIND` is `BadResponse`, and any UDP errno other than success or `6` is `Refused`
(`bind.rs:34`). The errno `6` is the UDP capsule's `E_PORT_IN_USE`, which `bind` treats as success on the
grounds that the port is already reserved for this capsule and a rebind is harmless
([`src/udp_client/bind.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/bind.rs#L41)).

## Sending a query

`send_to` ships one DNS query to the upstream. It builds an `OP_SEND` body of the 2-byte source port, the
4-byte destination IPv4, the 2-byte destination port, and the query payload, sizing the request buffer to
exactly the header plus that body ([`src/udp_client/send.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/send.rs#L37)). It issues `mk_ipc_call` and maps a transport
error to `Send`, a wrong or unparseable reply to `BadResponse`, and any non-zero UDP errno to `Refused`
([`src/udp_client/send.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/send.rs#L46)). The DNS capsule always sends to the upstream on port 53
([`src/server/handlers/resolve_common.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L43)), which is the transport page's counterpart to the resolver
page's exchange loop.

## Receiving a reply

`recv_from` polls `net.udp` for one datagram delivered to the bound local port. It writes an `OP_RECV`
request with the 2-byte local port, sizes the response buffer to the header plus 6 bytes of source framing
plus a 512-byte DNS payload, and issues `mk_ipc_call` ([`src/udp_client/recv.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/recv.rs#L41)). It maps the UDP errno
set to a typed error: a transport error is `Send`, a wrong opcode or a short reply is `BadResponse`, the UDP
`E_RX_EMPTY` value `8` is `Empty`, and any other non-zero errno is `Refused` ([`src/udp_client/recv.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/recv.rs#L47)).
On a delivered datagram it bounds the declared length against the received buffer before it reads the body,
so a lying length cannot overrun (`recv.rs:60`), then splits out the 4-byte source IPv4, the 2-byte source
port, and the payload into a `UdpDatagram` (`recv.rs:64`). The exchange loop uses the source address and
port to reject a datagram that did not come from the upstream on the DNS port
([`src/server/handlers/resolve_common.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L48)).

## The state under the client

The client is stateless; the ports and the upstream it needs live in [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs).

- `UDP_PORT` is an `AtomicU32` holding the resolved `net.udp` service port, written once at setup with
  `Release` and read on every send and recv with `Acquire`, so a reader that sees a non-zero port also sees
  the setup that produced it ([`src/state.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L26), [`src/state.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L38)).
- `LOCAL_PORT` is an `AtomicU16` holding the capsule's chosen UDP source port. It is minted once, lazily, as
  `49152 + (rand % 16384)` from the kernel entropy source, and installed with a compare-exchange so two
  callers racing to pick a port converge on one value ([`src/state.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L46), [`src/state.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L51)).
- `UPSTREAM` is a `Mutex<[u8; 4]>` defaulting to `1.1.1.1`, read by the exchange and written by DHCP
  discovery or the admin op ([`src/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L23), [`src/state.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L28), [`src/state.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L70)).
- `next_xid` draws a fresh 16-bit DNS transaction id from the same entropy source per query
  ([`src/state.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L58)), and `now_ms` reads the kernel millisecond clock for the cache TTL math, clamping a
  negative raw value to zero ([`src/state.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L62)).

The entropy for the local port and the transaction id comes from `crypto_random`, which is why the manifest
mask carries the `Crypto` bit ([`src/state.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L32); see the [README](/docs/userland/net-dns/) identity table).

## Bring-up

`setup::run` is the whole bring-up ([`src/setup.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L30)). It resolves `net.udp` through `mk_service_lookup`
and fails `UdpMissing` if the lookup returns non-zero or a zero port ([`src/setup.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L33)). It then mints the
local source port, binds it on `net.udp`, and fails `BindFailed` if either step fails ([`src/setup.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L37)).
On success it stores the UDP service port in shared state and calls `dhcp_upstream::apply` to adopt the
lease's DNS server as the upstream if one is available ([`src/setup.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L39); the DHCP path is on the
[resolver](/docs/userland/net-dns/resolver/) page). `_start` calls setup in a retry loop, yielding 64 times between attempts
until it succeeds, so the capsule waits for `net.udp` to come up rather than failing outright
([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). Only after setup succeeds does the server loop start.

## Source map

```
  userland/capsule_net_dns/src/udp_client/header.rs  NUDP magic, version, OP_BIND/OP_SEND/OP_RECV, write/parse
  userland/capsule_net_dns/src/udp_client/bind.rs    bind: OP_BIND, the in-use-is-success rule
  userland/capsule_net_dns/src/udp_client/send.rs    send_to: OP_SEND body and errno map
  userland/capsule_net_dns/src/udp_client/recv.rs    recv_from: OP_RECV, the E_RX_EMPTY map, the length bound
  userland/capsule_net_dns/src/udp_client/mod.rs     the client re-exports
  userland/capsule_net_dns/src/state.rs              UDP_PORT, LOCAL_PORT, UPSTREAM, next_xid, now_ms, entropy
  userland/capsule_net_dns/src/setup.rs              resolve net.udp, mint and bind the local port, apply DHCP upstream
  userland/capsule_net_dns/src/main.rs               the setup retry loop
  userland/capsule_net_dns/src/server/handlers/resolve_common.rs   the send/recv call sites and the upstream filter
  src/capabilities/types.rs                          the Crypto bit the entropy source needs
```

Every reference above is verified against those trees.
