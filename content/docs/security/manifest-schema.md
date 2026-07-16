---
title: "The Capsule Manifest"
description: "The manifest is the per-build statement of what a capsule is and what it needs."
weight: 3
---
The manifest is the per-build statement of what a capsule is and what it needs.
It names the certificate it belongs to, pins the exact bytes of the ELF it
authenticates, declares the capabilities the capsule requires and may optionally
receive, and carries the publisher signatures that make all of it trustworthy. It
is the signed input to stage two of the [verified-spawn
gate](/docs/security/capsules-and-trust/); this page is its exact schema, field by field, with
the on-wire sizes and the verification step that reads each one.

The type is `CapsuleManifest` ([`src/security/capsule_manifest/schema/manifest.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/schema/manifest.rs#L29)).
The current schema version is 3 ([`schema/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/schema/constants.rs#L17)).

## The structure

```
  CapsuleManifest
    schema_version        u16          currently 3
    nonos_id_cert_id      [u8; 32]     identifies the certificate this
                                       manifest is bound to
    namespace             [u8; 96]     the capsule namespace, e.g. a
    namespace_len         u8             reverse-DNS name; len bytes are live
    version               Version       major, minor, patch, each u32
    target_triple         [u8; 64]     the build target, e.g. the capsule
    target_triple_len     u8             user target; len bytes are live
    payload_hash          [u8; 32]     BLAKE3 of the ELF payload
    required_caps         u64          capabilities the capsule must receive
    optional_caps         u64          capabilities it may receive if granted
    endpoints             Vec<EndpointDecl>        the IPC ports it serves
    publisher_signatures  Vec<PublisherSignature>  signatures over the above
```

Every variable-length text field is a fixed-size byte array paired with a length
byte, never a heap string. `namespace` is ninety-six bytes with a `namespace_len`
that says how many are meaningful, and `target_triple` is sixty-four bytes with a
`target_triple_len`. This is the shape a `no_std` kernel wants from an untrusted
input: the maximum on-wire size of the field is fixed and known, the decoder
never allocates on the strength of a length in the input, and reading the text
back is a bounded slice (`namespace_str`, `target_triple_str`, which return an
empty string rather than panic on invalid UTF-8, `manifest.rs:45`).

## The fixed sizes

Every bound in the manifest is a named constant ([`schema/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/schema/constants.rs)), so the
schema has no magic numbers and the decoder and the writer agree by construction:

```
  MANIFEST_SCHEMA_VERSION    3      the version this kernel accepts
  NONOS_ID_CERT_ID_LEN      32      the cert-binding id
  PAYLOAD_HASH_LEN          32      the ELF hash
  PUBLISHER_KEY_ID_LEN      16      a publisher key identifier
  MAX_NAMESPACE_LEN         96
  MAX_TARGET_TRIPLE_LEN     64
  MAX_ENDPOINTS             16      at most sixteen declared endpoints
  MAX_ENDPOINT_NAME_LEN     48
  MAX_PUBLISHER_SIGNATURES   4      at most four signatures
```

`MAX_ENDPOINTS` and `MAX_PUBLISHER_SIGNATURES` bound the two variable-length
vectors, so a manifest cannot force the decoder to build an unbounded structure.
The decode path (`src/security/capsule_manifest/decode/`) enforces these limits
as it parses; a manifest that declares more than the maximum of either is
rejected rather than truncated.

## Endpoints

An endpoint declaration is how a capsule states, in advance and under signature,
which IPC ports it will serve and reply on ([`schema/endpoint.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/schema/endpoint.rs#L41)):

```
  EndpointDecl
    kind      EndpointKind    Service (1) or Reply (2)
    port      u32             the port number
    name      [u8; 48]        the endpoint name
    name_len  u8
```

`EndpointKind` is a `repr(u8)` enum with exactly two values, `Service = 1` and
`Reply = 2`, and `from_u8` returns `None` for anything else (`endpoint.rs:27`), so
a byte that is not one of the two known kinds does not decode to a valid endpoint.
The declared set matters at spawn: the verified-spawn pipeline checks that every
endpoint the spawn site asks the kernel to register appears in this list
(`endpoint_drift::check`), so a capsule cannot quietly open a port it did not
declare in its signed manifest.

## Publisher signatures

The signatures are what make everything above trustworthy
([`schema/publisher_sig.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/schema/publisher_sig.rs#L22)):

```
  PublisherSignature
    algorithm  AlgId          the signature algorithm
    key_id     [u8; 16]       which publisher key signed
    sig        [u8; MAX_SIG_BYTES]
    sig_len    u16            live bytes of sig
```

The signature bytes are again a fixed array with a length, sized to the largest
signature any supported algorithm produces (`MAX_SIG_BYTES` from
`crypto/asymmetric/alg_id`), with `sig_len` giving the real length for the chosen
algorithm; `sig_bytes()` returns just the live prefix. The `key_id` names which of
the certificate's publisher keys produced the signature, so verification can look
up the right key rather than trying all of them. Production requires a signature
under each of two algorithms, Ed25519 and ML-DSA-65, so a valid manifest carries
at least two `PublisherSignature` entries, which is why `MAX_PUBLISHER_SIGNATURES`
is four rather than one: room for both algorithms and for key rotation.

## What the signatures cover

The publisher signatures sign the manifest, but not themselves. Before verifying
them the pipeline recomputes the exact byte range they cover with
`signed_region::compute` ([`capsule_manifest/verify/signed_region.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_manifest/verify/signed_region.rs)), which
walks the manifest structure to find the boundary rather than trusting a length
in the input, and that region is the manifest content up to but excluding the
`publisher_signatures`. Every field in the table above other than the signatures
themselves is therefore authenticated: change the namespace, the caps, the
payload hash, or an endpoint, and the signatures no longer verify.

## Which field each check reads

The manifest exists to be verified, and each field is the input to a specific
step of stage two of the [spawn pipeline](/docs/security/capsules-and-trust/):

```
  nonos_id_cert_id       cert_binding::check    binds the manifest to its cert
  namespace              namespace::check       within the cert's globs
  required/optional_caps caps::check_ceiling    within the cert ceiling
                         caps::check_grant       and the installed set
  publisher_signatures   dispatch::run           verified over the signed region
  payload_hash           payload::check          equals BLAKE3 of the ELF
  target_triple          target_triple::check    matches this kernel
  endpoints              endpoint_drift::check   cover what spawn registers
```

The result of a successful verification is a `VerifiedManifest`, the manifest
plus a deterministic 32-byte `capsule_id` derived from it (`manifest.rs:57`,
`capsule_id::derive`). The certificate the manifest binds to has its own schema,
covered on the [certificate page](/docs/security/certificate-schema/); the capability bitmasks
are the [capability set](/docs/security/capabilities-and-tokens/).

## Debugging a manifest rejection

Every manifest failure is a `ManifestVerifyError`
([`src/security/capsule_manifest/error.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/error.rs#L45)), and unlike the certificate, the
loader maps its variants to distinct `[RUNTIME-LOAD] FAILED reason=` strings
([`from_vfs/load.rs:85`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/from_vfs/load.rs#L85)), so the reason string on its own separates most cases.

A structural rejection is a `Decode` wrapping a `ManifestDecodeError` and shows as
`reason=manifest:decode`. The decoder refuses a manifest whose shape is wrong before
any check reads its fields: `SchemaVersion` when the version is not the `3` this
kernel accepts, `NamespaceLen` or `TargetTripleLen` when a length byte exceeds its
fixed array, `EndpointCount` or `PublisherSignatureCount` when a vector passes
`MAX_ENDPOINTS` or `MAX_PUBLISHER_SIGNATURES`, `EndpointKind(b)` when a byte is
neither `Service` nor `Reply`, `DuplicateEndpoint` for a repeated declaration, and
`SigLen { expected, got }` when a signature does not have its algorithm's length.
These are the errors a truncated or edited manifest produces.

The verification variants are the interesting ones and each maps to its own reason.
A signature problem is `PublisherBadSig(alg)`, `reason=manifest:pub_sig`: the
manifest bytes up to the signatures verified as the wrong shape or were tampered,
since `signed_region::compute` recomputes the covered range and a change to any
authenticated field breaks the check. `PublisherKeyRevoked` (`reason=manifest:pub_revoked`)
and `PublisherPolicy` (`reason=manifest:pub_policy`) are the key being on an anchor
list or missing from the certificate, not a bad signature. A capability problem is
`CapsExceedCeiling` (`reason=manifest:caps_ceiling`), the manifest asking for a bit
outside the certificate's ceiling, or `GrantOutsideManifest` (`reason=manifest:grant`),
the spawn site granting a bit the manifest never declared. A binding problem is
`NonosIdCertIdMismatch` (`reason=manifest:id_mismatch`), the manifest presented
against a certificate it does not name, or `NamespaceOutsideCert`
(`reason=manifest:namespace`). And the two that catch a mismatch with the running
system are `PayloadHashMismatch` (`reason=manifest:payload_hash`), where
`BLAKE3(elf)` did not equal the manifest's `payload_hash`, and
`TargetTripleMismatch` (`reason=manifest:target`), and `EndpointDeclDrift`
(`reason=manifest:endpoint`), where the spawn site tried to register a port the
manifest did not declare.

`PayloadHashMismatch` is the one to reach for first when a capsule was rebuilt: the
ELF changed but the manifest still pins the old hash, so a signed manifest that once
matched no longer binds these bytes. That is distinct from `PublisherBadSig`, which
means the manifest structure itself did not authenticate; the two are easy to
confuse and the reason string tells them apart.

## Source map

```
  src/security/capsule_manifest/schema/manifest.rs      CapsuleManifest, VerifiedManifest
  src/security/capsule_manifest/schema/constants.rs     the schema version and bounds
  src/security/capsule_manifest/schema/endpoint.rs      EndpointDecl, EndpointKind
  src/security/capsule_manifest/schema/publisher_sig.rs PublisherSignature
  src/security/capsule_manifest/schema/version.rs       Version
  src/security/capsule_manifest/decode/                 the bounded decoder
  src/security/capsule_manifest/verify/signed_region.rs the signed byte range
  src/security/capsule_manifest/error.rs                ManifestDecodeError, ManifestVerifyError
  src/kernel_core/process_spawn/capsule_spawn/from_vfs/load.rs  the reason= mapping per variant
```

The pipeline that runs each check in order is on the
[verified spawn](/docs/security/capsules-and-trust/) page; the certificate whose keys and
ceiling these checks read is on the [certificate page](/docs/security/certificate-schema/).
