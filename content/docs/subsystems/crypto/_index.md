---
title: "Crypto"
description: "The in-tree cryptographic stack and what depends on each primitive."
weight: 17
---
The in-tree cryptographic stack and what depends on each primitive. NØNOS is a no_std
microkernel, so its hashes, symmetric ciphers, and classical signatures are implemented in the
tree rather than pulled from Rust crates, and each is checked against published known-answer
vectors. The post-quantum primitives are FFI wrappers over the PQClean reference code, and a
small number of paths use the external `blake3` crate. This section maps the primitives to their
provenance and their trusted-path consumers.

| Page | What it covers |
|------|----------------|
| [hashes.md](/docs/subsystems/crypto/hashes/) | BLAKE3 (in-tree and the external crate), SHA-2, Keccak-256, HMAC, HKDF, and constant-time comparison. |
| [symmetric.md](/docs/subsystems/crypto/symmetric/) | In-tree AES-256-GCM and ChaCha20-Poly1305, the AEAD core, and the `MkCrypto*` syscall family. |
| [asymmetric.md](/docs/subsystems/crypto/asymmetric/) | In-tree Ed25519 and secp256k1, the kernel signing key, the `AlgId` verify dispatch, and the x25519 caveat. |
| [pqc.md](/docs/subsystems/crypto/pqc/) | ML-DSA-65 and Kyber over PQClean, and the production policy that requires Ed25519 and ML-DSA-65 together. |
| [randomness.md](/docs/subsystems/crypto/randomness/) | The secure RNG: software CSPRNG XOR hardware entropy, entropy sizing, and what draws from it. |

## Provenance at a glance

| Primitive | Provenance | Trusted-path use |
|-----------|-----------|------------------|
| BLAKE3 | in-tree + external `blake3` crate | capability MAC (in-tree), IPC MAC (crate) |
| SHA-256 / 384 / 512 | in-tree, FIPS 180-4 KAT | HMAC, HKDF, signatures |
| Keccak-256 | in-tree, SHA-3 KAT | secp256k1 hashing, Ethereum, syscall |
| AES-256-GCM | in-tree, KAT | `MkCryptoEncrypt/Decrypt` |
| ChaCha20-Poly1305 | in-tree, KAT | `MkCryptoEncrypt/Decrypt` |
| Ed25519 | in-tree, RFC 8032 KAT | kernel signing, capsule trust chain |
| secp256k1 | in-tree, KAT | Ethereum, syscall sign/recover |
| x25519 | feature-gated FFI / incomplete fallback | not the trusted path (legacy net) |
| ML-DSA-65 | FFI to PQClean | capsule trust chain (required with Ed25519) |
| Kyber / ML-KEM | FFI to PQClean | hybrid KEM, not the trust chain |
| HMAC / HKDF | in-tree, KAT | key derivation, MAC |
| secure RNG | in-tree + hardware mix | all key material |

The honesty this table encodes matters: the in-tree primitives are proven against standard
vectors in `userland/crypto_proofs/` (which compiles the real source and runs it), the PQC
primitives are external reference code reached by FFI, x25519 is not load-bearing for the kernel,
and BLAKE3 genuinely exists twice. The [transparent ZK attestation](/docs/security/attestation/)
and the in-kernel STARK build on these primitives (Pedersen commitments and a Poseidon or BLAKE3
transcript) and are documented with the security section.

## Sources

The code lives under `src/crypto/`: `hash/` (BLAKE3, SHA-2, Keccak), `symmetric/` (AES-GCM,
ChaCha20-Poly1305), `asymmetric/` (Ed25519, secp256k1, x25519, the AlgId dispatch), `pqc/`
(ML-DSA-65, Kyber), `random_api/` and `util/rng/` (the secure RNG), `util/` (HMAC, HKDF,
constant-time, bigint), and `kernel_keys.rs` (the kernel signing key). The known-answer tests are
under `userland/crypto_proofs/`, and the production signature policy is
[`src/security/nonos_id_cert/policy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/policy.rs). Every page is verified against those trees with `file:line`
references.
