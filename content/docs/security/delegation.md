---
title: "Capability Delegation"
description: "A capsule that holds a capability can pass a subset of its authority to another capsule for a bounded time."
weight: 9
---
A capsule that holds a capability can pass a subset of its authority to another
capsule for a bounded time. The object that carries that transfer is a
`Delegation`, a separate authenticated structure from the capability token, with
its own material, its own domain-separated MAC, and its own set of rules enforced
at creation and re-checked at use. This page documents the delegation module in
full: the structure, every constructor guard, the exact subset and expiry rules,
the MAC and its material, the three verification entry points, and every error the
module can return. It lives at `src/capabilities/delegation/`.

## The Delegation structure

A delegation is a signed statement that one module has granted a set of
capabilities to another ([`src/capabilities/delegation/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/types.rs#L23)):

```
  Delegation
    delegator      u64                 the module granting authority
    delegatee      u64                 the module receiving it
    capabilities   Vec<Capability>     the delegated subset
    expires_at_ms  Option<u64>         when the delegation lapses, if ever
    parent_nonce   u64                 the nonce of the delegator's token
    signature      [u8; 64]            the keyed MAC over the above
```

Its predicates mirror the token's. `is_expired` returns false for a delegation
with no expiry and otherwise compares the current time against `expires_at_ms`
(`types.rs:34`); `is_valid` is simply `!is_expired`; `remaining_ms` reports the
time left with a saturating subtraction; and `grants`, `grants_all`, `grants_any`,
and `capability_count` test the delegated set. Note what the structure does not
carry: it has no capability bitmask cache and no address-space binding of its own.
Its authority is entirely the `capabilities` vector, and its binding to a live
authority is the `parent_nonce`.

## Creating a delegation

The checked constructor is `create_delegation`
([`src/capabilities/delegation/create_checked.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/create_checked.rs#L24)), and every guard in it is a
rule of the delegation model:

```
  create_delegation(parent_token, delegatee, caps, ttl_ms):
      if caps is empty                         -> NoCapabilities
      if !is_token_valid(parent):
          if parent is expired                 -> ParentExpired
          else                                 -> InvalidParentToken
      for cap in caps:
          if !parent.grants(cap)               -> CapabilityNotHeld
      now = timestamp_millis()
      expiry = ttl_ms.map(|t| now.saturating_add(t))
      if parent has an expiry:
          expiry = min(expiry or parent_expiry, parent_expiry)
      build Delegation { delegator: parent.owner_module, delegatee,
                         capabilities: caps, expires_at_ms: expiry,
                         parent_nonce: parent.nonce, signature: [0; 64] }
      sign_delegation(&mut delegation)
```

Three properties are enforced here and are worth stating as invariants.

First, a delegation can only be created from a valid parent token. The parent must
authenticate and not be expired, and the error distinguishes the two cases so a
caller can tell an expired parent from a forged one.

Second, a delegation is always a subset. Every capability in the delegated set
must be one the parent token actually grants, or creation fails with
`CapabilityNotHeld`. A capsule cannot delegate authority it does not hold, so
delegation can only attenuate, never amplify.

Third, a delegation never outlives its parent. If the caller passes a TTL it
becomes `now + ttl` with a saturating add, and if the parent token itself has an
expiry the delegation's expiry is clamped to the minimum of the two. A delegation
whose caller asked for a longer life than the parent has is silently shortened to
the parent's, and a delegation off a parent with an expiry inherits that bound
even if no TTL was requested.

The `sign_delegation` call ([`src/capabilities/delegation/sign.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/sign.rs)) stamps the MAC.
The module also carries an unchecked constructor
([`src/capabilities/delegation/create_unchecked.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/create_unchecked.rs)) that builds and signs a
delegation without the parent-validity and subset checks above; the checked
constructor is the enforced path, and the unchecked one exists for internal
construction where the caller has already established those properties.

## The MAC and its material

A delegation is authenticated the same way a token is, under the same boot signing
key, but over its own material and with its own domain tag so the two MACs are not
interchangeable.

The material is a 48-byte buffer ([`src/capabilities/delegation/material.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/material.rs#L22)):

```
  0..8    parent_nonce
  8..16   delegator
  16..24  delegatee
  24..32  the delegated capabilities as a bitmask
  32..40  expires_at_ms (0 if none)
  40..48  parent_nonce
```

As with the token, the capability field is the bitmask derived from the
`capabilities` vector by `caps_to_bits` at the moment the material is built, so
the vector and its bits are covered together. The parent nonce appears at both the
head and the tail of the material.

The signature is `compute_delegation_signature` (`material.rs:33`), the same
two-pass keyed BLAKE3 construction as the token MAC, except the second pass absorbs
the suffix `DELEG` rather than `CAP2`:

```
  compute_delegation_signature(key, material):
      mac1 = blake3_keyed_hash(key, material)
      mac2 = keyed Blake3 of (material then "DELEG")
      return mac1 || mac2                              64 bytes
```

The distinct suffix is domain separation between two uses of the one signing key:
a valid token MAC can never be reinterpreted as a valid delegation MAC and vice
versa, because the material and the tag both differ.

## Verifying a delegation

Three entry points verify a delegation, differing in what they take and what they
return ([`src/capabilities/delegation/verify.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/verify.rs)).

`verify_delegation(d, parent)` (`verify.rs:24`) is the primary check. It returns
false if the delegation has expired, if `d.parent_nonce` does not equal the
parent token's current nonce, or if `d.delegator` does not equal the parent
token's `owner_module`; then it fails closed on a missing signing key; then it
recomputes the expected MAC over the material and compares it in constant time
with `ct_eq_64`. The nonce check is the important one for revocation: a delegation
is bound to the exact nonce the parent token had when it was created, so if the
parent's token is re-minted with a new nonce, as it is on a revoke, the delegation
no longer matches and stops verifying.

`verify_delegation_strict(d, parent)` (`verify.rs:35`) performs the same checks but
returns a `Result<(), DelegationError>` that names the first failure:
`DelegationExpired`, `InvalidParentToken` for a nonce or delegator mismatch,
`MissingSigningKey`, or `InvalidSignature`.

`verify_delegation_standalone(d)` (`verify.rs:55`) verifies a delegation without a
parent token in hand, checking expiry and the signature over the material using
the delegation's own recorded `parent_nonce`. It confirms the delegation is
internally authentic and unexpired but cannot confirm the parent is still the one
it names, since it has no parent token to compare against.

## The errors

The module's error type is closed and each variant has a fixed message
([`src/capabilities/delegation/error.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/error.rs#L18)):

```
  MissingSigningKey     "Signing key not available"
  InvalidParentToken    "Parent token is invalid"
  ParentExpired         "Parent token has expired"
  CapabilityNotHeld     "Cannot delegate capability not held"
  DelegationExpired     "Delegation has expired"
  InvalidSignature      "Signature verification failed"
  NoCapabilities        "No capabilities specified"
```

`is_recoverable` (`error.rs:41`) marks `DelegationExpired` and `ParentExpired` as
recoverable, since both can be resolved by minting a fresh token or delegation,
while the others indicate a malformed or unauthorised request.

## Delegation depth

The single `Delegation` above is one hop. Re-delegation, passing on a capability
that was itself received by delegation, is bounded by the `delegation_depth` field
of the [capability token](/docs/security/capabilities-and-tokens/) and is handled by the chain
module (`src/capabilities/chain/`), which caps how deep a delegation chain may run
so that authority cannot be forwarded without limit. The syscalls that expose
grant and revoke to capsules, `MkCapGrant` and `MkCapRevoke`, are gated by the
`IPC` capability and handled in `src/syscall/microkernel/capability/`.

## Debugging a refused delegation

A delegation is refused at one of two moments, creation or use, and the
`DelegationError` variant ([`src/capabilities/delegation/error.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/delegation/error.rs#L18)) names which.
The strict verifier is the one to reach for, because the primary
`verify_delegation` returns a bare `false` and hides the cause;
`verify_delegation_strict` (`verify.rs:35`) returns the first failing variant
instead.

At creation, `create_delegation` (`create_checked.rs:24`) refuses an over-broad or
unauthorised grant. `NoCapabilities` means the requested set was empty.
`CapabilityNotHeld` is the subset rule firing: the caller asked to delegate a
capability its own parent token does not grant, which is the refusal that makes
delegation attenuate-only. `InvalidParentToken` and `ParentExpired` split the two
ways a parent can be unusable, a token that does not authenticate versus one that
has simply lapsed, and `is_recoverable` (`error.rs:41`) marks only the expired
cases as fixable by re-minting, so a `CapabilityNotHeld` or a plain
`InvalidParentToken` is a request the caller was never entitled to make.

At use, the failure is usually revocation showing through. `verify_delegation`
(`verify.rs:24`) checks that `d.parent_nonce` still equals the parent token's
current nonce and that `d.delegator` equals its `owner_module`; a mismatch on
either returns `InvalidParentToken` from the strict path. This is the important
one to recognise: a delegation is bound to the exact nonce the parent held when it
was signed, so when the parent's token is re-minted with a new nonce, which is what
a revoke does, the delegation stops matching and every copy of it dies at once
without being individually hunted down. So a delegation that verified a moment ago
and now fails `InvalidParentToken` is very likely a revoked or re-minted parent,
not a corrupted delegation. `DelegationExpired` is the delegation's own TTL, which
was clamped at creation never to outlive the parent's. `InvalidSignature` is the
MAC not matching, which after the nonce and delegator checks have passed means the
delegation bytes themselves were altered, and `MissingSigningKey` is the
fail-closed guard on a kernel whose boot signing key is not set.

One subtlety worth stating: `verify_delegation_standalone` (`verify.rs:55`) can
confirm a delegation is internally authentic and unexpired without a parent token
in hand, but it cannot see a parent revocation, since it compares against the
delegation's own recorded `parent_nonce` rather than a live one. A delegation that
passes standalone but fails the parent-taking verifier is exactly a revoked parent.

## Source map

```
  src/capabilities/delegation/types.rs           the Delegation structure
  src/capabilities/delegation/create_checked.rs  create_delegation and its guards
  src/capabilities/delegation/create_unchecked.rs the internal constructor
  src/capabilities/delegation/material.rs         the 48-byte material and MAC
  src/capabilities/delegation/sign.rs             sign_delegation
  src/capabilities/delegation/verify.rs           the three verify entry points
  src/capabilities/delegation/error.rs            DelegationError and is_recoverable
  src/capabilities/chain/                          multi-hop depth bounding
  src/syscall/microkernel/capability/             the MkCapGrant/Revoke handlers
```

The parent-token re-mint that quietly voids a delegation is the revocation epoch
and nonce machinery on the [revocation](/docs/security/revocation/) page; the token the parent
nonce lives in is on the [capability model](/docs/security/capabilities-and-tokens/) page.
