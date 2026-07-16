---
title: "Recipes"
description: "Short, copyable answers to common staking tasks."
weight: 30
---


Short, copy-pasteable snippets. No narrative.

## hash a namespace

```ts
import { Nox } from "@nonos/nox-staking-sdk";
Nox.mainnet().namespace.hash("operator.alice");
```

## classify a stake score

```ts
const nox = Nox.mainnet();
nox.tier.fromNox("100000");        // 4
nox.tier.nameFromNox("100000");    // "Operator"
```

## operator id (matches V4 `operatorId(wallet, positionId)`)

```ts
Nox.mainnet().operator.id({ wallet, positionId: 0n });
// { onchain, offchain }
```

## build + verify a proof bundle

```ts
const nox = Nox.mainnet();
const proof = nox.proof.build({
  wallet, positionId: 0n,
  amount: "10000", lockUntil: new Date("2030-01-01"),
  issuedAt: new Date(), boostBps: 1500, tier: 3,
}, "operator.alice");
nox.proof.verify(proof.receipt, proof.digest).valid;
```

## eligibility gate

```ts
Nox.mainnet().eligibility.gateNox("capsule-tooling", "10000");  // true
```

## live read - staking stats

```ts
const live = Nox.mainnet().connect(rpc);
const stats = await live.staking.stats();
console.log(stats.totalStaked);
```

## live read - namespace owner

```ts
const live = Nox.mainnet().connect(rpc);
await live.namespace.ownerOf("operator.alice");
```

## live read - access mask

```ts
await Nox.mainnet().connect(rpc).access.mask(wallet);
```

## live read - NOX balance

```ts
await Nox.mainnet().connect(rpc).token.balanceOf(wallet);
```

## switch off mainnet (testnet, custom deployment)

```ts
import { Nox } from "@nonos/nox-staking-sdk";
const nox = new Nox({
  deployment: {
    chainId: 11155111, label: "sepolia",
    stakingProxy:      "0x...",
    stakingImpl:       "0x...",
    namespaceRegistry: "0x...",
    accessRegistry:    "0x...",
    token:             "0x...",
    safe:              "0x...",
  },
});
```

## Safe payload (no signing, no broadcast)

```ts
Nox.mainnet().safe.tx("0xstaking...", "0xdeadbeef");
```

---

Staking writes below all use the prepare -> sign -> send pattern. `signer` is your
injected `{ address, signTransaction(tx) }` - the SDK holds no keys. See
[stake.md](guides/stake.md) for the full lifecycle.

```ts
import { Nox, MAINNET_DEPLOYMENT } from "@nonos/nox-staking-sdk";
const nox     = Nox.mainnet();
const live    = nox.connect(rpc);
const staking = MAINNET_DEPLOYMENT.stakingProxy;
const token   = MAINNET_DEPLOYMENT.token;
const NOX     = 10n ** 18n;

async function send(to, data, signer) {
  const plan = await live.tx.prepare(wallet, to, data);   // simulates on your RPC
  const raw  = await live.tx.sign(signer, plan.tx);
  return live.tx.sendAndWait(raw, true);
}
```

## read balance / allowance / pending

```ts
await live.token.balanceOf(wallet);            // wei
await live.token.allowance(wallet, staking);   // wei the contract may pull
await live.staking.pendingRewards(wallet);     // claimable, wei
await live.staking.activePositionCount(wallet);// open positions, bigint
```

## approve NOX (once)

```ts
const MAX = (1n << 256n) - 1n;
await send(token, nox.calldata.token.approve(staking, MAX), signer);
```

## stake (flexible)

```ts
await send(staking, nox.calldata.staking.stake(100n * NOX), signer);
```

## stake-locked

```ts
const DAY = 86_400n;
await send(staking, nox.calldata.staking.stakeLocked(100n * NOX, 90n * DAY), signer);
```

## claim rewards

```ts
await send(staking, nox.calldata.staking.claimRewards(), signer);
```

## compound a position

```ts
await send(staking, nox.calldata.staking.compoundRewards(0n), signer);
```

## unstake (unlocked position)

```ts
await send(staking, nox.calldata.staking.unstakePosition(0n), signer);
```

## early-unlock (still locked - burns ~5% penalty)

```ts
await send(staking, nox.calldata.staking.earlyUnlock(0n), signer);
```

## decode a receipt / revert

```ts
live.tx.decodeReceipt(rawReceipt);       // { status, logs, ... }
live.tx.decodeRevert("0x08c379a0...");     // { kind, reason?, selector? }
```
