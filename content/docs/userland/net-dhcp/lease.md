---
title: "The DHCP state machine and the lease"
description: "This page mirrors src/dora/ (the DISCOVER/OFFER/REQUEST/ACK ladder and the renew and release paths), src/dhcp/clientstate.rs (the RFC 2131 client state), src/state/ (the shared ..."
weight: 2
---
This page mirrors `src/dora/` (the DISCOVER/OFFER/REQUEST/ACK ladder and the renew and release paths),
[`src/dhcp/client_state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/client_state.rs) (the RFC 2131 client state), `src/state/` (the shared state and the cached lease),
and `src/setup/` (bring-up). It is the acquisition logic a `lease_request`, `lease_renew`, or `lease_release`
op reaches after the server has dispatched it. For that request loop and the op set see the
[operations](/docs/userland/net-dhcp/operations/) page; for the wire codecs and frames the ladder sends see the [framing](/docs/userland/net-dhcp/framing/)
page; for the L2 and IP clients it drives see the [transport](/docs/userland/net-dhcp/transport/) page.

## Bring-up

`setup::run` is the whole bring-up. It resolves `net.l2` through `mk_service_lookup` and stores the returned
service port with a `Release` store, resolves `net.ip` and stores its port, and reads the NIC MAC from
`net.l2` into shared state ([`src/setup/run.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L45)). A missing `net.l2` is `SetupError::L2NotFound`, a missing
`net.ip` is `IpNotFound`, and a failed MAC read is `L2MacFailed` ([`src/setup/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L24)). The lookup helper
returns `NotFound` when the registry call fails or the port is zero ([`src/setup/discover.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L24)). `_start`
calls setup in a retry loop, yielding 64 times between attempts until it succeeds, so the capsule waits for
`net.l2` and `net.ip` to come up rather than failing outright ([`src/main.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L44)). After setup succeeds,
`_start` makes up to sixteen bounded attempts to acquire an initial lease before the server starts
([`src/main.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L55)).

## The client state

`dhcp::State` is the RFC 2131 client state: `Init`, `Selecting`, `Requesting`, `Bound`, `Renewing`
([`src/dhcp/client_state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/client_state.rs#L20)). The DORA driver and the renew and release handlers transition between these
explicitly, and `lease_status` maps them to the 1-byte code in its reply body ([`src/server/handlers/lease_status.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_status.rs#L29)).

## The acquisition ladder

`dora::acquire` is the DISCOVER/OFFER/REQUEST/ACK ladder run end to end ([`src/dora/acquire.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L29)):

1. It reads the cached L2 and IP ports and the MAC, and returns `NoLink` if any is unset
   ([`src/dora/acquire.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L32)).
2. It mints a fresh transaction id with `next_xid` (a crypto-random draw), builds a request `Message` carrying
   the client MAC and the broadcast flag, and moves state to `Selecting` (`acquire.rs:35`).
3. `discover` sends one `DHCPDISCOVER` and waits for the first matching `DHCPOFFER` for that xid
   ([`src/dora/discover.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/discover.rs#L31)). It moves state to `Requesting`.
4. `request` sends a `DHCPREQUEST` for the offered `yiaddr` against the announced `server_id`, then waits for
   either `DHCPACK` (success) or `DHCPNAK`; a NAK is `RequestError::Nak` ([`src/dora/request.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/request.rs#L32)).
5. An ACK whose `yiaddr` is all zeros is treated as a rejection and resets to Init with `Nak`
   (`acquire.rs:41`).
6. `install` pushes the ACK into `net.ip`, `set_ip` hands the leased address to `net.l2` for ARP (best
   effort), the lease record is filled from the ACK, and state moves to `Bound` (`acquire.rs:44`).

Any error resets the client state to `Init` before returning, so a failed acquisition never leaves the client
half-configured ([`src/dora/acquire.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L58)). Discover failures map to `Timeout` (wait exhausted) or `NoLink`
(send failed), and request failures map to `Nak`, `Timeout`, or `NoLink` (`acquire.rs:63`, `acquire.rs:70`).

## Sending and waiting

`send_bootp` builds the BOOTP payload for the requested message type, wraps it in a broadcast UDP+IPv4+
Ethernet frame with source `0.0.0.0`, and ships it through `net.l2`; a build failure is `BuildFailed` and an
L2 send failure is `L2Failed` ([`src/dora/send_bootp.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/send_bootp.rs#L31)). The BOOTP buffer is a fixed 576 bytes
(`send_bootp.rs:27`). `wait_for` polls `net.l2` for inbound frames, extracts the DHCP payload from each, parses
it, and returns the first message whose xid matches and whose message type is one of the accepted set; other
frames (ARP, ICMP, races) are dropped ([`src/dora/wait_reply.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/wait_reply.rs#L37)). The poll budget is bounded to 4000
iterations, so a wedged link cannot deadlock the task: exhaustion is `WaitError::Timeout`, an empty ring
yields and retries, and a down link is `LinkDown` (`wait_reply.rs:23`, `wait_reply.rs:42`).

## Installing the accepted lease

`install` is the only path that mutates `net.ip`. It converts the ACK subnet mask to a CIDR prefix with
`mask_to_prefix`, rejecting a discontiguous mask as `BadMask`, then calls `apply_lease` to push the address,
prefix, and router; an IP-side refusal is `IpRefused` ([`src/dora/install.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/install.rs#L31)). The DNS server from the ACK
stays in capsule state and is not installed into `net.ip`, which does not yet host a DNS field
(`install.rs:28`). `mask_to_prefix` counts the leading ones and requires the mask to be contiguous (leading
ones plus trailing zeros exactly 32) before it returns a prefix length ([`src/dora/mask.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/mask.rs#L20)).

## Renew and release

Renew reissues a `DHCPREQUEST` for the currently-bound `yiaddr` against the original `server_id`, using a
synthetic offer built from the prior lease, and on ACK refreshes only the lease lifetime and returns to Bound;
a NAK collapses to Init ([`src/server/handlers/lease_renew.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_renew.rs#L30)). It requires setup complete and a live lease
first (`lease_renew.rs:31`, `lease_renew.rs:38`). Release sends a `DHCPRELEASE` for the bound address to the
lease's server, clears the interface in `net.ip` with `clear_lease`, and resets the lease and client state to
empty and Init; a release with no lease is idempotent ([`src/server/handlers/lease_release.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/lease_release.rs#L29)). Both
handlers pull the `(l2, ip, mac)` trio through `current`, which returns `None` (answered as `E_NO_LINK`) until
setup has cached all three ([`src/server/handlers/xid_mac.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/xid_mac.rs#L22)).

## The shared state and the lease record

All mutable state lives behind one process-global `STATE`, a `Global` struct constructed with a `const fn new`
so it needs no runtime initialisation ([`src/state/global.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L23), `global.rs:65`). It holds the L2 and IP
service ports as `AtomicU32` (written once at setup with `Release`, read with `Acquire`), and the MAC, the
client state, and the lease each behind a `spin::Mutex` ([`src/state/global.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L24)). `next_xid` draws four
random bytes through `crypto_random`, returning `None` if the draw is short and substituting 1 for a zero
result so a zero xid is never minted ([`src/state/global.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/global.rs#L42), `global.rs:56`).

The `Lease` record is the cached lease parameters: the IPv4, the prefix (the subnet mask as a bit count), the
gateway, the server id, the DNS, and the server-supplied lifetime in seconds ([`src/state/lease.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/lease.rs#L23)). The
capsule does not run its own expiry timers; renewal is driven by the caller through `OP_LEASE_RENEW`
([`src/state/lease.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/lease.rs#L17)). `Lease::empty` is the all-zero unleased state release resets to (`lease.rs:34`).

## What the capsule does not keep

The state here is exactly the transient DHCP runtime a lease client needs and nothing more. There is no
persistence: the lease and client state live in memory and vanish with the process. There is no lease history,
no stored client identifier, and no cross-boot record. The installed interface configuration belongs to
`net.ip`; this capsule owns the state machine, the pending transaction id, and the active lease snapshot.

## Source map

```
  userland/capsule_net_dhcp/src/dora/acquire.rs      the DISCOVER/OFFER/REQUEST/ACK ladder and reset-on-error
  userland/capsule_net_dhcp/src/dora/discover.rs     one DISCOVER, wait for OFFER
  userland/capsule_net_dhcp/src/dora/request.rs      one REQUEST, wait for ACK or NAK
  userland/capsule_net_dhcp/src/dora/wait_reply.rs   the bounded poll loop and xid/type filter
  userland/capsule_net_dhcp/src/dora/send_bootp.rs   build BOOTP, wrap in broadcast frame, ship via L2
  userland/capsule_net_dhcp/src/dora/install.rs      convert mask, apply the lease into net.ip
  userland/capsule_net_dhcp/src/dora/release.rs      fire-and-forget DHCPRELEASE
  userland/capsule_net_dhcp/src/dora/mask.rs         contiguous subnet mask to CIDR prefix
  userland/capsule_net_dhcp/src/dhcp/client_state.rs Init/Selecting/Requesting/Bound/Renewing
  userland/capsule_net_dhcp/src/state/global.rs      STATE, the atomic ports, the mutexes, next_xid
  userland/capsule_net_dhcp/src/state/lease.rs       the Lease record and empty()
  userland/capsule_net_dhcp/src/setup/run.rs         resolve net.l2 and net.ip, read the MAC
  userland/capsule_net_dhcp/src/setup/discover.rs    the service-lookup helper
  userland/capsule_net_dhcp/src/server/handlers/lease_renew.rs, lease_release.rs, xid_mac.rs   the renew/release paths
  userland/capsule_net_dhcp/src/main.rs              the setup retry and initial-acquire loops
```

Every reference above is verified against those trees.
