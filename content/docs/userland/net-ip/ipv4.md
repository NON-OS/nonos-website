---
title: "The IPv4 datagram path"
description: "The core of the capsule is the code that turns bytes into a validated IPv4 datagram and back."
weight: 3
---
The core of the capsule is the code that turns bytes into a validated IPv4 datagram and back. This page
mirrors `src/ipv4/` (the RFC 791 header parse and build, the RFC 1071 checksum, and the address
helpers) and the two framing modules that wrap it: `src/egress/` on the way out and [`src/ingress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs) on
the way in. For the ops that drive this path see the [operations](/docs/userland/net-ip/operations/) page; for the ICMP
echo hook inside ingress see the [icmp](/docs/userland/net-ip/icmp/) page; for the route lookup and the ARP resolve that
egress calls see the [routing](/docs/userland/net-ip/routing/) page.

## The header view

The capsule keeps only the fields the data path needs from a parsed packet: source, destination, and
protocol number ([`src/ipv4/header.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/header.rs#L29)). Everything else on the wire is validated during parse and
then discarded; the egress path rebuilds a fresh header on every transmit rather than mutating an
inbound one. The header constants are the minimum header length of 20 bytes, version 4, a default TTL
of 64, and the checksum field offset of 10 ([`src/ipv4/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/header.rs#L19)).

## Parsing an inbound packet

`ipv4::parse` validates and decodes a packet, returning the header view and a slice of the payload
trimmed to the declared total length ([`src/ipv4/parse.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/parse.rs#L35)). It rejects, in order:

- a buffer shorter than the 20-byte minimum header (`TooShort`, `parse.rs:36`);
- a version nibble that is not 4 (`BadVersion`, `parse.rs:40`);
- an IHL below 5 words, or an IHL that runs past the buffer (`BadIhl`, `parse.rs:44`);
- a total-length field below the header length or beyond the buffer (`TotalLengthMismatch`,
  `parse.rs:52`);
- a header whose checksum does not fold to zero (`BadChecksum`, `parse.rs:55`);
- any packet with the more-fragments flag or a non-zero fragment offset set (`Fragmented`,
  `parse.rs:58`).

Only after all six checks does it read the protocol byte and the source and destination addresses and
return the payload slice (`parse.rs:62`). Options-bearing packets parse cleanly, the IHL just advances
the header length past them; the capsule does not decode options, it steps over them. Fragmented
packets are refused outright rather than reassembled, which is the honest limit of this slice.

## Building an outbound packet

`ipv4::build` writes a 20-byte header followed by the payload into a caller buffer and returns the
total wire length ([`src/ipv4/build.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/build.rs#L40)). The request carries source, destination, protocol,
identification, TTL, and the payload (`build.rs:21`). It rejects a total that overflows a u16 length
field (`PayloadTooLarge`) or an output buffer too small to hold it (`OutputTooSmall`) (`build.rs:42`).
The header is fixed IHL 5, DSCP/ECN zero, the Don't Fragment flag set with no fragment offset, a TTL
that falls back to the default 64 when zero, the caller's protocol byte, and the two addresses; the
checksum field is zeroed and then sealed over the finished header (`build.rs:48`). Setting Don't
Fragment is the build-side match to the parse-side fragment rejection: this capsule neither emits nor
accepts fragments.

## The Internet checksum

Both the parse validation and the build seal use one RFC 1071 16-bit one's-complement routine
([`src/ipv4/checksum.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/checksum.rs#L17)). `fold` sums the buffer as big-endian 16-bit words, adds a trailing odd
byte in the high half, folds the carries back in, and returns the one's complement; a valid header
folds to zero, which is exactly the inbound check (`checksum.rs:22`, `parse.rs:55`). `seal_at` is the
outbound convenience: it zeroes the checksum field at a given offset, folds, and writes the result back
big-endian, returning the value (`checksum.rs:41`). The caller is responsible for clearing the field
before folding, which `seal_at` does for the build path and which the ICMP build reuses through the
same two functions ([`src/icmp/build.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/build.rs#L46)).

## Addresses and subnets

An IPv4 address is a plain 4-byte array ([`src/ipv4/addr.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/addr.rs#L17)). The one piece of logic here is subnet
comparison: `mask_with_prefix` applies a `/N` mask that saturates at 32, and `same_subnet` returns
true when two addresses share the same masked network ([`src/ipv4/addr.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/addr.rs#L20)). This is what the route
table uses for its longest-prefix match ([`src/route/table.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/table.rs#L62)) and what a future on-link check would
build on.

## Egress: from payload to frame

The egress path is the wrapper that takes a destination, a protocol, and a payload and puts a complete
ethernet frame on the wire through `net.l2`. `egress::send` is the pipeline: it reads the configured
source IPv4 (or fails `NoConfig`), reads the configured `net.l2` port (or fails `NoConfig`), resolves
the next hop through the route table and then its MAC through ARP, builds the frame, and hands it to L2
([`src/egress/send.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L26)). The next hop is the route's gateway if it has one, or the destination itself
when the route is on-link (`send.rs:49`); a lookup miss is `NoRoute`. `build_frame` writes the 14-byte
ethernet header (destination MAC, source MAC, the `0x0800` IPv4 ethertype), then calls `ipv4::build`
into the rest of the buffer with a fresh identification from the interface counter, and checks that the
built length lines up with the allocation ([`src/egress/frame.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/frame.rs#L24)). The five failure points map to
the five `EgressError` variants ([`src/egress/error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/error.rs#L17)), which the send handler turns into wire
errnos ([`src/server/handlers/send_packet.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send_packet.rs#L34)).

## Ingress: from frame to packet

The ingress path is the inbound mirror. `from_frame` takes a complete ethernet frame from `net.l2`,
requires at least the 14-byte L2 header, checks the ethertype is IPv4 and drops anything else as
`NotIpv4`, and parses the IPv4 payload with `ipv4::parse`, mapping any parse error to `BadIp`
([`src/ingress.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L47)). It then applies the local-delivery filter: once an address is configured, a
packet whose destination is neither the local address nor the all-ones broadcast is `NotForUs`
(`ingress.rs:57`). Before surfacing the packet it runs the ICMP echo auto-responder; if the packet was
an echo request the responder answers it and ingress reports `Absorbed` so the caller never sees ping
traffic (`ingress.rs:61`). Under the `tcp-chaos` feature only, a deterministic drop of selected inbound
TCP segments is spliced in here to exercise retransmission, and is byte-for-byte absent otherwise
(`ingress.rs:64`, [`src/chaos.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chaos.rs#L30)). What survives is an `Inbound` of source, destination, protocol,
and an owned payload, which the poll path converts to a queued `Packet` ([`src/server/handlers/poll_packet/route.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/route.rs#L50)).

## Source map

```
  userland/capsule_net_ip/src/ipv4/header.rs      the header view and the RFC 791 constants
  userland/capsule_net_ip/src/ipv4/parse.rs       the six-check inbound validation and payload trim
  userland/capsule_net_ip/src/ipv4/build.rs       the 20-byte outbound header build and DF flag
  userland/capsule_net_ip/src/ipv4/checksum.rs    fold and seal_at, the RFC 1071 checksum
  userland/capsule_net_ip/src/ipv4/addr.rs        the address type, mask_with_prefix, same_subnet
  userland/capsule_net_ip/src/ipv4/mod.rs         the re-exports the rest of the capsule uses
  userland/capsule_net_ip/src/egress/send.rs      the src -> route -> ARP -> build -> L2 pipeline
  userland/capsule_net_ip/src/egress/frame.rs     the ethernet header and the ipv4::build call
  userland/capsule_net_ip/src/egress/error.rs     the five EgressError variants
  userland/capsule_net_ip/src/ingress.rs          strip L2, parse IPv4, local filter, ICMP hook
  userland/capsule_net_ip/src/chaos.rs            the feature-gated inbound TCP drop injector
```

Every reference above is verified against those trees.
</content>
