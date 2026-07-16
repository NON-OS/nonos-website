---
title: "Debugging capsule_wallet_nonos"
description: "The wallet fails in layers and is instrumented so the failing layer is visible rather than hidden behind a blank window."
weight: 8
---
The wallet fails in layers and is instrumented so the failing layer is visible rather than hidden behind a
blank window. This page lists the boot marker and the concrete failure modes with where to look for each.
Work the path from the outside in. For the model see the [README](/docs/userland/wallet-nonos/), the [views](/docs/userland/wallet-nonos/views/), the
[signing](/docs/userland/wallet-nonos/signing/), the [network](/docs/userland/wallet-nonos/network/), and the [rendering](/docs/userland/wallet-nonos/rendering/) pages in this folder.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[APP-NØNOS-WALLET] capsule spawned` from the capsule boot path: the `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is
absent the capsule never started, and the `Err` arm logged an error line through `boot_log::error`
instead ([`capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability failure.

## Failure modes

### Window up but the account never loads

The next stop is the keyring, because the address and every signature are IPC calls to it. The starting
`status` line is `keyring pending` ([`src/wallet/state/new.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/new.rs#L54)); the first event or tick runs `hydrate`
once behind the `ready` flag ([`src/wallet/app.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/app.rs#L41), `:52`). `hydrate` turns the status into
`wallet ready`, `keyring unavailable`, or `rail refresh failed` ([`src/wallet/state/hydrate.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/hydrate.rs#L30), `:36`,
`:38`).

- A wallet stuck on `keyring pending` never ran hydrate; the event or tick path is not firing.
- A `keyring unavailable` line means the keyring port or the wallet's own pid did not resolve
  (`hydrate.rs:29`).
- The `_ready` flags separate a keyring problem from a network problem: `address_ready` with no
  `balance_ready` is an address that loaded but a chain read that did not ([`src/wallet/state/types.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/types.rs#L42)).

### Address loads but balance and nonce do not

The failure is in the network path, and the probe ladder localises it. `probe_network` runs the stages in
order and folds the result into `NetStatus` ([`src/wallet/net/probe.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe.rs#L22)). `probe_rpc_tcp` reports
`resolve`, `socket`, and `connect` as three separate booleans, so a DNS failure, a socket-open failure,
and a TCP-connect failure are distinguishable ([`src/wallet/net/probe_rpc_tcp.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe_rpc_tcp.rs#L24)); `probe_tls_rpc` then
attempts the full TLS 1.3 handshake, and `probe_status` turns the combination into the status string the
Home view shows ([`src/wallet/net/probe_status.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe_status.rs#L17)).

That string is the sharpest diagnostic. It climbs from `route blocked`, `route ready`, `rpc tcp ready`,
`rpc tls hello`, `rpc tls record`, `rpc cert message`, `rpc cert chain`, `rpc CA anchor`, `rpc CA signed`,
`rpc host matched`, `rpc cert time`, `rpc tls finished`, `rpc client finish`, to `rpc chain 0x1`
(`probe_status.rs:18`), so the last line printed is exactly the last handshake step that succeeded. A
wallet that connects but shows no balance is failing inside TLS or the certificate chain, not at the
socket.

### A handshake that completes on the wire but is refused

This is a deliberate rejection, not a bug, and it is the one to suspect when the same endpoint worked
before and does not now. `chain_anchor` rejects a chain that does not terminate in the pinned GTS R4 root
([`src/wallet/tls13/chain_anchor.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/chain_anchor.rs#L17), `gts_r4_anchor.rs:17`), and `cert_valid_now` rejects one outside
its validity window against the RTC ([`src/wallet/tls13/cert_valid_now.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/cert_valid_now.rs),
[`src/wallet/net/rtc_stamp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/rtc_stamp.rs)). An endpoint that swaps its CA, or a wrong clock, presents exactly this way:
the probe string stops one rung short of `rpc CA anchor` or `rpc cert time`.

### Signing is the last layer, and it produces a proof

Signing is the easiest layer to confirm because a success is visible as a hash without broadcasting. A
successful `sign_eth`, `sign_nox`, or `sign_both` stores the transaction hash in `proof_eth_hash` /
`proof_nox_hash` and sets `proof_count`, rendered in the Proofs view ([`src/wallet/event/sign_both.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_both.rs#L57),
[`src/wallet/state/types.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/types.rs#L65)). The status line reports `transaction signed`, `2 tx proofs ready`,
`transaction sign failed`, or `transaction hash failed` ([`src/wallet/event/sign_result.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_result.rs#L30), `:35`,
`:40`, `sign_both.rs:64`). If the Proofs view fills but a broadcast never lands, the split is clean: the
keyring signed and the failure is the network send, which ends in `broadcast rejected`, `broadcast sent`,
`receipt pending`, or `receipt confirmed` ([`src/wallet/event/broadcast.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/broadcast.rs#L27), `:37`).

### Rendering blank or wrong

If the shell responds (the status line changes, a view switches) but the window shows nothing or a stale
frame, the split is between the model and the renderer. The handlers mutate `State`; `paint` projects it
into the surface ([`src/wallet/paint/paint.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/paint.rs#L21)). A blank frame with a live status line points at the
paint path, not the action layer. If the window never responds to keys or clicks at all, the suspect is
the input path into the app (compositor, wm, input_router), because `on_event` only forwards key-down,
button-down, and ignores the rest ([`src/wallet/event/on_event.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_event.rs#L21)).

## Source map

```
  src/userspace/init/capsule_boot/run.rs           [APP-NØNOS-WALLET] capsule spawned / error path
  userland/capsule_wallet_nonos/src/wallet/state/new.rs      the starting keyring-pending status
  userland/capsule_wallet_nonos/src/wallet/state/hydrate.rs  keyring unavailable / wallet ready
  userland/capsule_wallet_nonos/src/wallet/state/types.rs    the _ready flags and proof fields
  userland/capsule_wallet_nonos/src/wallet/net/probe.rs      the ordered probe ladder
  userland/capsule_wallet_nonos/src/wallet/net/probe_rpc_tcp.rs   resolve / socket / connect booleans
  userland/capsule_wallet_nonos/src/wallet/net/probe_status.rs    the ladder status string
  userland/capsule_wallet_nonos/src/wallet/tls13/chain_anchor.rs  the pinned-root rejection
  userland/capsule_wallet_nonos/src/wallet/event/sign_result.rs   the sign status lines
  userland/capsule_wallet_nonos/src/wallet/event/broadcast.rs     the broadcast and receipt status
  userland/capsule_wallet_nonos/src/wallet/paint/paint.rs         the frame projection
  userland/capsule_wallet_nonos/src/wallet/event/on_event.rs      the input gate
```

Every reference above is verified against those trees.
