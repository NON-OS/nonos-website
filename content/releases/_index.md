---
title: "Releases"
description: "NØNOS release history and downloads"
---

# Releases

## Current: 0.8.3.6-alpha (2026-03-28)

New UI components, animation system, and desktop improvements.

### Download

| File | Size | SHA256 |
|------|------|--------|
| [nonos-0.8.3.6-alpha.iso](/iso/nonos-0.8.3.6-alpha.iso) | 235 MB | `89e5c22e98ec2db286163ad8ff6b8b38c95d73e370f1bda04074c5a14df917ca` |
| [nonos-0.8.3.6-alpha.img](/iso/nonos-0.8.3.6-alpha.img) | 302 MB | `9aed97c518e2df294d957b5f200d9f6eaa9d17e10269c4cf1b65f31539937f2f` |

### Cryptographic Attestation

Every NØNOS kernel binary is signed with Ed25519 and carries a Groth16 zero-knowledge proof binding it to a verified build environment.

| Parameter | Value |
|-----------|-------|
| Program Hash | `fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230` |
| Capsule Commitment | `2e0884e37c600272a090d1a90ffbf6e6a367fed38bd912a3dd2062f39c1eff9f` |
| Signing Key | `ea16dcae85b7d995137cbc176603efa13fb1e001571a1369b644e1d44206d236` |

### Build Information

| Parameter | Value |
|-----------|-------|
| Kernel Binary | 244,052,904 bytes |
| Signed Kernel | 244,052,968 bytes |
| Attested Kernel | 244,053,368 bytes |
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

### 0.8.3.5-alpha (2026-03-27)

Native Git client for self-hosted development, network stack optimizations, and desktop environment enhancements.

| File | Size | SHA256 |
|------|------|--------|
| [nonos-0.8.3.5-alpha.iso](/iso/nonos-0.8.3.5-alpha.iso) | 235 MB | `81957fb0766366ef953b7a16a589afe595e73b136edab772f65d2c242f95978f` |
| [nonos-0.8.3.5-alpha.img](/iso/nonos-0.8.3.5-alpha.img) | 302 MB | `1957b108a36f6d3f48092b7ad88a7578207fa68028eb9b2d7eb36a13125dedd7` |

### 0.8.3-alpha (2026-03-26)

NOSH command shell, native NOX staking, ZK wallet proofs, zkSync Era L2, AI agents framework, and application marketplace.

| File | Size | SHA256 |
|------|------|--------|
| [nonos-0.8.3-alpha.iso](/iso/nonos-0.8.3-alpha.iso) | 234 MB | `df5a9db7802ccef942e1410c50e9a140b48ca614631a55b126894e8b814690e0` |
| [nonos-0.8.3-alpha.img](/iso/nonos-0.8.3-alpha.img) | 301 MB | `05317cb0e00681e834a824bebb64943fb5c5830e91e8909e1c69dddd692d5177` |

### 0.8.2.2-alpha (2026-03-14)

Alpha Stage Hardening Phase — comprehensive kernel stabilization and security hardening.

| File | Size | SHA256 |
|------|------|--------|
| [nonos-0.8.2.2-alpha.iso](/iso/nonos-0.8.2.2-alpha.iso) | 245 MB | `a39730250070a9d6099fe7e0c1e6d159287ac3e099ab61cc27dbf76a2cb1cfa3` |
| [nonos-0.8.2.2-alpha.img](/iso/nonos-0.8.2.2-alpha.img) | 301 MB | `8226e29228cde74862e9f2002d6727ff0973ba78aee999b69acd48860de698f0` |

### 0.8.2-alpha (2026-03-11)

Native Ethereum wallet with BIP-39/BIP-32 support, secp256k1 signatures, and JSON-RPC integration.

| File | Size | SHA256 |
|------|------|--------|
| nonos-0.8.2-alpha.iso | 233 MB | See SHA256SUMS |
| nonos-0.8.2-alpha.img | 301 MB | See SHA256SUMS |

### 0.8.1.3-alpha (2026-03-10)

Security hardening addressing timing side-channels, browser architecture, and ZK engine modularization.

| File | Size | SHA256 |
|------|------|--------|
| nonos-0.8.1.3-alpha.iso | 233 MB | See SHA256SUMS |
| nonos-0.8.1.3-alpha.img | 300 MB | See SHA256SUMS |

### 0.8.1-alpha (2026-03-07)

Hardware compatibility improvements, ExitBootServices stability fixes, and virtio driver support.

| File | Size | SHA256 |
|------|------|--------|
| nonos-0.8.1-alpha.iso | 377 MB | `cf0e0dc3f05b2cc059cefa95fab13c969e52a3a3db3b5de81b36904d3327a351` |
| nonos-0.8.1-alpha.img | 445 MB | `a9610a760c7660cca54290570834f250271591d59f1cdae53943d163fb1fb9ca` |

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
