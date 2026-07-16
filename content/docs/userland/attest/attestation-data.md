---
title: "The Attestation Data"
description: "This page mirrors userland/capsuleattest/src/state/ and the two authored tables that live inside their handlers."
weight: 4
---
This page mirrors `userland/capsule_attest/src/state/` and the two authored tables that live inside their
handlers. It is the substantive page: it reproduces what the capsule actually serves and draws the honest
boundary on each. The `PROOF_` operations return pre-authored data, not proof computations. No handler in
this capsule touches the STARK, the zk_kernel, or any signing key.

Back to the [hub](/docs/userland/attest/).

## What the responses actually are

The three sources of served data are the `state` module (`PROOF_SUMMARY`, `PROOF_INVARIANTS`), the boot
handler's fixed label (`PROOF_BOOT`), and the `KNOWN_CAPSULES` table inside the capsule-list handler
(`PROOF_CAPSULE_LIST`). All four are compile-time constants; only `PROOF_BOOT` reads a live kernel value,
the boot clock, and even that is paired with a fixed label rather than a measured chain.

## The product summary

`OP_PROOF_SUMMARY` returns three fields from [`src/state/product.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/product.rs#L17):

```
  PRODUCT_NAME     NØNOS
  PRODUCT_TAGLINE  Capability-based RAM-resident microkernel
  PRODUCT_VERSION  env!("CARGO_PKG_VERSION")   (0.1.0 at Cargo.toml:10)
```

The name and tagline are fixed byte strings; the version is baked from the crate version at build time
(`product.rs:19`). These are re-exported through [`src/state/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/mod.rs#L21).

## The invariants, in full

`OP_PROOF_INVARIANTS` returns the six-entry `INVARIANTS` table ([`src/state/invariants.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/invariants.rs#L23)). Each entry
is an `Invariant` with a `name`, a `claim`, and a `mechanism`, all authored as constant byte strings
([`src/state/invariants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/invariants.rs#L17)). They are the heart of the response and worth reproducing, because each
`mechanism` names a real kernel component documented elsewhere in this wiki:

```
  NO LOGS
    claim:     no shipped capsule may emit MkDebug or open a serial surface
    mechanism: every shipped Capsule.mk has Debug bit absent from CAPSULE_REQUIRED_CAPS;
               kernel rejects MkDebug syscalls outside the mask

  NO TRACES
    claim:     no persistent user identifier or content survives a capsule exit
    mechanism: every shipped capsule refuses FileSystem cap unless explicitly granted;
               clipboard has idle auto-clear; input_router holds no history

  EPHEMERAL
    claim:     all state is RAM-resident; no on-disk record exists unless a capsule
               declares FileSystem in its mask
    mechanism: only ramfs + vfs touch disk surfaces; the trust keystore is read-only at boot

  NOT LINUX
    claim:     no POSIX shapes, no errno tables, no fd numbering, no signal model
    mechanism: Mk* 4-byte ASCII tag syscall ABI; NCMP-style wire across every capsule;
               capability taxonomy is NØNOS-native

  PRIVACY MICROKERNEL
    claim:     every capsule runs CPL=3 with a static capability mask the kernel enforces
               at every syscall
    mechanism: capsule_spawn::spawn_verified records caps_bits; syscall dispatch checks the
               cap mask before every routed handler; mask is signed in the capsule manifest

  HYBRID-PQ SIGNATURES
    claim:     every binary loaded at runtime is signed Ed25519 + ML-DSA-65 and chains to
               the baked trust anchor
    mechanism: capsule_spawn::spawn_verified rejects any ELF whose nonos_id_cert + manifest
               do not both verify against BAKED_TRUST_ANCHOR_POLICY
```

Each mechanism corresponds to code this wiki documents: the capability-mask enforcement is the
[syscall boundary](/docs/subsystems/syscall/boundary/), the hybrid signatures are the
[verified-spawn gate](/docs/security/capsules-and-trust/) requiring both Ed25519 and ML-DSA-65, the
RAM-residency is the [zeroization](/docs/subsystems/memory/zeroization/) posture, and the `Mk*` ABI is
the [syscall numbers](/docs/subsystems/syscall/numbers/). So the invariants are an accurate catalogue of
guarantees, each checkable against the cited code; they are just not proven by this capsule at request
time. The `spawn_verified` path the last two invariants cite is the same one this capsule was loaded
through ([`src/userspace/capsule_attest/spawn.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_attest/spawn.rs#L52)).

## The boot identity

`OP_PROOF_BOOT` returns a timestamp and a fixed label. The timestamp is `mk_time_millis`, clamped to 0 if
the syscall returns a negative value ([`src/server/handlers/proof_boot.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_boot.rs#L39)). The label is the fixed byte
string `NØNOS bootloader (hybrid Ed25519 + ML-DSA-65)` (`proof_boot.rs:28`). This is a boot-identity string
plus a monotonic uptime, not a measured boot chain.

The real boot attestation, the kernel's measured `zk_verified` and `secure_boot` status, is read through
`mk_attest_status` by the [boot splash](/docs/userland/boot-splash/), not by this capsule
([`userland/capsule_boot_splash/src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_boot_splash/src/main.rs#L52), [`userland/libc/src/attest.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/attest.rs#L30)). This capsule never
calls `mk_attest_status`. The genuine cryptographic machinery lives in the kernel, in the transparent
[STARK and Pedersen attestation](/docs/security/attestation/) and the capsule-attestation gate that
verifies an enrolled-secret proof at spawn.

## The capsule-mask table

`OP_PROOF_CAPSULE_LIST` returns the hard-coded `KNOWN_CAPSULES` table: each shipped capsule and the
capability mask it is expected to hold ([`src/server/handlers/proof_capsule_list.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_capsule_list.rs#L20)). It is not a live
process census and does not query the kernel for the running caps_bits; it is an authored expectation table
an auditor can compare against the manifests. The seventeen entries and their declared masks:

```
  ramfs 0x19          vfs 0x19            keyring 0x19        entropy 0x19
  crypto 0x19         market 0x19         clipboard 0x19      attest 0x19
  input_router 0x19   wm 0x19
  compositor 0x7819   desktop_shell 0x1819   wallpaper 0x1819   about 0x1819
  calculator 0x1819   terminal 0x1819
  driver.virtio_gpu0 0x1F9019
```

The value of the table is exactly the NO LOGS check. Every mask can be inspected for the `Debug` bit (256,
[`src/capabilities/types.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L64)), and none of the seventeen carries it, so an auditor can confirm the NO
LOGS posture programmatically without trusting a narrative. The table is authored, so it is a statement of
what the system should ship, not a readout of what is running; the live enforcement is the kernel's, at
every syscall, against the signed manifest.

## The honest boundary

Stated plainly, so no reader mistakes authored data for a proof:

- The reply carries no cryptographic signature; it is protected by the transport and the capsule's own
  verified spawn, not by a signature over the payload.
- The capsule-mask table is authored rather than read from the kernel's live caps_bits.
- `OP_PROOF_BOOT` returns a fixed label and an uptime, not a measured boot chain.

What this capsule is trusted with is telling the truth about the system, and the security value is that its
authored invariants and its capsule-mask table are checkable against the cited code, not that they are
attested at request time.

## Source map

```
  src/state/mod.rs                         re-exports INVARIANTS and the PRODUCT_* constants
  src/state/product.rs                     PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_VERSION
  src/state/invariants.rs                  the Invariant struct and the six {name, claim, mechanism}
  src/server/handlers/proof_capsule_list.rs   KNOWN_CAPSULES, the seventeen-entry mask table
  src/server/handlers/proof_boot.rs        the fixed boot label and the clamped clock read
  src/capabilities/types.rs                the Debug bit (256) an auditor checks the table against
```

Every reference above is verified against `userland/capsule_attest/` and the cited kernel trees.
</content>
