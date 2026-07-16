---
title: "Core Service Capsules"
description: "This page documents the core non-GUI service capsules: RAMFS, VFS, keyring, entropy, crypto, policy, attest, market, installer, payment, power, and proofio."
weight: 19
---
This page documents the core non-GUI service capsules: RAMFS, VFS, keyring,
entropy, crypto, policy, attest, market, installer, payment, power, and
`proof_io`. Read [Services](/docs/userland/services/), [Protocol Atlas](/docs/userland/protocols/), and
[Runtime Workflows](/docs/userland/workflows/) first.

Use this page as a per-capsule audit map. Each service is described by the
state it owns, the request router it exposes, and the failure boundary a caller
will see.

---

## 1. Common Service Shape

Most core capsules receive IPC, parse a protocol request, dispatch by operation,
mutate capsule-owned state when needed, and reply with a protocol status. The
shape is visible in RAMFS, VFS, keyring, entropy, crypto, installer, and payment
dispatchers ([`userland/capsule_ramfs/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L26),
[`userland/capsule_vfs/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L26),
[`userland/capsule_keyring/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/dispatch.rs#L27),
[`userland/capsule_entropy/src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/server/dispatch.rs#L25),
[`userland/capsule_crypto/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/dispatch.rs#L27),
[`userland/capsule_installer/src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/dispatch.rs#L22),
[`userland/capsule_payment/src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/dispatch.rs#L25)).

```
+--------------------------+
| service inbox            |
+------------+-------------+
             |
+------------+-------------+
| protocol parse           |
+------------+-------------+
             |
+------------+-------------+
| op dispatch              |
+------------+-------------+
             |
+------------+-------------+
| state read or mutation   |
+------------+-------------+
             |
+------------+-------------+
| encoded response         |
+--------------------------+
```

## 2. Storage and Filesystem Services

RAMFS owns encrypted file records in memory. Each file stores a per-file key,
nonce, and ciphertext buffer, and the store maps names to file records
([`userland/capsule_ramfs/src/store/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L23),
[`userland/capsule_ramfs/src/store/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L24),
[`userland/capsule_ramfs/src/store/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L25),
[`userland/capsule_ramfs/src/store/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L26),
[`userland/capsule_ramfs/src/store/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L29),
[`userland/capsule_ramfs/src/store/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L30)). Its dispatcher handles open,
read, write, truncate, and close, and rejects unknown operations with `EINVAL`
([`userland/capsule_ramfs/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L27),
[`userland/capsule_ramfs/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L28),
[`userland/capsule_ramfs/src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L29),
[`userland/capsule_ramfs/src/server/dispatch.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L30),
[`userland/capsule_ramfs/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L31),
[`userland/capsule_ramfs/src/server/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L32),
[`userland/capsule_ramfs/src/server/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L33)).

VFS owns file entries and open file descriptors. Its store caps file count, open
FD count, and file size, and each open FD records file index, owner pid,
position, append mode, and writable state
([`userland/capsule_vfs/src/store/fdtable/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L20),
[`userland/capsule_vfs/src/store/fdtable/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L21),
[`userland/capsule_vfs/src/store/fdtable/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L22),
[`userland/capsule_vfs/src/store/fdtable/types.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L37),
[`userland/capsule_vfs/src/store/fdtable/types.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L43),
[`userland/capsule_vfs/src/store/fdtable/types.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L44),
[`userland/capsule_vfs/src/store/fdtable/types.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L45),
[`userland/capsule_vfs/src/store/fdtable/types.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L46),
[`userland/capsule_vfs/src/store/fdtable/types.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L47),
[`userland/capsule_vfs/src/store/fdtable/types.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L48)). Its dispatcher covers
open, close, read, write, stat, list, mkdir, unlink, rename, and healthcheck
([`userland/capsule_vfs/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L27) to
[`userland/capsule_vfs/src/server/dispatch.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L38)).

```
+--------------------------+
| caller path request      |
+------------+-------------+
             |
+------------+-------------+
| ramfs encrypted files    |
| vfs files and fd table   |
+------------+-------------+
             |
+------------+-------------+
| handler validates owner  |
| handler validates bounds |
+------------+-------------+
             |
+------------+-------------+
| data or errno reply      |
+--------------------------+
```

## 3. Security and Crypto Services

Keyring owns a `BTreeMap` from key id to key entry and a `next_id` counter
([`userland/capsule_keyring/src/store/types/store.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/types/store.rs#L20),
[`userland/capsule_keyring/src/store/types/store.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/types/store.rs#L21),
[`userland/capsule_keyring/src/store/types/store.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/types/store.rs#L22)). Its dispatch surface
covers key store, retrieve, delete, lock, unlock, metadata, count, wallet import,
wallet generate, wallet address, NOX receipt signing, NOX approve signing, and
native ETH transfer signing, and wallet rail listing
([`userland/capsule_keyring/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/dispatch.rs#L28) to
[`userland/capsule_keyring/src/server/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/server/dispatch.rs#L43)).

Entropy owns atomic counters for request count, bytes served, last reseed
request, and source failures ([`userland/capsule_entropy/src/pool/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/types.rs#L26),
[`userland/capsule_entropy/src/pool/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/types.rs#L27),
[`userland/capsule_entropy/src/pool/types.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/types.rs#L28),
[`userland/capsule_entropy/src/pool/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/types.rs#L29),
[`userland/capsule_entropy/src/pool/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/types.rs#L30)). Its dispatcher covers random
bytes, stats, reseed, and healthcheck
([`userland/capsule_entropy/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/server/dispatch.rs#L26) to
[`userland/capsule_entropy/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/server/dispatch.rs#L31)).

Crypto is a stateless request dispatcher for hash, signature, AEAD, X25519,
HMAC, HKDF, and healthcheck operations. The routing table maps each op directly
to its handler and rejects unknown operations with `EINVAL`
([`userland/capsule_crypto/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/dispatch.rs#L28) to
[`userland/capsule_crypto/src/server/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/dispatch.rs#L43)).

Policy uses a fixed header. The runner polls its endpoint, validates header
length, decodes the header, checks payload length, decodes the field, then
dispatches `OP_GET` or `OP_SET`
([`userland/capsule_policy/src/server/runner.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L23),
[`userland/capsule_policy/src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L27),
[`userland/capsule_policy/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L32),
[`userland/capsule_policy/src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L36),
[`userland/capsule_policy/src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L40),
[`userland/capsule_policy/src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L45),
[`userland/capsule_policy/src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L52),
[`userland/capsule_policy/src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L53),
[`userland/capsule_policy/src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/runner.rs#L54)).

Attest parses a request and routes healthcheck, proof summary, proof invariants,
proof boot, and proof capsule list. Unknown ops return `E_BAD_OP`
([`userland/capsule_attest/src/server/handlers/router.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L24),
[`userland/capsule_attest/src/server/handlers/router.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L29),
[`userland/capsule_attest/src/server/handlers/router.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L30),
[`userland/capsule_attest/src/server/handlers/router.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L31),
[`userland/capsule_attest/src/server/handlers/router.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L32),
[`userland/capsule_attest/src/server/handlers/router.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L33),
[`userland/capsule_attest/src/server/handlers/router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L34),
[`userland/capsule_attest/src/server/handlers/router.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/server/handlers/router.rs#L35)).

```
+--------------------------+
| keyring wallet request   |
| entropy random request   |
| crypto primitive request |
| policy field request     |
| attest proof request     |
+------------+-------------+
             |
+------------+-------------+
| protocol-specific parse  |
+------------+-------------+
             |
+------------+-------------+
| handler or errno         |
+--------------------------+
```

## 4. Market, Install, Payment, Power, and Proof

Market allocates receive and transmit buffers, decodes a market request, checks
body bounds, then dispatches healthcheck, load index, list apps, get app, get
release, and install-ready operations ([`userland/capsule_market/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L32),
[`userland/capsule_market/src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L33),
[`userland/capsule_market/src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L34),
[`userland/capsule_market/src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L41),
[`userland/capsule_market/src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L49),
[`userland/capsule_market/src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L57),
[`userland/capsule_market/src/server/runner.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L58),
[`userland/capsule_market/src/server/runner.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L59),
[`userland/capsule_market/src/server/runner.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L60),
[`userland/capsule_market/src/server/runner.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L61),
[`userland/capsule_market/src/server/runner.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L62),
[`userland/capsule_market/src/server/runner.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L63)).

Installer dispatches healthcheck, install admission, and VFS store capsule load.
Payment dispatches healthcheck, pay, drain receipts, and token listing
([`userland/capsule_installer/src/server/dispatch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/dispatch.rs#L23),
[`userland/capsule_installer/src/server/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/dispatch.rs#L24),
[`userland/capsule_installer/src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/dispatch.rs#L25),
[`userland/capsule_installer/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/dispatch.rs#L26),
[`userland/capsule_payment/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/dispatch.rs#L26),
[`userland/capsule_payment/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/dispatch.rs#L27),
[`userland/capsule_payment/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/dispatch.rs#L28),
[`userland/capsule_payment/src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/dispatch.rs#L29)).

Power parses a request, then routes healthcheck, reboot, and shutdown, with
unknown ops returned as `E_BAD_OP`
([`userland/capsule_power/src/server/handlers/router.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L22),
[`userland/capsule_power/src/server/handlers/router.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L23),
[`userland/capsule_power/src/server/handlers/router.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L27),
[`userland/capsule_power/src/server/handlers/router.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L28),
[`userland/capsule_power/src/server/handlers/router.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L29),
[`userland/capsule_power/src/server/handlers/router.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L30),
[`userland/capsule_power/src/server/handlers/router.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L31)).

`proof_io` is not a long-lived IPC service. Its `_start` checks time calls,
unknown syscall number handling, invalid debug pointer handling, invalid debug
size handling, retired syscall rejection, then emits pass or fail and exits
([`userland/capsule_proof_io/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L37),
[`userland/capsule_proof_io/src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L38),
[`userland/capsule_proof_io/src/main.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L44),
[`userland/capsule_proof_io/src/main.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L48),
[`userland/capsule_proof_io/src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L52),
[`userland/capsule_proof_io/src/main.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L56),
[`userland/capsule_proof_io/src/main.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L64),
[`userland/capsule_proof_io/src/main.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L65)).

| Capsule | Audit question | First source |
|---------|----------------|--------------|
| `market` | Was the index decoded, bounded, and dispatched to the right handler? | [`userland/capsule_market/src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/server/runner.rs#L41) |
| `installer` | Is the request healthcheck, install admission, or VFS store capsule load? | [`userland/capsule_installer/src/server/dispatch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/dispatch.rs#L23) |
| `payment` | Is the request pay, drain receipts, or list supported tokens? | [`userland/capsule_payment/src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/dispatch.rs#L26) |
| `power` | Is the command reboot or shutdown after parse? | [`userland/capsule_power/src/server/handlers/router.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L27) |
| `proof_io` | Which syscall proof failed before exit? | [`userland/capsule_proof_io/src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L38) |

## 5. Security analysis

These are the capsules that hold the sensitive bits, so their capability masks are the
first thing to check. `keyring`, `entropy`, `crypto`, and `ramfs` all carry the `Crypto` bit; the
inventory records `keyring`, `entropy`, and `crypto` at `0x39` and `ramfs` at `0x38`,
which is `Crypto` together with the `CoreExec`, `IPC`, and `Memory` bits they need to
run and serve requests ([`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)). None of them holds a device,
admin, or input-source bit, so a compromised core service cannot reach hardware or
reboot the machine; it can only answer the protocol it was built for. That is the isolation argument for splitting
key material into its own capsule at all: the keyring owns wallet keys and NOX signing,
and it is the only capsule that does, so the blast radius of a bug there is the keyring's
own address space rather than the whole system.

The shared service shape is itself a security property. Every one of these capsules
receives IPC, parses a length-checked protocol request, dispatches by operation, and
rejects an unknown operation with a defined error, `EINVAL` for the RAMFS, VFS, and
crypto dispatchers and `E_BAD_OP` for attest and power
([`userland/capsule_ramfs/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L27),
[`userland/capsule_power/src/server/handlers/router.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/server/handlers/router.rs#L22)). A caller cannot drive one of
these services into an undefined path by sending an operation code it does not handle;
the dispatcher has a closed set and a default-deny tail. VFS goes further and records the
owner pid on each open file descriptor
([`userland/capsule_vfs/src/store/fdtable/types.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L47)), so an FD is scoped to the capsule
that opened it rather than being a global handle any caller can name.

RAMFS is worth calling out because it encrypts at rest in memory. Each file stores a
per-file key, nonce, and ciphertext buffer
([`userland/capsule_ramfs/src/store/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L24)), so file contents are not sitting in the
capsule's heap as plaintext. That is a defense-in-depth choice, not a substitute for the
address-space isolation the kernel already provides, but it means a memory disclosure bug
in RAMFS does not immediately hand over file plaintext.

## 6. Debugging a core service

The failure boundary a caller sees is the error the dispatcher returns, so the debugging
path starts at the dispatcher for the capsule that owns the state. A request that comes
back `EINVAL` from RAMFS or crypto hit the unknown-operation tail, which means the
operation code was wrong or the request framing did not parse, not that the operation
failed internally. A request that comes back `E_BAD_OP` from attest or power is the same
situation with the other spelling. A request that never comes back at all is usually the
service not being spawned, and the `capsule spawned` boot marker
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)) is the ground truth for that; the core
services spawn in a fixed order after RAMFS, keyring then entropy then crypto then policy
([`src/userspace/init/spawn_plan/core.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L22)), so a keyring call that hangs when RAMFS is
up but keyring is not points at that phase.

The per-capsule audit table in section 4 is the routing map for the rest. It names, for
each of market, installer, payment, power, and `proof_io`, the one question to ask and the
first source line to open. `proof_io` is the odd one: it is not a long-lived service but a
boot-time proof that exits with pass or fail after checking time calls, unknown syscall
handling, bad debug pointers, and retired syscall rejection
([`userland/capsule_proof_io/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L37)), so a `proof_io` failure is a kernel-ABI
regression to chase in the kernel, not a service to restart.

## 7. Source map

```
  userland/capsule_ramfs/src/{store/types.rs, server/dispatch.rs}   encrypted files, dispatch
  userland/capsule_vfs/src/{store/fdtable/types.rs, server/dispatch.rs}  fd table and owner pid
  userland/capsule_keyring/src/{store/types/store.rs, server/dispatch.rs}  key store and wallet ops
  userland/capsule_entropy/src/{pool/types.rs, server/dispatch.rs}  counters and random ops
  userland/capsule_crypto/src/server/dispatch.rs                    the stateless primitive router
  userland/capsule_{policy,attest,power}/src/server/                header decode and E_BAD_OP tail
  userland/capsule_{market,installer,payment}/src/server/           index, admission, and pay paths
  userland/capsule_proof_io/src/main.rs                             the boot-time syscall proof
```

The service endpoints and capability masks for these capsules are in
[the capsule inventory](/docs/userland/capsules/); the protocol op tables are in
[the protocol atlas](/docs/userland/protocols/).
