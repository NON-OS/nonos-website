---
title: "Debugging capsule_net_ip"
description: "This page lists the log marker the capsule's boot path emits, the bring-up retry behaviour, and the concrete runtime failure modes with where to look for each."
weight: 8
---
This page lists the log marker the capsule's boot path emits, the bring-up retry behaviour, and the
concrete runtime failure modes with where to look for each. For the shape of the capsule see the
[README](/docs/userland/net-ip/), the [operations](/docs/userland/net-ip/operations/) page, the [ipv4](/docs/userland/net-ip/ipv4/) page, the
[routing](/docs/userland/net-ip/routing/) page, and the [state](/docs/userland/net-ip/state/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints `[NET-IP]
capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-IP`
([`src/userspace/init/spawn_plan/network/spawn_ip.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_ip.rs#L21)), which reaches `capsule_boot::boot`, whose
`Ok` arm calls `boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)),
and `ok` formats `[` + tag + `] ` + message ([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the
capsule never started, usually a signature, manifest, or capability failure; the `Err` arm prints an
`[ERROR]` line instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The spawn itself only runs when
the `nonos-capsule-net-ip` feature is enabled, which is the decomposed-stack build; with the
consolidated `net_core` build the per-layer capsules are compiled out (see the
[stack](/docs/subsystems/networking/stack/) page).

## Bring-up is a retry, not an exit

Unlike a driver capsule that exits with a distinct code on a bring-up failure, `net.ip` waits for its
dependency. `_start` loops `setup::run`, yielding the CPU 64 times between attempts, and only enters the
request server once setup succeeds ([`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46)). So there is no bring-up exit code to read; a
capsule that spawned but is not answering is almost always stuck in this loop because `net.l2` is not up
yet. `setup::run` fails with `L2NotFound` when the `net.l2` registry lookup misses, and `L2MacFailed`
when the MAC read through L2 fails ([`src/setup.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L38)). The fix is upstream: confirm `net.l2` spawned
(its own `[NET-L2] capsule spawned` marker) before expecting `net.ip` to serve. Because the loop never
exits, a permanently absent `net.l2` shows as a silent, non-answering `net.ip`, not a crash.

## Runtime failure modes

After setup succeeds, failures surface as the errno in the reply header, not exit codes. The full set
is on the [operations](/docs/userland/net-ip/operations/) page; these are the ones with a real diagnostic story.

### Every send returns `E_NO_CONFIG`

The interface has no IPv4 address yet, or no `net.l2` port. Egress refuses to send with a zero source
address or a zero L2 port ([`src/egress/send.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L35), [`src/egress/send.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L42)), and the poll path returns
`E_NO_CONFIG` when no L2 port is known ([`src/server/handlers/poll_packet/poll.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/poll.rs#L37)). This is the
pre-DHCP state: the address is filled by `OP_SET_CONFIG` from the DHCP client, so the probe is
`OP_GET_CONFIG`, which shows a zero address until the lease lands ([`src/server/handlers/get_config.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_config.rs#L29)).

### A send returns `E_NO_ROUTE`

No route matched the destination. With a configured gateway, `OP_SET_CONFIG` seeds a prefix-0 default
route, so an `E_NO_ROUTE` after configuration means either the gateway was zero at set-config time or
the route table was cleared ([`src/server/handlers/set_config.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_config.rs#L46), [`src/route/table.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/table.rs#L53)). Add an
explicit route with `OP_ROUTE_ADD` if this host needs a non-default path.

### A send returns `E_NO_NEIGHBOUR`

The next hop did not resolve. ARP through `net.l2` returned a miss, and L2 has emitted an ARP request;
the caller is expected to back off and retry while the neighbour answers ([`src/l2_client/arp.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/arp.rs#L50),
[`src/egress/send.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L57)). A persistent `E_NO_NEIGHBOUR` points at the L2 or link side: the neighbour is
unreachable, or `net.l2` is not getting replies, not at the IP layer.

### A send returns `E_L2_FAULT`

`net.l2` refused or failed the frame, or the frame build failed. The egress path collapses an L2 send
failure and an internal build failure into this one errno ([`src/egress/send.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L31),
[`src/egress/frame.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/frame.rs#L38), [`src/server/handlers/send_packet.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send_packet.rs#L39)). A build failure is a local bug
(payload past the MTU margin, or a length mismatch); an L2 refusal is a downstream fault to chase in
`net.l2`.

### A poll returns `E_RX_EMPTY` or `E_BAD_PACKET`

`E_RX_EMPTY` is the normal "nothing to deliver" answer: the receive queue held no matching packet and
the eight-frame L2 poll budget came up empty ([`src/server/handlers/poll_packet/poll.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/poll.rs#L48)). A caller
polls again on the next tick. `E_BAD_PACKET` means either the poll filter body was longer than one byte
([`src/server/handlers/poll_packet/select.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/select.rs#L24)) or a frame drained from L2 failed to parse as IPv4
([`src/server/handlers/poll_packet/route.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/route.rs#L46)); the latter is a wire or `net.l2` problem, since a
well-formed frame parses cleanly.

### A control op returns `E_PERM`

The caller is not the authorized principal for that op. `OP_SET_CONFIG` requires the sender to be the
`net.dhcp.client` service ([`src/server/handlers/set_config.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_config.rs#L29)), and `OP_ROUTE_ADD` and
`OP_ROUTE_CLEAR` require `net.admin`, which no capsule registers today, so those two are denied by
default ([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38), [`src/server/handlers/route_add.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/route_add.rs#L27)). An unexpected `E_PERM` on
set-config means the caller is not the registered DHCP client; on the route ops it is the expected
deny-by-default until an admin principal exists.

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_ip.rs  the NET-IP spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs             the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                         the [TAG] message formatting
  userland/capsule_net_ip/src/main.rs                the wait_for_setup retry loop
  userland/capsule_net_ip/src/setup.rs               L2NotFound and L2MacFailed
  userland/capsule_net_ip/src/egress/send.rs         the E_NO_CONFIG / E_NO_ROUTE / E_NO_NEIGHBOUR paths
  userland/capsule_net_ip/src/egress/frame.rs        the build failure behind E_L2_FAULT
  userland/capsule_net_ip/src/server/handlers/poll_packet/  the E_RX_EMPTY and E_BAD_PACKET paths
  userland/capsule_net_ip/src/server/authz.rs        the E_PERM authorization gate
  userland/capsule_net_ip/src/protocol/errno.rs      the errno values behind each reply
```

Every reference above is verified against those trees.
</content>
