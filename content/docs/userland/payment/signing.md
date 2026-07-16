---
title: "The signing path"
description: "This page mirrors src/server/signcall.rs, src/server/discover.rs, src/server/fields.rs, and the field marshalers (word32.rs, u64word.rs, addr20.rs)."
weight: 3
---
This page mirrors [`src/server/sign_call.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sign_call.rs), [`src/server/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/discover.rs), [`src/server/fields.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/fields.rs), and the
field marshalers (`word32.rs`, `u64_word.rs`, `addr20.rs`). It follows a `pay` from the moment the handler
has its fields to the moment the keyring returns a signed receipt, and it says plainly where key custody
lives and where the real consent check happens. For the wire layout of the `pay` request itself, see
[operations.md](/docs/userland/payment/operations/); for the keyring on the other end, see the [keyring](/docs/userland/keyring/).

The capsule never touches key material. It assembles the receipt bytes and stores the reply; the
secp256k1 secret is loaded, used, and wiped inside the keyring alone.

## Resolving the keyring

The capsule reaches the keyring by name, not by a hardcoded port. `keyring_port` calls
`mk_service_lookup` for the service name `keyring` and returns the resolved port, or `None` on a non-zero
lookup result ([`src/server/discover.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/discover.rs#L21), `KEYRING_SERVICE = b"keyring"` at [`src/server/consts.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/consts.rs#L20)).
A `None` here is what the `pay` handler surfaces to its caller as `EAGAIN`
([`src/server/handlers/pay.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/pay.rs#L45)). This is the only service discovery the capsule does, and it happens on
every `pay`, so a keyring that is not yet up is a transient failure rather than a hard one.

## Marshaling the receipt fields

`pay` builds a `ReceiptInput` of seven 32-byte-and-under fields ([`src/server/fields.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/fields.rs#L17)): `capsule_id`,
`publisher` (20 bytes), `amount`, `nonce`, `epoch`, `expiry`, and `receipt_type`. The scalar fields are
marshaled big-endian:

- `u64_word` places a `u64` in the low 8 bytes of a 32-byte word, high bytes zero
  ([`src/server/u64_word.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/u64_word.rs#L17)). This is how `nonce`, `epoch`, and `expiry` become 32-byte words.
- `word32` copies a 32-byte field verbatim from the request payload ([`src/server/word32.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/word32.rs#L17)). This
  carries `capsule_id`, `amount`, and `receipt_type` through unchanged, so `amount` stays a 256-bit
  big-endian value exactly as the caller sent it.
- `addr20` copies the 20-byte `publisher` address ([`src/server/addr20.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/addr20.rs#L17)).

These helpers are the single source of the on-wire field layout. The keyring request in `sign_call.rs` and
the drained record in `record.rs` both consume a `ReceiptInput` and must stay in lockstep with this field
order.

## The sign call

`sign_receipt` issues one synchronous `mk_ipc_call` to the keyring port and parses the fixed-size reply
([`src/server/sign_call.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sign_call.rs#L25)).

The request it builds is `seq(4)=0 | op(2) | pad(2) | owner_pid(4 LE) | wallet_id(4 LE)` followed by the
seven receipt words `capsule_id | publisher | amount | nonce | epoch | expiry | receipt_type`, using
`KEYRING_OP_SIGN_RECEIPT = 11` (`sign_call.rs:31`, the constant at [`src/server/consts.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/consts.rs#L21)). That opcode
matches the keyring's `OP_SIGN_NOX_RECEIPT = 11` ([`userland/capsule_keyring/src/protocol/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/protocol/types.rs#L27)),
which the keyring dispatch routes to its `sign_receipt` handler
([`userland/capsule_keyring/src/server/dispatch.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/dispatch.rs#L39)). Note the `publisher` is sent as a 20-byte address
inside the request, while the keyring's own struct hash uses the signer's derived `user` address, not the
publisher.

```
  keyring request (8 + 220 bytes):
      [0..4]    seq = 0                             sign_call.rs:32
      [4..6]    op  = 11                            sign_call.rs:33
      [6..8]    pad = 0                             sign_call.rs:34
      [8..12]   owner_pid   (u32 LE)                sign_call.rs:35
      [12..16]  wallet_id   (u32 LE)                sign_call.rs:36
      [16..48]  capsule_id  (32)                    sign_call.rs:37
      [48..68]  publisher   (20)                    sign_call.rs:38
      [68..100] amount      (32)                    sign_call.rs:39
      [100..132] nonce      (32)                    sign_call.rs:40
      [132..164] epoch      (32)                    sign_call.rs:41
      [164..196] expiry     (32)                    sign_call.rs:42
      [196..228] receipt_type (32)                  sign_call.rs:43
```

The reply is a 125-byte frame, `seq(4) | status(4) | user(20) | struct_hash(32) | signature(65)`. The
helper allocates `8 + 117` bytes and requires the call to return at least that many, returning `-11`
otherwise (`sign_call.rs:44`). It then reads the keyring's status and returns it verbatim if non-zero
(`sign_call.rs:49`), and on success copies out the 20-byte `user`, the 32-byte `struct_hash`, and the
65-byte `signature` (`sign_call.rs:53`):

```
  keyring reply (8 + 117 bytes):
      [0..4]    seq
      [4..8]    status (i32 LE)                     sign_call.rs:49
      [8..28]   user         (20)                   sign_call.rs:54
      [28..60]  struct_hash  (32)                   sign_call.rs:55
      [60..125] signature    (65)                   sign_call.rs:56
```

Back in `pay`, a non-zero status is passed straight through to the original caller
([`src/server/handlers/pay.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/pay.rs#L63)), the `struct_hash` becomes the successful reply payload
(`pay.rs:68`), and the `user`, fields, and `signature` are assembled into the 297-byte outbox record by
`build_record` ([`src/server/record.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/record.rs#L21)).

## Where custody and consent live

Two properties matter here and neither of them lives in this capsule.

Key custody is the keyring's. The secp256k1 secret is loaded inside the keyring's `sign_receipt`, used to
sign the EIP-712 digest, and zeroized before the handler returns
([`userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs#L60)). The payment capsule has
no `Crypto` capability and never invokes a kernel crypto syscall; if it is fully compromised it still
cannot extract a private key, because it never sees one.

Consent is the keyring's owner-pid check, not this capsule's. The payment capsule does not verify who its
caller is; the `pay` handler trusts the `owner_pid` and `wallet_id` in the request payload and forwards
them. The keyring decides whether the caller may sign for the requested wallet: it resolves the caller pid
and returns `EACCES` if that resolution fails
([`userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs#L35)), then fetches the secret
with `eth_secret(id, caller_pid)` and returns `EACCES` again if the caller does not own that wallet
(`sign_receipt.rs:40`). So the guarantee that a wallet actually authorized a payment lives in whether the
caller holds the wallet, checked at the keyring's boundary, not in the payment capsule. The payment
capsule is a receipt issuer and queue, not a consent boundary. That honest boundary, together with the
capsule not being spawned at boot, is called out on the [README](/docs/userland/payment/) and the
[debugging](/docs/userland/payment/debugging/) page.

## Source map

```
  userland/capsule_payment/src/server/discover.rs        keyring service lookup by name
  userland/capsule_payment/src/server/sign_call.rs       the synchronous keyring sign IPC call
  userland/capsule_payment/src/server/fields.rs          ReceiptInput and SignedReceipt
  userland/capsule_payment/src/server/word32.rs, u64_word.rs, addr20.rs   the field marshalers
  userland/capsule_payment/src/server/consts.rs          KEYRING_SERVICE, KEYRING_OP_SIGN_RECEIPT
  userland/capsule_payment/src/server/handlers/pay.rs    where the sign call is issued and its result used
  userland/capsule_keyring/src/protocol/types.rs         OP_SIGN_NOX_RECEIPT = 11
  userland/capsule_keyring/src/server/dispatch.rs        routes op 11 to the keyring sign handler
  userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs   custody, owner-pid check, zeroize
```

Every reference above is verified against those trees.
