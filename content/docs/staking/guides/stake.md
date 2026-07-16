---
title: "Stake and manage a position"
description: "The full lifecycle: connect, read state, approve, stake, claim, compound, and exit."
weight: 10
---


This is the full staking lifecycle: connect, read state, approve, stake, claim,
compound, and exit. It is the programmatic path to stake NOX; if you would rather
click through a UI, run [`@nonos/nox-dashboard`](https://www.npmjs.com/package/@nonos/nox-dashboard),
which drives the same SDK.

The SDK never holds keys. It builds calldata, prepares an EIP-1559 plan against
**your** RPC, and hands the plan to a signer you inject. Broadcasting also goes
through your RPC only - there is no fallback endpoint and no telemetry.

## 1. Connect

```ts
import { Nox, MAINNET_DEPLOYMENT } from "@nonos/nox-staking-sdk";

const nox  = Nox.mainnet();
const live = nox.connect("https://eth-mainnet.example/v2/<KEY>");

const wallet   = "0xYourWallet...";
const staking  = MAINNET_DEPLOYMENT.stakingProxy;   // where stake/claim/exit calls go
const token    = MAINNET_DEPLOYMENT.token;          // NOX ERC-20
```

## 2. Read your state

```ts
await live.staking.version();                 // "4.0.0"
await live.staking.health();                  // { rewardReserve, rewardRunway, totalStaked, emissionRate, paused }
await live.staking.rewardRunway();            // seconds of rewards left, as bigint

await live.token.balanceOf(wallet);           // NOX balance, wei
await live.token.allowance(wallet, staking);  // how much the staking contract may pull, wei
await live.staking.pendingRewards(wallet);    // claimable rewards, wei
await live.staking.activePositionCount(wallet); // how many open positions you hold, bigint
```

> The SDK exposes `activePositionCount` (a count), not a decoded list of
> positions. Position IDs are assigned by the contract in order as you stake;
> track the ID returned in each stake receipt and reuse it for compound / unstake
> / early-unlock.

## Amounts: NOX to wei

NOX has 18 decimals. Every amount the calldata builders take is a `bigint` in
wei. Convert with plain bigint math:

```ts
const NOX = 10n ** 18n;
const amount = 100n * NOX;          // 100 NOX
const half   = 500n * (NOX / 2n);   // 250 NOX
```

## The canonical flow: prepare -> sign -> send

Every write uses the same three steps. Build it once and reuse it for the whole
lifecycle:

```ts
import type { TransactionSigner } from "@nonos/nox-staking-sdk";

async function send(to: `0x${string}`, data: string, signer: TransactionSigner) {
  // 1. prepare - runs eth_call + gas + nonce + fees on your RPC, no signing
  const plan = await live.tx.prepare(wallet, to, data as `0x${string}`);

  // simulate-before-sign: `simulationResult` is the eth_call return.
  // If the call would revert, prepare throws here - before any signature.
  console.log("simulated ok:", plan.simulationResult);

  // 2. sign - via YOUR injected signer. The SDK holds no keys.
  //    Throws if signer.address !== wallet.
  const raw = await live.tx.sign(signer, plan.tx);

  // 3. broadcast and wait for the receipt (through your RPC only)
  const { transactionHash, receipt } = await live.tx.sendAndWait(raw, true);
  return { transactionHash, receipt };
}
```

`signer` is anything shaped `{ address, signTransaction(tx) }` - an injected
browser wallet adapter, a hardware bridge, or a dev key. See
[sign-receipt.md](sign-receipt.md) for wiring a signer.

If you only want the hash and will poll later, use `live.tx.broadcast(raw)` then
`live.tx.waitReceipt(hash)`.

## 3. Approve NOX (once)

Before your first stake, let the staking contract pull your NOX. Approving a
large amount once avoids re-approving on every stake.

```ts
const MAX = (1n << 256n) - 1n;                       // unlimited approval
const approveData = nox.calldata.token.approve(staking, MAX);
await send(token, approveData, signer);              // note: `to` is the TOKEN
```

Check it took effect:

```ts
await live.token.allowance(wallet, staking);         // now MAX (or your amount)
```

If you prefer to approve exactly what you stake, pass that amount instead of
`MAX` and re-approve before each stake.

## 4. Stake

### Flexible (no lock)

```ts
const stakeData = nox.calldata.staking.stake(100n * NOX);
const { receipt } = await send(staking, stakeData, signer);
```

### Locked (higher tier weight)

`stakeLocked` takes the amount and a lock period **in seconds**:

```ts
const DAY = 86_400n;
nox.calldata.staking.stakeLocked(100n * NOX, 30n  * DAY);   // 30-day lock
nox.calldata.staking.stakeLocked(100n * NOX, 90n  * DAY);   // 90-day lock
nox.calldata.staking.stakeLocked(100n * NOX, 365n * DAY);   // 365-day lock

const lockData = nox.calldata.staking.stakeLocked(100n * NOX, 90n * DAY);
await send(staking, lockData, signer);
```

Locked stake counts toward a higher tier weight but cannot be withdrawn before
the lock ends - except via `earlyUnlock` (see below), which pays a penalty.

## 5. Claim and compound

Claim all pending rewards to your wallet:

```ts
await live.staking.pendingRewards(wallet);           // check first
const claimData = nox.calldata.staking.claimRewards();
await send(staking, claimData, signer);
```

Compound a position's rewards back into that position (no token transfer to your
wallet):

```ts
const positionId = 0n;                               // the ID from your stake
const compoundData = nox.calldata.staking.compoundRewards(positionId);
await send(staking, compoundData, signer);
```

## 6. Exit

### Unstake an unlocked position

```ts
const positionId = 0n;
const exitData = nox.calldata.staking.unstakePosition(positionId);
await send(staking, exitData, signer);
```

For a locked position this reverts until the lock ends. Because `prepare`
simulates first, you find out at prepare time, not after signing.

### Early unlock (still locked)

`earlyUnlock` exits a position that is still locked. The contract **burns the
early-unlock penalty** - currently **5%** of the position - and returns the
rest to you. It **reverts if the position is not locked** (use
`unstakePosition` for those).

```ts
const positionId = 0n;
const earlyData = nox.calldata.staking.earlyUnlock(positionId);
await send(staking, earlyData, signer);              // ~95% back, 5% burned
```

## Decode a revert or receipt

If a call reverts, decode the reason:

```ts
try {
  await send(staking, exitData, signer);
} catch (err) {
  // If you captured raw revert data, decode it:
  // live.tx.decodeRevert("0x08c379a0...") -> { kind, reason?, selector? }
}
```

Decode a mined receipt (events, status):

```ts
const { receipt } = await send(staking, stakeData, signer);
// `receipt` is already decoded by sendAndWait(..., true).
// To decode a raw receipt fetched elsewhere: live.tx.decodeReceipt(rawReceipt)
```

## Privacy note

Every read and write goes only to the RPC URL you passed to
`nox.connect()`. Confirm it:

```ts
live.tx.privacyReport(false);
// { schemaVersion: 1, rpcEndpoint, networkCalls: false, fallbackRpc: null, telemetry: false }
```

`fallbackRpc` is always `null` and `telemetry` is always `false`.

## Safe / hardware signers

If your treasury is a Safe (or you want the calldata without an EIP-1559 plan),
build a Safe payload instead of preparing a plan:

```ts
nox.safe.tx(staking, nox.calldata.staking.stake(100n * NOX));
// { to, value, data, operation } - sign in the Safe UI
```

See [safe-propose.md](safe-propose.md).
