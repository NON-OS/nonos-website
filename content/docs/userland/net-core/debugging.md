---
title: "Debugging net_core"
description: "This page lists the log markers the capsule emits, and the concrete runtime failure modes with where to look for each."
weight: 7
---
This page lists the log markers the capsule emits, and the concrete runtime failure modes with where to look
for each. For the shape of the capsule read the [README](/docs/userland/net-core/), the [protocol](/docs/userland/net-core/protocol/) page, the
[server](/docs/userland/net-core/server/) page, the [device](/docs/userland/net-core/device/) page, and the [iface](/docs/userland/net-core/iface/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[NET-CORE] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-CORE`
([`src/userspace/init/spawn_plan/network/spawn_core.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_core.rs#L21)), which delegates to `capsule_boot::boot`
([`src/userspace/init/spawn_plan/boot.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/boot.rs#L26)), whose `Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), formatted as `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)).

## The registration and lease markers

After the boot marker, four capsule-emitted markers tell you how far bring-up got, in order.

| Marker | Meaning | Source |
|---|---|---|
| `[NET-CORE] registered net.tcp net.udp net.dhcp.client net.dns` | all four services registered | [`src/register.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L36) |
| `[NET-CORE] registration partial failure` | at least one `mk_service_register` failed | [`src/register.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L39) |
| `[NET-CORE] lease <ip>/<prefix> gw <gw>` | a DHCP lease was configured | [`src/iface/dhcp.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L65) |
| `[NET-CORE] lease-status state=<n> ip=<ip>` | the lease self-check re-encoded the status body | [`src/iface/dhcp.rs:102`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L102) |

Registration happens only after setup succeeds, so seeing the registration line means the NIC was found, the
link was up, the MAC was read, and the smoltcp state was built ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40), [device](/docs/userland/net-core/device/)). The
two lease lines appear only once DHCP configures an address; state `3` in the self-check line is bound, `1`
is unbound ([`src/server/handlers/dhcp_status.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dhcp_status.rs#L35)).

## No NIC found

If the boot marker prints but no registration line follows, setup is stuck discovering a NIC.
`discover_nic` walks a fixed candidate list, `driver.virtio_net0`, `driver.e1000_0`, `driver.rtl8169_0`,
`driver.rtl8139_0`, and returns `NicNotFound` if the registry knows none of them ([`src/setup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L23),
[`src/setup.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L35)). `NicNotFound` is retryable: `wait_for_setup` yields and loops rather than exiting, so the
stack waits for the driver capsule to register ([`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)). If no driver is expected to be present,
this is the correct terminal state; if one is, the problem is upstream in the driver capsule's own spawn or
registration, not in `net_core`. A driver name that is present but not in the candidate list would also show
this, since discovery matches only those four names.

## Link never comes up

Discovery found a driver but the link never reports up. `link_up` sends `OP_LINK_STATUS` and returns
`Some(false)` when the driver reports the link down, which setup maps to `LinkDown`
([`src/device/link_up.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/link_up.rs#L23), [`src/setup.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L50)). Like `NicNotFound`, `LinkDown` is retryable and the capsule
keeps polling ([`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)). A malformed or short reply instead returns `LinkFailed`
([`src/setup.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L51)), and reading the MAC failing returns `MacFailed` ([`src/setup.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L53)); both of those are
hard errors that exit the process with code 2 ([`src/main.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L54)). So a capsule that spawned but is not
registered and is not looping usually means a driver replied but its `NNET` link or MAC reply did not match
the expected layout, not that the cable is down.

## No lease

The services registered but no `[NET-CORE] lease ...` line appears, and DNS calls return `E_NO_LEASE`. The
DHCPv4 client only records a lease and installs the DNS socket on a `Configured` event
([`src/iface/dhcp.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/dhcp.rs#L32)), which requires the pump to be exchanging frames with the driver
([`src/iface/poll.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/iface/poll.rs#L24), [iface](/docs/userland/net-core/iface/)). If registration succeeded but no lease arrives, the stack is up
but is not getting DHCP replies: either no DHCP server is answering on the link, or frames are not actually
flowing to and from the driver. Confirm the frame path with the next section. Until a lease lands there is no
DNS socket, so `net.dns` returns `E_NO_LEASE` ([`src/server/handlers/dns/resolve_a.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L39),
[protocol](/docs/userland/net-core/protocol/)), and `net.dhcp.client` reports state `1` (unbound)
([`src/server/handlers/dhcp_status.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dhcp_status.rs#L43)).

## No packets

Frames are not moving even though the link is up. The receive side is `rx::poll_frame`, which returns `None`
on any short reply, non-zero driver status, or a frame length that runs past the buffer
([`src/device/rx.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/rx.rs#L44)); smoltcp reads `None` as an empty receive queue, so a driver that answers
`OP_RX_PACKET` with a malformed body looks exactly like no traffic. The transmit side is `tx::send_frame`,
whose result is intentionally not surfaced back into smoltcp ([`src/device/tx_token.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/tx_token.rs#L28),
[device](/docs/userland/net-core/device/)), so a failing transmit is silent at the stack layer. When a lease never arrives and the
link is confirmed up, suspect the frame path: the driver's `OP_RX_PACKET` and `OP_TX_PACKET` replies, and
the driver's own device programming, which lives in the driver capsule, not here.

## Socket-level errnos

After a lease, per-request failures come back as errno words in the reply, not markers. `E_NO_SOCKET` means
the app handle or the pid+port key did not resolve to a socket the caller owns ([`src/handles.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L35),
[`src/udp_ports.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs#L43)); `E_NOT_CONNECTED` means smoltcp rejected a send on a socket that is not established
([`src/server/handlers/tcp/send.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/send.rs#L52), [`src/server/handlers/udp/send.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/send.rs#L51)); `E_RX_EMPTY` means nothing was
buffered to receive ([`src/server/handlers/tcp/recv.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/recv.rs#L51), [`src/server/handlers/udp/recv.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/udp/recv.rs#L61)); and
`E_SERVFAIL` from `net.dns` is a query timeout or empty answer within the 3000 ms deadline
([`src/server/handlers/dns/resolve_a.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dns/resolve_a.rs#L50)). The full errno sets are on the [protocol](/docs/userland/net-core/protocol/) page.

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_core.rs  the NET-CORE spawn entry
  src/userspace/init/spawn_plan/boot.rs                the boot::capsule delegate
  src/userspace/init/capsule_boot/run.rs               the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                           the [TAG] message formatting
  userland/capsule_net_core/src/main.rs                wait_for_setup: retry vs exit on SetupError
  userland/capsule_net_core/src/setup.rs               discovery, link, MAC, and the SetupError mapping
  userland/capsule_net_core/src/register.rs            the registration markers
  userland/capsule_net_core/src/iface/dhcp.rs          the lease markers and the DHCP event handling
  userland/capsule_net_core/src/device/rx.rs, tx.rs    the frame path behind "no packets"
  userland/capsule_net_core/src/server/handlers/       the socket-level errno paths cited above
```

Every reference above is verified against those trees.
