---
title: "Contributing to net_sockets"
description: "This page is for a contributor changing the sockets capsule."
weight: 6
---
This page is for a contributor changing the sockets capsule. It covers where the source lives, which folder
owns which concern, the exact steps to add an op or a socket kind, how to build and sign the capsule, and
the code standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/net-sockets/), the [operations](/docs/userland/net-sockets/operations/), [handles](/docs/userland/net-sockets/handles/), [transports](/docs/userland/net-sockets/transports/),
and [state](/docs/userland/net-sockets/state/) pages.

## Where the source lives

The capsule is at `userland/capsule_net_sockets/`. It is a `no_std`/`no_main` capsule: `_start`
initialises the heap, retries `state::discover` until it succeeds, and enters `server::run`, which loops
forever ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NSKT` wire: magic, ops, errno | you change the request or reply layout |
| `src/server/` | the receive loop, dispatch, and one handler per op | you add or change an op |
| `src/sockets/` | the `Kind` families, the `Socket` block, and the per-pid table | you change what a socket holds |
| `src/clients/` | the tcp, udp, and nym backend clients over the shared envelope | you change how an op reaches a transport |
| [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | the discovered transport ports and the handle counter home | you change bring-up or discovery |

## Adding an op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and re-export it from [`src/protocol/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L26).
   Match the existing dense numbering; the parser and dispatch key on the raw `u16`.
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that reads its
   body with the `io` helpers ([`src/server/handlers/io.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/io.rs#L19)), touches a socket through `SOCKETS.with`
   ([`src/sockets/table/lookup.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/lookup.rs#L22)), and replies through `respond` ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)).
   `health.rs` is the minimal shape and `send.rs` is the shape for an op that dispatches by kind to a
   backend. Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/handlers/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L24). An unrecognized op falls
   through to the `false` arm and the loop answers `E_BAD_OP` ([`src/server/handlers/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L36),
   [`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)), so the new arm is what makes the op reachable.

## Adding a socket kind or a backend

A new socket kind is a wider change because the kind is branched on in every data-path handler. Add the
variant to `Kind` ([`src/sockets/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/types.rs#L17)), map its wire value in `OP_SOCKET`
([`src/server/handlers/socket.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/socket.rs#L29)), and add the arm to the `match sock.kind` in `send`, `recv`, `close`,
and `connect` ([`src/server/handlers/send.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send.rs#L41), [`src/server/handlers/recv.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv.rs#L42),
[`src/server/handlers/close.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/close.rs#L34), [`src/server/handlers/connect.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect.rs#L32)); leave the sentinel meaning of
`transport_handle == 0` intact so a fresh socket of the new kind is inert until connected. A new backend is
one client module under `src/clients/`, keyed by its own magic and going through `envelope::call`
([`src/clients/envelope.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/envelope.rs#L23)); a stateful backend follows the multi-file `nym` split
([`src/clients/nym/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/nym/mod.rs#L17)), a stateless one follows the single-file `udp` shape ([`src/clients/udp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/udp.rs)).
If the backend is a new service, add its port to `state.rs` and decide in `discover` whether it is
mandatory like `net.tcp` or optional like `net.nym` ([`src/state.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L45)).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_net_sockets/Capsule.mk:16`. The slug is `net-sockets`, so the generated targets are:

```
  make nonos-mk-net-sockets                build the capsule ELF
  make nonos-mk-net-sockets-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-sockets-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-net-sockets-keys     assert the per-capsule signing keys exist
```

The verify target is folded into the aggregate release check through `$(net-sockets_VERIFY)`
(`Makefile:722`), and the signed artifacts feed the network production targets through
`$(net-sockets_ARTIFACTS)` (`Makefile:1063`). The kernel embeds the signed artifacts under the
`nonos-capsule-net-sockets` feature (`Capsule.mk:8`, [`src/userspace/capsule_net_sockets/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_sockets/embed.rs#L17)), and
the network spawn plan spawns it at boot ([`src/userspace/init/spawn_plan/network/spawn_sockets.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_sockets.rs#L17)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`; every request path returns an errno word
  and bring-up returns a `Result` the retry loop handles. The release profile is `panic = "abort"`
  (`Cargo.toml:29`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, new backends stay in
  their module under `src/clients/`, and `mod.rs` is used only for module declarations and re-exports
  ([`src/sockets/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/mod.rs#L17), [`src/clients/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/mod.rs#L17)).
- Scope every socket to its owner. The table keys on `(pid, handle)` with the pid stamped by the kernel, not
  the request ([`src/sockets/table/lookup.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/lookup.rs#L29)); a change that lets a caller name a handle without matching
  its pid breaks the per-pid isolation the [handles](/docs/userland/net-sockets/handles/) page documents.
- Keep transport state in the transport capsule. This capsule holds the handle table and the family policy;
  it holds no connection, datagram queue, or mixnet session. A change that caches transport state here
  duplicates truth the transports own.
- Bound every structure. The socket table is a fixed 256 slots ([`src/sockets/table/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sockets/table/types.rs#L22)); a full
  table returns `E_TABLE_FULL` rather than growing. A new per-caller structure needs its own cap.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_sockets/src/main.rs               _start, the discovery retry, and the module list
  userland/capsule_net_sockets/src/protocol/ops.rs       the opcode constants
  userland/capsule_net_sockets/src/protocol/mod.rs       the protocol re-exports
  userland/capsule_net_sockets/src/server/handlers/mod.rs  the handler module declarations
  userland/capsule_net_sockets/src/server/handlers/io.rs   the body-read helpers
  userland/capsule_net_sockets/src/server/handlers/dispatch.rs  the dispatch match
  userland/capsule_net_sockets/src/server/respond.rs     the reply encoder
  userland/capsule_net_sockets/src/sockets/types.rs      the Kind enum and the socket key
  userland/capsule_net_sockets/src/sockets/table/        the table open, lookup, and close
  userland/capsule_net_sockets/src/clients/              the backend clients and the shared envelope
  userland/capsule_net_sockets/src/state.rs             the discovered ports and their mandatory-vs-optional split
  userland/capsule_net_sockets/Cargo.toml               panic = "abort" and the binary name
  userland/capsule_net_sockets/Capsule.mk               slug, ports, mask, feature; includes the generated targets
  nonos-mk/capsule.mk                                    the nonos-mk-net-sockets[-sign|-verify] target template
  src/userspace/capsule_net_sockets/embed.rs            the feature-gated embed of the signed artifacts
  src/userspace/init/spawn_plan/network/spawn_sockets.rs the boot spawn entry
  Makefile                                               the aggregate verify and the production artifact rollup
```

Every reference above is verified against those trees.
