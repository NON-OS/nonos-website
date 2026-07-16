---
title: "Propose through a Safe"
description: "Hardware and multisig flows: export calldata and propose to a Safe."
weight: 70
---


Admin actions do not originate from the SDK. The SDK builds the calldata and a
Safe-compatible payload; Safe owners then sign it through the Safe UI, hardware,
or WalletConnect. Nothing is signed or broadcast on your behalf.

## Build the Safe payload with the SDK

```ts
import { Nox } from "@nonos/nox-staking-sdk";

const nox = Nox.mainnet();
const tx  = nox.safe.tx(
  "0xa94d6009790Ba13597A1E1b7cF4e1531eA513613",   // staking proxy
  "0xdeadbeef",                                    // calldata
);
```

`tx` is a Safe-compatible payload `{ to, value, data, operation }`. It carries no
digest and no signature. Compose the `data` from any calldata builder, for
example:

```ts
const data = nox.calldata.staking.stake(100n * 10n ** 18n);
const tx   = nox.safe.tx(nox.deployment.stakingProxy, data);
```

## Propose it to the Safe

Hand the payload to your Safe. The Safe app computes the full EIP-712 `SafeTx`
digest (`safeTxHash`) from the Safe address, chainId, and nonce, and owners sign
that hash. Any of these work:

- Paste the `to`, `value`, and `data` into the Safe web app as a new transaction.
- Feed the payload to the Safe SDK or the Safe Transaction Service from your own
  tooling.

The staking Safe is `0x3a52ea60F61036Afbbec25F46a64485Ac4477Ccc`.

## Read the Safe

Owners, threshold, and nonce are on-chain. Read them from the Safe web app, a
block explorer, or your own `eth_call` against the Safe's `getOwners()`,
`getThreshold()`, and `nonce()`. The SDK does not wrap these Safe-admin reads.
