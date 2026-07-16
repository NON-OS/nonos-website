---
title: The staking SDK
linkTitle: SDK
description: Typed TypeScript SDK for NOX staking. EIP-712 receipts, namespaces, tiers, operator IDs, live reads, and a pinned mainnet deployment.
weight: 20
---

`@nonos/nox-staking-sdk` is the library the dashboard is built on. It is
local-first by construction: the pure client computes hashes, IDs, receipts,
and eligibility with no network at all, and connecting to a live RPC is an
explicit, optional step.

```bash
npm install @nonos/nox-staking-sdk
```

Node 20 or newer, ESM only, browser-safe. The only cryptographic dependency is
`@noble/hashes`.

## The Nox client

```ts
import { Nox } from "@nonos/nox-staking-sdk";

const nox  = Nox.mainnet();        // pure: hashes, IDs, receipts, eligibility
const live = nox.connect(rpcUrl);  // optional: typed reads of the live contracts
```

`Nox.mainnet()` carries a pinned deployment: contract addresses and chain id
are compiled in, so an integration verifies against known values instead of
trusting a lookup service. A custom deployment can be passed for forks and
tests.

```ts
nox.namespace.hash("operator.alice");
nox.namespace.type("operator.alice");      // "operator"

nox.tier.fromNox("100000");                // 4 (Operator)
nox.tier.nameFromNox("100000");            // "Operator"

nox.operator.id({ wallet, positionId: 0n });
// { onchain: "0x...", offchain: "0x..." }

const proof = nox.proof.build({
  wallet, positionId: 0n,
  amount: "10000",
  lockUntil: new Date("2030-01-01"),
  issuedAt: new Date(),
  boostBps: 1500, tier: 3,
}, "operator.alice");

nox.proof.verify(proof.receipt, proof.digest).valid;

nox.eligibility.gateNox("capsule-tooling", "10000");   // true

nox.safe.tx("0xstaking...", "0xdeadbeef");
```

## The NoxLive client

Connecting is opt-in and explicit. Constructors never perform network I/O;
only methods do.

```ts
const live = nox.connect("https://eth-mainnet.example/v2/<KEY>");

await live.staking.version();        // "4.0.0"
await live.staking.stats();          // typed StakingStats
await live.staking.health();         // typed StakingHealth
await live.namespace.ownerOf("operator.alice");
await live.access.has(wallet, 1);
await live.token.balanceOf(wallet);
```

## Manage a stake

Every write is the same three steps: prepare (simulates on your RPC), sign
(through a signer you inject), send. The SDK holds no keys and no secret
material.

```ts
import { Nox, MAINNET_DEPLOYMENT } from "@nonos/nox-staking-sdk";

const nox     = Nox.mainnet();
const live    = nox.connect(rpcUrl);
const staking = MAINNET_DEPLOYMENT.stakingProxy;
const amount  = 100n * 10n ** 18n;                 // 100 NOX in wei

const plan = await live.tx.prepare(wallet, staking, nox.calldata.staking.stake(amount));
const raw  = await live.tx.sign(injectedSigner, plan.tx);
const { transactionHash, receipt } = await live.tx.sendAndWait(raw, true);
```

The same pattern covers `approve`, `stakeLocked`, `claimRewards`,
`compoundRewards`, `unstakePosition`, and `earlyUnlock`. The full lifecycle is
in [Stake and manage a position](/docs/staking/guides/stake/).

## The pinned mainnet deployment

```ts
import { MAINNET_DEPLOYMENT } from "@nonos/nox-staking-sdk";

MAINNET_DEPLOYMENT.stakingProxy        // 0xa94d6009790Ba13597A1E1b7cF4e1531eA513613
MAINNET_DEPLOYMENT.stakingImpl         // 0x415790B1f0aecd18B24D53BEaa25597573375B63
MAINNET_DEPLOYMENT.namespaceRegistry   // 0xD554ae30A0D20CB988c40d6C3b3d907740B9FD5C
MAINNET_DEPLOYMENT.accessRegistry      // 0x31140F839E2BB03C903ca894A87DF40c7333d38b
MAINNET_DEPLOYMENT.token               // 0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA
MAINNET_DEPLOYMENT.safe                // 0x3a52ea60F61036Afbbec25F46a64485Ac4477Ccc
```

## Security and sovereignty

- Your keys never leave your machine. Signing goes only through a signer you
  inject, implementing `{ address, signTransaction(tx) }`.
- Your RPC only. No fallback endpoint is ever used.
- No telemetry, no analytics, no third-party calls.
- Nothing is broadcast without your explicit action.
- Every value decoded from an RPC response is bounds-checked. Hostile-input
  and malicious-endpoint cases are covered by an adversarial test suite that
  runs in CI on Linux, macOS, and Windows.
- Safe and hardware wallet flows are first-class through `nox.safe.tx` and
  `nox.calldata`.

## Primitives

Lower-level functions are exported for callers who do not want the `Nox`
facade:

```ts
import {
  namespaceHash, tierFor, tierName,
  onchainOperatorId, offchainOperatorId,
  makeReceipt, receiptDigest, buildProof, verifyReceipt,
  safeTx,
} from "@nonos/nox-staking-sdk";
```

## Kernel separation

Nothing in this SDK signs a `CapsuleManifest` or a kernel grant. Staking
grants ecosystem rights; kernel capabilities come from the kernel's own signed
trust chain. Keeping the two apart is a design rule, not an accident, and it
is why a compromised staking integration cannot touch a NØNOS machine's
runtime authority.

## Build from source

```bash
git clone --recursive https://github.com/NON-OS/NOXtools.git
cd NOXtools
npm install
npm run build   # tsc -> dist/
npm test        # vitest, including the adversarial suite
```

The SDK is AGPL-3.0-or-later. Contracts:
[NOX-SmartContract](https://github.com/NON-OS/NOX-SmartContract).
