---
title: "ICMP echo"
description: "The capsule answers ping itself. This page mirrors src/icmp/: the ICMP header, the echo parse and the reply build, and the auto-responder that sits inside the ingress path and r..."
weight: 4
---
The capsule answers ping itself. This page mirrors `src/icmp/`: the ICMP header, the echo parse and the
reply build, and the auto-responder that sits inside the ingress path and replies to an echo request
without ever surfacing it to a caller, the same way a real kernel network stack does. For the ingress
path that calls this responder see the [ipv4](/docs/userland/net-ip/ipv4/) page; for the egress the reply is sent through
see the same page.

## The ICMP header

An ICMP message is an 8-byte header followed by a payload ([`src/icmp/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/types.rs#L17)). The capsule cares
about two type values, echo reply (0) and echo request (8), and it treats the checksum field as sitting
at offset 2 ([`src/icmp/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/types.rs#L19)). The header view it keeps is the type byte, the code byte, and the
4-byte rest field that carries the identifier and sequence for echo ([`src/icmp/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/types.rs#L24)).

## Parsing an ICMP message

`icmp::parse` validates the checksum over the entire message, header plus payload, and returns the
header view and the payload slice on success ([`src/icmp/parse.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/parse.rs#L29)). It rejects a buffer shorter than
the 8-byte header (`TooShort`) and a message whose checksum does not fold to zero (`BadChecksum`,
`parse.rs:33`). It reuses the IPv4 module's `fold` for the checksum, so ICMP and IPv4 share one
one's-complement routine rather than each carrying its own (`parse.rs:17`, `parse.rs:33`).

## Reading and building echo

The echo helpers read the identifier and sequence out of the header's rest field in network byte order
and package them with the payload ([`src/icmp/echo.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/echo.rs#L29)). `is_echo_request` is the type-and-code test:
type 8, code 0 (`echo.rs:35`). `build_reply` produces the answer to an inbound request: it flips the
type to echo reply (0), echoes the identifier and sequence back in the rest field, and copies the
request payload verbatim, delegating the actual byte layout to the generic ICMP build
(`echo.rs:42`). Echoing the payload verbatim is what makes a standard `ping` see its own data come back.

`icmp::build` is the generic writer: it lays down the type, code, a zeroed checksum, the 4-byte rest,
and the payload, then seals the checksum over the whole message with the IPv4 `seal_at`
([`src/icmp/build.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/build.rs#L29)). It refuses an output buffer too small for the header plus payload
(`OutputTooSmall`, `build.rs:37`). Using `seal_at` here is the same seal the IPv4 build uses, applied
at the ICMP checksum offset over the whole message rather than just a header (`build.rs:46`).

## The auto-responder

`icmp::try_reply` is the hook the ingress path calls on every inbound packet before surfacing it
([`src/icmp/responder.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/icmp/responder.rs#L37), [`src/ingress.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L61)). It returns quickly for anything that is not an ICMP
echo request addressed to this host, and consumes the packet when it is. The sequence is:

- if the protocol number is not ICMP (1), return false so the caller keeps processing the packet
  (`responder.rs:38`);
- parse the ICMP message; a parse failure returns false (`responder.rs:41`);
- if it is not an echo request, return false (`responder.rs:45`);
- otherwise read the echo, allocate a reply buffer of the header plus the echoed payload, build the
  reply, and send it back to the request's source through the egress path as protocol ICMP
  (`responder.rs:48`).

A `true` return means the packet was an echo request and a reply was sent or at least attempted, and
the ingress path reports it `Absorbed` so it never reaches the receive queue or a caller
([`src/ingress.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L61)). A build failure still returns true, consuming the request rather than surfacing
a malformed ping (`responder.rs:50`). Because the reply goes through the ordinary `egress::send`, it
runs the same route lookup, ARP resolve, IPv4 build, and `net.l2` send as any other outbound datagram;
the responder adds no privileged path of its own.

## What is not here

This is echo only. There is no destination-unreachable, time-exceeded, or redirect generation, no ICMP
error emission on the egress path, and no ICMP client surface: a capsule that wants to send its own
pings does so by sending an ICMP payload through `OP_SEND_PACKET` and polling the reply, not through a
dedicated op. The responder's whole job is to keep echo traffic off the caller-visible poll path.

## Source map

```
  userland/capsule_net_ip/src/icmp/types.rs      the 8-byte header, the echo type values, the offset
  userland/capsule_net_ip/src/icmp/parse.rs      the checksum-validated ICMP parse
  userland/capsule_net_ip/src/icmp/echo.rs       echo_of, is_echo_request, build_reply
  userland/capsule_net_ip/src/icmp/build.rs      the generic ICMP writer and its seal
  userland/capsule_net_ip/src/icmp/responder.rs  try_reply, the ingress echo auto-responder
  userland/capsule_net_ip/src/icmp/mod.rs        the re-export of try_reply
  userland/capsule_net_ip/src/ingress.rs         the call site that absorbs an answered echo
  userland/capsule_net_ip/src/ipv4/checksum.rs   the fold and seal_at ICMP shares with IPv4
```

Every reference above is verified against those trees.
</content>
