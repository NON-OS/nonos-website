---
title: "The Primitives and Their Backing Crates"
description: "This page mirrors userland/capsulecrypto/src/server/handlers/ and the capsule's Cargo.toml: one file per primitive, which crate backs each op, the shared AEAD frame, and the two..."
weight: 3
---
This page mirrors `userland/capsule_crypto/src/server/handlers/` and the capsule's `Cargo.toml`: one file
per primitive, which crate backs each op, the shared AEAD frame, and the two hand-written constructions.
For the opcodes and payload layouts see [operations.md](/docs/userland/crypto/operations/); for the loop that calls these
handlers see [server.md](/docs/userland/crypto/server/); for the identity and mask see the [README](/docs/userland/crypto/).

Each handler is one file exposing `pub fn name(req: Request<'_>) -> Vec<u8>` that validates its payload,
computes, and returns `encode_response(op, req.flags, req.request_id, status, body)`. On a bad frame it
returns a status with an empty body; it never panics.

## Which crate backs each op

The capsule mixes RustCrypto crates with two hand-written constructions. The crate for each op, from
`Cargo.toml:24`:

| Op(s) | Primitive | Backed by | Crate source |
|-------|-----------|-----------|--------------|
| 1 | BLAKE3 | `blake3::hash` | `blake3` 1.0, `default-features = false` (`Cargo.toml:24`) |
| 2 | SHA3-256 | `sha3::Sha3_256` | `sha3` 0.10 (`Cargo.toml:26`) |
| 4, 5, 20 | SHA-256 / SHA-512 / SHA-384 | `sha2::Sha256/Sha512/Sha384` | `sha2` 0.10, `force-soft` (`Cargo.toml:25`) |
| 6 | Ed25519 verify | `ed25519_dalek::VerifyingKey` | `ed25519-dalek` 2.1.1, `zeroize` (`Cargo.toml:31`) |
| 10, 11 | ChaCha20-Poly1305 | `chacha20poly1305::ChaCha20Poly1305` | `chacha20poly1305` 0.10 (`Cargo.toml:29`) |
| 12, 13 | AES-256-GCM | `aes_gcm::Aes256Gcm` | `aes-gcm` 0.10, `aes` feature (`Cargo.toml:30`) |
| 14, 15 | X25519 | `x25519_dalek::{StaticSecret, PublicKey}` | `x25519-dalek` 2, `static_secrets`, `zeroize` (`Cargo.toml:32`) |
| 16 | HMAC-SHA256 | hand-written over `sha2::Sha256` | `hmac_core.rs` (`Cargo.toml:25`) |
| 17 | HKDF-SHA256 | hand-written over the capsule's HMAC | `hkdf_sha256.rs` |
| 18 | P-256 ECDSA verify | `p256::ecdsa::VerifyingKey` | `p256` 0.13, `ecdsa` (`Cargo.toml:33`) |
| 19 | P-384 ECDSA verify | `p384::ecdsa::VerifyingKey` | `p384` 0.13, `ecdsa` (`Cargo.toml:34`) |

The `digest` and `aead` crates provide the shared `Digest` and `Aead` traits the handlers call through
(`Cargo.toml:27`, `:28`).

## The hashes

The five hash handlers are the same shape: bound the input against `MAX_INPUT_BYTES` (64 KiB) and return
`EMSGSIZE` if over, otherwise feed the payload to the crate and return the digest
([`handlers/sha256_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sha256_hash.rs#L23) is the reference; SHA-384, SHA-512, SHA3-256, and BLAKE3 follow it). The
digest widths are 32 bytes for BLAKE3/SHA-256/SHA3-256, 48 for SHA-384, and 64 for SHA-512. The `sha2`
crate is pinned to `force-soft` (`Cargo.toml:25`), a portable software path rather than an assembly one.

## The AEAD frame and ciphers

The AEAD frame is parsed once, shared between both ciphers, under `handlers/aead_frame/`. `parse_common`
slices `key[32] || nonce[12] || u32 aad_len`, then `aad_len` bytes of AAD, then the body, using
checked `get` on every range so a short buffer is `Short` and an over-`MAX_AAD` length is `OversizeAad`
([`aead_frame/common.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/common.rs#L20)). `parse_seal` bounds the body by `MAX_PT` ([`aead_frame/parse.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L21));
`parse_open` requires the body to be at least `TAG_LEN` and at most `MAX_PT + TAG_LEN`
([`aead_frame/parse.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L37)). `nonce_is_degenerate` ORs every nonce byte and returns true only for an
all-zero nonce ([`aead_frame/parse.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L29)).

The four cipher handlers are thin wrappers over that frame. `aes256_gcm_seal` parses the seal frame,
rejects a degenerate nonce with `EINVAL`, builds `Aes256Gcm` from the 32-byte key and 12-byte nonce, and
encrypts the plaintext with the AAD as an `aead::Payload`, returning ciphertext+tag or `EIO` on a cipher
failure (`aes256_gcm_seal.rs:25`). `aes256_gcm_open` parses the open frame and decrypts, returning the
plaintext on a good tag or `EBADMSG` on a bad one (`aes256_gcm_open.rs:44`). The ChaCha20-Poly1305 pair is
identical in structure over the `chacha20poly1305` crate (`chacha20_poly1305_seal.rs:25`,
`chacha20_poly1305_open.rs:25`). The degenerate-nonce guard is on both seal paths and not on open, since a
repeated nonce is a seal-side misuse.

## The verifies

Ed25519 verify parses `pubkey[32] || sig[64] || message`, builds a `VerifyingKey` from the 32 pubkey
bytes (`EINVAL` if malformed), builds a `Signature` from the 64 sig bytes, and returns `0` or `EBADMSG`
from `verifying_key.verify` (`ed25519_verify.rs:57`). It returns a status only, never a body, so a failing
verify is a clean boolean-shaped answer with nothing to smuggle out.

The two ECDSA verifies require an exact payload length, build a SEC1 `VerifyingKey`, build a `Signature`
from the fixed-size signature slice, and call `verify_prehash` on the trailing digest, returning `0` or
`EBADMSG` (`p256_ecdsa_verify.rs:22`, `p384_ecdsa_verify.rs:22`). They use the hazmat `PrehashVerifier`
because the caller supplies an already-hashed digest, which keeps the hash choice at the caller and off
the wire.

## X25519

`x25519_public` takes a 32-byte private scalar, builds a `StaticSecret`, and returns its `PublicKey`
bytes (`x25519_public.rs:22`). `x25519_shared` takes `private[32] || peer_public[32]`, builds the secret
and the peer public, computes `diffie_hellman`, encodes the 32-byte shared secret, and then wipes its
stack copy of the private scalar before returning (`x25519_shared.rs:23`). The `zeroize` feature on the
dalek crate zeroizes the `StaticSecret`'s own internal state; the explicit wipe covers the plain
`[u8; 32]` copy the handler made.

## Hand-written HMAC and HKDF

Two ops are not delegated to a crate. HMAC-SHA256 is the textbook ipad/opad construction over
`sha2::Sha256`: a key longer than the 64-byte block is first hashed, then the block is XORed with `0x36`
for the inner pass and `0x5c` for the outer, and the result is `SHA256(opad || SHA256(ipad || msg))`
(`hmac_core.rs:22`). The op handler `hmac_sha256` reads a `u32 key_len` prefix, bounds it by
`HMAC_KEY_MAX` (256), splits key from message, and calls that core (`hmac_sha256.rs:22`).

HKDF-SHA256 is RFC 5869 over that same HMAC. Extract is `PRK = HMAC(salt, ikm)` (`hkdf_sha256.rs:35`), and
Expand iterates `T(i) = HMAC(PRK, T(i-1) || info || counter)` for `ceil(out_len / 32)` blocks and
truncates to `out_len` (`hkdf_sha256.rs:55`). The parse (documented in [operations.md](/docs/userland/crypto/operations/))
requires the declared salt, ikm, and info lengths to exactly consume the payload, so a length-field
mismatch cannot over-read (`hkdf_sha256.rs:49`).

## Constant-time posture

Constant-time behavior is inherited, not hand-rolled. The verify and AEAD tag checks come from
`ed25519-dalek`, `aes-gcm`, `chacha20poly1305`, `p256`, and `p384`, which carry their own constant-time
guarantees (`Cargo.toml:29`). The capsule's own contribution is the status-only reply shape on the verify
ops, so a failing check returns a boolean-shaped `EBADMSG` with no body (`ed25519_verify.rs:65`), and the
degenerate-nonce guard on AEAD seal, which is the one place the capsule reasons about misuse itself
([`aead_frame/parse.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L29)).

## Source map

```
  userland/capsule_crypto/Cargo.toml                        the crate list and features
  userland/capsule_crypto/src/server/handlers/blake3_hash.rs, sha256_hash.rs, sha384_hash.rs, sha512_hash.rs, sha3_256_hash.rs   the hashes
  userland/capsule_crypto/src/server/handlers/aead_frame/   parse_common, parse_seal, parse_open, nonce_is_degenerate
  userland/capsule_crypto/src/server/handlers/aes256_gcm_seal.rs, aes256_gcm_open.rs        AES-256-GCM
  userland/capsule_crypto/src/server/handlers/chacha20_poly1305_seal.rs, chacha20_poly1305_open.rs   ChaCha20-Poly1305
  userland/capsule_crypto/src/server/handlers/ed25519_verify.rs, p256_ecdsa_verify.rs, p384_ecdsa_verify.rs   the verifies
  userland/capsule_crypto/src/server/handlers/x25519_public.rs, x25519_shared.rs            X25519
  userland/capsule_crypto/src/server/handlers/hmac_core.rs, hmac_sha256.rs, hkdf_sha256.rs  hand-written HMAC / HKDF
```

Every reference above is verified against those trees.
