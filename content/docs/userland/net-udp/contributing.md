---
title: "Contributing to capsule_net_udp"
description: "This page is for a contributor who wants to change the UDP capsule."
weight: 4
---
This page is for a contributor who wants to change the UDP capsule. It covers where the source lives, which
folder owns which concern, the steps to add a client op, how to build and sign the capsule, and the code
standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/net-udp/), the [operations](/docs/userland/net-udp/operations/) page, the [datagram](/docs/userland/net-udp/datagram/) page, and the
[state](/docs/userland/net-udp/state/) page.

## Where the source lives

The capsule is at `userland/capsule_net_udp/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, loops calling `setup::run` until it succeeds, and then enters `server::run`, which loops forever
([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). The top-level modules are declared there: `ip_client`, `protocol`, `server`, `setup`,
`state`, and `udp` ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NUDP` wire constants: magic, ops, errno, limits | you change an opcode, an errno, or the payload ceiling |
| `src/server/` | the request loop, the parser, the reply encoder, and one handler per op | you add or change a client op |
| `src/udp/` | the UDP header parse and build and the RFC 768 checksum | you change the on-wire UDP format or the checksum |
| `src/ip_client/` | the `net.ip` IPC client: the envelope, config, send, poll | you change how the capsule talks to `net.ip` |
| `src/state/` | the bind table, the per-bind receive ring, and the shared state | you change binding, ownership, or the queue depth |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | resolving `net.ip` and caching the port and local IPv4 | you change bring-up |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17). The current set runs `1` through `5`; a new op takes
   the next value. If the op needs a new failure reason, add an errno to [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17) and
   re-export it from [`src/protocol/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L22).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that reads the
   body, mutates state through `STATE` if needed, and replies with `respond` ([`src/server/respond.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L44)).
   Follow `bind.rs` (a state mutation with a length-checked body) or `send.rs` (an op that reaches
   `net.ip`). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17). A handler that grows past one concern
   should be split into a folder with a `mod.rs` re-export, the way `recv/` splits into `handle`, `deliver`,
   and `drain` ([`src/server/handlers/recv/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv/mod.rs#L17)).
3. Wire it into the dispatch match in [`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44). Every op arm passes the sender pid through
   so the handler can attribute the request; an op that owns or acts on a port must check ownership with
   `find_owned_mut` before it acts ([`src/state/table.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table.rs#L36)), the way send, recv, and unbind do.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:1`) and pulled in through `userland/capsule_net_udp/Capsule.mk:17`. The slug is
`net-udp`, so the generated targets are:

```
  make nonos-mk-net-udp                build the capsule ELF
  make nonos-mk-net-udp-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-udp-verify         verify the signed manifest against the trust-anchor policy
  make nonos-mk-check-net-udp-keys     assert the per-capsule signing seeds and pubs exist
```

The build rule compiles the capsule against the `x86_64-nonos-user` target with a `core,alloc` build-std
(`nonos-mk/capsule.mk:167`). The sign rule derives the `nonos_id` from the handle, domain, and recovery,
signs the id cert and the CapsuleManifest v3 under the baked trust anchor, and proves the attestation
trailer over the capability mask (`nonos-mk/capsule.mk:200`, `capsule.mk:221`, `capsule.mk:242`). The
manifest carries the required-caps value straight from `CAPSULE_REQUIRED_CAPS` (`nonos-mk/capsule.mk:230`),
which is why the manifest mask and the `Capsule.mk` mask are the same by construction.

For a kernel image that embeds and spawns the UDP capsule, `make nonos-mk-net-udp-prod` builds the
`microkernel-net-udp` profile with the signed IO, virtio-net, L2, IP, and UDP artifacts baked in
(`Makefile:1042`). That profile enables the `nonos-capsule-net-udp` feature (`Cargo.toml:401`), which is the
`cfg` gate on the kernel-side embed ([`src/userspace/capsule_net_udp/embed.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_udp/embed.rs#L20)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Setup returns a `SetupError`, every table
  operation returns a `TableError`, and every request path returns an errno word; the release profile is
  `panic = "abort"` (`Cargo.toml:27`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and a handler that grows
  past one concern splits into a folder, the way `recv/` did. `mod.rs` is used only for module declarations
  and re-exports, as in [`src/protocol/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L17) and [`src/udp/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/mod.rs#L17).
- Port ownership is keyed on the kernel-attested sender pid. Any op that acts on a port must confirm the
  sender owns it before acting ([`src/server/handlers/send.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L41)), and any inbound path must bound a
  wire-supplied length before it reads a body ([`src/ip_client/recv/poll.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ip_client/recv/poll.rs#L44), [`src/udp/parse.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp/parse.rs#L43)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_udp/src/main.rs               _start -> setup retry -> server::run; module list
  userland/capsule_net_udp/src/protocol/ops.rs       the opcode constants
  userland/capsule_net_udp/src/protocol/errno.rs     the errno constants
  userland/capsule_net_udp/src/protocol/mod.rs       the protocol re-exports
  userland/capsule_net_udp/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_udp/src/server/runner.rs      the dispatch match and the sender-pid gate
  userland/capsule_net_udp/src/server/respond.rs     the reply encoder handlers call
  userland/capsule_net_udp/src/state/table.rs        the ownership match a new op must respect
  userland/capsule_net_udp/Cargo.toml                panic = "abort" and the binary name
  userland/capsule_net_udp/Capsule.mk                slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                the nonos-mk-net-udp[-sign|-verify] target template
  Makefile                                           the -prod image target
  Cargo.toml                                         the microkernel-net-udp feature profile
  src/userspace/capsule_net_udp/embed.rs             the feature-gated kernel embed
```

Every reference above is verified against those trees.
