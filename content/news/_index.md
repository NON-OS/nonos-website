---
title: "News"
description: "NONOS documentation site announcements"
---

# News


## 2026-03-05 — Alpha 0.8.0 Released

**NØNOS Alpha 0.8.0 is now available.**

The first public alpha release. ~370,000 lines of Rust. Boots on real hardware.

### Download

- [nonos-0.8.0-alpha-x86_64.iso](/download/)

### Release Highlights

| Component | Lines of Code | Files |
|-----------|---------------|-------|
| Kernel | ~340,000 | 3,106 |
| Bootloader | ~30,000 | 277 |
| **Total** | **~370,000** | **3,383** |

**What's Included:**
- Ten-phase secure boot (Ed25519 + Groth16 ZK)
- Full graphical desktop with 8 applications
- Shell with 100+ commands
- TCP/IP networking with onion routing
- 20+ device drivers
- Post-quantum cryptography (ML-KEM, ML-DSA)
- CryptoFS encrypted filesystem
- Capability-based security (17 types)

**Limitations:**
- Ring 0 execution only (user-space isolation in beta)
- ZeroState by default (volatile storage)

Full specification: [Technical Specification](/docs/technical-specification/)


## 2026-03-05 — Documentation Site Live

**nonos.software is online.**

This site provides:
- Technical documentation
- ISO downloads with checksums
- Build instructions
- Development roadmap

Main project site: [nonos.systems](https://nonos.systems)

Source code: [github.com/NON-OS/nonos-kernel](https://github.com/NON-OS/nonos-kernel)


*Sovereignty From Zero.*
