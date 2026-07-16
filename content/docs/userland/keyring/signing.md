---
title: "The signing paths and wallet non-exportability"
description: "This page mirrors the signing subtree of src/server/: the three signers, address derivation, the EIP-1559 and EIP-712 message builders, the RLP encoder, the scratch-zeroing help..."
weight: 6
---
This page mirrors the signing subtree of `src/server/`: the three signers, address derivation, the
EIP-1559 and EIP-712 message builders, the RLP encoder, the scratch-zeroing helper, and the static wallet
rail table. The single idea that ties it together is that a wallet secret is used inside the capsule and
never returned. For the store method that hands a secret to these handlers read [store.md](/docs/userland/keyring/store/); for
the request framing read [operations.md](/docs/userland/keyring/operations/).

## The shape every signer shares

The three signers, `sign_eth_transfer`, `sign_approve`, and `sign_receipt`, all follow the same five steps:

```
  1. resolve_caller(payload_pid, sender_pid)        // EACCES on mismatch
  2. secret = store.eth_secret(id, caller_pid)      // owner + Secp256k1Eth + lock + 32-byte checks
  3. build and keccak-256 the message
  4. secp256k1-sign the digest, then zeroize32 the secret immediately
  5. re-encode with the signature and reply
```

Step 2 is the owner check enforced a second time: `resolve_caller` already bound the caller, and
`eth_secret` re-checks `owner_pid` inside the store ([`src/store/eth_secret.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/eth_secret.rs#L22)). Step 4 is the memory
discipline: the 32-byte secret is zeroed the instant the signature is produced, and on every error branch
too, through `zeroize32`, a volatile write plus a compiler fence ([`src/server/zeroize.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/zeroize.rs#L17)). No signer
returns the secret; they return signatures, hashes, and addresses.

## sign_eth_transfer (op 13)

This is the fullest illustration ([`src/server/handlers/sign_eth_transfer.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sign_eth_transfer.rs#L25)). The request is exactly
188 bytes (`4 + 4 + 20 + 32*5`, `sign_eth_transfer.rs:26`). After resolving the caller and reading the
secret owner-checked, it reads `to`, `nonce`, `maxPriority`, `maxFee`, `gas`, and `value` (each 32-byte
field pulled by `field32`, [`src/server/field32.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/field32.rs#L17)), builds the unsigned EIP-1559 payload, Keccak-256
hashes it, and signs the digest:

```
  unsigned = unsigned_eth_transfer_payload(nonce, max_priority, max_fee, gas, to, value)
  keccak256(unsigned) -> digest        // zeroize32(secret) + EINVAL on failure  (:55)
  secp256k1_sign(secret, digest) -> sig(65)
  zeroize32(secret)                    // immediately after the sign  (:60)
  reject if rc != 65 or sig[64] < 27   // v byte must be >= 27  (:61)
  raw = signed_eth_transfer_tx(parts, sig[64] - 27, r, s)   // y_parity = v - 27
```

The signature is a 65-byte recoverable `r || s || v`; the handler splits `r` and `s` and passes recovery
parity `v - 27` into the signed re-encoding (`sign_eth_transfer.rs:68`). The secret is zeroed on the keccak
failure branch (`:55`) and immediately after the sign (`:60`), so it never survives past the signature.

## sign_approve (op 12)

`sign_approve` signs a NOX ERC-20 `approve` as an EIP-1559 transaction against the settlement contract
([`src/server/handlers/sign_approve.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sign_approve.rs#L25)), over a 164-byte request (`4 + 4 + 32*5`, `sign_approve.rs:26`).
It follows the identical retrieve-hash-sign-wipe path, zeroing on the keccak branch (`:52`) and after the
sign (`:57`). The transaction pays no ETH value; instead it carries `approve` calldata to the NOX token.

The NOX token address, the settlement (spender) address, the `approve` selector `0x095ea7b3`, and the chain
id `1` are fixed constants ([`src/server/eip1559/consts.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip1559/consts.rs#L17)). The calldata is a fixed 68 bytes: the
4-byte selector, the 20-byte settlement address right-aligned in a 32-byte word, and the 32-byte amount
([`src/server/eip1559/approve_data.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip1559/approve_data.rs#L19)).

## sign_receipt (op 11)

`sign_receipt` is the EIP-712 payment path ([`src/server/handlers/sign_receipt/sign_receipt.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sign_receipt/sign_receipt.rs#L26)), over a
220-byte request (`4 + 4 + 32 + 20 + 32*5`, `sign_receipt.rs:27`). It differs in that it derives the
signer's own address first and returns it alongside the signature:

```
  secret = eth_secret(id, caller_pid)
  user   = address_of(secret)          // zeroize32 + EINVAL on failure  (:46)
  fields = read_fields(payload, user)  // the typed ReceiptFields
  sh     = struct_hash(fields)         // keccak of typehash || encoded fields
  digest = receipt_digest(sh)          // keccak of 0x19 01 || domain || sh
  secp256k1_sign(secret, digest) -> sig(65)
  zeroize32(secret)                    // immediately after the sign  (:61)
  reply = user(20) || struct_hash(32) || sig(65)
```

`read_fields` assembles the `ReceiptFields` from the payload, reading `capsule_id`, `publisher`,
`amount_nox`, `nonce`, `epoch`, `expiry`, and `receipt_type` at their fixed offsets and taking `user` from
the derived address ([`src/server/handlers/sign_receipt/read_fields.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sign_receipt/read_fields.rs#L19)). `struct_hash` lays the type
hash and the eight encoded fields into a 288-byte preimage and Keccak-256 hashes it, with the two 20-byte
address fields right-aligned in their 32-byte words ([`src/server/eip712/struct_hash.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip712/struct_hash.rs#L20)). `receipt_digest`
prefixes `0x19 0x01`, the domain separator, and the struct hash into a 66-byte preimage and hashes that
([`src/server/eip712/digest.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip712/digest.rs#L19)). The receipt type hash and the domain separator are fixed constants
([`src/server/eip712/consts.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip712/consts.rs#L17)). This is the op the [payment](/docs/userland/payment/) capsule calls to
settle a paid request.

## Address derivation

`wallet_address` (op 10) and the receipt signer both derive an Ethereum address from a secret without
exporting it. The shared derivation is `address_of` ([`src/server/ethaddr.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/ethaddr.rs#L17)): compute the uncompressed
65-byte secp256k1 public key, Keccak-256 the 64-byte body (dropping the `0x04` prefix), and take the low 20
bytes of the digest.

```
  address_of(secret):
      pubkey(65) = secp256k1_pubkey(secret)     // fail if not 65
      hash(32)   = keccak256(pubkey[1..65])     // the 64-byte body
      return hash[12..32]                       // the low 20 bytes
```

The `wallet_address` handler inlines the same derivation and, importantly, wipes the secret between the
pubkey call and the hash: it reads the secret owner-checked through `eth_secret`, computes the pubkey, then
volatile-zeroes the secret before hashing and replying with the 20-byte address
([`src/server/handlers/wallet_address.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/wallet_address.rs#L33), wipe at `:40`).

## Generating and importing wallet keys

`wallet_generate` (op 9) draws a 32-byte secret from the kernel secure RNG and validates it as a proper
secp256k1 scalar, retrying up to 32 times; on 32 failures it wipes the scratch and returns `EINVAL`
([`src/server/handlers/wallet_generate.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/wallet_generate.rs#L37)). `eth_secret_valid` rejects the all-zero scalar and any value
at or above the curve order `n`, by a constant big-endian comparison against `N`
([`src/store/eth_valid.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/eth_valid.rs#L17)). The valid secret is stored as `KeyType::Secp256k1Eth`, and the local scratch
is volatile-zeroed whether the store succeeded or not (`wallet_generate.rs:44`, `:50`).

`wallet_import` (op 8) takes a caller-supplied 32-byte secret, validates it the same way, stores it, and
wipes the scratch on both the reject and the success paths (`wallet_import.rs:37`, then `:38` and `:44`).
This is the one operation where a secret rides in on the request wire, which is exactly why the server loop
wipes the receive buffer after every reply (see [operations.md](/docs/userland/keyring/operations/)).

## The RLP encoder

The signers encode EIP-1559 transactions with the capsule's own minimal RLP encoder under
`src/server/rlp/`. `tx_fields` lays out the nine-field type-2 transaction (chain id, nonce, maxPriority,
maxFee, gas, to, value, data, and an empty access list) ([`src/server/eip1559/fields.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip1559/fields.rs#L23));
`nox_approve_fields` and `eth_transfer_fields` specialize it (`fields.rs:46`, `:65`). `unsigned_*_payload`
prefixes the type byte `0x02` and RLP-encodes the field list ([`src/server/eip1559/unsigned.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip1559/unsigned.rs#L23));
`signed_*_tx` appends `y_parity`, `r`, and `s` before the same encoding ([`src/server/eip1559/signed.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/eip1559/signed.rs#L23)).

The RLP primitives are one unit per file: `rlp_list` ([`src/server/rlp/encode_list.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/rlp/encode_list.rs#L21)), `rlp_string`
with the single-low-byte special case (`encode_str.rs:22`), `rlp_uint_be` stripping leading zeros
(`encode_uint.rs:21`), the `len_prefix` short/long form split at 55 bytes (`len_prefix.rs:22`), and
`minimal_be` (`minimal_be.rs:19`).

## The wallet rail table (op 14)

`list_wallet_rails` serializes a static table of four rails and touches no secret and no store entry
([`src/server/handlers/list_wallet_rails.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/list_wallet_rails.rs#L22)). Each record is the symbol length, family, status, flags,
chain id, contract address, and symbol bytes ([`src/server/wallet_rail/encode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wallet_rail/encode.rs#L21)), read from the static
`WALLET_RAILS` array ([`src/server/wallet_rail/registry.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wallet_rail/registry.rs#L21)):

| Symbol | Family | Status | Chain | Note |
|--------|--------|--------|-------|------|
| `ETH` | native | enabled | 1 | keyring-signed |
| `NOX` | ERC-20 | enabled | 1 | keyring-signed, the NOX token |
| `PR` | x402 | config-required | 8453 | reserved, not live (`registry.rs:41`) |
| `SAL` | Salvium | reserved | 0 | reserved, not live (`registry.rs:49`) |

`ETH` and `NOX` are the live, keyring-signed rails; `PR` and `SAL` are marked config-required and reserved
respectively and point at the all-zero pending contract ([`src/server/wallet_rail/addresses.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wallet_rail/addresses.rs#L22)). The
listing is descriptive only.

## Why the secret never leaves

The keyring exposes no operation that returns a wallet secret. `retrieve` refuses the `Secp256k1Eth` type
([`src/store/retrieve.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/retrieve.rs#L27)), and every signer and the address handler read the secret through `eth_secret`
and wipe it the moment they are done, on every branch. A caller can obtain a signature, a struct hash, or a
20-byte address, but never the 32 secret bytes. The honest bound is that the capability mask cannot forbid
a logic leak: a handler that put key bytes in a reply body would defeat the design, which is why the
signers are written to return signatures and the retrieval path hard-refuses the wallet key type. All
signing here is single-signer; there is no threshold or multi-party path.

## Source map

```
  userland/capsule_keyring/src/server/handlers/sign_eth_transfer.rs   op 13: EIP-1559 transfer signer
  userland/capsule_keyring/src/server/handlers/sign_approve.rs        op 12: NOX approve signer
  userland/capsule_keyring/src/server/handlers/sign_receipt/          op 11: EIP-712 receipt signer
  userland/capsule_keyring/src/server/handlers/wallet_generate.rs     op 9: RNG + rejection sampling
  userland/capsule_keyring/src/server/handlers/wallet_import.rs       op 8: import a caller secret
  userland/capsule_keyring/src/server/handlers/wallet_address.rs      op 10: derive address, wipe secret
  userland/capsule_keyring/src/server/ethaddr.rs                      address_of (pubkey -> keccak -> 20)
  userland/capsule_keyring/src/server/field32.rs                      the 32-byte field reader
  userland/capsule_keyring/src/server/zeroize.rs                      zeroize32 (volatile + fence)
  userland/capsule_keyring/src/server/eip1559/                        the type-2 RLP field builders + consts
  userland/capsule_keyring/src/server/eip712/                         the type hash, domain, struct hash, digest
  userland/capsule_keyring/src/server/rlp/                            the minimal RLP primitives
  userland/capsule_keyring/src/server/wallet_rail/                    the static rail table and its encoder
  userland/capsule_keyring/src/store/eth_secret.rs                    the owner/type/lock/length-checked read
  userland/capsule_keyring/src/store/eth_valid.rs                     the [1, n-1] scalar validity check
```

Every reference above is verified against those trees.
