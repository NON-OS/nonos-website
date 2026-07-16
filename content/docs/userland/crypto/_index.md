---
title: "The Crypto Capsule"
description: "capsulecrypto is the userland cryptographic compute pool: a stateless service that takes a hash, MAC, KDF, signature-verify, AEAD, or ECDH request, computes it, replies, and wip..."
weight: 400
---
`capsule_crypto` is the userland cryptographic compute pool: a stateless service that takes a hash, MAC,
KDF, signature-verify, AEAD, or ECDH request, computes it, replies, and wipes the request buffer. It holds
no keys and no session state. It serves a second purpose worth stating up front: it is where the
userland's cryptographic-crate dependencies are concentrated, so that other capsules reach Ed25519,
AES-GCM, and X25519 through IPC rather than each linking a crypto library of its own. Its source is
organized into two top-level modules, `protocol` and `server`, and this documentation mirrors that
structure one page per concern so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `crypto` | `userland/capsule_crypto/Capsule.mk:6` |
| Service handle | `crypto_pool` | `Capsule.mk:13`, [`src/security/crypto_capsule/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/spawn.rs#L31) |
| Namespace | `systems.nonos.crypto` | `Capsule.mk:12` |
| Service endpoint | `service:4102:crypto_pool` | `Capsule.mk:13`, `spawn.rs:32` |
| Reply endpoint | `reply:4103:endpoint.4294967300` | `Capsule.mk:14`, `spawn.rs:33` |
| Reply inbox (kernel client) | `endpoint.4294967300` = `0x1_0000_0004` | [`client/transport.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/transport.rs#L28), [`src/protocol/types.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L62) |
| Capability mask | `0x39` | `Capsule.mk:16` |
| Binary name | `crypto` | `Capsule.mk:10` |
| Kernel mirror | `src/security/crypto_capsule` | `Capsule.mk:17` |

The mask `0x39` decomposes into four bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | receive on its inbox and send its reply (`types.rs:59`) |
| Memory | `0x0010` | map its own heap and receive buffer (`types.rs:60`) |
| Crypto | `0x0020` | drive the crypto primitives it serves (`types.rs:61`) |

`0x39 = 1 + 8 + 16 + 32`. The kernel spawn path requests exactly `IPC | Memory | Crypto`
(`spawn.rs:54`); `Capsule.mk` adds `CoreExec` implicitly as every capsule's execute bit, so the
manifest's required-caps is `0x39`. There is no `Network` bit (4), no `FileSystem` bit (64), and no
graphics, driver, MMIO, IRQ, DMA, PIO, or `Debug` capability.

The important nuance, and the whole basis of the security model, is that the mask on the capsule is not
the caller-facing gate. `Crypto` (32) is held here not as a caller gate but because the capsule drives the
primitives. `CAP_CRYPTO` is checked on the kernel side of every request, against the calling pid, before
the capsule ever sees the bytes ([`src/security/crypto_capsule/capability.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/capability.rs#L22)); the comment in
`Capsule.mk:1` states this plainly. Compromising the crypto capsule yields its mask and nothing more: no
filesystem to write to, no network to exfiltrate over, no hardware to reach, no debug channel to log a
plaintext through, and no key or session that survives a request.

## The concerns

The source under `userland/capsule_crypto/src/` is two top-level modules ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)), and the
documentation is one page per concern. Data flows straight through: a framed request comes in, is decoded
by `protocol`, dispatched by `server` to one handler, computed against a primitive, encoded back, sent,
and the receive buffer is wiped before the next message.

```
  IPC in  ->  protocol/  ->  server/dispatch  ->  handler + primitive  ->  protocol/  ->  IPC out  ->  wipe
              decode          route one op        compute                  encode
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/crypto/operations/) | `src/protocol/` | The NOCX wire frame, the decoder and encoder, the four status codes, and the complete seventeen-op reference with every opcode, request layout, reply body, and per-op size limit. |
| [server.md](/docs/userland/crypto/server/) | `src/server/` | The receive/dispatch/send/wipe loop, the one-match op router, and the volatile buffer-wipe discipline that makes the pool stateless. |
| [primitives.md](/docs/userland/crypto/primitives/) | `src/server/handlers/` | One file per primitive: which crate backs each op, the shared AEAD frame parse and degenerate-nonce guard, and the hand-written HMAC and HKDF. |
| [transport.md](/docs/userland/crypto/transport/) | `src/security/crypto_capsule/` | The kernel-side mirror: verified spawn, the per-request `CAP_CRYPTO` gate on the caller pid, the fifteen in-tree clients, and the real callers in the tree. |
| [contributing.md](/docs/userland/crypto/contributing/) | the whole tree | Where to work, how to add a primitive end to end, the build and sign targets, and the code standards. |
| [debugging.md](/docs/userland/crypto/debugging/) | runtime | The boot marker, the request-time status codes and what each maps to, and where a denial actually comes from. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initializes the heap and, on success, enters `server::run`; a
heap-init failure exits with code 1 ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)).

1. The kernel spawns the capsule at boot through [`spawn_plan/core.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/core.rs#L60), which calls
   `boot::capsule("CRYPTO", "crypto", spawn_crypto_capsule, shared_state)`. `spawn_crypto_capsule` decodes
   the baked trust anchor, builds a `CapsuleSpecVerified` from the embedded ELF, cert, manifest, and
   attestation trailer, requests `IPC | Memory | Crypto`, and calls `spawn_verified`, which verifies the
   whole chain before the code runs ([`src/security/crypto_capsule/spawn.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto_capsule/spawn.rs#L40)).
2. On a successful spawn the boot path logs `[CRYPTO] capsule spawned` through `boot_log::ok`
   ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). The registry then
   resolves `crypto_pool` on port 4102 for callers.
3. `run` allocates one receive buffer of `HDR_LEN + MAX_PAYLOAD_BYTES` and loops: receive, decode,
   dispatch, send to the reply endpoint `0x1_0000_0004`, then wipe exactly the bytes it received
   ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)). Nothing survives a request, so a request never depends on a prior one and
   there is no state to leak between callers.

The two ends of the request path are worth naming because they are easy to conflate. A userland caller
does not talk to the capsule directly; it calls a thin `nonos_libc` crypto shim, which issues a syscall
that routes into the kernel-side crypto-capsule client, and that client is where `CAP_CRYPTO` is enforced
against the caller pid before the request is marshalled over IPC to this capsule. So "the crypto capsule"
(this folder) and "the kernel crypto stack" (documented under
[crypto subsystem](/docs/subsystems/crypto/)) are distinct bodies of code, and the client that
gates and transports requests is a third. The [transport](/docs/userland/crypto/transport/) page covers that seam.

## Source map

Everything here is drawn from `userland/capsule_crypto/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn-and-client mirror under
`src/security/crypto_capsule/`. Every reference above is verified against those trees.
