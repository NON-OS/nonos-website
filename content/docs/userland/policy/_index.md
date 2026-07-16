---
title: "The Policy Capsule"
description: "policy is the live settings store for NØNOS: a typed, RAM-resident key-value store that holds every user preference, system toggle, and kernel security switch the desktop reads,..."
weight: 400
---
`policy` is the live settings store for NØNOS: a typed, RAM-resident key-value store that holds every user
preference, system toggle, and kernel security switch the desktop reads, and that only the settings app and
the setup wizard may write. Reads are open to any capsule that can speak IPC; writes are gated to those two
named apps. A small set of fields is mirrored into the running kernel, and when one of them changes the
capsule pushes the new value across an admin syscall so the change takes effect rather than only being
recorded.

Its source is organized into four pillars, and this documentation mirrors that structure one page per
pillar so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `policy` | `userland/capsule_policy/Capsule.mk:5` |
| Service handle | `policy` | `Capsule.mk:6`, [`src/userspace/capsule_policy/spawn.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_policy/spawn.rs#L27) |
| Namespace | `systems.nonos.policy` | `Capsule.mk:11` |
| Service endpoint | `service:4108:policy` | `Capsule.mk:12`, `spawn.rs:28` |
| Reply endpoint | `reply:4109:endpoint.policy.reply` | `Capsule.mk:13`, `spawn.rs:29`, `spawn.rs:30` |
| Binary name | `policy` | `Capsule.mk:9` |
| Capability mask | `0x219` | `Capsule.mk:15`, `spawn.rs:32` |
| Kernel mirror | `src/userspace/capsule_policy` | `Capsule.mk:16` |

The service name and both ports are also fixed in the shared proto so any client agrees with the server:
`POLICY_SERVICE_NAME = b"policy"`, `POLICY_SERVICE_PORT = 4108`, `POLICY_REPLY_PORT = 4109`
([`userland/policy_proto/src/service.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/service.rs#L17)).

The mask `0x219` decomposes into four bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | send and receive on its endpoints |
| Memory | `0x0010` | map its own heap and stack |
| Admin | `0x0200` | call the `AdminPolicyPush` syscall that mirrors fields into the kernel |

So `0x219 = 0x0001 + 0x0008 + 0x0010 + 0x0200`, and the kernel spawn path requests exactly those four and
no others (`requested_caps: 0x219`, `spawn.rs:32`, `spawn.rs:47`). There is no `FileSystem` bit (the store
is a RAM struct, not a file), no `Network`, no `Crypto`, and no hardware capability of any kind (no
`Driver`, `Mmio`, `Irq`, `Dma`, `Pio`). The load-bearing bit is `Admin`, which gates the one privileged
call the capsule makes: the `AdminPolicyPush` syscall that carries a mirrored field into the kernel. That
call, and nothing else, is why the store can flip a kernel switch, and it is the whole basis of the
security discussion on the [gate](/docs/userland/policy/gate/) page. A compromised policy capsule yields this mask and nothing
more: it cannot read a block device, open a socket, or touch the hardware behind any bit it stores.

## The four pillars

The source under `userland/capsule_policy/src/` is four top-level modules, plus the shared wire format in
`userland/policy_proto/`, and the documentation is one page each. A request comes in on the service
endpoint, `server` decodes it, `handle_set` runs the write gate, `store` holds the value, and for four
fields `push` mirrors the change into the kernel.

```
  proto/     ->   server/   ->   store/   ->   push/
  the wire        decode +       the 38-      the kernel
  format          dispatch       field RAM    mirror (4
  and gate        store          fields)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/policy/protocol/) | `userland/policy_proto/` + `src/server/` | The wire header, the two operations (`get`, `set`), the per-kind payloads, the poll loop, and the full error table. |
| [fields.md](/docs/userland/policy/fields/) | `userland/policy_proto/src/field*.rs` + `src/store/` | The complete 38-field table with kinds, bounds, and compiled-in defaults, the store struct, and how a value is validated. |
| [gate.md](/docs/userland/policy/gate/) | [`src/server/handle_set.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs) + `src/push/` | The trusted-setter write gate, the four kernel-mirrored fields, the `AdminPolicyPush` syscall, and the boot seed. |
| [contributing.md](/docs/userland/policy/contributing/) | the whole tree | How to add a field, wire it end to end, and the build, sign, and code standards. |
| [debugging.md](/docs/userland/policy/debugging/) | runtime | The boot marker, why a setting does not take effect, why a write is denied, and how a bad request is answered. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initializes the heap, registers the service, seeds the kernel
with the mirrored defaults, and enters the request loop that never returns ([`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)):

1. `heap_init` sets up the allocator; failure exits with code 1 ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)).
2. `bootstrap::register` calls `mk_service_register("policy", 4108)`; failure exits with code 2
   ([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34), [`src/bootstrap/register.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/register.rs#L21), [`src/bootstrap/port.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/port.rs#L17)).
3. `push::seed_kernel` reads the current `KernelPreempt`, `Timezone`, `Hostname`, and `DomainName` and
   pushes each into the kernel so the two agree from boot ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), [`src/push/seed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/seed.rs#L22)).
4. `server::run` enters the poll loop ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38), [`src/server/runner.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L23)).

The kernel spawns the capsule at boot behind the `nonos-capsule-policy` feature, verifying the embedded
ELF, id cert, manifest, and attestation against the baked trust anchor before it runs
([`src/userspace/capsule_policy/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_policy/spawn.rs#L34)). The store lives entirely in RAM behind a spinlock
([`src/store/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L22)); it is not backed by a file and does not persist across a reboot, so every boot
starts from the compiled-in defaults ([`src/store/defaults/store.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/defaults/store.rs#L21)).

## Source map

Everything here is drawn from `userland/capsule_policy/` (the capsule source and its `Capsule.mk`),
`userland/policy_proto/` (the shared wire format), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and
the kernel-side mirror under `src/userspace/capsule_policy/` and `src/sys/policy/`. Every reference above
is verified against those trees.
