---
title: "Hashes, MAC, and KDF"
description: "The kernel's most-used cryptographic primitives are its hashes: BLAKE3 keys the capability and IPC MACs, Keccak-256 backs the Ethereum and syscall paths, and the SHA-2 family ba..."
weight: 1
---
The kernel's most-used cryptographic primitives are its hashes: BLAKE3 keys the capability and
IPC MACs, Keccak-256 backs the Ethereum and syscall paths, and the SHA-2 family backs HMAC and
HKDF. This page documents the hashes, the keyed MAC and key-derivation built on them, and the
constant-time comparison that makes verification safe. The code is under `src/crypto/hash/` and
`src/crypto/util/`.

## BLAKE3

There are two BLAKE3 implementations in the tree, and both are used, so it is worth being precise
about which is which:

- The in-tree implementation, `src/crypto/hash/blake3/`, is a full no_std BLAKE3 (its own
  `chunk`, `compress`, `hasher`, `output` submodules) exposing `blake3_hash`, `blake3_keyed_hash`,
  `blake3_derive_key`, and a `Hasher`. It is re-exported through `crate::crypto`. The
  [capability token MAC](/docs/security/signing-and-mac/) uses it directly, via
  `blake3_keyed_hash` ([`src/capabilities/token/material.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/material.rs#L42)).
- The external `blake3` crate (a pinned dependency in `Cargo.toml`) is used where code writes a
  bare `blake3::Hasher`. The [IPC message MAC](/docs/subsystems/ipc/envelope/) is the notable case
  ([`src/ipc/nonos_channel/hash.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/nonos_channel/hash.rs)): it calls `blake3::Hasher::new_keyed` and `new_derive_key`
  with no `use crate::crypto`, so the path resolves to the crate.

Both are real BLAKE3; the in-tree one exists so the primitive is available without the crate on
paths that want it, and the crate is used where its builder API is convenient. The in-tree
implementation is checked against the official BLAKE3 test vectors
([`userland/crypto_proofs/src/blake3_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/blake3_tests.rs)), covering the plain, keyed, derive-key, and XOF
modes.

## SHA-2 and Keccak

The SHA-2 family and Keccak are in-tree no_std implementations, each with a known-answer test:

```
  SHA-256      src/crypto/hash/unified/sha256.rs   NIST FIPS 180-4 vectors
  SHA-512      src/crypto/hash/sha512/             NIST FIPS 180-4 vectors
  SHA-384      src/crypto/hash/sha384.rs           SHA-512 engine with the SHA-384 IV
  Keccak-256   src/crypto/hash/sha3/keccak.rs      SHA-3 vectors
```

SHA-256 and SHA-512 are hand-written compression functions; SHA-384 reuses the SHA-512 engine
with the standard alternate initialization vector. Keccak-256 is a full in-tree Keccak sponge,
and it is the one the Ethereum address derivation, the secp256k1 ECDSA hashing, and the
`MkCryptoKeccak256` syscall all use. The KAT files live in `userland/crypto_proofs/`, which
compiles the real primitive source and runs it against published vectors, so the in-tree hashes
are proven against the standards rather than asserted to match them.

## HMAC and HKDF

HMAC and HKDF are in-tree, built over the SHA-2 hashes (`src/crypto/util/hmac/`):
`hmac_sha256` and `hmac_sha512` are the standard HMAC construction, and `hkdf_extract` /
`hkdf_expand` are HKDF over HMAC. They back the `MkCryptoHmacSha256` and `MkCryptoHkdfSha256`
syscalls and the capsule key-derivation paths, and each has a KAT
([`userland/crypto_proofs/src/hmac_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/hmac_tests.rs), `hkdf_tests.rs`). HMAC verification compares the
recomputed tag in constant time.

## Constant-time comparison

Any comparison of a secret or a MAC goes through the constant-time helpers
(`src/crypto/util/constant_time/`), `ct_eq` and its fixed-width forms, which fold the difference
across the whole input rather than returning at the first mismatch. This is what keeps MAC and
signature verification from leaking, through timing, where a forged value first diverges. The
capability MAC check, the HMAC verify, and the field-element comparisons inside the signature
code all use it. There is a constant-time test in [`userland/crypto_proofs/src/constant_time_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/constant_time_tests.rs).

## Security analysis

These primitives are the foundation the capability MAC, the IPC MAC, and every signature check
sit on, so the properties worth stating are correctness against the published standards and the
timing posture of the comparisons that decide verification.

**Correctness is anchored to published vectors, not asserted.** Each in-tree hash has a
known-answer test that compiles the real primitive source and runs it against a standard vector
set: SHA-256 and SHA-512 against the NIST FIPS 180-4 vectors, Keccak-256 against the SHA-3
vectors, BLAKE3 against the official BLAKE3 vectors across the plain, keyed, derive-key, and XOF
modes, and HMAC and HKDF against their own KAT files under `userland/crypto_proofs/src/`. So the
claim that these match the standard is something the test tree checks rather than a comment in the
source.

**MAC and secret comparisons fold the whole input before deciding.** The constant-time helpers
`ct_eq` and the fixed-width `ct_eq_16` / `ct_eq_32` / `ct_eq_64`
([`src/crypto/util/constant_time/compare.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/util/constant_time/compare.rs#L20)) accumulate the byte-wise XOR difference into one
register and only test it for zero after the loop, with a `compiler_fence` so the fold is not
reordered away. There is no early return on the first mismatched byte, which is what keeps a MAC
or signature check from leaking through timing where a forged value first diverges. HMAC's own
`hmac_verify` ([`src/crypto/util/hmac/core.rs:79`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/util/hmac/core.rs#L79)) uses the same fold-then-compare shape.

**Key material is scrubbed inside the constructions that touch it.** HMAC volatile-zeros the
padded key, the inner pad, and the outer pad as soon as each is consumed
([`hmac/core.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hmac/core.rs#L53)), and the Keccak sponge zeros its 25-lane state and its buffer on drop with
volatile writes and a `SeqCst` fence ([`hash/sha3/keccak.rs:144`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hash/sha3/keccak.rs#L144)), so a hash of secret input does
not leave the sponge state readable on the stack after it is done.

The honest boundary is that these are portable reference implementations in Rust, not
hardware-accelerated or formally constant-time throughout. The compression functions and the
Keccak permutation are straight-line over fixed-size state, so their timing does not depend on
secret values, but the `ct_eq` slice form still branches once on length before the fold, and the
guarantee the code makes is limited to the equal-length MAC-comparison path where it is actually
used. There is no AES-NI-style hardware path here; correctness against the vectors is proven,
constant-time behaviour is argued from the code shape rather than measured.

## Debugging hashes

A hash or MAC problem shows up in one of two places, and they mean different things. At build and
test time, a primitive that has drifted from the standard fails its known-answer test in
`userland/crypto_proofs/src/` (the SHA, Keccak, BLAKE3, HMAC, and HKDF suites), and because those
suites compile the real primitive source, a KAT failure means the shipping code disagrees with the
published vector, not that a test fixture is stale. That is the signal for a wrong constant or a
wrong round in the primitive itself.

At runtime, a hash never fails; it just produces a digest. The failure surfaces one level up, in
whatever compares the digest. A MAC or signature mismatch comes back as a plain `false` from
`ct_eq` / `hmac_verify`, or as `CryptoError::AuthenticationFailed` / `VerificationFailed`
([`src/crypto/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/error.rs)) from the callers that wrap it, with no detail about where the bytes
diverged, which is the point of the constant-time path. So the way to tell the two apart is where
the failure lands: a KAT failing under `crypto_proofs` is a broken primitive, while a `false` from
a verify at runtime is a real MAC or key mismatch on correct primitives. If a MAC check fails for
inputs you believe should match, the usual cause is a key-derivation or domain-separation
difference (which BLAKE3 mode, which HKDF info string) rather than the hash, because the hash
itself is the part covered by the vectors.

## Source map

```
  src/crypto/hash/blake3/             the in-tree BLAKE3 (capability MAC path)
  src/crypto/hash/unified/sha256.rs   SHA-256
  src/crypto/hash/sha512/             SHA-512 and SHA-384
  src/crypto/hash/sha3/keccak.rs      the Keccak sponge and its drop-time zeroization
  src/crypto/util/hmac/core.rs        HMAC, the key scrub, and hmac_verify
  src/crypto/util/constant_time/compare.rs  ct_eq and the fixed-width forms
  src/crypto/error.rs                 the CryptoError variants a verify returns
  userland/crypto_proofs/src/         the known-answer tests
```

Every reference above is verified against those trees. The capability MAC that keys off BLAKE3 is
on the [signing and MAC](/docs/security/signing-and-mac/) page, the IPC MAC is on the
[IPC envelope](/docs/subsystems/ipc/envelope/) page, and the secure random path the keys come from is on the
[randomness](/docs/subsystems/crypto/randomness/) page.
