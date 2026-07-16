---
title: "Debugging capsule_ripgrep"
description: "Read the overview first. capsuleripgrep is a defined contract with no implementation yet, so this page is not the usual \"read the markers and find the stalled stage.\" There is n..."
weight: 2
---
Read the [overview](/docs/userland/ripgrep/) first. `capsule_ripgrep` is a defined contract with no implementation yet, so
this page is not the usual "read the markers and find the stalled stage." There is no running program to
debug. The honest debugging question for this capsule is different: what exists today, why it will not spawn
or run, and where each piece of the contract lives so a contributor can tell a missing part from a broken
one. Everything below is drawn from the files that exist; where a behaviour is only intended, this page says
so rather than describing it as if it ran.

## The state you are actually debugging

The capsule directory `userland/capsule_ripgrep/` holds two source-controlled files, `README.md` and
`Capsule.mk`, and nothing else. There is no `src/` tree and no `Cargo.toml`
(`userland/capsule_ripgrep/README.md:1`, verified: the directory has neither). So there is no binary to
run, no service answering on its endpoints, and no serial marker to grep for. If you are looking for a
`ripgrep` window or an `rg` process on a running system, you will not find one, and that is the expected
state, not a fault.

Because there is no code, the failure is total and structural rather than a bug at some stage. The useful
work is locating which required artifact is absent, in the order the boot path needs them.

## Why it will not spawn today

The kernel side is written and waiting, but three things stand between the contract and a live process, and
all three are currently unmet.

### The feature is off, so the spawn call is compiled out

The spawn is guarded by the `nonos-capsule-ripgrep` feature. Under the feature, `run_ripgrep` calls
`spawn_ripgrep_capsule` and logs either `[RIPGREP] capsule spawned` on success or a spawn-failed line on
error ([`src/userspace/init/entry.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L62), `entry.rs:63`, `entry.rs:65`, `entry.rs:66`). Without the feature,
`run_ripgrep` is an empty function and nothing is ever attempted (`entry.rs:70`, `entry.rs:71`). The feature
is declared in the kernel crate (`Cargo.toml:69`). So on a default build there is no `[RIPGREP]` marker of
any kind, not because the spawn failed but because the spawn call is not in the binary.

### There is no signed ELF for the mirror to embed

Even with the feature on, the spawn depends on an embedded binary that does not exist yet. The kernel mirror
embeds the id cert, manifest, and attestation trailer by the binary name `rg`
([`src/userspace/capsule_ripgrep/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/embed.rs#L18), `embed.rs:19`), and those artifacts only exist after the
upstream `rg` binary is built and signed against the `0x19` manifest and the trust anchor. The upstream
build recipe is written in the repository Makefile, running `cargo install ripgrep --version 14.1.1` against
the NØNOS user target with no source patched (`Makefile:548`, `Makefile:552`, `Makefile:554`), but until it
is run and the result is signed, there is nothing for the mirror to embed and the feature build will not
link. This is the largest missing part, and it is a build-and-sign problem, not a code problem.

### The prebuilt path does not yet agree with where the build writes

`Capsule.mk` points the capsule at a prebuilt binary rather than capsule-local source
(`Capsule.mk:26`), and the per-slug rule takes the "install prebuilt" branch and copies from that path
instead of compiling anything (`nonos-mk/capsule.mk:160`, `capsule.mk:161`, `capsule.mk:164`). The Makefile
writes the upstream binary to the repository-level target tree, while `Capsule.mk` names a path relative to
the capsule directory (`Makefile:549`, `Capsule.mk:26`). Until those two agree, the copy step has nothing to
install even after the upstream binary is built. This mismatch and the full four-step path to a running
capsule are laid out on the [contributing](/docs/userland/ripgrep/contributing/) page.

## What is present and correct

Not everything is missing, and it is worth naming what is already sound so it is not mistaken for the
problem. The identity and endpoints are fully defined in `Capsule.mk` (`Capsule.mk:16`..`Capsule.mk:27`).
The capability mask `0x19` is defined and equals its own ceiling, granting only CoreExec, IPC, and Memory
(`Capsule.mk:24`, `Capsule.mk:25`, checked against [`src/capabilities/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L56), `types.rs:59`,
`types.rs:60`). The kernel spawn mirror is written: it requests exactly those three capabilities
([`src/userspace/capsule_ripgrep/spawn.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/spawn.rs#L47)) and registers the service `tool.ripgrep` on port 4820 with a
reply inbox on port 4821 (`spawn.rs:27`, `spawn.rs:28`, `spawn.rs:29`, `spawn.rs:30`), matching the
endpoints the makefile fixes. None of this is broken; it is scaffolding waiting for the binary the mirror
would embed and run. A contributor debugging a non-spawn should not spend time here.

## Where each part of the contract lives

| Piece | State | Where |
|---|---|---|
| Identity and endpoints | Defined | `userland/capsule_ripgrep/Capsule.mk:16`..`Capsule.mk:27` |
| Capability mask `0x19` | Defined | `Capsule.mk:24`, `Capsule.mk:25` |
| Capsule source (`src/`, `Cargo.toml`) | Absent | `userland/capsule_ripgrep/` has neither |
| Kernel spawn mirror | Written, feature-gated | [`src/userspace/capsule_ripgrep/spawn.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/spawn.rs#L47) |
| Kernel embed of `rg` artifacts | Written, needs signed binary | [`src/userspace/capsule_ripgrep/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/embed.rs#L18), `embed.rs:19` |
| Feature flag | Declared, off by default | `Cargo.toml:69`, [`src/userspace/init/entry.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L62) |
| Boot marker | Only under the feature | [`src/userspace/init/entry.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L65) |
| Upstream `rg` build recipe | Written, not yet reconciled | `Makefile:548`, `Makefile:552`, `Makefile:554` |

## How to tell missing from broken

The rule for this capsule is that a non-running ripgrep is missing, not broken, until all four steps on the
[contributing](/docs/userland/ripgrep/contributing/) page are done: build the upstream binary, reconcile the prebuilt path, sign
it, and turn on the feature. Only after the feature is on and a signed `rg` exists will the `[RIPGREP]`
boot marker appear at all, and only then does a spawn-failed line mean something went wrong rather than
something was never present. Until that point, the absence of the capsule is the contract's current state,
faithfully.

## Source map

Everything here is drawn from `userland/capsule_ripgrep/` (the `README.md` and `Capsule.mk`; there is no
`src/` or `Cargo.toml`), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn mirror and
embed under `src/userspace/capsule_ripgrep/`, the feature wiring and boot marker in
[`src/userspace/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs) and `Cargo.toml`, the upstream build recipe in the repository `Makefile`, and
the prebuilt-install branch in `nonos-mk/capsule.mk`. Every reference above is verified against those trees.
