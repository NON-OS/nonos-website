---
title: "Network Capsules"
description: "This page documents the userland network capsule stack."
weight: 22
---
This page documents the userland network capsule stack. Read
[Capsule Inventory](/docs/userland/capsules/) and [Networking](/docs/subsystems/networking/)
first.

Read the network pages in three passes: boot order, protocol surface, then
payload limits. Boot order proves which capsules exist at runtime. Protocol
surface proves what each capsule accepts. Payload limits are the first place to
look when a packet path fails only for larger frames.

---

## 1. Boot order

The network spawn plan starts L2, IP, UDP, DHCP, TCP, DNS, Nym, and sockets in
that order ([`src/userspace/init/spawn_plan/network.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L17)). Each network
capsule is a no_std service with a `main.rs` entrypoint and a protocol ops
table in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs).

```
+-----------+
| net.l2    |
+-----+-----+
      |
+-----+-----+
| net.ip    |
+-----+-----+
      |
+-----+-----+
| net.udp   |
| net.tcp   |
+-----+-----+
      |
+-----+-----+
| net.dhcp  |
| net.dns   |
+-----+-----+
      |
+-----+-----+
| net.nym   |
| sockets   |
+-----------+
```

## 2. Capsule contracts

| Capsule | Service | Caps | Protocol operations | Entrypoint | Spec refs |
|---------|---------|------|---------------------|------------|-----------|
| `net.l2` | `service:4400:net.l2` | `0x00019` | healthcheck, get MAC, get link, send frame, poll frame, ARP resolve | [`userland/capsule_net_l2/src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/main.rs#L34) | `userland/capsule_net_l2/Capsule.mk:13`, `userland/capsule_net_l2/Capsule.mk:16`, [`userland/capsule_net_l2/src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/protocol/ops.rs#L21) |
| `net.ip` | `service:4402:net.ip` | `0x00019` | healthcheck, get config, set config, send packet, poll packet, route add, route clear | [`userland/capsule_net_ip/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/main.rs#L36) | `userland/capsule_net_ip/Capsule.mk:14`, `userland/capsule_net_ip/Capsule.mk:17`, [`userland/capsule_net_ip/src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/protocol/ops.rs#L21) |
| `net.udp` | `service:4420:net.udp` | `0x00019` | healthcheck, bind, unbind, send, receive | [`userland/capsule_net_udp/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/main.rs#L32) | `userland/capsule_net_udp/Capsule.mk:12`, `userland/capsule_net_udp/Capsule.mk:14`, [`userland/capsule_net_udp/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/protocol/ops.rs#L17) |
| `net.dhcp.client` | `service:4440:net.dhcp.client` | `0x00019` | healthcheck, lease request, lease status, lease release, lease renew | [`userland/capsule_net_dhcp/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/main.rs#L35) | `userland/capsule_net_dhcp/Capsule.mk:12`, `userland/capsule_net_dhcp/Capsule.mk:14`, [`userland/capsule_net_dhcp/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/protocol/ops.rs#L17) |
| `net.tcp` | `service:4430:net.tcp` | `0x00019` | healthcheck, listen, connect, accept, send, receive, close, shutdown | [`userland/capsule_net_tcp/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/main.rs#L32) | `userland/capsule_net_tcp/Capsule.mk:12`, `userland/capsule_net_tcp/Capsule.mk:14`, [`userland/capsule_net_tcp/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/protocol/ops.rs#L17) |
| `net.dns` | `service:4450:net.dns` | `0x00019` | healthcheck, resolve A, resolve AAAA, flush cache, set upstream | [`userland/capsule_net_dns/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/main.rs#L32) | `userland/capsule_net_dns/Capsule.mk:11`, `userland/capsule_net_dns/Capsule.mk:13`, [`userland/capsule_net_dns/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/protocol/ops.rs#L17) |
| `net.sockets` | `service:4460:net.sockets` | `0x00019` | healthcheck, socket, bind, listen, accept, connect, send, receive, close, getsockopt, setsockopt | [`userland/capsule_net_sockets/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/main.rs#L31) | `userland/capsule_net_sockets/Capsule.mk:12`, `userland/capsule_net_sockets/Capsule.mk:14`, [`userland/capsule_net_sockets/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/protocol/ops.rs#L17) |
| `net.nym` | `service:4470:net.nym` | `0x00039` | healthcheck, set gateway, open session, send, receive, cover tick, close, set topology, set credential, create SURB, send reply, set timing, set authority, sync directory, topology status, timing status | [`userland/capsule_net_nym/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/main.rs#L37) | `userland/capsule_net_nym/Capsule.mk:11`, `userland/capsule_net_nym/Capsule.mk:13`, [`userland/capsule_net_nym/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/protocol/ops.rs#L17) |

## 3. Server loops

The network capsules wait for setup before entering their server loops. L2,
IP, UDP, TCP, DNS, sockets, Nym, and DHCP all call `wait_for_setup()` before
`server::run()` ([`userland/capsule_net_l2/src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/main.rs#L34),
[`userland/capsule_net_ip/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/main.rs#L36),
[`userland/capsule_net_udp/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/main.rs#L32),
[`userland/capsule_net_tcp/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/main.rs#L32),
[`userland/capsule_net_dns/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/main.rs#L32),
[`userland/capsule_net_sockets/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/main.rs#L31),
[`userland/capsule_net_nym/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/main.rs#L37),
[`userland/capsule_net_dhcp/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/main.rs#L35)). The handler surface matches the
op tables: L2 handlers cover link, MAC, frame TX/RX, and ARP
([`userland/capsule_net_l2/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/mod.rs#L17) to
[`userland/capsule_net_l2/src/server/handlers/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/handlers/mod.rs#L22)); IP handlers cover
configuration, send, poll, and routes
([`userland/capsule_net_ip/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/handlers/mod.rs#L17) to
[`userland/capsule_net_ip/src/server/handlers/mod.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/handlers/mod.rs#L23)); UDP, TCP, and
sockets handlers cover their socket-family operations
([`userland/capsule_net_udp/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/handlers/mod.rs#L17) to
[`userland/capsule_net_udp/src/server/handlers/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/handlers/mod.rs#L21),
[`userland/capsule_net_tcp/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/handlers/mod.rs#L17) to
[`userland/capsule_net_tcp/src/server/handlers/mod.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/handlers/mod.rs#L25),
[`userland/capsule_net_sockets/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/handlers/mod.rs#L17) to
[`userland/capsule_net_sockets/src/server/handlers/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/handlers/mod.rs#L31)).

```
+--------------------------+
| network capsule main     |
+------------+-------------+
             |
+------------+-------------+
| wait for setup           |
+------------+-------------+
             |
+------------+-------------+
| server run               |
+------------+-------------+
             |
+------------+-------------+
| op table handler         |
+--------------------------+
```

## 4. Per-Capsule Runner Map

The stack uses the same receive, parse, dispatch shape, but each capsule owns a
different layer contract. The table below points at the match arm that should be
audited first when a layer fails.

| Capsule | Runner contract | Dispatch source |
|---------|-----------------|-----------------|
| `net.l2` | Allocates RX and TX buffers, receives from inbox `0`, parses the L2 frame, and handles healthcheck, get MAC, get link, send frame, poll frame, and ARP resolve. | [`userland/capsule_net_l2/src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L31), [`userland/capsule_net_l2/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L32), [`userland/capsule_net_l2/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L38), [`userland/capsule_net_l2/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L43), [`userland/capsule_net_l2/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L44) to [`userland/capsule_net_l2/src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L52) |
| `net.ip` | Receives from inbox `0`, parses the IP request, and handles healthcheck, config get, config set, packet send, packet poll, route add, and route clear. | [`userland/capsule_net_ip/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/runner.rs#L32), [`userland/capsule_net_ip/src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/runner.rs#L39), [`userland/capsule_net_ip/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/runner.rs#L44), [`userland/capsule_net_ip/src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/runner.rs#L45) to [`userland/capsule_net_ip/src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/runner.rs#L54) |
| `net.udp` | Receives from inbox `0`, parses the UDP request, and handles healthcheck, bind, unbind, send, and receive. | [`userland/capsule_net_udp/src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/runner.rs#L31), [`userland/capsule_net_udp/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/runner.rs#L38), [`userland/capsule_net_udp/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/runner.rs#L43), [`userland/capsule_net_udp/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/runner.rs#L44) to [`userland/capsule_net_udp/src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/runner.rs#L51) |
| `net.tcp` | Receives from inbox `0`, parses the TCP request, and handles healthcheck, listen, connect, accept, send, receive, close, and shutdown. | [`userland/capsule_net_tcp/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/runner.rs#L32), [`userland/capsule_net_tcp/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/runner.rs#L37), [`userland/capsule_net_tcp/src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/runner.rs#L41), [`userland/capsule_net_tcp/src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/runner.rs#L42) to [`userland/capsule_net_tcp/src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/runner.rs#L51) |
| `net.dhcp.client` | Uses fixed 256-byte RX and TX buffers, receives from inbox `0`, parses the request, and handles lease request, status, renew, and release. | [`userland/capsule_net_dhcp/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L30), [`userland/capsule_net_dhcp/src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L31), [`userland/capsule_net_dhcp/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L38), [`userland/capsule_net_dhcp/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L43), [`userland/capsule_net_dhcp/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L44) to [`userland/capsule_net_dhcp/src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L51) |
| `net.dns` | Receives from inbox `0`, parses the DNS request, and handles resolve A, resolve AAAA, flush cache, and set upstream. | [`userland/capsule_net_dns/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/server/runner.rs#L32), [`userland/capsule_net_dns/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/server/runner.rs#L37), [`userland/capsule_net_dns/src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/server/runner.rs#L41), [`userland/capsule_net_dns/src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/server/runner.rs#L42) to [`userland/capsule_net_dns/src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/server/runner.rs#L49) |
| `net.sockets` | Receives from inbox `0`, parses the socket facade request, and delegates to its handler dispatch table. | [`userland/capsule_net_sockets/src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/runner.rs#L28), [`userland/capsule_net_sockets/src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/runner.rs#L33), [`userland/capsule_net_sockets/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/runner.rs#L37), [`userland/capsule_net_sockets/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/runner.rs#L38), [`userland/capsule_net_sockets/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/handlers/mod.rs#L17) to [`userland/capsule_net_sockets/src/server/handlers/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/handlers/mod.rs#L31) |
| `net.nym` | Receives from inbox `0`, parses the Nym request, and delegates to its handler dispatch table. | [`userland/capsule_net_nym/src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/runner.rs#L28), [`userland/capsule_net_nym/src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/runner.rs#L33), [`userland/capsule_net_nym/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/runner.rs#L37), [`userland/capsule_net_nym/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/runner.rs#L38), [`userland/capsule_net_nym/src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/handlers/mod.rs#L17) to [`userland/capsule_net_nym/src/server/handlers/mod.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/handlers/mod.rs#L39) |

```
+--------------------------+
| service inbox frame      |
+------------+-------------+
             |
+------------+-------------+
| layer parser             |
+------------+-------------+
             |
+------------+-------------+
| op match or dispatch     |
+------------+-------------+
             |
+------------+-------------+
| layer state or client    |
+------------+-------------+
             |
+------------+-------------+
| status payload reply     |
+--------------------------+
```

## 5. Payload limits

L2 reserves an IPC payload maximum of Ethernet frame maximum plus 64 bytes
([`userland/capsule_net_l2/src/protocol/limits.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/protocol/limits.rs#L25)). IP uses IPv4 MTU plus
64 bytes ([`userland/capsule_net_ip/src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/protocol/limits.rs#L23)). UDP uses a
1472-byte UDP payload maximum and an IPC payload maximum of payload plus 64
bytes ([`userland/capsule_net_udp/src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/protocol/limits.rs#L18),
[`userland/capsule_net_udp/src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/protocol/limits.rs#L23)). TCP uses a 1460-byte
segment payload maximum and an IPC payload maximum of segment plus 64 bytes
([`userland/capsule_net_tcp/src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/protocol/limits.rs#L17),
[`userland/capsule_net_tcp/src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/protocol/limits.rs#L18)).

## 6. Failure Map

| Symptom | First source path to inspect | Why |
|---------|------------------------------|-----|
| L2 cannot send frames | [`userland/capsule_net_l2/src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_l2/src/server/runner.rs#L48) | Send frame enters the L2 transmit handler from this branch. |
| IP config never changes | [`userland/capsule_net_ip/src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_ip/src/server/runner.rs#L48) | `set_config` is the IP configuration mutation path. |
| UDP bind does not stick | [`userland/capsule_net_udp/src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_udp/src/server/runner.rs#L46) | Bind is the first UDP state mutation to inspect. |
| TCP receive stays empty | [`userland/capsule_net_tcp/src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_tcp/src/server/runner.rs#L48) | TCP receive dispatches through this branch. |
| DHCP lease never appears | [`userland/capsule_net_dhcp/src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dhcp/src/server/runner.rs#L46) | Lease request is the active DHCP acquisition path. |
| DNS resolution fails | [`userland/capsule_net_dns/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_dns/src/server/runner.rs#L44) | A-record resolution enters this handler. |
| Socket facade call fails | [`userland/capsule_net_sockets/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_sockets/src/server/runner.rs#L38) | The facade delegates into the socket handler dispatch table. |
| Nym request is rejected | [`userland/capsule_net_nym/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/server/runner.rs#L38) | Nym parsing succeeded but handler dispatch returned false. |
