---
title: "The Crypto Wire and Operation Reference"
description: "This page mirrors userland/capsulecrypto/src/protocol/: the NOCX frame, the decoder and encoder, the status codes, and the complete operation set."
weight: 1
---
This page mirrors `userland/capsule_crypto/src/protocol/`: the NOCX frame, the decoder and encoder, the
status codes, and the complete operation set. For the loop that dispatches a decoded request see
[server.md](/docs/userland/crypto/server/); for the crate behind each op see [primitives.md](/docs/userland/crypto/primitives/); for the identity
and mask see the [README](/docs/userland/crypto/).

## The NOCX frame

Every message, request and reply, opens with the same 20-byte header ([`src/protocol/types.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L66)), the
same shape as [capsule_entropy](/docs/userland/entropy/):

```
  offset  size  field
  0       4     u32 magic       "NOCX" = 0x4E4F4358   (types.rs:17)
  4       2     u16 version     1                     (types.rs:18)
  6       2     u16 op
  8       2     u16 flags
  10      2     u16 reserved
  12      4     u32 request_id
  16      4     u32 payload_len
```

A request follows the header with its per-op payload. A reply follows the header with a leading `i32
status` and then the result body; `encode_response` writes exactly `magic || version || op || flags ||
0u16 || request_id || (4 + body.len()) || status || body` ([`src/protocol/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L21)). Status `0` is
success. The reply carries back the request's own `op`, `flags`, and `request_id` so a caller can match a
reply to its call.

The decoder validates before any handler runs ([`src/protocol/decode.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L27)). It rejects, in order, a
buffer shorter than the header (`Short`), a wrong magic (`BadMagic`), a wrong version (`BadVersion`), a
`payload_len` over `MAX_PAYLOAD_BYTES` (`BadLength`), and a buffer that does not actually contain
`payload_len` bytes (`BadLength`) (`decode.rs:28`). Any decode error becomes a single `EINVAL` reply built
with op 0 ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)). On success it hands the handler a `Request { op, flags,
request_id, payload }` borrowing the payload slice (`types.rs:68`, `decode.rs:50`).

## Status codes

Four codes, all negative, defined in [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17):

| Code | Value | Meaning |
|------|-------|---------|
| `EIO` | -5 | a cipher failed internally on seal |
| `EINVAL` | -22 | a malformed frame, an unknown opcode, or a rejected decode |
| `EBADMSG` | -74 | a verification did not pass (bad signature or bad AEAD tag) |
| `EMSGSIZE` | -90 | a payload over its per-op size cap |

## The complete operation set

The op table is split across two files, which is a known trap. The first ten opcodes and their sizing
constants are in [`src/protocol/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L20); opcodes 14 through 20 were folded in later and live in
[`src/protocol/primitives.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/primitives.rs#L17). The complete set is seventeen operations, all routed by one match in
[`src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L29). An unknown op is `EINVAL` (`dispatch.rs:47`). Opcodes 7, 8, and 9 are
unassigned, so the wire is not densely packed.

| Op | Name | Handler | Request payload | Reply body |
|----|------|---------|-----------------|------------|
| 1 | BLAKE3_HASH | [`handlers/blake3_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/blake3_hash.rs#L23) | input bytes, `<= 64 KiB` | 32-byte digest |
| 2 | SHA3_256_HASH | [`handlers/sha3_256_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sha3_256_hash.rs#L23) | input bytes, `<= 64 KiB` | 32-byte digest |
| 3 | HEALTHCHECK | [`handlers/healthcheck.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/healthcheck.rs#L21) | none | empty (status 0) |
| 4 | SHA256_HASH | [`handlers/sha256_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sha256_hash.rs#L23) | input bytes, `<= 64 KiB` | 32-byte digest |
| 5 | SHA512_HASH | [`handlers/sha512_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sha512_hash.rs#L23) | input bytes, `<= 64 KiB` | 64-byte digest |
| 6 | ED25519_VERIFY | [`handlers/ed25519_verify.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/ed25519_verify.rs#L38) | `pubkey[32] \|\| sig[64] \|\| message`, message `<= 1 MiB` | empty (status only) |
| 10 | CHACHA20_POLY1305_SEAL | [`handlers/chacha20_poly1305_seal.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/chacha20_poly1305_seal.rs#L25) | AEAD seal frame (below) | ciphertext+tag |
| 11 | CHACHA20_POLY1305_OPEN | [`handlers/chacha20_poly1305_open.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/chacha20_poly1305_open.rs#L25) | AEAD open frame (below) | plaintext |
| 12 | AES256_GCM_SEAL | [`handlers/aes256_gcm_seal.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/aes256_gcm_seal.rs#L25) | AEAD seal frame (below) | ciphertext+tag |
| 13 | AES256_GCM_OPEN | [`handlers/aes256_gcm_open.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/aes256_gcm_open.rs#L25) | AEAD open frame (below) | plaintext |
| 14 | X25519_PUBLIC | [`handlers/x25519_public.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/x25519_public.rs#L22) | `private[32]` | `public[32]` |
| 15 | X25519_SHARED | [`handlers/x25519_shared.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/x25519_shared.rs#L23) | `private[32] \|\| peer_public[32]` | `shared[32]` |
| 16 | HMAC_SHA256 | [`handlers/hmac_sha256.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/hmac_sha256.rs#L22) | `u32 key_len \|\| key \|\| message`, key `<= 256 B` | 32-byte MAC |
| 17 | HKDF_SHA256 | [`handlers/hkdf_sha256.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/hkdf_sha256.rs#L24) | header + salt/ikm/info (below) | derived key |
| 18 | P256_ECDSA_VERIFY | [`handlers/p256_ecdsa_verify.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/p256_ecdsa_verify.rs#L22) | `sec1_pubkey[65] \|\| sig[64] \|\| prehash[32]` | empty (status only) |
| 19 | P384_ECDSA_VERIFY | [`handlers/p384_ecdsa_verify.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/p384_ecdsa_verify.rs#L22) | `sec1_pubkey[97] \|\| sig[96] \|\| prehash[48]` | empty (status only) |
| 20 | SHA384_HASH | [`handlers/sha384_hash.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sha384_hash.rs#L23) | input bytes, `<= 64 KiB` | 48-byte digest |

Opcodes 1 through 6 and 10 through 13 are declared in `types.rs:20`; opcodes 14 through 20 in
`primitives.rs:17`. All seventeen are re-exported through [`protocol/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/mod.rs#L26) and `:34`.

## Payload limits

Each limit is a named constant, cited:

```
  MAX_INPUT_BYTES        = 65536      hash inputs (BLAKE3/SHA-256/384/512/SHA3-256)   types.rs:40
  MAX_VERIFY_MESSAGE     = 1 MiB      Ed25519 message                                types.rs:38
  MAX_AEAD_PT_BYTES      = 1 MiB      AEAD plaintext (seal) / ciphertext (open)      types.rs:41
  MAX_AEAD_AAD_BYTES     = 256        AEAD associated data                           types.rs:42
  AEAD key / nonce / tag = 32 / 12 / 16                                              types.rs:43
  HMAC_KEY_MAX           = 256        HMAC key                                       primitives.rs:28
  HKDF_PART_MAX          = 256        each of HKDF salt / ikm / info                 primitives.rs:29
  HKDF_OUT_MAX           = 512        HKDF output length (out_len in 1..=512)        primitives.rs:30
  X25519_KEY_BYTES       = 32         X25519 scalar / point                          primitives.rs:25
  P256_VERIFY_BYTES      = 65+64+32 = 161   exact P-256 verify payload               primitives.rs:26
  P384_VERIFY_BYTES      = 97+96+48 = 241   exact P-384 verify payload               primitives.rs:27
  MAX_PAYLOAD_BYTES      = max(AEAD path, verify path)                               types.rs:50
```

The shared envelope budget `MAX_PAYLOAD_BYTES` is a compile-time `max` of the AEAD plaintext path
(`AEAD_HEADER_BYTES + MAX_AEAD_AAD_BYTES + MAX_AEAD_PT_BYTES + AEAD_TAG_BYTES`) and the verify path
(`ED25519_HEADER_BYTES + MAX_VERIFY_MESSAGE_BYTES`), so the single receive buffer is sized once for the
worst case (`types.rs:50`). A request over that budget is rejected in the decoder as `BadLength` before a
handler runs (`decode.rs:43`); a per-op oversize inside the budget is `EMSGSIZE`; a malformed frame is
`EINVAL`.

## The ops with a non-trivial internal frame

Most ops treat the payload as flat bytes. Five do not.

### AEAD (ops 10 through 13)

The AEAD frame is shared between AES-256-GCM and ChaCha20-Poly1305 and parsed once in
`handlers/aead_frame/`. The common header is `key[32] || nonce[12] || u32 aad_len`, then `aad_len` bytes
of associated data, then the body ([`aead_frame/common.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/common.rs#L20), [`aead_frame/constants.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/constants.rs#L24)). For a seal
the body is the plaintext, bounded by `MAX_PT` ([`aead_frame/parse.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L23)); for an open the body is
`ciphertext || tag`, which must be at least `TAG_LEN` and at most `MAX_PT + TAG_LEN`
([`aead_frame/parse.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L39)).

The parse maps its errors cleanly: a body over the limit is `OversizePayload` (mapped to `EMSGSIZE`); a
short frame or an over-large `aad_len` is `Short`/`OversizeAad` (mapped to `EINVAL`)
(`aes256_gcm_seal.rs:28`). Seal additionally rejects an all-zero nonce as degenerate before encrypting
([`aead_frame/parse.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/parse.rs#L29), `aes256_gcm_seal.rs:41`), a real guard against the worst AES-GCM misuse since a
repeated nonce under the same key is catastrophic for GCM. Open verifies the tag and returns the plaintext
or `EBADMSG`; a tampered ciphertext or wrong AAD is rejected rather than returned (`aes256_gcm_open.rs:44`).

### Ed25519 and ECDSA verify (ops 6, 18, 19)

Ed25519 verify takes `pubkey[32] || sig[64] || message` and returns a status only, never
attacker-influenced bytes (`ed25519_verify.rs:38`). An undersize payload or an over-1-MiB message is
`EMSGSIZE`, a malformed public key is `EINVAL`, a signature that does not check is `EBADMSG`, and a good
one is status `0` (`ed25519_verify.rs:39`). Because the reply carries no body, the op cannot be used to
smuggle data out.

The two ECDSA verifies are the same status-only shape but require an exact payload length and use
SEC1-encoded keys with prehashed digests. P-256 wants exactly 161 bytes (`sec1[65] || sig[64] ||
prehash[32]`) and verifies the 32-byte prehash (`p256_ecdsa_verify.rs:23`); P-384 wants exactly 241 bytes
(`sec1[97] || sig[96] || prehash[48]`) and verifies the 48-byte prehash (`p384_ecdsa_verify.rs:23`). A
wrong length, a malformed key, or a malformed signature is `EINVAL`; a signature that does not check is
`EBADMSG`.

### HKDF-SHA256 (op 17)

The HKDF payload is `u16 out_len || u16 salt_len || u16 ikm_len || u16 info_len`, then those three byte
runs in order (`hkdf_sha256.rs:44`). The parse requires the declared lengths to exactly consume the
payload (`end != payload.len()` is rejected), so a length-field mismatch cannot over-read
(`hkdf_sha256.rs:49`). A zero or over-512 `out_len` is `EMSGSIZE`, as is a salt, ikm, or info over 256
bytes (`hkdf_sha256.rs:29`, `:32`). See [primitives.md](/docs/userland/crypto/primitives/) for the extract/expand
construction.

## Source map

```
  userland/capsule_crypto/src/protocol/types.rs        NOCX magic/version, ops 1..13, size constants, Request
  userland/capsule_crypto/src/protocol/primitives.rs   ops 14..20 and their size constants
  userland/capsule_crypto/src/protocol/decode.rs       decode_request: validate and slice
  userland/capsule_crypto/src/protocol/encode.rs       encode_response: header || status || body
  userland/capsule_crypto/src/protocol/errno.rs        EIO EINVAL EBADMSG EMSGSIZE
  userland/capsule_crypto/src/protocol/mod.rs          the re-exported protocol surface
  userland/capsule_crypto/src/server/dispatch.rs       op -> handler match; unknown op = EINVAL
  userland/capsule_crypto/src/server/handlers/         the per-op handlers cited in the table
  userland/capsule_crypto/src/server/handlers/aead_frame/  the shared AEAD frame parse and nonce guard
```

Every reference above is verified against those trees.
