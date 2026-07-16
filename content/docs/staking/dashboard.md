---
title: The dashboard
linkTitle: Dashboard
description: Run the NOX staking dashboard on your own machine with one command. No server to trust, no telemetry, no fallback RPC.
weight: 10
---

`@nonos/nox-dashboard` is a local-first staking dashboard. It runs in your
browser, talks only to the RPC and wallet you choose, and never sends your
data anywhere. Every transaction is prepared and validated locally by the
[SDK](/docs/staking/sdk/).

## Run it locally

One command. It downloads the prebuilt dashboard, serves it on localhost, and
opens your browser:

```bash
npx @nonos/nox-dashboard
```

Node 20 or newer. Nothing is installed globally, and nothing keeps running
after ctrl-c. The dashboard is on your machine, so there is no server to
trust.

## What it does

- Reads live protocol and account state through your RPC.
- Prepares, simulates, and sends staking transactions: approve, stake, stake
  locked, claim, compound, unstake, and early unlock.
- Connects a browser wallet or WalletConnect, or watches an address read-only.
- Exports calldata or a Safe payload for hardware and multisig signing.

## What it will not do

- No fallback RPC. Requests go only to the endpoint you enter.
- No telemetry, no analytics, no third-party calls.
- No keys held. Signing happens only through your wallet.
- Nothing is broadcast without your explicit confirmation.

Watch-only mode cannot sign. Use a Safe or a hardware wallet for meaningful
balances.

## Build it from source

```bash
git clone https://github.com/NON-OS/NOXDashboard.git
cd NOXDashboard
npm install
npm run dev        # develop at http://127.0.0.1:5173
npm run build      # static bundle in dist/
npm start          # serve the built dist/ locally, same as npx
```

The build is a static single-page app. `npx`, the source build, and the hosted
copy at [staking.nonos.software](https://staking.nonos.software) all produce
and serve the same bundle, which is the point: you can always diff what we
host against what you built.

The dashboard is AGPL-3.0-or-later, like the rest of the project.
