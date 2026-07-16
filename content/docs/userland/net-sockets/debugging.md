---
title: "Debugging net_sockets"
description: "This page lists the boot marker the capsule's spawn path emits, the discovery-retry behaviour, and the concrete runtime failure modes with where to look for each."
weight: 7
---
This page lists the boot marker the capsule's spawn path emits, the discovery-retry behaviour, and the
concrete runtime failure modes with where to look for each. For the shape of the capsule read the
[README](/docs/userland/net-sockets/), the [operations](/docs/userland/net-sockets/operations/), [handles](/docs/userland/net-sockets/handles/), [transports](/docs/userland/net-sockets/transports/),
and [state](/docs/userland/net-sockets/state/) pages.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[NET-SOCKETS] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-SOCKETS`
([`src/userspace/init/spawn_plan/network/spawn_sockets.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_sockets.rs#L22)), whose `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). An absent line
means the capsule never started, usually a signature, manifest, or capability failure; the `Err` arm prints
an `[ERROR]` line instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The spawn is feature-gated on
`nonos-capsule-net-sockets`, so an image built without that feature will not print the line at all
([`src/userspace/init/spawn_plan/network/spawn_sockets.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_sockets.rs#L18)).

## Discovery and the retry loop

Like the transport capsules, `net_sockets` does not exit when bring-up stalls. The only exit is code 1, for
a heap init failure, before discovery even runs ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). After that, `wait_for_setup` calls
`state::discover` in a loop, yielding sixty-four times between attempts, and only enters the server once
discovery returns `Ok` ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). So a capsule that spawned but is not answering has almost always
not finished discovery. Discovery fails, and retries, whenever the `net.tcp` or `net.udp` lookup fails or
reports port zero, because both are mandatory ([`src/state.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L46), [`src/state.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L52)); `net.nym` is optional
and its absence does not block discovery ([`src/state.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L48)).

The common case in a live boot is that the sockets capsule spawns before `net.tcp` and `net.udp` have
registered, so its early `discover` attempts fail and it retries until both services are up. This is
expected, not an error to chase; the capsule recovers on its own. If it never recovers, the problem is
downstream: check that `net.tcp` and `net.udp` printed their own spawn markers and finished their own
bring-up first, since `net.sockets` cannot dispatch to a transport that never registered.

## Runtime failure modes

After discovery succeeds, failures surface as errno words in the reply, not exit codes. The full errno set
is on the [operations](/docs/userland/net-sockets/operations/) page.

### Socket or accept returns E_TABLE_FULL

`OP_SOCKET` and `OP_ACCEPT` both open a slot in the fixed 256-entry table, and both reply `E_TABLE_FULL`
when it is exhausted ([`src/server/handlers/socket.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L41), [`src/server/handlers/accept.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept.rs#L37)). On a healthy
system this means a client is leaking sockets: it opened handles without calling `OP_CLOSE`, which is what
frees a slot ([`src/sockets/table/close.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/close.rs#L28)). The table is global across callers but keyed per pid, so
one leaking caller can fill it for everyone; the fix is on the client, closing handles it is done with.

### An op returns E_NO_HANDLE

Every handle-taking op replies `E_NO_HANDLE` when no table slot matches both the request handle and the
caller's attested pid ([`src/sockets/table/lookup.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/lookup.rs#L29)). Three things produce it: a handle the caller never
owned, a handle from another caller (the pid half will not match), and a handle whose socket was already
closed (the slot is gone). Because the handle counter is monotonic and never reused within a boot
([`src/sockets/table/open.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/open.rs#L25)), a stale handle after close reliably misses rather than aliasing a live
socket, so `E_NO_HANDLE` after a close is the expected "this socket is gone" signal.

### An op returns E_NO_TRANSPORT

`E_NO_TRANSPORT` is the catch-all for a backend that refused, is unreachable, or was never discovered
([`src/server/handlers/send.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L46), [`src/server/handlers/connect.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L41)). It appears when a `connect`,
`listen`, `accept`, `send`, `recv`, or `close` call into `net.tcp`, `net.udp`, or `net.nym` returns an
error, which the shared envelope collapses from the backend's own errno into a single failure word
([`src/clients/envelope.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/envelope.rs#L29), [`src/clients/envelope.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/envelope.rs#L51)). For a mixnet socket it also covers the case
where `net.nym` was never registered, so `state::nym()` returns zero ([`src/server/handlers/connect.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L60),
[`src/server/handlers/setsockopt.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/setsockopt.rs#L63)). When chasing it, look one layer down: the sockets capsule does not
carry the backend's reason, so the real cause is in the transport capsule's own logs and errno.

### Listen returns E_NOT_BOUND

`OP_LISTEN` replies `E_NOT_BOUND` when the socket is not a bound `Stream` socket
([`src/server/handlers/listen.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L33)). It is the ordering guard: a client must `OP_BIND` the stream socket to
a local port before `OP_LISTEN`, because listen reads the bound port to pass to `net.tcp`
([`src/server/handlers/listen.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/listen.rs#L35)). A datagram socket never satisfies this arm, since the bound check also
requires `Kind::Stream`.

### Send or recv returns E_NOT_CONNECTED

`OP_SEND` and `OP_RECV` reply `E_NOT_CONNECTED` when the socket has no usable transport state for its kind:
a stream or mixnet socket whose `transport_handle` is still zero, or a datagram socket missing a local or
remote address ([`src/server/handlers/send.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L52), [`src/server/handlers/recv.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L54)). It is the "you have a
handle but never connected it" case: the client created the socket but skipped the `OP_CONNECT` (or, for a
datagram, the `OP_BIND` and the connect that records the remote) that would have given the socket something
to send over.

### Socket returns E_BAD_FAMILY or E_BAD_KIND

`OP_SOCKET` replies `E_BAD_FAMILY` for any family other than 4 and `E_BAD_KIND` for any kind other than 1,
2, or 3 ([`src/server/handlers/socket.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L26), [`src/server/handlers/socket.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L33)). The capsule is IPv4-only
and knows exactly three kinds, stream, datagram, and mixnet; a client asking for anything else is rejected
at creation before any table slot is spent.

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_sockets.rs  the NET-SOCKETS spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs                  the capsule-spawned / error boot markers
  userland/capsule_net_sockets/src/main.rs                the heap-exit code and the discovery retry loop
  userland/capsule_net_sockets/src/state.rs               the mandatory tcp/udp and optional nym discovery
  userland/capsule_net_sockets/src/sockets/table/lookup.rs  the (pid, handle) match behind E_NO_HANDLE
  userland/capsule_net_sockets/src/sockets/table/close.rs   the slot free behind a stale-handle miss
  userland/capsule_net_sockets/src/clients/envelope.rs      the backend-error collapse behind E_NO_TRANSPORT
  userland/capsule_net_sockets/src/server/handlers/socket.rs   the E_TABLE_FULL / E_BAD_FAMILY / E_BAD_KIND cases
  userland/capsule_net_sockets/src/server/handlers/listen.rs   the E_NOT_BOUND guard
  userland/capsule_net_sockets/src/server/handlers/send.rs, recv.rs  the E_NOT_CONNECTED / E_NO_TRANSPORT cases
  userland/capsule_net_sockets/src/server/handlers/connect.rs, setsockopt.rs  the zero-nym-port E_NO_TRANSPORT
```

Every reference above is verified against those trees.
