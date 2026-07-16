---
title: "The STARK"
description: "The kernel carries a transparent STARK: a proof system that lets a prover convince a verifier that a computation satisfies a set of algebraic constraints, with no trusted setup,..."
weight: 3
---
The kernel carries a transparent STARK: a proof system that lets a prover convince a verifier that a
computation satisfies a set of algebraic constraints, with no trusted setup, resting only on the field
and a hash. This page documents the prover, the verifier, and the low-degree test they share. The code
is under `src/crypto/stark/air/` and `src/crypto/stark/fri/`.

## The AIR

A computation is stated as an Algebraic Intermediate Representation, the `Air` trait
([`src/crypto/stark/air/spec.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/air/spec.rs#L28)):

```
  trait Air:
      log_trace_len()      -> u32     // log2 of the number of steps
      trace_width()        -> usize   // columns (state registers)
      transition(frame)    -> [Fp]    // constraints that must vanish between consecutive rows
      boundary()           -> [...]   // public conditions on the first / last rows
      constraint_degree()  -> usize   // the maximum constraint polynomial degree
```

The trace is a table: `trace_width` columns and `2^log_trace_len` rows, one row per step of the
computation. The transition constraints are the rules that must hold between each row and the next
(for example "the next value is this value cubed"), and the boundary constraints pin the public
inputs and outputs on the first and last rows. A specific computation is an `Air` impl; the
[catalog](/docs/subsystems/proof-system/air-catalog/) is the set of them.

## The prover

`stark_prove` ([`src/crypto/stark/air/prove.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/air/prove.rs#L54)) turns a satisfying trace into a proof:

```
  stark_prove(air, trace):
      1. low-degree extend each trace column over a coset (shift 7) of a larger domain
      2. Merkle-commit each extended column; absorb the roots into the transcript
      3. draw random composition coefficients from the transcript
      4. build the composition polynomial: fold the transition and boundary
         quotients under those coefficients into one polynomial
      5. draw an out-of-domain point z from the transcript (off both domains)
      6. open the trace frame at z; build the DEEP quotient binding the
         committed columns to that out-of-domain frame
      7. run FRI on the DEEP quotient to prove it is low degree
```

Each step is standard and each is what makes the proof sound. The trace is extended to a larger domain
so a low-degree test is meaningful; the Merkle commitment binds the prover to the columns before it
sees any challenge; the random composition coefficients collapse many constraints into one polynomial
that is low-degree only if every constraint held; the out-of-domain point `z`, drawn after the
commitments, forces the prover to answer at a point it could not have prepared for (the DEEP-ALI
technique); and FRI proves the resulting quotient really is low degree.

## The verifier

`stark_verify` ([`src/crypto/stark/air/verify.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/air/verify.rs#L40)) mirrors the prover exactly:

```
  stark_verify(air, proof):
      1. absorb the claimed roots; redraw the same coefficients, z, and DEEP coefficients
         (identical Fiat-Shamir, so prover and verifier agree by construction)
      2. recompute the composition value at z from the claimed frame, using the AIR's own algebra
      3. FRI-verify the DEEP quotient is low degree
      4. for each sampled query: check the Merkle openings against the committed roots,
         reconstruct the DEEP value from them, and match it to the FRI query
```

The verifier never trusts the prover's claimed evaluations; it recomputes the constraint algebra itself
at the out-of-domain point and checks the openings against the committed roots. The Fiat-Shamir
transcript is what makes the whole thing non-interactive: both sides derive every challenge by hashing
the transcript so far, so a dishonest prover cannot choose a challenge to its advantage.

## FRI

FRI is the low-degree test at the core, and the verifier's soundness rests on it
([`src/crypto/stark/fri/verify.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/fri/verify.rs)). The prover commits a codeword, and repeatedly folds it in half under
a transcript challenge, committing each layer, until a constant remains; the verifier redraws the fold
challenges, **checks the final layer is a single constant** ([`fri/verify.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fri/verify.rs#L62)), and for each query
re-derives the fold from the openings and checks it matches the next layer's committed value
([`fri/verify.rs:103`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fri/verify.rs#L103)):

```
  fri_verify(proof):
      redraw fold challenges from the transcript
      require final_layer is constant           // a high-degree codeword folds to a non-constant w.h.p.
      for each query: recompute the fold from the openings; match the next layer
```

If the original codeword were not low degree, folding it would not collapse to a constant except with
negligible probability, so the constant-final-layer check plus the per-query fold consistency is the
low-degree guarantee.

## Two FRI variants

There are two FRIs (`src/crypto/stark/fri/` and `fri_poseidon/`), differing only in their hash: the
default uses BLAKE3 for the Merkle commitments and the Fiat-Shamir transcript, while `fri_poseidon`
uses the [Poseidon](/docs/subsystems/proof-system/field-and-poseidon/) permutation for both. The Poseidon variant is slower per hash
but algebraic, which means the verifier itself can be expressed as STARK constraints and proven inside
another proof. That is the door to recursion, covered on the [AIR catalog](/docs/subsystems/proof-system/air-catalog/) page.

## Honest scope

What this system is: a complete, transparent STARK, prover and verifier, with the standard sound
components (low-degree extension, Merkle commitment, random-coefficient constraint composition,
DEEP out-of-domain binding, and a FRI low-degree test), needing no trusted setup and no parameters
beyond the field and the hash. What it is not: it does not ship a machine-checked proof of its own
soundness, and the kernel is `no_std` so there are no in-tree unit tests of the STARK itself; its
security is the security of these well-studied components as implemented here. The negative testing
that does exist is on the [attestation verifiers](/docs/subsystems/proof-system/pedersen-attestation/), which are fuzzed to reject
random proofs over thousands of adversarial inputs.

## Security analysis

The STARK's job is to be a verifier a dishonest prover cannot fool, and the way it fails is as important
as the way it passes.

**The verifier recomputes, it never trusts.** `stark_verify` ([`air/verify.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/air/verify.rs#L40)) redraws every
Fiat-Shamir challenge from the transcript itself, recomputes the composition value at the out-of-domain
point from the AIR's own algebra, and checks each query's Merkle openings against the committed roots. It
does not read a claimed pass/fail from the proof. This is what makes soundness structural rather than
polite: a proof is accepted only because the verifier reran the constraint algebra and it matched, so a
forged evaluation has to survive the recomputation, not just be asserted.

**Every check is fail-closed, and the return is a bare `bool`.** `stark_verify` returns `false` the
moment anything is off: the wrong shape ([`air/verify.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/air/verify.rs#L52), the root, frame, and query counts must match
the AIR), a Merkle opening that does not reconstruct, or a FRI query that does not match. FRI itself
requires the final layer to be a single constant ([`fri/verify.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fri/verify.rs#L63)) and rejects otherwise, which is the
low-degree conclusion, because a high-degree codeword folds to a non-constant with overwhelming
probability. There is no partial-credit path and no exception that leaves the proof half-accepted; the
function is a total predicate that says yes only when everything held.

**The honest boundary is that soundness is inherited, not proven in-tree.** As the scope section states,
this system ships no machine-checked proof of its own soundness and, being `no_std`, carries no in-tree
unit tests of the STARK itself. Its security is the security of low-degree extension, Merkle commitment,
random-coefficient composition, DEEP out-of-domain binding, and the FRI test as implemented here. The
negative testing that does exist is on the [attestation verifiers](/docs/subsystems/proof-system/pedersen-attestation/), fuzzed to
reject random proofs over thousands of adversarial inputs. So the claim is "a faithful implementation of
sound components," not "a formally verified verifier," and this page says so rather than implying more.

## Debugging the STARK

Because `stark_verify` returns only `true` or `false`, a rejection carries no message of its own; you
localize it by the shape check it fails and by the runtime path that consumes the result.

**Where a rejection actually surfaces.** In the running kernel the STARK and zk verifiers are reached
through capsule attestation, and that path prints. The [attestation gate](/docs/security/attestation/)
emits `[ZK-ATTEST] ok`, `[ZK-ATTEST] FAIL`, or `[ZK-ATTEST] none` on the serial console with the capsule
name ([`src/kernel_core/process_spawn/capsule_spawn/runner/attest_gate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/attest_gate.rs)), so a proof that fails to
verify shows up there, not inside the prover. That marker is the first thing to read when a signed capsule
will not spawn.

**Splitting a bare `false` by cause.** The early shape check ([`air/verify.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/air/verify.rs#L52)) rejects a proof whose
root count, out-of-domain frame length, or query count does not match what the AIR declares, which is the
signature of a proof built against a different AIR shape than the one verifying it, a serialization or
version mismatch rather than a soundness failure. A proof that passes the shape check but still returns
`false` failed either a Merkle opening or the FRI consistency, meaning the committed data and the claimed
evaluations do not agree, which is the genuine "this is not a valid proof of this statement" case. The
constant-final-layer check in FRI ([`fri/verify.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fri/verify.rs#L63)) is the specific spot a not-actually-low-degree
codeword dies, so a prover bug that produces a too-high-degree quotient surfaces exactly there.

## Source map

```
  src/crypto/stark/air/spec.rs         the Air trait
  src/crypto/stark/air/prove.rs         stark_prove
  src/crypto/stark/air/verify.rs        stark_verify
  src/crypto/stark/air/composition.rs   the constraint composition
  src/crypto/stark/fri/                  the BLAKE3 FRI (prove, fold, verify)
  src/crypto/stark/fri_poseidon/         the recursion-friendly Poseidon FRI
  src/crypto/stark/transcript.rs, poseidon_transcript.rs   the Fiat-Shamir transcripts
  src/kernel_core/process_spawn/capsule_spawn/runner/attest_gate.rs   the [ZK-ATTEST] marker a rejection surfaces through
```

Every reference above is verified against those trees. The AIRs this prover and verifier operate on are
cataloged on the [AIR catalog](/docs/subsystems/proof-system/air-catalog/) page, the field and hash they are expressed over are on the
[field and hash](/docs/subsystems/proof-system/field-and-poseidon/) page, and the runtime gate that consumes a verification result and
turns a `false` into a refused spawn is on the [capsule attestation](/docs/security/attestation/) page.
