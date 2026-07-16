---
title: "The encrypted store"
description: "This page mirrors src/store/, including its crypto/ submodule."
weight: 2
---
This page mirrors `src/store/`, including its `crypto/` submodule. The store is the back half of the
capsule: it owns the file map, and it is where the capsule's defining property lives, that every file is
held encrypted at rest. The front half, the protocol and handlers that call into the store, is covered in
[operations.md](/docs/userland/ramfs/operations/).

## What a file is

The store is a single `BTreeMap` from path to `File`, held in the capsule heap
([`src/store/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L29)). A `File` is not a plain byte buffer. It carries its own key material and its
ciphertext ([`src/store/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L23)):

```
  File
    key        [u8; 32]   the file's ChaCha20-Poly1305 key
    nonce      [u8; 12]   the nonce used for the current ciphertext
    ciphertext Vec<u8>    sealed bytes, plaintext length plus a 16-byte tag
```

The three lengths come from [`src/store/crypto/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/constants.rs): `KEY_LEN = 32`, `NONCE_LEN = 12`, and
`TAG_LEN = 16` ([`src/store/crypto/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/constants.rs#L17)). An empty file has an empty `ciphertext` vector, which
every read and write path treats as zero bytes of plaintext rather than trying to decrypt.

`Store::new` is a const constructor over an empty map, so the runner can build it before the loop
([`src/store/state.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L25)). `contains` is a plain map lookup ([`src/store/state.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L29)).

## Creating a file: fresh key at ensure

`ensure` is the only place a file is born. If the path already exists it is a no-op. Otherwise it draws a
fresh key and a fresh nonce, then inserts a `File` with an empty ciphertext
([`src/store/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L33)). The key is drawn once, here, and never rotated for the life of that file. The
nonce inserted here is a starting value; every subsequent write and truncate replaces it.

Both key and nonce come from the kernel CSPRNG through the Crypto capability. `fresh_key` fills 32 bytes
with `crypto_random` and fails with `CryptoFailure` if the syscall returns negative
([`src/store/crypto/fresh_key.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/fresh_key.rs#L22)). `fresh_nonce` does the same for 12 bytes
([`src/store/crypto/fresh_nonce.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/fresh_nonce.rs#L22)). There is no seed baked into the capsule and no key derivation from
the path; key material is unpredictable per file.

## The seal and open path

All encryption goes through two thin wrappers over `nonos_libc`, and both name the same algorithm constant
`ALGO_CHACHA20_POLY1305 = 0` ([`src/store/crypto/constants.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/constants.rs#L16)).

`seal` calls `crypto_encrypt(algo, key, nonce, plain, plain_len, cipher)` and returns the number of
ciphertext bytes, or `CryptoFailure` on a negative return ([`src/store/crypto/seal.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/seal.rs#L22)). `open` calls
`crypto_decrypt` with the matching arguments and returns the recovered plaintext length
([`src/store/crypto/open.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/crypto/open.rs#L22)). Neither passes any associated data; the AEAD runs with no AAD. The
authentication tag is the 16 bytes the AEAD appends, which is why sealed ciphertext is always plaintext
length plus `TAG_LEN` and why a decrypt buffer is sized `ciphertext.len() - TAG_LEN`.

Because the algorithm is authenticated, a corrupted or tampered ciphertext does not decrypt to garbage: the
tag check fails, `crypto_decrypt` returns negative, and the store surfaces `CryptoFailure`, which the
handlers report as `EIO`.

## The decrypt-edit-reseal cycle

The store never holds mutable plaintext at rest. Read, write, and truncate each open the ciphertext into a
transient buffer, do their work, and, for the mutating two, reseal.

Read is the read-only case. It looks up the file, returns an empty vector immediately if the ciphertext is
empty, otherwise allocates a plaintext buffer of `ciphertext.len() - TAG_LEN`, decrypts into it, and
truncates to the recovered length. It then clamps the requested window: an offset past the end returns
empty, and the end is `offset + count` saturated against the plaintext length, so an over-long count is
capped rather than faulting. The returned slice is copied out and the plaintext buffer is dropped
([`src/store/read.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/read.rs#L24)).

Write is decrypt, splice, reseal. It first calls `ensure`, so writing to a missing path creates it. It
decrypts the current ciphertext into a plaintext vector (empty if the file was empty), grows the vector
with zero fill if the write extends past the current end, and copies the new data into place at the offset.
Then, critically, it draws a fresh nonce, seals the updated plaintext under the file's key and that new
nonce, and stores the result. It returns the length of the data written, not the new file size
([`src/store/write.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/write.rs#L24)).

Truncate is the same cycle with a resize in the middle. It decrypts the current plaintext, resizes it to
the requested length with zero fill for any growth, draws a fresh nonce, and reseals. Truncating to zero is
a special case: the plaintext is empty, so it stores an empty ciphertext and returns without calling the
AEAD at all ([`src/store/truncate.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/truncate.rs#L24)).

## The nonce discipline

The key is fixed per file, so nonce reuse under the same key would be a real weakness for a stream AEAD.
The store avoids it by drawing a fresh nonce on every seal. Look at the two mutating paths: write sets
`f.nonce = fresh_nonce()?` immediately before sealing ([`src/store/write.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/write.rs#L45)), and truncate does the same
([`src/store/truncate.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/truncate.rs#L35)). The nonce stored alongside the ciphertext is always the one that produced it,
so open always has the matching nonce. A fresh 96-bit random nonce per write keeps the key-nonce pair from
repeating across the file's edit history.

Two consequences follow. Every write reseals the entire file, not just the changed range, so cost is linear
in file size rather than in write size. And the ciphertext for a given logical content is not stable across
writes, because the nonce changes each time; there is no content addressing at this layer.

## Source map

The file map and error type are [`src/store/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs); creation is [`src/store/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs); the three
operations are [`src/store/read.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/read.rs), [`src/store/write.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/write.rs), and [`src/store/truncate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/truncate.rs). The crypto wrappers
and constants are `src/store/crypto/` (`constants.rs`, `fresh_key.rs`, `fresh_nonce.rs`, `seal.rs`,
`open.rs`, `mod.rs`). The `crypto_random`, `crypto_encrypt`, and `crypto_decrypt` syscalls are provided by
`nonos_libc` under the capsule's Crypto capability. Every reference above is verified against those trees.
