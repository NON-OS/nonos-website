---
title: "Contributing to capsule_net_l2"
description: "This page is for a contributor who wants to change the L2 capsule."
weight: 6
---
This page is for a contributor who wants to change the L2 capsule. It covers where the source lives, which
folder owns which concern, the exact steps to add a client op or a NIC op, how to build and sign the capsule,
and the code standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/net-l2/), the [operations](/docs/userland/net-l2/operations/) page, the [framing](/docs/userland/net-l2/framing/) page, the
[cache](/docs/userland/net-l2/cache/) page, and the [nic-link](/docs/userland/net-l2/nic-link/) page. For where L2 sits in the stack, see the
[networking subsystem](/docs/subsystems/networking/).

## Where the source lives

The capsule is at `userland/capsule_net_l2/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, loops in `wait_for_setup` until `setup::run` binds a NIC, and only then enters `server::run`, which
loops forever ([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NL2` wire format: header, ops, errno, limits, parse and encode | you change the request or reply layout |
| `src/server/` | the request loop, the caller authz, the respond helpers, one handler per op | you add or change a client op |
| `src/setup/` | the one-time NIC discovery and MAC read | you change how the NIC is found or bound |
| [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | the NIC port/pid, MAC, IPv4, and ARP cache behind their locks | you add capsule-wide state |
| `src/ethernet/` | the 14-byte header parse/write and payload split | you touch Ethernet framing |
| `src/arp/packet/` | the 28-byte ARP packet codec | you change the ARP wire format |
| [`src/arp/handle.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/handle.rs) | the inbound ARP decision and the request/reply builders | you change ARP behaviour |
| `src/arp/cache/` | the bounded neighbour cache, learn policy, and pending ring | you change caching or eviction |
| [`src/ingress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs) | the inbound observer that learns ARP and emits replies | you change the inbound side-effect path |
| `src/nic_client/` | the `NNET` IPC client to the driver capsule | you change the driver-facing protocol |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21) and export it from [`src/protocol/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L31).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that reads the
   request, writes any payload after `HDR_LEN`, and replies with `respond` or `respond_status_only`,
   following `get_mac.rs` (a fixed payload) or `health.rs` (status only). If the op is sensitive, gate it on
   `authorized` or `authorized_any` first, like `send_frame.rs:24` or `set_ip.rs:26`. Declare the module in
   [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44). The unmatched arm already answers
   `E_BAD_OP`, so an opcode with no match is refused rather than mishandled ([`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52)).

If the op carries a fixed-length body, check the body length in the handler before using it, the way
`arp_resolve.rs:29` and `set_ip.rs:30` do, so a short or long payload is refused with `E_BAD_LEN`.

## Adding a NIC op

The driver-facing protocol is `NNET`, one op constant per line in [`src/nic_client/wire.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/wire.rs#L28). Add the
constant there, then add a call path under `src/nic_client/` that draws a request id with `seq::next`, writes
the request with `write_request`, issues `mk_ipc_call`, and validates the reply with `parse_response` before
trusting its payload. The MAC read ([`src/nic_client/mac.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/mac.rs#L30)), the transmit ([`src/nic_client/tx.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/tx.rs#L32)),
and the receive ([`src/nic_client/rx/poll_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/poll_frame.rs#L28)) are the three reference shapes; the receive keeps its
strict payload decode in its own file ([`src/nic_client/rx/parse_payload.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/parse_payload.rs#L23)). Match the errno-return shape
of the existing paths; none of them panic.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:1`) and pulled in through `userland/capsule_net_l2/Capsule.mk:19`. The slug is `net-l2`
(`Capsule.mk:6`), so the target names are:

```
  make nonos-mk-net-l2              build the capsule ELF
  make nonos-mk-net-l2-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-l2-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-net-l2-keys   assert the per-capsule signing keys exist
```

The signing step binds the capability ceiling from `CAPSULE_REQUIRED_CAPS` into the cert and manifest
(`Capsule.mk:16`, `nonos-mk/capsule.mk:71`, `nonos-mk/capsule.mk:230`). For a kernel image that embeds and
spawns the capsule, `make nonos-mk-net-l2-prod` builds the `microkernel-net-l2` profile with the signed L2
artifacts and the underlying virtio-net driver baked in (`Makefile:1024`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every setup path returns a `SetupError` and
  every request path returns a wire errno; the release profile is `panic = "abort"` (`Cargo.toml:28`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and each cache operation
  is its own file under `src/arp/cache/`, matching the existing tree. `mod.rs` is used only for module
  declarations and re-exports, as in [`src/arp/cache/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/cache/mod.rs#L17) and [`src/protocol/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L17).
- Keep the boundaries the capsule was designed around: no IP route policy, no transport, no DHCP or DNS, no
  socket table, and no hardware access belong here. The NIC-side authority stays in the driver capsule
  ([`src/userspace/capsule_net_l2/spawn.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_l2/spawn.rs#L17)); L2 reaches it only by IPC.
- Keep state bounded. The ARP cache and pending ring are fixed-size by construction
  ([`src/arp/cache/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arp/cache/constants.rs#L17)); do not replace them with a growable structure.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_l2/src/main.rs                _start -> wait_for_setup -> server::run; module list
  userland/capsule_net_l2/src/protocol/ops.rs        the opcode constants
  userland/capsule_net_l2/src/protocol/mod.rs        the protocol re-exports
  userland/capsule_net_l2/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_l2/src/server/runner.rs       the dispatch match and the E_BAD_OP arm
  userland/capsule_net_l2/src/server/authz.rs        the owner-pid caller check
  userland/capsule_net_l2/src/nic_client/wire.rs     the NNET op constants
  userland/capsule_net_l2/src/nic_client/header/     write_request and parse_response
  userland/capsule_net_l2/src/nic_client/mac.rs, tx.rs, rx/  the three reference NIC call paths
  userland/capsule_net_l2/src/arp/cache/constants.rs the fixed cache and pending bounds
  userland/capsule_net_l2/Cargo.toml                 panic = "abort" and the binary name
  userland/capsule_net_l2/Capsule.mk                 slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                the nonos-mk-net-l2[-sign|-verify] target template
  Makefile                                           the nonos-mk-net-l2-prod image target
  src/userspace/capsule_net_l2/spawn.rs              the kernel-side verified spawn
```

Every reference above is verified against those trees.
</content>
