---
title: "Quickstart"
description: "Build your first NOX proof in 30 seconds."
weight: 6
---


Build your first NOX proof in 30 seconds.

## Install

```bash
npm install @nonos/nox-staking-sdk
```

## Hello world

```ts
import { Nox } from "@nonos/nox-staking-sdk";

const nox = Nox.mainnet();

const proof = nox.proof.build({
  wallet:     "0xYourWallet...",
  positionId: 0n,
  amount:     "10000",          // 10,000 NOX as a decimal string
  lockUntil:  new Date("2030-01-01"),
  issuedAt:   new Date(),
  boostBps:   1500,
  tier:       nox.tier.fromNox("10000"),
}, "operator.alice");

console.log(proof.onchainOperatorId);
console.log(proof.digest);
console.log(nox.proof.verify(proof.receipt, proof.digest).valid);   // true
```

That's a complete, self-verifiable ecosystem credential, derived locally with no network call.

## Your first staking transaction

The SDK is the programmatic way to stake. Prefer a UI? Run
[`@nonos/nox-dashboard`](https://www.npmjs.com/package/@nonos/nox-dashboard),
which is built on this SDK. To do it in code: connect your RPC, prepare a stake
(this simulates on your RPC), sign with your wallet, and send. The SDK never
holds keys.

```ts
import { Nox, MAINNET_DEPLOYMENT } from "@nonos/nox-staking-sdk";

const nox     = Nox.mainnet();
const live    = nox.connect("https://eth-mainnet.example/v2/<KEY>");
const staking = MAINNET_DEPLOYMENT.stakingProxy;
const amount  = 100n * 10n ** 18n;                 // 100 NOX in wei

const data = nox.calldata.staking.stake(amount);
const plan = await live.tx.prepare(wallet, staking, data);   // eth_call + gas + nonce + fees
const raw  = await live.tx.sign(injectedSigner, plan.tx);    // your signer, not the SDK
const { transactionHash } = await live.tx.sendAndWait(raw, true);
```

First time staking? You must `approve` the staking contract once before this
works. See the full lifecycle in [Stake and manage a position](guides/stake.md).

## Next

- [Stake and manage a position](guides/stake.md) - approve, stake, claim, compound, unstake, early-unlock.
- [Sign a receipt](guides/sign-receipt.md) with an injected wallet signer.
- [Read mainnet state](guides/read-onchain.md) via `nox.connect(rpcUrl)`.
- [Browser / Vite setup](guides/browser.md).
- [Recipes](RECIPES.md) - copy-paste snippets.
