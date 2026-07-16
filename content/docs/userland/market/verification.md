---
title: "The verification path"
description: "This page mirrors src/verify/, src/ingest/, and src/bootstraptrust/: the trait that abstracts signature checking, its two implementations and the compile-time swap between them,..."
weight: 3
---
This page mirrors `src/verify/`, `src/ingest/`, and `src/bootstrap_trust/`: the trait that abstracts
signature checking, its two implementations and the compile-time swap between them, the trusted-operator
gate that runs before any signature is checked, the monotonic-serial check, and the per-release publisher
signatures. This is the pillar the whole capsule turns on, so it is careful about the difference between a
build that verifies signatures and one that verifies nothing. For where the pipeline is invoked and how its
errors become errnos, see `LOAD_INDEX` on the [protocol](/docs/userland/market/protocol/) page.

## The verifier trait

Signature checking is a small trait. `Verifier::verify` takes signed bytes, a signature, and a 32-byte
pubkey and returns `Verdict::Accepted` or `Verdict::Refused` ([`src/verify/trait_def.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/trait_def.rs#L23),
`trait_def.rs:17`). One trait object verifies both the operator signature on the index and every publisher
signature on a release, so whichever implementation the build selected governs both at once.

Two implementations exist.

`CryptoVerifier` is the real one. It refuses any signature that is not 64 bytes, then calls
`crypto_ed25519_verify` through `nonos_libc` over the signed bytes, the signature, and the pubkey,
accepting only when the return code is `0` ([`src/verify/crypto.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/crypto.rs#L26), `crypto.rs:28`, `crypto.rs:37`). The
`crypto_ed25519_verify` call is routed by the kernel to `capsule_crypto` through the `CryptoEd25519Verify`
syscall path. That routing is why the market needs no Crypto capability of its own: the crypto authority
lives behind that boundary, not in this capsule (`Capsule.mk:2`, [`src/security/market_capsule/spawn.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/market_capsule/spawn.rs#L17)).

`RejectAll` is the stub. Its `verify` returns `Verdict::Refused` unconditionally, ignoring its arguments
([`src/verify/reject_all.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/reject_all.rs#L22)).

## The compile-time swap

The choice between the two is made at compile time, not at runtime, and the capability mask is identical
between the two builds. The default build has no features enabled (`Cargo.toml:29`). `main.rs` selects
`CryptoVerifier` unless the `offline-verify` feature is set, in which case it selects `RejectAll`
([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34), [`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)). The `RejectAll` module itself is compiled only under that feature
([`src/verify/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/mod.rs#L18), `mod.rs:23`), so a default build does not even contain the stub.

An `offline-verify` build therefore refuses every index and serves nothing, because `RejectAll::verify`
returns `Refused` for the operator signature and `load_verified` turns that into `SignatureRefused`
([`src/verify/reject_all.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/reject_all.rs#L22), [`src/ingest/load/load_verified.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingest/load/load_verified.rs#L42)). That is intentional. The feature
comment states the stub keeps install readiness honest on a kernel image that does not embed
`capsule_crypto`, rather than silently accepting unsigned material (`Cargo.toml:30`). It is a development
build only. The honest reading is that an `offline-verify` build cannot verify a single signature and has
the same authority posture as a production one; the only difference is that it refuses every index rather
than accepting a valid one.

## The ingest pipeline

`load_verified` runs the gate in a fixed order, and each stage is a distinct refusal
([`src/ingest/load/load_verified.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingest/load/load_verified.rs#L25)):

1. Decode the blob with the marketplace ABI. A decode failure is `Malformed`
   (`load_verified.rs:30`). The ABI decoder also carves out the exact byte range the operator signs, the
   `signed_bytes`, which is everything from the schema version through the last entry, before the trailing
   signature ([`userland/marketplace_abi/src/codec/decode_index.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/marketplace_abi/src/codec/decode_index.rs#L56), `decode_index.rs:57`).
2. Reject a non-monotonic serial. If the new serial is at or below the last accepted serial and a prior
   index exists, that is `StaleSerial` (`load_verified.rs:31`). The first load, against a stored serial of
   `0`, is always allowed, because `last_serial != 0` is part of the condition.
3. Reject an untrusted operator key. The index's `operator_pubkey` must be one of the baked trusted
   operators, else `UntrustedOperator` (`load_verified.rs:34`). This runs before the signature is checked,
   so a stranger's key is refused regardless of how well-formed its signature is.
4. Run the operator signature through the verifier over the decoded `signed_bytes`; anything but `Accepted`
   is `SignatureRefused` (`load_verified.rs:37`, `load_verified.rs:42`).
5. Verify each release's publisher signature and record a per-release boolean vector, then return the
   `Verified` value with `signature_verified: true` (`load_verified.rs:45`, `load_verified.rs:46`).

The four ingest errors ([`src/ingest/error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingest/error.rs#L17)) are what `LOAD_INDEX` maps onto errnos. `SignatureRefused`
and `UntrustedOperator` both surface as `E_KEYREJECTED`, so a caller sees one errno for both "the key is not
trusted" and "the signature did not verify" ([`src/server/handlers/load_index.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_index.rs#L42), `load_index.rs:43`).

## The trusted-operator gate

The trusted set is a compiled-in constant, not configuration. `is_trusted` returns true only if the key
equals one of the baked operators ([`src/bootstrap_trust/check.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap_trust/check.rs#L19)), and there is a single current
operator, `NOX_OPERATOR_V1`, a 32-byte Ed25519 public key ([`src/bootstrap_trust/keys.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap_trust/keys.rs#L17),
`keys.rs:22`). Because this gate runs at step 3, before step 4's signature check, the operator gate is the
first thing an index has to pass, and an untrusted key never reaches the verifier at all.

## Publisher signatures

Each release carries its own publisher signature, checked at ingest against the enclosing entry's publisher
key ([`src/ingest/load/verify_publisher_signatures.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingest/load/verify_publisher_signatures.rs#L25)). For each release the check is conservative: a
publisher key that is all zero, or a signature that is not 64 bytes, counts as unverified rather than
trusted, without calling the verifier at all (`verify_publisher_signatures.rs:32`). Otherwise it builds the
canonical release signing bytes and runs them through the same trait object
(`verify_publisher_signatures.rs:37`, `verify_publisher_signatures.rs:38`). The canonical bytes are a
domain-separated encoding of the release id, both hashes, the package url, the supported arches, the
kernel-abi minimum, and the required capabilities, under the domain tag `NØNOS.marketplace.release.v1`
([`userland/marketplace_abi/src/codec/release_signing.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/marketplace_abi/src/codec/release_signing.rs#L28), `release_signing.rs:30`).

The result is a flat `Vec<bool>`, one entry per release in entry-then-release order
(`verify_publisher_signatures.rs:29`, `verify_publisher_signatures.rs:41`). It is computed once at ingest
and stored, then read back per query rather than re-verified on each call, so it reflects the state at load
time. Because the same trait object verifies both operator and publisher signatures, an `offline-verify`
build disables both at once: every publisher flag comes back false along with the refused operator
signature.

## What the gate does and does not defend

The gate is layered and each layer refuses a different attack. The trusted-operator constant stops a
stranger's index before any signature math. The signature check stops a tampered index under a trusted
key. The monotonic serial stops a rollback to an older, weaker index once a newer one has been accepted.
The per-release publisher check binds each artifact to its publisher's key independently of the operator.

Two honest limits. First, the verifier is swapped at compile time, and an `offline-verify` build verifies
nothing ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), [`src/verify/reject_all.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/reject_all.rs#L22)). Second, the publisher flags are computed once at
ingest and read back per query, not re-verified on each `install_ready` call
([`src/ingest/load/verify_publisher_signatures.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingest/load/verify_publisher_signatures.rs#L25)). Neither is an authority gap; both are properties of
when and how the trusted-path check runs.

## Source map

```
  userland/capsule_market/src/verify/trait_def.rs                    the Verifier trait and Verdict
  userland/capsule_market/src/verify/crypto.rs                       the real Ed25519 verifier (routes to capsule_crypto)
  userland/capsule_market/src/verify/reject_all.rs                   the offline-verify reject-all stub
  userland/capsule_market/src/verify/mod.rs                          the feature-gated module wiring
  userland/capsule_market/src/main.rs                                the compile-time verifier selection
  userland/capsule_market/src/ingest/load/load_verified.rs           decode + serial + trust + signature + publisher pipeline
  userland/capsule_market/src/ingest/load/verify_publisher_signatures.rs  per-release publisher signature check
  userland/capsule_market/src/ingest/error.rs                        the four ingest errors
  userland/capsule_market/src/bootstrap_trust/check.rs               the trusted-operator test
  userland/capsule_market/src/bootstrap_trust/keys.rs                the baked trusted operator keys
  userland/capsule_market/Cargo.toml                                 the offline-verify feature and its comment
  userland/marketplace_abi/src/codec/decode_index.rs                 the signed-bytes range the operator signs
  userland/marketplace_abi/src/codec/release_signing.rs              the canonical publisher signing bytes
```

Every reference above is verified against those trees.
