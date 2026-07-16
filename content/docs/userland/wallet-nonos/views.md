---
title: "Wallet views and user actions"
description: "This page mirrors src/wallet/event/ and src/wallet/state/."
weight: 3
---
This page mirrors `src/wallet/event/` and `src/wallet/state/`. The window has four views selected by
`state.view`, and every action is a key or a pointer click routed into a handler that mutates the one
`State` struct and returns an `EventOutcome`. Each handler is one file. For the whole capsule (identity,
signing, network, rendering) see the [wallet overview](/docs/userland/wallet-nonos/).

## The event gate

An input event arrives at the `App` and passes straight into `on_event`, which does one thing: an Escape
key-down closes the window, any other key-down goes to `on_key`, a button-down goes to `on_pointer`, and
everything else is ignored ([`src/wallet/event/on_event.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_event.rs#L21)).

| Event | Effect | Source |
|---|---|---|
| KeyDown, code `KEY_ESC` | close the window | `on_event.rs:23` |
| KeyDown, any other code | route to `on_key` | `on_event.rs:24` |
| ButtonDown | route to `on_pointer` | `on_event.rs:25` |
| Anything else | ignored, returns Idle | `on_event.rs:26` |

## The model

Behind the window the whole wallet is one `State` struct ([`src/wallet/state/types.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/types.rs#L37)). There is no
private key in it. The account address, the balance, the nonce, the fee, the constructed transaction, and
the signed-transaction proofs are all facts fetched from the keyring or the chain and cached in `State`,
and the four views are a projection of it. The four view constants are `VIEW_HOME = 0`,
`VIEW_RECEIVE = 1`, `VIEW_SEND = 2`, `VIEW_PROOF = 3` (`types.rs:21`), and the Send form has three fields
`SEND_FIELD_TO`, `SEND_FIELD_AMOUNT`, `SEND_FIELD_NONCE` (`types.rs:22`).

Four `_ready` flags separate a keyring problem from a network problem: `address_ready` is set when the
keyring returns an address, and `balance_ready`, `nonce_ready`, and `fee_ready` are set only when a live
chain read succeeds (`types.rs:42`). This split is what the [debugging](/docs/userland/wallet-nonos/debugging/) page reads to
localise a stuck wallet.

## Navigation and views

Key handling is a flat set of single-key shortcuts in `on_key` ([`src/wallet/event/on_key.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_key.rs#L21)); the
pointer handler hit-tests the sidebar, buttons, and Send fields ([`src/wallet/event/on_pointer.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_pointer.rs#L21)).

| Action | Key / click | Effect | Source |
|---|---|---|---|
| Home view | `h` or `1`, or sidebar row 1 | account card, balance, network card | `on_key.rs:27`, `:31`, `on_pointer.rs:46` |
| Receive view | `v` or `2`, or sidebar row 2 | the address to receive to | `on_key.rs:28`, `:32`, `on_pointer.rs:46` |
| Send view | `s` or `3`, or sidebar row 3 | the recipient, amount, and nonce form | `on_key.rs:29`, `:33`, `on_pointer.rs:46` |
| Proofs view | `p` or `4`, or sidebar row 4 | the signed-transaction hashes | `on_key.rs:30`, `:34`, `on_pointer.rs:46` |
| Close the window | Esc | end the app | `on_event.rs:23` |

Note `s` selects the Send view only while another view is active. Once Send is focused, the key match
sends every non-shortcut code into the Send form first (`on_key.rs:36`), and `s` is not a hex digit so
the form ignores it. Use `h`, `1`, or a sidebar click to leave Send. The sidebar hit-test lives in `nav`,
which maps the four sidebar rows to the four view constants and returns `255` for a miss
(`on_pointer.rs:45`).

## Account actions

| Action | Key / click | Effect | Source |
|---|---|---|---|
| Generate a wallet | `g` / `G`, or the Generate button | ask the keyring to create a wallet, fetch its address, switch to Receive | `on_key.rs:35`, `on_pointer.rs:31`, [`src/wallet/event/generate.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/generate.rs#L22) |
| Refresh / hydrate | `r` / `R` | re-run the keyring and rail hydrate step | `on_key.rs:22`, [`src/wallet/state/hydrate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/hydrate.rs) |
| Probe the network | `w` / `W`, or the Probe button | run the DNS/socket/TLS/chain probe ladder and, if the address is loaded, pull balance/nonce/fee | `on_key.rs:41`, `on_pointer.rs:33`, [`src/wallet/event/probe_net.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/probe_net.rs#L22) |

`generate` calls the keyring twice, once to create the wallet and once to fetch its address; on success it
sets `wallet_id`, stores the address, sets `address_ready`, switches to Receive, and reports
`wallet generated` (`generate.rs:26`). It fails cleanly if the keyring is unavailable: the status line
becomes `generate failed` or `address failed` and no wallet id is set (`generate.rs:34`, `:39`).
`probe_net` runs the ladder and, only when the address is loaded and the chain read reached `rpc_chain_ok`,
folds a live balance, nonce, and fee into `State` (`probe_net.rs:24`).

## The Send form

The Send form has three fields cycled with Tab and edited in place ([`src/wallet/event/send_input.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/send_input.rs#L21)).
It is only reachable while the Send view is active, because `on_key` diverts every non-shortcut code into
it under the `state.view == VIEW_SEND` arm (`on_key.rs:36`).

| Action | Key / click | Effect | Source |
|---|---|---|---|
| Cycle field | Tab | move focus To -> Amount -> Nonce -> To | `send_input.rs:22` |
| Focus a field | click the field row | set focus to To, Amount, or Nonce | `on_pointer.rs:55` |
| Edit recipient | hex digit while To is focused | append one hex nibble, up to 40 (a 20-byte address) | `send_input.rs:33`, `send_input.rs:51`, [`src/wallet/event/recipient.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/recipient.rs) |
| Edit amount | digit while Amount is focused | build the amount in milli-ETH | `send_input.rs:34`, [`src/wallet/event/edit_amount.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/edit_amount.rs) |
| Edit nonce | digit while Nonce is focused | build the nonce | `send_input.rs:35`, [`src/wallet/event/edit_nonce.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/edit_nonce.rs) |
| Backspace | Backspace | drop the last recipient nibble, or divide amount/nonce by ten | `send_input.rs:40` |
| Sign and stay | Enter, or the Sign button in Send | sign the ETH transfer | `send_input.rs:26`, `on_pointer.rs:61` |

The recipient buffer is exactly 40 hex characters (`state.send_to_hex`, `types.rs:51`); `edit_to` appends
a nibble only through `hex_digit`, so a non-hex code is dropped (`send_input.rs:51`). The amount is entered
in milli-ETH and converted to wei by multiplying by `1_000_000_000_000_000`, with an overflow check that
reports `amount too large` rather than wrapping ([`src/wallet/event/eth_value.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/eth_value.rs), `sign_eth.rs:31`). The
recipient must be exactly 40 hex characters or `recipient` returns nothing and signing reports
`recipient incomplete` (`recipient.rs`, `sign_eth.rs:27`).

## Signing and broadcast

| Action | Key | Effect | Source |
|---|---|---|---|
| Sign ETH transfer | `E` (or Enter in Send) | build an EIP-1559 transfer, sign it through the keyring, hash it, store it as a proof, switch to Proofs | `on_key.rs:37`, [`src/wallet/event/sign_eth.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_eth.rs#L22) |
| Sign NOX approve | `n` / `N` | request a NOX approval signature from the keyring, hash it, store it as a proof | `on_key.rs:38`, [`src/wallet/event/sign_nox.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_nox.rs) |
| Sign both | `P` | sign an ETH transfer and a NOX approval in one action, record both proofs, set `proof_count = 2` | `on_key.rs:39`, [`src/wallet/event/sign_both.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_both.rs#L23) |
| Broadcast | `b` / `B`, or the Broadcast button in Proofs | send the stored signed transaction to the RPC and poll one receipt | `on_key.rs:40`, `on_pointer.rs:39`, [`src/wallet/event/broadcast.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/broadcast.rs#L21) |

All three signing actions require a wallet to exist first; without one the status is `generate wallet
first` (`sign_eth.rs:23`, `sign_both.rs:24`). A successful sign stores the raw transaction and its
Keccak-256 hash in `State` via `record_tx`, sets the last-signed transaction as the broadcast candidate,
and switches to the Proofs view ([`src/wallet/event/sign_result.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/sign_result.rs#L24), [`src/wallet/state/record_tx.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/record_tx.rs)).
`sign_both` records the NOX transaction as the broadcast candidate and both hashes as proofs
(`sign_both.rs:57`, `:61`). Broadcast is honest about being end-to-end: it refuses with `no signed tx` if
nothing is staged, sends the raw bytes through `net.sockets`, and folds the receipt poll into
`receipt confirmed`, `receipt pending`, `broadcast sent`, or `broadcast rejected` (`broadcast.rs:22`,
`:37`). The signing marshalling itself is on the [signing](/docs/userland/wallet-nonos/signing/) page.

## Real versus demonstration

Stated plainly, because the wallet is honest about which paths are end-to-end and which exercise only the
signing and hashing path.

- Real. Address generation, signing, and the transaction hash cross into the keyring and the kernel Keccak
  primitive and return genuine bytes; the Proofs view shows the real hash of a real signed transaction
  (`sign_result.rs:34`, `sign_both.rs:53`). Balance, nonce, and fee are real reads from a live chain when
  the network is reachable and the address is loaded (`probe_net.rs:24`). The broadcast is a real
  `eth_sendRawTransaction` when the network path is up (`broadcast.rs:26`).
- Demonstration. The EIP-1559 gas parameters in the ETH transfer are fixed constants rather than derived
  from the live fee estimate ([`src/wallet/ipc/sign_eth.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/sign_eth.rs#L36)), so a send is a plain 21,000-gas transfer,
  not a general contract call. The NOX path signs a fixed approve template rather than a user-composed
  call ([`src/wallet/ipc/sign_nox.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/sign_nox.rs)). The Send form drives the ETH path end to end; the NOX and sign-both
  actions produce proofs but sign fixed templates.

## Source map

Everything here is drawn from `userland/capsule_wallet_nonos/src/wallet/event/` (the handlers) and
`userland/capsule_wallet_nonos/src/wallet/state/` (the model and its constants).

```
  src/wallet/event/on_event.rs      the event gate: Esc close, key -> on_key, button -> on_pointer
  src/wallet/event/on_key.rs        the flat key router: views, actions, Send-form divert
  src/wallet/event/on_pointer.rs    sidebar nav, Generate/Probe buttons, Send hit-tests, Broadcast
  src/wallet/event/generate.rs      two keyring calls, then Receive
  src/wallet/event/send_input.rs    Tab, Enter, Backspace, per-field edit dispatch
  src/wallet/event/recipient.rs     the 40-hex recipient into 20 bytes
  src/wallet/event/eth_value.rs     milli-ETH to wei with overflow check
  src/wallet/event/sign_eth.rs      guards, then the keyring transfer call
  src/wallet/event/sign_nox.rs      the fixed NOX approve template
  src/wallet/event/sign_both.rs     both signatures and two proofs
  src/wallet/event/sign_result.rs   hash, record_tx, switch to Proofs
  src/wallet/event/broadcast.rs     stage guard, send, poll one receipt
  src/wallet/event/probe_net.rs     run the ladder, then the account read
  src/wallet/state/types.rs         State, the view and field constants, the _ready flags
```

Every reference above is verified against those trees.
