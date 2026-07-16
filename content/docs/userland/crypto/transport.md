---
title: "The Kernel Seam: Spawn, Gate, and Clients"
description: "This page mirrors src/security/cryptocapsule/, the kernel-side mirror named in Capsule.mk:17."
weight: 4
---
This page mirrors `src/security/crypto_capsule/`, the kernel-side mirror named in `Capsule.mk:17`. It is a
separate body of code from the capsule and it does three things: it spawns the capsule under verification,
it gates every request against `CAP_CRYPTO` on the caller pid, and it transports the request over IPC to
`crypto_pool`. For the capsule the request reaches see the [README](/docs/userland/crypto/); for the frame on the wire
see [operations.md](/docs/userland/crypto/operations/).

## Why a kernel seam exists

A userland caller does not talk to the capsule directly. The path is: userland capsule ->
`nonos_libc::crypto_*` shim -> crypto syscall -> kernel crypto-capsule client -> IPC to `crypto_pool`. The
capability check lives on the kernel side of that path, not in the capsule, which is the whole reason the
capsule's own `0x39` mask is not the caller-facing gate.

## Verified spawn

`spawn_crypto_capsule` runs at boot ([`src/security/crypto_capsule/spawn.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/spawn.rs#L40)). It decodes the baked
trust anchor, builds a `CapsuleSpecVerified` from the embedded ELF, id cert, manifest, and attestation
trailer, sets the service name `crypto_pool`, port 4102, and reply port 4103 (`spawn.rs:31`), requests
exactly `Capability::IPC.bit() | Capability::Memory.bit() | Capability::Crypto.bit()` (`spawn.rs:54`), and
calls `spawn_verified`, which checks the whole chain before the code runs. The comment at `spawn.rs:37`
restates that `CAP_CRYPTO` is the caller-facing gate, not the capsule's own bit. On success the pid is
recorded with `state::set_alive` (`spawn.rs:56`).

## The gate

Every op the kernel client exposes runs `gate_hash` first ([`src/security/crypto_capsule/capability.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/capability.rs#L22)).
`gate_hash` reads the caller pid from the kernel's process accounting, not from any caller-supplied
payload, and returns `NoCallerPid` if there is none (`capability.rs:25`). It then checks
`has_capability(pid, CAP_CRYPTO)` and fails closed with `AccessDenied` if the caller lacks it
(`capability.rs:28`). So the authority decision is a genuine capability test on the caller pid, made on
the kernel side, before a single byte is sent over IPC. It is not the per-op payload limits standing in
for a capability check; the payload limits are a separate defense that bounds the heap a request can
consume.

`gate_hash` is called at the top of every client path:

| Client path | Ops it carries | Gate call |
|-------------|----------------|-----------|
| [`client/hash_op.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/hash_op.rs) | BLAKE3, SHA-256, SHA-512, SHA3-256 | `hash_op.rs:33` |
| [`client/aead_op/seal.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/aead_op/seal.rs) | ChaCha20 seal, AES-GCM seal | [`aead_op/seal.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_op/seal.rs#L34) |
| [`client/aead_op/open.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/aead_op/open.rs) | ChaCha20 open, AES-GCM open | [`aead_op/open.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_op/open.rs#L34) |
| [`client/prf_op.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/prf_op.rs) | HMAC, HKDF, X25519 public, X25519 shared | `prf_op.rs:37` |
| [`client/verify_ed25519.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/verify_ed25519.rs) | Ed25519 verify | `verify_ed25519.rs:48` |
| [`client/healthcheck.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/healthcheck.rs) | healthcheck | `healthcheck.rs:24` |

## The transport and reply inbox

The client sends over the lifecycle transport and receives on a fixed reply inbox
`endpoint.4294967300`, which is `0x1_0000_0004` in hex ([`src/security/crypto_capsule/client/transport.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/client/transport.rs#L28)).
That value is deliberately distinct from the ramfs (4294967297), keyring (4294967298), and entropy
(4294967299) reply inboxes so concurrent in-flight requests to different pools cannot cross-route
(`transport.rs:25`, [`src/protocol/types.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L60)). A `TRANSPORT_LOCK` serializes the send-then-receive so a
reply is matched to its request (`transport.rs:31`).

## Which ops have a kernel client

The kernel client exposes fifteen of the seventeen capsule ops ([`src/security/crypto_capsule/client/mod.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/client/mod.rs#L37)):
the four hashes with in-tree clients (BLAKE3, SHA-256, SHA-512, SHA3-256), Ed25519 verify, both AEAD pairs,
HMAC and HKDF, both X25519 ops, and healthcheck. The two ECDSA verifies (P-256, P-384) and SHA-384 exist
in the capsule but have no in-tree kernel client yet, so no `CAP_CRYPTO`-gated caller reaches them today.
That is a live gap, not a design choice: the capsule speaks those ops, and adding a client under
`client/` plus the syscall plumbing and the `nonos_libc` shim would wire them.

## Real callers

Callers reach the pool through the `nonos_libc` crypto shims ([`userland/libc/src/crypto/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/crypto/mod.rs)), never a
direct crypto dependency:

- The [market](/docs/userland/market/) verifies its signed catalog index through `crypto_ed25519_verify`
  rather than linking Ed25519 itself; a good index returns `rc == 0` and `Verdict::Accepted`
  ([`userland/capsule_market/src/verify/crypto.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/verify/crypto.rs#L31)).
- The keyring builds EIP-712 digests and Ethereum addresses through the hash shims
  ([`userland/capsule_keyring/src/server/eip712/digest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/eip712/digest.rs)).
- The Nym transport uses the AEAD, ECDH, hash, and KDF shims for its onion crypto
  ([`userland/capsule_net_nym/src/crypto/aead.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_net_nym/src/crypto/aead.rs#L17), [`net_nym/src/crypto/ecdh.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/net_nym/src/crypto/ecdh.rs),
  [`net_nym/src/crypto/kdf.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/net_nym/src/crypto/kdf.rs)).
- The ramfs store seals and opens its at-rest records through the AEAD shims
  ([`userland/capsule_ramfs/src/store/crypto/seal.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/crypto/seal.rs), [`ramfs/src/store/crypto/open.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ramfs/src/store/crypto/open.rs)).
- The wallet's TLS 1.3 client drives its handshake through the hash, HKDF, and AEAD record shims
  (`userland/capsule_wallet_nonos/src/wallet/tls13/`).

## Security summary and honest gaps

The pool centralizes crypto so a caller needs neither a key nor a crypto crate of its own. The gate is per
request, on the caller pid, on the kernel side, and fails closed. The capsule's mask holds no
`FileSystem`, `Network`, driver, or `Debug` bit, so a compromised crypto crate cannot write, exfiltrate,
reach hardware, or log a plaintext. Its isolation is statelessness: the receive buffer is wiped after
every reply (see [server.md](/docs/userland/crypto/server/)) and the reply endpoint is distinct so replies cannot cross-route.

Honest gaps, none hidden:

- Intermediate parsed key bytes inside a handler (the slice handed to a cipher) are not separately
  zeroized beyond the whole-buffer wipe in the loop, except for the explicit `x25519_shared` scalar wipe;
  they rely on the receive-buffer wipe reaching them.
- There is no rate limiting, so a flood of 1 MiB Ed25519 verifies or AEAD opens is not throttled.
- P-256, P-384, and SHA-384 are implemented in the capsule but have no in-tree kernel client
  ([`client/mod.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/mod.rs#L37)), so no gated caller reaches them yet.
- The capsule mixes RustCrypto crates with hand-written HMAC and HKDF (see [primitives.md](/docs/userland/crypto/primitives/))
  rather than being a single implementation, and it is a separate body of code from the kernel's in-tree
  [crypto stack](/docs/subsystems/crypto/).

## Source map

```
  src/security/crypto_capsule/spawn.rs             spawn_crypto_capsule: verified spawn, requested caps
  src/security/crypto_capsule/capability.rs        gate_hash: per-request CAP_CRYPTO on the caller pid
  src/security/crypto_capsule/client/mod.rs        the fifteen in-tree clients and their re-exports
  src/security/crypto_capsule/client/transport.rs  REPLY_INBOX endpoint.4294967300, the transport lock
  src/security/crypto_capsule/client/hash_op.rs, aead_op/, prf_op.rs, verify_ed25519.rs, healthcheck.rs   the gated paths
  src/capabilities/types.rs                        the capability bits and CAP_CRYPTO
  src/userspace/init/spawn_plan/core.rs            the boot spawn entry for CRYPTO
  userland/libc/src/crypto/                        the nonos_libc crypto shims callers use
```

Every reference above is verified against those trees.
