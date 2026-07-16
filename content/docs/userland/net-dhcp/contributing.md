---
title: "Contributing to capsule_net_dhcp"
description: "This page is for a contributor who wants to change the DHCP capsule."
weight: 5
---
This page is for a contributor who wants to change the DHCP capsule. It covers where the source lives, which
folder owns which concern, the steps to add a lease op, how to build and sign the capsule, and the code
standards a change has to meet. For what the capsule does and how it fits together, read the [README](/docs/userland/net-dhcp/),
the [operations](/docs/userland/net-dhcp/operations/) page, the [lease](/docs/userland/net-dhcp/lease/) page, the [transport](/docs/userland/net-dhcp/transport/) page, and the
[framing](/docs/userland/net-dhcp/framing/) page.

## Where the source lives

The capsule is at `userland/capsule_net_dhcp/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, loops calling `setup::run` until it succeeds, makes a bounded initial-acquire attempt, and then enters
`server::run`, which loops forever ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The top-level modules are declared there: `dhcp`,
`dora`, `frame`, `ip_client`, `l2_client`, `protocol`, `server`, `setup`, and `state` ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NDHC` wire constants: magic, ops, errno | you change an opcode, an errno, or the header |
| `src/server/` | the request loop, the parser, the reply encoder, and one handler per op | you add or change a lease op |
| `src/dora/` | the DISCOVER/OFFER/REQUEST/ACK ladder, install, release, mask | you change acquisition, renew, release, or lease install |
| `src/dhcp/` | the BOOTP message, its build and parse, and the RFC 2131/2132 constants | you change the on-wire DHCP format or option set |
| `src/frame/` | the Ethernet/IPv4/UDP compose and extract and the checksum | you change the outbound frame or the inbound peel |
| `src/l2_client/` | the `net.l2` client: MAC, send frame, poll frame, set ip | you change how the capsule reaches the wire |
| `src/ip_client/` | the `net.ip` client: `OP_SET_CONFIG` lease install and clear | you change how the lease installs into the IP layer |
| `src/state/` | the shared state, the client state, and the lease record | you change the lease fields or the state machine |
| `src/setup/` | resolving `net.l2` and `net.ip` and reading the NIC MAC | you change bring-up |

## Adding a lease op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17). The current set runs `1` through `5`; a new op takes
   the next value. If the op needs a new failure reason, add an errno to [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17) and
   re-export it from [`src/protocol/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L21).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle(sender_pid, req, tx)`
   function that reads state through `STATE` if needed and replies with `respond` ([`src/server/respond.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L44)).
   Follow `lease_status.rs` (a read that writes a body) or `lease_request.rs` (an op that drives the DORA
   ladder). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44). Every op arm passes the sender pid through so
   the handler can attribute the reply, and an unknown op falls through to `E_BAD_OP` (`runner.rs:50`).

An op that touches the acquisition path should go through `src/dora/`, not open its own L2 or IP socket, so the
one-place reset-on-error and reject-does-not-install rules stay intact ([`src/dora/acquire.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L58),
[`src/dora/install.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/install.rs#L31)).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_net_dhcp/Capsule.mk:17`. The slug is `net-dhcp`, so the generated targets are:

```
  make nonos-mk-net-dhcp                build the capsule ELF
  make nonos-mk-net-dhcp-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-dhcp-verify         verify the signed manifest against the trust-anchor policy
  make nonos-mk-check-net-dhcp-keys     assert the per-capsule signing seeds and pubs exist
```

The build rule compiles the capsule against the `x86_64-nonos-user` target with a `core,alloc` build-std
(`nonos-mk/capsule.mk:175`, `capsule.mk:72`). The sign rule derives the `nonos_id` from the handle, domain,
and recovery, signs the id cert and the CapsuleManifest v3 under the baked trust anchor, and proves the
attestation trailer over the capability mask (`nonos-mk/capsule.mk:204`, `capsule.mk:224`, `capsule.mk:245`).
The manifest carries the required-caps value straight from `CAPSULE_REQUIRED_CAPS` (`nonos-mk/capsule.mk:230`,
`Capsule.mk:14`), which is why the manifest mask and the `Capsule.mk` mask are the same by construction.

For a kernel image that embeds and spawns the DHCP capsule, `make nonos-mk-net-dhcp-prod` builds the
`microkernel-net-dhcp` profile with the signed IO, virtio-net, L2, IP, and DHCP artifacts baked in
(`Makefile:1048`). That profile enables the `nonos-capsule-net-dhcp` feature (`Cargo.toml:411`), which is the
`cfg` gate on the kernel-side embed ([`src/userspace/capsule_net_dhcp/embed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dhcp/embed.rs#L22)) and the spawn entry
([`src/userspace/init/spawn_plan/network/spawn_dhcp.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_dhcp.rs#L18)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Setup returns a `SetupError`, the ladder
  returns an `AcquireError`, and every request path returns an errno word; the release profile is
  `panic = "abort"` (`Cargo.toml:30`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`. `mod.rs` is used only for
  module declarations and re-exports, as in [`src/dhcp/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/mod.rs#L17) and [`src/frame/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/mod.rs#L17).
- A rejected or incomplete lease must not mutate `net.ip`. The only install path is `dora::install`, reached
  only after an ACK carries a non-zero `yiaddr`, and every error resets client state to Init first
  ([`src/dora/acquire.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dora/acquire.rs#L41), `acquire.rs:58`).
- Any inbound path must bound a wire-supplied length before it reads a body ([`src/dhcp/parse/parse_options.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp/parse/parse_options.rs#L37),
  [`src/frame/udp.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/frame/udp.rs#L51), [`src/l2_client/rx.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/l2_client/rx.rs#L64)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1)
  and every other module.

## Source map

```
  userland/capsule_net_dhcp/src/main.rs               _start -> setup retry -> initial acquire -> server::run; module list
  userland/capsule_net_dhcp/src/protocol/ops.rs       the opcode constants
  userland/capsule_net_dhcp/src/protocol/errno.rs     the errno constants
  userland/capsule_net_dhcp/src/protocol/mod.rs       the protocol re-exports
  userland/capsule_net_dhcp/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_dhcp/src/server/runner.rs      the dispatch match and the sender-pid gate
  userland/capsule_net_dhcp/src/server/respond.rs     the reply encoder handlers call
  userland/capsule_net_dhcp/src/dora/acquire.rs, install.rs   the reset-on-error and install-after-ACK rules
  userland/capsule_net_dhcp/Cargo.toml                panic = "abort" and the binary name
  userland/capsule_net_dhcp/Capsule.mk                slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                 the nonos-mk-net-dhcp[-sign|-verify] target template
  Makefile                                            the -prod image target
  Cargo.toml                                          the microkernel-net-dhcp feature profile
  src/userspace/capsule_net_dhcp/embed.rs             the feature-gated kernel embed
  src/userspace/init/spawn_plan/network/spawn_dhcp.rs the feature-gated spawn entry
```

Every reference above is verified against those trees.
