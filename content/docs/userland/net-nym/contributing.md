---
title: "Contributing to net_nym"
description: "This page is for a contributor changing the Nym capsule."
weight: 9
---
This page is for a contributor changing the Nym capsule. It covers where the source lives, which folder owns
which concern, the exact steps to add an op, how to build and sign the capsule, and the code standards a
change has to meet. For what the capsule does and how it fits together, read the [README](/docs/userland/net-nym/), the
[operations](/docs/userland/net-nym/operations/), [packet](/docs/userland/net-nym/packet/), [mixnet](/docs/userland/net-nym/mixnet/), [directory](/docs/userland/net-nym/directory/),
[transport](/docs/userland/net-nym/transport/), and [state](/docs/userland/net-nym/state/) pages.

## Where the source lives

The capsule is at `userland/capsule_net_nym/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, retries `setup::run` until it succeeds, and enters `server::run`, which loops forever
([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). Before changing anything,
note that the capsule's own `README.md` describes an earlier beta scaffold and is out of date; the code, the
`Capsule.mk`, and this documentation are the current truth. If you touch identity or the op set, update the
capsule `README.md` too so the two stop diverging.

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NYM1` wire: magic, ops, errno, limits | you change the request or reply layout |
| `src/server/` | the receive loop, the authz gate, dispatch, and one handler per op | you add or change an op |
| `src/packet/` | the `NYMP` wire packet: header, AEAD payload, replay tag | you change the on-wire packet format |
| `src/route/` | the Sphinx route header and its key schedule | you change how the layered header is built |
| `src/crypto/` | the crypto syscall wrappers | you change which primitive a path uses |
| `src/topology/` | the signed directory: parse, verify, epoch, select | you change directory handling or routing |
| `src/directory_sync/` | the HTTP fetch of a directory over `net.tcp` | you change directory fetching |
| `src/gateway_client/` | the raw-TCP and WebSocket gateway link | you change the gateway transport |
| `src/tcp_client/` | the `NTCP` client to `net.tcp` | you change how bytes reach `net.tcp` |
| `src/state/` | sessions, replay, credential, authority, surb, timing | you change what per-owner state is held |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | the `net.tcp` lookup | you change bring-up |

## Adding an op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and re-export it from [`src/protocol/mod.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L33). If it
   carries a body, read the fields with the `io` helpers ([`src/server/handlers/io.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/io.rs#L19)) rather than
   open-coding little-endian reads, and bound any payload against the existing `MIX_PAYLOAD_MAX` /
   `IPC_PAYLOAD_MAX` limits ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)) rather than a new magic number.
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that takes the
   sender pid, the request, the body, and the tx buffer, touches state through `TABLE.lock()` or the
   `state` re-exports, and replies through `respond` ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)). `health.rs` is the minimal
   shape, `send.rs` is the shape for a data op that mutates a session, and `set_topology.rs` is the shape for
   a gated control op. If the op is control-plane, gate it with `admin(pid)` first and reply `E_PERM` on a
   miss ([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/handlers/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/dispatch.rs#L24). An unrecognized op already falls
   through to the `E_BAD_OP` reply in the runner ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)), so the new arm is what makes the
   op reachable.

## Adding a wire or crypto change

The packet format, the route header, and the directory format are each versioned by a magic and a version
byte: `NYMP` version 1 ([`src/packet/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/header.rs#L17)), the route header version at build byte 32
([`src/route/sphinx/build.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/build.rs#L36)), and `NYMD` version 1 ([`src/topology/parse.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/parse.rs#L49)). A wire change bumps the
matching version and updates both the writer and the reader; do not change a layout without moving the
version, because a gateway or a directory publisher on the other side keys off it. Any new primitive goes
through a `src/crypto/` wrapper that calls a `crypto_*` syscall and validates the returned length; the
capsule does not implement its own AEAD, ECDH, KDF, or hash in Rust, and it should not start ([`src/crypto/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/mod.rs#L24)).
The one exception already in the tree is the WebSocket SHA-1 and base64, which are protocol glue, not security
crypto ([`src/gateway_client/ws/sha1.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gateway_client/ws/sha1.rs#L21)).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:7`) and pulled in through `userland/capsule_net_nym/Capsule.mk:16`. The slug is
`net-nym`, so the generated targets are:

```
  make nonos-mk-net-nym                build the capsule ELF
  make nonos-mk-net-nym-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-nym-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-net-nym-keys     assert the per-capsule signing keys exist
```

The verify target is folded into the aggregate release check through `$(net-nym_VERIFY)` (`Makefile:722`).
The kernel embeds the signed artifacts under the `nonos-capsule-net-nym` feature (`Capsule.mk:9`,
[`src/userspace/capsule_net_nym/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_nym/embed.rs#L17)), and the network spawn plan spawns it at boot
([`src/userspace/init/spawn_plan/network/spawn_nym.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_nym.rs#L21)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`; every request path returns an errno word and
  every bring-up path returns a typed error. The release profile is `panic = "abort"` (`Cargo.toml:26`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and `mod.rs` is used only
  for module declarations and re-exports. The state, route, and crypto trees already follow this closely,
  with types, ops, and stores split into their own files.
- Zeroize key material on every exit path. Session keys are filled with zeros on close and reset
  ([`src/state/session.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/session.rs#L57)), and the route builder zeroizes the ephemeral private key, public key, and hop
  keys even on a failure path ([`src/route/sphinx/build.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/build.rs#L47)). A new path that handles key bytes has to do
  the same.
- Keep the trust root fail-closed. The directory and credential verify paths reject with an error when no
  authority is set, rather than defaulting to trust ([`src/topology/verify.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/verify.rs#L29),
  [`src/state/credential/verify.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/credential/verify.rs#L40)); a change must not introduce a path that routes without a verified
  directory and credential.
- Bound every per-owner and per-session structure. The session table (32), the receive queue (8), the replay
  window (64), the SURB store (64), and the directory node cap (128) each have an explicit limit; a new queue
  needs one too.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_nym/src/main.rs                _start, the setup retry, and the module list
  userland/capsule_net_nym/src/protocol/ops.rs        the opcode constants
  userland/capsule_net_nym/src/protocol/mod.rs        the protocol re-exports
  userland/capsule_net_nym/src/protocol/limits.rs     the payload bounds
  userland/capsule_net_nym/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_nym/src/server/handlers/io.rs  the body-read helpers
  userland/capsule_net_nym/src/server/handlers/dispatch.rs the dispatch match
  userland/capsule_net_nym/src/server/authz.rs        the admin gate
  userland/capsule_net_nym/src/server/respond.rs      the reply encoder
  userland/capsule_net_nym/src/crypto/mod.rs          the crypto wrapper re-exports
  userland/capsule_net_nym/Cargo.toml                 panic = "abort" and the binary name
  userland/capsule_net_nym/Capsule.mk                 slug, ports, mask, feature; includes the generated targets
  nonos-mk/capsule.mk                                 the nonos-mk-net-nym[-sign|-verify] target template
  src/userspace/capsule_net_nym/embed.rs              the feature-gated embed of the signed artifacts
  src/userspace/init/spawn_plan/network/spawn_nym.rs  the boot spawn entry
  Makefile                                            the aggregate verify that folds in net-nym
```

Every reference above is verified against those trees.
