---
title: "Debugging capsule_net_udp"
description: "This page lists the boot marker the UDP capsule's spawn path emits, the setup retry loop, and the concrete runtime failure modes with where to look for each."
weight: 5
---
This page lists the boot marker the UDP capsule's spawn path emits, the setup retry loop, and the concrete
runtime failure modes with where to look for each. For the shape of the capsule see the [README](/docs/userland/net-udp/),
the [operations](/docs/userland/net-udp/operations/) page, the [datagram](/docs/userland/net-udp/datagram/) page, and the [state](/docs/userland/net-udp/state/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[NET-UDP] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-UDP`
([`src/userspace/init/spawn_plan/network/spawn_udp.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_udp.rs#L21)), whose `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which prints `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The line only appears at all when the kernel is built with
the `nonos-capsule-net-udp` feature, the `cfg` gate on the spawn entry
([`src/userspace/init/spawn_plan/network/spawn_udp.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_udp.rs#L18)).

## Setup never completes (the capsule is spawned but silent)

Unlike a driver, this capsule does not exit on a setup failure. `_start` calls `setup::run` in a loop,
yielding 64 times between attempts and retrying forever until it succeeds ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). So a capsule
that spawned but never answers a request is almost always stuck in that loop because `net.ip` has not come
up. `setup::run` fails for one of two reasons ([`src/setup.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L36)):

- `mk_service_lookup("net.ip")` returned non-zero, so the IP capsule is not registered yet
  (`SetupError::IpNotFound`, [`src/setup.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L40)). The fix is upstream: `net.ip` has to be spawned and
  registered before UDP can bind to it. This is the expected transient at boot, and the retry loop is there
  precisely to wait it out.
- The lookup succeeded but `read_ipv4` failed, so `net.ip` answered but the config read did not return a
  usable IPv4 (`SetupError::IpConfigFailed`, [`src/setup.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L49)). That happens when the IP layer has no
  address yet, for instance before DHCP has bound a lease.

Because the loop retries silently, the way to tell the two apart is to confirm `net.ip` itself is up and has
an address. Once it does, the next setup attempt caches the IP port and local IPv4 and the server starts.

## Runtime failure modes

After setup succeeds, failures surface as errno words in the response header, not exit codes. Every errno is
the 16-bit value at offset 8 of the reply ([`src/server/respond.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L37)).

### A request gets no reply at all

Two request-side conditions produce no reply rather than an errno. A frame that fails to parse (wrong magic,
wrong version, or a length that does not match the body) is dropped in the request loop
([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)), and a receive with a zero sender pid is skipped (`runner.rs:39`). If a client
sees a silent timeout rather than an errno, the request never parsed or carried no attributable sender.
Confirm the magic is `NUDP` (`0x4E55_4450`), the version field is `1`, and the `payload_len` field matches
the body actually sent ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)).

### `E_BAD_OP` (3)

The opcode was not one of the five the dispatch handles ([`src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L50)). Only `1` through `5`
are defined ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).

### `E_BAD_LEN` (4)

The body was too short for the op, or a send payload ran past the MTU ceiling. Bind, unbind, and recv need
at least 2 bytes for the port ([`src/server/handlers/bind.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L24), `unbind.rs:24`, [`recv/handle.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/recv/handle.rs#L28)); send
needs at least 8 bytes for the src port, dst IPv4, and dst port ([`src/server/handlers/send.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L28)) and
rejects a payload over `UDP_PAYLOAD_MAX` (1472) (`send.rs:37`, [`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)). A send can also
return `E_BAD_LEN` if the UDP `build` step reports the output buffer was too small or the segment too large
([`src/server/handlers/send.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L55), [`src/udp/build.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/build.rs#L38)).

### `E_NO_PORT` (5)

The sender does not own the port it named. Send and recv both call `find_owned_mut`, which matches on both
port and pid, so a caller that never bound the port, or bound it under a different pid, gets `E_NO_PORT`
([`src/server/handlers/send.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L41), [`recv/handle.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/recv/handle.rs#L33), [`src/state/table.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L36)). Unbind returns the same
errno when there is no binding for that pid and port to remove ([`src/server/handlers/unbind.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/unbind.rs#L29)). The fix
is to `OP_BIND` the port first, from the same capsule.

### `E_PORT_IN_USE` (6)

The bind failed because the port is already held or the table is full. `insert` rejects a duplicate port
with `InUse` and a table at `MAX_BINDS` (64) with `Full`, and bind maps both to `E_PORT_IN_USE`
([`src/state/table.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L40), [`src/server/handlers/bind.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/bind.rs#L30)). This is the one-owner-per-port rule: a port
held by another capsule cannot be rebound. If it is a stale binding from a dead process, it has to be
unbound by its owner or the table entry has to age out; there is no forced takeover.

### `E_NO_IP_LINK` (7)

A send could not reach `net.ip`. Either the cached IP port is zero, meaning setup has not resolved `net.ip`
([`src/server/handlers/send.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L46)), or `send_segment` reported a transport failure, a malformed reply, or a
non-zero IP errno (`send.rs:59`). It also surfaces on the recv path if a stored segment fails to reparse on
delivery ([`src/server/handlers/recv/deliver.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/deliver.rs#L30)). The first case points back at setup and `net.ip`; the
second at the IP layer or the wire.

### `E_RX_EMPTY` (8)

No datagram was queued for the bound port. Recv checks the ring, drains one segment from `net.ip`, and
checks again; if both are empty it returns `E_RX_EMPTY` ([`src/server/handlers/recv/handle.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/handle.rs#L46)). This is
the normal "nothing has arrived yet" answer, not an error in the usual sense: the client polls again. It
also fires if a delivered segment would not fit the transmit buffer, which the reply buffer is sized to
avoid ([`src/server/handlers/recv/deliver.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/deliver.rs#L35)). Note the receive ring is 32 deep and a full ring drops
new arrivals ([`src/state/bind.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/bind.rs#L34)), so a client that binds a busy port but polls slowly can miss
datagrams; that loss is silent by design, since UDP has no retransmission.

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_udp.rs   the NET-UDP spawn entry and its cfg gate
  src/userspace/init/capsule_boot/run.rs               the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                           the [TAG] message formatting
  userland/capsule_net_udp/src/main.rs                 the setup retry loop
  userland/capsule_net_udp/src/setup.rs                IpNotFound / IpConfigFailed
  userland/capsule_net_udp/src/server/parse_req.rs     the parse failures behind a dropped request
  userland/capsule_net_udp/src/server/runner.rs        the dispatch and the sender-pid gate
  userland/capsule_net_udp/src/protocol/errno.rs       the errno constants
  userland/capsule_net_udp/src/server/handlers/bind.rs, unbind.rs, send.rs   the E_BAD_LEN/E_NO_PORT/E_PORT_IN_USE/E_NO_IP_LINK paths
  userland/capsule_net_udp/src/server/handlers/recv/handle.rs, recv/deliver.rs   the E_RX_EMPTY paths
  userland/capsule_net_udp/src/state/table.rs, bind.rs   the ownership and ring-depth rules
```

Every reference above is verified against those trees.
