---
title: "Ethernet framing and the ARP path"
description: "This is the pillar that turns bytes into link-layer meaning."
weight: 3
---
This is the pillar that turns bytes into link-layer meaning. It mirrors `src/ethernet/` (the 14-byte
Ethernet header), `src/arp/packet/` (the 28-byte ARP packet codec), [`src/arp/handle.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs) (the inbound ARP
decision and the request/reply builders), and [`src/ingress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs) (the observer that runs on every polled
frame). The cache these paths read and write is its own pillar; see the [cache](/docs/userland/net-l2/cache/) page. For how a
built frame reaches the NIC, see the [nic-link](/docs/userland/net-l2/nic-link/) page; for the ops that call in here, see the
[operations](/docs/userland/net-l2/operations/) page.

## The Ethernet header

An Ethernet header is 14 bytes: a 6-byte destination MAC, a 6-byte source MAC, and a 2-byte big-endian
ethertype ([`src/ethernet/frame.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ethernet/frame.rs#L19), `frame.rs:22`). `EthHeader::parse` refuses a buffer shorter than 14
bytes and reads the ethertype big-endian, which is the on-wire order ([`src/ethernet/frame.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ethernet/frame.rs#L29)).
`EthHeader::write` refuses a buffer shorter than 14 bytes and lays the three fields back down in wire order
([`src/ethernet/frame.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ethernet/frame.rs#L41)). `payload_of` returns the bytes after the header, or `None` if the frame is too
short to have one ([`src/ethernet/frame.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ethernet/frame.rs#L53)).

The MAC type is a plain `[u8; 6]`, the broadcast address is all-ones, and the ARP ethertype is `0x0806`
([`src/ethernet/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ethernet/types.rs#L17), `types.rs:19`, `types.rs:21`). These are the only ethertype and address
constants the capsule needs; it does not itself route by ethertype above ARP, because the protocol-class
routing decision belongs to the caller that owns it ([`src/ingress.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L18)).

## The ARP packet

An ARP-over-Ethernet-for-IPv4 packet is a fixed 28 bytes ([`src/arp/packet/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/packet/constants.rs#L17)). The codec is
strict on the fixed fields. `ArpPacket::parse` refuses a short buffer, then rejects any packet whose
hardware type is not Ethernet (1), whose protocol type is not IPv4 (`0x0800`), or whose hardware and
protocol address lengths are not 6 and 4 ([`src/arp/packet/parse.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/packet/parse.rs#L22)). Only after those gates does it read
the operation and the four address fields at their fixed offsets: sender MAC at 8, sender IP at 14, target
MAC at 18, target IP at 24 ([`src/arp/packet/parse.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/packet/parse.rs#L34)). `ArpPacket::write` lays the same fixed header
constants and the four addresses back down and refuses a short output buffer
([`src/arp/packet/write.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/packet/write.rs#L21)). The two operations are request (1) and reply (2)
([`src/arp/packet/constants.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/packet/constants.rs#L22)).

## Building a request and a reply

`build_request` produces a full broadcast ARP request frame for a target IPv4: an Ethernet header from the
interface MAC to the broadcast address with the ARP ethertype, then an ARP request naming the interface as
sender and the target IP with a zero target MAC ([`src/arp/handle.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L68)). The answer arrives later as an
inbound reply that seeds the cache ([`src/arp/handle.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L66)). `OP_ARP_RESOLVE` is what calls this, on a cache
miss, before returning `E_NO_NEIGHBOUR` ([`src/server/handlers/arp_resolve.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/arp_resolve.rs#L47)).

The reply side is built inside `on_inbound`. When an inbound request targets the interface's own IPv4, the
handler builds an Ethernet header addressed back to the requester's MAC and an ARP reply naming the interface
as sender and the original sender as target ([`src/arp/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L51)). The built frame is returned to the
caller, which hands it to the NIC client; the ARP module does not itself do IPC ([`src/arp/handle.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L62)).

## The inbound decision

`on_inbound` is the whole inbound ARP policy, and it is written to be conservative about what it will learn.
It parses the payload, and returns early on a malformed packet ([`src/arp/handle.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L39)). It computes whether
the packet is solicited: either the sender IP is one this capsule has an outstanding request for, or the
packet is a request that directly targets the interface's own IP ([`src/arp/handle.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L40)). It then runs the
learn decision against the cache's current binding for that sender and applies it: refresh a matching
binding, reject a MAC rebind, and insert a new binding only when the packet was solicited
([`src/arp/handle.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L42)). The learn policy itself lives in the [cache](/docs/userland/net-l2/cache/) pillar
([`src/arp/cache/learn.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/cache/learn.rs#L24)). Finally, only if the packet is a request for the interface's own IP does it
build and return a reply; every other packet returns `None` ([`src/arp/handle.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L48)).

The security value of this shape is that an unsolicited gratuitous ARP for an address the capsule never
asked about cannot plant a fresh binding, and a packet claiming a MAC that conflicts with an existing binding
cannot silently take it over. The `Iface` the decision reads, the interface MAC and IPv4, is snapshotted from
capsule state under its locks before the decision runs ([`src/ingress.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L38), [`src/arp/handle.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L21)).

## The ingress observer

Every frame the capsule polls up from the NIC passes through `ingress::observe` before it is delivered to the
upstream consumer ([`src/server/handlers/poll_frame.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_frame.rs#L50)). The observer parses the Ethernet header, drops
anything that is not the ARP ethertype, splits off the payload, and runs it through `on_inbound`
([`src/ingress.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L28)). If `on_inbound` returned a reply frame and a NIC is bound, it sends the reply back
through the NIC client ([`src/ingress.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L43)). This is the only stateful side effect on the inbound path: ARP
learning and reply emission happen here so the upstream IP consumer never has to know what an ARP packet
looks like ([`src/ingress.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L17)). Non-ARP frames pass through untouched and are delivered up to `net.ip`.

## Source map

```
  userland/capsule_net_l2/src/ethernet/frame.rs        EthHeader parse/write, payload_of, HDR_LEN
  userland/capsule_net_l2/src/ethernet/types.rs        MacAddress, MAC_BROADCAST, ETHERTYPE_ARP
  userland/capsule_net_l2/src/arp/packet/constants.rs  PACKET_LEN and the fixed header constants
  userland/capsule_net_l2/src/arp/packet/packet_type.rs  the ArpPacket struct
  userland/capsule_net_l2/src/arp/packet/parse.rs      ArpPacket::parse with the fixed-field gates
  userland/capsule_net_l2/src/arp/packet/write.rs      ArpPacket::write
  userland/capsule_net_l2/src/arp/handle.rs            on_inbound, build_request, and the reply builder
  userland/capsule_net_l2/src/ingress.rs               observe: parse, learn, and reply emission
  userland/capsule_net_l2/src/server/handlers/arp_resolve.rs  the resolve op that calls build_request
  userland/capsule_net_l2/src/server/handlers/poll_frame.rs   the poll path that calls observe
```

Every reference above is verified against those trees.
</content>
