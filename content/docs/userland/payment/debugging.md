---
title: "Debugging capsule_payment"
description: "This page covers how to tell whether the capsule is even reachable, and the concrete request-time failure signatures with where to look for each."
weight: 5
---
This page covers how to tell whether the capsule is even reachable, and the concrete request-time failure
signatures with where to look for each. For the operation layout see the [operations](/docs/userland/payment/operations/) page,
for the keyring path see the [signing](/docs/userland/payment/signing/) page, and for the design see the [README](/docs/userland/payment/).

## There is no boot marker

The first thing to establish is whether a `payment` service is reachable at all, because this capsule is
not spawned at boot. There is no `[PAYMENT] capsule spawned` line to look for. `payment` has no entry in
`src/userspace/init/spawn_plan/`, and the kernel mirror `src/security/payment_capsule` declared in
`Capsule.mk:18` does not exist on disk, so kernel init never brings the capsule up as shipped. The way to
tell it is running is whether `mk_service_lookup("payment")` resolves; if nothing spawned it, the lookup
fails and there is no port to send to. Anything that wants to exercise `pay` has to spawn the capsule
first.

## Failure modes

Once a `payment` service is running, the request-time failure signatures are below. Every failure comes
back as a negative errno in the reply status, never a dropped connection or a panic.

### EAGAIN (-11)

Three distinct causes, all transient:

- The keyring port cannot be resolved on a `pay`, so the receipt cannot be signed
  ([`src/server/handlers/pay.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/pay.rs#L45), [`src/server/discover.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/discover.rs#L26)). This is the usual signature when the
  keyring itself is not up. Confirm the keyring service is spawned and registered.
- The keyring reply is short, which the sign helper reports as `-11`
  ([`src/server/sign_call.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sign_call.rs#L47)).
- The outbox is full at its 1024-record cap, so `push_receipt` refuses the new record
  (`pay.rs:66`, [`src/store/outbox.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/outbox.rs#L23)). Drain the outbox with `OP_DRAIN_RECEIPTS` to clear it.

### EINVAL (-22)

- A `pay` payload that is not exactly 124 bytes (`pay.rs:35`).
- A `pay` when the wall clock reads zero or negative (`pay.rs:47`); `mk_time_millis` has not produced a
  usable time yet.
- Any request whose opcode is not 1 through 4; the dispatcher's default arm returns `EINVAL`
  ([`src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L31)).

### A keyring status passed straight through

On a `pay`, a non-zero keyring status is returned to the caller verbatim (`pay.rs:63`). The one that
matters most is `EACCES`, which the keyring returns when the caller does not own the wallet it is asking
to sign for ([`userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs#L35),
`sign_receipt.rs:40`). An `EACCES` here is not a payment-capsule bug; it is the keyring's consent check
firing, and it means the caller pid does not own `wallet_id`.

## Reading a reply

- A `pay` that returns `status = 0` with a 32-byte payload succeeded, and that payload is the receipt's
  `struct_hash` (`pay.rs:68`).
- A `drain` always returns `status = 0`; a count of zero in its payload means the outbox was empty
  ([`src/server/handlers/drain.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/drain.rs#L26)). Otherwise the payload is `count(4 LE)` then that many 297-byte
  records, at most 13 per call.
- A `list_tokens` always returns `status = 0` with the three-entry registry
  ([`src/server/handlers/tokens.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tokens.rs#L22)).
- No reply at all means the frame was shorter than the eight-byte header or otherwise undecodable, and the
  runner skipped it with `continue` ([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32), [`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20)).

## Source map

```
  src/userspace/init/spawn_plan/                    checked and has no payment entry (capsule is not spawned)
  userland/capsule_payment/Capsule.mk               declares the non-existent kernel mirror
  userland/capsule_payment/src/server/runner.rs     the recv/dispatch/send loop; skips undecodable frames
  userland/capsule_payment/src/server/dispatch.rs   EINVAL default for an unknown opcode
  userland/capsule_payment/src/server/handlers/pay.rs   the EAGAIN, EINVAL, and passthrough cases
  userland/capsule_payment/src/server/discover.rs   the keyring lookup that yields EAGAIN
  userland/capsule_payment/src/server/sign_call.rs  the short-reply -> -11 case
  userland/capsule_payment/src/store/outbox.rs      the 1024-record cap
  userland/capsule_keyring/src/server/handlers/sign_receipt/sign_receipt.rs   the EACCES owner-pid check
```

Every reference above is verified against those trees.
