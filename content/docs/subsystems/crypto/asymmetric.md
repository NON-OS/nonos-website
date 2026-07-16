---
title: "Asymmetric Cryptography"
description: "The kernel implements the classical public-key primitives in-tree: Ed25519 for signatures, secp256k1 for ECDSA, and the elliptic-curve field arithmetic underneath both."
weight: 3
---
The kernel implements the classical public-key primitives in-tree: Ed25519 for signatures,
secp256k1 for ECDSA, and the elliptic-curve field arithmetic underneath both. Ed25519 is the
signature scheme the kernel itself signs with and the capsule trust chain verifies with. This
page documents them and the kernel's own signing key. The code is under
`src/crypto/asymmetric/` and [`src/crypto/kernel_keys.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/kernel_keys.rs).

## Ed25519

Ed25519 (`src/crypto/asymmetric/ed25519/`) is a full in-tree implementation, the Edwards-curve
field, point, scalar, and signature math written for no_std, checked against the RFC 8032 test
vectors including adversarial edge cases ([`userland/crypto_proofs/src/ed25519_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/ed25519_tests.rs)). It is
the kernel's primary signature primitive:

- The kernel holds one Ed25519 keypair (`kernel_keys.rs`), generated once at init behind a `Once`,
  and signs capability tokens with it (`sign_capability_token`). The public half is exported so a
  token can be checked against it.
- The [capsule trust chain](/docs/security/capsules-and-trust/) verifies Ed25519 signatures on
  the NØNOS-ID certificate and the manifest.
- The `MkCryptoEd25519Verify` syscall exposes verification to capsules.

## secp256k1

secp256k1 (`src/crypto/asymmetric/secp256k1/`) is an in-tree implementation of the Bitcoin and
Ethereum curve, point arithmetic in affine and projective coordinates plus ECDSA signing and
public-key recovery, with a KAT ([`userland/crypto_proofs/src/secp256k1_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/secp256k1_tests.rs)). Its consumers
are the Ethereum transaction signing and address paths and the `MkCryptoSecp256k1Sign` and
`MkCryptoSecp256k1Pubkey` syscalls, where it hashes with the in-tree [Keccak-256](/docs/subsystems/crypto/hashes/). The
field arithmetic under both curves is the in-tree `src/crypto/util/bigint/`.

## The algorithm-id dispatch

Signature verification is generic over an algorithm id (`src/crypto/asymmetric/alg_id/`): the
`AlgId` enum names `Ed25519` and `MlDsa65`, and `verify` dispatches a `(pubkey, msg, sig)` to the
right primitive. This is the mechanism the [certificate and manifest policy](/docs/subsystems/crypto/pqc/) builds on to
require both algorithms at once: the low-level dispatch verifies one signature of a stated
algorithm, and the production policy requires a valid signature under each of the two.

## x25519 and the honest caveat

x25519 (`src/crypto/asymmetric/curve25519/`) is present but is **not** on the kernel trusted path.
It is feature-gated: with `crypto-curve25519` it binds to the `x25519_dalek` crate, and without
the feature the in-tree fallback is incomplete. It is used only by legacy network code paths, not
by capsule spawn, IPC, or the capability system. The `MkCryptoX25519*` syscalls are correspondingly
feature-gated. This page records that honestly rather than presenting x25519 as a load-bearing
kernel primitive.

Other asymmetric primitives exist in the proof tree (P-256, P-384, RSA test vectors under
`userland/crypto_proofs/`), but the kernel trusted path relies on Ed25519 and secp256k1 among the
classical schemes, and ML-DSA-65 among the post-quantum ones.

## Security analysis

Ed25519 is the primitive the whole capsule trust chain reduces to, so the properties worth stating
are that verification is correct against the standard including the adversarial edges, that the
scalar-multiply on the signing side does not leak the key through timing, and that the private key
is scrubbed when its keypair drops.

**Verification is anchored to RFC 8032 and rejects the malleable and small-order edges.** Ed25519
is checked against the RFC 8032 test vectors including adversarial cases
([`userland/crypto_proofs/src/ed25519_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/ed25519_tests.rs)), and the verify itself
([`src/crypto/asymmetric/ed25519/signature.rs:119`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/asymmetric/ed25519/signature.rs#L119)) does more than the textbook equation. It rejects
a signature whose S is not fully reduced (`sc_ge(&sig.S, &L)`), which is the non-canonical-S
malleability check, refuses a public key or R that does not unpack to a valid point, and rejects
points that fail `ge_has_large_order`, so a small-order or torsion point cannot be smuggled through.
The final equality goes through `ct_eq_32`, so even the accept/reject decision folds the whole
32-byte comparison.

**The secret-dependent scalar multiply uses the constant-time base multiply.** Signing derives the
nonce and the secret scalar from SHA-512 of the private seed and multiplies the base point with
`ge_scalarmult_base_ct` (`signature.rs:104`, `:147`), the constant-time variant, so the timing of a
signature does not depend on the secret scalar's bits. Verification, which handles only public
values, is free to use the faster `scalarmult_vartime` for the public-key term, and it does. The
split is deliberate: the secret path is constant time, the public path is not, and that is the
correct place to draw the line.

**A keypair scrubs its private half on drop.** `KeyPair` (`signature.rs:39`) volatile-zeros its
32-byte private field in `Drop` behind a `SeqCst` fence, so the kernel's signing key material does
not survive the object. The kernel holds exactly one Ed25519 keypair, generated once at init behind
a `Once` (`kernel_keys.rs:24`), and exposes only signing and the public half, never the private
bytes.

The honest boundaries are two. secp256k1 is an in-tree ECDSA with a KAT, but the documentation in
the tree does not claim the same constant-time posture for its scalar path that Ed25519's signing
has, so it should be treated as correct-by-vector rather than side-channel-hardened. And x25519 is
feature-gated and off the trusted path as described below; nothing load-bearing depends on it.

## Debugging asymmetric crypto

A signature problem lands in one of two layers. At build and test time a primitive that has drifted
from the standard fails its known-answer test under `userland/crypto_proofs/src/` (`ed25519_tests.rs`,
`secp256k1_tests.rs`, and the P-256, P-384, RSA suites for the proof-tree primitives), which compile
the real curve source, so a KAT failure there is a broken primitive rather than a caller mistake.

At runtime, Ed25519 `verify` returns a plain `bool` and never explains itself, by design, but the
code has several distinct early-out reasons and knowing them narrows a real failure. A `false` can
mean the S scalar was not canonical (`sc_ge` caught it), the public key or R did not unpack to a
curve point, the key or R was small-order (`ge_has_large_order` rejected it), or the final equation
simply did not hold. The generic dispatch is more explicit: `AlgId::verify`
([`src/crypto/asymmetric/alg_id/verify.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/asymmetric/alg_id/verify.rs#L23)) returns an `AlgIdError::PubkeyLen` or
`AlgIdError::SigLen` carrying the expected and actual lengths *before* it runs any curve math, so a
wrong-sized key or signature is a typed length error you can read directly, and it returns
`AlgIdError::Unsupported` for an algorithm id it does not implement (MlDsa44, MlDsa87). That is how
you separate an unsupported-parameter failure (typed error out of the dispatch) from a wrong-key or
corrupt-input failure (a `false` out of the primitive on correctly-sized inputs). When a
correctly-sized, correctly-parsed signature verifies false, the cause is a wrong key, a wrong
message, or a signature that does not belong to that pair, none of which the constant-time verify
will distinguish for you.

## Source map

```
  src/crypto/asymmetric/ed25519/signature.rs  verify (canonical-S, order checks), sign, KeyPair drop
  src/crypto/asymmetric/ed25519/              the Edwards field, point, and scalar math
  src/crypto/asymmetric/secp256k1/            secp256k1 ECDSA (Ethereum, syscall)
  src/crypto/asymmetric/alg_id/verify.rs      the AlgId verify dispatch and its typed length errors
  src/crypto/asymmetric/curve25519/           x25519 (feature-gated, not trusted path)
  src/crypto/kernel_keys.rs                   the kernel's single Ed25519 keypair, init behind Once
  userland/crypto_proofs/src/                 the RFC 8032 and curve known-answer tests
```

Every reference above is verified against those trees. The dual-signature policy that pairs Ed25519
with ML-DSA-65 is on the [post-quantum](/docs/subsystems/crypto/pqc/) page, the trust chain that verifies these signatures
is on the [capsules and trust](/docs/security/capsules-and-trust/) page, and the random path the
kernel keypair is drawn from is on the [randomness](/docs/subsystems/crypto/randomness/) page.
