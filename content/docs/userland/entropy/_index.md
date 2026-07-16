---
title: "The Entropy Capsule"
description: "capsuleentropy is the userland random-bytes service: the source the kernel's CryptoRandom syscall draws from when a capsule asks for random bytes."
weight: 400
---
`capsule_entropy` is the userland random-bytes service: the source the kernel's `CryptoRandom` syscall
draws from when a capsule asks for random bytes. It is deliberately thin. It draws bytes directly from
the CPU hardware random generator (`RDRAND`), serves them under a per-request cap, and keeps four
counters so the entropy path is observable. It holds no software CSPRNG pool of its own; it is a
monitored pass-through to the hardware source. The name "pool" in the code refers to the accounting
object, not to a mixed entropy buffer. Its source is organized into three pillars, and this
documentation mirrors that structure one page per pillar so a page can be read beside the folder it
describes.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and the kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Slug | `entropy` | `userland/capsule_entropy/Capsule.mk:7` |
| Service handle | `entropy` | `Capsule.mk:8` |
| Namespace | `systems.nonos.entropy` | `Capsule.mk:13` |
| Service endpoint | `service:4100:entropy_pool` | `Capsule.mk:14`, [`src/security/entropy_capsule/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/spawn.rs#L31) |
| Reply endpoint | `reply:4101:endpoint.4294967299` | `Capsule.mk:15`, [`src/security/entropy_capsule/spawn.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/spawn.rs#L33) |
| Reply inbox name | `endpoint.4294967299` (= `0x1_0000_0003`) | [`src/security/entropy_capsule/client/transport.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/client/transport.rs#L27), [`src/protocol/types.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L42) |
| Binary name | `entropy` | `Capsule.mk:11` |
| Capability mask | `0x39` | `Capsule.mk:17` |
| Kernel mirror | `src/security/entropy_capsule` | `Capsule.mk:18` |

The service name on the wire is `entropy_pool` on port 4100; the reply endpoint the capsule sends to is
the kernel-owned inbox `endpoint.4294967299`, whose numeric form `0x1_0000_0003` is the constant
`KERNEL_REPLY_ENDPOINT` the capsule targets ([`src/protocol/types.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L42), [`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)).

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| IPC | `0x08` | send and receive on its endpoints, for `mk_ipc_*` (`types.rs:59`) |
| Memory | `0x10` | map its own heap (`types.rs:60`) |
| Crypto | `0x20` | execute the `RDRAND` primitive on the crypto/random path (`types.rs:61`) |

```
  0x08  IPC
  0x10  Memory
  0x20  Crypto
  ------
  0x39  = 8 + 16 + 32
```

The kernel spawn path requests exactly those three bits and no others: `Capability::IPC.bit() |
Capability::Memory.bit() | Capability::Crypto.bit()` ([`src/security/entropy_capsule/spawn.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/spawn.rs#L54)). There
is no `CoreExec`, no `Network`, no `FileSystem`, and no hardware, driver, MMIO, IRQ, DMA, or PIO bit.
The capsule that is the entropy authority does not itself hold an entropy capability: callers carry the
entropy bit and reach the pool through IPC, while the capsule needs only IPC for `mk_ipc_*`, Memory for
its heap, and Crypto for the RNG primitive it consumes (`Capsule.mk:1`). The Crypto bit is held because
`RDRAND` sits on the crypto/random path; the instruction is executed in the capsule's own context under
a `target_feature` gate, not by claiming a device through the broker, so no device claim, MMIO map, or
IRQ binding is involved and none is granted.

## The three pillars

The source under `userland/capsule_entropy/src/` is three top-level modules, and the documentation is
one page each. A request enters through `server` (the IPC loop), is decoded by `protocol`, dispatched to
a handler, and, for a random draw, filled from `pool` via `RDRAND`.

```
  server/   ->   protocol/   ->   pool/
  the IPC        the NOEN        the counters and
  loop and       wire frame      the RDRAND fill
  handlers       and errors      (no mixing)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/entropy/operations/) | `src/server/` and `src/protocol/` | The IPC loop, the NOEN wire frame, the four operations, the dispatch, the error codes, and the kernel client that gates and calls them. |
| [pool.md](/docs/userland/entropy/pool/) | `src/pool/` | The four counters, the `RDRAND` fill with its retry loop, the stats encoding, the reseed breadcrumb, and the honest randomness posture. |
| [contributing.md](/docs/userland/entropy/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/entropy/debugging/) | runtime | The boot marker, the error codes as failure signatures, and the syscall fallback. |

## Lifecycle

The entropy capsule is spawned through [verified spawn](/docs/security/capsules-and-trust/): its
signature and attestation are checked, its requested capabilities are held against its manifest ceiling,
and only then is its ELF mapped.

1. The kernel spawns the capsule at boot from the microkernel spawn plan (`spawn_entropy` at
   [`src/userspace/init/spawn_plan/core.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L51)), which calls `boot::capsule("ENTROPY", "entropy", ...)`
   against the mirror's `spawn_entropy_capsule` ([`src/userspace/init/spawn_plan/core.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L54)).
2. `spawn_entropy_capsule` ([`src/security/entropy_capsule/spawn.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/spawn.rs#L40)) decodes the baked trust anchor,
   builds a verified spec with service name `entropy_pool`, port 4100, reply port 4101, the embedded
   ELF, cert, manifest, and attestation, and the three requested caps, then spawns it through
   `capsule_spawn::spawn_verified` and records the live pid (`spawn.rs:57`).
3. On success the boot helper prints `[ENTROPY] capsule spawned` and registers the capsule with the
   lifecycle registry ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); on failure it prints an error line
   with the mapped `SpawnError` ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)).
4. Inside the capsule, `_start` initializes the heap and, on success, calls `server::run`; a heap-init
   failure exits with code 1 ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)). `run` allocates a receive buffer, builds a fresh
   `Pool`, and enters the receive-decode-dispatch-reply loop ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)).

The only in-tree caller is the kernel's `CryptoRandom` syscall, which gates on `CAP_CRYPTO`, then asks
the capsule for bytes over IPC ([`src/syscall/dispatch/crypto/random.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L35),
[`src/syscall/dispatch/crypto/random.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L39)). When the capsule is unavailable the syscall falls back to
the kernel hardware RNG so a missing capsule never starves a caller
([`src/syscall/dispatch/crypto/random.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L29)). The capsule is the primary path but not the only one; the
[debugging](/docs/userland/entropy/debugging/) page covers what that fallback means for diagnosis.

## Source map

```
  userland/capsule_entropy/src/main.rs                 _start: heap_init then server::run
  userland/capsule_entropy/src/server/                 the IPC loop, dispatch, and handlers
  userland/capsule_entropy/src/protocol/               the NOEN frame, ops, limits, error codes
  userland/capsule_entropy/src/pool/                   the counters and the RDRAND fill
  userland/capsule_entropy/Capsule.mk                  slug, handle, ports, capability mask, mirror
  src/capabilities/types.rs                            the capability bit values
  src/security/entropy_capsule/spawn.rs                the verified kernel-side spawn
  src/userspace/init/spawn_plan/core.rs                spawn_entropy at boot
  src/userspace/init/capsule_boot/run.rs               the [ENTROPY] boot marker and error path
  src/syscall/dispatch/crypto/random.rs                the CryptoRandom syscall and hardware fallback
```

Every reference above is verified against those trees.
