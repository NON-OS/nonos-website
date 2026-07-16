---
title: "The Field and the Hash"
description: "The proof system is built over one field and one arithmetization-friendly hash."
weight: 2
---
The proof system is built over one field and one arithmetization-friendly hash. Everything else,
the STARK, the FRI test, the Merkle commitments, the in-circuit transcript, is expressed in terms of
these two. This page documents them, and it is precise about what the hash is and is not. The code is
under `src/crypto/stark/field/` and [`src/crypto/stark/air/poseidon.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/air/poseidon.rs).

## The Goldilocks field

The field is Goldilocks, the prime `p = 2^64 - 2^32 + 1` ([`src/crypto/stark/field/element.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/field/element.rs#L19)):

```
  pub const P: u64 = 0xFFFF_FFFF_0000_0001;   // 2^64 - 2^32 + 1
```

`Fp` wraps a `u64` held canonically in `[0, p)`, with addition, subtraction, multiplication,
exponentiation, and inversion. Goldilocks is the standard field for modern STARKs because it is just
under `2^64` (so an element fits a machine word) and its reduction is cheap (`2^64 ≡ 2^32 - 1`, a single
conditional subtraction), and it has a large two-adic subgroup, which is what the FFT-based low-degree
extension needs. All the AIR trace values, constraint evaluations, and FRI codewords live in this
field.

## The hash: an honest description

The proof system's algebraic hash is a Poseidon-*style* permutation over Goldilocks
([`src/crypto/stark/air/poseidon.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/stark/air/poseidon.rs)). It is important to describe it exactly, because it is not a
drop-in of the published reference Poseidon, and overstating that would be wrong. What the code
actually implements is:

```
  width 8, rate 4, capacity 4                 // 256-bit capacity -> ~128-bit sponge security
  S-box x^7                                    // 7 is coprime to the group order, so x^7 is a bijection
  a Cauchy MDS diffusion matrix                // M[i][j] = 1/(x_i - y_j), provably MDS for disjoint nodes
  a full S-box layer every round               // no partial rounds
  round constants by a nothing-up-my-sleeve rule
```

Two of these differ from standard Poseidon and are worth stating plainly. First, the construction uses
a **full S-box layer on every round** rather than the standard Poseidon mix of a few full rounds and
many cheaper partial rounds; this is a more conservative and more uniform round function, at a higher
cost, not the published round schedule. Second, the **round constants are self-derived by a
nothing-up-my-sleeve rule**, the BLAKE3 hash of the domain string `NØNOS-POSEIDON-GOLDILOCKS-RC` with
the round and lane indices (`poseidon.rs:224`), rather than the published reference constant set. So
this is a transparent, arithmetization-friendly hash of the Poseidon family; its trustworthiness comes
from the parameters being reproducible and free of hidden structure (anyone can regenerate the
constants from the domain string, and the Cauchy matrix is provably MDS), not from matching a
published parameter set or reference test vectors. There are correspondingly no reference-vector tests
for it, because it is not claiming to reproduce a reference; the guarantee is the auditability of the
derivation.

## Why an algebraic hash

The point of a Goldilocks-native hash is that it can be expressed as field arithmetic, and therefore as
STARK constraints. The `x^7` S-box is a degree-7 polynomial and the MDS mix is linear, so one round of
the permutation is a low-degree constraint over the trace. This is what makes the
[AIR catalog's](/docs/subsystems/proof-system/air-catalog/) `Poseidon` and `MerkleMembership` gadgets possible, and it is what lets
the [FRI and transcript](/docs/subsystems/proof-system/stark/) run in a Poseidon variant that is itself provable inside the proof
system. A standard byte-oriented hash like BLAKE3 cannot be arithmetized cheaply; this one can, which is
the whole reason it exists alongside the kernel's [general-purpose BLAKE3](/docs/subsystems/crypto/hashes/).

## Uses of the permutation

The permutation backs two things (`poseidon.rs:86`, `poseidon.rs:138`): a sponge hash (absorb rate
lanes, permute, squeeze) and a two-to-one Merkle compression (`state = [left | right]`, permute, take
the rate lanes), which is the node hash for the [Poseidon Merkle tree](/docs/subsystems/proof-system/stark/) the recursive-friendly
FRI uses.

## Security analysis

The field and the hash are the two primitives everything else reduces to, so their properties, and the
honesty about what the hash is, are the security ground the whole proof system stands on.

**The hash's trust comes from auditable derivation, not from a reference match.** The construction uses a
full x^7 S-box layer on every round (`poseidon.rs:79`, `.pow(7)` on each lane) and derives its round
constants from the BLAKE3 hash of the domain string `NØNOS-POSEIDON-GOLDILOCKS-RC` (`poseidon.rs:55`),
rather than shipping the published Poseidon round schedule or constant set. As the honest-description
section states plainly, this is a Poseidon-style permutation, not a drop-in of the reference. What that
buys is transparency: anyone can regenerate the constants from the domain string and confirm the Cauchy
matrix is MDS for disjoint node sets, so there is no hidden structure to hide a weakness in. What it costs
is that there are no reference test vectors, because it is not claiming to reproduce a reference, and the
full-round schedule is more conservative and more expensive than the standard mix of full and partial
rounds. The security analysis names this rather than letting "Poseidon" imply the published parameters.

**The parameters set a stated security level, and that is the boundary.** Width 8 with rate 4 and capacity
4 gives a 256-bit capacity, which the code annotates as roughly 128-bit sponge security. That is the
claimed level; it is not independently certified here, and the honest reading is that the sponge is as
strong as the permutation is a good random permutation, which is the usual Poseidon-family assumption
applied to these specific, self-derived parameters.

**Being algebraic is a feature that also constrains it.** The whole reason this hash exists alongside the
kernel's general-purpose BLAKE3 is that x^7 is a degree-7 polynomial and the MDS mix is linear, so one
round is a low-degree constraint and the hash can be proven inside the [STARK](/docs/subsystems/proof-system/stark/). That is what
makes the recursive-friendly FRI and the in-circuit transcript possible. The tradeoff is that an
arithmetization-friendly hash is a narrower, younger design point than a byte-oriented hash, so it is used
where arithmetization is required and BLAKE3 is used everywhere else, which is exactly how the two are
split in the tree.

## Debugging the field and hash

Bugs at this layer do not print; they show up as a proof that will not verify, and the way to localize
them is to reproduce the two derivations by hand.

**A verifier that rejects every proof points at a hash-parameter divergence.** Because the round constants
are derived from `NØNOS-POSEIDON-GOLDILOCKS-RC` and the MDS matrix from the Cauchy construction, prover
and verifier agree only if both compute the identical permutation. If a proof produced by one build fails
under another with no other change, the first thing to check is that the domain string, the width and rate
constants (`poseidon.rs:43`, `poseidon.rs:45`), and the round count match on both sides, since any
difference silently produces a different hash and every Merkle root and transcript challenge downstream
diverges. This is the most likely cause of a whole class of proofs failing at once rather than one.

**Field-arithmetic mistakes surface as non-canonical elements.** `Fp` holds its value canonically in
`[0, p)` with `p = 0xFFFF_FFFF_0000_0001` ([`field/element.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/field/element.rs#L19)). A reduction bug leaves an element at or
above `p`, which then compares unequal to its canonical twin and breaks the constant-time equality checks
the verifiers rely on. The signature is a proof that fails only for certain inputs (the ones that hit the
unreduced range) while most pass, which distinguishes it from the hash-parameter case above where nothing
verifies at all.

## Source map

```
  src/crypto/stark/field/element.rs   the Goldilocks prime and Fp
  src/crypto/stark/field/            add/sub/mul, exp, inverse
  src/crypto/stark/air/poseidon.rs    the permutation: params, S-box, MDS, NUMS constants, sponge, compress
```

Every reference above is verified against those trees. The AIR gadgets that express this hash as
constraints are on the [AIR catalog](/docs/subsystems/proof-system/air-catalog/) page, the STARK and FRI that run over this field are
on the [STARK](/docs/subsystems/proof-system/stark/) page, and the general-purpose BLAKE3 this algebraic hash sits alongside is on the
[hashes](/docs/subsystems/crypto/hashes/) page.
