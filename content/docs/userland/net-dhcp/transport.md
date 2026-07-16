---
title: "The L2 and IP clients"
description: "This page mirrors src/l2client/ (the raw-frame client that talks to the L2 capsule) and src/ipclient/ (the client that installs the lease into the IP capsule)."
weight: 3
---
This page mirrors `src/l2_client/` (the raw-frame client that talks to the L2 capsule) and `src/ip_client/`
(the client that installs the lease into the IP capsule). It is the IPC machinery the acquisition ladder
reaches to move BOOTP on the wire and to hand an accepted lease to the IP layer. For the ladder that drives
these clients see the [lease](/docs/userland/net-dhcp/lease/) page; for the frames they carry see the [framing](/docs/userland/net-dhcp/framing/) page.
For where these layers sit in the stack, see the [networking subsystem](/docs/subsystems/networking/).

## Why L2, not UDP

DHCP has no IPv4 address of its own until the server grants one, so it cannot use the normal UDP path that
assumes a configured interface. Instead it sends and receives raw broadcast ethernet frames through the L2
capsule, `net.l2`, and only after the lease is acknowledged does it install the address into the IP capsule,
`net.ip`. The L2 client is `src/l2_client/`; the IP client is `src/ip_client/`.

## The net.l2 client

`src/l2_client/` speaks the `net.l2` v1 request envelope, a 20-byte header distinguished by the magic
`NL2\0` = `0x4E4C_3200` and version 1 ([`src/l2_client/wire.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/wire.rs#L22)). Four L2 opcodes matter to DHCP:
`OP_GET_MAC = 2`, `OP_SEND_FRAME = 4`, `OP_POLL_FRAME = 5`, and `OP_SET_IP = 7`
([`src/l2_client/wire.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/wire.rs#L26)).

`write_request` and `parse_response` are the envelope codec: they write the magic, version, op, request id,
and payload length little-endian, and read the op, errno, request id, and payload length back out, rejecting a
wrong magic or version by returning `None` ([`src/l2_client/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/header.rs#L19), `header.rs:33`). Request ids come
from a monotonic counter that starts at 1 and skips zero on wraparound, so a zero id is never minted
([`src/l2_client/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/seq.rs#L21)).

- `read_mac` issues `OP_GET_MAC` and reads the 6-byte NIC MAC back, which DHCP needs to stamp the BOOTP
  `chaddr` and the source MAC of every outgoing frame. A negative transport result is `SendFailed`, a wrong op
  or non-zero errno is `L2Refused`, and a body that is not exactly 6 bytes is `BadResponse`
  ([`src/l2_client/mac.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/mac.rs#L33)).
- `send_frame` issues `OP_SEND_FRAME` with a fully-built ethernet frame as its body and treats a transport
  error, a malformed reply, a wrong op, or a non-zero L2 errno as a failure; the L2 capsule does no further
  header work and ships the frame verbatim ([`src/l2_client/tx.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/tx.rs#L35)).
- `poll_frame` issues `OP_POLL_FRAME` and reads back one queued inbound frame, mapping the L2 errno set to a
  typed error: errno 8 is `Empty`, errno 5 is `NoLink`, anything else non-zero is `Other`, and a delivered
  frame is returned as an owned `Vec` ([`src/l2_client/rx.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/rx.rs#L42)). It bounds the declared payload length against
  the received buffer before it reads the body, so a lying length cannot overrun (`rx.rs:64`), and the receive
  buffer is capped at a 1514-byte frame (`rx.rs:26`).
- `set_ip` issues `OP_SET_IP` with the 4-byte leased IPv4 as its body, so `net.l2` can source ARP from a real
  address and answer ARP for the host; it is best effort, called after the lease is already installed in
  `net.ip` ([`src/l2_client/set_ip.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/set_ip.rs#L36)).

## The net.ip client

`src/ip_client/` speaks the `net.ip` v1 request envelope, a 20-byte header distinguished by the magic
`NIP4` = `0x4E49_5034` and version 1 ([`src/ip_client/wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L21)). DHCP only ever issues one IP opcode,
`OP_SET_CONFIG = 3`; every other `net.ip` op is for upper transport capsules ([`src/ip_client/wire.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/wire.rs#L25)).
The envelope codec and the monotonic request-id counter mirror the L2 client's ([`src/ip_client/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/header.rs#L19),
[`src/ip_client/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/seq.rs#L21)).

- `apply_lease` issues `OP_SET_CONFIG` with a 9-byte body that matches the IP capsule's set-config handler
  exactly: 4-byte IPv4, 1-byte prefix, 4-byte gateway ([`src/ip_client/set_config.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/set_config.rs#L34)). A negative transport
  result is `SendFailed`, a malformed or wrong-op reply is `BadResponse`, and a non-zero IP errno is `Refused`
  (`set_config.rs:49`). This is the single call that mutates the interface, and it runs only after a lease is
  acknowledged.
- `clear_lease` calls `apply_lease` with an all-zero body, bringing the interface back to unconfigured; after
  it, `net.ip` refuses any send until the next lease lands ([`src/ip_client/set_config.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/set_config.rs#L65)). Release uses it
  to tear down the interface.

## How the ladder wires these together

On acquisition, `send_bootp` calls `send_frame` to ship each DISCOVER and REQUEST, `wait_for` calls
`poll_frame` to drain and filter inbound frames, `install` calls `apply_lease` to push the ACK into `net.ip`,
and `acquire` calls `set_ip` to announce the address to `net.l2` ([`src/dora/send_bootp.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/send_bootp.rs#L49),
[`src/dora/wait_reply.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/wait_reply.rs#L43), [`src/dora/install.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/install.rs#L33), [`src/dora/acquire.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L45)). On release, the handler
calls `release` (which sends through `send_frame`) and then `clear_lease` ([`src/server/handlers/lease_release.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_release.rs#L42),
`lease_release.rs:44`).

## Security posture at this boundary

Both clients are pure IPC clients: they hold no device, no MMIO, and no DMA, only the `Network` and `IPC`
rights the mask grants ([`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), decoded on the [README](/docs/userland/net-dhcp/)). Every reply is
validated for magic, version, and op before its body is trusted, and a wrong op is a `BadResponse` rather than
a silent accept ([`src/l2_client/tx.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/tx.rs#L47), [`src/ip_client/set_config.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/set_config.rs#L53)). The inbound `poll_frame` path
bounds the wire-declared length against the received buffer before reading ([`src/l2_client/rx.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/rx.rs#L64)). The lone
mutation of interface state, `OP_SET_CONFIG`, is reached only from the ACK-install path, so the L2 and IP
clients cannot reconfigure the interface on a rejected lease.

## Source map

```
  userland/capsule_net_dhcp/src/l2_client/wire.rs      NL2 magic, version, OP_GET_MAC/SEND_FRAME/POLL_FRAME/SET_IP
  userland/capsule_net_dhcp/src/l2_client/header.rs    write_request / parse_response envelope codec
  userland/capsule_net_dhcp/src/l2_client/seq.rs       the monotonic request-id counter
  userland/capsule_net_dhcp/src/l2_client/mac.rs       read_mac: OP_GET_MAC
  userland/capsule_net_dhcp/src/l2_client/tx.rs        send_frame: OP_SEND_FRAME
  userland/capsule_net_dhcp/src/l2_client/rx.rs        poll_frame: OP_POLL_FRAME, errno map, length bound
  userland/capsule_net_dhcp/src/l2_client/set_ip.rs    set_ip: OP_SET_IP
  userland/capsule_net_dhcp/src/ip_client/wire.rs      NIP4 magic, version, OP_SET_CONFIG
  userland/capsule_net_dhcp/src/ip_client/header.rs    the net.ip envelope codec
  userland/capsule_net_dhcp/src/ip_client/set_config.rs apply_lease / clear_lease: OP_SET_CONFIG
  userland/capsule_net_dhcp/src/dora/send_bootp.rs, wait_reply.rs, install.rs, acquire.rs   the ladder wiring
  userland/capsule_net_dhcp/src/server/handlers/lease_release.rs   the release wiring
  src/capabilities/types.rs                            the Network and IPC bits behind the mask
```

Every reference above is verified against those trees.
