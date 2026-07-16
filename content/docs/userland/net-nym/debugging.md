---
title: "Debugging net_nym"
description: "This page lists the boot marker the capsule's spawn path emits, the setup retry behaviour, and the concrete runtime failure modes with where to look for each."
weight: 10
---
This page lists the boot marker the capsule's spawn path emits, the setup retry behaviour, and the concrete
runtime failure modes with where to look for each. For the shape of the capsule read the [README](/docs/userland/net-nym/),
the [operations](/docs/userland/net-nym/operations/), [packet](/docs/userland/net-nym/packet/), [mixnet](/docs/userland/net-nym/mixnet/), [directory](/docs/userland/net-nym/directory/),
[transport](/docs/userland/net-nym/transport/), and [state](/docs/userland/net-nym/state/) pages.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[NET-NYM] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-NYM`
([`src/userspace/init/spawn_plan/network/spawn_nym.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_nym.rs#L21)), whose `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). An absent line means the capsule never
started, usually a signature, manifest, or capability failure; the `Err` arm prints an `[ERROR]` line
instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The spawn is feature-gated on `nonos-capsule-net-nym`,
so an image built without that feature will not print the line at all
([`src/userspace/init/spawn_plan/network/spawn_nym.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_nym.rs#L18)).

## Setup and the retry loop

Unlike a driver capsule, `net_nym` does not exit when bring-up fails. The only exit is code 1, for a heap
init failure, before setup even runs ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). After that, `wait_for_setup` calls `setup::run` in a
loop, yielding sixty-four times between attempts, and only enters the server once setup returns `Ok`
([`src/main.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L45)). Setup does exactly one thing: it looks up `net.tcp` and stores its port, and its single
failure is `TcpMissing` when the lookup fails or returns port zero ([`src/setup.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L27)). So a capsule that
spawned but is not answering has almost always not finished setup because `net.tcp` is not registered yet.
This is expected on a live boot where `net_nym` spawns before `net.tcp`; it retries until `net.tcp` appears
and recovers on its own. If it never recovers, the problem is that `net.tcp` never spawned, so check for
`net.tcp`'s own boot marker first.

## Runtime failure modes

After setup succeeds, failures surface as errno words in the reply, not exit codes. The full errno set is on
the [operations](/docs/userland/net-nym/operations/) page. The important point for debugging is that the capsule has a strict
bring-up order, and most early errors are just steps not yet done rather than faults.

### Open returns E_NO_GATEWAY, E_NO_TOPOLOGY, E_NO_CREDENTIAL, or E_TOPOLOGY_EXPIRED

`OP_OPEN_SESSION` fails until four things are in place, and the errno tells you which one is missing
([`src/server/handlers/open.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/open.rs#L31), [`src/state/table/ops.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/ops.rs#L29)): `E_NO_GATEWAY` means `OP_SET_GATEWAY` has not
run, `E_NO_TOPOLOGY` means no directory is installed, `E_NO_CREDENTIAL` means the caller has not installed a
credential, and `E_TOPOLOGY_EXPIRED` means a directory is installed but outside its validity window. The order
to bring the capsule up is authority, then directory, then gateway, then a per-caller credential; the
[operations](/docs/userland/net-nym/operations/) page lists the ops. `E_TABLE_FULL` means all 32 sessions are in use.

### Control ops return E_PERM

Every control op, `OP_SET_GATEWAY`, `OP_SET_TOPOLOGY`, `OP_SET_AUTHORITY`, `OP_SET_TIMING`, and
`OP_SYNC_DIRECTORY`, returns `E_PERM` unless the caller is the pid registered as `net.admin`
([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)). Because no capsule registers `net.admin` today, these are denied by default. A
persistent `E_PERM` while bringing the capsule up is not a bug; it is the deny-by-default gate, and it clears
only once an admin principal owns the `net.admin` service. `OP_SET_CREDENTIAL` is intentionally ungated, so it
is not affected.

### Directory install returns a signature or authority error

`OP_SET_TOPOLOGY` and `OP_SYNC_DIRECTORY` map the directory verify result to an errno
([`src/server/handlers/topology_errno.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/topology_errno.rs#L23)): `E_AUTHORITY_MISSING` means no trusted authority was set with
`OP_SET_AUTHORITY`, `E_AUTHORITY_UNTRUSTED` means the directory was signed by a key other than the installed
authority, `E_TOPOLOGY_AUTH` means the Ed25519 signature did not verify, and `E_TOPOLOGY_STALE` means the
validity window is bad or the epoch is not newer than the stored one. The last is the anti-rollback check
([`src/topology/store.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/store.rs#L39)): pushing a directory whose epoch is not greater than the current one is refused,
so re-pushing an old directory looks like `E_TOPOLOGY_STALE`.

### Send returns E_NO_ROUTE, E_CREDENTIAL_EXPIRED, or E_NO_TCP

`OP_SEND` builds and sends a wire packet, and its errors trace the encode-and-send path
([`src/server/handlers/send.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L42)): `E_NO_ROUTE` means route selection found no candidate node for some hop,
usually a directory missing an entry, exit, or a mix layer ([`src/topology/select.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/select.rs#L41));
`E_CREDENTIAL_EXPIRED`, `E_AUTHORITY_MISSING`, or `E_AUTHORITY_UNTRUSTED` mean the credential lapsed or its
authority changed ([`src/state/credential/store.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/credential/store.rs#L32)); `E_CRYPTO` means a crypto syscall failed inside
encode; and `E_NO_TCP` means the gateway send over `net.tcp` failed or setup has not stored a TCP port. A
`E_NO_SESSION` means the caller does not own that session id.

### Set gateway returns E_GATEWAY_PROTO or E_NO_TCP

`OP_SET_GATEWAY` connects to the gateway before making it current
([`src/server/handlers/gateway.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/gateway.rs#L38)). `E_GATEWAY_PROTO` means the WebSocket upgrade handshake failed, the
server did not return a `101` or the `Sec-WebSocket-Accept` did not match ([`src/gateway_client/ws/handshake.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gateway_client/ws/handshake.rs#L34)).
`E_NO_TCP` means the TCP connect to the gateway itself failed. A raw-TCP gateway (mode 0) skips the handshake,
so a `E_GATEWAY_PROTO` only appears on a WebSocket gateway (mode 1, the default).

### Recv returns E_RX_EMPTY

`OP_RECV` drains the gateway stream, decodes whole packets, and queues datagrams for the owning session, then
returns one if any is queued ([`src/server/handlers/recv.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L24)). `E_RX_EMPTY` means nothing is queued for that
session; a client polls again. This is normal on an idle session. If a session that should be receiving never
does, the packets are being dropped somewhere in the decode: `decode` rejects a wrong size, magic, or replay
tag ([`src/packet/decode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/decode.rs#L24)), the drain drops any packet flagged `FLAG_COVER`
([`src/server/handlers/recv_drain.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv_drain.rs#L56)), the replay window drops a duplicate tag ([`src/state/replay.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/replay.rs#L32)),
and a packet whose session id matches no open session is dropped (`recv_drain.rs:60`). None of those surface
an errno, so a persistent `E_RX_EMPTY` on an active link points at one of them, or at the far side simply not
sending.

## A note on the stale source README

The capsule's own `README.md` says the operational ops return `E_NOTSUP` in beta and the mask is `0x10`. If
you are debugging against that document, stop: the code returns real errnos from the set above, the mask is
`0x0003d`, and the ops are implemented. Debug against the code and this documentation, not the capsule
README.

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_nym.rs  the NET-NYM spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs              the capsule-spawned / error boot markers
  userland/capsule_net_nym/src/main.rs                the heap-exit code and the setup retry loop
  userland/capsule_net_nym/src/setup.rs               the single TcpMissing setup error
  userland/capsule_net_nym/src/server/handlers/open.rs       the open readiness errnos
  userland/capsule_net_nym/src/server/authz.rs               the E_PERM control gate
  userland/capsule_net_nym/src/server/handlers/topology_errno.rs  the directory verify errnos
  userland/capsule_net_nym/src/topology/store.rs             the epoch anti-rollback
  userland/capsule_net_nym/src/server/handlers/send.rs       the send-path errnos
  userland/capsule_net_nym/src/server/handlers/gateway.rs    the gateway connect errnos
  userland/capsule_net_nym/src/server/handlers/recv.rs, recv_drain.rs  the recv drain and drops
  userland/capsule_net_nym/src/packet/decode.rs              the packet decode guard
  userland/capsule_net_nym/src/state/replay.rs               the replay-window drop
```

Every reference above is verified against those trees.
