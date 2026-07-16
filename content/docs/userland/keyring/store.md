---
title: "The key store and the wiping discipline"
description: "This page mirrors src/store/. It covers the Store and its KeyEntry model, the owner-pid check that runs on every store operation, the point where a wallet secret is refused expo..."
weight: 4
---
This page mirrors `src/store/`. It covers the `Store` and its `KeyEntry` model, the owner-pid check that
runs on every store operation, the point where a wallet secret is refused export, and the wiping discipline
that keeps key material from lingering in freed memory. For the wire protocol and the handlers that call
these methods read [operations.md](/docs/userland/keyring/operations/); for the signers that read a secret out of the store read
[signing.md](/docs/userland/keyring/signing/).

## The model

The store is a `BTreeMap<u32, KeyEntry>` keyed by an auto-incrementing id, with a `next_id`
([`src/store/types/store.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types/store.rs#L20)). It is constructed empty with `next_id = 1` ([`src/store/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L22)). A
`KeyEntry` carries the material and its metadata ([`src/store/types/key_entry.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types/key_entry.rs#L20)):

```
  struct KeyEntry {
      key_type: KeyType,     // Secp256k1Eth (8), Symmetric (0), SigningKey (7), ...
      data: Vec<u8>,         // the raw key material
      owner_pid: u32,        // the pid that stored it
      created_at: u64, expires_at: u64,
      use_count: u64,        // incremented on each retrieve and each secret use
      locked: bool,          // retrieval- and signing-blocking flag
  }

  impl Drop for KeyEntry:  secure_wipe(&mut self.data)     // zero on drop
```

`KeyType` is a `#[repr(u8)]` enum of nine variants, 0 through 8, from `Symmetric` to `Secp256k1Eth`
([`src/store/types/key_type.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types/key_type.rs#L18)), with the round-trip through `from_u8` (`key_type_from_u8.rs:19`) and
`to_u8` (`key_type_to_u8.rs:19`). The store is capped at 128 keys and each key at 256 bytes
([`src/store/types/constants.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types/constants.rs#L16)), so it cannot grow without bound. Store methods return a `StoreError`
of `NotFound`, `AccessDenied`, `Locked`, `Full`, or `InvalidArgument`
([`src/store/types/store_error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types/store_error.rs#L17)), which the handlers map onto the wire errno set.

## Owner-pid isolation

Every operation that reaches into the map takes a `caller_pid` and refuses an entry it does not own. The
check is the same three lines each time: look the id up (`NotFound` if absent), compare `owner_pid` to the
caller (`AccessDenied` on mismatch), then act. It appears in `retrieve` ([`src/store/retrieve.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/retrieve.rs#L24)),
`delete` (`delete.rs:22`), `lock` (`lock.rs:22`), `unlock` (`unlock.rs:22`), `metadata` (`metadata.rs:22`),
and `eth_secret` (`eth_secret.rs:22`). `count_owned_by` filters the map by `owner_pid` instead of looking
up a single id (`count.rs:20`). Combined with the [caller attestation](/docs/userland/keyring/operations/#caller-attestation)
that binds `caller_pid` to the attested sender, this means one capsule cannot read, use, lock, delete, or
even read metadata for another capsule's key.

`store` is the entry point ([`src/store/store_key.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/store_key.rs#L20)). It rejects an empty or over-256-byte body with
`InvalidArgument`, rejects a full store with `Full`, then takes `next_id`, wraps the counter with
`wrapping_add(1)`, and inserts a fresh `KeyEntry` with `use_count = 0` and `locked = false`
(`store_key.rs:28`).

## Where the wallet boundary is enforced

`retrieve` is the operation that draws the line between a general key and a wallet secret
([`src/store/retrieve.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/retrieve.rs#L22)). After the owner check it does two more things before returning any bytes:

```
  retrieve(id, caller_pid):
      entry = get(id)?                              // NotFound
      if entry.owner_pid != caller_pid: AccessDenied
      if entry.key_type == Secp256k1Eth: AccessDenied   // wallet secret, never exported
      if entry.locked: Locked
      entry.use_count += 1
      return entry.data.clone()
```

A `Secp256k1Eth` key can never leave the capsule through `retrieve`: the type check returns `AccessDenied`
before the bytes are read (`retrieve.rs:27`). This is structural, not a policy flag; there is no argument
that relaxes it and no other operation returns raw wallet bytes. Non-wallet key types (symmetric material,
HMAC secrets, signing keys, and so on) are retrievable by their owner, which is the store's general-purpose
role.

The only way to use a wallet secret is to ask the keyring to sign, and the signing path reads the secret
through `eth_secret` ([`src/store/eth_secret.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/eth_secret.rs#L20)), a separate method that re-checks the owner pid, then
requires the `Secp256k1Eth` type (`InvalidArgument` if not), refuses a locked key (`Locked`), and requires
the stored length to be exactly 32 bytes before copying it into an owned `[u8; 32]` and bumping
`use_count`. `eth_secret` returns the bytes, but only to a signing handler that wipes them the instant the
signature is out; the caller never sees them. [signing.md](/docs/userland/keyring/signing/) covers that path.

## The wiping discipline

The keyring wipes key material at four distinct points. Together they are the capsule's memory posture, and
each is a volatile write plus a compiler fence, so the optimizer cannot elide it.

```
  1. KeyEntry::drop     secure_wipe(data)     key erased on delete and on store teardown
  2. store::delete      secure_wipe(data)     the removed entry's bytes wiped before return
  3. the wallet handlers  zeroize32 / volatile  the signing and derivation scratch wiped after use
  4. the server loop    wipe(buf)             the request buffer wiped after every reply
```

Points 1 and 2 live in this pillar. `secure_wipe` volatile-zeroes a slice and fences
([`src/store/wipe.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/wipe.rs#L19)). The `Drop` on `KeyEntry` calls it, so when a key is deleted or the store is torn
down the raw bytes are erased from the heap rather than left in a freed allocation
([`src/store/types/key_entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types/key_entry.rs#L31)). `delete` wipes explicitly as well: it verifies the owner, removes the
entry, and volatile-wipes the removed key's `data` before returning ([`src/store/delete.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/delete.rs#L29)).

Point 2 overlaps point 1: the `KeyEntry` that `delete` removes and wipes is then dropped at the end of the
function, so its `data` is wiped a second time by the destructor. That is belt-and-suspenders, not a gap.

Points 3 and 4 live in the server pillar, wiping the signing scratch after every branch
([`src/server/zeroize.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/zeroize.rs#L17)) and the receive buffer after every reply ([`src/server/wipe.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wipe.rs#L19)); they are
detailed in [signing.md](/docs/userland/keyring/signing/) and [operations.md](/docs/userland/keyring/operations/).

The net result: a private key exists in cleartext only inside a `KeyEntry.data` in the store (wiped on drop
and on delete) and, momentarily, in a signing or derivation scratch buffer (wiped after use on every
branch). It is never left in a freed allocation or a stale request buffer.

### One honest note

`retrieve` and `eth_secret` both hand back an owned copy of the material: `retrieve` a `Vec` clone
(`retrieve.rs:34`) and `eth_secret` a `[u8; 32]` (`eth_secret.rs:37`). The signing handlers wipe their
`[u8; 32]` copy; the `retrieve` reply for a non-wallet key type is copied into the response buffer and then
the receive buffer is wiped, but the response `Vec` itself is not explicitly zeroed after the send. In
practice a wallet secret never travels that path, because `retrieve` refuses the `Secp256k1Eth` type
outright, so the un-zeroed reply only ever carries non-wallet material the owner asked to read back.

## What the store does not do

Stated plainly, so the model is not overread:

- `expires_at` is stored and reported in metadata but never enforced; a key does not expire on its own.
- The `locked` flag is an access gate, not at-rest encryption and not a second cryptographic factor. It
  refuses `retrieve` and `eth_secret` while set (`retrieve.rs:30`, `eth_secret.rs:28`) but does not
  re-encrypt or cryptographically bind the key.
- `use_count` is tracked and surfaced in metadata but is not an audit trail.
- Keys are held in RAM only, consistent with the RAM-resident posture; there is no persistent,
  at-rest-encrypted key store here.

## Source map

```
  userland/capsule_keyring/src/store/types/store.rs        the BTreeMap<u32, KeyEntry> and next_id
  userland/capsule_keyring/src/store/types/key_entry.rs    KeyEntry and its secure-wipe Drop
  userland/capsule_keyring/src/store/types/key_type.rs     the nine KeyType variants
  userland/capsule_keyring/src/store/types/constants.rs    MAX_KEYS = 128, MAX_KEY_SIZE = 256
  userland/capsule_keyring/src/store/types/store_error.rs  the StoreError variants
  userland/capsule_keyring/src/store/state.rs              Store::new, next_id = 1
  userland/capsule_keyring/src/store/store_key.rs          insert with bounds and full checks
  userland/capsule_keyring/src/store/retrieve.rs           owner check + Secp256k1Eth refusal + lock check
  userland/capsule_keyring/src/store/eth_secret.rs         the owner/type/lock/length-checked secret read
  userland/capsule_keyring/src/store/{delete,lock,unlock,metadata,count}.rs   the owner-checked operations
  userland/capsule_keyring/src/store/wipe.rs               secure_wipe (volatile + fence)
```

Every reference above is verified against those trees.
