---
title: "Contributing to capsule_ripgrep"
description: "This page is for a contributor who wants to turn the ripgrep contract into a capsule that actually runs."
weight: 1
---
This page is for a contributor who wants to turn the ripgrep contract into a capsule that actually runs.
Read the [overview](/docs/userland/ripgrep/) first: the capsule is a defined contract with no implementation yet, so the
work here is not "change a behaviour" but "supply the missing body and finish the wiring". Nothing on this
page describes a running program, because there is not one.

## What exists and what is missing

The capsule directory `userland/capsule_ripgrep/` holds two files: `README.md` and `Capsule.mk`. That is
the entire contract. There is no `src/` tree and no `Cargo.toml` in the capsule, so there is nothing to
`cargo build` from the capsule directory itself.

| Piece | State | Where |
|---|---|---|
| Identity and endpoints | Defined | `userland/capsule_ripgrep/Capsule.mk:16`..`Capsule.mk:27` |
| Capability mask `0x19` | Defined | `Capsule.mk:24`, `Capsule.mk:25` |
| Capsule source (`src/`, `Cargo.toml`) | Absent | `userland/capsule_ripgrep/` has neither |
| Kernel spawn mirror | Written, feature-gated | [`src/userspace/capsule_ripgrep/spawn.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/spawn.rs#L33) |
| Feature flag | Declared | `Cargo.toml:69` (`nonos-capsule-ripgrep`) |
| Upstream `rg` build recipe | Written | `Makefile:548`..`Makefile:558` |

The intent recorded in `Capsule.mk` is not to write a NØNOS ripgrep by hand. It names unmodified upstream
ripgrep v14.1.1 from crates.io as the body (`Capsule.mk:20`, `Capsule.mk:27`) and points a prebuilt-binary
path at `target/upstream-ripgrep/rg` (`Capsule.mk:26`). So implementing the capsule is mostly a build and
sign problem, not a coding problem.

## What implementing it would take

1. Build the upstream binary. The Makefile target `nonos-mk-upstream-ripgrep` runs
   `cargo install ripgrep --version 14.1.1` against the NØNOS user target, linked to the NØNOS runtime
   start object, and copies the result to `$(TARGET_DIR)/upstream-ripgrep/rg`
   (`Makefile:552`, `Makefile:554`, `Makefile:558`, `Makefile:561`). This is the ELF the whole rest of the
   chain depends on.

2. Reconcile the prebuilt path. `Capsule.mk` sets `CAPSULE_PREBUILT_BIN := target/upstream-ripgrep/rg`
   (`Capsule.mk:26`), a path relative to the capsule directory, while the Makefile writes the binary to
   the repository-level `$(TARGET_DIR)/upstream-ripgrep/rg` (`Makefile:549`). Because a prebuilt path is
   set, the per-slug build rule takes the "install prebuilt" branch and copies from
   `CAPSULE_PREBUILT_BIN` rather than compiling any source (`nonos-mk/capsule.mk:160`,
   `capsule.mk:161`, `capsule.mk:164`); it does not run cargo in the capsule directory
   (`capsule.mk:166`). A contributor has to make those two paths agree so the copy finds the binary the
   Makefile just built.

3. Sign it. The prebuilt binary is not trusted until it is signed against the baked trust anchor and the
   `0x19` manifest. The kernel mirror embeds the resulting id cert, manifest, and attestation trailer by
   the binary name `rg` ([`src/userspace/capsule_ripgrep/embed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_ripgrep/embed.rs#L22), `embed.rs:26`, `embed.rs:30`), so
   those three artifacts must exist under `nonos-data/trust/capsules/` before the feature build will link.

4. Turn on the feature. The spawn call is compiled in only under `nonos-capsule-ripgrep`; without it
   `run_ripgrep` is an empty function and the capsule never spawns ([`src/userspace/init/entry.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L62),
   `entry.rs:70`, `entry.rs:71`). The feature is declared in the kernel crate (`Cargo.toml:69`).

Only when all four are done does the kernel have a signed ELF to embed and a live spawn path to run it.

## The build and sign targets for the ripgrep slug

The per-slug make targets are generated from the rule template in `nonos-mk/capsule.mk:156` and pulled in
through the `include nonos-mk/capsule.mk` line at the foot of the capsule's own makefile
(`userland/capsule_ripgrep/Capsule.mk:29`). The slug is `ripgrep` (`Capsule.mk:16`), so the generated
target names are:

```
  make nonos-mk-ripgrep                install the prebuilt rg into the capsule build tree
  make nonos-mk-ripgrep-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-ripgrep-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-ripgrep-keys     check the per-capsule signing keys exist
```

The names follow directly from the `.PHONY` line in the template, which expands to
`nonos-mk-$(1) nonos-mk-$(1)-sign nonos-mk-$(1)-verify nonos-mk-check-$(1)-keys` with `$(1)` set to the
slug (`nonos-mk/capsule.mk:158`). Because the prebuilt path is set, `nonos-mk-ripgrep` copies a binary in
rather than compiling one (`nonos-mk/capsule.mk:160`..`capsule.mk:165`); the upstream binary that copy
consumes is produced separately by `nonos-mk-upstream-ripgrep` (`Makefile:560`, `Makefile:561`). Until the
upstream binary exists and the two prebuilt paths agree, `nonos-mk-ripgrep` has nothing to install.

## Code standards

There is no capsule source to hold to a standard yet, so most of the usual rules do not apply. Two things
that do:

- The `Capsule.mk` carries the AGPL header byte for byte the same as every other capsule makefile
  (`userland/capsule_ripgrep/Capsule.mk:1`). Any new file added to the capsule must carry the same header.
- The intent is an unmodified upstream binary (`Capsule.mk:20`, `Makefile:552`). If that intent stands, the
  ripgrep source is not to be patched; the correctness story is "pinned crates.io version built against the
  std PAL", not a fork. A contributor who changes that intent should change the README and this page to
  match, so the documentation never claims an unmodified port that is no longer unmodified.

## Source map

Everything here is drawn from `userland/capsule_ripgrep/` (the `README.md` and `Capsule.mk`; there is no
`src/` or `Cargo.toml`), the target template in `nonos-mk/capsule.mk`, the upstream build recipe and the
per-slug targets in the repository `Makefile`, the kernel spawn mirror and embed under
`src/userspace/capsule_ripgrep/`, and the feature wiring in [`src/userspace/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs) and `Cargo.toml`.
Every reference above is verified against those trees.
