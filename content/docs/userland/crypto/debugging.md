---
title: "Debugging capsule_crypto"
description: "This page lists the boot marker the crypto pool emits, the request-time status codes and what each maps to, and where a denial actually comes from."
weight: 6
---
This page lists the boot marker the crypto pool emits, the request-time status codes and what each maps
to, and where a denial actually comes from. For the shape of the service see the [README](/docs/userland/crypto/), the
[operation reference](/docs/userland/crypto/operations/), the [server loop](/docs/userland/crypto/server/), the [primitives](/docs/userland/crypto/primitives/), and
the [kernel seam](/docs/userland/crypto/transport/) pages in this folder.

## Log marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[CRYPTO] capsule spawned` from the capsule boot path: the `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the capsule never started, and the `Err` arm
logged an `[ERROR]` line through `boot_log::error` instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)),
which is the usual signature, manifest, or capability failure. A present marker means `crypto_pool`
resolves on port 4102, so callers such as the [market](/docs/userland/market/) can reach it.

The capsule itself is silent after that: it holds no `Debug` capability, so it never logs a request or a
plaintext (mask on the [README](/docs/userland/crypto/), `Capsule.mk:16`). All request-time diagnosis is by the status
code in the reply.

## Request-time status codes

Because the pool is stateless, its failure signatures map cleanly to cause ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

- `EMSGSIZE` (-90) is an oversize input against a per-op cap: 64 KiB for the hashes, 1 MiB for an AEAD
  body or an Ed25519 message, or an out-of-range HKDF `out_len` (`sha256_hash.rs:24`,
  `ed25519_verify.rs:43`, `hkdf_sha256.rs:29`).
- `EINVAL` (-22) is a malformed frame: a short AEAD header, an over-large `aad_len`, a malformed Ed25519
  public key, an X25519 key of the wrong length, a wrong-length ECDSA payload, an HKDF length-field
  mismatch, or a degenerate all-zero AES-GCM nonce ([`aead_frame/common.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aead_frame/common.rs#L30), `ed25519_verify.rs:49`,
  `x25519_public.rs:23`, `hkdf_sha256.rs:49`, `aes256_gcm_seal.rs:41`). An unknown opcode is also `EINVAL`
  (`dispatch.rs:47`), as is any frame the decoder rejects for bad magic, version, or length
  (`runner.rs:39`).
- `EBADMSG` (-74) is a verification that did not pass: an Ed25519 or ECDSA signature that did not check,
  or an AEAD open whose tag did not authenticate (`ed25519_verify.rs:65`, `aes256_gcm_open.rs:46`).
- `EIO` (-5) is an AEAD seal failure returned by the cipher (`aes256_gcm_seal.rs:49`).

## Failure modes

### A verify returns EBADMSG

The one worth recognizing is `EBADMSG` on a verify. Because verification returns a status and no body, a
failing verify is a clean boolean-shaped answer, so a market install that reports a key rejection traces
back through the `ED25519_VERIFY` op returning `EBADMSG` on the index signature; the market maps `rc != 0`
to `Verdict::Refused` ([`userland/capsule_market/src/verify/crypto.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/verify/crypto.rs#L31)). This is not a capsule bug; it is
the signature genuinely not checking against the supplied key and message.

### A caller sees AccessDenied instead of a wire status

If a caller sees `AccessDenied` rather than any NOCX status, the failure is upstream of the capsule: the
kernel client's `gate_hash` rejected the caller pid for lacking `CAP_CRYPTO`, and no frame was ever sent
([`src/security/crypto_capsule/capability.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/capability.rs#L28)). The fix is a capability grant on the caller, not a change
to the capsule. See the [kernel seam](/docs/userland/crypto/transport/) page for the gate.

### An op returns EINVAL that should exist

Three ops are implemented in the capsule but have no in-tree kernel client: P-256, P-384, and SHA-384
([`src/security/crypto_capsule/client/mod.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/client/mod.rs#L37)). A caller cannot reach them through a shim today, so the
symptom is not a wire `EINVAL` but the absence of any `nonos_libc` entry point. Wiring one is the fifth
step in [contributing.md](/docs/userland/crypto/contributing/).

### The pool is unreachable

If `crypto_pool` does not resolve, confirm the boot marker above printed. An absent marker means the
capsule failed verified spawn, and the `[ERROR]` line names the mapped `SpawnError`
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The boot spawn entry for CRYPTO is [`spawn_plan/core.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/core.rs#L60).

## Source map

```
  src/userspace/init/capsule_boot/run.rs           [CRYPTO] capsule spawned / the error path
  src/sys/boot_log/output.rs                       boot_log::ok / error formatting
  userland/capsule_crypto/src/protocol/errno.rs    EIO EINVAL EBADMSG EMSGSIZE
  userland/capsule_crypto/src/server/runner.rs     decode-error EINVAL reply
  userland/capsule_crypto/src/server/dispatch.rs   unknown-op EINVAL
  userland/capsule_crypto/src/server/handlers/     the per-op status mappings cited above
  src/security/crypto_capsule/capability.rs        gate_hash AccessDenied upstream of the capsule
  src/security/crypto_capsule/client/mod.rs        the fifteen in-tree clients; the three ops without one
  userland/capsule_market/src/verify/crypto.rs     a real EBADMSG-on-verify caller
```

Every reference above is verified against those trees.
