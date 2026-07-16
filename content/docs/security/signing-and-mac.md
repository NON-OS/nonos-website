---
title: "The Token Signing Key and MAC"
description: "The capability token is trustworthy because it carries a keyed message authentication code that only the kernel can produce and check."
weight: 8
---
The [capability token](/docs/security/capabilities-and-tokens/) is trustworthy because it
carries a keyed message authentication code that only the kernel can produce and
check. This page documents that machinery to the last detail: the signing key and
its once-only lifecycle, the exact material the MAC covers, the two-pass
construction of the MAC itself, the paths that mint and sign a token, the path
that verifies one, the per-boot nonce that binds a token to a single boot, and
the constant-time comparison that closes the timing channel. Everything here is
the cryptographic floor the capability model stands on.

## The signing key

The key is a single 32-byte value held in a write-once cell
([`src/capabilities/token/signing_key.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/signing_key.rs#L19)):

```
  static SIGNING_KEY: Once<[u8; 32]> = Once::new();
```

`spin::Once` is the important choice: it can be written exactly once and read
freely thereafter. `set_signing_key` (`signing_key.rs:21`) enforces two
conditions and returns a `&'static str` error rather than proceeding on either:

```
  set_signing_key(key):
      if key.len() != 32          -> Err("Key must be 32 bytes")
      if SIGNING_KEY already set   -> Err("Key already set")
      copy key into [u8; 32], call_once
```

So there is exactly one signing key for the life of a boot, it is exactly
thirty-two bytes, and once set it cannot be replaced. Two accessors read it:
`has_signing_key()` returns whether it is set, and `signing_key()` returns
`Option<&'static [u8; 32]>`. Every operation that signs or verifies a token starts
by taking this `Option`, and every one of them fails closed when it is `None`, so
a kernel that has not yet minted its key can neither produce nor accept a token.

## The MAC material

The MAC is computed over a fixed 128-byte buffer built by `token_material`
([`src/capabilities/token/material.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/material.rs#L25)). Every authority field of the token has
a fixed offset, and the tail is zero padding:

```
  0..8     owner_module         48..80   subject_measurement
  8..16    capability bitmask   80..96   boot_session_nonce
  16..24   expires_at_ms        96..104  revocation_epoch
  24..32   nonce                104      delegation_depth
  32..40   token_id             105..128 zero padding
  40..44   subject_capsule_id
  44..48   subject_asid
```

The capability bitmask at offset 8 is not a stored field; it is computed from the
token's `permissions` vector by `caps_to_bits` at the moment the material is
built. Both the signer and the verifier do this, so the vector and the bits it
implies are covered by the same MAC and cannot disagree.

## The MAC construction

`mac64` (`material.rs:41`) produces a 64-byte tag from the key and the material:

```
  mac64(key, mat):
      mac1 = blake3_keyed_hash(key, mat)                32 bytes
      mac2 = keyed Blake3 of (mat then the literal "CAP2")   32 bytes
      return mac1 || mac2                               64 bytes
```

Both halves are keyed BLAKE3 under the same 32-byte key. BLAKE3 produces a 256-bit
(32-byte) output, so a single hash cannot fill a 64-byte tag; the second hash
absorbs the extra domain-separation suffix `CAP2` before finalising so that the
two halves are independent outputs of the keyed function rather than the same
value written twice. The result is a full 512-bit authenticator. The keyed hash
and the incremental hasher come from the in-tree BLAKE3
(`src/crypto/hash/blake3/`).

## Minting a token

Tokens are created through `create.rs`. The base constructor is `create_token`
([`src/capabilities/token/create.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/create.rs#L25)):

```
  create_token(owner, caps, ttl_ms):
      boot_nonce = boot_session::nonce().ok_or(ERR_BOOT_NONCE)?
      exp = ttl_ms.map(|t| now_ms.saturating_add(t))
      tok = CapabilityToken {
          owner_module: owner, permissions: caps, expires_at_ms: exp,
          nonce: default_nonce(), token_id: default_nonce(),
          subject_capsule_id: owner as u32, subject_asid: 0,
          subject_measurement: [0; 32], boot_session_nonce: boot_nonce,
          revocation_epoch: 0, delegation_depth: 0, signature: [0; 64],
      }
      sign_token(&mut tok)?
```

The first line is a fail-closed guard: if the per-boot nonce has not been latched,
minting returns `ERR_BOOT_NONCE` ("boot session nonce not initialized") and no
token is produced. The expiry is computed with `saturating_add`, so a large TTL
clamps at `u64::MAX` rather than overflowing. Two variants exist:
`create_token_with_nonce` takes the `nonce` explicitly, and `create_secure_token`
draws 128 bits from the secure RNG (`secure_nonce_128`) and uses the low 64 bits
as the nonce (`create.rs:76`); both defer to the same construction and signing.

One detail matters for how the token is later enforced. `create_token` sets
`subject_asid` and `revocation_epoch` to zero. These bindings are not filled in by
the base constructor; they are set by the process-level mint that ties a token to
a specific process address space and revocation counter ([`src/process/caps.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/caps.rs)).
The base constructor produces a signed token bound to the boot; the process mint
produces one additionally bound to an address space.

## Signing

`sign_token` ([`src/capabilities/token/sign.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/sign.rs#L24)) is what stamps the signature:

```
  sign_token(tok):
      key = signing_key().ok_or("No signing key")?
      if tok.nonce == 0: tok.nonce = default_nonce()
      mat = token_material(tok, caps_to_bits(tok.permissions))
      tok.signature = mac64(key, mat)
```

It fails closed without a signing key. It also refuses to sign a token with a zero
nonce, replacing it with a fresh one, so no signed token ever carries the
degenerate nonce that the empty-token constructors use to mark themselves as
carrying no live authority.

## Verifying

Verification is the mirror of signing ([`src/capabilities/token/verify.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/verify.rs#L24)):

```
  verify_token(tok):
      key = signing_key()                if None, return false
      mat = token_material(tok, caps_to_bits(tok.permissions))
      computed = mac64(key, mat)
      return ct_eq_64(computed, tok.signature)
```

It recomputes the material and the tag exactly as the signer did and compares in
constant time. A verifier on a keyless kernel returns `false`, never `true`.

## The boot session nonce

The nonce that binds a token to one boot is latched once, after the RNG is ready
([`src/security/boot_session.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/boot_session.rs)):

```
  static BOOT_SESSION_NONCE: Once<[u8; 16]> = Once::new();

  init_once_from_rng():
      if already latched                              -> Err("already latched")
      get_bytes_secure(&mut buf[0..16])               -> Err on RNG not ready
      call_once(buf)
```

The module documentation states the contract exactly (`boot_session.rs:17`): the
nonce is latched once during boot after the RNG is ready, minted into every
authority-bearing token, and compared by the resolver against the live value to
reject any token carried across a reboot. The accessor returns `Option<[u8; 16]>`
so every mint site is forced to handle the not-yet-initialised case rather than
silently binding a zero nonce, and the production boot path halts if
initialisation fails (`core_init.rs`). The only tokens that carry a literal zero
nonce are the explicit empty tokens (`CapabilityToken::empty`, `with_caps`), which
do not go through this API and hold no live authority.

## Constant-time comparison

The MAC comparison must not leak, through timing, how many bytes of a forged tag
matched. `ct_eq_64` ([`src/crypto/util/constant_time/compare.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/util/constant_time/compare.rs#L51)) is written to
that end:

```
  ct_eq_64(a, b):
      diff = 0
      for i in 0..64: diff |= a[i] ^ b[i]
      compiler_fence()
      return diff == 0
```

It touches all sixty-four bytes every time, accumulating differences into a single
byte with no early exit, and a `compiler_fence` prevents the optimiser from
reintroducing one. The function is `#[inline(never)]` so its shape is preserved. A
forger therefore cannot solve for the tag one byte at a time by measuring how long
verification takes. The same module provides `ct_eq_32`, `ct_eq_16`, a
length-independent `ct_eq` for slices (whose mismatched-length path still runs a
dummy comparison and a volatile read before returning false), and a family of
branchless `u64` comparisons (`ct_lt_u64`, `ct_gt_u64`, `ct_eq_u64`,
`ct_is_zero_u64`) built from bit tricks rather than conditionals, for the places
that must compare values without branching on secrets.

## The fail-closed chain

Read as a whole, the token machinery is a chain of guards that each default to
refusal:

```
  no signing key        -> cannot sign, cannot verify (verify returns false)
  no boot session nonce -> cannot mint (create returns ERR_BOOT_NONCE)
  zero nonce on sign    -> replaced with a fresh nonce, never signed as-is
  tag comparison        -> constant time, no early exit, no timing leak
```

None of these can be turned off by a capsule, and none can be reached in a
half-initialised state that would accept a token it should not.

## Debugging a MAC or signing failure

The MAC layer fails in a deliberately quiet way, and that is the thing to know
first: `verify_token` (`verify.rs:24`) returns a bare `false` for every reason it
can fail, whether the key is unset, the material differs, or the tag was forged. It
does not distinguish them, by design, so there is no informative error to read off
a verify failure directly. What a verify-false becomes downstream is a
`ResolverError::TokenSignatureInvalid` at the first resolver step
(`check_token`), which the syscall path turns into `[CAP-DENY]` and `EPERM`. So a
MAC problem looks like any other capability denial at the syscall boundary; the way
to know it is the MAC and not a later binding check is that `check_token` runs
first, so if the signature is wrong none of the session, ASID, or epoch checks are
even reached.

Two of the failures are fail-closed guards worth separating from a genuine tag
mismatch. If the signing key was never set, both signing and verifying refuse:
`sign_token` returns `"No signing key"` (`sign.rs`) and `verify_token` returns
`false` outright (`verify.rs`, the `None` branch). If the boot session nonce was
never latched, minting fails earlier still, at `create_token` returning
`ERR_BOOT_NONCE` ("boot session nonce not initialized", `create.rs`), so a token is
never produced to begin with. A kernel that reaches capsule spawn without either of
these initialised is a boot-ordering bug, and the production boot path is written to
halt rather than proceed keyless (`core_init.rs`); the symptom would be no capsule
ever spawning, not a specific denial.

A real tag mismatch, key set and nonce latched but the sixty-four bytes not
matching, is the interesting case, and there are only a few ways to reach it
honestly. The material covers `boot_session_nonce` and the key is per-boot, so a
token from a prior boot mismatches: that is the cross-boot revocation working, and
it shows as verify-false plus, if it got past `check_token`, a
`BootSessionMismatch` one step later. The material also covers `subject_asid`, so a
token lifted into another address space mismatches. And because the bitmask fed to
the MAC is recomputed from the `permissions` vector by `caps_to_bits` at verify
time rather than read from a stored field, editing the permissions vector without
re-signing produces a mismatch by construction. If none of those apply, a
verify-false with a set key is either a corrupted token or a forgery attempt, and
the constant-time `ct_eq_64` (`compare.rs:51`) guarantees the attacker learned
nothing from the timing of the rejection.

## Source map

```
  src/capabilities/token/signing_key.rs   the write-once 32-byte key and its errors
  src/capabilities/token/material.rs       the 128-byte material and mac64
  src/capabilities/token/create.rs         the token mint constructors and ERR_BOOT_NONCE
  src/capabilities/token/sign.rs           sign_token and its "No signing key" error
  src/capabilities/token/verify.rs         verify_token, the fail-closed false
  src/capabilities/token/nonce.rs          default_nonce, secure_nonce_128
  src/security/boot_session.rs             the per-boot nonce
  src/crypto/util/constant_time/compare.rs the constant-time comparisons
  src/crypto/hash/blake3/                   the keyed BLAKE3 used by mac64
  src/syscall/contract/resolver/error.rs   TokenSignatureInvalid, what a verify-false becomes
```

The resolver step a verify-false lands on, and its `[CAP-DENY]`/`EPERM` surface,
are on the [capability model](/docs/security/capabilities-and-tokens/) page; the delegation MAC
that reuses this key with a different domain tag is on the
[delegation](/docs/security/delegation/) page.
