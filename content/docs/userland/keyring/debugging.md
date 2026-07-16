---
title: "Debugging capsule_keyring"
description: "The keyring deliberately holds no Debug capability, so it emits no diagnostic output of its own."
weight: 8
---
The keyring deliberately holds no Debug capability, so it emits no diagnostic output of its own. Debugging
is done from the boot marker and the caller side. This page lists the boot marker, how to read a failure
from the reply status, and where each error comes from. For the request model see the [README](/docs/userland/keyring/),
the [operations](/docs/userland/keyring/operations/), the [store](/docs/userland/keyring/store/), and the [signing](/docs/userland/keyring/signing/) pages in this folder.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[KEYRING] capsule spawned` from the boot log: the `Ok` arm of the capsule boot path calls
`boot_log::ok(prefix, "capsule spawned")` with the tag `KEYRING`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), format in [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)).

If that line is absent the capsule never registered its service, so `mk_service_lookup("keyring")` will not
resolve for the wallet, the payment capsule, or login, and every wallet operation and paid receipt fails at
the caller. In that case the `Err` arm logged an `[ERROR]` line describing the `SpawnError` instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32), `boot_log::error`, [`src/sys/boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L49)), which is
the usual signature, manifest, or capability failure.

## Reading a failure from the reply status

Because the keyring never logs, the reply status is the trace. Every negative status is one of five errno
values ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

- `EACCES` (-13). Either `resolve_caller` refused a payload pid that did not match the attested sender
  ([`src/server/caller.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/caller.rs#L23)), or an owner-pid check refused a key that belongs to another capsule
  (for example [`src/store/eth_secret.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/eth_secret.rs#L23)). A wallet that can show an address but cannot sign is often
  this boundary doing its job against a caller acting on a key it does not own.
- `EBUSY` (-16). A `retrieve` or a sign against a locked key. The lock check sits in `retrieve`
  ([`src/store/retrieve.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/retrieve.rs#L30)) and in `eth_secret` ([`src/store/eth_secret.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/eth_secret.rs#L28)), which every signer uses.
  If signing fails right after boot or after a session ends, the wallet key is locked; login unlocks it on
  sign-in with `OP_UNLOCK = 5`.
- `ENOENT` (-2). A key id that does not exist in the store ([`src/store/retrieve.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/retrieve.rs#L23) returns `NotFound`).
- `EINVAL` (-22). A bad request or a failed crypto step. From `wallet_generate` it means rejection sampling
  failed to draw a valid secp256k1 scalar in 32 tries, which points at a degraded RNG
  ([`src/server/handlers/wallet_generate.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/wallet_generate.rs#L43)). From a signer it means a bad request length or a failed
  keccak or sign step ([`src/server/handlers/sign_eth_transfer.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sign_eth_transfer.rs#L56), `:62`). From `store` it means an empty
  or over-256-byte body ([`src/store/store_key.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/store_key.rs#L28)). It is also the reply for any opcode outside 1..=14
  ([`src/server/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L43)).
- `ENOSPC` (-28). The 128-key store is full ([`src/store/store_key.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/store_key.rs#L31)).

## Common cases

### The wallet cannot sign but can show an address

`wallet_address` and the signers both read the secret through `eth_secret`, so the same owner and lock
checks apply. If the address returns but the signature is refused with `EBUSY`, the key is locked and login
has not unlocked it. If the signature is refused with `EACCES`, the caller pid does not own the key. The
address path itself only needs the pubkey derivation, so it can succeed where a full sign is blocked by the
lock, but not where the caller fails the owner check, since `eth_secret` checks the owner before anything
else.

### A wallet secret will not come back through retrieve

That is by design, not a bug. `retrieve` refuses a `Secp256k1Eth` key with `AccessDenied`, which surfaces
as `EACCES`, before it reads any bytes ([`src/store/retrieve.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/retrieve.rs#L27)). There is no operation that exports a
wallet secret; use the signers instead. See [store.md](/docs/userland/keyring/store/) and [signing.md](/docs/userland/keyring/signing/).

### Keyring absent at boot but callers report failures

A mismatch between "no `[KEYRING] capsule spawned` marker" and "the wallet cannot sign" points at the spawn,
not the request. The service never registered, so the caller's lookup fails before any frame is sent. Read
the `[ERROR]` line from the boot path for the `SpawnError` ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)); it
is usually a signature, manifest, or capability failure. Since the keyring itself is silent, the caller's
own markers are the only request-time trace: the wallet and payment capsules log their side of each call.

## Source map

```
  src/userspace/init/capsule_boot/run.rs           the [KEYRING] capsule spawned / [ERROR] path
  src/sys/boot_log/output.rs                       the ok / error line format
  userland/capsule_keyring/src/protocol/errno.rs   the five errno values
  userland/capsule_keyring/src/server/caller.rs    resolve_caller, the source of EACCES on mismatch
  userland/capsule_keyring/src/server/dispatch.rs  the EINVAL fall-through for an unknown opcode
  userland/capsule_keyring/src/store/retrieve.rs   NotFound, the Secp256k1Eth refusal, and the lock check
  userland/capsule_keyring/src/store/eth_secret.rs the owner/type/lock/length checks the signers see
  userland/capsule_keyring/src/store/store_key.rs  the InvalidArgument and Full sources
  userland/capsule_keyring/src/server/handlers/wallet_generate.rs   the rejection-sampling EINVAL
```

Every reference above is verified against those trees.
