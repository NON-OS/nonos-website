---
title: "Contributing to net_core"
description: "This page is for a contributor who wants to change the network stack."
weight: 6
---
This page is for a contributor who wants to change the network stack. It covers where the source lives,
which folder owns which concern, the exact steps to add a service op, how to build and sign the capsule, and
the code standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/net-core/), the [protocol](/docs/userland/net-core/protocol/) page, the [server](/docs/userland/net-core/server/) page, the
[device](/docs/userland/net-core/device/) page, and the [iface](/docs/userland/net-core/iface/) page.

## Where the source lives

The capsule is at `userland/capsule_net_core/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, waits for setup, registers its services, and enters the server loop, which never returns
([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder or file | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NNET`, `NTCP`, `NUDP`, `NDNS`, `NDHC` wire formats, ops, and errnos | you change a request or reply layout, or add an op or errno |
| [`src/register.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs) | the four `net.*` service names and their ports | you add or rename a served service |
| [`src/server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs) | the poll-then-serve loop and the magic dispatch | you add a protocol or change the loop |
| `src/server/handlers/` | one handler per op, grouped by protocol | you add or change a service op |
| [`src/server/parse_req.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs), [`src/server/respond.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs) | the header parse and the reply encoder | you change the header or the reply shape |
| `src/device/` | the NIC driver link, the `phy::Device` bridge, and the RX/TX frame path | you change how frames reach the driver |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | NIC discovery, link-up, MAC, and building the state | you change the candidate list or the bring-up |
| `src/iface/` | building the smoltcp `Interface`, the poll loop, DHCP, and DNS install | you change address acquisition or the pump |
| [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | `NetState`, the lease, and the locked accessors | you add shared state or an accessor |
| [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs), [`src/udp_ports.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs) | the per-client TCP and UDP socket tables | you change socket ownership or capacity |

## Adding a service op

There are three edits, and the dispatch wiring is the load-bearing one. Take a new TCP op as the example.

1. Add the opcode constant to the protocol module, next to the existing ops ([`src/protocol/tcp.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L19)), and
   add any new errno it needs to the same file ([`src/protocol/tcp.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/tcp.rs#L27)).
2. Write the handler as one file under `src/server/handlers/tcp/`, exposing a `handle(sender_pid, req, body,
   tx)` function that validates the body length, resolves the socket through `handles::get(app_handle,
   sender_pid)` so it is scoped to the caller, does the work inside a `state::with_iface` closure, and ends
   by calling `reply` ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). `send.rs` and `recv.rs` are the reference shapes
   ([`src/server/handlers/tcp/send.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/send.rs#L25), [`src/server/handlers/tcp/recv.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/recv.rs#L25)). Declare the module in the
   protocol's `mod.rs` ([`src/server/handlers/tcp/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/mod.rs#L17)).
3. Wire it into that protocol's dispatch match ([`src/server/handlers/tcp/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tcp/mod.rs#L29)). The `_` arm already
   answers `E_BAD_OP`, so an unrouted op fails closed.

A new protocol is the same shape one level up: a new magic in `src/protocol/`, a new `dispatch` module under
`src/server/handlers/`, a new arm in the magic match ([`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52)), and, if applications call
it, a new service name and port in [`src/register.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/register.rs#L29).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:7`) and pulled in through `userland/capsule_net_core/Capsule.mk:17`. The slug is
`net-core`.

```
  make nonos-mk-net-core                build the capsule ELF
  make nonos-mk-net-core-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-core-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-net-core-keys     assert the per-capsule signing keys exist
```

The build target resolves to the capsule ELF (`nonos-mk/capsule.mk:182`), sign depends on the cert,
manifest, and attestation trailer (`nonos-mk/capsule.mk:261`), verify runs `verify-manifest` against the
baked trust-anchor policy (`nonos-mk/capsule.mk:263`), and the keys check asserts the ed25519 and mldsa65
seed and pub files (`nonos-mk/capsule.mk:184`). For a kernel image that embeds and spawns the stack,
`make nonos-mk-net-core-prod` builds the `microkernel-net-core` profile with the signed net_core artifacts
baked in (`Makefile:1030`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every setup path returns a `SetupError`
  ([`src/setup.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L27)) and every request path returns an errno word through `reply`; the release profile is
  `panic = "abort"` (`Cargo.toml:20`).
- Every socket op must be scoped to its caller. A TCP op resolves its handle through `handles::get`, which
  checks the owner pid ([`src/handles.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L35)); a UDP op is keyed on the caller pid and local port through
  `udp_ports::get` ([`src/udp_ports.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_ports.rs#L43)). A handler that skips that check is a boundary bug.
- One unit per file. New ops are one file per handler under `src/server/handlers/`, matching the existing
  tree. `mod.rs` is used only for module declarations, dispatch, and re-exports.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_core/src/main.rs                _start -> wait_for_setup -> register::all -> server::run
  userland/capsule_net_core/src/protocol/tcp.rs        the reference op and errno constants
  userland/capsule_net_core/src/server/handlers/tcp/mod.rs  the reference dispatch match and module list
  userland/capsule_net_core/src/server/handlers/tcp/send.rs, recv.rs  the reference handler shapes
  userland/capsule_net_core/src/server/runner.rs       the magic dispatch a new protocol wires into
  userland/capsule_net_core/src/register.rs            the service names and ports
  userland/capsule_net_core/src/handles.rs             the TCP owner-pid check
  userland/capsule_net_core/src/udp_ports.rs           the UDP pid+port key
  userland/capsule_net_core/src/setup.rs               the SetupError set
  userland/capsule_net_core/Cargo.toml                 panic = "abort" and the binary name
  userland/capsule_net_core/Capsule.mk                 slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                  the nonos-mk-net-core[-sign|-verify] target template
  Makefile                                             the microkernel-net-core -prod image target
```

Every reference above is verified against those trees.
