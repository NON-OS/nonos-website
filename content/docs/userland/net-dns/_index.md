---
title: "The DNS Resolver Capsule"
description: "capsulenetdns is the NØNOS DNS resolver: a signed ring-3 capsule that turns a host name into an address."
weight: 400
---
`capsule_net_dns` is the NØNOS DNS resolver: a signed ring-3 capsule that turns a host name into an address.
It builds DNS queries, ships them over `net.udp` to a configured upstream resolver, parses the responses,
and keeps a bounded runtime answer cache. It runs entirely in userland and holds no network device. It
reaches the wire only by talking to the UDP transport capsule (`net.udp`) as an ordinary IPC client, and it
serves a small resolve protocol upstream to any client that holds the right to reach it, such as a sockets
multiplexer, a ping tool, or a wallet resolving a host. The kernel neither parses DNS, keeps resolver
configuration, nor caches names; all of that is userland code inside this capsule.

The source under `userland/capsule_net_dns/src/` is organized by concern, and this documentation mirrors
that structure so a page can be read beside the folder it describes. The capsule reads as three pillars: the
request protocol and server, the DNS query and response engine with its cache, and the UDP client that
carries queries to `net.udp`.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-dns` | `Capsule.mk:4` |
| Service handle | `net.dns` | `Capsule.mk:5`, [`src/userspace/capsule_net_dns/spawn.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dns/spawn.rs#L30) |
| Namespace | `systems.nonos.net.dns` | `Capsule.mk:10` |
| Service endpoint | `service:4450:net.dns` | `Capsule.mk:11`, `spawn.rs:31` |
| Reply endpoint | `reply:4451:endpoint.net.dns.reply` | `Capsule.mk:12`, `spawn.rs:32`, `spawn.rs:33` |
| Capability mask | `0x0003d` | `Capsule.mk:13` |
| Binary name | `net_dns` | `Capsule.mk:8`, `Cargo.toml:19` |
| Kernel mirror | `src/userspace/capsule_net_dns` | `Capsule.mk:14`, [`src/userspace/capsule_net_dns/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dns/spawn.rs) |

The service port `4450` and the reply port `4451` are the numbers the kernel binds when it spawns the
capsule (`spawn.rs:31`, `spawn.rs:33`); the reply inbox name `endpoint.net.dns.reply` is the string the
manifest carries as the reply endpoint (`Capsule.mk:12`, `spawn.rs:32`). The wire protocol magic is `NDNS`
= `0x4E44_4E53` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)).

The mask `0x0003d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec   bit()    1   types.rs:56
  0x00004  Network    bit()    4   types.rs:58
  0x00008  IPC        bit()    8   types.rs:59
  0x00010  Memory     bit()   16   types.rs:60
  0x00020  Crypto     bit()   32   types.rs:61
  -------
  0x0003d  = 1 + 4 + 8 + 16 + 32
```

Five bits, and no more. `CoreExec` lets it run as a process, `Memory` lets it map its own heap and stack,
`IPC` lets it send and receive on its endpoints, `Network` marks it a member of the network trust domain so
`net.udp` and `net.dhcp.client` will answer it, and `Crypto` grants the kernel entropy source it uses to
mint unpredictable DNS transaction ids and a random local source port ([`src/state.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L32)). It holds no
filesystem bit (64, `types.rs:62`), no driver-broker authority (`DeviceEnum`, `Driver`, `Mmio`, `Irq`,
`Dma`, `Pio`, at `types.rs:71` through `types.rs:76`), no graphics, no admin, and no debug. It never touches
a NIC. The only way it reaches the wire is by asking `net.udp`, and the only inbound surface it exposes is
the `net.dns` request server.

The kernel spawn path requests four of those five bits explicitly: `IPC | Memory | Crypto | Network`
([`src/userspace/capsule_net_dns/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dns/spawn.rs#L49)), which is `0x3c`. The `CoreExec` bit in the manifest mask is
the process-execution right every capsule carries; the spawn record names only the four service-authority
bits it adds on top. The verified spawn holds the requested set against the manifest ceiling before the ELF
is mapped, so the capsule can never run with more than the mask above.

A note on the source `README.md` at `userland/capsule_net_dns/README.md`: it is an earlier design sketch and
disagrees with the code on several points. It states `CAPSULE_REQUIRED_CAPS = 0x00018` (IPC and memory
only), but the manifest and `Capsule.mk:13` carry `0x0003d`, which additionally grants `Network` and
`Crypto`. It names the reply endpoint `endpoint.4294967370` and the kernel mirror `src/network/dns_capsule`,
where the built capsule uses `endpoint.net.dns.reply` (`Capsule.mk:12`) and the mirror is
`src/userspace/capsule_net_dns` (`Capsule.mk:14`). The values in the table above are the ones the build and
the kernel actually use; the source README is not authoritative on identity.

## The three pillars

A resolve request enters through the protocol and server (the operations page), which reaches the DNS
engine that builds the query, checks and fills the cache, and parses the response (the resolver page); the
engine reaches the wire through the UDP client that binds a port and exchanges datagrams with `net.udp`
(the transport page).

```
  client op   ->   server/protocol   ->   dns engine + cache   ->   udp_client   ->   net.udp
  NDNS IPC         decode, dispatch       build/parse/cache        NUDP IPC         UDP transport

  a cache hit answers from the engine without touching the wire;
  a miss builds a query, exchanges it over udp_client, parses the answer, and caches it.
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-dns/operations/) | `src/protocol/`, `src/server/` | The `NDNS` wire format, the request loop, the five client ops, the admin gate on control ops, the errno set, and the reply path. |
| [resolver.md](/docs/userland/net-dns/resolver/) | `src/dns/` | The DNS header, name encode and compression-safe skip, the A and AAAA query builders, the response parser, the answer cache, the resolve exchange loop, and the DHCP upstream discovery. |
| [transport.md](/docs/userland/net-dns/transport/) | `src/udp_client/`, [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | The `net.udp` IPC client (`NUDP` bind, send, recv), the local port and upstream state, and bring-up. |
| [contributing.md](/docs/userland/net-dns/contributing/) | the whole tree | Where each concern lives, how to add a client op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-dns/debugging/) | runtime | The boot marker, the setup retry loop, and the runtime errno failure modes: timeout, NXDOMAIN, SERVFAIL, invalid name, and the admin-only permission denial. |

For where DNS sits in the wider stack, see the [networking subsystem](/docs/subsystems/networking/).

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops calling `setup::run` until it
succeeds, and only then enters the request server, which loops forever ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). `setup::run`
resolves `net.udp` through the service registry, picks a random local UDP source port, binds it on `net.udp`,
caches the UDP service port, and then asks `net.dhcp.client` for the DNS server the lease carried and adopts
it as the upstream if one was provided ([`src/setup.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L30), [`src/dhcp_upstream.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp_upstream.rs#L26)); a failed setup yields
64 times and retries ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). The kernel spawns it under the network spawn plan through the
legacy per-capsule stack path, which is gated on `not(feature = "nonos-capsule-net-core")`
([`src/userspace/init/spawn_plan/network/spawn_legacy_stack.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_legacy_stack.rs#L18)), checking its signature and attestation
and holding its requested capabilities against its manifest ceiling before its ELF is mapped
([`src/userspace/capsule_net_dns/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dns/spawn.rs#L36)). A successful spawn prints `[NET-DNS] capsule spawned` on the
boot log; the [debugging](/docs/userland/net-dns/debugging/) page covers what that marker means.

Once setup succeeds the capsule is a resolver. Clients speak the small `NDNS` binary protocol over IPC to
health-check the server, to resolve an A or AAAA record, and, if they are the administrative principal, to
flush the cache or change the upstream. The capsule owns the upstream resolver config, the runtime answer
cache and its TTL expiry, and the pending query state; it does not route packets, own a datagram queue, or
persist any lookup history. It is a resolver built on top of `net.udp`, not the transport itself.

## Source map

```
  userland/capsule_net_dns/src/main.rs         _start -> setup retry -> server::run; module list
  userland/capsule_net_dns/src/protocol/       the NDNS wire format: magic, ops, errno, limits
  userland/capsule_net_dns/src/server/         the request loop, parse, respond, the admin gate, one handler per op
  userland/capsule_net_dns/src/dns/            the DNS header, name, query builder, response parser, and answer cache
  userland/capsule_net_dns/src/udp_client/     the net.udp IPC client: bind, send, recv, and the NUDP header codec
  userland/capsule_net_dns/src/dhcp_upstream/  ask net.dhcp.client for the lease DNS server and adopt it
  userland/capsule_net_dns/src/setup.rs        resolve net.udp, pick and bind a local port, cache the port, apply DHCP upstream
  userland/capsule_net_dns/src/state.rs        the cache, the UDP port, the local port, and the upstream config
  userland/capsule_net_dns/Capsule.mk          slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_net_dns/               the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/spawn_dns.rs   the NET-DNS spawn entry
  src/capabilities/types.rs                    the capability bit values behind the mask
```

Every reference above is verified against those trees.
