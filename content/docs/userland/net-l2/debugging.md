---
title: "Debugging capsule_net_l2"
description: "This page lists the log marker the L2 capsule's boot path emits, the one-time setup retry loop, and the concrete runtime failure modes with where to look for each."
weight: 7
---
This page lists the log marker the L2 capsule's boot path emits, the one-time setup retry loop, and the
concrete runtime failure modes with where to look for each. For the shape of the capsule see the
[README](/docs/userland/net-l2/), the [operations](/docs/userland/net-l2/operations/) page, the [framing](/docs/userland/net-l2/framing/) page, the
[cache](/docs/userland/net-l2/cache/) page, and the [nic-link](/docs/userland/net-l2/nic-link/) page.

## The boot marker

The first thing to confirm is that the capsule spawned. On a successful boot the kernel prints
`[NET-L2] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-L2`
([`src/userspace/init/spawn_plan/network/spawn_l2.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_l2.rs#L21)), whose `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). An absent line means
the capsule never started: either the `nonos-capsule-net-l2` feature was not built in
([`src/userspace/init/spawn_plan/network/spawn_l2.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_l2.rs#L18)), or the spawn failed, in which case the `Err` arm
prints a `boot_log::error` line instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). A spawn failure is a
signature, NØNOS-ID cert, manifest, or capability check inside `spawn_verified`
([`src/userspace/capsule_net_l2/spawn.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_l2/spawn.rs#L60)).

## The setup retry loop, not an exit code

Unlike a driver capsule, the L2 capsule does not exit on a setup failure. After the heap comes up, `_start`
loops in `wait_for_setup`, calling `setup::run` until it succeeds and yielding 64 times between attempts
([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38), [`src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L42)). Only heap init failure exits, with code 1 ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). So a
capsule that spawned but is not answering has almost always not finished setup: it is still looking for a
NIC. There are two reasons setup fails and retries.

- `SetupError::NoNic` ([`src/setup/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L26)): no service in the candidate list, `driver.virtio_net0`,
  `driver.e1000_0`, `driver.rtl8169_0`, `driver.rtl8139_0`, is registered yet
  ([`src/setup/discover.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L22), `discover.rs:36`). This is normal at early boot, before the NIC driver
  capsule has registered its service; L2 simply retries until it appears.
- `SetupError::MacFailed` ([`src/setup/mod.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L36)): a NIC was found but the `OP_MAC_ADDRESS` call to it failed
  or returned a bad response ([`src/nic_client/mac.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/mac.rs#L38), `mac.rs:47`). This points at the driver capsule,
  not L2: the NIC service registered but is not answering its MAC op cleanly.

## Runtime failure modes

After setup binds a NIC, failures surface as errno words in the response-header `flags` field, never as a
crash. The full set is on the [operations](/docs/userland/net-l2/operations/) page; these are the ones worth naming.

### Every send or poll returns `E_PERM`

`OP_SEND_FRAME` and `OP_POLL_FRAME` are gated to callers `net.ip` or `net.dhcp.client`, and `OP_SET_IP` to
`net.dhcp.client` alone ([`src/server/handlers/send_frame.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send_frame.rs#L24), `poll_frame.rs:29`, `set_ip.rs:26`). The
gate compares the kernel-attested `sender_pid` to the owner pid the service registry bound to that service
name ([`src/server/authz.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L32)). An `E_PERM` means the caller is not the registered owner of a permitted
service: either the caller is a different capsule, or the permitted service was never registered so its owner
pid lookup misses ([`src/server/authz.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L26)). It is not a link or NIC problem.

### A link, send, or poll returns `E_NO_LINK`

`OP_GET_LINK`, `OP_SEND_FRAME`, and `OP_POLL_FRAME` return `E_NO_LINK` when no NIC port is bound, meaning
setup has not completed ([`src/server/handlers/get_link.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_link.rs#L23), `send_frame.rs:29`, `poll_frame.rs:34`).
`OP_POLL_FRAME` also returns `E_NO_LINK` for any NIC receive error that is not an empty queue
([`src/server/handlers/poll_frame.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_frame.rs#L43)). If a link op returns `E_NO_LINK` after the capsule has been up for
a while, the NIC bind was lost or never happened; check the setup retry section above.

### A poll returns `E_RX_EMPTY`

The NIC had no frame to hand up: the driver's `OP_RX_PACKET` reply carried a non-zero status, which the NIC
client maps to `RxError::Empty` and the handler maps to `E_RX_EMPTY`
([`src/nic_client/rx/parse_payload.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/parse_payload.rs#L38), [`src/server/handlers/poll_frame.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_frame.rs#L40)). This is the normal idle
case, not an error; a caller polls again. A frame that arrived but did not fit the reply buffer also returns
`E_RX_EMPTY` ([`src/server/handlers/poll_frame.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_frame.rs#L54)).

### A send returns `E_TX_BUSY`

The frame reached the NIC client but the driver refused or failed the transmit: a negative call return, a
malformed reply, or a negative status word from the driver all become a `send_frame` error, which the handler
maps to `E_TX_BUSY` ([`src/nic_client/tx.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/tx.rs#L42), `tx.rs:63`, [`src/server/handlers/send_frame.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send_frame.rs#L38)). This is
a driver-side condition, distinct from `E_NO_LINK`, which fires before the frame ever reaches the driver.

### A resolve returns `E_NO_NEIGHBOUR`

The target IPv4 was not in the ARP cache, so L2 marked it pending and broadcast an ARP request, then returned
`E_NO_NEIGHBOUR` so the caller retries after the reply has had time to arrive
([`src/server/handlers/arp_resolve.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/arp_resolve.rs#L46)). If a resolve keeps returning `E_NO_NEIGHBOUR`, the reply is not
coming back: check that the interface IPv4 was set through `OP_SET_IP` so the outbound request carries a real
sender IP ([`src/server/handlers/set_ip.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_ip.rs#L36), [`src/arp/handle.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs#L68)), and that the target is actually on
the link. A conflicting reply that names a MAC different from an existing binding is rejected by the learn
policy and will not update the cache, which can also present as a persistent miss
([`src/arp/cache/learn.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/cache/learn.rs#L27)).

### A resolve or set-IP returns `E_BAD_LEN`

The body was not the exact fixed length: `OP_ARP_RESOLVE` requires exactly 4 target bytes and `OP_SET_IP`
exactly 4 address bytes, and either rejects a wrong length with `E_BAD_LEN` before touching state
([`src/server/handlers/arp_resolve.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/arp_resolve.rs#L29), `set_ip.rs:30`). A malformed header, short or wrong magic or
version, is caught earlier in the parser and, for a bad length there, also surfaces as `E_BAD_LEN`
([`src/protocol/decode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L21)).

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_l2.rs   the NET-L2 feature-gated spawn entry and marker tag
  src/userspace/init/capsule_boot/run.rs              the capsule-spawned / error boot markers
  src/userspace/capsule_net_l2/spawn.rs               spawn_verified: signature, cert, manifest, caps
  userland/capsule_net_l2/src/main.rs                 the heap-init exit and the setup retry loop
  userland/capsule_net_l2/src/setup/mod.rs            SetupError::NoNic and MacFailed
  userland/capsule_net_l2/src/setup/discover.rs       the NIC candidate list and the registry lookup
  userland/capsule_net_l2/src/server/authz.rs         the owner-pid check behind E_PERM
  userland/capsule_net_l2/src/server/handlers/get_link.rs, send_frame.rs, poll_frame.rs  the E_NO_LINK / E_TX_BUSY / E_RX_EMPTY paths
  userland/capsule_net_l2/src/server/handlers/arp_resolve.rs, set_ip.rs  the E_NO_NEIGHBOUR / E_BAD_LEN paths
  userland/capsule_net_l2/src/nic_client/tx.rs, rx/parse_payload.rs  the driver-side TX and RX error mapping
  userland/capsule_net_l2/src/arp/cache/learn.rs      the reject rule behind a persistent resolve miss
  userland/capsule_net_l2/src/protocol/decode.rs      the header-parse errno
```

Every reference above is verified against those trees.
</content>
