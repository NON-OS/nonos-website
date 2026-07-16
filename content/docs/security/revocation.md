---
title: "Revocation"
description: "Authority that is granted must be withdrawable, and NØNOS withdraws it at four different scopes, each suited to a different need: an entire boot's worth of tokens at once, every..."
weight: 10
---
Authority that is granted must be withdrawable, and NØNOS withdraws it at four
different scopes, each suited to a different need: an entire boot's worth of
tokens at once, every token a single process holds, one specific token, and a
whole publisher or a single certificate. This page documents each mechanism from
the source, the exact state it keeps, the function that changes that state, and
the point at which the change takes effect on a running capsule.

The four scopes, from widest to narrowest:

```
  cross-boot     the per-boot signing key and nonce      every token, on reboot
  per-process    the revocation epoch                    every token of one pid
  per-token      the revoked (owner, nonce) set          one token
  publisher      the trust anchor revocation lists       a cert, id, or key
```

## Per-token: the revoked set

The narrowest revocation is a set of `(owner, nonce)` pairs
([`src/capabilities/token/revocation.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/revocation.rs#L22)):

```
  static REVOKED: RwLock<BTreeSet<(u64, u64)>> = ...

  revoke_token(owner, nonce)       insert the pair
  is_revoked(owner, nonce)         membership test
  revoked_count()                  the set size
  clear_revocations()              empty the set
  revoke_all_for_owner(owner)      keep only pairs whose owner differs
```

A token carries an `owner_module` and a `nonce`, and a token whose pair is in this
set is dead: it still authenticates, but validity fails. `revoke_all_for_owner`
rebuilds the set keeping only the pairs that do not belong to the named owner,
which revokes every currently listed token of a single owner in one call. The set
is behind an `RwLock`, so the common case, a read during validation, does not
contend with other readers.

## Token validity

The revoked set is consulted through the validity predicate
([`src/capabilities/token/validate.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/validate.rs#L21)):

```
  is_token_valid(tok) =
      verify_token(tok) and tok.not_expired() and not is_revoked(owner, nonce)
```

A token is valid only if its MAC verifies, it has not expired, and its
`(owner, nonce)` is not revoked. The module also exposes the three parts
separately, `is_token_signature_valid`, `is_token_not_revoked`, and a
`validate_token_full` that returns a `Result` naming the first failure as
`"Invalid signature"`, `"Token expired"`, or `"Token revoked"`. This predicate is
the one consulted by the first step of the syscall resolver chain, so a revoked
token fails the resolver on the capsule's next call.

## Per-process: the revocation epoch

The revoked set is direct but does not scale: withdrawing authority from a busy
capsule would mean listing every token it ever held. The revocation epoch solves
that with a single counter, and its whole implementation is in the process
capability module ([`src/process/caps.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/process/caps.rs)).

Every token binds the value of the process's revocation counter at the moment it
was minted. `new_token` (`caps.rs:38`) reads it from the process control block and
stamps it into the token's `revocation_epoch` field:

```
  new_token(pid, bits):
      boot_nonce = boot_session::nonce()?                 fail-closed
      asid = lookup_asid_for_process(pid) or 0
      revocation_epoch = pcb.revocation_epoch (load)
      build token { owner_module: pid, permissions: bits_to_caps(bits),
                    subject_asid: asid, boot_session_nonce: boot_nonce,
                    revocation_epoch, token_id: next id, nonce: 0, ... }
      sign_token(&mut token)
      Arc::new(token)
```

This is also the mint that binds the address space: unlike the base
`create_token`, which leaves `subject_asid` and `revocation_epoch` zero, this
process-level mint reads the real ASID and epoch and covers them with the MAC.
`rebind_address_space` (`caps.rs:71`) re-mints after the process's address space
is established, so the token reflects the real ASID before the process becomes
reachable.

Revoking is then a single increment (`caps.rs:99`):

```
  revoke(pid, mask):
      pcb.revocation_epoch += 1                    bump first
      new_bits = pcb.caps_bits & !mask             drop the revoked bits
      fresh = new_token(pid, new_bits)             carries the new epoch
      install_token(pcb, fresh)
```

The increment happens before the fresh token is minted, so the new token carries
the higher epoch and every token minted before it now carries a lower one. The
resolver's `check_revocation_epoch` rejects any token whose epoch is behind the
process's current one, so that one increment retires every outstanding token of
the process at once, without enumerating them. Granting is the same shape without
the increment (`grant`, `caps.rs:89`): it ORs in the new bits and re-mints, but
does not bump the epoch, because adding authority does not invalidate the old
token's scope.

`install_token` (`caps.rs:61`) is where the fresh token and its derived bitmask
cache are swapped in together, under the token's write lock, so the authoritative
`Arc<CapabilityToken>` and the `caps_bits` fast-path cache never disagree. And
`install_spawn` (`caps.rs:113`) installs the verified-manifest token exactly once,
using a compare-and-exchange on a `caps_manifest_installed` flag so a replayed or
stale spawn path cannot re-issue authority a second time.

## Publisher: the anchor lists

The broadest revocation short of a reboot lives in the [trust
anchor](/docs/security/trust-anchor/). Its policy carries three lists, checked during verified
spawn rather than at each syscall: `revoked_cert_serials` retires one certificate,
`revoked_nonos_ids` retires an entire publisher identity, and
`revoked_publisher_key_ids` retires one manifest-signing key while leaving its
certificate otherwise valid. Because these are consulted when a capsule is
admitted, they stop a revoked publisher from spawning new capsules; they do not
reach into capsules already running, which is what the per-process and per-token
mechanisms above are for. The anchor also carries a `trust_anchor_epoch` that
retires every certificate of an older generation at once, the certificate-level
counterpart of the token revocation epoch.

## Cross-boot: the signing key and nonce

The widest revocation of all is implicit. The token [signing
key](/docs/security/signing-and-mac/) is minted fresh each boot, and every token binds the
per-boot session nonce. A token from a previous boot verifies against a different
key over a different nonce, so it fails both the signature check and the session
binding. Nothing survives a reboot: the entire authority state of the previous
boot is void the moment the new one latches its key and nonce.

## Where each is enforced

The scopes are enforced at two different points, and the [capability
model](/docs/security/capabilities-and-tokens/) resolver chain is where the runtime ones land:

```
  check_token             signature, expiry, and the revoked (owner, nonce) set
  check_session_binding   the per-boot nonce, which voids prior-boot tokens
  check_revocation_epoch  the per-process epoch, which voids pre-revoke tokens
```

The anchor lists are enforced earlier and only once, at [verified
spawn](/docs/security/capsules-and-trust/), because a capsule that is already running was
admitted under an anchor state that has since changed, and it is the per-process
and per-token mechanisms, not the anchor lists, that reach it.

## Debugging a revocation

The symptom of a revocation is the same as any other token failure: the capsule's
next syscall comes back `EPERM` with a `[CAP-DENY]` line, because all three runtime
scopes land in the resolver chain. What separates a revoke from an unrelated denial
is the resolver step that fired, and the eight `ResolverError` variants
([`src/syscall/contract/resolver/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/resolver/error.rs)) name them even though the `[CAP-DENY]`
log does not print which one. The three revocation scopes map to three of them.

`TokenRevoked` is the per-token set: the token's `(owner, nonce)` pair is in
`REVOKED` ([`token/revocation.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/token/revocation.rs)), which `is_token_valid` consults through
`is_token_not_revoked`. The full validator `validate_token_full`
([`token/validate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/token/validate.rs)) is the tool here, since it returns the failure as the string
`"Token revoked"` rather than a bare false, so a diagnostic path that calls it can
tell a revoked token apart from an expired one (`"Token expired"`) or a forged one
(`"Invalid signature"`). `RevocationEpochStale` is the per-process scope: the token
authenticates and is not in the revoked set, but its `revocation_epoch` is behind
the process's current counter because `revoke` ([`process/caps.rs:99`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/process/caps.rs#L99)) bumped the
counter and re-minted. A capsule that suddenly loses several capabilities at once,
all with the same `[CAP-DENY]` pattern, is the epoch case, not a per-token revoke,
because one increment retires every outstanding token of the process. And
`BootSessionMismatch` is the cross-boot scope: a token carried from a previous boot
fails the session-nonce check against this boot's latched value.

To confirm which fired without instrumentation, use the order. If the capsule was
freshly re-minted (a grant or revoke just ran) and old handles fail while new ones
work, it is the epoch. If a specific token dies but the process keeps working, it
is the per-token set. If everything the capsule holds is dead from its first
syscall, and this is the first boot after a reboot, it is the session nonce. The
anchor lists never show up here at all: a revoked publisher or certificate is
refused at [verified spawn](/docs/security/capsules-and-trust/) as a `[RUNTIME-LOAD] FAILED
reason=id_cert` (variant `Revoked` or `NonosIdRevoked`), before the capsule ever
holds a token, so a running capsule losing authority is never the anchor list.

## Source map

```
  src/capabilities/token/revocation.rs   the revoked (owner, nonce) set
  src/capabilities/token/validate.rs     is_token_valid and validate_token_full
  src/process/caps.rs                    new_token, grant, revoke, install_token
  src/security/nonos_trust_anchor/schema.rs  the anchor revocation lists
  src/syscall/contract/resolver/         where the runtime checks run
  src/syscall/contract/resolver/error.rs the ResolverError variants a revoke maps to
```

The resolver chain and the `[CAP-DENY]`/`EPERM` surface are on the
[capability model](/docs/security/capabilities-and-tokens/) page; the anchor-list revocations
that fire at spawn are on the [trust anchor](/docs/security/trust-anchor/) and
[verified spawn](/docs/security/capsules-and-trust/) pages; the parent-nonce binding a revoke
breaks for delegations is on the [delegation](/docs/security/delegation/) page.
