---
title: "The proof_io Capsule"
description: "proofio is a self-test, not an application."
weight: 400
---
`proof_io` is a self-test, not an application. It is the first signed userland capsule on the verified
spawn path, and its whole job is to run at CPL3 and assert that the syscall boundary behaves: that a
legal call succeeds every time, and that malformed and retired calls are rejected with the exact error
the ABI promises. It draws no window, holds no state, and exits with a status that encodes pass or the
one check that failed. Its source is a single file, so this documentation is a small hub plus a
[what-it-proves](/docs/userland/proof-io/what-it-proves/) walk-through, a [contributing](/docs/userland/proof-io/contributing/) page, and a
[debugging](/docs/userland/proof-io/debugging/) page.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `proof-io` | `userland/capsule_proof_io/Capsule.mk:7` |
| Service handle | `proof_io` | `Capsule.mk:8` |
| Service endpoint | `service:4500:proof_io` | `Capsule.mk:14` |
| Reply endpoint | `reply:4501:endpoint.proof_io.reply` | `Capsule.mk:15` |
| Capability mask | `0x19` | `Capsule.mk:17` |

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x01` | run as a process |
| IPC | `0x08` | send and receive on its endpoints |
| Memory | `0x10` | map its own heap and stack |

`0x01 | 0x08 | 0x10 = 0x19`. The bit values are `CoreExec => 1`, `IPC => 8`, and `Memory => 16` in
`src/capabilities/types.rs:56,59,60`. The kernel spawn mirror requests exactly these three,
`Capability::CoreExec.bit() | Capability::IPC.bit() | Capability::Memory.bit()`, so the manifest ceiling
and the requested set agree bit for bit ([`src/userspace/capsule_proof_io/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_proof_io/spawn.rs#L49)).

This is the smallest useful mask in the system. `proof_io` holds no filesystem, network, driver, crypto,
graphics, admin, or debug capability of its own. It does not even hold the endpoints it names: the service
and reply ports exist for the manifest contract, but the current proof is one-shot and never runs an IPC
server. Compromising `proof_io` yields the right to run and to map its own memory, and nothing more.

## What it proves

The capsule exercises the userland-to-kernel syscall path, the one seam between a CPL3 process and the
microkernel. It makes four assertions in order, and any failure exits immediately with a distinct code
and a `FAIL` marker ([`userland/capsule_proof_io/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs#L37)):

```
  time-loop      1024x mk_time_millis() >= 0        a legal call always succeeds
  invalid-number bad tag           -> -38 ENOSYS    an unknown number is refused
  invalid-pointer MkDebug bad ptr  -> -14 EFAULT    a bad user pointer is refused
  invalid-size   MkDebug len 257   -> -22 EINVAL    an over-length is refused
  retired-enosys 4 dead tags       -> -38 ENOSYS    removed calls stay dead
```

Reaching the end prints one line, `[SYSCALL-PROOF] PASS ...`, and exits 0. The
[what-it-proves](/docs/userland/proof-io/what-it-proves/) page walks each assertion against the kernel error path it depends on.

## Code pillars

The source is one file, [`userland/capsule_proof_io/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_proof_io/src/main.rs), but it has three clear parts:

| Part | Lines | What it covers |
|------|-------|----------------|
| Expectations | `main.rs:22` | the tags under test (`BAD_TAG`, `MDBG_TAG`, the four `RETIRED` numbers) and the fixed `PASS`/`FAIL` marker strings |
| Assertions | `main.rs:37` | the `_start` body: the time loop, then the three malformed calls, then the retired-tag loop, each with its own exit code |
| Reporting | `main.rs:64` | the `mk_debug` marker write and the `mk_exit` status that carries the verdict off the process |

Every syscall goes through the userspace libc: `mk_time_millis`, `mk_debug`, `mk_exit`, and the raw
`mk_syscall_raw` (a re-export of `call_raw`) that lets the proof hit the boundary with numbers the safe
wrappers would refuse to send ([`userland/libc/src/lib.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/lib.rs#L81)).

## Lifecycle and how it reports

`proof_io` is spawned through [verified spawn](/docs/security/capsules-and-trust/): its id cert,
manifest, and attestation trailer are checked, its requested `0x19` is held against its manifest ceiling,
and only then is its ELF mapped ([`src/userspace/capsule_proof_io/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_proof_io/spawn.rs#L35)). The boot entry calls
`spawn_proof_io_capsule` under the `nonos-user-entry-proof` feature ([`src/userspace/init/entry.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L43)).

It reports on two channels, both observable from the boot serial:

- The marker line. `mk_debug` writes one fixed string to the trusted debug channel: `[SYSCALL-PROOF]
  PASS ...` on success, or a specific `[SYSCALL-PROOF] FAIL ...` line naming the check that failed
  (`main.rs:64`, `main.rs:28`). Unlike most capsules there is no kernel `capsule spawned` line, because
  the spawn passes an empty `debug_tag` (`spawn.rs:52`); the proof's own markers are the evidence.
- The exit status. `mk_exit` carries 0 for pass, or 1..5 for the five failure points, so the verdict is
  legible even if the serial line is missed (`main.rs:65`, `main.rs:41`).

## Source map

Everything here is drawn from `userland/capsule_proof_io/` (the capsule source, its `Capsule.mk`, and its
`Cargo.toml`), `userland/libc/` (the `mk_*` syscall helpers), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability
bits), and the kernel spawn mirror under `src/userspace/capsule_proof_io/`. Every reference above is
verified against those trees.
