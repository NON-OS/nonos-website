---
title: "Proof System"
description: "NØNOS carries its own transparent proof machinery in the kernel: a STARK over the Goldilocks field for hash-based proofs, and a family of Curve25519 discrete-log proofs for caps..."
weight: 18
---
NØNOS carries its own transparent proof machinery in the kernel: a STARK over the Goldilocks field for
hash-based proofs, and a family of Curve25519 discrete-log proofs for capsule attestation. Both are
transparent, no trusted setup, no structured reference string, and both rest only on public
parameters anyone can regenerate and audit. This is the cryptographic spine under
[capsule attestation](/docs/security/attestation/).

| Page | What it covers |
|------|----------------|
| [field-and-poseidon.md](/docs/subsystems/proof-system/field-and-poseidon/) | The Goldilocks field, and the arithmetization-friendly Poseidon-style hash, described precisely (NUMS constants, all-full-rounds, not the published reference set). |
| [stark.md](/docs/subsystems/proof-system/stark/) | The AIR, the prover (LDE, commit, composition, DEEP, FRI), the verifier, the FRI low-degree test, and the two FRI variants. |
| [air-catalog.md](/docs/subsystems/proof-system/air-catalog/) | The AIR gadgets, the `wired` mega-AIR, in-circuit Fiat-Shamir, and how the pieces compose into a recursive verifier. |
| [pedersen-attestation.md](/docs/subsystems/proof-system/pedersen-attestation/) | The transparent Pedersen commitment (nothing-up-my-sleeve `H`), the Schnorr-style membership proof, and the classical-not-post-quantum caveat. |

## What "transparent" means here, and its limits

The system's design goal is to prove properties of the code that actually runs, and to do so without any
setup ceremony a reader would have to trust. Concretely: the STARK needs no parameters beyond the field
and the hash; the Poseidon constants are the BLAKE3 hash of a public domain string, so anyone can
regenerate them; and the Pedersen second generator `H` is a hash-to-curve of a public string, so nobody
knows its discrete log. There is no toxic waste and no trusted party.

The honest boundary is the assumption each layer rests on, and the documentation states it rather than
blurring it under "zero-knowledge":

```
  STARK / FRI / Poseidon      hash-based, no number-theoretic assumption   -> conservative, plausibly post-quantum
  Pedersen attestation        Curve25519 discrete log + random oracle       -> transparent, but CLASSICAL
```

Both are transparent; only the STARK layer is hash-based and plausibly post-quantum, while the Pedersen
attestation is a classical discrete-log construction. And the system ships the standard sound components
rather than a machine-checked soundness proof; the negative testing that exists fuzzes the attestation
verifiers to reject random proofs over thousands of adversarial inputs.

## Sources

The STARK is `src/crypto/stark/`: `field/` (Goldilocks), `air/` (the AIR trait, the prove and verify,
the composition, and the gadget catalog including `wired` and `fiat_shamir`), `fri/` and `fri_poseidon/`
(the low-degree test), `merkle/`, and the transcripts. The attestation proofs are `src/crypto/zk_kernel/`
(`pedersen`, `membership`, `equality`, `verifier`). The adversarial tests are
[`userland/crypto_proofs/src/zk_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/zk_tests.rs). Every page is verified against those trees with `file:line`
references, and states honestly where a claim is proven, well-founded, or merely well-structured.
