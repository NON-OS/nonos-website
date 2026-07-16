---
title: "Route RPC through a proxy or Tor"
description: "Keep your IP out of your RPC provider logs."
weight: 80
---


The SDK makes exactly one kind of outbound call: a JSON-RPC POST to the URL you
pass to `nox.connect(rpcUrl)`. If you want that call to leave your machine
through a proxy or Tor, you control it at the level the SDK already gives you:
the RPC URL and your process network settings. The SDK adds no fallback endpoint
and no telemetry, so nothing else leaves your machine.

## Pick a private RPC endpoint

The simplest lever is the URL itself. Point `nox.connect(...)` at any endpoint
you trust: your own node, a gateway on your LAN, or a hosted provider. Whoever
runs that endpoint sees the request; nobody else does.

```ts
const nox  = Nox.mainnet();
const live = nox.connect("http://127.0.0.1:8545");   // your own node
```

## Node: route fetch through SOCKS5 (Tor, or an internal hop)

Node's `fetch` does not speak SOCKS5 on its own. Install a SOCKS-aware dispatcher
and set it globally before you connect:

```ts
import { socksDispatcher } from "fetch-socks";
import { setGlobalDispatcher } from "undici";
import { Nox } from "@nonos/nox-staking-sdk";

// e.g. Tor's local SOCKS5 port
setGlobalDispatcher(socksDispatcher({ type: 5, host: "127.0.0.1", port: 9050 }));

const nox  = Nox.mainnet();
const live = nox.connect("https://eth-mainnet.example/v2/<KEY>");
await live.staking.stats();   // now travels through the SOCKS5 proxy
```

Any HTTP or SOCKS proxy your OS already enforces works the same way, with no SDK
changes: the SDK just calls `fetch`.

## Browser

The browser controls its own egress. Run the page in Tor Browser, or route the
whole browser through a proxy at the OS level. The SDK does not need to know.

## What a proxy buys, and what it does not

The RPC provider sees the proxy exit IP, not yours. With Tor you get standard
onion routing.

It does not anonymize what you sign on-chain. If you broadcast a transaction from
`0xYourAddress`, that address is linked to the action forever, regardless of how
the RPC call was routed.
