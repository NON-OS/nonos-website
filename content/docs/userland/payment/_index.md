---
title: "The Payment Capsule"
description: "capsulepayment is a settlement rail: it assembles the fields of a NOX receipt, asks the keyring to sign it, orders receipts per payer with a monotonic nonce, and queues the sign..."
weight: 400
---
`capsule_payment` is a settlement rail: it assembles the fields of a NOX receipt, asks the
[keyring](/docs/userland/keyring/) to sign it, orders receipts per payer with a monotonic nonce, and queues
the signed records for an off-capsule drainer to withdraw in batches. It holds no key material and no
funds. Its source is organized into a small flat tree, and this documentation mirrors that tree one page
per pillar so a page can be read beside the folder it describes.

An honesty note up front, before anything else. The capsule is built into the image (the top-level
Makefile includes `userland/capsule_payment/Capsule.mk` at `Makefile:653`), but it is not spawned by the
kernel init spawn plan, and its declared kernel mirror does not exist. There is no entry for `payment`
anywhere under `src/userspace/init/spawn_plan/`, and the mirror module `src/security/payment_capsule`
named in `Capsule.mk:18` is not present on disk. The capsule is defined and buildable, not part of the
boot fleet. As shipped there is no running `payment` service to look up, and no `[PAYMENT] capsule
spawned` boot marker. The [lifecycle](#lifecycle) section states exactly what that means.

## Identity

Everything the service registry needs to name and reach the capsule comes from its `Capsule.mk`. There is
no kernel-side spawn record, because the capsule is not in the boot spawn plan.

| Field | Value | Source |
|---|---|---|
| Slug | `payment` | `Capsule.mk:7` |
| Service handle | `payment` | `Capsule.mk:8` |
| Domain | `systems.nonos` | `Capsule.mk:9` |
| Binary name | `payment` | `Capsule.mk:11` |
| Namespace | `systems.nonos.payment` | `Capsule.mk:13` |
| Service endpoint | `service:4110:payment` | `Capsule.mk:14` |
| Reply endpoint | `reply:4111:endpoint.4294967312` | `Capsule.mk:15` |
| Capability mask | `0x19` | `Capsule.mk:17` |
| Kernel mirror | `src/security/payment_capsule` (declared, does not exist) | `Capsule.mk:18` |

The service is named `payment` on port 4110. The reply endpoint in the manifest is on port 4111, and its
endpoint token `4294967312` is `0x1_0000_0010`, the same value the runner uses as its outbound reply
target. The runner sends every reply to the constant `KERNEL_REPLY_ENDPOINT = 0x1_0000_0010`
([`src/protocol/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L22), [`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)), so a reply goes to that fixed endpoint rather
than to the request sender's pid.

The mask `0x19` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| CoreExec | `0x01` | run as a process | `types.rs:56` |
| IPC | `0x08` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x10` | map its own heap and outbox | `types.rs:60` |

That is `0x01 | 0x08 | 0x10 = 0x19`, the same decomposition the comment in `Capsule.mk:16` states. There
is no `Crypto` bit (32), because all signing is delegated to the keyring; no `Network` bit (4), because
the capsule does not settle on-chain and only queues records; no `FileSystem` bit (64), so the outbox is
RAM-only with no persistence; and no `IO` (2), `Hardware` (128), or `Debug` (256) capability. This is the
least-privilege mask for a capsule that touches neither keys nor funds nor the wire. Compromising the
payment capsule yields this mask and nothing more; the signing authority stays behind the keyring's own
boundary.

## The pillars

The source under `userland/capsule_payment/src/` is three top-level modules, `protocol`, `server`, and
`store` ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). The documentation groups them into two pillars by what a reader is trying to
follow. A request flows left to right: a frame is decoded, dispatched to one of four handlers, and for a
`pay` the receipt fields go out to the keyring to be signed before the signed record is queued.

```
  protocol/  ->  server/dispatch  ->  handlers/{health,pay,drain,tokens}
  wire codec     opcode match          pay -> sign_call -> keyring -> store outbox
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/payment/operations/) | `src/protocol/`, `src/server/handlers/`, `src/server/token/`, `src/store/` | The four operations, the request and reply wire codec, the 124-byte `pay` payload, the 297-byte drained record, the static token registry, and the per-payer nonce and bounded outbox. |
| [signing.md](/docs/userland/payment/signing/) | [`src/server/sign_call.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sign_call.rs), [`src/server/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/discover.rs), [`src/server/fields.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/fields.rs), the field marshalers | The signing path: resolving the keyring by name, marshaling the seven receipt words, the synchronous sign call, the keyring's owner-pid consent check, and where key custody actually lives. |
| [contributing.md](/docs/userland/payment/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/payment/debugging/) | runtime | Why there is no boot marker, how to tell the service is even up, and the request-time failure signatures. |

## Lifecycle

The capsule is a `no_std`/`no_main` userland service.

1. `_start` calls `heap_init`; on failure it exits with code 1, otherwise it enters `server::run` and
   never returns ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)).
2. `run` allocates a 4 KiB receive buffer and a fresh `State`, then loops: `mk_ipc_recv` blocks for a
   frame, `decode_request` parses the eight-byte header (dropping anything shorter), `dispatch` produces a
   reply, and `mk_ipc_send` sends it to `KERNEL_REPLY_ENDPOINT` ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)). A receive of
   zero or fewer bytes, or an undecodable frame, is skipped with `continue`.
3. There is no boot spawn. Unlike the desktop fleet capsules, `payment` is not registered by any entry in
   `src/userspace/init/spawn_plan/`, and the kernel mirror `src/security/payment_capsule` declared in
   `Capsule.mk:18` does not exist in the tree. So there is no `[PAYMENT] capsule spawned` boot marker; the
   capsule is defined and buildable but is not brought up by kernel init as shipped.

Because `State` is created inside `run` and lives only for the life of the process, the nonce map and the
outbox are entirely in RAM and do not survive a restart ([`src/store/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L23)).

## Source map

```
  userland/capsule_payment/src/main.rs        _start -> heap_init -> server::run; the three modules
  userland/capsule_payment/src/protocol/       the request/response wire codec and the four opcodes
  userland/capsule_payment/src/server/         the recv/dispatch/send loop, the handlers, the marshalers
  userland/capsule_payment/src/store/          State: the per-payer nonce map and the bounded outbox
  userland/capsule_payment/Capsule.mk          slug, handle, ports, capability mask, declared mirror
  src/capabilities/types.rs                    the capability bits the mask decomposes into
  src/userspace/init/spawn_plan/               checked and has no payment entry (capsule is not spawned)
  Makefile                                     includes the capsule at line 653
  userland/capsule_keyring/                    the signing authority the pay path calls
```

Every reference above is verified against those trees.
