---
title: "Debugging net_tcp"
description: "This page lists the boot marker the capsule's spawn path emits, the setup retry behaviour, and the concrete runtime failure modes with where to look for each."
weight: 8
---
This page lists the boot marker the capsule's spawn path emits, the setup retry behaviour, and the concrete
runtime failure modes with where to look for each. For the shape of the capsule read the [README](/docs/userland/net-tcp/),
the [operations](/docs/userland/net-tcp/operations/), [connections](/docs/userland/net-tcp/connections/), [segments](/docs/userland/net-tcp/segments/), [state](/docs/userland/net-tcp/state/),
and [ip-link](/docs/userland/net-tcp/ip-link/) pages.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[NET-TCP] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-TCP`
([`src/userspace/init/spawn_plan/network/spawn_tcp.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_tcp.rs#L21)), whose `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). An absent line means the capsule never
started, usually a signature, manifest, or capability failure; the `Err` arm prints an `[ERROR]` line
instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The spawn is feature-gated on `nonos-capsule-net-tcp`,
so an image built without that feature will not print the line at all
([`src/userspace/init/spawn_plan/network/spawn_tcp.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_tcp.rs#L18)).

## Setup and the retry loop

Unlike a driver capsule, `net_tcp` does not exit when bring-up fails. The only exit is code 1, for a heap
init failure, before setup even runs ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). After that, `wait_for_setup` calls `setup::run` in a
loop, yielding sixty-four times between attempts, and only enters the server once setup returns `Ok`
([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). So a capsule that spawned but is not answering has almost always not finished setup. The
three ways setup fails, each returned and retried rather than logged, are:

| Setup error | Cause | Where |
|---|---|---|
| `EntropyMissing` | `crypto_random` returned fewer than sixteen bytes for the ISS key | [`src/setup.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L33) |
| `IpMissing` | `net.ip` is not registered, or its lookup reported port zero | [`src/setup.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L46) |
| `ConfigMissing` | the local-config read failed, or the address came back all zero | [`src/setup.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L50) |

The common case in a live boot is `ConfigMissing` or `IpMissing`: the TCP capsule spawns before `net.ip` has
a DHCP lease, so its early setup attempts fail and it retries until the lease is bound and the config read
returns a non-zero address ([`src/setup.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L51)). This is expected, not an error to chase; the capsule recovers
on its own. If it never recovers, the problem is downstream in `net.ip` or DHCP, not here, so check that
`net.ip` printed its own spawn marker and bound a lease first.

## Runtime failure modes

After setup succeeds, failures surface as errno words in the reply, not exit codes. The errno set is on the
[operations](/docs/userland/net-tcp/operations/) page.

### Connect returns E_TIMEOUT

`OP_CONNECT` replies `E_TIMEOUT` when the SYN send fails or the connection does not reach `Established`
within the eight-second wait ([`src/server/handlers/connect/reply.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/reply.rs#L32), [`src/server/handlers/connect/wait.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/wait.rs#L25)).
On a live boot this is the "no route or no listener" case: either the peer never answered the SYN, or it
answered with a RST, which the receive path reaps so the wait simply times out. A refused connection and an
unreachable one both look like `E_TIMEOUT` here; the difference is whether a RST came back, which the
[connections](/docs/userland/net-tcp/connections/) page describes. The dead entry is removed before the reply
([`src/server/handlers/connect/reply.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/reply.rs#L33)).

### Send returns E_CLOSED, E_TIMEOUT, or E_NO_SOCKET

`OP_SEND` replies `E_NO_SOCKET` for a handle the caller does not own, `E_CLOSED` when the connection is not
`Established` (it was opened but has since half-closed or reset), and `E_TIMEOUT` when the send buffer is full
and cannot take the bytes ([`src/server/handlers/send.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L33)). The `E_TIMEOUT` case is backpressure: the peer
window or the congestion window has stalled the sender and the 64 KiB send buffer filled
([`src/state/entry.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L65), [`src/tcp/mod.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L40)). It clears once ACKs advance the window and the sender pump
drains the buffer.

### Recv returns E_RX_EMPTY or E_NO_SOCKET

`OP_RECV` drains the receive path and yields for a fixed number of tries, then replies the bytes if any
arrived, `E_NO_SOCKET` if the handle is unknown, and `E_RX_EMPTY` if the connection is live but no payload is
queued ([`src/server/handlers/recv.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L33)). `E_RX_EMPTY` is normal on an idle connection; a client polls again.
The distinction from `E_NO_SOCKET` is the ownership check at the end of the wait ([`src/server/handlers/recv.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L42)).

### Accept returns E_RX_EMPTY

`OP_ACCEPT` replies `E_RX_EMPTY` when no child handshake has completed on the listener within its wait window
([`src/server/handlers/accept.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept.rs#L40)). A child is only enqueued when the passive-open handshake reaches its
final ACK ([`src/server/tcp_rx/existing.rs:77`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L77)), so a persistent `E_RX_EMPTY` on a listener that should be
seeing traffic points at SYNs not arriving (a `net.ip` or DHCP problem) or the handshake not completing (a
checksum or sequence rejection in the receive path, which the [connections](/docs/userland/net-tcp/connections/) page covers).

### A connection silently disappears

The receive path and the retransmit scan both reap connections without a client-facing errno. A RST inside the
receive window reaps the entry ([`src/server/tcp_rx/existing.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L47)), a segment retransmitted past `MAX_RETX`
times aborts the connection ([`src/server/retransmit.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/retransmit.rs#L43), [`src/tcp/mod.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L44)), and an expired TimeWait
timer reaps it ([`src/server/tick.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L31)). After any of these, the next `OP_SEND` or `OP_RECV` on that handle
returns `E_NO_SOCKET`, which is the signal to a client that the connection is gone. The distinction between a
reset, an abort, and a clean TimeWait close is not visible on the wire; it is visible only in which path did
the reaping.

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_tcp.rs  the NET-TCP spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs              the capsule-spawned / error boot markers
  userland/capsule_net_tcp/src/main.rs                the heap-exit code and the setup retry loop
  userland/capsule_net_tcp/src/setup.rs               the three setup errors behind a stalled capsule
  userland/capsule_net_tcp/src/server/handlers/connect/reply.rs, wait.rs  the connect timeout
  userland/capsule_net_tcp/src/server/handlers/send.rs   the send E_CLOSED / E_TIMEOUT / E_NO_SOCKET
  userland/capsule_net_tcp/src/server/handlers/recv.rs   the recv E_RX_EMPTY / E_NO_SOCKET
  userland/capsule_net_tcp/src/server/handlers/accept.rs the accept E_RX_EMPTY
  userland/capsule_net_tcp/src/server/tcp_rx/existing.rs the RST reap and the accept-queue push
  userland/capsule_net_tcp/src/server/retransmit.rs      the MAX_RETX abort
  userland/capsule_net_tcp/src/server/tick.rs            the TimeWait reap
```

Every reference above is verified against those trees.
