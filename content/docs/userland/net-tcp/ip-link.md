---
title: "The net.ip link"
description: "This page mirrors src/ipclient/, the client the capsule uses to reach the IPv4 capsule, plus src/setup.rs and src/clock.rs, the two small modules the link depends on."
weight: 6
---
This page mirrors `src/ip_client/`, the client the capsule uses to reach the IPv4 capsule, plus [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs)
and [`src/clock.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clock.rs), the two small modules the link depends on. Every TCP segment this capsule sends leaves
through `net.ip`, and every segment it receives arrives by polling `net.ip`; the capsule never touches a NIC
or an ARP table. For where a segment comes from, read the [segments](/docs/userland/net-tcp/segments/) page; for who calls the send
and poll functions, read the [connections](/docs/userland/net-tcp/connections/) page. For the whole layered stack, read the
[networking subsystem](/docs/subsystems/networking/).

## The NIP4 wire

The IP client speaks a fixed twenty-byte header, mirroring the shape of the `NTCP` header but with its own
magic ([`src/ip_client/wire.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L17)). The magic is `0x4E495034`, the version is 1, and the header length is
twenty ([`src/ip_client/wire.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L17)). The client uses three of the IP capsule's opcodes: `OP_GET_CONFIG` (2)
to read the local address, `OP_SEND_PACKET` (4) to hand a segment down, and `OP_POLL_PACKET` (5) to pull one
up ([`src/ip_client/wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L21)). The IPv4 protocol number it filters and stamps on is 6, TCP
([`src/ip_client/wire.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L25)).

`write_request` fills the header, magic, version, op, a zeroed status word, the request id, and the payload
length, into a caller buffer ([`src/ip_client/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/header.rs#L19)). `parse_response` validates the magic and version
of a reply and returns the op, errno, request id, and payload length, or `None` on a malformed reply
([`src/ip_client/header.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/header.rs#L28)). Request ids come from a process-global atomic counter that starts at one
([`src/ip_client/seq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/seq.rs#L19)); they let a reply be matched to its call, though the client uses blocking calls
so the pairing is implicit.

## Reading the local config

`read_ipv4` is the setup-time call that learns the capsule's own IPv4 address ([`src/ip_client/config.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/config.rs#L32)).
It sends an `OP_GET_CONFIG` request with an empty body and reads back a seventeen-byte config body, checking
the reply op and body length match and that the errno is zero ([`src/ip_client/config.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/config.rs#L41)). It returns the
four address bytes at offset six of the body ([`src/ip_client/config.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/config.rs#L47)). A send failure, a mismatched
reply, or a non-zero errno each map to a distinct `ConfigError`. This is the call `setup::run` makes to fill
the local IP that every outgoing segment's source field comes from.

## Sending a segment

`send_segment` hands one built TCP segment down to `net.ip` for IPv4 delivery ([`src/ip_client/send.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/send.rs#L32)).
It builds an `OP_SEND_PACKET` request whose body is the four-byte destination address, the protocol byte 6,
and the segment, calls `net.ip`, and reads the reply, returning `Ok` on errno zero and a `SendError`
otherwise ([`src/ip_client/send.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/send.rs#L33)). `tcp_tx::send` is the one caller: it builds the segment from a `Tcb`
and hands it here, and `send_rst` does the same for a bare reset (see the [connections](/docs/userland/net-tcp/connections/) and
[segments](/docs/userland/net-tcp/segments/) pages).

## Polling for a segment

`poll_segment` pulls one inbound TCP segment up from `net.ip` ([`src/ip_client/recv.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv.rs#L41)). It sends an
`OP_POLL_PACKET` request carrying the protocol filter byte 6, so `net.ip` returns only TCP, and reads back a
buffer sized for a full 1500-byte datagram ([`src/ip_client/recv.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv.rs#L42)). `parse_packet` maps the IP capsule's
"queue empty" errno 10 to `RecvError::Empty`, any other non-zero errno to `Other`, and on success returns the
source and destination addresses and the segment bytes, after checking the reported length is at least the
nine-byte address-and-protocol prefix and that the protocol byte is TCP ([`src/ip_client/recv.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv.rs#L57)). The
`Empty` case is the common one: `drain_one` calls `poll_segment` in a loop and stops when it comes back empty,
which is how the tick drains the inbound queue without blocking.

## Setup

`setup::run` is the one-time bring-up the main loop retries until it succeeds ([`src/setup.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L42)). In order it
seeds the ISS SipHash key from sixteen bytes of `crypto_random`, returning `EntropyMissing` if the draw is
short ([`src/setup.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L31)); looks up the `net.ip` service by name, returning `IpMissing` if it is not
registered or reports port zero ([`src/setup.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L46)); reads the local IPv4 config, returning `ConfigMissing`
on a failed read or an all-zero address, which is what an unconfigured or pre-DHCP interface returns
([`src/setup.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L50)); and stores the IP port and local address into the process locals ([`src/setup.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L54)).
Because the main loop retries setup after yielding rather than exiting, a TCP capsule that starts before
`net.ip` has a lease simply waits and succeeds once the lease is bound ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)).

## The clock

`clock::now_ms` is the millisecond time source the whole capsule runs on ([`src/clock.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clock.rs#L19)). It calls
`mk_time_millis` and returns zero for a negative reading rather than panicking, so a clock that is not yet up
reads as zero ([`src/clock.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clock.rs#L19)). The retransmit RTO, the RTT samples, the TimeWait deadlines, the connect
wait, and the ISS mix all read this clock; the connect wait and the ISS are written to tolerate a zero
reading, which is why the connect path carries an iteration fallback (see the [connections](/docs/userland/net-tcp/connections/)
and [segments](/docs/userland/net-tcp/segments/) pages).

## Source map

```
  userland/capsule_net_tcp/src/ip_client/wire.rs     the NIP4 magic, version, ops, and TCP protocol number
  userland/capsule_net_tcp/src/ip_client/header.rs   the request writer and response parser
  userland/capsule_net_tcp/src/ip_client/seq.rs      the request-id counter
  userland/capsule_net_tcp/src/ip_client/config.rs   read_ipv4 and the local-address read
  userland/capsule_net_tcp/src/ip_client/send.rs     send_segment and the OP_SEND_PACKET body
  userland/capsule_net_tcp/src/ip_client/recv.rs     poll_segment, the empty-queue mapping, and packet parse
  userland/capsule_net_tcp/src/setup.rs              the ISS seed, net.ip lookup, and config read
  userland/capsule_net_tcp/src/clock.rs              the mk_time_millis wrapper
  userland/capsule_net_tcp/src/main.rs               the setup retry loop
```

Every reference above is verified against those trees.
