---
title: "The signing path and keyring client"
description: "This page mirrors src/wallet/ipc/ and src/wallet/txhash.rs."
weight: 4
---
This page mirrors `src/wallet/ipc/` and [`src/wallet/tx_hash.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tx_hash.rs). The wallet never holds a private key. Its
cryptographic operations are IPC calls to the [keyring](/docs/userland/keyring/) service, which owns the key
material, does the secp256k1 signing, and returns the signed raw transaction. The wallet marshals the
request, unwraps the reply, and hashes the result itself. For the actions that call this path see the
[views](/docs/userland/wallet-nonos/views/) page.

## The request and reply shape

The keyring is resolved by name ([`src/wallet/ipc/lookup_keyring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/lookup_keyring.rs)), and every call goes through one
helper, `keyring_call` ([`src/wallet/ipc/call.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/call.rs#L23)). It builds an 8-byte header followed by the payload,
sends it with `mk_ipc_call`, checks the reply is at least header-length, reads a little-endian status word,
and surfaces a nonzero status as an error (`call.rs:30`, `:35`, `:36`).

```
  request:  seq(4, le) | op(2, le) | pad(2) | payload
  reply:    seq(4)     | status(4, le)      | body
```

The request `seq` is the constant `1` (`call.rs:25`); the op numbers and header length are fixed in one
place ([`src/wallet/ipc/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/constants.rs)):

| Constant | Value | Meaning | Source |
|---|---|---|---|
| `OP_WALLET_GENERATE` | 9 | create a new wallet, returns a wallet id | `constants.rs:19` |
| `OP_WALLET_ADDRESS` | 10 | fetch a wallet's 20-byte address | `constants.rs:20` |
| `OP_SIGN_NOX_APPROVE` | 12 | sign a NOX approval, returns raw tx | `constants.rs:21` |
| `OP_SIGN_ETH_TRANSFER` | 13 | sign an EIP-1559 transfer, returns raw tx | `constants.rs:22` |
| `OP_LIST_WALLET_RAILS` | 14 | enumerate the wallet's settlement rails | `constants.rs:23` |
| `HDR_LEN` | 8 | the request and reply header length | `constants.rs:24` |

The five wrappers are `generate_wallet`, `wallet_address`, `sign_eth_transfer`, `sign_nox_approve`, and
`read_rails`, each one file under `src/wallet/ipc/` ([`src/wallet/ipc/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/mod.rs#L29)). A signing wrapper returns
the reply body past the 8-byte header, or an error if the body is empty (`sign_eth.rs:41`).

## The ETH transfer

An Ethereum transfer is built and signed in one keyring call ([`src/wallet/ipc/sign_eth.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/sign_eth.rs#L23)). The wallet
marshals the transfer fields as a little-endian pid and wallet id, the 20-byte recipient, and five 32-byte
EVM words, then hands them to the keyring under `OP_SIGN_ETH_TRANSFER` and returns the signed raw
transaction (`sign_eth.rs:31`).

```
  sign_eth_transfer(port, owner_pid, wallet_id, to[20], nonce, value_wei):
      payload = le(owner_pid) || le(wallet_id) || to[20]
              || word(nonce)
              || word(1_500_000_000)      // maxPriorityFeePerGas = 1.5 gwei
              || word(30_000_000_000)     // maxFeePerGas         = 30 gwei
              || word(21_000)             // gasLimit             = 21000
              || word(value_wei)
      rx = keyring_call(port, OP_SIGN_ETH_TRANSFER, payload, 256)
      return rx[HDR_LEN..]                 // the signed raw transaction
```

Each `word` is a 32-byte EVM word carrying a 128-bit value big-endian in its low 16 bytes
([`src/wallet/ipc/push_word.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/push_word.rs#L19)). The gas parameters are fixed constants appropriate for a plain
21,000-gas transfer at 1.5/30 gwei (`sign_eth.rs:36`, `:37`, `:38`). This is the demonstration boundary
called out on the [views](/docs/userland/wallet-nonos/views/) page: the transfer is a plain send, not a general contract call,
because the fee words are constants rather than the live fee estimate.

## The NOX approve

The NOX path signs a fixed approve template through `OP_SIGN_NOX_APPROVE` ([`src/wallet/ipc/sign_nox.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/sign_nox.rs#L23)).
It has no recipient argument; the payload is the pid and wallet id followed by five constant words, a zero
nonce, the same 1.5/30 gwei fee words, an 85,000 gas limit, and a one-ETH value word
(`sign_nox.rs:27`, `:30`, `:31`).

```
  sign_nox_approve(port, owner_pid, wallet_id):
      payload = le(owner_pid) || le(wallet_id)
              || word(0) || word(1_500_000_000) || word(30_000_000_000)
              || word(85_000) || word(1_000_000_000_000_000_000)
      rx = keyring_call(port, OP_SIGN_NOX_APPROVE, payload, 384)
      return rx[HDR_LEN..]
```

Because the template is fixed, the NOX action is a proof of the signing path rather than a user-composed
approval; the values are not editable from the UI.

## The transaction hash

After either signing call the wallet computes the transaction hash itself with Keccak-256 over the raw
bytes, through a kernel crypto syscall ([`src/wallet/tx_hash.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tx_hash.rs#L17)). `tx_hash` calls
`nonos_libc::crypto_keccak256` and succeeds only when it writes 32 bytes (`tx_hash.rs:18`). This is why the
capability mask carries the Crypto bit: the wallet hashes the transaction with the kernel primitive, it
does not sign it. The hash is stored as `tx_hash` and as a proof, and the private key stays in the keyring,
so a compromise of the wallet capsule exposes the UI and the network path but not the signing key.

## Rail enumeration

`read_rails` calls `OP_LIST_WALLET_RAILS` and `decode_rails` parses the reply into `Rail` records
([`src/wallet/ipc/read_rails.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/read_rails.rs), [`src/wallet/ipc/decode_rails.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/ipc/decode_rails.rs)). The decoded set is then filtered to the
symbols the wallet recognises: `rail_allowed` admits a two-byte `PR` and a three-byte `ETH` or `NOX` and
rejects everything else ([`src/wallet/state/rail_allowed.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/rail_allowed.rs#L19)), and `filter_rails` applies it
([`src/wallet/state/filter_rails.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/state/filter_rails.rs)). The rails offered are whatever the keyring returns filtered to that
set, which is an honest limit rather than a hardcoded list.

## Source map

Everything here is drawn from `userland/capsule_wallet_nonos/src/wallet/ipc/` (the keyring client) and
[`userland/capsule_wallet_nonos/src/wallet/tx_hash.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallet_nonos/src/wallet/tx_hash.rs) (the Keccak hash), with the rail filter under
`src/wallet/state/`.

```
  src/wallet/ipc/constants.rs       the op numbers, service names, and header length
  src/wallet/ipc/call.rs            keyring_call: header, mk_ipc_call, status check
  src/wallet/ipc/lookup_keyring.rs  resolve the keyring service by name
  src/wallet/ipc/generate.rs        OP_WALLET_GENERATE
  src/wallet/ipc/address.rs         OP_WALLET_ADDRESS
  src/wallet/ipc/sign_eth.rs        OP_SIGN_ETH_TRANSFER, the five transfer words
  src/wallet/ipc/sign_nox.rs        OP_SIGN_NOX_APPROVE, the fixed approve template
  src/wallet/ipc/push_word.rs       a 128-bit value into a 32-byte big-endian EVM word
  src/wallet/ipc/read_rails.rs      OP_LIST_WALLET_RAILS
  src/wallet/ipc/decode_rails.rs    the reply into Rail records
  src/wallet/tx_hash.rs             Keccak-256 of the raw transaction via the kernel primitive
  src/wallet/state/rail_allowed.rs  the ETH/NOX/PR filter
```

Every reference above is verified against those trees.
