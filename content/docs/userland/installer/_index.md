---
title: "The Installer Capsule"
description: "The installer is the keystone that turns a request into a running process."
weight: 400
---
The installer is the keystone that turns a request into a running process. It takes either a capsule name
or a full artifact set, marshals the four blobs a capsule image needs, and hands them to the kernel's
verified-load syscall, which runs the entire trust chain before anything spawns. It is the capsule that
loads every other capsule, and it is deliberately the least privileged actor in that transaction: it holds
no keys, verifies nothing itself, and defers every signature, manifest, and attestation check to the
kernel. Its whole job is to move bytes into `mk_capsule_load` and relay the kernel's verdict.

Its source is organized into two top-level modules, and this documentation mirrors that structure one page
per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the installer comes from its
`Capsule.mk` and its kernel-side spawn record. The two are kept in lockstep: the kernel spawn constants
mirror the `Capsule.mk` fields exactly.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `installer` | `userland/capsule_installer/Capsule.mk:7` |
| Service handle | `installer` | `Capsule.mk:8`, [`src/userspace/capsule_installer/spawn.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_installer/spawn.rs#L28) |
| Namespace | `systems.nonos.installer` | `Capsule.mk:14` |
| Service endpoint | `service:4112:installer` | `Capsule.mk:15`, `spawn.rs:29` |
| Reply endpoint | `reply:4113:endpoint.4294967313` | `Capsule.mk:16`, `spawn.rs:30`, `spawn.rs:31` |
| Capability mask | `0x19` | `Capsule.mk:18`, `spawn.rs:33` |
| Binary name | `installer` | `Capsule.mk:11` |
| Kernel mirror | `src/userspace/capsule_installer` | `Capsule.mk:19` |

The reply inbox name `endpoint.4294967313` is the decimal form of `0x1_0000_0011`, the constant
`KERNEL_REPLY_ENDPOINT` the server sends every reply to ([`src/protocol/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L22),
[`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)). Requests arrive on inbox `0`, the service port ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31)).

The mask `0x19` decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x01` | run as a process |
| IPC | `0x08` | send and receive on its endpoints |
| Memory | `0x10` | map its own heap and stack |

```
  0x01  CoreExec   bit()  1   types.rs:56
  0x08  IPC        bit()  8   types.rs:59
  0x10  Memory     bit() 16   types.rs:60
  ----
  0x19  = 1 + 8 + 16
```

The kernel spawn path requests exactly those three capabilities and no others (`spawn.rs:33`,
`spawn.rs:48`), the same minimal set as the [vfs pool](/docs/userland/vfs/). There is no `Crypto` bit (32),
so the installer verifies nothing itself; no `FileSystem` bit (64), so it reads the store over IPC to the
vfs rather than touching a storage surface; and no `Network`, `Driver`, `Mmio`, `Irq`, `Dma`, or `Pio`, so
a bug in it cannot reach hardware or the wire. The authority that matters, the power to spawn a verified
capsule, is not a bit in this mask at all: it is the `mk_capsule_load` syscall, and the kernel gates that
on the trust chain, not on the installer's caps. That is the whole basis of the
[verified-load](/docs/userland/installer/verified-load/) argument.

The installer holds no filesystem, network, driver, or crypto capability of its own. Every store read,
name lookup, or payment settlement it performs is a request to another capsule that does hold that right,
checked at that capsule's boundary. Compromising the installer yields the installer's mask and nothing
more.

## The two pillars

The source under `userland/capsule_installer/src/` is two top-level modules, and the documentation is one
page each. A request comes in on the service port, the `protocol` codec splits it into a header and a
payload, the `server` dispatches one of four operations, and a load operation drives the request through
`mk_capsule_load` into the kernel's verified-spawn path.

```
  wire  ->  protocol/  ->  server/  ->  mk_capsule_load  ->  kernel verified spawn
  frame     the codec     dispatch      the syscall          re-verifies everything
            + ops         + handlers    (a request)          (the real gate)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/installer/operations/) | `src/protocol/` and `src/server/` | The wire frame, the four operations (healthcheck, install, load-from-store, load-by-name), the dispatch table, the handlers, name validation, and the payment-admission call. |
| [verified-load.md](/docs/userland/installer/verified-load/) | the load path from `mk_capsule_load` to `spawn_verified` | Why installing is safe: the syscall, the kernel-side handler, the manifest signature, ceiling, and grant checks, and why requested caps are bounded not granted. |
| [contributing.md](/docs/userland/installer/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/installer/debugging/) | runtime | The boot marker, install-denied, capsule-not-found, and the other failure modes with where to look. |

## Lifecycle

The installer is spawned as part of the desktop-services fleet at boot. The plan calls `spawn_installer`
(gated on the `nonos-capsule-installer` feature), which runs `boot::capsule("INSTALLER", "installer", ...)`
and verifies the embedded ELF, cert, manifest, and attestation against the baked trust anchor before
registering `installer` on port 4112 ([`src/userspace/init/spawn_plan/desktop_services.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L21), `:35`, `:37`,
[`src/userspace/capsule_installer/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_installer/spawn.rs#L35)). A successful spawn prints `[INSTALLER] capsule spawned` on
the boot log; the [debugging](/docs/userland/installer/debugging/) page covers what each later marker means.

`_start` initializes the heap and calls `server::run`, exiting with code 1 if the heap fails to initialize
([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). Under the `nonos-autorun-install` feature the server first runs a headless
self-verification that loads the staged `std_proof` and `rg` packages through the same verified-load
syscall, so their output lands on serial without a user opening the GUI terminal first (`Capsule.mk:13`,
`Cargo.toml:26`, [`src/server/selfinstall.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/selfinstall.rs#L30)). It is a build-time feature of the capsule, not an
operation callers can invoke. The server then enters the request loop: receive one message on inbox `0`,
decode the header, dispatch one operation, reply to `KERNEL_REPLY_ENDPOINT` ([`src/server/runner.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L26)).

## Source map

```
  userland/capsule_installer/src/main.rs        _start -> heap_init -> server::run; the two modules
  userland/capsule_installer/src/protocol/      the wire codec and the op/errno constants
  userland/capsule_installer/src/server/        the loop, dispatch, discovery, and the four handlers
  userland/capsule_installer/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                     the capability bits behind the mask
  src/userspace/capsule_installer/spawn.rs      the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/desktop_services.rs   the desktop-fleet spawn entry
```

Everything here is drawn from `userland/capsule_installer/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn mirror under
`src/userspace/capsule_installer/`. Every reference above is verified against those trees.
