---
title: "Cryptography"
description: "Complete NØNOS cryptographic primitives and implementation details"
weight: 14

# NØNOS Cryptography

**Version 0.8.0** | March 2026

NØNOS implements cryptography from first principles—no OpenSSL, no system libraries, no external dependencies that could be compromised. Every primitive is built from specification, verified against test vectors, and analyzed for timing leaks.

This document covers every cryptographic algorithm in NØNOS: what it does, when it's used, and the security guarantees it provides.


## Design Principles

### Zero Dependencies

Every cryptographic primitive is implemented in the kernel itself or compiled from audited source code. There are no runtime dependencies on external libraries. This eliminates:

- Supply chain attacks through compromised libraries
- Version mismatch vulnerabilities
- Dynamic linking attacks

### Constant-Time Execution

All cryptographic operations that handle secret data use constant-time implementations. This means:

- No secret-dependent branches
- No secret-dependent memory access patterns
- No early-exit on comparison operations
- Timing attacks cannot leak key material

### Multiple Security Levels

NØNOS supports both classical cryptography (secure against conventional computers) and post-quantum cryptography (secure against quantum computers). For sensitive long-term secrets, post-quantum algorithms are recommended.


## Symmetric Encryption

Symmetric encryption uses the same key for encryption and decryption. Fast and efficient for bulk data.

### AES-256-GCM

**What It Is:**
Advanced Encryption Standard with Galois/Counter Mode. A block cipher operating on 128-bit blocks with a 256-bit key, combined with authentication.

**Properties:**

| Property | Value |
|----------|-------|
| Key Size | 256 bits |
| Block Size | 128 bits |
| Mode | GCM (authenticated) |
| Tag Size | 128 bits |
| Nonce | 96 bits |

**When It's Used:**
- Vault key encryption
- Module encryption at rest
- Wallet private key storage

**Security:**
- Provides confidentiality and authenticity
- Tampering detected before decryption
- 128-bit security against forgery
- 256-bit security against key recovery

**Implementation Notes:**
NØNOS includes both a pure-software implementation (for UEFI bootloader where AES-NI may not be initialized) and a hardware-accelerated implementation using AES-NI instructions when available.

### ChaCha20-Poly1305

**What It Is:**
A stream cipher (ChaCha20) combined with a message authentication code (Poly1305). An alternative to AES-GCM that doesn't require hardware acceleration for good performance.

**Properties:**

| Property | Value |
|----------|-------|
| Key Size | 256 bits |
| Nonce | 96 bits (standard) or 192 bits (XChaCha20) |
| Tag Size | 128 bits |

**When It's Used:**
- CryptoFS block encryption
- Network traffic encryption
- TLS 1.3 cipher suite
- Full-disk encryption (planned)

**Security:**
- 256-bit key provides 256-bit security
- Authentication prevents tampering
- No known weaknesses
- Excellent software performance

**XChaCha20 Variant:**
XChaCha20-Poly1305 uses a 192-bit nonce, allowing random nonce generation without collision risk. Used when generating unique nonces is impractical.

### AES-128-ECB

**What It Is:**
AES with Electronic Codebook mode. Each block encrypted independently.

**Warning:** ECB mode does not hide patterns in plaintext. Only used internally where pattern hiding is not required (e.g., key schedule computation).


## Asymmetric Cryptography

Asymmetric cryptography uses key pairs—a public key for encryption/verification and a private key for decryption/signing.

### Ed25519 (Signatures)

**What It Is:**
Edwards-curve Digital Signature Algorithm using Curve25519. Produces compact signatures with excellent performance.

**Properties:**

| Property | Value |
|----------|-------|
| Private Key | 32 bytes |
| Public Key | 32 bytes |
| Signature | 64 bytes |
| Security Level | ~128 bits |

**When It's Used:**
- Kernel signature verification at boot
- Module signing and verification
- Capability token signatures
- Code signing throughout the system

**Security:**
- Fast signature generation and verification
- Deterministic signatures (no random number needed)
- Resistant to many common implementation attacks
- Small key and signature sizes

**Implementation:**
Based on the ed25519-dalek library, following RFC 8032 exactly. All test vectors pass.

### Curve25519 / X25519 (Key Exchange)

**What It Is:**
Elliptic Curve Diffie-Hellman using Curve25519. Allows two parties to compute a shared secret.

**Properties:**

| Property | Value |
|----------|-------|
| Private Key | 32 bytes |
| Public Key | 32 bytes |
| Shared Secret | 32 bytes |
| Security Level | ~128 bits |

**When It's Used:**
- TLS key exchange
- Onion routing handshakes (ntor protocol)
- Session key establishment

**Security:**
- Designed to be hard to implement incorrectly
- Constant-time by design
- No small-subgroup attacks possible

### P-256 (NIST Prime Curve)

**What It Is:**
NIST's standardized 256-bit prime curve (also known as secp256r1).

**Properties:**

| Property | Value |
|----------|-------|
| Key Size | 256 bits |
| Security Level | ~128 bits |
| Standardization | NIST, widely deployed |

**When It's Used:**
- Interoperability with external systems requiring NIST curves
- Some TLS configurations

### secp256k1 (Bitcoin/Ethereum Curve)

**What It Is:**
The elliptic curve used by Bitcoin and Ethereum for signatures.

**Properties:**

| Property | Value |
|----------|-------|
| Key Size | 256 bits |
| Security Level | ~128 bits |
| Use | Cryptocurrency signatures |

**When It's Used:**
- Ethereum wallet operations
- Transaction signing
- Address generation

**Implementation:**
Full ECDSA signing and verification for Ethereum compatibility.


## Hash Functions

Hash functions produce a fixed-size digest from arbitrary input. Used for integrity verification, key derivation, and many other purposes.

### BLAKE3

**What It Is:**
A modern cryptographic hash function optimized for speed without compromising security.

**Properties:**

| Property | Value |
|----------|-------|
| Output Size | Configurable (default 256 bits) |
| Speed | Very fast (parallelizable) |
| Security | 128-bit collision resistance |

**When It's Used:**
- Kernel integrity hashing at boot
- Key ID computation
- Merkle tree construction in CryptoFS
- General-purpose hashing throughout

**Features:**
- Keyed hashing mode (for MACs)
- Key derivation mode (KDF)
- Extendable output (XOF)

### SHA-256 / SHA-512

**What It Is:**
The SHA-2 family of hash functions, the current industry standard.

**Properties:**

| Property | SHA-256 | SHA-512 |
|----------|---------|---------|
| Output Size | 256 bits | 512 bits |
| Block Size | 512 bits | 1024 bits |
| Security | 128-bit collision | 256-bit collision |

**When It's Used:**
- Compatibility with existing systems
- Cryptographic commitments
- HMAC construction

### SHA-3 (Keccak)

**What It Is:**
The SHA-3 family based on the Keccak sponge construction. A completely different design from SHA-2.

**Properties:**

| Property | SHA3-256 | SHA3-512 |
|----------|----------|----------|
| Output Size | 256 bits | 512 bits |
| Design | Sponge construction |
| Security | 128-bit/256-bit collision |

**When It's Used:**
- Diversity from SHA-2 (defense in depth)
- Future-proofing

**SHAKE Variants:**
SHAKE128 and SHAKE256 provide extendable output—you can request any length of output.

### Keccak256

**What It Is:**
The specific Keccak variant used by Ethereum (not quite SHA3-256).

**When It's Used:**
- Ethereum address derivation
- Ethereum transaction hashing


## Key Derivation

### HKDF (HMAC-based Key Derivation Function)

**What It Is:**
Derives one or more keys from a source key using HMAC.

**When It's Used:**
- Deriving encryption keys from shared secrets
- Creating multiple keys from a master key
- TLS key derivation

**Process:**
1. Extract: Condense source material into fixed-size key
2. Expand: Generate arbitrary-length output

### Argon2id

**What It Is:**
A memory-hard password hashing function. Winner of the Password Hashing Competition.

**Properties:**

| Property | Value |
|----------|-------|
| Memory | Configurable (64 MB recommended) |
| Iterations | Configurable (4 recommended) |
| Parallelism | Configurable |
| Output | Configurable |

**When It's Used:**
- Full-disk encryption key derivation
- Wallet password hashing
- Any user-password-derived keys

**Security:**
Memory hardness prevents GPU/ASIC attacks. Even if an attacker steals a password hash, cracking requires significant memory per attempt.


## Message Authentication

### HMAC-SHA256

**What It Is:**
Keyed-Hash Message Authentication Code using SHA-256.

**When It's Used:**
- Authenticating messages
- Cookie authentication
- API authentication

**Security:**
- Requires knowing the key to create valid MAC
- Verifying authenticates the sender and integrity


## Post-Quantum Cryptography

These algorithms resist attacks by quantum computers. A sufficiently large quantum computer could break RSA, elliptic curves, and Diffie-Hellman. Post-quantum algorithms remain secure.

### ML-KEM (CRYSTALS-Kyber)

**What It Is:**
A lattice-based Key Encapsulation Mechanism. NIST's chosen post-quantum key exchange standard.

**Variants:**

| Variant | Public Key | Private Key | Ciphertext | Security |
|---------|------------|-------------|------------|----------|
| ML-KEM-512 | 800 bytes | 1632 bytes | 768 bytes | NIST Level 1 |
| ML-KEM-768 | 1184 bytes | 2400 bytes | 1088 bytes | NIST Level 3 |
| ML-KEM-1024 | 1568 bytes | 3168 bytes | 1568 bytes | NIST Level 5 |

**Default:** ML-KEM-768 (NIST recommended)

**When It's Used:**
- Post-quantum TLS key exchange
- Long-term key encapsulation

**Operations:**
- `keygen()`: Generate key pair
- `encaps(pk)`: Encapsulate shared secret
- `decaps(sk, ct)`: Recover shared secret

### ML-DSA (CRYSTALS-Dilithium)

**What It Is:**
A lattice-based digital signature scheme. NIST's chosen post-quantum signature standard.

**Variants:**

| Variant | Public Key | Private Key | Signature | Security |
|---------|------------|-------------|-----------|----------|
| ML-DSA-2 | 1312 bytes | 2528 bytes | 2420 bytes | NIST Level 2 |
| ML-DSA-3 | 1952 bytes | 4000 bytes | 3293 bytes | NIST Level 3 |
| ML-DSA-5 | 2592 bytes | 4864 bytes | 4595 bytes | NIST Level 5 |

**Default:** ML-DSA-3 (NIST recommended)

**When It's Used:**
- Module signing for post-quantum security
- Long-term signature requirements
- Optional kernel signature verification

**Operations:**
- `keygen()`: Generate key pair
- `sign(sk, msg)`: Create signature
- `verify(pk, msg, sig)`: Verify signature

### SPHINCS+

**What It Is:**
A hash-based signature scheme. Security based only on hash function security, not lattice assumptions.

**When It's Used:**
- Maximum security margin (most conservative)
- When lattice security is questioned

**Trade-off:** Larger signatures than ML-DSA, but security assumptions are simpler.

### NTRU

**What It Is:**
A lattice-based encryption scheme, one of the oldest post-quantum proposals.

**When It's Used:**
- Alternative post-quantum encryption
- Specific compatibility requirements

### Classic McEliece

**What It Is:**
A code-based encryption scheme with very large public keys but small ciphertexts.

**Trade-off:**
- Public keys: ~1 MB
- Ciphertext: ~200 bytes
- Security: Most conservative post-quantum scheme

**When It's Used:**
- When absolute security is paramount
- Key size is acceptable


## Zero-Knowledge Proofs

Zero-knowledge proofs let you prove you know something without revealing what you know.

### Groth16 (SNARKs)

**What It Is:**
A succinct non-interactive argument of knowledge. Allows proving general statements with tiny proofs.

**Properties:**

| Property | Value |
|----------|-------|
| Proof Size | 192 bytes |
| Verification | Fast (constant time) |
| Curve | BLS12-381 |
| Setup | Trusted setup required |

**When It's Used:**
- Kernel attestation at boot
- Transaction privacy in wallet
- Capability attestation chains

**How It Works:**
1. Circuit defines what's being proven
2. Trusted setup generates proving/verifying keys
3. Prover creates proof with private inputs
4. Verifier checks proof with public inputs

### Halo2 (PLONK)

**What It Is:**
A universal SNARK based on the PLONK protocol with Halo2 improvements.

**Properties:**

| Property | Value |
|----------|-------|
| Proof Size | ~4-10 KB |
| Verification | Fast |
| Commitment | KZG |
| Setup | Universal (not per-circuit) |

**When It's Used:**
- More complex circuits
- When universal setup is preferred
- Recursive proof composition

### Pedersen Commitments

**What It Is:**
A cryptographic commitment scheme. Commit to a value without revealing it; reveal later.

**Properties:**
- Binding: Cannot change value after committing
- Hiding: Commitment reveals nothing about value

**When It's Used:**
- Building blocks for other ZK proofs
- Confidential transactions

### Schnorr Proofs

**What It Is:**
A simple proof of knowledge of a discrete logarithm.

**When It's Used:**
- Proving knowledge of private keys
- Signature aggregation
- Building blocks for complex proofs

### Range Proofs

**What It Is:**
Prove a value lies within a range without revealing the value.

**When It's Used:**
- Proving transaction amounts are positive
- Confidential asset proofs


## Random Number Generation

### Hardware RNG

NØNOS uses hardware random number generators when available:

| Source | Method |
|--------|--------|
| RDRAND | Intel/AMD CPU instruction |
| RDSEED | Intel/AMD entropy seed |
| TPM 2.0 | Hardware security module |

**Entropy Quality:**
RDRAND output is assessed for quality. If entropy is insufficient, generation fails (rather than returning weak output).

### Software CSPRNG

When hardware RNG is unavailable or for additional entropy mixing:

**ChaCha20-based CSPRNG:**
- Seeded from hardware entropy
- Regular reseeding
- Fork-safe

### Entropy Collection

Boot entropy is collected from multiple sources:
- Hardware RNG (64 iterations)
- Time-stamp counter jitter
- RTC timestamp

Combined using BLAKE3 key derivation to produce high-quality output.


## Domain Separation

NØNOS uses domain separation strings to ensure keys/hashes derived for one purpose cannot be confused with another:

| Purpose | Domain Separator |
|---------|------------------|
| Key ID | `NONOS:KEYID:ED25519:v1` |
| Program Hash | `NONOS:ZK:PROGRAM:v1` |
| Capsule Commitment | `NONOS:CAPSULE:COMMITMENT:v1` |
| Audit Log | `NONOS:AUDIT:v1` |
| Entropy Accumulation | `NONOS:ENTROPY:ACCUM:v1` |
| Entropy Output | `NONOS:ENTROPY:OUTPUT:v1` |

This prevents attacks where output from one use is misused for another.


## Algorithm Selection Guide

### For Encryption

| Scenario | Algorithm |
|----------|-----------|
| File encryption | ChaCha20-Poly1305 |
| Key wrapping | AES-256-GCM |
| Disk encryption | XChaCha20-Poly1305 |
| Network traffic | ChaCha20-Poly1305 or AES-GCM |

### For Signatures

| Scenario | Algorithm |
|----------|-----------|
| Code signing | Ed25519 |
| Long-term documents | Ed25519 + ML-DSA-3 |
| Ethereum transactions | secp256k1 ECDSA |
| Maximum security | ML-DSA-5 |

### For Key Exchange

| Scenario | Algorithm |
|----------|-----------|
| TLS | X25519 + ML-KEM-768 |
| Onion routing | X25519 (ntor protocol) |
| Post-quantum only | ML-KEM-768 |

### For Hashing

| Scenario | Algorithm |
|----------|-----------|
| General purpose | BLAKE3 |
| Compatibility | SHA-256 |
| Ethereum | Keccak256 |
| Maximum security | SHA3-512 |


## Security Levels

NIST security levels provide a framework for comparing algorithms:

| Level | Classical Equivalent | Post-Quantum |
|-------|---------------------|--------------|
| 1 | AES-128 | ML-KEM-512, ML-DSA-2 |
| 2 | SHA-256 | ML-DSA-2 |
| 3 | AES-192 | ML-KEM-768, ML-DSA-3 |
| 4 | SHA-384 | ML-DSA-3 |
| 5 | AES-256 | ML-KEM-1024, ML-DSA-5 |

NØNOS defaults to Level 3 for post-quantum algorithms.


## Verification and Auditing

### Test Vectors

All algorithms are verified against official test vectors:
- Ed25519: RFC 8032 test vectors
- X25519: RFC 7748 test vectors
- ChaCha20-Poly1305: RFC 8439 test vectors
- ML-KEM/ML-DSA: NIST submission vectors

### Timing Analysis

Constant-time execution is verified through:
- Source code analysis
- Timing measurement tools
- Differential timing tests

### Known Answer Tests

Every algorithm includes self-tests that run at boot, verifying correct operation before any cryptographic operations occur.


AGPL-3.0 | Copyright 2026 NØNOS Contributors
