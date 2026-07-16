---
title: "Interface state and bring-up"
description: "The capsule holds a small amount of runtime state and one bring-up routine that seeds it."
weight: 6
---
The capsule holds a small amount of runtime state and one bring-up routine that seeds it. This page
mirrors `src/state/` (the interface config, the packet identification counter, and the bounded receive
queue) and [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) (the bring-up that resolves `net.l2` and reads the MAC). For the ops that
read and write this state see the [operations](/docs/userland/net-ip/operations/) page; for how the receive queue is
filled and drained see the poll path on that page.

## The interface config

All of the interface's runtime configuration is one static, `IFACE`, built at compile time so it needs
no heap and no init call ([`src/state/iface.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/iface.rs#L55)). It holds the MAC, the IPv4 address, the prefix, the
gateway, the MTU, the resolved `net.l2` service port, and the packet identification counter
([`src/state/iface.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/iface.rs#L22)). Each field carries only the synchronization it needs: the MAC, address, and
gateway are behind spin mutexes because they are multi-byte, while the prefix, MTU, L2 port, and
identification are atomics (`iface.rs:23`). The defaults are a zero MAC, a zero address (meaning
unconfigured), a prefix and gateway of zero, an MTU of 1500, no L2 port, and an identification counter
starting at 1 (`iface.rs:33`).

The address of `[0,0,0,0]` is the sentinel for "not configured yet": egress refuses to send with a
zero source (`E_NO_CONFIG`), and ingress skips the local-delivery filter entirely until an address is
set, so a host can still answer broadcast before DHCP completes ([`src/egress/send.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/send.rs#L35),
[`src/ingress.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L58)). `OP_SET_CONFIG` is what fills the address, prefix, and gateway
([`src/server/handlers/set_config.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_config.rs#L42)), and `OP_GET_CONFIG` reads the whole block back out
([`src/server/handlers/get_config.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_config.rs#L29)). The L2 port is filled once at bring-up
([`src/setup.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L42)).

## The identification counter

Every outbound datagram needs a fresh identification field, and `next_id` supplies it: a relaxed atomic
fetch-add that skips zero on wrap so an id of 0 is never handed out ([`src/state/iface.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/iface.rs#L45)). The
egress frame builder pulls one id per transmit ([`src/egress/frame.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/egress/frame.rs#L46)). The link client keeps its
own separate request-id counter for `net.l2` calls with the same zero-skip discipline, so the IP
identification space and the L2 request-id space never collide ([`src/l2_client/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/seq.rs#L21)).

## The receive queue

Inbound packets that arrive during a poll but do not match the caller's protocol filter are parked in a
bounded queue rather than dropped or returned out of order ([`src/state/rx_queue.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/rx_queue.rs#L24)). It is a
`VecDeque` behind a mutex, capped at 64 entries (`rx_queue.rs:22`). Three operations serve it:

- `push` appends a packet and returns false when the queue is at capacity, so a flood drops the newest
  packet rather than growing memory without bound (`rx_queue.rs:26`);
- `pop_any` takes the oldest packet, used when a poll asks for any protocol (`rx_queue.rs:35`);
- `pop_for_protocol` takes the oldest packet matching a requested protocol number, used when a poll
  filters (`rx_queue.rs:39`).

The poll path checks this queue first and only reaches out to `net.l2` when nothing queued matches, and
pushes any non-matching frame it polls back onto the queue for a later request
([`src/server/handlers/poll_packet/poll.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/poll.rs#L33), [`src/server/handlers/poll_packet/route.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_packet/route.rs#L41)). A queued
`Packet` is source, destination, protocol, and an owned payload ([`src/state/packet.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/packet.rs#L21)).

## Bring-up

`setup::run` is the whole bring-up ([`src/setup.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L35)). It resolves the `net.l2` service through the
registry with `mk_service_lookup`, returning `L2NotFound` if the lookup fails; stores the resolved port
into `IFACE`; then reads the NIC MAC through the L2 client and stores it, returning `L2MacFailed` on
any client error ([`src/setup.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L38)). It deliberately does not set an IPv4 address: the interface comes
up with its MAC and a zero address, and DHCP fills the address later through `OP_SET_CONFIG`
([`src/setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L19)).

Because `net.l2` may not be up when `net.ip` starts, bring-up is a retry loop rather than a one-shot.
`_start` calls `wait_for_setup`, which runs `setup::run` and, on failure, yields the CPU 64 times and
tries again, never exiting ([`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46)). The capsule only enters its request server once setup
has succeeded ([`src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L42)). This is the difference from a driver capsule that exits with a
distinct code on a bring-up failure: `net.ip` waits for its dependency instead of dying, because a
missing `net.l2` at startup is a sequencing race, not a fatal fault.

## Source map

```
  userland/capsule_net_ip/src/state/iface.rs     IFACE: MAC, address, prefix, gateway, MTU, L2 port, id
  userland/capsule_net_ip/src/state/packet.rs    the queued Packet: src, dst, protocol, owned payload
  userland/capsule_net_ip/src/state/rx_queue.rs  the 64-entry bounded receive queue and its three ops
  userland/capsule_net_ip/src/state/mod.rs       the IFACE, Packet, and queue re-exports
  userland/capsule_net_ip/src/setup.rs           resolve net.l2, store the port, read the MAC
  userland/capsule_net_ip/src/main.rs            the wait_for_setup retry loop before server::run
  userland/capsule_net_ip/src/egress/frame.rs    the next_id call site on transmit
  userland/capsule_net_ip/src/server/handlers/get_config.rs   the IFACE read-out
  userland/capsule_net_ip/src/server/handlers/set_config.rs   the IFACE write path
```

Every reference above is verified against those trees.
</content>
