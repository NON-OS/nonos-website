---
title: "News"
description: "NØNOS announcements and releases"
---

# News

---

## 2026-03-07 — Real Hardware Fixes: 0.8.1-alpha

Two days after launch, two critical bugs squashed. If 0.8.0 hung on your machine, this one should boot.

### The Bugs

**ExitBootServices Hang (Issue #8)** — Users on Intel i5-11400H, Acer boards, and various HP machines reported freezes right after "Calling ExitBootServices..." with occasional screen corruption. QEMU worked fine. Real hardware died.

Root cause: struct layout mismatch. The bootloader's `MemoryMapEntry` had a 4-byte padding field to match EFI_MEMORY_DESCRIPTOR alignment. The kernel's version didn't. Every field after `memory_type` was shifted by 4 bytes. The kernel saw garbage memory regions and hung during heap init trying to use ACPI reserved memory as free RAM.

Fix: added `_pad: u32` to kernel's struct. Took 48 hours to find, one line to fix.

**Mouse Cursor Vanishing (Issue #6)** — On Proxmox VMs, clicking anywhere in Settings > Network made the cursor disappear until you moved the mouse. Bare metal was fine.

Root cause: click handler return value wasn't propagating. `dispatch_app_click` returned void and `handle_content_click` always returned false. When Settings handled a click, the main loop never knew. No redraw triggered. Cursor erase/restore cycle showed stale pixels.

Fix: made click handlers return bool all the way up the chain.

### Virtio Support (Issue #10)

QEMU users get proper hardware entropy now. Added `virtio-rng-pci` driver that pulls entropy from the host. Wallet key generation prioritizes this over RDRAND/RDSEED. Also wired up `virtio-net` as primary network driver with e1000 fallback.

### Download

| File | Size |
|------|------|
| [nonos-0.8.1-alpha.iso](/iso/nonos-0.8.1-alpha.iso) | ~380 MB |
| [nonos-0.8.1-alpha.img](/iso/nonos-0.8.1-alpha.img) | ~450 MB |

Checksums: [SHA256SUMS](/iso/SHA256SUMS)

### Commits

```
a31bd91e fix: align kernel MemoryMapEntry with bootloader struct
1ace83af fix: cursor disappearing in Settings Network on Proxmox
1cd9b4ad ci: generate zk keys before release build
78652d1a bootloader: pass memory map to kernel (fixes #8)
```

Thanks to @eeeeeee-enjoyer and @blakavabob for the detailed hardware reports.

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
