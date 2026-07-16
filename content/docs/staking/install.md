---
title: "Install"
description: "Install the SDK and the dashboard, from npm or from source."
weight: 4
---


How to install and run both pieces of the NOX staking tools:

- the **dashboard** (`@nonos/nox-dashboard`), a browser app for stakers, and
- the **SDK** (`@nonos/nox-staking-sdk`), a TypeScript library for builders.

Everything is local-first. You can run it entirely on your own machine, or use
the copy we host. Nothing here holds your keys or adds telemetry.

## Contents

- [Prerequisites](#prerequisites)
- [Install the dashboard](#install-the-dashboard)
  - [Option A: hosted (nothing to install)](#option-a-hosted-nothing-to-install)
  - [Option B: run locally with npx](#option-b-run-locally-with-npx)
  - [Option C: build from source](#option-c-build-from-source)
- [Install the SDK](#install-the-sdk)
  - [Add it to a project](#add-it-to-a-project)
  - [First script](#first-script)
  - [Build the SDK from source](#build-the-sdk-from-source)
- [Verify what you installed](#verify-what-you-installed)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Prerequisites

You need **Node.js 20 or newer** for the local and source paths. The hosted
dashboard needs nothing but a browser.

Check your version:

```bash
node --version   # must be v20.0.0 or higher
```

If you do not have Node, or it is older than 20:

- macOS (Homebrew): `brew install node`
- Debian / Ubuntu: use [nodesource](https://github.com/nodesource/distributions) or `nvm`
- Any OS: [nvm](https://github.com/nvm-sh/nvm) then `nvm install 20 && nvm use 20`
- Windows: the installer from [nodejs.org](https://nodejs.org)

`npm` ships with Node. `pnpm`, `yarn`, and `bun` also work everywhere below.

## Install the dashboard

The dashboard is a static single-page app. There are three ways to use it, all
serving the same build.

### Option A: hosted (nothing to install)

Open the copy we host:

```
https://staking.nonos.software
```

This is the same static bundle you get from the other two options, served by us
for convenience. It has no backend, no telemetry, and no fallback RPC; it talks
only to the RPC and wallet you choose. If you would rather have nothing but your
own machine in the path, use Option B.

### Option B: run locally with npx

One command. It downloads the prebuilt dashboard, serves it on localhost, and
opens your browser:

```bash
npx @nonos/nox-dashboard
```

Nothing is installed globally, and nothing keeps running after you stop it with
`ctrl-c`. Because it runs on your machine, there is no server in the path but
your own computer.

Useful flags and environment:

```bash
PORT=5180 npx @nonos/nox-dashboard     # choose the port (default 5173, then next free)
NOX_NO_OPEN=1 npx @nonos/nox-dashboard # do not auto-open the browser
```

### Option C: build from source

```bash
git clone https://github.com/NON-OS/NOXDashboard.git
cd NOXDashboard
npm install
npm run dev        # develop at http://127.0.0.1:5173
npm run build      # static bundle in dist/
npm start          # serve the built dist/ locally, same as npx
```

The output in `dist/` is a plain static site. Host those files on any static
host, or open them with any static server. All three options produce and serve
the same bundle.

## Install the SDK

The SDK is a headless TypeScript library. It has no UI and does no network I/O
unless you explicitly connect it to an RPC.

### Add it to a project

```bash
npm  install @nonos/nox-staking-sdk
pnpm add     @nonos/nox-staking-sdk
yarn add     @nonos/nox-staking-sdk
bun  add     @nonos/nox-staking-sdk
```

It is **ESM only** and ships its own TypeScript types. The only runtime
dependency is `@noble/hashes`, so it is safe in the browser and in Node.

### First script

Create `stake-demo.mjs`:

```js
import { Nox } from "@nonos/nox-staking-sdk";

// Pure: hashes, IDs, receipts, eligibility. No network.
const nox = Nox.mainnet();

console.log(nox.namespace.hash("operator.alice"));
console.log(nox.tier.nameFromNox("100000"));          // "Operator"
console.log(nox.operator.id({ wallet: "0x0000000000000000000000000000000000000001", positionId: 0n }));

// Optional: typed reads of the live mainnet contracts through YOUR rpc.
// const live = nox.connect("https://eth-mainnet.example/v2/<KEY>");
// console.log(await live.staking.version());
```

Run it:

```bash
node stake-demo.mjs
```

TypeScript works the same way; the package ships declarations, so imports are
fully typed with no `@types` package to add.

For what to do next, see [QUICKSTART.md](/docs/staking/quickstart/) and the guides linked
from the [README](/docs/staking/sdk/).

### Build the SDK from source

```bash
# --recursive also checks out the dashboard app under dashboard/
git clone --recursive https://github.com/NON-OS/NOXtools.git
cd NOXtools

npm install
npm run build   # tsc -> dist/
npm test        # vitest, including the adversarial suite
```

If you already cloned without `--recursive`, run `git submodule update --init`.
The SDK builds standalone; the `dashboard/` submodule is only needed if you also
want to build the app (`cd dashboard && npm install && npm run build`).

## Verify what you installed

Both packages are published to npm with build provenance, so you can confirm
they were built from the public source by the release workflow.

```bash
# see the published version and metadata
npm view @nonos/nox-staking-sdk version
npm view @nonos/nox-dashboard   version

# check provenance and signatures for an installed package
npm audit signatures
```

The docs you are reading also ship inside the SDK package. After
`npm install @nonos/nox-staking-sdk`, find them under
`node_modules/@nonos/nox-staking-sdk/docs/`.

## Troubleshooting

**`npm error ... Unsupported engine` or an EBADENGINE warning.**
Your Node is older than 20. Upgrade with `nvm install 20 && nvm use 20`, or
install Node 20+ from nodejs.org, then retry.

**`Cannot use import statement outside a module` / `require is not defined`.**
The SDK is ESM only. Use `import`, give the file a `.mjs` extension, or set
`"type": "module"` in your `package.json`. It cannot be loaded with `require()`.

**`npx @nonos/nox-dashboard` cannot bind the port.**
Another process is on the default port. Pass a free one:
`PORT=5180 npx @nonos/nox-dashboard`.

**The browser did not open.**
Open the printed `http://127.0.0.1:<port>` URL yourself, or you passed
`NOX_NO_OPEN=1`.

**A read call throws or times out.**
The SDK only talks to the RPC URL you pass to `nox.connect(...)`. There is no
fallback endpoint by design. Check the URL, your key, and that the endpoint
serves Ethereum mainnet (chain 1).

**Corporate proxy or Tor.**
See [Route RPC through a proxy or Tor](/docs/staking/guides/proxy/).

## Uninstall

```bash
# SDK, from a project
npm uninstall @nonos/nox-staking-sdk

# dashboard: nothing to uninstall for the hosted or npx paths.
# npx leaves nothing installed globally. For a source clone, delete the folder.
```
