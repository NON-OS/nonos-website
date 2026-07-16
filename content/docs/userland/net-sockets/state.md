---
title: "Bring-up and process state"
description: "This page mirrors src/state.rs and src/main.rs."
weight: 5
---
This page mirrors [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) and [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs). It covers the small amount of process-global state the
capsule holds outside the socket table: the entry point, the discovery-retry loop that waits for the
transport capsules, and the cached service ports the handlers dispatch against. For the socket table
itself, read the [handles](/docs/userland/net-sockets/handles/) page; for how those ports are used, read the
[transports](/docs/userland/net-sockets/transports/) page.

## The entry point

The capsule is `no_std`/`no_main`. `_start` is the raw entry: it initialises the heap, and if that fails it
exits the process with code 1, the only exit path in the capsule ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31), [`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)).
Everything after depends on a working allocator, because the request buffers, the reply bodies, and every
backend request are heap-allocated `Vec`s. With the heap up, `_start` calls `wait_for_setup` and then hands
control to `server::run`, which never returns ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)).

## The discovery retry loop

`wait_for_setup` loops calling `state::discover` until it returns `Ok`, yielding sixty-four times between
attempts ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). This is the whole of bring-up: unlike the transport capsules there is no
entropy seed or config read, only the discovery of the backends the capsule dispatches to. The loop matters
because spawn order is not guaranteed. The sockets capsule can be scheduled before `net.tcp` or `net.udp`
has registered its service, in which case the first `discover` calls fail their lookups and return an error;
the capsule yields and retries rather than exiting, so it recovers on its own once the transports are up.
It enters the server only after discovery succeeds, so no request is ever dispatched against an undiscovered
transport.

## Discovery and the cached ports

`state.rs` holds three `AtomicU32` service ports, `TCP`, `UDP`, and `NYM`, each starting at zero
([`src/state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L21)). `discover` looks up `net.tcp` and `net.udp` by name and requires both to succeed,
returning an error if either lookup fails so the retry loop keeps waiting; it looks up `net.nym`
opportunistically with `unwrap_or(0)`, storing zero when the overlay is absent
([`src/state.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L45)). The lookup helper calls `mk_service_lookup` and treats a nonzero return or a zero port
as a failure ([`src/state.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L52)). The distinction is deliberate: TCP and UDP are mandatory backends, so
their absence blocks bring-up, while Nym is optional, so its absence is a stored zero rather than a
bring-up failure.

The getters read those ports back for the handlers. `tcp()` and `udp()` are plain acquiring loads of the
values discovery stored ([`src/state.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L25), [`src/state.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L29)). `nym()` is lazier: it returns the cached
value if it is nonzero, and otherwise retries the `net.nym` lookup once and caches a nonzero result
([`src/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L33)). This lets a mixnet socket work even when Nym registered after the sockets capsule
finished discovery, without forcing the capsule to have waited on an optional overlay at bring-up. A mixnet
op that still finds `nym()` returning zero is what surfaces as `E_NO_TRANSPORT` at the handler
([`src/server/handlers/connect.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L61)).

Because these are the only process-global mutable state besides the socket table, the capsule's runtime
footprint is exactly the table, the three port words, the handle counter, and the two request buffers. It
holds no timers, no connection state, no buffered payloads, and no history across a socket's close; a
socket that is closed leaves nothing behind but a freed table slot.

## Source map

```
  userland/capsule_net_sockets/src/main.rs     _start, the heap-init exit, and the discovery retry loop
  userland/capsule_net_sockets/src/state.rs    the three cached service ports, discover, and the getters
  userland/capsule_net_sockets/src/server/handlers/connect.rs  where a zero nym port becomes E_NO_TRANSPORT
```

Every reference above is verified against those trees.
