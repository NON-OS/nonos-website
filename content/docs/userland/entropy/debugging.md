---
title: "Debugging capsule_entropy"
description: "This page lists the log markers the entropy capsule and its boot path emit, and the concrete failure modes with where to look for each."
weight: 4
---
This page lists the log markers the entropy capsule and its boot path emit, and the concrete failure
modes with where to look for each. For the operations and error codes see the [README](/docs/userland/entropy/), the
[operations and protocol](/docs/userland/entropy/operations/) page, and the [pool](/docs/userland/entropy/pool/) page in this folder.

## Log markers

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs `[ENTROPY]
capsule spawned` from the capsule boot path: the `Ok` arm calls `boot_log::ok("ENTROPY", "capsule
spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), and `ok` prints `[<tag>] <msg>`
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the capsule never started, and the `Err` arm
logged an `[ERROR]` line with the mapped `SpawnError` instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32),
[`src/sys/boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L49)), which is the usual signature, manifest, or capability failure.

The kernel-side spawn also carries a debug tag `[ENTROPY-DEBUG] load_elf_executable error:` for an ELF
load failure ([`src/security/entropy_capsule/spawn.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/spawn.rs#L55)).

## Failure modes

The error codes are the diagnosis. Each op returns an `i32` status in the first four bytes of its reply
payload, and the three codes mean different things ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

### A GET_RANDOM returns EIO (-5)

This is the distinctive hardware signature, not a policy error. `rdrand_fill` gave up after 32 retries on
a stalled source, `Pool::fill` returned `-5`, and the handler answered `EIO`
([`src/pool/fill.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L49), [`src/server/handlers/getrandom.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getrandom.rs#L38)). The `source_failures` counter increments
on every give-up ([`src/pool/fill.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L50)), so the way to tell a dead source from a busy one is `GET_STATS`:
a rising `source_failures` count alongside `EIO` replies is the CPU generator failing. Because there is
no startup probe, this surfaces at request time, not at boot.

### A GET_RANDOM returns EMSGSIZE (-90)

The request asked for more than 4096 bytes ([`src/server/handlers/getrandom.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getrandom.rs#L32)). The kernel client
also rejects an over-4096 request before it ever round-trips
([`src/security/entropy_capsule/client/get_random.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/client/get_random.rs#L28)), so if you see `EMSGSIZE` on the wire the call
bypassed that client.

### Any op returns EINVAL (-22)

A short or malformed frame, a reseed whose declared length does not match the payload, or an unknown op
([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41), [`src/server/handlers/reseed.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reseed.rs#L34), [`src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L31)). This is
distinct from the `EIO` that means the hardware itself refused. A frame that fails to decode entirely is
answered `EINVAL` rather than dropped, so a bad request never leaves the caller waiting on a reply that
never comes ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)).

### A service call is denied

`GET_STATS` and `RESEED` are not gated inside the capsule; the kernel client gates them before the IPC
leaves the kernel: `CAP_ENTROPY` for stats ([`src/security/entropy_capsule/capability.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs#L23)) and
`CAP_ADMIN` for reseed ([`src/security/entropy_capsule/capability.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs#L35)). A denial there is an
access-denied error from the client, not a status code from the capsule. The pid checked is read from
the kernel's process accounting, not from the request ([`src/security/entropy_capsule/capability.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs#L24)),
so a caller cannot spoof its identity in the payload.

### Random requests succeed but never touch the capsule

The `CryptoRandom` syscall falls back to the kernel hardware RNG when the capsule is dead, stale, or
fails transport ([`src/syscall/dispatch/crypto/random.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L29)), so a caller can be served while the capsule
is down. Confirm the capsule with the `[ENTROPY] capsule spawned` marker and with `GET_STATS` before
assuming it handled a given request. Caller-side errors such as access-denied, invalid-argument,
oversized, and protocol-mismatch are surfaced rather than masked by the fallback
([`src/syscall/dispatch/crypto/random.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L58)).

## Source map

```
  src/userspace/init/capsule_boot/run.rs           [ENTROPY] capsule spawned / [ERROR] path
  src/sys/boot_log/output.rs                        the ok/error line format
  src/security/entropy_capsule/spawn.rs             the [ENTROPY-DEBUG] ELF-load debug tag
  userland/capsule_entropy/src/protocol/errno.rs    EIO / EINVAL / EMSGSIZE
  userland/capsule_entropy/src/pool/fill.rs         the RDRAND give-up that raises EIO
  userland/capsule_entropy/src/server/handlers/getrandom.rs   the EMSGSIZE and EIO arms
  userland/capsule_entropy/src/server/runner.rs     EINVAL-on-malformed
  src/security/entropy_capsule/capability.rs        CAP_ENTROPY / CAP_ADMIN gates; pid from accounting
  src/syscall/dispatch/crypto/random.rs             the CryptoRandom hardware fallback
```

Every reference above is verified against those trees.
