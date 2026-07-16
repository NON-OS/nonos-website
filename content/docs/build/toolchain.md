---
title: "Toolchain"
description: "This page describes the x8664 user target, cargo build flags, Make targets, and how capsules compile."
weight: 2
---
This page describes the x86_64 user target, cargo build flags, Make targets,
and how capsules compile. Read [Build](/docs/build/), then
[Signing](/docs/build/signing/).

---

## 1. Rust targets

The userland target is [`userland/x86_64-nonos-user.json`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/x86_64-nonos-user.json). It uses
`x86_64-unknown-none-elf`, target arch `x86_64`, vendor `nonos`, OS `none`, and
64-bit little-endian pointers ([`userland/x86_64-nonos-user.json:2`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/x86_64-nonos-user.json#L2)). It sets
`panic-strategy` to `abort`, uses `rust-lld`, links with `-nostdlib`, `-pie`,
`--gc-sections`, and 4 KiB max page size, then sets PIC and static PIE output
([`userland/x86_64-nonos-user.json:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/x86_64-nonos-user.json#L30)).

The kernel target is `x86_64-nonos.json`. It uses the same LLVM target but
disables the red zone, links `-no-pie`, sets relocation model `static`, and
uses code model `kernel` (`x86_64-nonos.json:16`).

| Target file | Intended binary | Link posture |
|-------------|-----------------|--------------|
| [`userland/x86_64-nonos-user.json`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/x86_64-nonos-user.json) | Capsule ELF | PIE, PIC, no default libraries |
| `x86_64-nonos.json` | Kernel ELF | static, kernel code model, no default libraries |

## 2. Toolchain bootstrap

The Makefile pins Rust to `nightly-2026-01-16` (`Makefile:64`). The toolchain
stamp target installs the pinned toolchain, adds `x86_64-unknown-uefi`, and
adds `rust-src`, clippy, and rustfmt (`Makefile:225`).

`nonos-mk-check-deps` depends on the same toolchain stamp
(`Makefile:176`). The default `nonos-mk` target builds the microkernel-capsules
baseline through `nonos-mk-capsules` (`Makefile:162`).

## 3. Userland libc

The Makefile builds `userland/libc` into
`userland/libc/target/x86_64-nonos-user/release/libnonos_libc.a`
(`Makefile:251`). The recipe runs cargo with the pinned toolchain, the
[`../x86_64-nonos-user.json`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/../x86_64-nonos-user.json) target, and `-Zbuild-std=core`
(`Makefile:282`).

## 4. Capsule compilation

Each `userland/<capsule>/Capsule.mk` is included by the root Makefile
(`Makefile:345`). The shared capsule macro snapshots identity and output paths,
including the binary path, certificate path, manifest path, key paths, handle,
domain, namespace, endpoints, required caps, optional caps, version, target,
and source list (`nonos-mk/capsule.mk:91`).

The capsule ELF rule depends on `USERLAND_LIBC`, `Capsule.mk`, `Cargo.toml`,
`Cargo.lock`, capsule sources, shared userland library sources, and extra deps.
It runs cargo release build with the pinned toolchain, target
[`../x86_64-nonos-user.json`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/../x86_64-nonos-user.json), `-Zbuild-std=core,alloc`, and
`compiler-builtins-mem` when configured (`nonos-mk/capsule.mk:151`).

```
  Capsule.mk
      |
  nonos-mk/capsule.mk
      |
      +-- target/x86_64-nonos-user/release/<bin>
      +-- nonos-data/trust/capsules/<bin>.nonos_id_cert.bin
      +-- nonos-data/trust/capsules/<bin>.manifest.bin
```

## 5. Kernel builds

Kernel builds use `KERNEL_BUILD_FLAGS`: release profile, target
`x86_64-nonos.json`, `-Zbuild-std=core,alloc`, and
`compiler-builtins-mem` (`Makefile:517`). `nonos-mk-check` runs cargo check
with `microkernel-core` only (`Makefile:533`).

The desktop production build depends on signed artifact triples for core
services, drivers, network, desktop, apps, attest, and power, then runs
`nonos-mk-verify-desktop-gui-capsules` before building the kernel with feature
`microkernel-desktop-gui` (`Makefile:1067`). The larger image is
`microkernel-full-gui`, built by `nonos-mk-full-gui-prod`
(`Makefile:1094`); it is `microkernel-desktop-gui` plus the remaining production
hardware driver capsules (Cargo.toml:495). Two of those extras are the input
drivers that matter on real laptops: `microkernel-full-gui` pulls in
`nonos-capsule-driver-i2c-pci` and `nonos-capsule-driver-i2c-hid`
(Cargo.toml:505), which `microkernel-desktop-gui` does not carry. A kernel built
`desktop-gui` therefore has no i2c input path, which is the correct choice for
QEMU (PS/2 and xHCI cover it there) but wrong for hardware whose touchpad or
keyboard is behind i2c-HID.

`nonos-mk-verify-fast` runs static gates only. `nonos-mk-verify` runs static
gates, trust verification, and the symbol scan. `nonos-mk-test` adds the
required QEMU boot harnesses (`Makefile:1366`).

## 6. Build ordering

The kernel embeds every capsule's signed ELF, certificate, and manifest at
compile time with `include_bytes!`. The desktop shell mirror pulls its three
artifacts in from the build and trust locations
([`src/userspace/capsule_desktop_shell/embed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/embed.rs#L18)), and a driver does the same
([`src/hardware/ps2_kbd_capsule/embed.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/embed.rs#L24)). Because `include_bytes!` resolves
at kernel compile time, those files must already exist and be current when the
kernel builds. The production recipes encode this ordering in their
prerequisites: `nonos-mk-desktop-gui-prod` lists every capsule's `*_ARTIFACTS`
(the signed ELF, cert, and manifest) as a dependency before the kernel build step
runs (`Makefile:1068`), so the capsules are compiled and signed first and the
kernel links against fresh bytes. A kernel built against a stale or missing
capsule artifact is the failure this ordering exists to prevent.

Release kernels also require a signing key. Every `*-prod` recipe depends on
`nonos-mk-ensure-signing-key` (`Makefile:1090`), which materialises the Ed25519
seed and the ML-DSA-65 keypair (`Makefile:336`), and the kernel build itself
passes `NONOS_SIGNING_KEY` into cargo (`Makefile:828`). The kernel artifact rule
lists the signing key as a prerequisite (`Makefile:853`), so a build without a
key does not silently produce an unsigned kernel.

## 7. Troubleshooting

The build failures worth naming ahead of time all come from the ordering and key
requirements above.

**A kernel with no drivers.** If the desktop comes up but nothing responds to a
laptop's built-in keyboard or touchpad, the likely cause is the wrong profile:
`microkernel-desktop-gui` carries no i2c input drivers, only PS/2 and xHCI. Build
`microkernel-full-gui` (`nonos-mk-full-gui-prod`, `Makefile:1094`) for hardware
whose input is behind i2c-HID. More broadly, a driver capsule that is not in the
selected profile's feature set is simply not embedded, so its device is
unclaimed; the fix is to build the profile that includes it, not to change the
kernel.

**Missing publisher key.** Each capsule signs with its own publisher keypair, and
the per-capsule `nonos-mk-check-<slug>-keys` target asserts the Ed25519 and
ML-DSA-65 seeds and public files exist before signing
(`nonos-mk/capsule.mk:184`). A missing file fails with an explicit
`::error::missing <path>` and the exact `capsule-sign keygen` command to generate
it (`nonos-mk/capsule.mk:188`). This gates the capsule sign step, which gates the
kernel build that embeds it.

**Signing key not found.** A `*-prod` build with no kernel signing material stops
at `nonos-mk-ensure-signing-key` rather than producing an unsigned image. The
Ed25519 seed is generated from `/dev/urandom` on first build (`Makefile:322`) and
the ML-DSA-65 keypair via `capsule-sign keygen` (`Makefile:329`); if the recipe
that consumes `NONOS_SIGNING_KEY` runs and the key path is absent, the kernel
artifact rule's signing-key prerequisite (`Makefile:853`) is what forces it to
exist first. On a fresh checkout this means the first production build spends a
step creating keys before it compiles the kernel.

**A `-Zbuild-std` or missing-`rust-src` failure.** Capsule and kernel builds both
pass `-Zbuild-std`, which needs the pinned toolchain with `rust-src` added. Every
build-std recipe takes an order-only dependency on the toolchain stamp
(`Makefile:508`) precisely so this is installed first; a build-std error usually
means the toolchain stamp step, which adds `rust-src` (`Makefile:410`), has not
run; `nonos-mk-check-deps` (`Makefile:320`) depends on that stamp precisely to
guarantee it.
