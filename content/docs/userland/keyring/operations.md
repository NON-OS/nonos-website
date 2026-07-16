---
title: "Operations and the wire protocol"
description: "This page mirrors src/protocol/ and the dispatch layer of src/server/."
weight: 5
---
This page mirrors `src/protocol/` and the dispatch layer of `src/server/`. It covers the request and reply
frame, the fourteen operations with their exact payloads, the errno set, the caller-attestation rule that
runs before any key is touched, and the server loop that ties them together. For the key material itself
and its owner checks read [store.md](/docs/userland/keyring/store/); for the signers and their memory discipline read
[signing.md](/docs/userland/keyring/signing/). For the identity and capability mask read the [README](/docs/userland/keyring/).

## The frame

A request is an 8-byte header followed by a payload. The header carries a `u32` little-endian sequence and
a `u16` opcode; the remaining two header bytes are skipped. There is no magic and no length field
(`decode_request`, [`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19); `HDR_LEN = 8`, [`src/protocol/types.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L34)).

```
  request:   seq(4 LE) || op(2 LE) || pad(2) || payload
  reply:     seq(4 LE) || status(4 LE i32) || body
```

The reply reuses the same 8-byte front as `seq || status` and appends an optional body (`encode_response`,
[`src/protocol/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L21)). Status `0` is success; a negative status is one of the errno values below.
Every operation except `LIST_WALLET_RAILS` begins its payload with a 4-byte caller pid.

A frame shorter than 8 bytes fails to decode, the server wipes it and drops it, and no reply is sent
(`decode.rs:20`, [`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)).

## Caller attestation

Before any key operation runs, `resolve_caller` binds the pid claimed in the payload to the pid the kernel
attested on the message ([`src/server/caller.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/caller.rs#L17)):

```
  resolve_caller(payload_pid, sender_pid):
      if sender_pid == 0:            payload_pid    // kernel-side TCB, trusted
      if payload_pid == sender_pid:  sender_pid     // ring-3 caller must match its attested pid
      else:                          None -> EACCES
```

A ring-3 capsule can only act under its own attested pid, and every key operation is scoped to that pid, so
no capsule can retrieve, sign with, delete, lock, or read another capsule's key. A `sender_pid` of 0 is the
kernel-side trusted path and is allowed to name any pid in the payload. Every store, wallet, and signing
handler calls `resolve_caller` immediately after reading `payload_pid` and returns `EACCES` on `None`; the
one exception is `list_wallet_rails`, which reads no pid.

## The errno set

| Symbol | Value | Meaning | Source |
|--------|-------|---------|--------|
| `ENOENT` | -2 | no key with that id | [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17) |
| `EACCES` | -13 | caller mismatch, or an owner-pid check failed | `errno.rs:18` |
| `EBUSY` | -16 | the key is locked | `errno.rs:19` |
| `EINVAL` | -22 | bad length, bad field, or a crypto step failed | `errno.rs:20` |
| `ENOSPC` | -28 | the store is full (128 keys) | `errno.rs:21` |

The store's internal `StoreError` variants map onto these in each handler:
`NotFound -> ENOENT`, `AccessDenied -> EACCES`, `Locked -> EBUSY`, `Full -> ENOSPC`, and
`InvalidArgument -> EINVAL` (for example [`src/server/handlers/retrieve.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/retrieve.rs#L35)).

## Dispatch

`dispatch` matches the opcode to exactly one handler ([`src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L28)). An opcode outside
1..=14 replies `EINVAL` and touches nothing (`dispatch.rs:43`). The fourteen opcodes are constants in
[`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17).

### Store operations

| Op | Code | Request payload (after the 8-byte frame) | Reply body | Handler |
|----|------|------------------------------------------|------------|---------|
| `STORE` | 1 | `pid(4) \|\| now(8) \|\| expires(8) \|\| key_type(1) \|\| data_len(2) \|\| data` | `id(4)` | [`handlers/store.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/store.rs#L24) |
| `RETRIEVE` | 2 | `pid(4) \|\| id(4)` | `data` | [`handlers/retrieve.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/retrieve.rs#L22) |
| `DELETE` | 3 | `pid(4) \|\| id(4)` | empty | [`handlers/delete.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/delete.rs#L22) |
| `LOCK` | 4 | `pid(4) \|\| id(4)` | empty | [`handlers/lock.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/lock.rs#L22) |
| `UNLOCK` | 5 | `pid(4) \|\| id(4)` | empty | [`handlers/unlock.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/unlock.rs#L22) |
| `METADATA` | 6 | `pid(4) \|\| id(4)` | 36-byte record | [`handlers/metadata.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/metadata.rs#L22) |
| `COUNT` | 7 | `pid(4)` | `count(4)` | [`handlers/count.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/count.rs#L22) |

`STORE` bounds-checks the 23-byte header (`4 + 8 + 8 + 1 + 2`, `store.rs:22`), resolves the caller,
validates the key type through `KeyType::from_u8` ([`store/types/key_type_from_u8.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/types/key_type_from_u8.rs#L19), values 0..=8),
requires the frame length to equal `HDR + data_len` exactly (`store.rs:41`), and inserts under the next id.
An empty or over-256-byte body becomes `EINVAL` and a full store becomes `ENOSPC` (`store.rs:47`).

`RETRIEVE`, `DELETE`, `LOCK`, `UNLOCK`, `METADATA`, and `WALLET_ADDRESS` all require an exact 8-byte
payload (`pid || id`) and reply `EINVAL` on any other length (for example `retrieve.rs:23`). `COUNT`
requires exactly 4 bytes (`count.rs:23`).

`METADATA` serializes a fixed 36-byte record and exposes the counters but never the key
(`metadata.rs:41`):

```
  id(4) || key_type(1) || size(2) || owner_pid(4) || created_at(8) || expires_at(8) || use_count(8) || locked(1)
```

The owner-pid semantics of these operations, and why `RETRIEVE` refuses a wallet key, live in
[store.md](/docs/userland/keyring/store/).

### Wallet operations

| Op | Code | Request payload | Reply body | Handler |
|----|------|-----------------|------------|---------|
| `WALLET_IMPORT` | 8 | `pid(4) \|\| now(8) \|\| expires(8) \|\| secret(32)` | `id(4)` | [`handlers/wallet_import.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/wallet_import.rs#L22) |
| `WALLET_GENERATE` | 9 | `pid(4) \|\| now(8) \|\| expires(8)` | `id(4)` | [`handlers/wallet_generate.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/wallet_generate.rs#L22) |
| `WALLET_ADDRESS` | 10 | `pid(4) \|\| id(4)` | `address(20)` | [`handlers/wallet_address.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/wallet_address.rs#L22) |

`WALLET_IMPORT` takes a 52-byte payload (`4 + 8 + 8 + 32`, `wallet_import.rs:24`); `WALLET_GENERATE` takes
20 bytes (`4 + 8 + 8`, `wallet_generate.rs:24`). Both store the result as `KeyType::Secp256k1Eth` and wipe
their 32-byte scratch on every return path. `WALLET_ADDRESS` derives the Ethereum address without exporting
the key. The generation, validation, and wiping of these secrets is covered in [signing.md](/docs/userland/keyring/signing/).

### Signing operations

| Op | Code | Request payload | Reply body | Handler |
|----|------|-----------------|------------|---------|
| `SIGN_NOX_RECEIPT` | 11 | `pid(4) \|\| id(4) \|\| capsule_id(32) \|\| publisher(20) \|\| amount(32) \|\| nonce(32) \|\| epoch(32) \|\| expiry(32) \|\| type(32)` | `user(20) \|\| struct_hash(32) \|\| sig(65)` | [`handlers/sign_receipt/sign_receipt.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sign_receipt/sign_receipt.rs#L26) |
| `SIGN_NOX_APPROVE` | 12 | `pid(4) \|\| id(4) \|\| nonce(32) \|\| maxPriority(32) \|\| maxFee(32) \|\| gas(32) \|\| amount(32)` | raw signed tx | [`handlers/sign_approve.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sign_approve.rs#L25) |
| `SIGN_ETH_TRANSFER` | 13 | `pid(4) \|\| id(4) \|\| to(20) \|\| nonce(32) \|\| maxPriority(32) \|\| maxFee(32) \|\| gas(32) \|\| value(32)` | raw signed tx | [`handlers/sign_eth_transfer.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/sign_eth_transfer.rs#L25) |

`SIGN_NOX_APPROVE` requires exactly 164 bytes (`4 + 4 + 32*5`, `sign_approve.rs:26`), `SIGN_ETH_TRANSFER`
exactly 188 bytes (`4 + 4 + 20 + 32*5`, `sign_eth_transfer.rs:26`), and `SIGN_NOX_RECEIPT` exactly 220
bytes (`4 + 4 + 32 + 20 + 32*5`, `sign_receipt.rs:27`). All three retrieve the secret owner-checked, build
and hash the message, sign, and zero the secret; [signing.md](/docs/userland/keyring/signing/) walks each one.

### Wallet rail listing

| Op | Code | Request payload | Reply body | Handler |
|----|------|-----------------|------------|---------|
| `LIST_WALLET_RAILS` | 14 | none | `count(4) \|\| rail records` | [`handlers/list_wallet_rails.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/list_wallet_rails.rs#L22) |

`LIST_WALLET_RAILS` reads no pid and touches no key. It serializes a static table of four rails
([`handlers/list_wallet_rails.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/list_wallet_rails.rs#L23), encoder at [`src/server/wallet_rail/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wallet_rail/encode.rs#L21)); the table itself is
described in [signing.md](/docs/userland/keyring/signing/).

## The server loop

`run` owns a single `Store` and a 4096-byte receive buffer and loops forever ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)):

```
  run():
      buf   = vec![0u8; 4096]
      store = Store::new()                          // empty BTreeMap, next_id = 1
      loop:
          n = mk_ipc_recv_from(inbox 0, buf, &sender_pid)
          if n <= 0: continue
          match decode_request(buf[..n]):
              Some(req) => resp = dispatch(store, req, sender_pid)
              None      => wipe(buf[..n]); continue    // undersized frame, dropped
          mk_ipc_send(KERNEL_REPLY_ENDPOINT, resp)
          wipe(buf[..n])                               // volatile-zero after every reply
```

The reply always leaves through `KERNEL_REPLY_ENDPOINT = 0x1_0000_0002` ([`src/protocol/types.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L32)), the
endpoint id named in the manifest's reply record, and the kernel routes that frame back to the caller.

The receive buffer is wiped both when decode fails (`runner.rs:41`) and after every successful reply
(`runner.rs:46`), each through the volatile `wipe` with a compiler fence ([`src/server/wipe.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wipe.rs#L19)). This
matters because one request carries a raw secret on the wire: `WALLET_IMPORT` ships a 32-byte private key
in its payload, and wiping the buffer after the reply keeps that secret from lingering in the receive
buffer once the request is handled. The keyring makes no outbound calls of its own; it is a pure server.

## Callers

The keyring is reached by name through the registry. Three capsules drive it:

- [login](/docs/userland/login/) toggles the lock. Its client sends `OP_LOCK = 4` and `OP_UNLOCK = 5` with a
  `caller_pid(4) || key_id(4)` payload and reads the 4-byte status
  ([`userland/capsule_login/src/clients/keyring.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_login/src/clients/keyring.rs#L8)). Login unlocks the wallet key on a successful sign-in
  and locks it again when the session ends, which is how the lock flag becomes an authenticated-session
  gate on signing.
- The [wallet](/docs/userland/wallet-nonos/) drives the wallet ops: `OP_WALLET_GENERATE = 9`,
  `OP_WALLET_ADDRESS = 10`, `OP_SIGN_NOX_APPROVE = 12`, `OP_SIGN_ETH_TRANSFER = 13`, and
  `OP_LIST_WALLET_RAILS = 14` ([`userland/capsule_wallet_nonos/src/wallet/ipc/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallet_nonos/src/wallet/ipc/constants.rs#L19)), through a
  shared `keyring_call` helper that frames the request and checks the status
  ([`.../wallet/ipc/call.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../wallet/ipc/call.rs#L23)). The wallet never sees a secret.
- The [payment](/docs/userland/payment/) capsule calls `OP_SIGN_NOX_RECEIPT = 11` to settle a paid request
  (`KEYRING_OP_SIGN_RECEIPT`, [`userland/capsule_payment/src/server/consts.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/consts.rs#L21)), passing the owner pid
  and wallet key id ([`.../capsule_payment/src/server/handlers/pay.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../capsule_payment/src/server/handlers/pay.rs#L39)).

## Source map

```
  userland/capsule_keyring/src/protocol/types.rs      op constants, HDR_LEN, KERNEL_REPLY_ENDPOINT, Request
  userland/capsule_keyring/src/protocol/decode.rs     the 8-byte-header request decode
  userland/capsule_keyring/src/protocol/encode.rs     the seq || status || body reply encode
  userland/capsule_keyring/src/protocol/errno.rs      ENOENT EACCES EBUSY EINVAL ENOSPC
  userland/capsule_keyring/src/server/runner.rs       the loop and the receive-buffer wipe
  userland/capsule_keyring/src/server/dispatch.rs     op -> handler dispatch
  userland/capsule_keyring/src/server/caller.rs       resolve_caller, the no-impersonation rule
  userland/capsule_keyring/src/server/wipe.rs         the volatile buffer wipe
  userland/capsule_keyring/src/server/handlers/       one file per op, the length checks and errno mapping
  userland/capsule_login/src/clients/keyring.rs       the login lock/unlock client
  userland/capsule_wallet_nonos/src/wallet/ipc/       the wallet keyring client and op constants
  userland/capsule_payment/src/server/consts.rs       the payment receipt-sign op constant
  userland/capsule_payment/src/server/handlers/pay.rs the payment caller
```

Every reference above is verified against those trees.
