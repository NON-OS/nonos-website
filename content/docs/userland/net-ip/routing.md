---
title: "Routing and the link client"
description: "Two concerns decide where a datagram goes and carry it there."
weight: 5
---
Two concerns decide where a datagram goes and carry it there. This page mirrors `src/route/` (the
route table that picks the next hop) and `src/l2_client/` (the client that reaches `net.l2` for MAC
address, ARP resolution, frame transmit, and frame receive). For the egress pipeline that calls both
see the [ipv4](/docs/userland/net-ip/ipv4/) page; for the ops that add and clear routes see the [operations](/docs/userland/net-ip/operations/)
page.

## The route table

A route is a network, a prefix length, and an optional gateway; a gateway of `None` means the network
is on-link ([`src/route/entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/entry.rs#L19)). The table is a fixed array of 16 optional slots behind a reader
and writer lock, allocated as a static so it needs no heap ([`src/route/table.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/table.rs#L23)). Three operations
work on it:

- `install` takes the first free slot and returns an error when all 16 are full, which the add handler
  surfaces as `E_TABLE_FULL` (`table.rs:34`, [`src/server/handlers/route_add.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/route_add.rs#L42));
- `clear` resets every slot to empty (`table.rs:45`);
- `lookup` is a longest-prefix match: it walks every slot, remembers a prefix-0 default only if nothing
  better is found, and among the routes whose masked network matches the destination it keeps the one
  with the longest prefix (`table.rs:53`).

The subnet test inside lookup is the IPv4 module's `same_subnet`, so the table and the address helpers
agree on what a `/N` match means (`table.rs:62`, [`src/ipv4/addr.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/addr.rs#L28)). The default route is seeded
automatically: `OP_SET_CONFIG` installs a prefix-0 route through the configured gateway when the
gateway is non-zero, so a freshly configured interface can reach off-link destinations without a
separate `OP_ROUTE_ADD` ([`src/server/handlers/set_config.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_config.rs#L46)). The egress path turns a lookup result
into a next hop, the gateway when there is one, otherwise the destination itself for an on-link route
([`src/egress/send.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L49)).

## The net.l2 envelope

The link client speaks the `net.l2` v1 protocol, which is a 20-byte little-endian header with its own
magic `NL2\0` and four opcodes: get MAC (2), send frame (4), poll frame (5), and ARP resolve (6)
([`src/l2_client/wire.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/wire.rs#L23)). `write_request` lays down that header for a request and `parse_response`
validates the magic and version and pulls the op, errno, request id, and payload length back out of a
reply ([`src/l2_client/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/header.rs#L19)). Every call carries a request id from a monotonic sequence counter
that skips zero on wrap ([`src/l2_client/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/seq.rs#L21)). All four calls use `mk_ipc_call`, a synchronous
request-and-reply to the L2 service port, rather than the fire-and-reply pattern the inbound server
uses ([`src/l2_client/tx.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/tx.rs#L42)).

## MAC, ARP, transmit, receive

- `read_mac` asks L2 for the NIC's hardware address at bring-up; it validates the reply op and a 6-byte
  payload length and returns the MAC, or a `MacError` on a send failure, a malformed reply, or an L2
  refusal ([`src/l2_client/mac.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/mac.rs#L30)). Setup stores this into the interface state
  ([`src/setup.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L44)).
- `arp_resolve` asks L2 to turn a next-hop IPv4 into a MAC. L2 owns the ARP cache and emits the request
  on a miss; the client maps L2 errno 6 to `NoNeighbour` and errno 5 to `NoLink`, and requires a 6-byte
  MAC payload on success ([`src/l2_client/arp.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/arp.rs#L35)). The egress path maps `NoNeighbour` to the wire
  `E_NO_NEIGHBOUR` so a caller can back off and retry while ARP completes
  ([`src/egress/send.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L57)).
- `send_frame` ships a fully-built ethernet frame, the 14-byte L2 header and all, down to L2 for
  transmit, and treats a non-zero L2 errno as a refusal ([`src/l2_client/tx.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/tx.rs#L35)). The frame must
  already carry its ethernet header, which the egress path builds before calling this
  ([`src/egress/frame.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/frame.rs#L24)).
- `poll_frame` drains one inbound frame, sizing its receive buffer to the L2 header plus a 1514-byte
  maximum frame; it maps L2 errno 8 to `Empty` and errno 5 to `NoLink`, and returns the frame bytes
  with the L2 header stripped ([`src/l2_client/rx.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/rx.rs#L40)). The poll handler calls this up to eight times
  per request and treats `Empty` as the end of the L2 ring ([`src/server/handlers/poll_packet/poll.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/poll.rs#L40)).

## Where the authority lives

Everything device-side is on the far side of this client. `net.l2` owns the NIC, the ARP cache, and the
neighbour resolution; this capsule holds no hardware, DMA, MMIO, or driver authority, only the `IPC`
bit that lets it call the L2 service (see the [README](/docs/userland/net-ip/) mask decomposition). The route table
is pure userland state with no privileged effect: it decides a next hop, and the next hop only becomes a
frame after ARP resolves and L2 accepts it. That is the seam the decomposed [network
stack](/docs/subsystems/networking/) is built on, the IP layer speaks addresses and routes,
the L2 layer speaks MACs and rings, and they meet at a frame over IPC.

## Source map

```
  userland/capsule_net_ip/src/route/entry.rs     the Route: network, prefix, optional gateway
  userland/capsule_net_ip/src/route/table.rs     the 16-slot table, install/clear/longest-prefix lookup
  userland/capsule_net_ip/src/route/mod.rs       the Route and ROUTES re-exports
  userland/capsule_net_ip/src/l2_client/wire.rs  the net.l2 v1 magic, version, and four opcodes
  userland/capsule_net_ip/src/l2_client/header.rs write_request and parse_response
  userland/capsule_net_ip/src/l2_client/seq.rs   the zero-skipping request-id counter
  userland/capsule_net_ip/src/l2_client/mac.rs   read_mac and MacError
  userland/capsule_net_ip/src/l2_client/arp.rs   arp_resolve and ArpError
  userland/capsule_net_ip/src/l2_client/tx.rs    send_frame and TxError
  userland/capsule_net_ip/src/l2_client/rx.rs    poll_frame, the 1514-byte cap, and RxError
  userland/capsule_net_ip/src/egress/send.rs     the next-hop and MAC-resolve call sites
```

Every reference above is verified against those trees.
</content>
