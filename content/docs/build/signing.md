---
title: "Capsule Signing"
description: "This page describes the capsule signing pipeline: capsule-sign, Capsule.mk, the trust anchor policy, certificate and manifest artifacts, and kernel-side verification."
weight: 3
---
This page describes the capsule signing pipeline: `capsule-sign`,
`Capsule.mk`, the trust anchor policy, certificate and manifest artifacts, and
kernel-side verification. Read [Toolchain](/docs/build/toolchain/) first.

---

## 1. Trust layout

The root Makefile defines trust material under `nonos-data/trust`, with trust
anchor public keys in `keys`, the sealed policy in `policy`, and private seeds
under `.keys` (`Makefile:257`). The sealed policy output is
`nonos-data/trust/policy/nonos_trust_anchor.policy.bin`
(`Makefile:271`). The host signing binary is
`nonos-sign/target/release/capsule-sign` (`Makefile:280`).

The trust policy rule depends on Ed25519 and ML-DSA-65 trust anchor public keys
and runs `capsule-sign mk-trust-policy` with epoch, both public keys, validity
window, and output path (`Makefile:333`).

## 2. Capsule metadata

The shared capsule macro requires every capsule to set slug, binary name,
directory, handle, domain, namespace, service endpoint, reply endpoint, and
required caps before including `nonos-mk/capsule.mk`
(`nonos-mk/capsule.mk:28`). Optional caps default to `0x0`, caps ceiling
defaults to required caps, target defaults to `x86_64-nonos-user`, version
defaults to `0.1.0`, and build std defaults to `core,alloc`
(`nonos-mk/capsule.mk:70`).

The macro writes each capsule binary path under its own target directory, the
NØNOS-ID certificate to `nonos-data/trust/capsules/<bin>.nonos_id_cert.bin`,
and the manifest to `nonos-data/trust/capsules/<bin>.manifest.bin`
(`nonos-mk/capsule.mk:91`).

## 3. Certificate rule

For each capsule, the macro derives `nonos_id` from handle, domain, and
recovery value using `capsule-sign derive-id` (`nonos-mk/capsule.mk:175`). The
certificate rule signs with serial, nonos id, namespace glob, caps ceiling,
trust anchor epoch, validity window, Ed25519 publisher key, ML-DSA-65 publisher
key, Ed25519 trust anchor seed, ML-DSA-65 trust anchor seed, metadata, and
output path (`nonos-mk/capsule.mk:180`).

## 4. Manifest rule

The manifest rule depends on the capsule ELF, certificate, Capsule.mk, and
signing tool. It runs `capsule-sign sign-manifest` with certificate, namespace,
version, target, ELF path, required caps, optional caps, service endpoint, reply
endpoint, Ed25519 publisher seed, ML-DSA-65 publisher seed, and output path
(`nonos-mk/capsule.mk:201`). The same rule verifies the manifest against the
certificate and trust policy before it is considered built
(`nonos-mk/capsule.mk:217`).

```
  +-------------------+
  | Capsule.mk        |
  | identity and caps |
  +---------+---------+
            |
  +-------------------+       +-------------------+
  | capsule ELF       |       | publisher keys    |
  +---------+---------+       +---------+---------+
            |                           |
            +-------------+-------------+
                          |
  +-------------------------------------+
  | capsule-sign sign-id-cert           |
  | capsule-sign sign-manifest          |
  | capsule-sign verify-manifest        |
  +----------------+--------------------+
                   |
  +-------------------------------------+
  | nonos-data/trust/capsules           |
  | <bin>.nonos_id_cert.bin             |
  | <bin>.manifest.bin                  |
  +-------------------------------------+
```

## 5. Kernel embedding and verification

Kernel mirror modules embed the signed outputs with `include_bytes`. The desktop
shell mirror embeds the capsule ELF, certificate, and manifest from their build
and trust locations ([`src/userspace/capsule_desktop_shell/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/embed.rs#L18)).

At spawn, the mirror decodes the baked trust anchor policy and builds a
`CapsuleSpecVerified` with embedded ELF, certificate, manifest, target triple,
service endpoint, reply endpoint, and requested caps
([`src/userspace/capsule_desktop_shell/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/spawn.rs#L36)).

Preflight decodes and verifies the NØNOS-ID certificate, declares the service
and reply endpoints, and verifies the manifest with publisher keys, trust
anchor, ELF, target triple, requested caps, and declared endpoints
([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L29)).
`spawn_verified` installs caps from the verified manifest result and passes that
to process install ([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L26)).

## 6. Security analysis

The signing pipeline is the build-time half of the trust boundary; the kernel's
spawn-time verification is the runtime half, and the two are designed so the
build cannot produce anything the kernel will later accept without the same
evidence the kernel re-checks. Three properties are worth stating plainly.

**The build verifies what it signs, on the same machine that signed it.** The
manifest rule does not stop at signing. After `sign-manifest` it runs
`verify-manifest` against the certificate and the sealed trust policy
(`nonos-mk/capsule.mk:237`), so a capsule that signs but does not verify fails the
build rather than shipping. This closes the gap where a signing bug produces an
artifact that only fails much later, at spawn, on a real boot.

**Two signature algorithms, not one.** Both the certificate and the manifest
carry an Ed25519 and an ML-DSA-65 signature, a classical and a post-quantum
signature over the same material. The kernel's preflight verifies every required
algorithm over the signed region
([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L29)), and both
must pass for a production capsule. A break in one algorithm does not by itself
admit a forged capsule.

**Private seeds never enter the kernel or the committed tree.** The trust anchor
private seeds and the per-capsule publisher seeds live under `.keys`
(`Makefile:488`), separate from the committed public keys, and only the public
material is embedded into the kernel with `include_bytes`. The kernel verifies
against the baked trust anchor policy; it never holds a signing key. This is what
lets the trust anchor be a genuine root: possession of the kernel image does not
grant the ability to mint a capsule the kernel will trust.

The `nonos_id` binding is a fourth, quieter property. Each certificate's identity
is recomputed from handle, domain, and recovery on every sign
(`nonos-mk/capsule.mk:194`), so renaming a certificate file cannot silently
rebind it to a different identity; the identity is derived, not stored and
trusted.

## 7. Troubleshooting

The signing failures worth naming come from missing keys and from the
build-verifies-what-it-signs discipline catching a mismatch.

**Missing publisher key.** Before any capsule signs, `nonos-mk-check-<slug>-keys`
asserts the Ed25519 and ML-DSA-65 seeds and public files exist
(`nonos-mk/capsule.mk:184`). A missing file fails with an explicit
`::error::missing <path>` and the exact `capsule-sign keygen` command to create
it. The certificate and manifest rules take this check as an order-only
prerequisite (`nonos-mk/capsule.mk:222`), so signing never runs against absent
keys.

**Manifest verification fails after signing.** The manifest rule's own
`verify-manifest` step (`nonos-mk/capsule.mk:237`) checks the freshly signed
manifest against the certificate and trust policy. A failure here usually means a
mismatch the build should not ship: a `payload_hash` that no longer matches the
ELF (the manifest depends on the ELF so a rebuild forces a re-sign, but a
hand-edited or stale artifact defeats that), a namespace or caps ceiling outside
what the certificate allows, or a certificate signed under a different trust
anchor epoch than the sealed policy. The fix is to rebuild the capsule cleanly so
the ELF, certificate, and manifest are consistent, not to skip the verify step.

**A kernel that will not build because an embedded artifact is missing.** The
kernel embeds each capsule's certificate and manifest with `include_bytes` from
`nonos-data/trust/capsules/` ([`src/userspace/capsule_desktop_shell/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/embed.rs#L18)).
If a capsule was not signed, those files do not exist and the kernel compile
fails at the `include_bytes`. This is the build-ordering requirement from the
[toolchain](/docs/build/toolchain/) page: sign the capsules before building the kernel that
embeds them.

## 8. Source map

```
  nonos-mk/capsule.mk               the per-capsule cert/manifest sign and verify rules
    :184  check-<slug>-keys         asserts publisher seeds and pubs exist
    :204  sign-id-cert              signs the NØNOS-ID certificate
    :224  sign-manifest             signs the manifest against the cert
    :237  verify-manifest           re-verifies the signed manifest vs cert and policy
  Makefile
    :122  NONOS_TRUST_DIR           the committed trust root nonos-data/trust
    :488  key layout                .keys/ holds private seeds, trust/keys/ the pubs
    :603  mk-trust-policy           seals the trust anchor policy
  src/security/capsule_manifest/    the manifest schema and kernel-side verify
  src/security/nonos_id_cert/       the certificate schema
  src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs   spawn-time verification
```

The build-ordering and signing-key requirements are on the [toolchain](/docs/build/toolchain/)
page, the verify lanes that re-check trust are on the [workflows](/docs/build/workflows/)
page, and the runtime spawn gate these artifacts feed is in the
[architecture overview](/docs/architecture/overview/). Some line numbers in the
prose above predate small Makefile edits; the anchors in this map are verified
against the current `nonos-mk/capsule.mk` and `Makefile`.
