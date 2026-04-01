---
title: "Download"
description: "Download NØNOS operating system images"
---

## Current Release

**NØNOS 0.8.3.6-alpha** (March 28, 2026)

New UI components, animation system, and desktop improvements.

| File | Size | Format |
|------|------|--------|
| [nonos-0.8.3.6-alpha.iso](/iso/nonos-0.8.3.6-alpha.iso) | 235 MB | Bootable ISO (optical/VM) |
| [nonos-0.8.3.6-alpha.img](/iso/nonos-0.8.3.6-alpha.img) | 302 MB | Raw disk image (USB) |

### Integrity Verification

**SHA256 Checksums:**
```
89e5c22e98ec2db286163ad8ff6b8b38c95d73e370f1bda04074c5a14df917ca  nonos-0.8.3.6-alpha.iso
9aed97c518e2df294d957b5f200d9f6eaa9d17e10269c4cf1b65f31539937f2f  nonos-0.8.3.6-alpha.img
```

### Cryptographic Attestation

Every NØNOS release includes zero-knowledge attestation binding the kernel to its build environment.

| Parameter | Value |
|-----------|-------|
| Program Hash | `fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230` |
| Capsule Commitment | `2e0884e37c600272a090d1a90ffbf6e6a367fed38bd912a3dd2062f39c1eff9f` |
| Signing Key (Ed25519) | `ea16dcae85b7d995137cbc176603efa13fb1e001571a1369b644e1d44206d236` |
| Proof System | Groth16 over BLS12-381 |
| Signature Algorithm | Ed25519 |
| Integrity Hash | BLAKE3-256 |

### Build Information

| Component | Details |
|-----------|---------|
| Kernel Binary | 244,052,904 bytes |
| Signed Kernel | 244,052,968 bytes (+64 bytes Ed25519 signature) |
| Attested Kernel | 244,053,368 bytes (+400 bytes ZK proof block) |
| Toolchain | rustc nightly-2026-01-16 |
| Target | x86_64-nonos (custom freestanding) |

Download checksums: [SHA256SUMS](/iso/SHA256SUMS)

---

## Verification

**Verify on Linux/macOS:**
```bash
cd ~/Downloads
sha256sum -c SHA256SUMS
```

---

## Write to USB

### Linux
```bash
# Find your USB device
lsblk

# Write (replace sdX with your device)
sudo dd if=nonos-0.8.3.6-alpha.iso of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

### macOS
```bash
# Find your USB device
diskutil list

# Unmount and write (replace N with disk number)
diskutil unmountDisk /dev/diskN
sudo dd if=nonos-0.8.3.6-alpha.iso of=/dev/rdiskN bs=4m
diskutil eject /dev/diskN
```

### Windows
Use [Rufus](https://rufus.ie/) 4.0+ or [balenaEtcher](https://etcher.balena.io/):
- Select GPT partition scheme
- Select UEFI target system
- Use "DD Image" mode (Rufus) or default (Etcher)

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | x86_64 with SSE2 | x86_64 with AES-NI, RDRAND |
| RAM | 512 MB | 4+ GB |
| Firmware | UEFI 2.0+ | UEFI 2.0+ with Secure Boot |
| Boot Media | USB 2.0 (1 GB+) | USB 3.0+ |
| Storage | Any SATA/NVMe | NVMe SSD |

### Tested Hardware
- ThinkPad X1 Carbon (Gen 9, 10)
- HP EliteBook 840
- HP EliteDesk
- Framework Laptop
- Intel NUC 11/12
- Custom builds with Intel/AMD

See [Hardware Drivers](/docs/hardware-drivers/) for full details.

---

## Boot Instructions

1. Insert USB drive
2. Restart and enter UEFI/BIOS (usually F2, F10, F12, or Del)
3. Disable Secure Boot (if enabled)
4. Set USB as first boot device
5. Save and reboot
6. NØNOS bootloader will appear

**Common boot keys:**
- Dell: F12
- HP: F9 (boot menu), F10 (BIOS)
- Lenovo: F12 or Enter → F12
- ASUS: F8 or Esc

---

## Build from Source

```bash
git clone https://github.com/NON-OS/nonos-kernel.git
cd nonos-kernel
make
make iso
```

See [Build Manual](/docs/development/build-manual/) for full instructions.

---

## Previous Releases

### 0.8.3.5-alpha (March 27, 2026)

Native Git client for self-hosted development, network stack optimizations, and desktop environment enhancements.

| File | Size |
|------|------|
| [nonos-0.8.3.5-alpha.iso](/iso/nonos-0.8.3.5-alpha.iso) | 235 MB |
| [nonos-0.8.3.5-alpha.img](/iso/nonos-0.8.3.5-alpha.img) | 302 MB |

### 0.8.3-alpha (March 26, 2026)

NOSH command shell, native NOX staking, ZK wallet proofs, zkSync Era L2, AI agents framework, and application marketplace.

| File | Size |
|------|------|
| [nonos-0.8.3-alpha.iso](/iso/nonos-0.8.3-alpha.iso) | 234 MB |
| [nonos-0.8.3-alpha.img](/iso/nonos-0.8.3-alpha.img) | 301 MB |

### 0.8.2.2-alpha (March 14, 2026)

Alpha Stage Hardening Phase — comprehensive kernel stabilization and security hardening across nearly every layer of the system.

| File | Size |
|------|------|
| [nonos-0.8.2.2-alpha.iso](/iso/nonos-0.8.2.2-alpha.iso) | 245 MB |
| [nonos-0.8.2.2-alpha.img](/iso/nonos-0.8.2.2-alpha.img) | 301 MB |

### 0.8.2-alpha (March 11, 2026)

Native Ethereum wallet with BIP-39/BIP-32 support, secp256k1 signatures, and JSON-RPC integration.

| File | Size |
|------|------|
| [nonos-0.8.2-alpha.iso](/iso/nonos-0.8.2-alpha.iso) | 233 MB |
| [nonos-0.8.2-alpha.img](/iso/nonos-0.8.2-alpha.img) | 301 MB |

### 0.8.1.3-alpha (March 10, 2026)

Security hardening addressing timing side-channels, browser architecture, and ZK engine modularization.

| File | Size |
|------|------|
| [nonos-0.8.1.3-alpha.iso](/iso/nonos-0.8.1.3-alpha.iso) | 233 MB |
| [nonos-0.8.1.3-alpha.img](/iso/nonos-0.8.1.3-alpha.img) | 300 MB |

### 0.8.1-alpha (March 7, 2026)

Hardware compatibility improvements, ExitBootServices stability fixes, and virtio driver support.

| File | Size |
|------|------|
| [nonos-0.8.1-alpha.iso](/iso/nonos-0.8.1-alpha.iso) | 377 MB |
| [nonos-0.8.1-alpha.img](/iso/nonos-0.8.1-alpha.img) | 445 MB |

### 0.8.0-alpha (March 5, 2026)

First public release with wallet security fixes.

| File | Size |
|------|------|
| [nonos-0.8.0-alpha.iso](/iso/nonos-0.8.0-alpha.iso) | 377 MB |
| [nonos-0.8.0-alpha.img](/iso/nonos-0.8.0-alpha.img) | 445 MB |

---

See [Release History](/releases/) for full changelog.
