---
title: "News"
description: "NØNOS announcements and releases"
---

# News

---

## 2026-03-07 — NØNOS 0.8.1-alpha Released

Two days after the initial launch, we are shipping 0.8.1-alpha with critical hardware compatibility fixes and new virtualization support. If 0.8.0 hung on your machine, this release should boot.

### Critical Bug Fixes

**ExitBootServices Hang (Issue #8)**

Users on Intel Core i5-11400H processors, various Acer motherboards, and HP systems reported freezes immediately after the bootloader displayed "Calling ExitBootServices..." — sometimes accompanied by screen corruption. QEMU ran without issue. Real hardware failed.

The root cause was a struct layout mismatch between the bootloader and kernel. The bootloader's `MemoryMapEntry` included a 4-byte padding field to match EFI_MEMORY_DESCRIPTOR alignment requirements. The kernel's corresponding struct lacked this padding. Every field after `memory_type` was shifted by 4 bytes, causing the kernel to interpret garbage values as memory regions. During heap initialization, the kernel attempted to use ACPI reserved memory as free RAM and hung.

The fix: a single line adding `_pad: u32` to the kernel's struct definition. Finding the cause took 48 hours of debugging across multiple hardware configurations.

**Cursor Disappearing in Settings (Issue #6)**

On Proxmox virtual machines, clicking anywhere within the Settings application's Network panel caused the mouse cursor to vanish until the user moved the mouse. Bare metal systems were unaffected.

The issue traced to click handler return values not propagating through the window manager. The `dispatch_app_click` function returned void, and `handle_content_click` always returned false regardless of whether the click was handled. When Settings processed a click, the main event loop never received confirmation. No redraw was triggered, and the cursor erase/restore cycle displayed stale pixel data.

The fix: refactored click handlers throughout the window manager to return boolean values indicating whether events were consumed.

### New Virtio Drivers (Issue #10)

Virtual machine users now have access to proper hardware entropy and improved networking.

**virtio-rng-pci** — Hardware random number generator driver that pulls entropy directly from the host system. Wallet key generation now prioritizes this source over RDRAND/RDSEED when running under QEMU or KVM.

**virtio-net** — Primary network driver for QEMU/KVM environments. The e1000 driver remains as fallback for systems without virtio support.

### Download

| File | Size | SHA256 |
|------|------|--------|
| [nonos-0.8.1-alpha.iso](/iso/nonos-0.8.1-alpha.iso) | ~380 MB | `cf0e0dc3f05b2cc059cefa95fab13c969e52a3a3db3b5de81b36904d3327a351` |
| [nonos-0.8.1-alpha.img](/iso/nonos-0.8.1-alpha.img) | ~450 MB | `a9610a760c7660cca54290570834f250271591d59f1cdae53943d163fb1fb9ca` |

Full checksums available at [SHA256SUMS](/iso/SHA256SUMS).

### Cryptographic Attestation

| Parameter | Value |
|-----------|-------|
| Program Hash | `fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230` |
| Capsule Commitment | `2e0884e37c600272a090d1a90ffbf6e6a367fed38bd912a3dd2062f39c1eff9f` |
| Signing Key | `4c5a3309bc2b13c8a85e2f780f7fd714e07e8e589084fac88e37c803634e705c` |

### Commits

```
a31bd91e fix: align kernel MemoryMapEntry with bootloader struct
1ace83af fix: cursor disappearing in Settings Network on Proxmox
1cd9b4ad ci: generate zk keys before release build
78652d1a bootloader: pass memory map to kernel (fixes #8)
```

### Acknowledgments

Thanks to @eeeeeee-enjoyer for the detailed Intel i5-11400H hardware report and @blakavabob for providing Proxmox VM reproduction steps.

---

## 2026-03-05 — Wallet Security Hardening

Five commits pushed today addressing entropy and UX issues in the built-in wallet. **Rebuilt ISO available.**

### Download

| File | Size |
|------|------|
| [nonos-0.8.0-alpha.iso](/iso/nonos-0.8.0-alpha.iso) | 377 MB |
| [nonos-0.8.0-alpha.img](/iso/nonos-0.8.0-alpha.img) | 445 MB |

**SHA256:**
```
41c2f64ea4b268db9fab94e20f8300a0f9cc0eb8bae02a02038155aeeb849e11  nonos-0.8.0-alpha.iso
c0537130e4a11f259d47c5d3df26d8a6e7fa52707952315eb2768c5dc9707c7f  nonos-0.8.0-alpha.img
```

### What Changed

**RNG Entropy Fallback** — When hardware RNG (RDRAND/RDSEED) is unavailable or returns deterministic values, the fallback now mixes multiple entropy sources: stack pointer address, TSC jitter from variable spin loops, and counter-based state. Previously it relied solely on counter + TSC which was predictable across boots on some AMD CPUs and VMs.

**Verified Key Generation** — New `generate_secure_key_checked()` function returns `Result` instead of silently falling back to weak entropy. Wallet creation now fails explicitly if proper entropy cannot be collected. You'll see an error message instead of getting a wallet with predictable keys.

**Auto-Focus Password Field** — The locked wallet screen now focuses the password field automatically. No more clicking before typing.

**Reseed Before Key Generation** — RNG is reseeded immediately before generating new wallet keys, collecting fresh entropy rather than relying solely on boot-time seed.

### Commits

```
be2e72ce fix(wallet): require verified entropy for new wallet generation
9bf78bed feat(crypto): add checked key generation with entropy verification
413770ac fix(wallet): reseed RNG before generating new wallet keys
d7487394 fix(rng): improve entropy fallback when RDRAND is unavailable
925023c4 fix(wallet): auto-focus password field on locked screen
```

If you generated a wallet on hardware without working RDRAND, regenerate it after updating.

---

## 2026-03-05 — NØNOS 0.8.0-alpha: First Public Release

After two years of development, **NØNOS is real.**

Today we release the first bootable ISO. 370,000 lines of Rust. No Linux. No BSD. No legacy code. Written from scratch for one purpose: **sovereignty**.

### What is NØNOS?

NØNOS is an operating system built for people who refuse to trust. Every component assumes the rest of the system is hostile. Every boot is cryptographically proven. Every process runs in a capability jail. There is no root. There is no sudo. There is only math.

The name means "Not an Operating System" — because what we call operating systems today are surveillance platforms with boot sequences. NØNOS is different.

### Download the ISO

Two formats, same bits:

| File | Size | Use |
|------|------|-----|
| [nonos-0.8.0-alpha.iso](/iso/nonos-0.8.0-alpha.iso) | 377 MB | Bootable ISO (QEMU, VM, optical) |
| [nonos-0.8.0-alpha.img](/iso/nonos-0.8.0-alpha.img) | 445 MB | Raw disk image (USB drives) |

**Verify your download:**
```
41c2f64ea4b268db9fab94e20f8300a0f9cc0eb8bae02a02038155aeeb849e11  nonos-0.8.0-alpha.iso
c0537130e4a11f259d47c5d3df26d8a6e7fa52707952315eb2768c5dc9707c7f  nonos-0.8.0-alpha.img
```

### What's in the Box

**Zero-Knowledge Boot** — Every boot generates a Groth16 proof attesting that unmodified code is running. This isn't TPM theater. It's mathematical certainty.

**Capability-Based Security** — 10 capability types. No ambient authority. A process that doesn't hold the `Network` capability cannot touch the network. Period.

**Post-Quantum Cryptography** — ML-KEM-1024 for key exchange. ML-DSA-87 for signatures. Kyber and Dilithium as fallbacks. Your secrets stay secret even when quantum computers exist.

**Full Desktop Environment** — Terminal, file manager, text editor, system monitor, network tools, settings. A complete graphical system, not a demo.

**Onion-Routed Networking** — Built-in Tor-style routing. No clearnet leaks. Your traffic exits through three hops minimum.

**100+ Shell Commands** — `ps`, `ls`, `cat`, `grep`, `find`, `curl`, `ssh`, `gpg`, and many more. Enough to be productive.

### Architecture

| Component | Lines | Description |
|-----------|-------|-------------|
| Kernel | 340,000 | Memory, scheduling, IPC, drivers |
| Bootloader | 30,000 | UEFI, ZK proofs, chain of trust |
| **Total** | **370,000** | Pure Rust, `#![no_std]` |

This is not a Linux distribution. There is no GNU. No glibc. No systemd. The bootloader loads the kernel. The kernel runs your code. That's it.

### Known Limitations

This is alpha software:

- **Ring 0 only** — User-space isolation lands in beta. Currently all code runs in kernel mode.
- **ZeroState default** — RAM-only by default. Persistent storage requires explicit opt-in.
- **x86_64 only** — ARM64 and RISC-V support planned for 1.0.
- **Limited hardware** — Tested on ThinkPads, Framework, Intel NUC. See [hardware compatibility](/docs/hardware-drivers/).

### Try It

**QEMU (fastest):**
```bash
qemu-system-x86_64 -enable-kvm -m 4G -bios /usr/share/OVMF/OVMF_CODE.fd \
  -drive file=nonos-0.8.0-alpha.iso,format=raw
```

**Real hardware:**
```bash
sudo dd if=nonos-0.8.0-alpha.img of=/dev/sdX bs=4M status=progress
```

Boot from USB. Disable Secure Boot. Watch the ZK proof verify.

### What's Next

- **0.9.0** — User-space isolation, persistent encrypted storage
- **1.0.0** — Stable ABI, package manager, ARM64 support

Follow development: [github.com/NON-OS/nonos](https://github.com/NON-OS/nonos)

---

## 2026-03-05 — nonos.software is Live

Documentation site is online. Technical specs, build instructions, and downloads available.

Source: [github.com/NON-OS/nonos](https://github.com/NON-OS/nonos)

---

*Sovereignty From Ø.*
