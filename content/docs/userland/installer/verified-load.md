---
title: "The verified-load path"
description: "This page follows a load from the installer's handler, through the mkcapsuleload syscall, into the kernel's verified-spawn path, and explains why installing is safe even though ..."
weight: 2
---
This page follows a load from the installer's handler, through the `mk_capsule_load` syscall, into the
kernel's verified-spawn path, and explains why installing is safe even though the installer verifies
nothing itself. It mirrors the load path that starts in `src/server/handlers/` and ends in
`spawn_verified`. For the wire frame and the operations, read the [operations](/docs/userland/installer/operations/) page.

The safety argument is the inverse of what the name suggests: the capsule that loads every other capsule
is the least privileged one in the loading transaction. Its authority to spawn is not a capability bit at
all; it is the `mk_capsule_load` syscall, and the kernel gates that on the trust chain, not on the
installer's caps.

## The one call that matters

Both load handlers and the self-install path build a `CapsuleLoadRequest` and call `mk_capsule_load`
([`src/server/handlers/load_by_name.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_by_name.rs#L80), [`src/server/handlers/load_store.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_store.rs#L64),
[`src/server/selfinstall.rs:72`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/selfinstall.rs#L72)). The libc shim passes a pointer to that struct through syscall `MCLD` and
returns the new pid, or a stable negative errno ([`userland/libc/src/capsule_load.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/capsule_load.rs#L46),
[`userland/libc/src/syscall/numbers/core.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/syscall/numbers/core.rs#L19)). The struct mirrors the kernel layout byte for byte: the
four artifact pointer/length pairs, `requested_caps`, and the args pointer/length
([`userland/libc/src/capsule_load.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/capsule_load.rs#L28)).

Kernel side, `SYS_CAPSULE_LOAD` (also `MCLD`) dispatches to `sys_capsule_load`
([`src/syscall/microkernel/dispatch/process.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/dispatch/process.rs#L35), [`src/syscall/microkernel/numbers.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/numbers.rs#L33)). It validates
the user pointer, copies the struct out of user memory, reads the four blobs and the args, and calls
`load_capsule_from_vfs` ([`src/syscall/microkernel/capsule_load/handle.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/capsule_load/handle.rs#L27), `:34`, `:52`). Loader
failures map to negative errnos: a malformed manifest is `EINVAL`, and a rejected signature, manifest, or
attestation, or a trust-anchor decode failure, is `EACCES`
([`src/syscall/microkernel/capsule_load/errno.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/capsule_load/errno.rs#L23)).

## What the kernel re-verifies

`load_capsule_from_vfs` takes the four artifacts and the `requested_caps` and runs the same verified-spawn
path baked capsules use ([`src/kernel_core/process_spawn/capsule_spawn/from_vfs/load.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/from_vfs/load.rs#L36)). Three
properties make the installer safe to trust with almost nothing.

**The identity comes from the signed manifest, not the caller.** The service name, endpoints, and target
triple are read out of the capsule's own signed manifest, so a loaded capsule registers exactly what it
declares and the caller cannot misname or misroute it ([`from_vfs/load.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/from_vfs/load.rs#L36), `:42`, `:54`, `:124`). The
installer's `requested_caps` field is the only thing the caller controls, and it is a bound, not a name or
a route.

**Every signature, ceiling, and attestation check runs.** The kernel decodes and verifies the
[NØNOS-ID certificate](/docs/security/certificate-schema/) against the baked
[trust anchor](/docs/security/trust-anchor/), verifies the [manifest](/docs/security/manifest-schema/)
publisher signatures, and requires both an Ed25519 and an ML-DSA-65 signature: the production policy lists
both algorithms as required, and every listed algorithm must produce a passing signature
([`src/security/nonos_id_cert/policy.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/policy.rs#L31), [`src/security/capsule_manifest/verify/mod.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/verify/mod.rs#L53),
[`src/security/capsule_manifest/verify/dispatch.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/verify/dispatch.rs#L47)). Only an image that passes all of this, including
the [attestation gate](/docs/security/attestation/), is spawned ([`from_vfs/load.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/from_vfs/load.rs#L73)); a rejected
image surfaces as a negative errno at the syscall, not as anything the installer decided. Each rejection
carries a reason string on the boot log, from `id_cert` through `manifest:pub_sig`,
`manifest:caps_ceiling`, and `attestation` ([`from_vfs/load.rs:83`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/from_vfs/load.rs#L83), `:105`).

**Requested caps are bounded, not granted on request.** The `requested_caps` the caller sends is an upper
bound for the optional caps, identical in meaning to a baked spawn site's request; the verified manifest
still decides what is actually granted ([`from_vfs/load.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/from_vfs/load.rs#L34)). Two checks enforce this:

- The manifest's own declared caps (`required_caps | optional_caps`) must not exceed the certificate
  ceiling, or the load fails with `manifest:caps_ceiling`
  ([`src/security/capsule_manifest/verify/caps.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/verify/caps.rs#L20), [`from_vfs/load.rs:90`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/from_vfs/load.rs#L90)).
- The grant check requires the requested caps to be a subset of what the manifest declares, and the caps
  actually installed are `required_caps | (optional_caps & requested)`
  ([`src/security/capsule_manifest/verify/caps.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/verify/caps.rs#L31)).

So asking for `u64::MAX`, as the self-install path and the terminal's install client both do, can only
ever select within the manifest's own optional set. It can never widen it, and it can never reach a
capability the capsule did not declare and the certificate did not permit.

## Why the installer stays trusted with almost nothing

Because the kernel re-verifies everything, the installer needs no authority beyond running, talking, and
holding memory. Its mask is `CoreExec | IPC | Memory` and no more (`Capsule.mk:18`,
[`src/userspace/capsule_installer/spawn.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_installer/spawn.rs#L33)). It cannot be tricked into loading an unsigned or tampered
image, because a bad image is rejected inside `mk_capsule_load`, not inside the installer. It has no
crypto, so it verifies nothing; no filesystem cap, so it reaches the store only by asking the vfs; no
hardware, driver, or DMA authority.

The two remaining exposures are handled in the handlers themselves and covered on the
[operations](/docs/userland/installer/operations/) page: the by-name path validates the name to `[A-Za-z0-9_-]` before building
any store path, so it cannot escape `/capsules` ([`src/server/handlers/load_by_name.rs:95`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_by_name.rs#L95)), and the
by-payload path folds every artifact offset with `checked_add` and requires the total to match the message
length, so a crafted length cannot cause an out-of-bounds read
([`src/server/handlers/load_store.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_store.rs#L33)). The artifact blobs are stack-owned across the syscall, so there
is no use-after-free of the bytes the kernel copies ([`src/server/handlers/load_by_name.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_by_name.rs#L78)).

The one honest gap is that the installer has no caller attestation: its inbox is a public port, so any
capsule that can reach it can send a load request. But because the kernel's trust chain gates every spawn,
a load only succeeds for a properly signed, in-policy image, so the exposure is a denial-of-service
surface rather than an authenticity one. For the trust chain in full, see
[capsules and trust](/docs/security/capsules-and-trust/).

## Source map

```
  userland/capsule_installer/src/server/handlers/load_by_name.rs  builds CapsuleLoadRequest, valid_name
  userland/capsule_installer/src/server/handlers/load_store.rs    the by-payload variant
  userland/capsule_installer/src/server/selfinstall.rs            the self-install caller of the syscall
  userland/libc/src/capsule_load.rs                     the mk_capsule_load shim and struct layout
  userland/libc/src/syscall/numbers/core.rs             N_MK_CAPSULE_LOAD = MCLD
  src/syscall/microkernel/dispatch/process.rs           SYS_CAPSULE_LOAD -> sys_capsule_load
  src/syscall/microkernel/capsule_load/handle.rs        copy the request, read blobs, call the loader
  src/syscall/microkernel/capsule_load/errno.rs         LoadError -> EINVAL / EACCES
  src/syscall/microkernel/numbers.rs                    SYS_CAPSULE_LOAD tag
  src/kernel_core/process_spawn/capsule_spawn/from_vfs/load.rs   the verified-load path + reason strings
  src/security/capsule_manifest/verify/mod.rs           the ordered verify pipeline
  src/security/capsule_manifest/verify/caps.rs          the ceiling and grant checks
  src/security/capsule_manifest/verify/dispatch.rs      per-algorithm publisher signature verify
  src/security/nonos_id_cert/policy.rs                  the hybrid Ed25519 + ML-DSA-65 required policy
```

Every reference above is verified against those trees.
