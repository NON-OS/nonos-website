---
title: "Rendering and the window"
description: "This page mirrors src/wallet/paint/ and src/wallet/manifest.rs."
weight: 6
---
This page mirrors `src/wallet/paint/` and [`src/wallet/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/manifest.rs). The renderer is a pure projection of
`State`: given the current view it draws the background, the sidebar, the topbar, one of four view bodies,
and the status bar into the shared surface the compositor presents. Nothing here decides anything; the
[views](/docs/userland/wallet-nonos/views/) handlers own the state, and `paint` only reads it. For the whole capsule see the
[wallet overview](/docs/userland/wallet-nonos/).

## The window manifest

The window is described once, in `manifest` ([`src/wallet/manifest.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/manifest.rs#L26)). It is a Normal window titled
`NØNOS Wallet`, opened at `(370, 128)` at the theme's `WIDTH x HEIGHT` (1180 by 720,
[`src/wallet/theme.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/theme.rs#L17)).

| Field | Value | Source |
|---|---|---|
| Title | `NØNOS Wallet` | `manifest.rs:28` |
| Window id | `0x5741_4C4E` | `manifest.rs:29` |
| Kind | Normal | `manifest.rs:30` |
| Origin | `(370, 128)` | `manifest.rs:31`, `:32` |
| Size | `WIDTH x HEIGHT` = `1180 x 720` | `manifest.rs:33`, `:34`, `theme.rs:17` |
| Input mask | `KeyDown \| PointerAbs \| ButtonDown` | `manifest.rs:24` |

The input mask is three bits: key-down (bit 0), absolute pointer (bit 3), and button-down (bit 5)
(`manifest.rs:21`, `:22`, `:23`). Those are exactly the events the [views](/docs/userland/wallet-nonos/views/) gate handles; the
window subscribes to nothing else.

## The paint dispatch

`paint` is the single entry the skeleton calls each frame ([`src/wallet/paint/paint.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/paint.rs#L21)). It draws the
frame-wide chrome, then dispatches on `state.view` to one view body, then draws the status bar last so it
sits on top.

| Step | Draws | Source |
|---|---|---|
| Background | the window fill and panels | `paint.rs:22` |
| Sidebar | the logo, the four nav rows, the rail legend | `paint.rs:23` |
| Topbar | the active-view header strip | `paint.rs:24` |
| View body | Home, Receive, Send, or Proof, dispatched on `state.view` | `paint.rs:25` |
| Status bar | the current `state.status` line | `paint.rs:32` |

The view dispatch maps each view constant to its body: `VIEW_RECEIVE` to `paint_receive`, `VIEW_SEND` to
`paint_send`, `VIEW_PROOF` to `paint_proof_view`, and `VIEW_HOME` (and the fallthrough) to `paint_home`
(`paint.rs:26`). Because the match is total over `State`, a frame is always well-defined; there is no
partial or stale-state path.

## The sidebar and views

The sidebar draws the logo, the wordmark, the four navigation rows, and the rail legend
([`src/wallet/paint/paint_sidebar.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/paint_sidebar.rs#L22)). The four nav rows sit at y-offsets 160, 212, 264, and 316, each
220 by 38 pixels, and the active row is marked with a 5-pixel accent bar (`paint_sidebar.rs:26`, `:37`,
`:39`). Those coordinates are the same rectangles the pointer nav hit-tests in
[`src/wallet/event/on_pointer.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_pointer.rs#L46), which is why a sidebar click and the drawn row line up.

The view bodies are one file each and read only from `State`:

| View | File | Shows |
|---|---|---|
| Home | `paint_home.rs`, `paint_account_card.rs`, `paint_network_card.rs`, `paint_home_security.rs` | the account card, balance, and network card |
| Receive | `paint_receive.rs` | the address to receive to |
| Send | `paint_send.rs`, `paint_send_route_label.rs` | the recipient, amount, and nonce form |
| Proof | `paint_proof_view.rs`, `paint_proofs.rs`, `paint_tx.rs` | the signed-transaction hashes |

Shared drawing helpers are also one file each: `paint_background`, `paint_topbar`, `paint_statusbar`,
`paint_button`, `panel`, `paint_rail_card`, and the small formatters `format_u32`, `format_u64`, and
`hex_hash` ([`src/wallet/paint/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/mod.rs#L17)). The palette lives in [`src/wallet/theme.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/theme.rs#L19) and is shared with
the input hit-tests through the same constants.

## Source map

Everything here is drawn from `userland/capsule_wallet_nonos/src/wallet/paint/` (the renderer) and
[`userland/capsule_wallet_nonos/src/wallet/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallet_nonos/src/wallet/manifest.rs) and `theme.rs` (the window and palette).

```
  src/wallet/manifest.rs             the window manifest and the three input-mask bits
  src/wallet/theme.rs                WIDTH, HEIGHT, and the color palette
  src/wallet/paint/paint.rs          the per-frame dispatch on state.view
  src/wallet/paint/paint_background.rs   the window fill and panels
  src/wallet/paint/paint_sidebar.rs      logo, nav rows, rail legend
  src/wallet/paint/paint_topbar.rs       the active-view header
  src/wallet/paint/paint_home.rs         plus paint_account_card, paint_network_card, paint_home_security
  src/wallet/paint/paint_receive.rs      the Receive body
  src/wallet/paint/paint_send.rs         plus paint_send_route_label
  src/wallet/paint/paint_proof_view.rs   plus paint_proofs, paint_tx
  src/wallet/paint/paint_statusbar.rs    the status line
  src/wallet/paint/format_u32.rs, format_u64.rs, hex_hash.rs   the formatters
```

Every reference above is verified against those trees.
