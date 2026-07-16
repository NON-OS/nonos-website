---
title: "The NØNOS-ID Certificate"
description: "The certificate is a capsule publisher's durable identity."
weight: 4
---
The certificate is a capsule publisher's durable identity. Where a
[manifest](/docs/security/manifest-schema/) is a per-build statement that changes every time
the capsule is rebuilt, the certificate is the long-lived root beneath it: it is
signed by the [trust anchor](/docs/security/trust-anchor/), it sets the hard ceiling on the
capabilities any capsule under this identity may ever hold, it names the
namespaces the identity is allowed to use, and it carries the publisher keys that
sign manifests. This page is its exact schema.

The type is `NonosIdCertificate` ([`src/security/nonos_id_cert/schema/cert.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/schema/cert.rs#L26)).
The current schema version is 2 ([`nonos_id_cert/schema/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/schema/constants.rs#L17)).

## The structure

```
  NonosIdCertificate
    schema_version           u16          currently 2
    cert_serial              u64          unique serial, used for revocation
    nonos_id                 [u8; 32]     the publisher identity
    namespace_globs          Vec<NamespaceGlob>   the namespaces authorised
    allowed_caps_ceiling     u64          the hard cap on capabilities
    metadata                 [u8; 256]    free-form publisher metadata
    metadata_len             u16
    valid_from_ms            u64          start of the validity window
    valid_until_ms           u64          end of the validity window
    trust_anchor_epoch       u64          the anchor epoch it was issued under
    publisher_keys           Vec<PublisherKey>          keys that sign manifests
    trust_anchor_signatures  Vec<TrustAnchorSignature>  the anchor's signatures
```

Three fields are the reason the certificate exists. `allowed_caps_ceiling` is the
ceiling that stage two of verified spawn checks the manifest's requested
capabilities against, so no capsule under this identity can ever exceed it,
whatever a manifest asks for. `namespace_globs` limits the namespaces the identity
may publish under. `publisher_keys` are the keys the manifest's own signatures are
checked against. The remaining fields exist to make the certificate itself
verifiable and revocable, covered under verification below.

## The fixed sizes

As with the manifest, every bound is a named constant
([`nonos_id_cert/schema/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/schema/constants.rs)) and every text or key field is a fixed
array with a length, so an untrusted certificate cannot drive an unbounded
allocation:

```
  ID_CERT_SCHEMA_VERSION      2      the version this kernel accepts
  NONOS_ID_LEN               32      the identity length
  PUBLISHER_KEY_ID_LEN       16      a key identifier
  MAX_NAMESPACE_GLOBS         8      at most eight namespace patterns
  MAX_NAMESPACE_GLOB_LEN     96
  MAX_METADATA_LEN          256
  MAX_PUBLISHER_KEYS          4      at most four manifest-signing keys
  MAX_KEYS_PER_ALG            2      at most two keys per algorithm
  MAX_TRUST_ANCHOR_SIGNATURES 4      at most four anchor signatures
```

`MAX_KEYS_PER_ALG` is two rather than one on purpose: it allows a publisher to
carry a current and a next key for the same algorithm so that manifests can be
re-signed onto a new key before the old one is retired, without the certificate
having to be reissued for every rotation.

## What the certificate authorises

The capability ceiling is a plain `u64` compared bitwise. Stage two of spawn
rejects any manifest whose `required | optional` has a bit set outside
`allowed_caps_ceiling` (`caps::check_ceiling`). Because the ceiling lives in the
anchor-signed certificate and not in the manifest, a publisher cannot widen a
capsule's authority by editing a manifest; the manifest can only ask for a subset
of what the certificate already permits.

The namespace is matched by glob, not by equality. `namespace_matches`
(`cert.rs:47`) returns true if any of the certificate's `namespace_globs` matches
the manifest's namespace under `glob_match` ([`nonos_id_cert/schema/glob_match.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/schema/glob_match.rs)),
so a single certificate can authorise a family of namespaces, for example a
publisher's whole reverse-DNS subtree, while still being bounded to it.

```
  NamespaceGlob
    bytes  [u8; 96]    the glob pattern
    len    u8
```

## Publisher keys

The publisher keys are the keys that sign manifests ([`nonos_id_cert/schema/sub.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/schema/sub.rs#L35)):

```
  PublisherKey
    algorithm   AlgId
    key_id      [u8; 16]
    pubkey      [u8; MAX_PUBKEY_BYTES]
    pubkey_len  u16
```

A manifest's `PublisherSignature` names a `key_id`, and manifest verification
looks the matching key up with `publisher_key_by_id` (`cert.rs:51`) rather than
trying every key, then verifies the signature against that key's `pubkey_bytes`.
This is the link between the two schemas: the certificate carries the public keys,
the manifest carries signatures under them, and the certificate is itself signed
by the anchor, so the whole chain reduces to the one key baked into the kernel.

## Trust-anchor signatures

The certificate's own authenticity comes from the anchor
([`nonos_id_cert/schema/sub.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/schema/sub.rs#L49)):

```
  TrustAnchorSignature
    algorithm  AlgId
    sig        [u8; MAX_SIG_BYTES]
    sig_len    u16
```

Stage one of verified spawn checks a `TrustAnchorSignature` under each required
algorithm against the anchor's keys, over the certificate's recomputed signed
region. Production requires both Ed25519 and ML-DSA-65, which is why a certificate
carries more than one anchor signature and `MAX_TRUST_ANCHOR_SIGNATURES` is four.

## The two signing layers

Reading the two schemas together, trust flows down exactly two signature layers,
and the kernel trusts only the bottom of them a priori:

```
  trust anchor (baked into the kernel)
      signs -> NØNOS-ID certificate            (trust_anchor_signatures)
                   carries publisher_keys, allowed_caps_ceiling, namespace_globs
                   signs -> capsule manifest    (publisher_signatures)
                                binds payload_hash -> the ELF
```

## What verification reads

Stage one ([`nonos_id_cert/verify/checks.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/verify/checks.rs)) reads `trust_anchor_epoch` to reject
a certificate issued under a policy epoch older than the anchor's current one,
reads `cert_serial` and `nonos_id` against the anchor's revocation lists, and
reads `valid_from_ms` and `valid_until_ms` against the supplied time. Only after
those pass does it verify the `trust_anchor_signatures`. The verified output is a
small copy carrying just the three fields the rest of spawn needs:

```
  VerifiedNonosId
    nonos_id              [u8; 32]
    cert_serial           u64
    allowed_caps_ceiling  u64
```

The full pipeline that consumes this is the [verified-spawn
gate](/docs/security/capsules-and-trust/); the anchor it verifies against is the [trust
anchor](/docs/security/trust-anchor/); the manifest it authorises is the [manifest
schema](/docs/security/manifest-schema/).

## Debugging a certificate rejection

Every certificate failure is an `IdCertVerifyError`
([`src/security/nonos_id_cert/error.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/error.rs#L44)), and at the loader it collapses to the
single reason `id_cert` on the `[RUNTIME-LOAD] FAILED` line, so the reason string
alone does not tell you which check fired. The variant does, and the two decode
paths are worth separating.

A structural rejection is an `IdCertDecodeError` wrapped in `Decode` and comes from
the bounded decoder refusing a malformed certificate: `SchemaVersion` when the
`schema_version` is not the `2` this kernel accepts, `NamespaceGlobCount` or
`PublisherKeyCount` or `TrustAnchorSignatureCount` when a vector exceeds its named
maximum (`MAX_NAMESPACE_GLOBS`, `MAX_PUBLISHER_KEYS`, `MAX_TRUST_ANCHOR_SIGNATURES`),
`PublisherKeysPerAlg` when one algorithm carries more than the two keys
`MAX_KEYS_PER_ALG` allows, and `PubkeyLen` or `SigLen` when a key or signature does
not have the length its algorithm requires. These mean the certificate is the wrong
shape, not that its signature is wrong, and they are the errors to expect from a
truncated or hand-edited certificate blob.

A policy rejection is one of the verification variants and each names a real state:
`EpochStale` for a certificate issued under an anchor epoch older than the current
one (a rollback), `Revoked` and `NonosIdRevoked` for a serial or publisher identity
on an anchor list, `NotYetValid` and `Expired` for a time outside the validity
window, `TrustAnchorPolicy` when no anchor key exists for the required algorithm,
and `TrustAnchorBadSig(alg)` when a signature under that algorithm did not verify.
The order of these is fixed in `checks::run` and the epoch, revocation, and time
checks all run before any signature ([`verify/checks.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/verify/checks.rs#L22)), so a `Revoked` or
`EpochStale` is decided without the cost of the anchor signature verify, and seeing
one does not imply the signature was even reached. `TrustAnchorBadSig` is the one
that means a well-formed, in-window, unrevoked certificate simply carried a
signature that did not check out against any anchor key for that algorithm, which
is the genuine "wrong key or tampered bytes" case.

## Source map

```
  src/security/nonos_id_cert/schema/cert.rs       NonosIdCertificate, VerifiedNonosId
  src/security/nonos_id_cert/schema/constants.rs  the schema version and bounds
  src/security/nonos_id_cert/schema/sub.rs        NamespaceGlob, PublisherKey, TrustAnchorSignature
  src/security/nonos_id_cert/schema/glob_match.rs the namespace glob matcher
  src/security/nonos_id_cert/verify/checks.rs     epoch, revocation, validity
  src/security/nonos_id_cert/verify/dispatch.rs   the per-algorithm anchor signature check
  src/security/nonos_id_cert/error.rs             IdCertDecodeError and IdCertVerifyError
```

The anchor these signatures reduce to is the [trust anchor](/docs/security/trust-anchor/); the
pipeline that maps these errors onto the `[RUNTIME-LOAD] reason=id_cert` line is on
the [verified spawn](/docs/security/capsules-and-trust/) page.
