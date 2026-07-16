---
title: "Pedersen Attestation"
description: "The STARK is one proof family; the other is the zkkernel, a set of transparent discrete-log proofs that back capsule attestation."
weight: 5
---
The STARK is one proof family; the other is the `zk_kernel`, a set of transparent discrete-log proofs
that back capsule attestation. A capsule can prove its enrolled secret is a member of a committed policy
tree, without revealing the secret, and the kernel checks that proof at spawn. This page documents the
proof construction; the enforcement gate and what the proof binds are on the
[capsule attestation](/docs/security/attestation/) page. The code is under `src/crypto/zk_kernel/`.

## The proof family

The `KernelZkVerifier` ([`src/crypto/zk_kernel/verifier.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/zk_kernel/verifier.rs)) supports a small set of transparent proof
systems:

```
  Range        a committed value lies in a range
  Equality     two commitments hide the same value
  Membership   a committed leaf is in a Merkle tree
  Pedersen     a commitment opens to a claimed value
  Plonk        a general arithmetic-circuit proof
```

Each is transparent: there is no trusted setup and no structured reference string, only public group
elements and hashes. The verifier returns `Valid`, `Invalid`, `MalformedProof`, or
`UnsupportedProofType`, so a garbled proof is rejected as malformed rather than crashing or being
accepted.

## The Pedersen commitment

The base object is a Pedersen commitment over the Curve25519 Edwards group
([`src/crypto/zk_kernel/pedersen.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/zk_kernel/pedersen.rs)):

```
  commit(value, blinding) = value * G + blinding * H
```

`G` is the standard Ed25519 basepoint. The second generator `H` is the load-bearing detail, and it is
derived so that **no one knows its discrete log with respect to `G`**. `derive_generator_h`
(`pedersen.rs:30`) is a nothing-up-my-sleeve hash-to-curve: it hashes the domain string
`NØNOS:TRANSPARENT:PEDERSEN:v1` with `generator_h` and a counter with BLAKE3, tries to decompress the
digest to a curve point, clears the cofactor by multiplying by eight, and takes the first success:

```
  derive_generator_h():
      seed = "NØNOS:TRANSPARENT:PEDERSEN:v1" || "generator_h"
      for counter = 0, 1, 2, ...:
          h = blake3(seed || counter)
          if point = decompress(h) exists and 8*point != identity:  return 8*point
```

Because `H` comes out of a hash of a public string, nobody, including whoever wrote the code, knows a
scalar `k` with `H = k*G`. That is what makes the commitment binding without a trusted setup: a prover
who knew `log_G(H)` could open a commitment two ways, and the hash-to-curve derivation rules that out.
The derivation is deterministic, so anyone can recompute `H` and confirm it was not chosen adversarially.

## The membership proof

The enrolled-secret attestation is a membership proof ([`src/crypto/zk_kernel/membership.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/zk_kernel/membership.rs)): a Pedersen
commitment to the leaf, a Fiat-Shamir challenge, a Schnorr-style response, and a Merkle path to the
committed root:

```
  prove(leaf, blinding, siblings, directions):
      leaf_commitment = Pedersen.commit(leaf, blinding)
      challenge       = blake3(transcript including leaf_commitment)
      response        = challenge * blinding        // the Schnorr-style response
      -> { path: siblings, directions, leaf_commitment, response }

  verify(root):  recompute the challenge, check the response, walk the path to root
```

The proof convinces the verifier that the prover knows a leaf and a blinding whose commitment sits at a
claimed position in a Merkle tree with the given root, without revealing the leaf. The challenge is the
BLAKE3 hash of the transcript (Fiat-Shamir, making it non-interactive), and the Merkle path binds the
commitment to the committed policy tree. The capsule attestation uses this to prove its enrolled secret
is in the kernel's committed policy tree, bound to the capsule's code, capabilities, and epoch, as the
[attestation gate](/docs/security/attestation/) checks.

## The honest caveat: transparent, but classical

Both proof families here are transparent, no trusted setup, but they rest on different assumptions, and
the distinction matters:

- The [STARK, FRI, and Poseidon](/docs/subsystems/proof-system/stark/) layer is **hash-based**: its security reduces to the field
  and the hash, with no number-theoretic assumption, which is the conservative, plausibly
  post-quantum foundation.
- This Pedersen attestation layer rests on the **Curve25519 discrete-log assumption** and the random
  oracle (Fiat-Shamir). It is transparent, but it is **classical, not post-quantum**: a large quantum
  computer that breaks discrete log would break the hiding and the soundness of these proofs.

So "transparent" is true of the whole proof system, but "post-quantum" is true only of the STARK layer,
not the Pedersen attestation. This page states that plainly rather than letting "zero-knowledge" and
"transparent" imply a quantum guarantee the discrete-log construction does not provide. The
[attestation verifiers](/docs/security/attestation/) are the ones fuzzed against thousands of
adversarial proofs to confirm they reject garbage rather than accept it.

## Security analysis

This proof family exists to be a spawn-time gate, so its security is the combination of the construction
above and how the kernel acts on a verification result.

**A proof is runtime evidence, and a failed proof is fail-closed.** The attestation is checked at spawn by
`verify_capsule_attestation` ([`src/security/capsule_attest/verify.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_attest/verify.rs)), which hashes the capsule ELF, packs
the granted caps and the policy epoch into a 48-byte context, and calls `verify_enrolled` against the
committed policy root. The function is `#[must_use]` with the note that a capsule must not be spawned
unless its attestation verifies, and the [attestation gate](/docs/security/attestation/) enforces exactly
that: a failure returns `SpawnError::AttestationRejected` and the capsule does not run. So the proof is not
decoration; it is a precondition, and the default is refusal. The one honest caveat is the rollout flag:
under `nonos-zk-rollout` the gate logs the failure but proceeds, and that flag is mutually exclusive with
`nonos-production` ([`src/lib.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L39)), so a production build cannot be built fail-open. Outside the rollout
window the gate is closed.

**The verifier is constant-time and rejects malformed input rather than trusting it.** `verify`
([`src/crypto/zk_kernel/attest/verify.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/zk_kernel/attest/verify.rs)) accumulates every check into a single `valid` byte, uses
`constant_time_eq` for the Merkle-root and Schnorr equality comparisons, and folds in point-decompression
success and small-subgroup rejection before returning `valid == 1`, so it does not branch early on a secret
comparison. At the proof-system layer, `KernelZkVerifier` returns `MalformedProof` for a garbled proof and
`UnsupportedProofType` for a system it does not implement ([`src/crypto/zk_kernel/verifier.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/zk_kernel/verifier.rs#L25)), so a
corrupt or unknown proof is a clean rejection, not a crash and not an accept. The binding is what makes the
evidence meaningful: the context ties the proof to the capsule's code hash, its granted caps, and the
policy epoch, so a proof valid for one capsule is not valid for a different binary or a wider cap set.

**Transparent, but classical, is restated as the boundary.** As the caveat section above sets out, this
layer's soundness and hiding rest on the Curve25519 discrete-log assumption and the Fiat-Shamir random
oracle. It needs no trusted setup, but it is not post-quantum; only the [STARK layer](/docs/subsystems/proof-system/stark/) is. The
security analysis on this page therefore does not claim a quantum guarantee for the attestation gate, and
the two families should not be conflated when reasoning about the threat model.

## Debugging Pedersen attestation

A rejected attestation surfaces at the gate, not inside the group arithmetic, and the four `AttestError`
variants name the cause.

**Read the gate marker first.** The [attestation gate](/docs/security/attestation/) prints
`[ZK-ATTEST] ok`, `[ZK-ATTEST] FAIL`, or `[ZK-ATTEST] none` with the capsule name, and on a failure it
appends the `AttestError` string. `Missing` (the trailer is empty) means the capsule carries no attestation
at all, which is a build or enrollment gap, not a proof that failed. `RootUnavailable` means the committed
policy root was never installed, so nothing can verify against it, a kernel-init ordering problem one layer
up. `Malformed` is the trailer failing to parse. `Rejected` is the one that means the proof was
well-formed and the group checks did not pass (`verify_enrolled` returned false), which is the real "this
secret is not in the policy tree, or not bound to this capsule" case.

**Distinguishing a wrong binding from a wrong secret.** Because the context binds the code hash, the caps,
and the epoch, a `Rejected` on a capsule that was enrolled correctly is often a binding mismatch: the ELF
was rebuilt (new hash), the granted cap set changed, or the policy epoch moved, so a proof that once
verified no longer matches the recomputed context. That is distinct from a genuinely forged or absent
enrolled secret, and the way to tell them apart is whether the capsule bytes or its cap grant changed since
the proof was produced. The negative-testing harness that confirms the verifier rejects garbage over
thousands of adversarial proofs is in [`userland/crypto_proofs/src/zk_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/zk_tests.rs).

## Source map

```
  src/crypto/zk_kernel/pedersen.rs     the commitment and the nothing-up-my-sleeve H
  src/crypto/zk_kernel/membership.rs   the Schnorr-style membership proof + Merkle path
  src/crypto/zk_kernel/equality.rs     the equality proof
  src/crypto/zk_kernel/verifier.rs     KernelZkVerifier and the ZkResult / ProofSystem enums
  src/crypto/zk_kernel/attest/verify.rs   verify_enrolled: the constant-time Schnorr + Merkle check
  src/security/capsule_attest/verify.rs   verify_capsule_attestation, the #[must_use] spawn gate
  src/security/capsule_attest/error.rs    AttestError: Missing / Malformed / RootUnavailable / Rejected
  userland/crypto_proofs/src/zk_tests.rs   the adversarial soundness fuzzing
```

Every reference above is verified against those trees. The gate that consumes `verify_capsule_attestation`
and prints the `[ZK-ATTEST]` marker, along with what the proof binds, is on the
[capsule attestation](/docs/security/attestation/) page; the hash-based sibling family and its
post-quantum footing are on the [STARK](/docs/subsystems/proof-system/stark/) page.
