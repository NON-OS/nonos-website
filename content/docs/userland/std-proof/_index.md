---
title: "The std_proof Capsule"
description: "capsulestdproof is not an application. It is a self-test: a small signed capsule whose only job is to prove, at runtime on a real NØNOS boot, that an unmodified crate pulled str..."
weight: 400
---
`capsule_std_proof` is not an application. It is a self-test: a small signed capsule whose only job is to
prove, at runtime on a real NØNOS boot, that an unmodified crate pulled straight from crates.io compiles
and runs on NØNOS through the [std PAL](/docs/userland/std-pal/). Its `main` parses JSON with `serde_json`, matches
text with `regex`, and encodes bytes with `base64`, none of them edited, and prints a single serial line
carrying the results. If that line appears with the expected values, the graft works; if it is missing or
carries an error, it does not. That is the whole capsule.

Where the [snake](/docs/userland/snake/) and [terminal](/docs/userland/terminal/) capsules are real
least-privilege apps, std_proof exists to exercise the toolchain path the PAL page describes, so this
documentation is small on purpose: this hub, one page on what it exercises, and the contributing and
debugging pages.

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `std-proof` | `userland/capsule_std_proof/Capsule.mk:9` |
| Service handle | `std_proof` | `Capsule.mk:10`, [`src/userspace/capsule_std_proof/spawn.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_std_proof/spawn.rs#L28) |
| Domain | `systems.nonos` | `Capsule.mk:11` |
| Namespace | `systems.nonos.std_proof` | `Capsule.mk:15` |
| Binary name | `std_proof` | `Capsule.mk:13`, `Cargo.toml:11` |
| Cargo feature | `nonos-capsule-std-proof` | `Capsule.mk:14` |
| Service endpoint | `service:4502:std_proof` | `Capsule.mk:16`, `spawn.rs:29` |
| Reply endpoint | `reply:4503:endpoint.std_proof.reply` | `Capsule.mk:17`, `spawn.rs:30`, `spawn.rs:31` |
| Capability mask | `0x19` | `Capsule.mk:19` |
| Kernel mirror | `src/userspace/capsule_std_proof` | `Capsule.mk:20` |

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x01` | run as a process | `types.rs:56` |
| IPC | `0x08` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x10` | map its own heap and stack | `types.rs:60` |

```
  0x19 = 0x01 + 0x08 + 0x10
```

The kernel spawn path requests exactly those three capabilities by name and no others
([`src/userspace/capsule_std_proof/spawn.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_std_proof/spawn.rs#L48)). There is no `Network` bit (`0x04`, `types.rs:58`), no
`FileSystem` bit (`0x40`, `types.rs:62`), and no crypto, graphics, driver, MMIO, IRQ, DMA, or PIO
capability in the mask. This is the honest floor for the test: the proof runs entirely inside the Mk
syscall boundary, so it needs to execute, hold its own memory, and speak IPC, and nothing more. The
source README states the same ceiling: it "must not request hardware, storage or network authority"
(`userland/capsule_std_proof/README.md:5`).

## What it proves

The value of the capsule is not the arithmetic it prints but the fact that it links and runs at all. The
crate is built with real upstream `std` (`CAPSULE_BUILD_STD := std,panic_abort`, `Capsule.mk:7`) and
linked against the `nonos-rt` `_start` shim ([`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1), [`.cargo/config.toml`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.cargo/config.toml)), and it depends on
three ordinary crates.io crates with no NØNOS-specific edits (`Cargo.toml:15`). Each one exercises a
different part of the standard library and the PAL:

| Pillar | Crate | Exercises | Source |
|---|---|---|---|
| JSON parse | `serde_json` | heap allocation, `String`/`Vec`, `Result` handling, iterator adapters | [`src/main.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L9), [`src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L17) |
| Regex match | `regex` | a larger dependency graph compiling and running under std | [`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23) |
| Base64 encode | `base64` | trait-based byte encoding on top of `alloc` | [`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30) |
| Serial print | `println!` | the PAL stdout backend, which maps to the MDBG debug syscall over serial | [`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31) |

The [what it exercises](/docs/userland/std-proof/std-facilities/) page walks each pillar in detail. The point every pillar shares
is the one the [std PAL](/docs/userland/std-pal/) page makes: only the platform layer is swapped, so all the
portable code in these crates is the genuine published code running unchanged.

## Lifecycle

std_proof is spawned through [verified spawn](/docs/security/capsules-and-trust/): its embedded ELF, id
cert, manifest, and attestation trailer are checked, its requested capabilities are held against its
manifest ceiling, and only then is its ELF mapped ([`src/userspace/capsule_std_proof/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_std_proof/spawn.rs#L34)). It is
compiled into a boot image only under the `nonos-capsule-std-proof` feature; without it the kernel entry
hook is an empty stub ([`src/userspace/init/entry.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L59)).

Unlike the desktop apps it is not baked-spawned at boot. The kernel init keeps a reference to the spawn
function so it is not flagged dead, logs `[STD-PROOF] staged for runtime install`, and leaves the capsule
in the VFS package store to be loaded at runtime with `install std_proof`, which keeps its service port
free for that path ([`src/userspace/init/entry.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L50), `entry.rs:56`).

## How it reports the result

There is no exit code and no reply frame. The capsule asserts by printing and by returning early, and the
proof is read off the serial log:

- On success `main` prints one line beginning `NØNOS ran crates.io serde_json+regex+base64:` followed by
  the parsed OS string, the summed array (`3+7+11+179`, so `nums sum=200`), the boolean, the regex hit
  count, and the base64 of `nonos` ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). Seeing that line with those fields is the pass.
- On a `serde_json` parse error `main` prints `nonos std proof: serde_json parse failed:` with the error
  and returns without printing the success line ([`src/main.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L11)).
- On a `regex` compile error it prints `nonos std proof: regex compile failed:` and returns the same way
  ([`src/main.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L25)).

So a run is a pass only if the final success line appears; either failure line, or no line at all, is the
signal that the graft or the spawn broke. The [debugging](/docs/userland/std-proof/debugging/) page maps each of those outcomes
to where to look.

## Source map

```
  userland/capsule_std_proof/src/main.rs      the whole proof: parse, match, encode, print
  userland/capsule_std_proof/Capsule.mk       slug, handle, endpoints, mask, build-std=std, mirror
  userland/capsule_std_proof/Cargo.toml       the three crates.io deps, panic=abort, AGPL
  userland/capsule_std_proof/.cargo/config.toml  links the nonos-rt _start shim
  src/capabilities/types.rs                   the CoreExec / IPC / Memory bit values
  src/userspace/capsule_std_proof/spawn.rs    the kernel spawn mirror and requested caps
  src/userspace/init/entry.rs                 the feature gate and the runtime-install staging log
```

Every reference above is verified against those trees.
