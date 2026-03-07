---
title: "About"
description: "About NØNOS and this site"
---

# About NØNOS

NØNOS is an operating system built from scratch where privacy isn't a feature you enable—it's how the system works. When you shut down, everything vanishes. Not deleted. Not encrypted somewhere. Gone.

The crossed Ø represents deliberate absence. What doesn't exist can't be stolen, subpoenaed, or recovered.


## The Core Idea: ZeroState

By default, NØNOS writes nothing to your hard drive. Everything runs in RAM. Your documents, your browsing, your work—all of it exists only while the machine is on.

When power goes off:
- RAM loses its contents within seconds
- Encryption keys stored only in CPU registers disappear instantly
- There's literally nothing left to forensically recover

This isn't encryption you might forget the password to someday. This is non-existence.


## What You Get

### A Complete Desktop System

NØNOS isn't a command-line-only security tool. It's a full operating system with:

- **Desktop environment** with windows, dock, and menu bar
- **Terminal** for command-line work (100+ commands)
- **File Manager** for browsing and organizing
- **Text Editor** with Vi-like keybindings
- **Web Browser** with built-in privacy features
- **Wallet** for Ethereum with zero-knowledge privacy
- **Calculator**, **Settings**, **Process Manager**

### Network Privacy Built In

All network traffic can route through an integrated onion network—no external software needed. DNS queries go through encrypted channels. Your ISP sees encrypted traffic going somewhere; they don't see where or what.

### Post-Quantum Ready

The cryptography in NØNOS is designed for threats that don't fully exist yet. ML-KEM and ML-DSA protect against future quantum computers. If someone captures your encrypted traffic today hoping to decrypt it in 2035 when quantum computers mature, they'll be disappointed.

### Zero-Knowledge Proofs

The kernel itself proves its integrity at boot using Groth16 proofs over BLS12-381. You can verify the system is authentic without the verification process revealing the signing keys or build environment.


## By the Numbers

| Metric | Value |
|--------|-------|
| Kernel code | ~340,000 lines of Rust |
| Kernel subsystems | 33 modules |
| Shell commands | 100+ |
| Device drivers | 20+ (storage, network, input, audio) |
| Cryptographic primitives | 25+ algorithms |
| Capability types | 10 |
| GUI applications | 8 built-in apps |


## The Stack

### Cryptography

**Classical:**
- Ed25519, Curve25519, X25519 (signatures and key exchange)
- AES-256-GCM, ChaCha20-Poly1305 (authenticated encryption)
- BLAKE3, SHA-256, SHA-512, SHA-3 (hashing)
- P-256, secp256k1 (NIST and Bitcoin curves)

**Post-Quantum:**
- ML-KEM-512/768/1024 (CRYSTALS-Kyber key encapsulation)
- ML-DSA-2/3/5 (CRYSTALS-Dilithium signatures)
- SPHINCS+ (hash-based signatures)
- NTRU, Classic McEliece (additional PQ algorithms)

**Zero-Knowledge:**
- Groth16 SNARKs over BLS12-381
- Halo2 PLONK proofs
- Pedersen commitments, Schnorr proofs, range proofs

### Hardware Support

- **CPU:** x86_64 (Intel/AMD), ARM64 in development
- **Boot:** UEFI required (no legacy BIOS)
- **Storage:** AHCI (SATA), NVMe, VirtIO, USB mass storage
- **Network:** Intel e1000/e1000e, Realtek RTL8139/8168, VirtIO, WiFi (select Realtek)
- **Input:** PS/2, USB HID (keyboard, mouse, touchpad)
- **Graphics:** UEFI GOP framebuffer
- **Security:** TPM 2.0 integration

### Filesystems

- **RAM filesystem:** Primary storage, volatile by design
- **CryptoFS:** Encrypted filesystem with ChaCha20-Poly1305, Merkle tree integrity
- **ext4, FAT32:** Read/write support for external media
- **VFS layer:** Unified interface for all filesystems


## This Site

**nonos.software** is the documentation and download hub:

- Technical specifications and architecture docs
- Build instructions for compiling from source
- Installation guides
- Development roadmap
- ISO downloads with cryptographic verification

Main project website: [nonos.systems](https://nonos.systems)


## License

NØNOS is free software under the **GNU Affero General Public License v3.0** (AGPL-3.0).

You can use it, modify it, and distribute it. If you distribute modified versions, you must share your changes under the same license.


## Source Code

Everything is open source and available on GitHub:

- **Kernel:** [github.com/NON-OS/nonos-kernel](https://github.com/NON-OS/nonos-kernel)
- **Bootloader:** [github.com/NON-OS/nonos-kernel/nonos-bootloader](https://github.com/NON-OS/nonos-kernel/tree/main/nonos-bootloader)

## Mirrors

- **Anyone Network:** [6g7cvpp3ajxl4u4golj522b4meiz3sua2eufafwjd3usu4g6n2enqmyd.anon](http://6g7cvpp3ajxl4u4golj522b4meiz3sua2eufafwjd3usu4g6n2enqmyd.anon/)

Access via [Anyone](https://anyone.io/) for anonymous browsing.


## Who This Is For

NØNOS is for people who:

- Need to work with sensitive information that shouldn't persist
- Want an operating system that doesn't phone home or track anything
- Are security researchers or journalists in sensitive situations
- Believe privacy should be a default, not an afterthought
- Want to understand exactly what their operating system does

NØNOS is **not** for people who:

- Need long-term storage on the same machine (use external drives)
- Require maximum software compatibility (it's not Linux)
- Are looking for something "just works" without understanding it
- Need real-time performance guarantees


**NØNOS: Sovereignty From Ø**
