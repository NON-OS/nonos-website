---
title: "The interface and state"
description: "This page mirrors src/iface/, src/state.rs, src/handles.rs, and src/udpports.rs."
weight: 5
---
This page mirrors `src/iface/`, [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs), [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs), and [`src/udp_ports.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs). It documents how
the smoltcp `Interface` is built over the [device](/docs/userland/net-core/device/) bridge, the poll loop that advances it, the
DHCPv4 client that acquires an address and installs the DNS socket, and the shared state and per-client
socket tables every [server](/docs/userland/net-core/server/) handler works against. For the ops that drive these sockets, read
the [server](/docs/userland/net-core/server/) page.

## Building the interface

`build::build` constructs the smoltcp state from the MAC and the driver port
([`src/iface/build.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/build.rs#L26)). It draws an 8-byte random seed through `crypto_random`, which is the one use of
the capsule's `Crypto` capability, and fails the build if the draw is short
([`src/iface/build.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/build.rs#L27), [README](/docs/userland/net-core/)). It configures a smoltcp `Config` with the Ethernet address
and that seed, builds the `Interface` at the current millisecond clock over a fresh `NicDevice`, creates an
empty `SocketSet`, and adds the DHCPv4 socket ([`src/iface/build.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/build.rs#L33)). The result is a `NetState` with the
interface, the socket set, the device, the DHCP handle, and an empty DNS handle slot
([`src/iface/build.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/build.rs#L43)). `setup::run` stores it into the global ([`src/setup.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L54)).

## The shared state

`NetState` bundles the four things that must be advanced together: the `Interface`, the `SocketSet`, the
`NicDevice`, the DHCP socket handle, and the optional DNS socket handle ([`src/state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L21)). It lives behind
one `spin::Mutex` in a `static`, `NET` ([`src/state.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L34)). Because the capsule has a single execution
context and this mutex is the only access gate, `NetState` is marked `Send` with that reasoning stated at
the `unsafe impl` ([`src/state.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L29)).

Three accessors take the lock and hand a closure the pieces it needs, so no handler holds the raw guard:
`with_iface` for the interface, socket set, and device; `with_dns` for the interface, socket set, and the
DNS handle if one is installed; and `with_dhcp_and_dns_slot` for the DHCP path that also fills the DNS slot
([`src/state.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L67)). The DHCP lease is a separate `Lease` behind its own mutex, read through `lease` and
written through `set_lease` ([`src/state.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L36)).

## The poll loop

`poll::pump` is the single advance step, called at the top of every server iteration and again while the DNS
handler waits ([`src/iface/poll.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/poll.rs#L23), [server](/docs/userland/net-core/server/)). It locks the state, polls the smoltcp interface
at the current clock so smoltcp exchanges frames with the device and services every socket, then processes
one DHCP event ([`src/iface/poll.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/poll.rs#L24)). The interface poll is where the [device](/docs/userland/net-core/device/) bridge's
`receive` and `transmit` are actually driven.

## The DHCPv4 client

`dhcp::create` adds the DHCPv4 socket to the set at build time ([`src/iface/dhcp.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L24)). `dhcp::poll_event`
drains one event per pump ([`src/iface/dhcp.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L28)):

- On `Configured`, it installs the leased address as the interface's IP, adds the router as the default IPv4
  route, records the lease (address, prefix, gateway, DNS, bound) in the shared state, installs a DNS socket
  pointed at the leased DNS server, and emits two boot markers ([`src/iface/dhcp.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L32)).
- On `Deconfigured`, it clears the interface addresses, removes the default route, and clears the lease
  ([`src/iface/dhcp.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L49)).

The address marker is `[NET-CORE] lease <ip>/<prefix> gw <gw>` ([`src/iface/dhcp.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L65)); the self-check
marker re-encodes the 18-byte lease body the [server](/docs/userland/net-core/server/)'s `dhcp_status` returns and prints
`[NET-CORE] lease-status state=<n> ip=<ip>`, so the DHCP path and the query path are checked against the
same encoder ([`src/iface/dhcp.rs:102`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L102)). The DNS socket installed here is what the DNS handler queries; before
a lease arrives there is no DNS socket and the handler returns `E_NO_LEASE` ([server](/docs/userland/net-core/server/)).

## The per-client socket tables

Two tables scope sockets to the client that opened them, so one capsule cannot touch another's connections.

- The TCP table `handles` is a 32-slot array of `(owner_pid, SocketHandle)` behind a mutex
  ([`src/handles.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L20)). `alloc` returns the first free index as the opaque app handle, `get` returns the
  smoltcp handle only when the requesting pid matches the recorded owner, and `free` clears a slot only for
  its owner ([`src/handles.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L24)). Every TCP handler resolves its handle through `get`, so a stolen or
  forged app handle answers `E_NO_SOCKET` ([server](/docs/userland/net-core/server/)).
- The UDP table `udp_ports` is a 16-slot array of `(owner_pid, local_port, SocketHandle)`
  ([`src/udp_ports.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs#L20)). It is keyed on the pid and the local port rather than an opaque handle: `insert`
  adds a binding, `get` finds the socket for a pid and port, and `remove` clears it
  ([`src/udp_ports.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs#L32)). This is why UDP ops carry the local port in their payload rather than a handle
  ([protocol](/docs/userland/net-core/protocol/)).

Both tables are fixed-size arrays, so a client cannot exhaust the capsule's memory by opening sockets; a
full table answers `E_NO_SOCKET` at connect or bind ([server](/docs/userland/net-core/server/)).

## Source map

```
  userland/capsule_net_core/src/iface/mod.rs    the iface module surface
  userland/capsule_net_core/src/iface/build.rs  the random seed, Config, Interface, and initial sockets
  userland/capsule_net_core/src/iface/poll.rs   the single pump: interface poll then DHCP event
  userland/capsule_net_core/src/iface/dhcp.rs   the DHCPv4 client, the DNS install, and the lease markers
  userland/capsule_net_core/src/state.rs        NetState, the mutex, the accessors, and the Lease
  userland/capsule_net_core/src/handles.rs      the 32-slot per-pid TCP socket table
  userland/capsule_net_core/src/udp_ports.rs    the 16-slot per-pid UDP socket table keyed by local port
  userland/capsule_net_core/src/setup.rs        where the built NetState is stored into the global
```

Every reference above is verified against those trees.
