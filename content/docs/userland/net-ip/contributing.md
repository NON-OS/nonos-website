---
title: "Contributing to capsule_net_ip"
description: "This page is for a contributor who wants to change the IPv4 capsule."
weight: 7
---
This page is for a contributor who wants to change the IPv4 capsule. It covers where the source lives,
which folder owns which concern, the exact steps to add a client op, how to build and sign the capsule,
and the code standards a change has to meet. For what the capsule does and how it fits together, read
the [README](/docs/userland/net-ip/), the [operations](/docs/userland/net-ip/operations/) page, the [ipv4](/docs/userland/net-ip/ipv4/) page, the
[icmp](/docs/userland/net-ip/icmp/) page, the [routing](/docs/userland/net-ip/routing/) page, and the [state](/docs/userland/net-ip/state/) page.

## Where the source lives

The capsule is at `userland/capsule_net_ip/`. It is a `no_std`/`no_main` capsule: `_start` initialises
the heap, loops `setup::run` until it succeeds, and hands off to `server::run`, which loops forever
([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). It fits into the
decomposed [network stack](/docs/subsystems/networking/) between the transport capsules and
`net.l2`.

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NIP4` wire format: magic, ops, errno, limits | you change the request or reply layout |
| `src/server/` | the request loop, the per-op handlers, and the authz gate | you add or change a client op |
| [`src/server/authz.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs) | the registry-pid authorization for the control ops | you change who may configure or route |
| `src/ipv4/` | RFC 791 parse and build, the RFC 1071 checksum, address helpers | you touch the datagram format |
| `src/egress/`, [`src/ingress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs) | the outbound and inbound framing that wrap `ipv4` | you change how frames enter or leave |
| `src/icmp/` | the ICMP header, echo parse and build, the auto-responder | you touch the ping path |
| `src/route/` | the Route type and the 16-entry longest-prefix table | you change route storage or lookup |
| `src/l2_client/` | the `net.l2` client: MAC, ARP, TX, RX over IPC | you change how the wire is reached |
| `src/state/` | `IFACE`, the id counter, the bounded receive queue | you add interface state or change the queue |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | bring-up: resolve `net.l2`, read the MAC | you change the startup dependency order |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21) and re-export it from [`src/protocol/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L28).
   New ops require a constant here; the dispatch table never routes by name ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that
   validates the body length, does its work, and replies with `respond`, following `health.rs` (a
   status-only reply), `get_config.rs` (a reply with a body), or `send_packet.rs` (a body-bearing
   request). If the op is sensitive, gate it on `authz::authorized` for a named service or `authz::admin`
   for the administrative tier, matching `set_config.rs:29` and `route_add.rs:27`. Declare the module in
   [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45), passing `sender_pid`, the parsed
   request, the body slice for ops that carry one, and the transmit buffer. An unrecognised op already
   falls through to `E_BAD_OP` (`runner.rs:53`).

If the op adds a new failure condition, add its errno to [`src/protocol/errno.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L22) at the end of the
list and re-export it; never renumber a live errno, since the numbers are the wire contract
(`errno.rs:18`).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:1`) and pulled in through `userland/capsule_net_ip/Capsule.mk:20`. The slug is
`net-ip` (`Capsule.mk:7`), so the generated targets are:

```
  make nonos-mk-net-ip              build the capsule ELF
  make nonos-mk-net-ip-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-ip-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-net-ip-keys   assert the per-capsule signing keys exist
```

Those four names come straight from the template's `.PHONY` line with the slug interpolated
(`nonos-mk/capsule.mk:158`); the sign target aggregates the cert, manifest, and attestation
(`nonos-mk/capsule.mk:261`), and the verify target runs the manifest verifier against the baked
trust-anchor policy (`nonos-mk/capsule.mk:263`).

For a kernel image that embeds and spawns the capsule, `make nonos-mk-net-ip-prod` builds the
`microkernel-net-ip` feature profile with the signed `net-ip` and `net-l2` artifacts baked in
(`Makefile:1036`). The manifest, endpoints, and capability mask all live in the per-capsule
`Capsule.mk`; the root Makefile is forbidden by the static gate from defining any of those values
(`nonos-mk/capsule.mk:17`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every parse path returns a typed error
  and every request path returns an errno word; the release profile is `panic = "abort"`
  (`Cargo.toml:32`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and the existing
  tree keeps each protocol concern in its own module. `mod.rs` is used only for module declarations and
  re-exports, as in [`src/ipv4/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipv4/mod.rs#L17) and [`src/protocol/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L22).
- Keep the kernel spawn mirror in step with the manifest. The requested capabilities in
  [`src/userspace/capsule_net_ip/spawn.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_ip/spawn.rs#L55) must stay a subset of the manifest ceiling in
  `Capsule.mk:17`; changing one without the other either breaks the spawn or silently widens authority.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_ip/src/main.rs                _start -> setup retry -> server::run; module list
  userland/capsule_net_ip/src/protocol/ops.rs        the opcode constants
  userland/capsule_net_ip/src/protocol/errno.rs      the wire errno constants
  userland/capsule_net_ip/src/protocol/mod.rs        the protocol re-exports
  userland/capsule_net_ip/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_ip/src/server/runner.rs       the dispatch match
  userland/capsule_net_ip/src/server/respond.rs      the respond helper
  userland/capsule_net_ip/src/server/authz.rs        the authorized and admin gates
  userland/capsule_net_ip/Cargo.toml                 panic = "abort" and the binary name
  userland/capsule_net_ip/Capsule.mk                 slug, handle, ports, mask; includes the targets
  nonos-mk/capsule.mk                                the nonos-mk-net-ip[-sign|-verify] target template
  src/userspace/capsule_net_ip/spawn.rs              the requested caps that must track the manifest
  Makefile                                           the nonos-mk-net-ip-prod image target
```

Every reference above is verified against those trees.
</content>
