---
title: "The Nym Wire Packet"
description: "This page documents the NYMP wire packet: the fixed on-the-wire layout, the ChaCha20-Poly1305 payload seal and open, the padded-plaintext frame that hides the true length, the B..."
weight: 4
---
This page documents the `NYMP` wire packet: the fixed on-the-wire layout, the ChaCha20-Poly1305 payload seal
and open, the padded-plaintext frame that hides the true length, the BLAKE3 replay tag, and the crypto
syscall wrappers the whole capsule shares. It mirrors `src/packet/` and `src/crypto/`. The route header that
occupies the tail of every packet is built separately and documented on the [mixnet](/docs/userland/net-nym/mixnet/) page; the
tables that hold session keys and replay windows are on the [state](/docs/userland/net-nym/state/) page. For the kernel-side
crypto these wrappers call, read the [crypto capsule](/docs/userland/crypto/).

## Fixed sizing

Every wire packet is exactly `WIRE_PACKET_MAX` bytes: a `NYM_HEADER_BYTES` header of 365 and a
`NYM_PAYLOAD_BYTES` payload of 2048, so 2413 bytes total ([`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)). The size is a
constant, not a function of the plaintext, which is the point: a mixnet packet has to be indistinguishable by
length, so a 10-byte datagram and a 1000-byte datagram produce the same 2413-byte packet. The application
payload is capped at `MIX_PAYLOAD_MAX`, 1024 bytes, and cover packets are `COVER_BYTES`, also 1024
(`limits.rs:17`). These sizes are the `NYM_HEADER_BYTES = 365` and `NYM_PAYLOAD_BYTES = 2048` that the source
README's "beta scaffolding" note claims are not yet wired; they are wired, and the encode path below fills
them.

## The header layout

The header offsets are named constants in [`src/packet/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/header.rs#L17), and `encode` writes them in order
([`src/packet/encode.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/encode.rs#L67)):

```
  offset  size  field                          header.rs
  0       4     magic = NYMP (0x4E594D50)       WIRE_MAGIC:17
  4       1     version = 1                     WIRE_VERSION:18
  5       1     flags (COVER / REPLY)           OFF_FLAGS:19
  6       2     reserved, zero                  encode.rs:71
  8       4     session id                      OFF_SESSION:20
  12      12    AEAD nonce                      OFF_NONCE:21
  24      32    replay tag (BLAKE3)             OFF_REPLAY_TAG:22
  56      309   Sphinx route header             OFF_HEADER_RANDOM:23
  365     2048  AEAD ciphertext + tag           payload
```

The route header runs from offset 56 to the end of the 365-byte header, which is `365 - 56 = 309` bytes
(`OFF_HEADER_RANDOM:23`), and that is exactly the `ROUTE_HEADER_LEN` the mixnet builder produces
([`src/route/sphinx/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/types.rs#L19)). The two flag bits are `FLAG_COVER` (`0x01`) and `FLAG_REPLY` (`0x02`)
([`src/packet/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/types.rs#L24)).

## Encode

`encode` takes the session id, the flags, the 32-byte session key, the 32-byte credential material, and the
plaintext, and produces a full wire packet ([`src/packet/encode.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/encode.rs#L27)). It runs in order:

1. Reject a plaintext over `MIX_PAYLOAD_MAX` or an output buffer smaller than `WIRE_PACKET_MAX`
   (`encode.rs:35`).
2. Draw a fresh 12-byte nonce from `crypto_random` (`encode.rs:38`).
3. Build the padded plaintext, which is the length-prefixed datagram inside a random-filled fixed buffer
   (`encode.rs:40`, described below).
4. Zero the whole output, then write the header base: magic, version, flags, reserved, session id, nonce
   (`encode.rs:41`).
5. Build the Sphinx route header for this session and credential and write it into the header tail at offset
   56 (`encode.rs:43`, `encode.rs:62`). This is the [mixnet](/docs/userland/net-nym/mixnet/) page's job.
6. Seal the padded plaintext into the payload region with ChaCha20-Poly1305 under the session key and nonce,
   and require the sealed length to be exactly `NYM_PAYLOAD_BYTES` (`encode.rs:45`).
7. Zeroize the padded-plaintext buffer (`encode.rs:46`).
8. Compute the replay tag over the session id, flags, nonce, and ciphertext, and write it at offset 24
   (`encode.rs:50`).

The output is always `WIRE_PACKET_MAX` bytes (`encode.rs:52`). A crypto failure anywhere returns
`PacketError::Crypto`, a route-selection failure surfaces as `PacketError::NoRoute` from the builder, and a
size mismatch returns `PacketError::BadLength` ([`src/packet/types.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/types.rs#L36)).

## The padded plaintext

The plaintext is not sealed directly; it is first placed inside a fixed `AEAD_PLAIN_BYTES` buffer so that the
sealed size is constant. `AEAD_PLAIN_BYTES` is `NYM_PAYLOAD_BYTES - TAG_BYTES`, that is `2048 - 16 = 2032`
bytes, because the AEAD adds a 16-byte tag and the whole thing has to land in exactly 2048
([`src/packet/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/types.rs#L23)). `padded_plaintext` fills the 2032-byte buffer with random bytes, writes the real
length as a little-endian u16 at offset 0, and copies the datagram after it ([`src/packet/plain.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/plain.rs#L23)). The
random fill matters: the bytes past the real payload are not zeros a compressor or an observer could
distinguish, they are noise. On receipt, `recv_plain::queue` reads that u16 length back and returns only the
real bytes ([`src/server/handlers/recv_plain.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv_plain.rs#L22)).

## Decode

`decode` is the inverse guard on receipt ([`src/packet/decode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/decode.rs#L24)). It requires the buffer to be exactly
`WIRE_PACKET_MAX`, the magic to be `NYMP`, and the version to be 1 (`decode.rs:28`). It reads the session id,
flags, nonce, and stored replay tag, then recomputes the tag over the session id, flags, nonce, and
ciphertext and compares it to the stored one, returning `PacketError::BadTag` on a mismatch
(`decode.rs:41`, `decode.rs:57`). Only on a tag match does it hand back a `Decoded` view with the session id,
flags, nonce, replay tag, and a borrowed ciphertext slice (`decode.rs:42`). The actual AEAD open happens one
layer up, in the receive path, which looks up the session by id, checks the replay tag against that session's
window, and opens the ciphertext under the session key ([`src/server/handlers/recv_drain.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv_drain.rs#L60)).

## The replay tag

The tag is a BLAKE3 hash, not a keyed MAC: `tag::compute` concatenates the session id, the flags byte, the
12-byte nonce, and the full ciphertext, and hashes it to 32 bytes ([`src/packet/tag.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/tag.rs#L23)). It serves two
purposes. On encode it is a fingerprint written into the header; on decode it is recomputed and compared,
which detects a corrupted or truncated packet before the AEAD runs. Its replay role is separate: the receive
path feeds the tag to the session's `ReplayWindow`, which rejects a tag it has seen in its last 64 packets
([`src/state/replay.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/replay.rs#L32)). Because the tag covers the ciphertext, which covers the random-padded plaintext
and a fresh nonce, two encodes of the same datagram produce different tags, so the replay window rejects only
true duplicates.

## The crypto wrappers

`src/crypto/` is a thin, honest layer over the kernel's crypto syscalls, exposed through
[`src/crypto/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/mod.rs#L24). It invents no primitives; every function is a bounds-checked wrapper that calls a
`crypto_*` syscall in `nonos_libc` and validates the returned length. This is why the capsule needs the
`Crypto` capability, and it is what makes the source README's `IPC`-only mask wrong.

| Wrapper | Syscall | Used by |
|---|---|---|
| `seal` / `open` | `crypto_encrypt` / `crypto_decrypt`, ChaCha20-Poly1305 (algo 0) | payload seal on encode, open on receive (`aead.rs:23`) |
| `x25519_public` / `x25519_shared` | `crypto_x25519_public` / `crypto_x25519_shared` | the Sphinx ephemeral key and per-hop shared secret (`ecdh.rs:21`) |
| `blake3` | `crypto_hash`, BLAKE3 (algo 0) | the replay tag and the route seed (`hash.rs:23`) |
| `hkdf_sha256` | `crypto_hkdf_sha256` | the per-hop key and the onion mask (`kdf.rs:33`) |
| `hmac_sha256` | `crypto_hmac_sha256` | the per-hop MAC and the SURB tag (`kdf.rs:24`) |
| `fill_random` | `crypto_random` | session keys, nonces, ephemeral keys, cover fill, WebSocket masks (`random.rs:21`) |

`hkdf_sha256` does not pass salt, ikm, and info as separate syscall arguments; it length-frames them into one
buffer with a small fixed prefix of four u16 lengths and passes that, so the four inputs are unambiguous to
the kernel side (`kdf.rs:43`). The `Key`, `Nonce`, and `TAG_BYTES` type aliases are 32, 12, and 16 bytes
([`src/crypto/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/types.rs#L17)). Note the directory and credential verify paths call `crypto_ed25519_verify`
directly rather than through this module, because signature verification is not part of the packet crypto;
those live on the [directory](/docs/userland/net-nym/directory/) and [state](/docs/userland/net-nym/state/) pages.

## Source map

```
  userland/capsule_net_nym/src/protocol/limits.rs   NYM_HEADER_BYTES, NYM_PAYLOAD_BYTES, the wire sizes
  userland/capsule_net_nym/src/packet/header.rs     the NYMP magic and the field offsets
  userland/capsule_net_nym/src/packet/encode.rs     the encode order and the header write
  userland/capsule_net_nym/src/packet/plain.rs      the random-padded, length-prefixed plaintext
  userland/capsule_net_nym/src/packet/decode.rs     the receive-side size, magic, and tag guard
  userland/capsule_net_nym/src/packet/tag.rs        the BLAKE3 replay tag
  userland/capsule_net_nym/src/packet/types.rs      HEADER_LEN, REPLAY_TAG_LEN, AEAD_PLAIN_BYTES, flags
  userland/capsule_net_nym/src/crypto/mod.rs        the crypto wrapper re-exports
  userland/capsule_net_nym/src/crypto/aead.rs       ChaCha20-Poly1305 seal and open
  userland/capsule_net_nym/src/crypto/kdf.rs        HKDF and HMAC with the length-framed input
  userland/capsule_net_nym/src/crypto/hash.rs       BLAKE3
  userland/capsule_net_nym/src/crypto/ecdh.rs       X25519 public and shared
  userland/capsule_net_nym/src/crypto/random.rs     the crypto_random wrapper
  userland/capsule_net_nym/src/crypto/types.rs      Key, Nonce, TAG_BYTES
```

Every reference above is verified against those trees.
