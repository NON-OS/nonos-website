---
title: "Sign a stake receipt"
description: "Turn a position into portable, locally verifiable EIP-712 proof."
weight: 20
---


The SDK builds and verifies receipts. **Signing happens in your wallet**, through
a signer you inject. The SDK never holds keys.

## Build the typed-data payload

```ts
import { Nox } from "@nonos/nox-staking-sdk";

const nox = Nox.mainnet();

const proof = nox.proof.build({
  wallet:     "0xYourWallet...",
  positionId: 0n,
  amount:     "10000",
  lockUntil:  new Date("2030-01-01"),
  issuedAt:   new Date(),
  boostBps:   1500,
  tier:       3,
});
```

`proof.receipt` is the EIP-712 message. The domain is `{ name: "NOX Operator Kit", version: "1", chainId: 1, verifyingContract: stakingProxy }`.

## Sign with an injected wallet (ethers v6)

Any signer works: an injected browser wallet, a hardware bridge, or, for local
development, an ethers `Wallet`. The SDK does not load keystores or private keys.

```ts
import { Wallet } from "ethers";

const signer = new Wallet(process.env.PK!);   // dev only; use a real wallet in production

const sig = await signer.signTypedData(
  { name: "NOX Operator Kit", version: "1", chainId: nox.chainId, verifyingContract: nox.deployment.stakingProxy },
  {
    NoxStakeReceipt: [
      { name: "wallet",            type: "address" },
      { name: "chainId",           type: "uint256" },
      { name: "stakingContract",   type: "address" },
      { name: "positionId",        type: "uint256" },
      { name: "amount",            type: "uint256" },
      { name: "lockUntil",         type: "uint256" },
      { name: "boostBps",          type: "uint32"  },
      { name: "tier",              type: "uint8"   },
      { name: "issuedAt",          type: "uint256" },
      { name: "onchainOperatorId", type: "bytes32" },
      { name: "offchainOperatorId",type: "bytes32" },
    ],
  },
  proof.receipt,
);
```

## Verify locally

The SDK recomputes the operator IDs and the body digest from the receipt and
rejects any mismatch. No network and no backend are involved.

```ts
nox.proof.verify(proof.receipt, proof.digest).valid;   // true if intact
```

To confirm who signed, recover the address from the EIP-712 signature with the
same domain and types you signed under. That is a standard wallet-library call
(`ethers.verifyTypedData(domain, types, proof.receipt, sig)`), and it should
equal `proof.receipt.wallet`.
