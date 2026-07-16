---
title: Staking
linkTitle: Staking
description: Local-first tools for staking NOX on Ethereum mainnet. Your keys, your RPC, no backend, no telemetry.
weight: 90
---

NOX staking follows the same rule as everything else in this project: do not
ask anyone to trust a server. The whole stack runs on your own machine. Your
keys stay in your wallet, requests go only to the RPC endpoint you choose, and
nothing phones home.

Two pieces, one repository:

- **The dashboard**, `@nonos/nox-dashboard`, is a browser UI for stakers. One
  command runs it locally: `npx @nonos/nox-dashboard`.
- **The SDK**, `@nonos/nox-staking-sdk`, is a typed TypeScript library for
  builders: calldata, live reads, receipts, and hashing.

A hosted copy of the dashboard runs at
[staking.nonos.software](https://staking.nonos.software). It is the same
static bundle you get from `npx`, so you can verify it against what you build
yourself, and it still talks only to your RPC and wallet. Running locally is
the stronger position; the hosted copy is a convenience.

## Start here

- [Install](/docs/staking/install/) the SDK and the dashboard.
- [Quickstart](/docs/staking/quickstart/): your first proof in 30 seconds.
- [Stake and manage a position](/docs/staking/guides/stake/): the full
  lifecycle, approve to exit.
- [Recipes](/docs/staking/recipes/): short, copyable answers.

## Guides

- [Sign a stake receipt](/docs/staking/guides/sign-receipt/) and verify it
  locally, no backend involved.
- [Namespaces](/docs/staking/guides/namespace/): reserve names in the
  on-chain registry.
- [Eligibility gates](/docs/staking/guides/eligibility/): gate features on
  stake tiers.
- [Read on-chain state](/docs/staking/guides/read-onchain/) through your own
  RPC.
- [Use the SDK in the browser](/docs/staking/guides/browser/).
- [Propose through a Safe](/docs/staking/guides/safe-propose/) for hardware
  and multisig custody.
- [Route RPC through a proxy or Tor](/docs/staking/guides/proxy/) to keep
  your IP out of provider logs.

## Where staking ends and the kernel begins

NOX staking grants ecosystem rights. It does not grant kernel capabilities.
Runtime authority on a NØNOS machine flows through the signed
`CapsuleManifest` and the kernel's capability system, never through this SDK
or any on-chain position. The two trust chains are deliberately separate, and
nothing in the staking stack can sign a manifest or a kernel grant.

## Contracts

The SDK ships a pinned mainnet deployment, so integrations verify addresses
instead of trusting a lookup. The contracts are public:
[NOX-SmartContract](https://github.com/NON-OS/NOX-SmartContract), operated
under a 3-of-5 Safe.
