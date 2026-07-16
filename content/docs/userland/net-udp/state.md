---
title: "The port table and receive rings"
description: "This page mirrors src/state/. It is the state the capsule owns: the port bind table, the one-owner-per-port rule, the per-bind receive ring, and the cached IP link. For the ops ..."
weight: 3
---
This page mirrors `src/state/`. It is the state the capsule owns: the port bind table, the one-owner-per-port
rule, the per-bind receive ring, and the cached IP link. For the ops that mutate this state see the
[operations](/docs/userland/net-udp/operations/) page; for the datagram machinery that fills the rings, see the
[datagram](/docs/userland/net-udp/datagram/) page.

## The shared state object

All mutable state lives behind one process-global `STATE`, a `State` struct with three fields
([`src/state/global.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L22)):

- `ip_service_port`, an `AtomicU32` holding the resolved `net.ip` service port, written once at setup and
  read on every send and drain ([`src/state/global.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L23), read through `ip_port()` at `global.rs:37`).
- `local_ipv4`, a `Mutex<[u8; 4]>` holding the cached local IPv4 the checksum path needs
  ([`src/state/global.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L24)).
- `binds`, a `Mutex<BindTable>` holding every port binding and its receive ring ([`src/state/global.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L25)).

`STATE` is a `static` constructed with a `const fn new`, so it needs no runtime initialisation and no heap
allocation to exist ([`src/state/global.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L29), `global.rs:42`). The atomic port uses `Release` on the store
at setup and `Acquire` on the load, so a reader that sees a non-zero port also sees the setup that produced
it ([`src/state/global.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L38), [`src/setup.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L43)). The two mutexes are `spin::Mutex`, held only for the
short duration of a table lookup or a ring push and pop.

## The bind table

`BindTable` is a `Vec<BindEntry>` capped at `MAX_BINDS = 64` ([`src/state/table.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L21), `table.rs:23`). It
exposes four operations, and each enforces the ownership and capacity rules that make the table safe to
share between callers:

- `insert` rejects a port that is already present with `TableError::InUse`, rejects a full table with
  `TableError::Full`, and otherwise pushes the new entry ([`src/state/table.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L40)). This is the
  one-owner-per-port rule: a second bind on a live port fails whether or not the same caller made it.
- `remove` finds the entry matching both the port and the owner pid, returning `TableError::NotFound` if
  there is none, and swap-removes it ([`src/state/table.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L51)). Because the match is on port and pid, one
  capsule cannot unbind another's port.
- `find_owned_mut` returns the entry for a given pid and port, the check send and recv use to confirm the
  caller owns the port it names ([`src/state/table.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L36)).
- `find_by_port_mut` returns the entry for a port regardless of owner, used only by the inbound router to
  find where a received datagram belongs ([`src/state/table.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L32)).

`TableError` has three variants, `InUse`, `Full`, and `NotFound` ([`src/state/table.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L62)). The handlers
collapse them to the wire errno set: bind maps `InUse` and `Full` (and, defensively, `NotFound`) to
`E_PORT_IN_USE`, and unbind maps all three to `E_NO_PORT` ([`src/server/handlers/bind.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L30),
[`src/server/handlers/unbind.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/unbind.rs#L29)).

## The bind entry and its receive ring

A `BindEntry` records the owner pid, the port, and a receive ring ([`src/state/bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/bind.rs#L23)). The ring is a
`VecDeque<UdpInbound>` bounded to `RX_RING_DEPTH = 32` entries, pre-sized to that depth at construction
([`src/state/bind.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/bind.rs#L21), `bind.rs:31`). It is deliberately small and bounded: a bind that stops draining
cannot make the capsule grow without limit.

- `push` appends a received segment unless the ring is already at depth, in which case it returns `false`
  and the segment is dropped ([`src/state/bind.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/bind.rs#L34)). This is where a full ring drops the tail datagram
  rather than blocking or growing.
- `pop` takes the oldest segment off the front, so delivery is first-in first-out ([`src/state/bind.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/bind.rs#L42)).

The inbound router pushes into the ring keyed by the parsed UDP destination port, and a full ring silently
drops the segment ([`src/server/handlers/recv/drain.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/drain.rs#L46)). A `recv` op pops from the ring keyed by the
caller's pid and port, so a caller only ever dequeues from a bind it owns
([`src/server/handlers/recv/handle.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/handle.rs#L49)).

## What the capsule does not keep

The state here is exactly the transient runtime binding and queue state a UDP transport needs and nothing
more. There is no persistence: bindings and rings live in memory and vanish with the process. There is no
peer record, no traffic log, and no datagram history beyond the 32-deep ring each live bind holds. Routing
tables, name caches, and stream state belong to other capsules; this one owns ports and queues.

## Source map

```
  userland/capsule_net_udp/src/state/global.rs   State, STATE, the atomic IP port, the two mutexes
  userland/capsule_net_udp/src/state/table.rs    BindTable, MAX_BINDS, insert/remove/find, TableError
  userland/capsule_net_udp/src/state/bind.rs     BindEntry, RX_RING_DEPTH, the push/pop ring
  userland/capsule_net_udp/src/state/mod.rs      the state re-exports
  userland/capsule_net_udp/src/setup.rs          the one-time write of ip_service_port and local_ipv4
  userland/capsule_net_udp/src/server/handlers/bind.rs, unbind.rs   the TableError-to-errno mapping
  userland/capsule_net_udp/src/server/handlers/recv/drain.rs, recv/handle.rs   the ring push and pop
```

Every reference above is verified against those trees.
