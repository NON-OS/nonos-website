---
title: "Security"
description: "How NØNOS decides what code may run and what running code may do."
weight: 30
---
How NØNOS decides what code may run and what running code may do. Start with the
[security model](/docs/security/security-model/): the whole story on one page, the threat model, the end-to-end
trust chain, the isolation guarantees, what is machine-checked, and the honest boundaries. This section
then divides into two halves of that story: admission, the pipeline that verifies a capsule before it
becomes a process, and enforcement, the authority a capsule holds afterward and how every syscall is
checked against it. Read the admission pages first, since the capabilities a capsule holds are the
output of the admission pipeline.

## Admission

Everything that decides whether a capsule is allowed to run, and with what
authority, before a single instruction of it executes.

| Page | What it covers |
|------|----------------|
| [capsules-and-trust.md](/docs/security/capsules-and-trust/) | The capsule as an artifact, the baked trust anchor, and the exact ordered verified-spawn pipeline: certificate against the anchor, then manifest against the certificate, then the capability math and the attestation gate. |
| [manifest-schema.md](/docs/security/manifest-schema/) | Every field of the `CapsuleManifest`, the fixed sizes, the endpoint and publisher-signature sub-schemas, what the signatures cover, and which verification step reads each field. |
| [certificate-schema.md](/docs/security/certificate-schema/) | Every field of the NØNOS-ID certificate, the capability ceiling and namespace globs, the publisher keys that sign manifests, and the two signing layers from anchor to certificate to manifest. |
| [trust-anchor.md](/docs/security/trust-anchor/) | The baked, non-optional anchor policy, its signing keys and their windows, the epoch anti-rollback, the three revocation lists, and exactly what it enforces on a certificate. |
| [attestation.md](/docs/security/attestation/) | The zero-knowledge attestation gate, its feature-gated enforcement, the `NZKCAPS2` trailer format, and what the enrolled-secret proof binds. |

## Enforcement

The authority a running capsule holds, how it is authenticated, how it is passed
on, and how it is withdrawn.

| Page | What it covers |
|------|----------------|
| [capabilities-and-tokens.md](/docs/security/capabilities-and-tokens/) | The twenty-two capability bits, the driver-broker layering and the `Admin` super-grant, the capability token and its bindings, the syscall-to-capability table, and the ordered resolve chain. |
| [signing-and-mac.md](/docs/security/signing-and-mac/) | The per-boot signing key, the 128-byte MAC material and the two-pass keyed BLAKE3, the mint and sign and verify paths, the boot-session nonce, and the constant-time comparison. |
| [delegation.md](/docs/security/delegation/) | The `Delegation` structure, the subset and expiry rules enforced at creation, the domain-separated MAC, the three verification entry points, and every error. |
| [revocation.md](/docs/security/revocation/) | The four scopes of revocation: the per-boot key and nonce, the per-process epoch, the per-token revoked set, and the anchor lists, with where each takes effect. |

## Sources

The code behind this section lives under `src/security/` (the capsule manifest,
the NØNOS-ID certificate, the trust anchor, and the attestation trailer),
`src/capabilities/` (the capability bits, tokens, and delegation),
`src/kernel_core/process_spawn/` (the spawn runner), and `src/crypto/` (the
signature, hash, and constant-time primitives). Every page is verified against
those trees with `file:line` references.
