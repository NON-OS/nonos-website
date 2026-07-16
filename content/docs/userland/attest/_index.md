---
title: "The Attest Capsule"
description: "capsuleattest is the system's attestation-information service."
weight: 400
---
`capsule_attest` is the system's attestation-information service. It answers questions about the running
system's identity and its stated invariants: a liveness check, a product summary, the boot identity, the
invariant list, and a per-capsule capability-mask table. Its name invites an assumption the code does not
support, and this documentation is careful about the distinction. The capsule returns authored,
human-readable statements about the system and a boot label, not cryptographic proofs computed at request
time. The statements are true and their cited mechanisms are real kernel machinery, but they are a
signed-off audit manifest, not proof objects. The genuine cryptographic attestation runs in the kernel and
is read by the [boot splash](/docs/userland/boot-splash/) through `mk_attest_status`, not by this capsule.

The source under `userland/capsule_attest/src/` is three top-level modules, and this documentation mirrors
that structure one page per module so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|-------|-------|--------|
| Capsule slug | `attest` | `Capsule.mk:1` |
| Service handle | `attest` | `Capsule.mk:2`, [`src/userspace/capsule_attest/spawn.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_attest/spawn.rs#L29) |
| Domain | `systems.nonos` | `Capsule.mk:3` |
| Namespace | `systems.nonos.attest` | `Capsule.mk:7` |
| Service endpoint | `service:4444:attest` | `Capsule.mk:8`, `spawn.rs:30` |
| Reply endpoint | `reply:4445:endpoint.attest.reply` | `Capsule.mk:9`, `spawn.rs:31`, `spawn.rs:32` |
| Capability mask | `0x19` | `Capsule.mk:13`, `spawn.rs:34` |
| Feature gate | `nonos-capsule-attest` | `Capsule.mk:6` |
| Binary name | `attest` | `Capsule.mk:5`, `Cargo.toml:18` |
| Kernel mirror | `src/userspace/capsule_attest` | `Capsule.mk:14` |

The mask `0x19` decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | receive on port 4444 and reply on its endpoint (`types.rs:59`) |
| Memory | `0x0010` | map its own heap and the two reply buffers (`types.rs:60`) |

```
  0x01  CoreExec   +   0x08  IPC   +   0x10  Memory   =   0x19
```

The kernel spawn path requests exactly `0x19` and no other bit (`spawn.rs:34`, `spawn.rs:49`). Three
absences are deliberate and each is documented in the `Capsule.mk` comment or matched to the capsule's
scope. There is no `Debug` bit (256, `types.rs:64`): a capsule that emitted `MkDebug` markers would forfeit
the credibility of the NO LOGS invariant it reports (`Capsule.mk:11`). There is no `Crypto` bit (32,
`types.rs:61`): a capsule that returned cryptographic proofs would need key material, and this one holds
none because it returns authored statements. There is no `FileSystem`, no `Network`, and no hardware
capability, so it cannot read a file, reach the wire, or touch a device. Compromising the capsule yields
CoreExec, IPC, and Memory and nothing else.

## The three modules

The source under `userland/capsule_attest/src/` is three top-level modules, and the documentation is one
page each. A request flows in a straight line: bytes arrive at `server`, are framed by `protocol`, are
answered from the tables in `state`, and are framed back out by `protocol`.

```
  protocol/   <->   server/   <->   state/
  the wire         the loop        the authored
  format          and handlers     tables
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/attest/protocol/) | `src/protocol/` | The 20-byte header, the five opcodes, the error codes, the parse and response builders, and the payload limits. |
| [operations.md](/docs/userland/attest/operations/) | `src/server/` | The receive-reply loop, the header-validating router, and the five read-only handlers with their exact reply layouts. |
| [attestation-data.md](/docs/userland/attest/attestation-data/) | `src/state/` and the two authored handler tables | What the capsule actually serves: the product summary, the six invariants in full, and the seventeen-entry capsule-mask table, with the honest boundary on each. |
| [contributing.md](/docs/userland/attest/contributing/) | the whole tree | Where to work, how to add an op or an invariant, the build and sign targets, and the code standards. |
| [debugging.md](/docs/userland/attest/debugging/) | runtime | The boot marker, the failure modes, and where to look when the capsule does not answer. |

## Lifecycle

The capsule is spawned at boot in the desktop-services fleet, behind the `nonos-capsule-attest` feature,
as `boot::capsule("ATTEST", "attest", spawn_attest_capsule, shared_state)`
([`src/userspace/init/spawn_plan/desktop_services.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L20), `desktop_services.rs:29`).
`spawn_attest_capsule` decodes the baked trust anchor and calls `capsule_spawn::spawn_verified` with the
embedded ELF, id cert, manifest, and attestation trailer, requesting caps `0x19`
([`src/userspace/capsule_attest/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_attest/spawn.rs#L36), `spawn.rs:52`); the embedded bytes come from
[`src/userspace/capsule_attest/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_attest/embed.rs#L18). Its signature and attestation are checked and its requested
caps are held against its manifest ceiling before its ELF is mapped, so its own binary chains to the same
baked trust anchor as every other capsule.

On success the boot path prints `[ATTEST] capsule spawned` and registers the capsule with the service
lifecycle so `attest` resolves through the service registry
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/userspace/capsule_attest/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_attest/state.rs#L17),
`state.rs:25`); on failure it
prints an `[ERROR]` line with the decoded `SpawnError` instead ([`capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot/run.rs#L32)). Inside the
capsule, `_start` initializes the heap, exits with status 1 on failure, and otherwise enters `server::run`,
which never returns ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)). The [debugging](/docs/userland/attest/debugging/) page covers what each marker means.

## Source map

```
  src/main.rs                     _start -> heap_init -> server::run
  src/protocol/                   the wire format          -> protocol.md
  src/server/                     the loop, router, and handlers -> operations.md
  src/state/                      the authored tables      -> attestation-data.md
  Capsule.mk                      slug, handle, ports, mask 0x19, kernel mirror
  src/capabilities/types.rs       the capability-bit definitions the mask decomposes against
  src/userspace/capsule_attest/   the kernel-side embed, verified spawn, lifecycle state
  nonos-mk/capsule.mk             the generated nonos-mk-attest[-sign|-verify] targets
```

Everything here is drawn from `userland/capsule_attest/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn mirror under
`src/userspace/capsule_attest/`. Every reference above is verified against those trees.
</content>
</invoke>
