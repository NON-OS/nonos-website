---
title: "Releases"
description: "NØNOS releases"
---

# Releases

## 0.8.0-alpha (2026-03-05)

First public alpha release.

### Statistics

| Component | Value |
|-----------|-------|
| Kernel | ~340,000 lines of Rust |
| Bootloader | ~30,000 lines of Rust |
| Total | ~370,000 lines |
| Files | 3,383 |
| Subsystems | 33 |

### Features

- Ten-phase secure boot with Ed25519 + Groth16 ZK verification
- Graphical desktop with 8 built-in applications
- Shell with 100+ commands
- TCP/IP with integrated onion routing
- 20+ device drivers (AHCI, NVMe, e1000, RTL, WiFi, USB, audio)
- CryptoFS with ChaCha20-Poly1305 encryption
- 25+ cryptographic algorithms including post-quantum (ML-KEM, ML-DSA)
- 17-type capability-based security system

### Limitations

- All processes execute in ring 0 (user-space isolation in beta)
- Volatile storage only (by design)

### Tested Hardware

- HP ProBook, EliteBook
- Dell Latitude
- Lenovo ThinkPad
- QEMU/KVM with OVMF

## Roadmap

See [Roadmap](/roadmap/) for beta development schedule.
