---
title: "The Trust Anchor"
description: "Every signature the kernel checks reduces, in one or two steps, to the trust anchor."
weight: 5
---
Every signature the kernel checks reduces, in one or two steps, to the trust
anchor. A capsule manifest is signed by a publisher key; that key lives in a
certificate; the certificate is signed by the anchor. The anchor is the one thing
the kernel trusts without deriving that trust from something else, so it is baked
into the kernel image at build time and cannot be changed at runtime. This page
describes how it is baked in, its exact schema, and precisely what it enforces on
a certificate.

## Baked in, and not optional

The anchor is a policy blob compiled into the kernel
([`src/security/nonos_trust_anchor/baked.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_trust_anchor/baked.rs#L22)):

```
  pub const BAKED_TRUST_ANCHOR_POLICY: &[u8] =
      include_bytes!(".../nonos-data/trust/policy/nonos_trust_anchor.policy.bin");
```

The type is a `&[u8]`, not an `Option<&[u8]>`, and the source explains the choice:
a missing policy file must break the build rather than be papered over with a
`None` or an empty slice, because either would leave a path where an unverified
capsule could take over at runtime. There is no configuration, environment
variable, or file read that can substitute a different anchor. Updating the anchor
means replacing the committed policy blob and rebuilding the kernel, which is the
point: the root of trust is fixed for the life of a build.

## The policy

The parsed anchor is `NonosTrustAnchorPolicy`
([`src/security/nonos_trust_anchor/schema.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_trust_anchor/schema.rs#L47)). The current schema version is 1:

```
  NonosTrustAnchorPolicy
    schema_version              u16                   currently 1
    trust_anchor_epoch          u64                   the current policy epoch
    keys                        Vec<TrustAnchorKey>   the anchor signing keys
    revoked_cert_serials        Vec<u64>              revoked certificate serials
    revoked_nonos_ids           Vec<[u8; 32]>         revoked publisher identities
    revoked_publisher_key_ids   Vec<[u8; 16]>         revoked manifest-signing keys
    flags                       u32                   reserved
```

The bounds are named constants (`schema.rs:23`): at most four anchor keys, and
revocation lists of up to 256 certificate serials, 64 identities, and 256
publisher key ids. As everywhere in the security schemas, the caps mean a decoded
anchor cannot force an unbounded structure.

## The keys

An anchor key is a public key with its own validity window
(`schema.rs:32`):

```
  TrustAnchorKey
    algorithm     AlgId
    pubkey        [u8; MAX_PUBKEY_BYTES]
    pubkey_len    u16
    valid_from_ms u64
    valid_until_ms u64
```

Certificate verification selects the keys for a given algorithm with `keys_for`
(`schema.rs:70`) and checks a certificate's anchor signature against them. Because
each key carries its own window, an anchor can roll a signing key without a new
schema: publish the next key with a future `valid_from_ms`, keep the current one
until its `valid_until_ms`, and certificates signed in either period verify. The
policy holds up to four keys, enough for both production algorithms with a
rotation key in reserve for each.

## The epoch and anti-rollback

`trust_anchor_epoch` is the mechanism that retires old certificates in bulk. Each
certificate records the epoch it was issued under, and certificate verification
rejects any certificate whose epoch is behind the anchor's current one
([`nonos_id_cert/verify/checks.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/verify/checks.rs#L27)):

```
  if cert.trust_anchor_epoch < policy.trust_anchor_epoch:
      return EpochStale
```

Raising the anchor epoch in a new build therefore invalidates every certificate
issued under a lower epoch at once, without needing to list each one in a
revocation set. It is the anchor-level counterpart of the token revocation epoch
described on the [capabilities page](/docs/security/capabilities-and-tokens/): one number
retires a whole generation.

## Revocation

Between epoch bumps, the anchor revokes individual actors through three lists,
each with a direct membership test (`schema.rs:57`):

```
  cert_serial_revoked(serial)          a specific certificate, by serial
  nonos_id_revoked(id)                 a whole publisher identity
  publisher_key_id_revoked(key_id)     a specific manifest-signing key
```

The first two are consulted during certificate verification (below); the third is
consulted when a manifest's publisher signature is checked, so a leaked
manifest-signing key can be disabled without revoking the certificate that
carries it.

## What it enforces on a certificate

The anchor's decisions on a certificate are the whole of `checks::run`
([`nonos_id_cert/verify/checks.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/verify/checks.rs#L22)), in this order:

```
  1  cert.trust_anchor_epoch < policy.trust_anchor_epoch    -> EpochStale
  2  policy.cert_serial_revoked(cert.cert_serial)           -> Revoked
  3  policy.nonos_id_revoked(cert.nonos_id)                 -> NonosIdRevoked
  4  if now_ms given:
         now < cert.valid_from_ms                           -> NotYetValid
         now >= cert.valid_until_ms                         -> Expired
```

These run before any signature is checked, so a stale, revoked, or out-of-window
certificate is rejected cheaply, without spending the cost of the anchor signature
verification. The time checks apply only when a timestamp is supplied; a spawn
path that has no trusted clock yet passes `None` and skips them, relying on the
epoch and revocation checks and the signatures. Only after all of these pass does
verification check the anchor's signatures over the certificate, which is where
the anchor keys above are used.

## Debugging an anchor rejection

Everything the anchor decides against a certificate is an `IdCertVerifyError`, and
at the capsule loader it collapses to `[RUNTIME-LOAD] FAILED reason=id_cert`, so
the reason string does not tell you which anchor rule fired. The variant does, and
the order in `checks::run` ([`nonos_id_cert/verify/checks.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos_id_cert/verify/checks.rs#L22)) is the key to
reading it, because these run before the signature and short-circuit on the first
hit.

`EpochStale` is the anti-rollback rule: the certificate's `trust_anchor_epoch` is
below the baked policy's `trust_anchor_epoch`, so it was issued under a retired
generation. This is the expected failure right after an anchor epoch bump, and it
means the certificate is not tampered, it is simply old; the fix is a certificate
reissued under the current epoch, not a re-sign. `Revoked` and `NonosIdRevoked` are
the anchor lists: the certificate's serial or its `nonos_id` is in
`revoked_cert_serials` or `revoked_nonos_ids`, checked by `cert_serial_revoked` and
`nonos_id_revoked` (`schema.rs:57`). `NotYetValid` and `Expired` are the validity
window, and they only fire when the caller supplied a real clock; a boot path with
no trusted time passes `None` and never produces these two, which is why a machine
with an unset RTC does not see spurious `Expired` rejections.

Only when all of those pass does the anchor reach the signature, and a failure
there is `TrustAnchorPolicy` when the policy carried no key for the required
algorithm, or `TrustAnchorBadSig(alg)` when a signature under that algorithm
matched no anchor key ([`verify/dispatch.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/verify/dispatch.rs#L44)). So a `TrustAnchorBadSig` is the
one anchor failure that genuinely means "wrong signing key or altered certificate
bytes", cleanly separated from the epoch, revocation, and window rejections that
never reached the signature at all. The third anchor list,
`revoked_publisher_key_ids`, does not fire here; it is consulted one layer down
when a manifest's publisher signature is checked, so a leaked manifest key surfaces
as a [manifest](/docs/security/manifest-schema/) rejection, not a certificate one.

## Source map

```
  src/security/nonos_trust_anchor/baked.rs      the include_bytes policy constant
  src/security/nonos_trust_anchor/schema.rs     NonosTrustAnchorPolicy, TrustAnchorKey, the revocation tests
  src/security/nonos_id_cert/verify/checks.rs   the epoch, revocation, and validity checks
  src/security/nonos_id_cert/verify/dispatch.rs the anchor signature verification
  src/security/nonos_id_cert/error.rs           the IdCertVerifyError variants each check returns
```

The certificate schema these checks read is on the
[certificate page](/docs/security/certificate-schema/); the pipeline that maps these into the
`[RUNTIME-LOAD] reason=id_cert` line is on the
[verified spawn](/docs/security/capsules-and-trust/) page; the manifest-key revocation the
anchor also carries is on the [revocation](/docs/security/revocation/) page.
