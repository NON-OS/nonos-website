---
title: "The Keyring Capsule"
description: "The keyring is the only capsule in the system that holds private key material."
weight: 400
---
The keyring is the only capsule in the system that holds private key material. It keeps keys behind an
owner-pid boundary and a per-key lock flag, imports and generates Ethereum wallets, and signs Ethereum and
NOX transactions on request. It never hands a wallet secret back to a caller: the signers return
signatures and hashes, and the retrieval path structurally refuses to export a wallet key at all. Its
source is organized into three pillars, and this documentation mirrors that structure one page per pillar
so a page can be read beside the folder it describes.

No other capsule, including the [wallet](/docs/userland/wallet-nonos/), the [login](/docs/userland/login/)
service, and the [payment](/docs/userland/payment/) service, ever holds a private key. They reach the keyring
only over IPC: they ask for an address, a signature, or a lock toggle, and render the reply.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `keyring` | `userland/capsule_keyring/Capsule.mk:7` |
| Service handle | `keyring` | `Capsule.mk:8` |
| Namespace | `systems.nonos.keyring` | `Capsule.mk:13` |
| Service endpoint | `service:4098:keyring` | `Capsule.mk:14` |
| Reply endpoint | `reply:4099:endpoint.4294967298` | `Capsule.mk:15` |
| Binary name | `keyring` | `Capsule.mk:11` |
| Capability mask | `0x39` | `Capsule.mk:17` |
| Kernel mirror | `src/security/keyring_capsule` | `Capsule.mk:18` |

The reply endpoint id `4294967298` is `0x1_0000_0002`, the constant the server sends every reply to
(`KERNEL_REPLY_ENDPOINT`, [`src/protocol/types.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L32)). The manifest reply port is 4099; the kernel routes
the reply frame from that endpoint id back to the caller that issued the `mk_ipc_call`.

The mask `0x39` decomposes into four bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | send and receive on its endpoints |
| Memory | `0x0010` | map its own heap and stack |
| Crypto | `0x0020` | drive the kernel crypto and RNG syscalls it signs and generates with |

`0x39 = 0x01 + 0x08 + 0x10 + 0x20`. CoreExec is bit 0 (`types.rs:56`), IPC is bit 3 (`types.rs:59`),
Memory is bit 4 (`types.rs:60`), Crypto is bit 5 (`types.rs:61`). The comment at the head of `Capsule.mk`
adds `0x08 | 0x10 | 0x20` and writes the sum as `0x39`; that arithmetic is off by the CoreExec bit, since
`0x08 + 0x10 + 0x20` is `0x38`. The value that is actually installed is `0x39`, and the extra bit is
CoreExec, which every capsule needs in order to run as a process.

The value that matters is the one on the manifest, not the one the spawn site passes. The kernel-side
`spawn_keyring_capsule` requests only `IPC | Memory | Crypto` (`0x38`,
[`src/security/keyring_capsule/spawn.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/keyring_capsule/spawn.rs#L55)), but `requested_caps` is only the upper bound the spawn site is
willing to grant for optional caps; the caps installed on the process come from the verified manifest, not
from `requested_caps` ([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L23)). The manifest
check returns `required_caps | (optional_caps & granted_caps)`
([`src/security/capsule_manifest/verify/caps.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/verify/caps.rs#L39)), so the installed mask is at least the manifest's
required set, `0x39`.

The keyring holds nothing beyond those four bits. There is no Network (`0x04`), no FileSystem (`0x40`), no
Debug (`0x100`), and no Driver, Mmio, Irq, Dma, or Pio. That absence is the security property: the capsule
that holds every private key cannot open a socket, write to a storage surface, emit a diagnostic line, or
program a DMA engine that could carry a key off the machine. The [store](/docs/userland/keyring/store/) page returns to what
each absence buys.

## The three pillars

The source under `userland/capsule_keyring/src/` is three top-level modules, declared in [`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22),
and the documentation is one page each. A request enters through `protocol`, is routed by `server` to one
handler, and the handler reaches into `store` for the key.

```
  protocol/   ->   server/   ->   store/
  the wire         the loop,      the key material
  frame and        dispatch,      and the owner-checked
  the op set       and handlers   operations on it
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/keyring/operations/) | `src/protocol/` and `src/server/` dispatch | The wire frame, the fourteen operations and their payloads, the errno set, caller attestation, the server loop, and the receive-buffer wipe. |
| [store.md](/docs/userland/keyring/store/) | `src/store/` | The key store, the `KeyEntry` model, the owner-pid checks on every operation, wallet non-exportability at the store boundary, and the wiping discipline. |
| [signing.md](/docs/userland/keyring/signing/) | `src/server/` signing subtree | The three signers, address derivation, the EIP-1559 and EIP-712 builders, the RLP encoder, the scratch zeroing on every branch, and the static wallet rail table. |
| [contributing.md](/docs/userland/keyring/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/keyring/debugging/) | runtime | The boot marker, reading failures from the reply status, and why the keyring emits no diagnostics of its own. |

## The fourteen operations

Every operation is a `u16` opcode dispatched in `dispatch` ([`src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L28)); the constants are
in [`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17). The [operations](/docs/userland/keyring/operations/) page gives each payload and reply body.

```
   1  STORE            6  METADATA        11  SIGN_NOX_RECEIPT
   2  RETRIEVE         7  COUNT           12  SIGN_NOX_APPROVE
   3  DELETE           8  WALLET_IMPORT   13  SIGN_ETH_TRANSFER
   4  LOCK             9  WALLET_GENERATE 14  LIST_WALLET_RAILS
   5  UNLOCK          10  WALLET_ADDRESS
```

Operations 1 through 7 are the general key store: any caller may store, retrieve, delete, lock, unlock, and
read metadata and a count for its own keys, scoped strictly to the caller pid. Operations 8 through 13 are
the wallet signer: it generates and imports secp256k1 Ethereum keys and produces EIP-1559 transactions, a
NOX ERC-20 approve, and an EIP-712 payment receipt, always retrieving the secret owner-checked, signing,
and zeroing the secret the instant the signature is produced. Operation 14 is a descriptive listing of the
supported wallet rails and touches no key.

## Lifecycle

The keyring is spawned right after ramfs in the core service fleet (`spawn_after_ramfs`,
[`src/userspace/init/spawn_plan/core.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L23)), through `spawn_keyring`, which calls
`boot::capsule("KEYRING", "keyring", ...)` against the kernel embed at `src/security/keyring_capsule/`
(`core.rs:48`). That embed verifies the capsule ELF, id cert, manifest, and attestation, holds the
requested caps against the manifest, and only then maps the ELF; on success the boot path logs
`[KEYRING] capsule spawned` and on failure logs an `[ERROR]` line describing the `SpawnError`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), `:32`). Once mapped, `_start` initializes the heap and enters
`server::run`, which never returns ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)); the loop receives on inbox 0, dispatches, replies,
and wipes the buffer. The [debugging](/docs/userland/keyring/debugging/) page covers what the marker and each reply status mean.

## Source map

```
  userland/capsule_keyring/src/main.rs             _start -> heap_init -> server::run; the three modules
  userland/capsule_keyring/src/protocol/           the wire frame, op constants, and errno set
  userland/capsule_keyring/src/server/             the loop, dispatch, handlers, and signing builders
  userland/capsule_keyring/src/store/              the key store and its owner-checked operations
  userland/capsule_keyring/Capsule.mk              slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                        the capability bit values
  src/security/keyring_capsule/                    the kernel-side embed and verified spawn
  src/security/capsule_manifest/verify/caps.rs     the installed-caps rule (required | optional & granted)
  src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs   caps come from the manifest
  src/userspace/init/spawn_plan/core.rs            the core-fleet spawn entry
  src/userspace/init/capsule_boot/run.rs           the [KEYRING] capsule spawned / error path
```

Every reference above is verified against those trees.
