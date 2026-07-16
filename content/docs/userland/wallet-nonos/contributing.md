---
title: "Contributing to capsule_wallet_nonos"
description: "This page is for a contributor who wants to change the wallet."
weight: 7
---
This page is for a contributor who wants to change the wallet. It covers where the source lives, which
folder owns which behaviour, the exact steps to add a user action, how to build and sign the capsule, and
the code standards a change has to meet. For what the wallet does and how it is put together, read the
[README](/docs/userland/wallet-nonos/), the [views](/docs/userland/wallet-nonos/views/), the [signing](/docs/userland/wallet-nonos/signing/), the [network](/docs/userland/wallet-nonos/network/), and the
[rendering](/docs/userland/wallet-nonos/rendering/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_wallet_nonos/`. It is a `no_std`/`no_main` app-skeleton GUI app:
`_start` hands `Wallet::new` to the skeleton's `run`, and the runtime owns the surface, window, input
subscription, and paint loop ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). The top-level modules are declared under `src/wallet/`
([`src/wallet/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/mod.rs#L17)), and the `App` implementation that ties them together is [`src/wallet/app.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/app.rs#L35).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/wallet/state/` | the model: `State`, the view and field constants, hydrate, record_tx, rail filter | you change the wallet's data model |
| `src/wallet/event/` | input handlers: keys, pointer, the Send form, the actions | you change a keybinding or add an action |
| `src/wallet/ipc/` | the keyring client: op numbers, request/reply, sign, address, rails | you change what the wallet asks the keyring |
| `src/wallet/rpc/` | the hand-built JSON-RPC request builders and response parsers | you change an eth_* call or a parser |
| `src/wallet/net/` | sockets and DNS over IPC, the probe ladder, broadcast, receipt | you change the transport or the probe |
| `src/wallet/tls13/` | the from-scratch TLS 1.3 client and its pinned-root trust | you change the handshake or the trust anchor |
| `src/wallet/paint/` | the renderer: sidebar, topbar, view bodies, cards, status bar | you change how a frame is drawn |

## Adding a user action

Most new actions belong under `src/wallet/event/`. There are four edits, and the key or pointer wiring is
the load-bearing one.

1. Write the handler as one file under `src/wallet/event/`, taking `&mut State` and returning an
   `EventOutcome` (for example [`src/wallet/event/generate.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/generate.rs#L22)). Report failure by setting `state.status`
   to a byte string and returning `EventOutcome::Repaint`, never by panicking, the way `sign_eth` reports
   `recipient incomplete` and `amount too large` ([`src/wallet/event/sign_eth.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_eth.rs#L24), `:28`, `:32`).

2. Wire the key into the match in [`src/wallet/event/on_key.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_key.rs#L21), or the pointer hit-test into
   [`src/wallet/event/on_pointer.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_pointer.rs#L21), and add the module to [`src/wallet/event/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/mod.rs#L17). A Send-form key
   goes through the `state.view == VIEW_SEND` arm and into `send_input`
   ([`src/wallet/event/on_key.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_key.rs#L36)).

3. If it touches the keyring, add the op number to [`src/wallet/ipc/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/constants.rs#L19) and the marshalling to
   a new file under `src/wallet/ipc/`, following the request/reply shape in [`src/wallet/ipc/call.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/call.rs#L23),
   and re-export it from [`src/wallet/ipc/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/mod.rs#L29). If it touches the chain, add the request builder and
   parser under `src/wallet/rpc/` and the socket step under `src/wallet/net/`.

4. If it needs a new render, add a `paint_*` file under `src/wallet/paint/` and dispatch it from
   [`src/wallet/paint/paint.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/paint.rs#L21), and re-export it from [`src/wallet/paint/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/mod.rs#L17).

## Build and sign

The per-slug make targets are generated from the shared macro in `nonos-mk/capsule.mk:158`, pulled in
through `userland/capsule_wallet_nonos/Capsule.mk:13`, and expanded for `<slug> = wallet-nonos`.

```
  make nonos-mk-wallet-nonos               build the capsule ELF
  make nonos-mk-wallet-nonos-sign          id cert, manifest, attestation trailer
  make nonos-mk-wallet-nonos-verify        verify the signed artifacts vs the trust anchor
  make nonos-mk-check-wallet-nonos-keys    assert the per-capsule signing keys exist
```

There is no wallet-specific `-prod` desktop target. The wallet ships as part of the full desktop image,
and its verify rule and artifacts are wired into the aggregate verify and artifact lists
(`Makefile:729`, `Makefile:1084`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every action reports an error as a
  `state.status` byte string and a `Repaint`, never a panic (the release profile is `panic = "abort"`).
- One unit per file. New actions are one file under `src/wallet/event/`, new keyring ops one file under
  `src/wallet/ipc/`, and `mod.rs` is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_wallet_nonos/src/main.rs            run(Wallet::new)
  userland/capsule_wallet_nonos/src/wallet/mod.rs      the module tree
  userland/capsule_wallet_nonos/src/wallet/app.rs      the App impl
  userland/capsule_wallet_nonos/src/wallet/event/      the actions and Send form
  userland/capsule_wallet_nonos/src/wallet/ipc/        the keyring client
  userland/capsule_wallet_nonos/src/wallet/rpc/        the JSON-RPC codec
  userland/capsule_wallet_nonos/src/wallet/net/        the transport and probe ladder
  userland/capsule_wallet_nonos/src/wallet/tls13/      the TLS 1.3 client
  userland/capsule_wallet_nonos/src/wallet/paint/      the renderer
  userland/capsule_wallet_nonos/Capsule.mk             slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                  the nonos-mk-wallet-nonos[-sign|-verify] templates
  Makefile                                             the aggregate verify and artifact lists
```

Every reference above is verified against those trees.
