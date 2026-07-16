---
title: "The datagram engine and the net.ip client"
description: "This page mirrors src/udp/ (the UDP header parse and build and the RFC 768 checksum), src/ipclient/ (the IPC client that talks to the IP capsule), and src/setup.rs (bring-up)."
weight: 2
---
This page mirrors `src/udp/` (the UDP header parse and build and the RFC 768 checksum), `src/ip_client/`
(the IPC client that talks to the IP capsule), and [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) (bring-up). It is the machinery a
`send` or `recv` op reaches after the server has parsed and dispatched a request. For that request loop and
the op set see the [operations](/docs/userland/net-udp/operations/) page; for the port table the receive path fills, see the
[state](/docs/userland/net-udp/state/) page. For where UDP sits above IP in the stack, see the
[networking subsystem](/docs/subsystems/networking/).

## The UDP header

A UDP header is 8 bytes, and the capsule only carries the two fields it needs at the higher layer: the
source and destination ports ([`src/udp/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/header.rs#L17)). The length and checksum fields live at fixed offsets
in the wire buffer; the checksum sits at offset 6 ([`src/udp/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/header.rs#L18)). Everything else about the header
is read or written directly against the byte buffer in the build and parse paths.

## Building an outbound segment

`build` writes an 8-byte UDP header followed by the payload and seals the checksum
([`src/udp/build.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/build.rs#L38)). The total length is the 8-byte header plus the payload; a total over `u16::MAX` is
`PayloadTooLarge`, and an output buffer too small for the total is `OutputTooSmall`
([`src/udp/build.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/build.rs#L38)). The source and destination ports and the total length are written big-endian (the
wire byte order), the checksum field is zeroed, the payload is copied in, and then the checksum is computed
over the finished segment and written back into the zeroed field ([`src/udp/build.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/build.rs#L46)). The caller
supplies the source and destination IPv4 addresses in the `BuildRequest`, because the checksum is sealed
over an IPv4 pseudo-header that includes them ([`src/udp/build.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/build.rs#L20)).

## Parsing an inbound segment

`parse` validates a received segment against the caller-supplied source and destination IPv4 addresses and
returns the parsed header plus the payload slice ([`src/udp/parse.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/parse.rs#L31)). A segment shorter than the 8-byte
header is `TooShort`. The ports, the length, and the checksum are read big-endian. A length field below the
header size or beyond the received buffer is `LengthMismatch`, so a lying length field cannot make the
parser read past the buffer ([`src/udp/parse.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/parse.rs#L43)). If the wire checksum is non-zero, it is recomputed over
the pseudo-header and the segment, and a mismatch is `BadChecksum`; a wire checksum of zero is accepted
without verification, which RFC 768 reserves as "no checksum" ([`src/udp/parse.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/parse.rs#L46)). On success the
payload slice runs from the end of the header to the length the header declared, so trailing bytes past the
declared length are trimmed ([`src/udp/parse.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/parse.rs#L52)).

## The checksum

`compute` is the RFC 768 and RFC 1071 checksum: fold 16-bit words over the IPv4 pseudo-header, then the UDP
header and payload ([`src/udp/checksum.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/checksum.rs#L39)). The pseudo-header is the source and destination IPv4, a zero
byte and the protocol number 17, and the UDP length ([`src/udp/checksum.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/checksum.rs#L22), `checksum.rs:43`). Bytes are
summed as big-endian 16-bit words, with a trailing odd byte padded with a zero low byte
([`src/udp/checksum.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/checksum.rs#L28)). The 32-bit running sum is folded down to 16 bits by adding the carries back in
until none remain, then complemented ([`src/udp/checksum.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/checksum.rs#L46)). A computed zero is returned as `0xFFFF`,
which is the RFC rule that lets a zero wire value mean "no checksum" without ambiguity
([`src/udp/checksum.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/checksum.rs#L49)). The pseudo-header bytes are summed field by field on the stack, never assembled
into a heap buffer, so no caller data escapes the function.

## The net.ip client

UDP has no NIC. Every byte it sends or receives crosses IPC to the IP capsule, `net.ip`, and
`src/ip_client/` is that client. It speaks the same 20-byte v1 request envelope every userland network
service uses, distinguished by the magic `NIP4` = `0x4E49_5034` and version 1 ([`src/ip_client/wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L21)).
Three IP opcodes matter to UDP: `OP_GET_CONFIG = 2`, `OP_SEND_PACKET = 4`, and `OP_POLL_PACKET = 5`
([`src/ip_client/wire.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L25)), and the IP protocol byte for UDP is 17 ([`src/ip_client/wire.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L29)).

`write_request` and `parse_response` are the envelope codec: they write the magic, version, op, request id,
and payload length little-endian, and read the op, errno, request id, and payload length back out, rejecting
a wrong magic or version by returning `None` ([`src/ip_client/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/header.rs#L19), `header.rs:33`). Request ids
come from a monotonic sequence counter that starts at 1 and skips zero on wraparound, so a reply can be
matched and a zero id is never minted ([`src/ip_client/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/seq.rs#L21)).

- `read_ipv4` issues `OP_GET_CONFIG` and pulls the interface config back, extracting the 4-byte local IPv4
  from the response body (a 6-byte MAC, then the IPv4, then prefix, gateway, and MTU)
  ([`src/ip_client/config.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/config.rs#L35)). A negative transport result is `SendFailed`; a malformed or wrong-op
  response is `BadResponse`; a non-zero IP errno is `Refused` ([`src/ip_client/config.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/config.rs#L41)). UDP needs the
  local IPv4 to seal the checksum pseudo-header on outbound segments.
- `send_segment` issues `OP_SEND_PACKET` with a body of the 4-byte destination IPv4, the protocol byte 17,
  and the UDP segment, and treats a transport error, a malformed reply, or a non-zero IP errno as a failure
  ([`src/ip_client/send.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/send.rs#L34)). The IP capsule owns the routing and the actual transmit.
- `poll_segment` issues `OP_POLL_PACKET` with the protocol byte 17 as its body and reads back one queued
  inbound packet: source IPv4, destination IPv4, the protocol byte, then the UDP segment
  ([`src/ip_client/recv/poll.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv/poll.rs#L28)). It maps the IP errno set to a typed error: 0 is a delivered segment, 8
  is `NoConfig`, 10 is `Empty`, and anything else is `Other` ([`src/ip_client/recv/poll.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv/poll.rs#L50)). It bounds
  the declared payload length against the received buffer before it reads the body, so a lying length cannot
  overrun (`poll.rs:44`), and it rejects a body whose protocol byte is not 17 as `NotUdp` (`poll.rs:64`).
  The parsed result is a `UdpInbound` carrying the source and destination IPv4 and the owned segment bytes
  ([`src/ip_client/recv/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv/types.rs#L21)), capped at a 1500-byte packet ([`recv/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/recv/types.rs#L19)).

## How send and recv wire these together

On `send`, the handler resolves the source IPv4 (from the cached value, or by a live `read_ipv4` if the
cache is empty), calls `build` to frame the segment, and calls `send_segment` to ship it to `net.ip`; a
build error or an IP failure becomes `E_BAD_LEN` or `E_NO_IP_LINK` ([`src/server/handlers/send.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L50)). On
`recv`, when the bind's ring is empty, the handler calls `drain_one`, which polls one segment from `net.ip`,
parses its destination port, and pushes it into the matching bind's ring; failures are swallowed so the next
recv tick retries ([`src/server/handlers/recv/drain.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/drain.rs#L24)). Delivery then reparses the stored segment and
writes the source IPv4, source port, and payload into the reply ([`src/server/handlers/recv/deliver.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/deliver.rs#L26)).

## Bring-up

`setup::run` is the whole bring-up. It resolves `net.ip` through `mk_service_lookup`, stores the returned
service port in shared state, and pulls the local IPv4 once with `read_ipv4`, caching it so the data path
does not repeat the round-trip ([`src/setup.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L36)). A failed lookup is `IpNotFound`; a failed config read is
`IpConfigFailed` ([`src/setup.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L40)). `_start` calls setup in a retry loop, yielding between attempts until
it succeeds, so the capsule waits for `net.ip` to come up rather than failing outright
([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). Only after setup succeeds does the server loop start.

## Source map

```
  userland/capsule_net_udp/src/udp/header.rs       UdpHeader, HDR_LEN, CHECKSUM_OFFSET
  userland/capsule_net_udp/src/udp/build.rs        build: write header + payload, seal checksum
  userland/capsule_net_udp/src/udp/parse.rs        parse: validate length and checksum, return header + payload
  userland/capsule_net_udp/src/udp/checksum.rs     compute: RFC 768/1071 pseudo-header checksum
  userland/capsule_net_udp/src/ip_client/wire.rs   NIP4 magic, version, the three IP opcodes, protocol 17
  userland/capsule_net_udp/src/ip_client/header.rs write_request / parse_response envelope codec
  userland/capsule_net_udp/src/ip_client/seq.rs    the monotonic request-id counter
  userland/capsule_net_udp/src/ip_client/config.rs read_ipv4: OP_GET_CONFIG, extract local IPv4
  userland/capsule_net_udp/src/ip_client/send.rs   send_segment: OP_SEND_PACKET
  userland/capsule_net_udp/src/ip_client/recv/poll.rs   poll_segment: OP_POLL_PACKET, errno map, bounds
  userland/capsule_net_udp/src/ip_client/recv/types.rs  UdpInbound and RecvError
  userland/capsule_net_udp/src/setup.rs            resolve net.ip and cache port + local IPv4
  userland/capsule_net_udp/src/server/handlers/send.rs           the send wiring
  userland/capsule_net_udp/src/server/handlers/recv/drain.rs     the poll-and-route path
  userland/capsule_net_udp/src/server/handlers/recv/deliver.rs   the recv reply framing
```

Every reference above is verified against those trees.
