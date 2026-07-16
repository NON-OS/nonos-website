---
title: "Post-Quantum Cryptography"
description: "NØNOS is post-quantum in its trust chain: a capsule's certificate and manifest must carry a valid ML-DSA-65 signature in addition to an Ed25519 one, so an adversary who breaks e..."
weight: 4
---
NØNOS is post-quantum in its trust chain: a capsule's certificate and manifest must carry a valid
ML-DSA-65 signature in addition to an Ed25519 one, so an adversary who breaks elliptic-curve
signatures still cannot forge a capsule. This page documents the post-quantum primitives and where
the dual-signature requirement is enforced. The code is under `src/crypto/pqc/`.

## The primitives

The post-quantum primitives are FFI wrappers over the PQClean reference C implementations, not
in-tree Rust:

```
  ML-DSA-65 (Dilithium)   src/crypto/pqc/ml_dsa_65/   FFI to PQCLEAN_MLDSA65_CLEAN_*
  Kyber / ML-KEM          src/crypto/pqc/kyber.rs      FFI to PQCLEAN_MLKEM{512,768,1024}_CLEAN
```

ML-DSA-65 is the NIST post-quantum signature standard (the Dilithium submission), and Kyber /
ML-KEM is the post-quantum key-encapsulation standard. Both are thin Rust surfaces
(`ml_dsa_65_keypair` / `sign` / `verify`, `kyber_keygen` / `encaps` / `decaps`) calling into
PQClean, whose known-answer vectors live in the C library rather than in the tree. This is called
out plainly: unlike the [hashes](/docs/subsystems/crypto/hashes/) and [classical signatures](/docs/subsystems/crypto/asymmetric/), which are
in-tree with KATs under `userland/crypto_proofs/`, the PQC primitives are external reference code
reached by FFI.

## The dual-signature requirement

The place the post-quantum signature becomes load-bearing is the capsule production policy. The
NØNOS-ID certificate policy ([`src/security/nonos_id_cert/policy.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/policy.rs#L32)) states it directly:

```
  // nonos-production policy: hybrid Ed25519 + ML-DSA-65, both required.
  SignaturePolicy { required: &[AlgId::Ed25519, AlgId::MlDsa65] }
```

Under `NONOS_PRODUCTION_POLICY`, a certificate or manifest must carry a valid signature under
*both* Ed25519 and ML-DSA-65, verified through the [algorithm-id dispatch](/docs/subsystems/crypto/asymmetric/). The
spawn [preflight](/docs/subsystems/elf-loader/integration/) runs the certificate and manifest verification
under this policy before an image is loaded, so a capsule that is missing either signature does not
spawn. The generic `AlgId::verify` checks one algorithm at a time; the policy is what turns that
into "both are required", and the production policy requires both.

Kyber / ML-KEM is available for post-quantum key encapsulation in hybrid schemes but is not part of
the capsule trust chain; the chain is a signature story, and the signature is the hybrid
Ed25519 + ML-DSA-65 pair.

## Security analysis

The post-quantum layer is a hedge, not a replacement, and the code makes that structure precise:
the security argument is about the dual requirement being enforced and about honestly marking which
part is in-tree and which is external reference code.

**The dual requirement is enforced by policy, not left to the caller.** The generic
`AlgId::verify` ([`src/crypto/asymmetric/alg_id/verify.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/asymmetric/alg_id/verify.rs#L23)) verifies exactly one signature under
one stated algorithm and returns a `bool`. What makes both signatures load-bearing is the
production policy `SignaturePolicy { required: &[AlgId::Ed25519, AlgId::MlDsa65] }`
([`src/security/nonos_id_cert/policy.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/policy.rs#L32)), which the spawn preflight runs before an image loads,
so a certificate or manifest missing either signature does not spawn. The hedge is real precisely
because breaking one scheme is not enough: an adversary who breaks elliptic curves still faces the
ML-DSA-65 requirement, and one who breaks the lattice scheme still faces Ed25519.

**The verify surface fails closed on a bad length or a bad signature.** `ml_dsa_65_verify_bytes`
([`src/crypto/pqc/ml_dsa_65/api.rs:72`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/pqc/ml_dsa_65/api.rs#L72)) checks the public-key and signature lengths against the
constants and returns `MlDsa65Error::InvalidLength` before touching the FFI, and the dispatch turns
any error from the underlying verify into a plain `false` ([`alg_id/verify.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/alg_id/verify.rs#L40),
`unwrap_or(false)`), so a malformed post-quantum signature is a rejection rather than an accept or a
crash across the FFI boundary.

The honest boundary is the one the page already states and is worth repeating as a security fact:
ML-DSA-65 and Kyber/ML-KEM are FFI wrappers over the PQClean reference C implementations
([`ml_dsa_65/ffi.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ml_dsa_65/ffi.rs) calls `PQCLEAN_MLDSA65_CLEAN_*`), not in-tree Rust. Their known-answer vectors
live in the C library, so unlike the [hashes](/docs/subsystems/crypto/hashes/) and [classical signatures](/docs/subsystems/crypto/asymmetric/),
which are in-tree with KATs under `userland/crypto_proofs/`, the PQC primitives are external
reference code reached across an `unsafe extern "C"` boundary. That means their correctness and
their side-channel posture are the PQClean reference implementation's, inherited rather than
independently proven here, and the trust in them is trust in that upstream. Kyber/ML-KEM is present
for hybrid key encapsulation but is not part of the capsule trust chain; the chain is a signature
story, and the signature is the Ed25519 + ML-DSA-65 pair.

## Debugging post-quantum crypto

Because the primitives are across an FFI boundary, a PQC failure separates cleanly into a framing
failure the Rust side catches and a verify failure the C side decides. A wrong-sized public key or
signature never reaches PQClean: `ml_dsa_65_verify_bytes` returns `MlDsa65Error::InvalidLength`
(`api.rs:73`) and the sign and keypair wrappers return `MlDsa65Error::FfiError` if the C routine
reports a nonzero return code or an unexpected signature length (`api.rs:56`). So an
unsupported-parameter or mis-framed input is a typed error on the Rust side, distinguishable from a
genuine signature rejection, which comes back as the FFI verify returning nonzero and surfacing as a
`false`.

When the failure is a dual-signature policy rejection at spawn, the thing to check is which of the
two signatures is missing or wrong, since the policy requires both and a single valid Ed25519
signature is not sufficient under `NONOS_PRODUCTION_POLICY`. `AlgId::verify` checks one algorithm at
a time, so the diagnosis is to verify each algorithm's signature independently against the same
message and see which one returns false; a capsule that verifies under Ed25519 but not ML-DSA-65 was
signed without the post-quantum half, which is exactly the case the production policy is there to
refuse. Because the ML-DSA verify is a reference C implementation, a failure inside it is not
something this tree instruments further; the boundary is the return code, and past it the behaviour
is PQClean's.

## Source map

```
  src/crypto/pqc/ml_dsa_65/api.rs           the Rust surface: length checks and FfiError mapping
  src/crypto/pqc/ml_dsa_65/ffi.rs           the PQCLEAN_MLDSA65_CLEAN_* extern "C" bindings
  src/crypto/pqc/kyber.rs                    Kyber / ML-KEM over PQClean (not the trust chain)
  src/crypto/asymmetric/alg_id/verify.rs     the per-algorithm verify dispatch
  src/security/nonos_id_cert/policy.rs       NONOS_PRODUCTION_POLICY: both signatures required
```

Every reference above is verified against those trees. The per-algorithm dispatch and the classical
half of the pair are on the [asymmetric](/docs/subsystems/crypto/asymmetric/) page, and the trust chain that runs the dual
policy at spawn is on the [capsules and trust](/docs/security/capsules-and-trust/) page.
