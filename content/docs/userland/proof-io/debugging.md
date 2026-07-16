---
title: "Debugging with proof_io"
description: "proofio is itself a diagnostic, so debugging it is short: it reports on two channels, and every outcome maps to one line in start."
weight: 3
---
`proof_io` is itself a diagnostic, so debugging it is short: it reports on two channels, and every outcome
maps to one line in `_start`. For the identity read the [overview](/docs/userland/proof-io/); for the guarantee behind
each check read [what-it-proves.md](/docs/userland/proof-io/what-it-proves/).

## The markers

The proof reports on two channels, both observable from the boot serial:

- The marker line. `mk_debug` writes one fixed string to the trusted debug channel: on success,
  `[SYSCALL-PROOF] PASS time-loop invalid-number invalid-pointer invalid-size retired-enosys`; on
  failure, a specific `[SYSCALL-PROOF] FAIL <name>` line naming the check that failed (`main.rs:64`,
  `main.rs:28`, `main.rs:30`).
- The exit status. `mk_exit` carries `0` for a pass, or `1..5` for the five failure points, so the
  verdict survives even if the serial line is missed (`main.rs:65`, `main.rs:41`).

Unlike most capsules, there is no kernel `[PROOF-IO] capsule spawned` line, because the spawn passes an
empty `debug_tag` ([`src/userspace/capsule_proof_io/spawn.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_proof_io/spawn.rs#L52)); the empty tag is only ever printed on an
ELF-load error ([`src/kernel_core/process_spawn/capsule_spawn/runner/install/load_elf_into_pid.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/load_elf_into_pid.rs#L28)). The
proof's own `[SYSCALL-PROOF]` markers are the evidence, not a boot banner.

## What a pass looks like

A clean run prints exactly one line and exits 0:

```
  [SYSCALL-PROOF] PASS time-loop invalid-number invalid-pointer invalid-size retired-enosys
```

Every named check ran and returned the exact errno the ABI promises: the 1024x time loop stayed
non-negative, the unknown tag and the four retired tags returned `-38`, the bad pointer returned `-14`,
and the over-length returned `-22` (`main.rs:38`, `main.rs:44`, `main.rs:48`, `main.rs:52`, `main.rs:57`).
Because the `PASS` string lists every check by name, the pass line doubles as a record of what was
actually exercised.

## What a failure looks like, and where it points

The proof stops at the first failed check, so the `FAIL` line and the exit code point straight at the
broken boundary behavior:

| Marker | Exit | The check that failed | Source |
|---|---|---|---|
| `[SYSCALL-PROOF] FAIL loop` | 1 | a legal `mk_time_millis()` returned negative during the 1024x loop | `main.rs:39`, `main.rs:41` |
| `[SYSCALL-PROOF] FAIL invalid-number` | 2 | an unknown tag did not return `-38` (`ENOSYS`) | `main.rs:44` |
| `[SYSCALL-PROOF] FAIL invalid-pointer` | 3 | a bad user pointer to `MkDebug` did not return `-14` (`EFAULT`) | `main.rs:48` |
| `[SYSCALL-PROOF] FAIL invalid-size` | 4 | a length of 257 to `MkDebug` did not return `-22` (`EINVAL`) | `main.rs:52` |
| `[SYSCALL-PROOF] FAIL retired-enosys` | 5 | a removed tag did not return `-38` (`ENOSYS`) | `main.rs:57` |

Each failure is a real ABI regression, and the mapping tells you where to look. A `FAIL loop` means the
positive control broke: the boundary is not serving a call it should, so read the `mk_time_millis` path
before anything else. A `FAIL invalid-number` or `FAIL retired-enosys` means the registry miss stopped
yielding `ENOSYS`, so read `lookup_id` and the errno constant ([`src/syscall/abi/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/mod.rs#L31),
[`src/syscall/microkernel/errnos.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/errnos.rs#L30)). A `FAIL invalid-pointer` or `FAIL invalid-size` means the
`MkDebug` handler stopped guarding its user buffer or its length, so read `sys_mk_debug`
([`src/syscall/microkernel/debug.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/debug.rs#L37), [`src/syscall/microkernel/debug.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/debug.rs#L40)).

## If nothing prints at all

No `[SYSCALL-PROOF]` line on serial means `_start` never ran, so the break is before the capsule, not
inside it. Confirm the kernel was built under `microkernel-proof-io` and the boot entry is compiled with
`nonos-user-entry-proof`, which is what calls `spawn_proof_io_capsule` (`Makefile:897`,
[`src/userspace/init/entry.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L41)). If the feature is on and there is still no line, the spawn itself was
rejected during verification: the id cert, manifest, attestation trailer, or the `0x19` capability
request failed against the manifest ceiling before the ELF was mapped
([`src/userspace/capsule_proof_io/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_proof_io/spawn.rs#L35)).

## Source map

```
  userland/capsule_proof_io/src/main.rs      the checks, exit codes, and PASS/FAIL marker strings
  src/userspace/capsule_proof_io/spawn.rs     the empty debug_tag and the verified spawn
  src/kernel_core/process_spawn/capsule_spawn/runner/install/load_elf_into_pid.rs  where a tag prints on load error
  src/syscall/abi/mod.rs                      lookup_id, the registry miss behind ENOSYS
  src/syscall/microkernel/debug.rs            the MkDebug length and pointer guards
  src/syscall/microkernel/errnos.rs           ENOSYS -38, EFAULT -14, EINVAL -22
  Makefile                                    the proof-io prod kernel target
  src/userspace/init/entry.rs                 the gated boot-entry spawn call
```

Every reference above is verified against those trees.
