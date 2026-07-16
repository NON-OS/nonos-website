---
title: "Contributing to net_tcp"
description: "This page is for a contributor changing the TCP capsule."
weight: 7
---
This page is for a contributor changing the TCP capsule. It covers where the source lives, which folder owns
which concern, the exact steps to add an op or a state transition, how to build and sign the capsule, and the
code standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/net-tcp/), the [operations](/docs/userland/net-tcp/operations/), [connections](/docs/userland/net-tcp/connections/), [segments](/docs/userland/net-tcp/segments/),
[state](/docs/userland/net-tcp/state/), and [ip-link](/docs/userland/net-tcp/ip-link/) pages.

## Where the source lives

The capsule is at `userland/capsule_net_tcp/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, retries `setup::run` until it succeeds, and enters `server::run`, which loops forever
([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NTCP` wire: magic, ops, errno, limits, header | you change the request or reply layout |
| `src/server/` | the request loop, dispatch, and one handler per op | you add or change an op |
| `src/server/tcp_rx/` | the receive path and the TCP state transitions | you change how a segment drives the machine |
| `src/tcp/` | segment build/parse, checksum, seq, ISS, RTT, cc, window, TCB | you change the wire format or a protocol algorithm |
| `src/state/` | the TCB table, retx queue, reassembly, timers, process locals | you change what per-connection state is held |
| `src/ip_client/` | the `net.ip` client over the `NIP4` wire | you change how segments reach or leave IPv4 |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | the ISS seed, `net.ip` lookup, and config read | you change bring-up |
| [`src/clock.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clock.rs) | the millisecond time source | you change the time base |

## Adding an op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and re-export it from [`src/protocol/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L28). If it
   carries a fixed payload, express the bound with the existing `SEGMENT_PAYLOAD_MAX` / `IPC_PAYLOAD_MAX`
   limits ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)) rather than a new magic number.
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that reads its
   body with the `io` helpers ([`src/server/handlers/io.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/io.rs#L19)), touches state through `TABLE.lock()`, and
   replies through `respond` ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)). `health.rs` is the minimal shape and `send.rs` is
   the shape for an op that mutates a connection. Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45). An unrecognized op already falls through to
   the `E_BAD_OP` arm ([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54)), so the new arm is what makes the op reachable.

## Adding or changing a state transition

The state machine is split by phase under `src/server/tcp_rx/`. The dispatcher `existing::update` routes a
matched segment to a transition by state ([`src/server/tcp_rx/existing.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L49)); the transitions themselves are
`handshake::step`, `established::step`, and `closing::step` under
`src/server/tcp_rx/transitions/`. To change a transition, edit the matching `step` and return the right
`RxAction` ([`src/server/tcp_rx/action.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/action.rs#L21)), keeping the sequence checks going through [`src/tcp/seq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/seq.rs)
rather than open-coding modular comparisons. A new state means a variant in [`src/tcp/state.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/state.rs#L19) and a
matching arm wherever `accepts_data` or `is_closing` is consulted; keep the `repr(u8)` discriminant stable,
because `OP_STATE` returns it on the wire ([`src/server/handlers/state.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/state.rs#L28)).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:6`) and pulled in through `userland/capsule_net_tcp/Capsule.mk:17`. The slug is
`net-tcp`, so the generated targets are:

```
  make nonos-mk-net-tcp                build the capsule ELF
  make nonos-mk-net-tcp-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-tcp-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-net-tcp-keys     assert the per-capsule signing keys exist
```

The verify target is folded into the aggregate release check through `$(net-tcp_VERIFY)` (`Makefile:721`).
The kernel embeds the signed artifacts under the `nonos-capsule-net-tcp` feature (`Capsule.mk:8`,
[`src/userspace/capsule_net_tcp/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_tcp/embed.rs#L17)), and the network spawn plan spawns it at boot
([`src/userspace/init/spawn_plan/network/spawn_tcp.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_tcp.rs#L17)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`; every request path returns an errno word and
  every bring-up path returns a typed error. The release profile is `panic = "abort"` (`Cargo.toml:26`). The
  reassembly and connect paths that could unwrap instead carry total fallbacks with a comment saying why
  ([`src/state/reasm.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/reasm.rs#L50)).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, new transitions stay in
  their phase file under `src/server/tcp_rx/transitions/`, and `mod.rs` is used only for module declarations
  and re-exports.
- Keep timers, retransmission, buffers, and sequence state in this capsule. The kernel owns no TCP state, and
  a change that pushes any of it into a syscall breaks the boundary the [README](/docs/userland/net-tcp/) documents.
- Bound every per-connection and per-client structure. The receive queue, send buffer, reassembly map,
  retransmit count, connection table, and per-pid connection count each have an explicit cap in
  [`src/tcp/mod.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L38); a new queue needs one too.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_tcp/src/main.rs               _start, the setup retry, and the module list
  userland/capsule_net_tcp/src/protocol/ops.rs       the opcode constants
  userland/capsule_net_tcp/src/protocol/mod.rs       the protocol re-exports
  userland/capsule_net_tcp/src/protocol/limits.rs    the payload bounds
  userland/capsule_net_tcp/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_tcp/src/server/handlers/io.rs  the body-read helpers
  userland/capsule_net_tcp/src/server/runner.rs      the dispatch match
  userland/capsule_net_tcp/src/server/respond.rs     the reply encoder
  userland/capsule_net_tcp/src/server/tcp_rx/existing.rs        the transition dispatcher
  userland/capsule_net_tcp/src/server/tcp_rx/transitions/       the per-phase step functions
  userland/capsule_net_tcp/src/server/tcp_rx/action.rs          the RxAction enum
  userland/capsule_net_tcp/src/tcp/state.rs          the state enum and its predicates
  userland/capsule_net_tcp/src/tcp/mod.rs            the sizing bounds
  userland/capsule_net_tcp/Cargo.toml               panic = "abort" and the binary name
  userland/capsule_net_tcp/Capsule.mk               slug, ports, mask, feature; includes the generated targets
  nonos-mk/capsule.mk                                the nonos-mk-net-tcp[-sign|-verify] target template
  src/userspace/capsule_net_tcp/embed.rs            the feature-gated embed of the signed artifacts
  src/userspace/init/spawn_plan/network/spawn_tcp.rs the boot spawn entry
  Makefile                                           the aggregate verify that folds in net-tcp
```

Every reference above is verified against those trees.
