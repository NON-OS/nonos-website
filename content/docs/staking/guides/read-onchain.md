---
title: "Read on-chain state"
description: "Typed reads of the live staking contracts through your own RPC."
weight: 50
---


`Nox` is pure (no network). When you need to read live mainnet, call `nox.connect(rpcUrl)` to get a `NoxLive`.

```ts
import { Nox } from "@nonos/nox-staking-sdk";

const nox  = Nox.mainnet();
const live = nox.connect("https://eth-mainnet.g.alchemy.com/v2/<KEY>");
```

## Staking

```ts
await live.staking.version();        // "4.0.0"
await live.staking.rewardReserve();  // bigint, raw wei
await live.staking.rewardRunway();   // bigint, seconds
const stats  = await live.staking.stats();
const health = await live.staking.health();
```

Per-wallet reads:

```ts
await live.staking.pendingRewards(wallet);        // claimable rewards, wei
await live.staking.activePositionCount(wallet);   // open positions, bigint
```

Returns typed structs:

```ts
interface StakingStats {
  totalStaked: bigint;
  totalWeightedStake: bigint;
  rewardReserve: bigint;
  rewardsDistributed: bigint;
  penaltiesBurned: bigint;
  emissionRate: bigint;
  accRewardPerShare: bigint;
}

interface StakingHealth {
  rewardReserve: bigint;
  rewardRunway: bigint;
  totalStaked: bigint;
  emissionRate: bigint;
  paused: boolean;
}
```

## Namespace registry

```ts
const owner = await live.namespace.ownerOf("operator.alice");
// "0x0000...0000" if unclaimed

const ok = await live.namespace.canReserve(wallet, 0n, "operator.alice");
```

## Access registry

```ts
await live.access.has(wallet, 1);    // boolean
await live.access.mask(wallet);      // bigint
```

## Token (NOX ERC-20)

```ts
await live.token.balanceOf(wallet);              // bigint, raw wei
await live.token.allowance(wallet, MAINNET_DEPLOYMENT.stakingProxy);  // wei the staking contract may pull
```

To write (stake, claim, exit), see [stake.md](stake.md).

## Routing and privacy

To route the RPC through a proxy or Tor in a server-side process, set a
SOCKS-aware fetch dispatcher before you connect. See [proxy.md](proxy.md).

In the browser, egress is the browser's concern (Tor Browser, an OS-level proxy,
and so on).
