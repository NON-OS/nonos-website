---
title: "Eligibility gates"
description: "Gate features on stake tiers without a backend."
weight: 40
---


Gate access to your frontend, JONOS preview, or capsule tooling using stake-derived tiers.

## Tier floors (V4)

| Tier | Name | Floor |
|---|---|---|
| 0 | Void | < 100 NOX |
| 1 | Signal | >= 100 NOX |
| 2 | Circuit | >= 1,000 NOX |
| 3 | Capsule | >= 10,000 NOX |
| 4 | Operator | >= 100,000 NOX |
| 5 | ZeroState | >= 1,000,000 NOX |

## Classify a score

```ts
import { Nox } from "@nonos/nox-staking-sdk";
const nox = Nox.mainnet();

nox.tier.fromNox("100000");     // 4
nox.tier.nameFromNox("100000"); // "Operator"
nox.tier.fromWei(50_000n * 10n ** 18n);  // 3
```

## Preset gates

```ts
nox.eligibility.gateNox("jonos-preview",     "100");     // true (>= Signal)
nox.eligibility.gateNox("capsule-tooling",   "10000");   // true (>= Capsule)
nox.eligibility.gateNox("operator-waitlist", "100000");  // true (>= Operator)
```

## On-chain access mask

If your gate also needs to consult `AccessRegistry`:

```ts
const live = nox.connect(rpc);
const ok   = await live.access.has(wallet, 1);   // flag index, e.g. 1
const mask = await live.access.mask(wallet);     // uint256 bitfield, bigint
```

`mask` returns a `uint256` bitfield; check individual flags with bitwise ops
(`(mask >> BigInt(flag)) & 1n`).

## Frontend pattern

```tsx
function GateBanner({ scoreNox }: { scoreNox: string }) {
  const nox = Nox.mainnet();
  if (nox.eligibility.gateNox("operator-waitlist", scoreNox)) return <p>Operator access granted.</p>;
  if (nox.eligibility.gateNox("capsule-tooling",   scoreNox)) return <p>Capsule tooling unlocked.</p>;
  if (nox.eligibility.gateNox("jonos-preview",     scoreNox)) return <p>JONOS preview unlocked.</p>;
  return <p>Stake 100+ NOX to unlock JONOS preview.</p>;
}
```
