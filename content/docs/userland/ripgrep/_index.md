---
title: "The Ripgrep Capsule"
description: "capsuleripgrep is a defined contract with no implementation yet."
weight: 400
---
`capsule_ripgrep` is a defined contract with no implementation yet. Read that sentence first, because it
is the whole point of this page. The capsule directory holds a README and a `Capsule.mk` and nothing else:
there is no `src/`, no `Cargo.toml`, and no NØNOS-authored code. What exists today is an identity and a
build recipe describing what the capsule is meant to become, not a program that runs.

Everything below is drawn from the files that do exist. Where a field is only an intent and not a running
behaviour, this page says so plainly rather than describing the capsule as if it were built.

## The honest state

The directory `userland/capsule_ripgrep/` contains exactly two source-controlled files: `README.md` and
`Capsule.mk`. There is no `src/` tree to compile and no `Cargo.toml` to build from. The capsule's own
README says so in one line: it calls itself a "Ripgrep tool capsule contract"
(`userland/capsule_ripgrep/README.md:1`). No opcode, no request handler, and no runtime behaviour is
defined anywhere in the capsule, so this documentation does not describe any. It documents the identity
the contract fixes and the shape of the work that would fill it in.

The intended implementation is not a from-scratch NØNOS program either. The `Capsule.mk` names it as
unmodified upstream ripgrep from crates.io, version 14.1.1
(`userland/capsule_ripgrep/Capsule.mk:20`, `Capsule.mk:27`), to be built against the NØNOS standard-library
PAL and installed as a prebuilt binary rather than compiled from capsule-local source
(`Capsule.mk:26`). That build is the plan; the wiring that would turn it into a spawnable, signed capsule
is only partly in place, and the parts that are missing are called out on the [contributing](/docs/userland/ripgrep/contributing/)
and [debugging](/docs/userland/ripgrep/debugging/) pages.

## Identity

These are the fields the contract fixes today. They come from `Capsule.mk`; they describe what the capsule
is declared to be, not a service that is currently answering.

| Field | Value | Source |
|---|---|---|
| Slug | `ripgrep` | `userland/capsule_ripgrep/Capsule.mk:16` |
| Service handle | `ripgrep` | `Capsule.mk:17` |
| Binary name | `rg` | `Capsule.mk:19` |
| Upstream domain | `crates.io` | `Capsule.mk:20` |
| Namespace | `systems.nonos.tool.ripgrep` | `Capsule.mk:21` |
| Service endpoint | `service:4820:tool.ripgrep` | `Capsule.mk:22` |
| Reply endpoint | `reply:4821:endpoint.tool.ripgrep.reply` | `Capsule.mk:23` |
| Required capabilities | `0x19` | `Capsule.mk:24` |
| Capability ceiling | `0x19` | `Capsule.mk:25` |
| Upstream metadata | `crates.io ripgrep v14.1.1 publisher` | `Capsule.mk:27` |

The required mask and the ceiling are the same value, `0x19`, so the manifest ceiling grants nothing the
capsule does not already request (`Capsule.mk:24`, `Capsule.mk:25`).

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |

```
  0x19 = 0x01 + 0x08 + 0x10
```

There is no `Network` bit (`0x04`, `types.rs:58`), no `FileSystem` bit (`0x40`, `types.rs:62`), no
`Crypto` bit (`0x20`, `types.rs:61`), and no graphics, driver, MMIO, IRQ, or DMA capability in the mask.
The capsule's own README states the same envelope in prose: it "must use Mk IPC/memory/syscall interfaces
only" and "has no hardware or persistence authority"
(`userland/capsule_ripgrep/README.md:3`, `README.md:4`). This is a headless tool mask, not an app mask:
it holds none of the `GraphicsDisplayQuery`/`GraphicsSurfaceCreate` bits the GUI apps carry, so a built
ripgrep would be a search endpoint reached over IPC, not a window.

Because the capsule is unimplemented, this mask is a declaration of the ceiling a future build would be
held to, not a set of rights any running process currently holds.

## What it is meant to become

The kernel side has a spawn mirror already written for the day the binary exists. It requests exactly the
three capabilities the mask declares, CoreExec, IPC, and Memory, and no others
([`src/userspace/capsule_ripgrep/spawn.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/spawn.rs#L47)). It registers the service `tool.ripgrep` on port 4820 and a
reply inbox `endpoint.tool.ripgrep.reply` on port 4821
([`src/userspace/capsule_ripgrep/spawn.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/spawn.rs#L27), `spawn.rs:28`, `spawn.rs:29`, `spawn.rs:30`), which match the
endpoints the `Capsule.mk` fixes. The spawn is compiled in only under the `nonos-capsule-ripgrep` feature
and is an empty function without it ([`src/userspace/init/entry.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L63), `entry.rs:71`,
`Cargo.toml:69`).

The intended body of the capsule is the unmodified upstream ripgrep binary. The repository Makefile builds
it by running `cargo install ripgrep --version 14.1.1` against the NØNOS user target, linked to the
NØNOS runtime start object, with no source patched (`Makefile:548`, `Makefile:552`, `Makefile:554`). The
result is the `rg` ELF the kernel mirror embeds under the feature
([`src/userspace/capsule_ripgrep/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/embed.rs#L18), `embed.rs:19`). So the end state this contract points at is:
upstream ripgrep, running on the NØNOS std PAL, spawned as a signed least-privilege tool endpoint that
speaks only IPC, memory, and syscalls. None of that is a claim about today; it is the destination the
identity and the build recipe describe.

## Source map

Everything here is drawn from `userland/capsule_ripgrep/` (the capsule's `README.md` and `Capsule.mk`; note
there is no `src/` or `Cargo.toml`), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn
mirror under `src/userspace/capsule_ripgrep/`, the feature wiring in [`src/userspace/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs) and
`Cargo.toml`, and the upstream build recipe in the repository `Makefile`. Every reference above is verified
against those trees.
