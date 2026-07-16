---
title: "Operations and record layout"
description: "This page mirrors src/protocol/, src/server/handlers/, src/server/token/, and src/store/."
weight: 2
---
This page mirrors `src/protocol/`, `src/server/handlers/`, `src/server/token/`, and `src/store/`. It is
the wire-level reference: the four operations, the request and reply framing, the exact byte layout of the
`pay` payload and the drained record, the static token registry, and the per-payer nonce and bounded
outbox that back it all. For the signing path that `pay` runs through, see [signing.md](/docs/userland/payment/signing/); for
identity and the capability mask, see the [README](/docs/userland/payment/).

## The frame

A request is an eight-byte header followed by the operation payload. The decoder requires at least the
header and hands the remainder to the handler as `payload` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), `HDR_LEN = 8` at
[`src/protocol/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L24)):

```
  request:
      [0..4]   seq     (u32 LE)
      [4..6]   op      (u16 LE)
      [6..8]   pad     (2 bytes, ignored)
      [8..]    payload (operation-specific)
```

A reply is `seq(4 LE) | status(4 LE, i32)` followed by the reply payload ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)).
`status` is zero on success and a negative errno on failure. The dispatcher matches the opcode and falls
through to `EINVAL` for anything it does not know, so a missing arm fails closed
([`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25)).

The four opcodes ([`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17)):

| Op | Opcode | Handler | Request payload | Reply payload |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | `handlers::health` | none | empty |
| `OP_PAY` | 2 | `handlers::pay` | 124-byte fixed layout | 32-byte `struct_hash` |
| `OP_DRAIN_RECEIPTS` | 3 | `handlers::drain` | none | `count(4 LE)` then N records |
| `OP_LIST_TOKENS` | 4 | `handlers::tokens` | none | `count(4 LE)` then N token entries |

## HEALTHCHECK (op 1)

Returns `status = 0` with an empty payload. It is a pure liveness probe with no side effects
([`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21)).

## PAY (op 2)

This is the signing path ([`src/server/handlers/pay.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/pay.rs#L33)). The request payload is exactly 124 bytes; a
different length is rejected with `EINVAL` (`pay.rs:35`, the `HDR` constant is
`4 + 4 + 32 + 20 + 32 + 32 = 124` at `pay.rs:34`):

```
  payload (124 bytes):
      [0..4]     owner_pid    (u32 LE)     pay.rs:39
      [4..8]     wallet_id    (u32 LE)     pay.rs:40
      [8..40]    capsule_id   (32)         word32(p, 8),  pay.rs:53
      [40..60]   publisher    (20)         addr20(p, 40), pay.rs:41   (a 20-byte address)
      [60..92]   amount       (32)         word32(p, 60), pay.rs:55   (256-bit big-endian value)
      [92..124]  receipt_type (32)         word32(p, 92), pay.rs:59
```

The flow, in order (`pay.rs:33`):

```
  pay(state, req):
      require payload.len() == 124                    else EINVAL     pay.rs:35
      owner_pid, wallet_id, publisher = decode header                 pay.rs:39
      now_ms = mk_time_millis()                                       pay.rs:42
      port   = keyring_port()                          else EAGAIN    pay.rs:43
      require now_ms > 0                                else EINVAL    pay.rs:47
      now_secs = now_ms / 1000                                        pay.rs:50
      nonce = state.next_nonce(owner_pid, wallet_id, publisher, now_ms)   pay.rs:51
      f = ReceiptInput {
              capsule_id, publisher, amount,
              nonce  = u64_word(nonce),
              epoch  = u64_word(current_epoch(now_secs)),
              expiry = u64_word(expiry_at(now_secs)),
              receipt_type }                                          pay.rs:52
      signed = sign_receipt(port, owner_pid, wallet_id, f)  else <err> pay.rs:61
      if not state.push_receipt(build_record(f, signed)):   EAGAIN     pay.rs:65
      return signed.struct_hash                          (32 bytes)    pay.rs:68
```

Note the ordering: the keyring port is resolved before the clock is validated (`pay.rs:43` then `:47`), so
an unreachable keyring is reported as `EAGAIN` even if the clock is also bad. The nonce, epoch, and expiry
are derived here and marshaled into 32-byte words; the derivation rules are below, the signing call is in
[signing.md](/docs/userland/payment/signing/).

The nonce floor is the request's millisecond timestamp: `next_nonce` advances the stored slot to
`floor.max(slot + 1)` ([`src/store/nonce.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/nonce.rs#L32)), so the nonce tracks wall-clock time and never goes
backwards or repeats for a payer. The epoch is `(now_secs - EPOCH_ZERO) / EPOCH_DURATION`, zero before the
genesis time ([`src/server/epoch.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/epoch.rs#L19), `EPOCH_ZERO = 1778011403`, `EPOCH_DURATION = 86400` at
[`src/server/consts.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/consts.rs#L17)). The expiry is `now_secs + RECEIPT_TTL_SECS` with a saturating add
([`src/server/expiry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/expiry.rs#L19), `RECEIPT_TTL_SECS = 86400` at `consts.rs:19`), so every receipt carries a
one-day validity window from issuance.

PAY error cases, each cited:

| Condition | Errno | Value | Source |
|---|---|---|---|
| Payload not exactly 124 bytes | `EINVAL` | -22 | `pay.rs:35`, `types.rs:26` |
| Keyring service not resolvable | `EAGAIN` | -11 | `pay.rs:45`, `discover.rs:26` |
| Wall clock reads zero or negative | `EINVAL` | -22 | `pay.rs:47` |
| Keyring sign call failed | keyring status | passthrough | `pay.rs:63`, `sign_call.rs:50` |
| Keyring reply short | `EAGAIN` | -11 | `sign_call.rs:47` |
| Outbox full at 1024 records | `EAGAIN` | -11 | `pay.rs:66`, `outbox.rs:23` |
| Success | 0 | | `pay.rs:68` |

When the keyring returns a non-zero status, that status is passed straight back to the caller; the sign
helper turns a short reply into `-11` itself (`sign_call.rs:47`).

## DRAIN_RECEIPTS (op 3)

Takes no payload ([`src/server/handlers/drain.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/drain.rs#L23)). It removes up to `DRAIN_BATCH_MAX` records from the
front of the outbox and returns them as `count(4 LE)` followed by the raw records (`drain.rs:24`).
`take_batch` drains `min(outbox.len(), max)` records from index 0 ([`src/store/drain.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/drain.rs#L22)), and
`DRAIN_BATCH_MAX = (4096 - 12) / RECORD_LEN` is 13 with `RECORD_LEN = 297` ([`src/server/consts.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/consts.rs#L23)). So
a drain returns at most thirteen 297-byte records per call, bounded by the reply buffer. This is the
withdraw side: an off-capsule settlement process periodically drains the accrued receipts. It always
returns `status = 0`, even when the outbox is empty (the count is then zero).

Each drained record is 297 bytes with a fixed layout ([`src/server/record.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/record.rs#L21)):

```
  record (297 bytes):
      [0..20]     user         (the signer address the keyring returned)   record.rs:23
      [20..52]    capsule_id   (32)                                        record.rs:24
      [52..72]    publisher    (20)                                        record.rs:25
      [72..104]   amount       (32)                                        record.rs:26
      [104..136]  nonce        (32)                                        record.rs:27
      [136..168]  epoch        (32)                                        record.rs:28
      [168..200]  expiry       (32)                                        record.rs:29
      [200..232]  receipt_type (32)                                        record.rs:30
      [232..297]  signature    (65)  (secp256k1 r || s || v)               record.rs:31
```

The record's leading `user` is the address the keyring derived from its secret and returned, not the
`publisher` from the request; the two are distinct fields. `build_record` writes the eight receipt fields
plus the 65-byte signature in this exact order (`record.rs:21`), and the drainer must read them the same
way.

## LIST_TOKENS (op 4)

Takes no payload and returns the static token registry ([`src/server/handlers/tokens.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tokens.rs#L22)).
`encode_token_list` writes `count(4 LE)` then, per token, `symbol_len(1) | decimals(1) | settlement(2 LE)
| flags(4 LE) | chain_id(8 LE) | contract(20) | symbol(symbol_len)` ([`src/server/token/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/token/encode.rs#L21)). It
always returns `status = 0`.

The registry is three fixed entries ([`src/server/token/registry.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/token/registry.rs#L21)):

| Symbol | Decimals | Chain | Settlement | Flags | Contract |
|---|---|---|---|---|---|
| `ETH` | 18 | Ethereum mainnet (1) | native | `ENABLED \| NATIVE` | zero (native) |
| `NOX` | 18 | Ethereum mainnet (1) | NOX receipt | `ENABLED \| ERC20 \| RECEIPT_SETTLED` | `0x0a26c80be4e060e688d7c23addb92cbb5d2c9eca` |
| `PR` | 18 | Base mainnet (8453) | x402 (Primer) | `ERC20 \| X402_SETTLED \| CONFIG_REQUIRED` | zero (pending) |

The settlement kinds (`SETTLEMENT_NATIVE_ETH = 1`, `SETTLEMENT_NOX_RECEIPT = 2`,
`SETTLEMENT_X402_PRIMER = 3`) and the flag bits are defined in [`src/server/token/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/token/constants.rs#L17), the
chain ids `ETHEREUM_MAINNET = 1` and `BASE_MAINNET = 8453` at `constants.rs:28`, and the contract
addresses in [`src/server/token/addresses.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/token/addresses.rs#L17). The `PR` entry is a placeholder: its contract is
all-zero (`PRIMER_PENDING` at `addresses.rs:22`), it does not carry the `ENABLED` bit, and it is flagged
`CONFIG_REQUIRED`, so it is declared but not usable as shipped (`registry.rs:38`).

## Backing state

`State` holds two things and lives only for the life of the process ([`src/store/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L22)): a
`BTreeMap<[u8; 40], u64>` of per-payer nonces, and a `Vec<Vec<u8>>` outbox of encoded records. Both start
empty ([`src/store/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L23)).

The nonce is drawn per payer. `next_nonce` builds the 40-byte key from `owner_pid(4 LE) | wallet_id(4 LE)
| publisher(20)` ([`src/store/nonce.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/nonce.rs#L27); the trailing 12 bytes of the key stay zero), reads the stored
slot, and advances it to `floor.max(slot + 1)` where `floor` is the request timestamp
(`nonce.rs:32`). Two receipts from the same payer are therefore strictly ordered, and the nonce never
repeats.

The outbox is bounded. `push_receipt` refuses a new record once the outbox holds `MAX_OUTBOX = 1024`,
returning `false` ([`src/store/outbox.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/outbox.rs#L23), `MAX_OUTBOX` at [`src/store/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L20)), which the `pay`
handler surfaces as `EAGAIN`. `take_batch` drains from the front, so records leave in the order they were
queued ([`src/store/drain.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/drain.rs#L22)).

## Source map

```
  userland/capsule_payment/src/protocol/decode.rs        the eight-byte header decode
  userland/capsule_payment/src/protocol/encode.rs        the seq|status reply framing
  userland/capsule_payment/src/protocol/types.rs         the four opcodes, HDR_LEN, EINVAL, EAGAIN
  userland/capsule_payment/src/server/dispatch.rs        opcode match, EINVAL default
  userland/capsule_payment/src/server/handlers/health.rs the liveness probe
  userland/capsule_payment/src/server/handlers/pay.rs    the 124-byte pay path and its error cases
  userland/capsule_payment/src/server/handlers/drain.rs  the batch withdraw (<= 13 records)
  userland/capsule_payment/src/server/handlers/tokens.rs the static token list
  userland/capsule_payment/src/server/record.rs          the 297-byte record layout
  userland/capsule_payment/src/server/epoch.rs, expiry.rs  epoch and one-day expiry from the wall clock
  userland/capsule_payment/src/server/consts.rs          EPOCH_ZERO, TTL, RECORD_LEN, DRAIN_BATCH_MAX
  userland/capsule_payment/src/server/token/             the registry, addresses, flags, and encoder
  userland/capsule_payment/src/store/                    State: next_nonce, push_receipt, take_batch, MAX_OUTBOX
```

Every reference above is verified against those trees.
