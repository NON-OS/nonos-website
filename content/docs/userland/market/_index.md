---
title: "The Market Capsule"
description: "capsulemarket is the app catalog: a signed userland service that ingests one signed index of available capsules, serves their metadata and releases over IPC, and answers whether..."
weight: 400
---
`capsule_market` is the app catalog: a signed userland service that ingests one signed index of available
capsules, serves their metadata and releases over IPC, and answers whether a given release is ready to
install on this machine. It is a read-only index authority. It holds no install logic (that lives in
[capsule_installer](/docs/userland/installer/)) and no payment logic, and it never fetches or installs code
itself. Its one job is to decide, behind a signature gate, what the desktop and the installer are allowed
to see and offer.

The whole design turns on one honest boundary. The market gates its index on an Ed25519 signature, and the
verifier that checks that signature is chosen at compile time. A production build links the real
cryptographic verifier; a development build compiled with the `offline-verify` Cargo feature links a
reject-all stub instead, so every signed index is refused. This documentation mirrors the source one page
per pillar so a page can be read beside the folder it describes, and it is careful about the
verifier-versus-stub split throughout, because that split is the difference between a build that verifies
signatures and one that verifies nothing.

## Identity

Everything the kernel and the service registry need to name and reach the market comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `market` | `Capsule.mk:7` |
| Service handle | `market` | `Capsule.mk:8` |
| Namespace | `systems.nonos.market` | `Capsule.mk:13` |
| Service endpoint | `service:4106:market.index` | `Capsule.mk:14`, [`src/security/market_capsule/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/market_capsule/spawn.rs#L37), `spawn.rs:38` |
| Reply endpoint | `reply:4107:endpoint.4294967303` | `Capsule.mk:15`, `spawn.rs:39` |
| Capability mask | `0x19` (manifest); `0x18` requested at spawn | `Capsule.mk:17`, `spawn.rs:56` |
| Binary name | `market` | `Capsule.mk:11` |
| Kernel mirror | `src/security/market_capsule` | `Capsule.mk:18` |

The reply endpoint number is not arbitrary. The capsule sends every reply to the kernel reply endpoint
`0x1_0000_0007` ([`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17)), which is decimal `4294967303`, exactly the number in the
reply endpoint name.

The capability mask decomposes against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x0001  CoreExec   bit()  1    types.rs:56
  0x0008  IPC        bit()  8    types.rs:59
  0x0010  Memory     bit() 16    types.rs:60
  ------
  0x0019  = 1 + 8 + 16
```

There is a real discrepancy here worth stating plainly rather than smoothing over. `Capsule.mk:17`
declares `CAPSULE_REQUIRED_CAPS := 0x19` and its comment on `Capsule.mk:16` reads `IPC | Memory = 0x08 |
0x10 = 0x19`, but `0x08 | 0x10` is `0x18`, not `0x19`; the extra bit is CoreExec (`0x01`). The kernel-side
spawn requests exactly `Capability::IPC.bit() | Capability::Memory.bit()`, which is `0x18`, and requests
nothing else ([`src/security/market_capsule/spawn.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/market_capsule/spawn.rs#L56)). So the value the manifest and attestation are
built from (`0x19`) carries a CoreExec bit that the runtime spawn does not request, and CoreExec is not
added implicitly anywhere in the spawn path. Either way the market holds no FileSystem, no Network, no
Crypto, and no hardware capability; the extra bit is a manifest arithmetic slip, not a live authority the
capsule uses.

## The pillars

The source under `userland/capsule_market/src/` is seven top-level modules ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). They group
into three pillars, and the documentation is one page each. An index blob arrives, the verification pillar
either accepts it into the store or refuses it, and the protocol pillar then serves queries against that
store, one of which is the readiness verdict.

```
  ingest + verify + bootstrap_trust   ->   store   ->   protocol + server
  the signature gate                       the one       the wire, the ops,
  that guards the catalog                  accepted      and the handlers that
                                           index         answer queries
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/market/protocol/) | `src/protocol/`, `src/server/` | The 20-byte wire header, the six ops and their errnos, the receive/decode/dispatch/reply loop, and each handler's request and reply shape. |
| [verification.md](/docs/userland/market/verification/) | `src/verify/`, `src/ingest/`, `src/bootstrap_trust/` | The verifier trait and its two implementations, the real-verifier-versus-stub swap, the trusted-operator gate, the monotonic-serial check, and the per-release publisher signatures. |
| [readiness.md](/docs/userland/market/readiness/) | `src/install_ready/`, `src/store/` | The six-byte install-readiness verdict, the fields it decomposes into, the compile-time running-arch triple, and the single accepted index the store holds. |
| [contributing.md](/docs/userland/market/contributing/) | the whole tree | Where to work, how to add an op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/market/debugging/) | runtime | The boot marker, the errno failure modes, and where to look when ingest refuses an index or a query returns nothing. |

## Lifecycle

1. The kernel spawns the capsule at boot through the boot fleet, behind the `nonos-capsule-market`
   feature: `spawn_market` calls `boot::capsule("MARKET", "market", spawn_market_capsule, shared_state)`
   ([`src/userspace/init/spawn_plan/core.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L36), [`spawn_plan/core.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/core.rs#L39)). When the feature is off,
   `spawn_market` is a no-op ([`spawn_plan/core.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/core.rs#L42)).
2. `spawn_market_capsule` decodes the baked trust anchor and hands the embedded ELF, id cert, manifest,
   and attestation trailer to `spawn_verified`, registering `market.index` on service port 4106 with a
   reply on 4107 and requesting `IPC | Memory` ([`src/security/market_capsule/spawn.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/market_capsule/spawn.rs#L42), `spawn.rs:56`,
   `spawn.rs:59`). On success it records the pid alive (`spawn.rs:60`).
3. The boot helper logs `[MARKET] capsule spawned` on success or an error line on failure
   ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot/run.rs#L32)).
4. Inside the capsule, `_start` initializes the heap, constructs an empty store, constructs the verifier
   the build selected, and enters `server::run`, which never returns ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41), [`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46),
   [`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)). Everything after that is request-driven: a caller sends a framed request over
   `market.index`, one handler runs, and one reply goes back.

The market registers no authority of its own beyond `IPC | Memory`. It holds no FileSystem, so the index
cannot arrive off a disk it reads; no Network, so it cannot fetch the index itself; and no Crypto, so it
cannot hold or use a key directly. The capsule that decides whether an app is trusted enough to install
cannot itself touch a key, a disk, or the wire. The kernel-side client that forwards requests to the
capsule is caller-gated on `CAP_APPS` ([`src/security/market_capsule/capability.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/market_capsule/capability.rs#L30)); the capsule's own
inbox performs no caller attestation and answers whoever reaches it.

## Source map

```
  userland/capsule_market/src/main.rs         _start -> server::run; the compile-time verifier selection
  userland/capsule_market/src/protocol/       the wire header, ops, errnos, and codecs
  userland/capsule_market/src/server/         the recv/decode/dispatch/reply loop and the handlers
  userland/capsule_market/src/ingest/         blob decode plus the verification pipeline
  userland/capsule_market/src/verify/         the Verifier trait and its two implementations
  userland/capsule_market/src/bootstrap_trust/ the baked trusted operator keys
  userland/capsule_market/src/install_ready/  the readiness evaluator and the running-arch triple
  userland/capsule_market/src/store/          the single accepted index and its flags
  userland/capsule_market/Capsule.mk          slug, handle, ports, capability mask, kernel mirror
  userland/marketplace_abi/                   the shared index and release codec the capsule decodes
  src/security/market_capsule/                the kernel-side embed, verified spawn, and CAP_APPS client gate
  src/capabilities/types.rs                   the capability bits behind the mask
```

Every reference above is verified against those trees.
