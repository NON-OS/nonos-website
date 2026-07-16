---
title: "BOOTP messages and Ethernet framing"
description: "This page mirrors src/dhcp/ (the BOOTP message, its build and parse, and the RFC 2131/2132 constants) and src/frame/ (the Ethernet, IPv4, and UDP compose and extract with the RF..."
weight: 4
---
This page mirrors `src/dhcp/` (the BOOTP message, its build and parse, and the RFC 2131/2132 constants) and
`src/frame/` (the Ethernet, IPv4, and UDP compose and extract with the RFC 1071 checksum). It is the wire
machinery under the transport path: what a DISCOVER or REQUEST looks like on the wire, and how an inbound
server reply is peeled back to a BOOTP payload. For the ladder that calls these see the [lease](/docs/userland/net-dhcp/lease/)
page; for the IPC clients that carry the finished frames see the [transport](/docs/userland/net-dhcp/transport/) page.

## The BOOTP message

`dhcp::Message` is the in-memory form of a BOOTP/DHCP message, carrying the op, xid, flags, `ciaddr`,
`yiaddr`, `chaddr`, and the parsed option fields the client cares about: message type, server id, subnet mask,
router, DNS, and lease seconds ([`src/dhcp/message.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/message.rs#L19)). `new_request` seeds a client request from the NIC
MAC and a transaction id, setting the BOOTP op to `OP_REQUEST` and the broadcast flag
([`src/dhcp/message.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/message.rs#L36)).

The wire constants are RFC 2131/2132: the BOOTP fixed region is 240 bytes, the DHCP magic cookie is
`63 82 53 63`, the fixed-field offsets run op/htype/hlen/xid/flags/ciaddr/yiaddr/chaddr/cookie, and the option
tags cover subnet mask (1), router (3), DNS (6), requested IP (50), lease time (51), message type (53), server
identifier (54), parameter list (55), and END (0xFF) ([`src/dhcp/constants.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/constants.rs#L20)). The DHCP message-type
values are DISCOVER 1, OFFER 2, REQUEST 3, ACK 5, NAK 6, RELEASE 7, and the BOOTP UDP ports are server 67 and
client 68 ([`src/dhcp/constants.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/constants.rs#L52)).

## Building a request

`build_request` writes the BOOTP fixed region and the option block for a DISCOVER or REQUEST. It rejects an
output buffer too small for the header plus a minimal option block as `OutputTooSmall`, zeroes the fixed
region, writes op/htype/hlen/xid/flags/chaddr and the magic cookie, then appends the message-type option,
optionally the requested-IP and server-identifier options, a parameter-request list asking for subnet mask,
router, and DNS, and the END marker ([`src/dhcp/build.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/build.rs#L30)). The returned length is the number of bytes
actually written, which varies with which options are present (`build.rs:74`).

## Parsing a reply

`parse` validates a received BOOTP message and returns a filled `Message`. It rejects a buffer shorter than
the 240-byte fixed region as `TooShort` and a wrong magic cookie as `BadCookie`, then reads the fixed fields
and walks the option block ([`src/dhcp/parse/parse.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/parse.rs#L23)). `parse_fixed` reads op, xid, flags, `ciaddr`,
`yiaddr`, and `chaddr` from their fixed offsets ([`src/dhcp/parse/parse_fixed.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/parse_fixed.rs#L20)). `parse_options` walks
tag/length/value triples from the end of the fixed region, honouring PAD and END, and bounds every length
against the buffer so a lying option length cannot read past the end (`BadOption` otherwise); it extracts the
message type, subnet mask, router, DNS, lease time, and server id, ignoring any option it does not recognise
([`src/dhcp/parse/parse_options.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/parse_options.rs#L21)). The error set is `TooShort`, `BadCookie`, `BadOption`
([`src/dhcp/parse/error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/error.rs#L17)).

## Composing the outbound frame

Because the source address is `0.0.0.0` before a lease exists, the client builds the whole broadcast frame
itself rather than routing through `net.ip`. `broadcast_request` wraps a BOOTP payload in UDP, IPv4, and
Ethernet, with the source IP `0.0.0.0`, the destination `255.255.255.255` at every layer, the source MAC the
client's, and the destination MAC broadcast ([`src/frame/compose.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/compose.rs#L38)). The Ethernet header is 14 bytes with
ethertype `0x0800` for IPv4 ([`src/frame/ethernet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/ethernet.rs#L17)). The IPv4 header is a standard 20-byte header with
version 4, IHL 5, TTL 64, protocol 17 (UDP), and a header checksum sealed with `fold` ([`src/frame/ipv4.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/ipv4.rs#L24)).
The UDP header is 8 bytes from client port 68 to server port 67, with a checksum sealed over the IPv4 pseudo-
header by `fold_with_pseudo` ([`src/frame/udp.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/udp.rs#L22)).

## Extracting the inbound payload

`dhcp_payload` peels an inbound frame back to its BOOTP body. It parses the Ethernet header and requires
ethertype IPv4, parses the IPv4 header and requires protocol UDP (honouring the header's IHL so options are
skipped), parses the UDP header and requires source port 67 and destination port 68, and returns the payload
slice bounded by the UDP length; any unmatched frame is `None`, so ARP, ICMP, and stray traffic are dropped
([`src/frame/extract.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/extract.rs#L25)). The UDP parser bounds the declared length against the buffer before returning it
([`src/frame/udp.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/udp.rs#L44)), and the IPv4 parser rejects a version other than 4 and an IHL below 5
([`src/frame/ipv4.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/ipv4.rs#L52)).

## The checksum

[`src/frame/checksum.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/checksum.rs) is the RFC 1071 ones-complement checksum. `fold` sums 16-bit big-endian words with a
trailing odd byte padded, folds carries back in until none remain, and complements, used for the IPv4 header
([`src/frame/checksum.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/checksum.rs#L22)). `fold_with_pseudo` prepends the IPv4 pseudo-header (source, destination,
protocol, UDP length) before summing the body, and returns `0xFFFF` for a computed zero so a zero wire value
can keep its RFC "no checksum" meaning, used for UDP ([`src/frame/checksum.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/checksum.rs#L38)). The DHCP capsule owns its
own copy of this because it cannot route through `net.ip` for the outbound BOOTP exchange, where the source
IPv4 is still `0.0.0.0` ([`src/frame/checksum.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/checksum.rs#L17)).

## Security posture at this boundary

Every parser bounds a wire-supplied length before it reads: the BOOTP option walker refuses an option length
that runs past the buffer ([`src/dhcp/parse/parse_options.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/parse_options.rs#L37)), the UDP parser refuses a length below the
header or beyond the buffer ([`src/frame/udp.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/udp.rs#L51)), and the IPv4 parser refuses a truncated header
([`src/frame/ipv4.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/ipv4.rs#L64)). The BOOTP parser rejects a short buffer and a wrong cookie before touching options
([`src/dhcp/parse/parse.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/parse.rs#L24)), and the subnet-mask-to-prefix conversion rejects a discontiguous mask rather
than producing a nonsense prefix ([`src/dora/mask.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/mask.rs#L26)). All of this runs on frames the capsule itself pulled
from `net.l2`, in userland, with no kernel BOOTP parser anywhere in the path.

## Source map

```
  userland/capsule_net_dhcp/src/dhcp/message.rs        the Message struct and new_request
  userland/capsule_net_dhcp/src/dhcp/constants.rs      RFC 2131/2132 offsets, option tags, message types, ports
  userland/capsule_net_dhcp/src/dhcp/build.rs          build_request: fixed region + option block
  userland/capsule_net_dhcp/src/dhcp/parse/parse.rs    parse: cookie check and dispatch
  userland/capsule_net_dhcp/src/dhcp/parse/parse_fixed.rs   the fixed-field reader
  userland/capsule_net_dhcp/src/dhcp/parse/parse_options.rs the bounded option walker
  userland/capsule_net_dhcp/src/dhcp/parse/error.rs    TooShort / BadCookie / BadOption
  userland/capsule_net_dhcp/src/frame/compose.rs       broadcast_request: wrap BOOTP in UDP+IPv4+Eth
  userland/capsule_net_dhcp/src/frame/ethernet.rs      the 14-byte Ethernet header write and parse
  userland/capsule_net_dhcp/src/frame/ipv4.rs          the IPv4 header write and parse
  userland/capsule_net_dhcp/src/frame/udp.rs           the UDP header write and parse
  userland/capsule_net_dhcp/src/frame/extract.rs       dhcp_payload: peel to the BOOTP body
  userland/capsule_net_dhcp/src/frame/checksum.rs      fold and fold_with_pseudo
  userland/capsule_net_dhcp/src/dora/mask.rs           contiguous mask to CIDR prefix
```

Every reference above is verified against those trees.
