---
title: "Releases"
description: "NØNOS release history and downloads"
---

# Releases

## Current: 0.8.1-alpha (2026-03-07)

Hardware compatibility and stability improvements. This release resolves ExitBootServices hangs on various Intel-based hardware and adds comprehensive virtio driver support for virtual machine deployments.

### Download

| File | Size | SHA256 |
|------|------|--------|
| [nonos-0.8.1-alpha.iso](/iso/nonos-0.8.1-alpha.iso) | 377 MB | `cf0e0dc3f05b2cc059cefa95fab13c969e52a3a3db3b5de81b36904d3327a351` |
| [nonos-0.8.1-alpha.img](/iso/nonos-0.8.1-alpha.img) | 445 MB | `a9610a760c7660cca54290570834f250271591d59f1cdae53943d163fb1fb9ca` |

### Cryptographic Attestation

Every NØNOS kernel binary is signed with Ed25519 and carries a Groth16 zero-knowledge proof binding it to a verified build environment.

| Parameter | Value |
|-----------|-------|
| Program Hash | `fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230` |
| Capsule Commitment | `2e0884e37c600272a090d1a90ffbf6e6a367fed38bd912a3dd2062f39c1eff9f` |
| Signing Key | `4c5a3309bc2b13c8a85e2f780f7fd714e07e8e589084fac88e37c803634e705c` |

### Changes from 0.8.0

**Bug Fixes:**
- Resolved ExitBootServices hang affecting Intel Core i5-11400H, various Acer and HP systems
- Fixed cursor disappearing in Settings application under Proxmox virtualization
- Corrected memory map handling for systems with fragmented UEFI memory regions

**New Drivers:**
- virtio-rng-pci: Hardware random number generator for virtual machines
- virtio-net: Primary network driver for QEMU/KVM environments

**Improvements:**
- Reduced boot time by optimizing UEFI protocol enumeration
- Enhanced serial console output for debugging

### Codebase Statistics

| Component | Value |
|-----------|-------|
| Kernel Source | 355,000 lines of Rust |
| Bootloader Source | 30,684 lines of Rust |
| Total Rust Code | 385,684 lines |
| Source Files | 3,353 |
| Kernel Subsystems | 34 |

### Build Information

| Parameter | Value |
|-----------|-------|
| Kernel Binary | 394,668,080 bytes |
| Signed Kernel | 394,668,144 bytes |
| Attested Kernel | 394,668,544 bytes |
| Toolchain | rustc nightly-2026-01-16 |
| Target | x86_64-nonos |

### System Features

**Boot Security:**
- Ten-stage verified boot with UEFI integration
- Ed25519 kernel signature verification
- Groth16 zero-knowledge attestation proofs over BLS12-381
- BLAKE3 integrity hashing
- Optional Secure Boot and TPM support

**Desktop Environment:**
- Graphical framebuffer-based desktop
- Built-in applications: Files, Terminal, Settings, Wallet, Browser, Editor, Calculator, System Monitor
- Mouse and keyboard input handling
- Multiple wallpaper and theme support

**Shell:**
- 100+ built-in commands across 23 command modules
- File operations, process management, network tools
- Cryptographic utilities for hashing, signing, key generation
- Wallet and blockchain interaction commands

**Networking:**
- Full TCP/IP stack implementation
- Integrated onion routing for privacy
- DNS over HTTPS support
- Firewall with packet filtering

**Device Drivers (21 modules):**
- Storage: AHCI (SATA), NVMe, VirtIO-blk
- Network: e1000, RTL8139, RTL8168, VirtIO-net, WiFi (experimental)
- Input: PS/2 keyboard, USB HID
- Graphics: UEFI GOP framebuffer, basic GPU
- Other: TPM 2.0, USB (XHCI), audio, I2C

**Cryptography (25+ algorithms):**
- Symmetric: AES-128/256, ChaCha20-Poly1305, AES-GCM
- Hash: SHA-256, SHA-512, SHA-3, BLAKE3, Keccak
- Asymmetric: Ed25519, Curve25519, P-256, secp256k1, RSA
- Post-Quantum: ML-KEM (Kyber), ML-DSA (Dilithium), SPHINCS+, NTRU
- Zero-Knowledge: Groth16, PLONK, Schnorr proofs

**Security:**
- 10-type capability-based access control (CoreExec, IO, Network, IPC, Memory, Crypto, FileSystem, Hardware, Debug, Admin)
- Spectre/Meltdown mitigations
- Stack canaries and guard pages
- Memory sanitization on free
- Constant-time cryptographic operations

**File Systems:**
- RAM-based volatile file system
- CryptoFS with ChaCha20-Poly1305 encryption
- Virtual file system abstraction

### Known Limitations

- All processes execute in ring 0 (user-space isolation planned for beta)
- Volatile storage only (intentional for Zero-State architecture)
- WiFi support is experimental with limited access point compatibility
- No persistent storage or hibernation by design

### Tested Hardware

**Laptops:**
- HP ProBook, EliteBook series
- Dell Latitude series
- Lenovo ThinkPad X1 Carbon (Gen 9, 10)
- Lenovo ThinkPad T-series
- Framework Laptop (11th/12th gen Intel)

**Desktops:**
- HP EliteDesk
- Intel NUC 11/12
- Custom builds with Intel Core and AMD Ryzen

**Virtual Machines:**
- QEMU/KVM with OVMF firmware
- Proxmox VE
- VirtualBox with EFI enabled

---

## Release History

### 0.8.0-alpha (2026-03-05)

First public alpha release. Introduced wallet security hardening and initial hardware compatibility.

| File | Size | SHA256 |
|------|------|--------|
| nonos-0.8.0-alpha.iso | 377 MB | `41c2f64ea4b268db9fab94e20f8300a0f9cc0eb8bae02a02038155aeeb849e11` |
| nonos-0.8.0-alpha.img | 445 MB | `c0537130e4a11f259d47c5d3df26d8a6e7fa52707952315eb2768c5dc9707c7f` |

**Cryptographic Attestation:**

| Parameter | Value |
|-----------|-------|
| Program Hash | `fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230` |
| Proof Hash | `6be8b4e5052dcb89daf178f94892ebc5b5d0e975a813ac9ca0d861d36b66aca4` |
| VK Hash | `a84d203acbb1ad2b6dcaed6054b992d8d3380d677e9b36db8fa900f2a5ebd0f2` |

---

## Roadmap

See [Roadmap](/roadmap/) for beta development schedule.
