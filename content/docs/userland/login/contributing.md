---
title: "Contributing to capsule_login"
description: "This page is for a contributor who wants to change login."
weight: 5
---
This page is for a contributor who wants to change login. It covers where the source lives, which folder
owns which behaviour, how to change a handler or a peer wire, the build and sign steps, and the code
standards a change has to meet. For what login does and how it fits together, read the [README](/docs/userland/login/),
[the protocol page](/docs/userland/login/protocol/), [the unlock flow](/docs/userland/login/unlock/), and [the rendering page](/docs/userland/login/rendering/).

## Where the source lives

The capsule is at `userland/capsule_login/`. It is a `no_std`/`no_main` capsule: `_start` initializes the
heap, blocks in `wait_for_setup` until setup returns a `Context`, then runs the server loop
([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32), `:36`, `:37`). The six top-level modules are declared there ([`src/main.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L21)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NLGN` wire: header, ops, limits, errnos, decode/encode | you change the frame format, add an op number, or change a limit |
| `src/server/` | the receive loop and the four handlers | you change how a request is dispatched or what an op does |
| `src/state/` | the `Locked`/`Unlocked` session machine and its guards | you change the session model or the owner-pid rules |
| `src/clients/` | the outbound wires to keyring, desktop shell, and compositor | you change what login says to a peer |
| `src/render/` | the overlay painter (fill plus one bar, no text) | you change how the overlay looks |
| `src/setup/` | peer discovery and surface bring-up | you change startup ordering or the surface |

Every module keeps one unit per file with `mod.rs` used only for re-exports, matching the existing tree
([`src/protocol/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs), [`src/setup/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs), [`src/state/context/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/mod.rs)).

## Changing a handler

Each op is one file under `src/server/handlers/` (`start_session.rs`, `end_session.rs`, `get_state.rs`,
`health.rs`). Edit the one file for the op you are changing. The runner dispatches on the op constants and
enforces a body-shape guard per arm, so if you change what body an op takes, keep the guard in
[`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42) in step with the handler. A handler must never panic: it returns every outcome as
a status word through `respond::status` or `respond::payload`, the way `start_session` returns `E_INVAL`,
`E_BUSY`, `E_NOTREADY`, or `0` ([`src/server/handlers/start_session.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L11), `:36`, `:46`,
[`src/server/respond.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L5)).

If you touch the wire, keep [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs), [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs), and [`src/protocol/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs) in
step. A new op needs a number in `ops.rs`, a dispatch arm in `runner.rs`, and, if it carries a body, a
length constant in `limits.rs` and a body check in its handler like the 4-byte check in
`start_session.rs:10`.

## Changing a peer wire

Each peer is one client under `src/clients/`. The keyring client is the most sensitive: its op numbers must
match the [keyring](/docs/userland/keyring/) side, `OP_UNLOCK 5` and `OP_LOCK 4`
([`src/clients/keyring.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L8), `:9`). The desktop-shell client's magic, op, and body layout must match the
desktop shell (`NDSH`, `OP_NOTIFY 0x0005`, [`src/clients/desktop_shell.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/desktop_shell.rs#L6), `:9`), and the compositor client
must match the compositor (`NCMP`, three ops, [`src/clients/compositor/constants.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L16), `:19`). A client maps
a short reply to an errno rather than unwrapping, and callers must keep that discipline
([`src/clients/keyring.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L24), [`src/clients/compositor/status.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/status.rs#L22)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_login/Capsule.mk:14`.

```
  make nonos-mk-login              build the capsule ELF              capsule.mk:182
  make nonos-mk-login-sign         id cert, manifest, attestation     capsule.mk:261
  make nonos-mk-login-verify       verify artifacts vs trust anchor   capsule.mk:263
  make nonos-mk-check-login-keys   assert the per-capsule signing keys exist   capsule.mk:184
```

Login is part of the desktop fleet, so a bootable image that includes it is built by the profiles that pull
in `$(login_ARTIFACTS)`: the desktop GUI, the full GUI, and the setup wizard
(`Makefile:1081`, `:1111`, `:1133`).

```
  make nonos-mk-desktop-gui-prod   desktop GUI image with login       Makefile:1067
  make nonos-mk-full-gui-prod      full GUI image with login          Makefile:1093
  make nonos-mk-setup-wizard-prod  setup-wizard image with login      Makefile:1099
```

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns errors as a status
  word, and every peer client maps a short read to an errno instead of unwrapping
  ([`src/clients/keyring.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L24)).
- One unit per file. Handlers, state methods, clients, and setup steps are each their own file, and `mod.rs`
  is used only for re-exports, matching the existing tree.
- Keep the no-passphrase invariant. Do not add a text field, a character buffer, or an input subscription to
  this capsule; the credential belongs in the [keyring](/docs/userland/keyring/), and login's input surface is
  the 4-byte key id in `START_SESSION` and nothing else ([`src/protocol/limits.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L4)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_login/src/main.rs           _start -> wait_for_setup -> server::run; the six modules
  userland/capsule_login/src/protocol/         the NLGN wire to keep in step when you change an op
  userland/capsule_login/src/server/           the runner dispatch and the four handlers
  userland/capsule_login/src/clients/          the keyring, desktop-shell, and compositor wires
  userland/capsule_login/Capsule.mk            slug, endpoints, mask; includes the generated targets
  nonos-mk/capsule.mk                          the nonos-mk-login[-sign|-verify] target templates
  Makefile                                     the desktop-gui, full-gui, and setup-wizard image profiles
```

Every reference above is verified against those trees.