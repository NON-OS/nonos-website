---
title: "Address, Names, and Anonymity"
description: "A network host needs an address, a way to resolve names, and, in NØNOS, an optional anonymity overlay."
weight: 4
---
A network host needs an address, a way to resolve names, and, in NØNOS, an optional anonymity overlay.
DHCP obtains the address, DNS resolves names, and the `nym` capsule provides a mixnet path. This page
documents those three. The code is under `userland/capsule_net_core/src/iface/` and
`src/userspace/capsule_net_nym/`.

## DHCP

`net_core` obtains its IPv4 address by DHCP, using smoltcp's DHCP socket
([`userland/capsule_net_core/src/iface/dhcp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_core/src/iface/dhcp.rs)). On bring-up the stack starts a DHCP client, which
discovers a server, requests a lease, and installs the assigned address, gateway, and DNS server into
the interface. This is the piece that was proven at runtime: on a desktop-GUI boot the stack completes
driver setup and reaches a bound lease, `DHCP BOUND 10.0.2.15` under QEMU's user network, which is the
end-to-end evidence that the driver capsule, the frame path, the smoltcp interface, and the DHCP client
all work together. The lease is renewed by the same client as it ages.

## DNS

Name resolution is a DNS resolver in `net_core` ([`src/protocol/dns.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/dns.rs)), using the DNS server the DHCP
lease provided. A client asks the [sockets service](/docs/subsystems/networking/sockets/) or `net_core` to resolve a name, and
the resolver issues a DNS query over UDP through the same stack and returns the address. Because the
resolver runs in the network capsule, name resolution is subject to the same capability boundary as the
rest of the stack: a capsule that cannot reach the network cannot resolve names either.

## The nym overlay

`nym` (`src/userspace/capsule_net_nym/`) is an optional anonymity overlay capsule. Where the base stack
carries traffic directly, the nym capsule routes it through a mixnet so the correspondence between a
capsule's traffic and its destination is obscured. It is a separate capsule layered alongside the
stack rather than a change to it, so it is present when the build includes it and absent otherwise,
and traffic that does not use it takes the direct path. Documenting it honestly: it is the anonymity
option in the network stack, distinct from the base IP path, and a capsule that wants anonymity routes
through it.

## Source

```
  userland/capsule_net_core/src/iface/dhcp.rs    the DHCP client
  userland/capsule_net_core/src/protocol/dns.rs   the DNS resolver
  src/userspace/capsule_net_nym/                  the anonymity overlay capsule
```
