---
title: "Symmetric Encryption"
description: "The kernel carries two authenticated encryption schemes, AES-256-GCM and ChaCha20-Poly1305, both in-tree nostd implementations, exposed to capsules through the crypto syscall fa..."
weight: 2
---
The kernel carries two authenticated encryption schemes, AES-256-GCM and ChaCha20-Poly1305,
both in-tree no_std implementations, exposed to capsules through the crypto syscall family. This
page documents them and the AEAD surface. The code is under `src/crypto/symmetric/` and
`src/crypto/core/`.

## The ciphers

Both AEAD constructions are implemented in the tree, not pulled from a crate:

```
  AES / AES-256-GCM        src/crypto/symmetric/aes/, aes_gcm/
                           in-tree AES (S-boxes, key schedule, CTR) + GHASH
  ChaCha20-Poly1305        src/crypto/symmetric/chacha20poly1305/
                           in-tree ChaCha20 stream + Poly1305 MAC
```

AES-256-GCM is the block cipher in counter mode with the GHASH Galois authenticator;
ChaCha20-Poly1305 is the stream cipher with the Poly1305 one-time authenticator. Both are
authenticated encryption with associated data (AEAD): encryption produces ciphertext plus an
authentication tag, and decryption fails if the tag does not verify, so a tampered ciphertext or
associated-data mismatch is rejected rather than returned. Each has a known-answer test that runs
the real source against published vectors ([`userland/crypto_proofs/src/aesgcm_tests.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/crypto_proofs/src/aesgcm_tests.rs),
`chacha_tests.rs`).

## The AEAD core

The two schemes are unified behind an AEAD abstraction ([`src/crypto/core/aead.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/core/aead.rs)): `Aes256GcmAead`
and `Chacha20Poly1305Aead` implement the same trait, so callers select a scheme without duplicating
the seal-and-open logic. The core exposes encrypt (seal) and decrypt (open) with and without
associated data, and the tag handling is internal, so a caller cannot accidentally accept
unauthenticated plaintext.

## The crypto syscall family

Capsules reach these primitives through the `MkCrypto*` syscalls, which the router dispatches to
`crypto::dispatch_crypto` (see the [syscall router](/docs/subsystems/syscall/router/)). The family covers the
symmetric, hash, and asymmetric operations from one place (`src/syscall/dispatch/crypto/`):

```
  MkCryptoEncrypt / MkCryptoDecrypt   AES-256-GCM or ChaCha20-Poly1305 (caller-selected)
  MkCryptoHash / MkCryptoKeccak256    SHA-256, Keccak-256
  MkCryptoHmacSha256 / HkdfSha256     MAC and KDF
  MkCryptoEd25519Verify               signature verification
  MkCryptoSecp256k1Sign / Pubkey      ECDSA sign and public-key recovery
  MkCryptoX25519Public / Shared       ECDH (feature-gated)
  MkCryptoRandom                      secure random bytes
```

The encrypt and decrypt calls validate and copy the user buffers through the
[usercopy](/docs/subsystems/memory/usercopy/) boundary before touching them, and the AEAD tag check means a
capsule that submits a corrupted ciphertext gets a failure, not garbage plaintext. The syscall
layer is a thin dispatch over the same in-tree primitives documented here; it adds the user
boundary and the capability check, not new crypto.

## Security analysis

Both schemes are authenticated encryption, so the properties that matter are that a tampered
message is rejected, that the rejection does not leak through timing or through a half-decrypted
buffer, and that the key does not outlive the object that holds it.

**A tampered ciphertext or wrong associated data is rejected, not returned.** Decryption
recomputes the tag over the ciphertext and the associated data and compares it against the tag the
message carries; only if they match is the plaintext returned. AES-256-GCM does this in
`Aes256Gcm::decrypt` ([`src/crypto/symmetric/aes_gcm/aes256.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/symmetric/aes_gcm/aes256.rs#L51)) and ChaCha20-Poly1305 in
`aead_decrypt` ([`src/crypto/symmetric/chacha20poly1305/aead.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/symmetric/chacha20poly1305/aead.rs#L51)). Each is proven against
published vectors by its known-answer test (`aesgcm_tests.rs`, `chacha_tests.rs`), so the seal and
open agree with the standard rather than just with each other.

**The tag comparison is constant time and a rejected plaintext is scrubbed.** The GCM path
compares the computed and received tags with `ct_eq_16` (`aes256.rs:69`) and ChaCha20-Poly1305
with `ct_eq` ([`chacha20poly1305/aead.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/chacha20poly1305/aead.rs#L70)), both of which fold the whole tag before deciding, so
a forged tag does not reveal through timing how many bytes it got right. On a tag failure the code
does not hand back the buffer it decrypted into: GCM volatile-zeros the plaintext through
`secure_zero_slice` before returning the error (`aes256.rs:74`), and ChaCha20-Poly1305 does the
same, with a comment that it decrypts regardless of tag validity specifically to avoid a timing
oracle on the decrypt itself. So a caller that submits a corrupted ciphertext gets an error and a
zeroed buffer, never partial plaintext.

**Key material is bound to the AEAD object's lifetime.** `Aes256GcmAead` and
`Chacha20Poly1305Aead` ([`src/crypto/core/aead.rs:75`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/core/aead.rs#L75), `:44`) hold a 32-byte key and volatile-zero
it in `Drop` with a `SeqCst` fence, so the key does not linger once the object goes out of scope.
The tag handling lives inside seal and open, so a caller of the AEAD trait cannot reach in and
accept unauthenticated plaintext by mistake.

The honest boundary is that these are portable in-tree implementations, not the hardware AES path.
The AES core is table-and-S-box based rather than AES-NI, and GHASH is a software Galois
multiply, so the constant-time guarantee the code makes is specifically the tag comparison and the
scrub-on-failure, not a claim that the block cipher and the field multiply are free of
data-dependent timing on every microarchitecture. Nonce management is the caller's responsibility;
the AEAD takes a 96-bit nonce and does not itself prevent nonce reuse, which for GCM is the usual
sharp edge.

## Debugging symmetric encryption

A symmetric failure is almost always one of three things, and they surface differently. A
primitive that has drifted from the standard fails its known-answer test at build and test time
under `userland/crypto_proofs/src/` (`aesgcm_tests.rs`, `chacha_tests.rs`), which compile the real
cipher source, so a KAT failure there means the cipher or the GHASH/Poly1305 authenticator itself
is wrong, not the caller.

At runtime the visible failure is the tag check. Decryption returns `CryptoError::AeadTagMismatch`
(mapped in [`core/aead.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/core/aead.rs#L71), `:102`) or the low-level `"authentication failed"` string
(`aes256.rs:76`), and the returned buffer is zeroed rather than partially filled. That single
failure covers three distinct causes, and the way to separate them is to hold the inputs fixed one
at a time: the same key and nonce but a flipped ciphertext byte is genuine tampering; the correct
ciphertext but a different key or a different nonce than was used to seal produces the identical
mismatch, because the recomputed tag depends on both; and associated data that differs between
seal and open fails the tag even though the ciphertext is untouched, because the AAD is folded into
the tag. So a tag mismatch on data you believe is correct usually points at a key, nonce, or AAD
that does not match the sealing side rather than at corruption in transit. A length that is shorter
than a tag comes back earlier and distinctly, as `"ciphertext too short"` (`aes256.rs:58`) or
`CryptoError::InvalidLength` from `aead_unwrap` ([`core/aead.rs:120`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/core/aead.rs#L120)), which tells you the framing is
wrong before any crypto ran.

## Source map

```
  src/crypto/symmetric/aes/, aes_gcm/        AES-256-GCM: the cipher, GHASH, and tag path
  src/crypto/symmetric/aes_gcm/aes256.rs     decrypt: ct_eq_16 tag check and scrub-on-failure
  src/crypto/symmetric/chacha20poly1305/     ChaCha20-Poly1305 stream and Poly1305 MAC
  src/crypto/core/aead.rs                     the AEAD trait, the two impls, key zeroization on drop
  src/crypto/error.rs                         AeadTagMismatch and the other CryptoError variants
  src/syscall/dispatch/crypto/                the MkCrypto* dispatch
  userland/crypto_proofs/src/                 the AEAD known-answer tests
```

Every reference above is verified against those trees. The syscall boundary these calls cross is on
the [syscall router](/docs/subsystems/syscall/router/) page, the user-buffer copy is on the
[usercopy](/docs/subsystems/memory/usercopy/) page, and the constant-time comparison the tag check uses is on
the [hashes](/docs/subsystems/crypto/hashes/) page.
