---
title: "The Wallet Capsule"
description: "capsulewalletnonos is the Ethereum and NOX wallet in the NØNOS tree: a signed userland GUI capsule that generates and addresses an account, signs transactions, talks to a public..."
weight: 400
---
`capsule_wallet_nonos` is the Ethereum and NOX wallet in the NØNOS tree: a signed userland GUI capsule
that generates and addresses an account, signs transactions, talks to a public Ethereum JSON-RPC endpoint
over a TLS 1.3 client it implements itself, and can broadcast the signed bytes. It holds no private key of
its own. Every signature is an IPC call to the [keyring](/docs/userland/keyring/), which owns the key material; the
wallet marshals the transaction, gets the signed raw bytes back, hashes them, and can broadcast them.

The source under `userland/capsule_wallet_nonos/src/wallet/` is a set of top-level modules, and this
documentation mirrors that structure one page per code pillar so a page can be read beside the folder it
describes. The window is an ordinary [app-skeleton](/docs/userland/writing-an-app/) GUI app: `run(Wallet::new)` is
the whole entry point, so the runtime owns the surface, window, input subscription, and paint loop, and the
wallet supplies an `App` implementation with a manifest, an `on_event`, a `paint`, and an `on_tick`
([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28), [`src/wallet/app.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/app.rs#L35)).

## Identity

Everything the kernel and the service registry need to name and reach the wallet comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `wallet-nonos` | `Capsule.mk:1` |
| Service handle | `app.nonos_wallet` | `Capsule.mk:2`, [`src/userspace/capsule_wallet_nonos/spawn.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wallet_nonos/spawn.rs#L29) |
| Namespace | `systems.nonos.app.nonos_wallet` | `Capsule.mk:7` |
| Service endpoint | `service:4734:app.nonos_wallet` | `Capsule.mk:8`, `spawn.rs:30` |
| Reply endpoint | `reply:4735:endpoint.app.nonos_wallet.reply` | `Capsule.mk:9`, `spawn.rs:31`, `spawn.rs:32` |
| Capability mask | `0x1839` | `Capsule.mk:10` |
| Binary name | `wallet_nonos` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_wallet_nonos` | `Capsule.mk:11` |

The mask `0x1839` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), and the kernel spawn path
requests exactly these six capabilities and no others (`spawn.rs:48`):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| Crypto | `0x0020` | use the kernel Keccak and AEAD primitives | `types.rs:61` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into | `types.rs:68` |

```
  0x1839 = 0x0001 + 0x0008 + 0x0010 + 0x0020 + 0x0800 + 0x1000
```

There is no Network bit (`0x0004`) and no FileSystem bit (`0x0040`) in the mask. That is the basis of the
security story: the wallet can execute, ask the display for its size, create a surface, speak IPC, and use
the kernel crypto primitives (the transaction hash and the TLS record layer), but it cannot open a socket
or touch a device on its own. Every RPC packet it appears to send is really an IPC request to the
`net.sockets` service that holds the real transport authority, and every signature is an IPC request to
the keyring that holds the key. The Crypto bit is present because the wallet hashes transactions and seals
TLS records, not because it holds any key.

## The code pillars

The source under `src/wallet/` splits into the model, the input handlers, the keyring client, the network
and RPC path, and the renderer. Data flows inward from an event, through a keyring or chain call, into the
one `State` struct, which `paint` turns into pixels.

```
  event/   ->   ipc/ + rpc/ + net/   ->   state/   ->   paint/
  keys and     the keyring client       the model    the frame
  pointer      and the network path     (one struct) on screen
```

| Page | Mirrors | What it covers |
|---|---|---|
| [views.md](/docs/userland/wallet-nonos/views/) | `src/wallet/event/`, `src/wallet/state/` | The four views, every key and pointer action, the Send form, the generate, sign, broadcast, and probe actions, and the honest real-versus-demonstration split. |
| [signing.md](/docs/userland/wallet-nonos/signing/) | `src/wallet/ipc/`, [`src/wallet/tx_hash.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tx_hash.rs) | The keyring client: op numbers, the request and reply shape, the ETH transfer and NOX approve marshalling, rail enumeration, and the Keccak-256 transaction hash. |
| [network.md](/docs/userland/wallet-nonos/network/) | `src/wallet/net/`, `src/wallet/rpc/`, `src/wallet/tls13/` | The transport: sockets and DNS over IPC, the hand-built JSON-RPC codec, the probe ladder, and the from-scratch TLS 1.3 client and its pinned-root trust model. |
| [rendering.md](/docs/userland/wallet-nonos/rendering/) | `src/wallet/paint/`, [`src/wallet/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/manifest.rs) | The window manifest and input mask, the paint dispatch, the sidebar, topbar, view bodies, cards, and status bar. |
| [contributing.md](/docs/userland/wallet-nonos/contributing/) | the whole tree | Where to work, how to add an action, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/wallet-nonos/debugging/) | runtime | The boot marker, the layered failure modes, the `_ready` flags, and the probe-ladder status string. |

## Lifecycle

The wallet is spawned through [verified spawn](https://github.com/NON-OS/nonos-micro-kernel/blob/main/security/capsules-and-trust.md): its signature,
id cert, manifest, and attestation trailer are checked, its requested capabilities are held against its
manifest ceiling, and only then is its ELF mapped. On a successful boot the kernel prints
`[APP-NØNOS-WALLET] capsule spawned` from the capsule boot path
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)).

1. The kernel spawns the capsule at boot through the desktop-fleet plan, which registers
   `app.nonos_wallet` on port 4734 with a reply inbox on 4735 (`spawn.rs:29`, `:30`, `:31`, `:32`).
2. The skeleton `run` creates the window from the manifest: a `WIDTH x HEIGHT` Normal window titled
   `NØNOS Wallet` at `(370, 128)`, subscribing to key-down, absolute-pointer, and button-down input
   ([`src/wallet/manifest.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/manifest.rs#L26)). The input mask is `KeyDown | PointerAbs | ButtonDown`
   (`manifest.rs:21`, `:24`).
3. On the first event or the first tick, `hydrate` runs once behind a `ready` flag: it resolves the
   keyring port and this wallet's own pid, then reads and filters the settlement rails (`app.rs:40`,
   `:52`, [`src/wallet/state/hydrate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/hydrate.rs)).
4. Each event flows through `on_event` to `on_key` or `on_pointer`, which mutate `State` and return
   `Repaint`, `Idle`, or `Close` ([`src/wallet/event/on_event.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/event/on_event.rs#L21)). `paint` then projects the active
   view: background, sidebar, topbar, one of the four view bodies, and the status bar
   ([`src/wallet/paint/paint.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/paint/paint.rs#L21)). The frame lands in the shared surface the compositor presents.

## Source map

Everything here is drawn from `userland/capsule_wallet_nonos/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits the mask decomposes against), and the kernel spawn mirror
under `src/userspace/capsule_wallet_nonos/`.

```
  userland/capsule_wallet_nonos/src/main.rs            run(Wallet::new)
  userland/capsule_wallet_nonos/src/wallet/app.rs      the App impl: manifest, on_event, paint, on_tick
  userland/capsule_wallet_nonos/src/wallet/state/      State (types.rs), new, hydrate, filter_rails, record_tx
  userland/capsule_wallet_nonos/src/wallet/event/      on_event -> on_key / on_pointer; the actions and Send form
  userland/capsule_wallet_nonos/src/wallet/ipc/        the keyring client
  userland/capsule_wallet_nonos/src/wallet/rpc/        the hand-built JSON-RPC codec
  userland/capsule_wallet_nonos/src/wallet/net/        sockets, DNS, the probe ladder, broadcast, receipt
  userland/capsule_wallet_nonos/src/wallet/tls13/      the from-scratch TLS 1.3 client
  userland/capsule_wallet_nonos/src/wallet/paint/      the renderer
  userland/capsule_wallet_nonos/Capsule.mk             slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                            the capability bit definitions
  src/userspace/capsule_wallet_nonos/spawn.rs          the kernel-side embed and verified spawn
```

Every reference above is verified against those trees.
