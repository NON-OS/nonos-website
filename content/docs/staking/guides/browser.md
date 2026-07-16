---
title: "Use the SDK in the browser"
description: "Browser wallets, bundlers, and the injected signer contract."
weight: 60
---


The SDK is ESM and browser-safe. Its only crypto dependency is `@noble/hashes`, which ships without Node bindings.

## Vite

```bash
npm create vite@latest nox-app -- --template react-ts
cd nox-app
npm install @nonos/nox-staking-sdk
```

`src/App.tsx`:

```tsx
import { Nox } from "@nonos/nox-staking-sdk";
import { useState } from "react";

const nox = Nox.mainnet();

export default function App() {
  const [hash, setHash] = useState("");
  return (
    <main>
      <button onClick={() => setHash(nox.namespace.hash("operator.alice"))}>
        hash namespace
      </button>
      <pre>{hash}</pre>
    </main>
  );
}
```

```bash
npm run dev
```

## Next.js (app router)

Same install. Use the SDK in client components or on the server:

```tsx
"use client";
import { Nox } from "@nonos/nox-staking-sdk";

export function TierBadge({ score }: { score: bigint }) {
  const nox = Nox.mainnet();
  return <span>{nox.tier.nameFromWei(score)}</span>;
}
```

## Webpack / esbuild / Rollup

No special config needed. The SDK is published as ESM with `"type": "module"`. Bundlers since 2022 handle this directly.

## Live reads in the browser

`nox.connect(rpcUrl)` uses the global `fetch`. Any browser RPC URL works (Alchemy, Infura, your own gateway). CORS must be allowed by the RPC provider.

```ts
const live = nox.connect("https://eth-mainnet.g.alchemy.com/v2/<KEY>");
const stats = await live.staking.stats();
console.log(stats.totalStaked);
```

## What doesn't work in the browser

- File-system reads (irrelevant - the SDK doesn't touch the filesystem).
- Hardware wallet signers (out of SDK scope; build a Safe payload with
  `nox.safe.tx` and sign in the Safe UI - see [safe-propose.md](safe-propose.md)).
