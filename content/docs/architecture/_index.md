---
title: "Architecture"
description: "NØNOS kernel architecture overview"
weight: 20

# NØNOS Architecture

This section covers the internal architecture of the NØNOS kernel—how it's organized, how components interact, and the design decisions behind them.


## System Overview

| Layer | Components |
|-------|------------|
| **Applications** | Terminal, File Manager, Browser, Wallet, Editor, Settings |
| **System Call Interface** | 335 Linux-compatible + NØNOS extensions |
| **Kernel Subsystems** | Process Manager, Memory Manager, Filesystem, Network Stack, Capability System |
| **Cryptographic Core** | Ed25519, ML-KEM, ML-DSA, AES-GCM, ChaCha20, BLAKE3, ZK Proofs |
| **Device Drivers** | Storage, Network, Input, Graphics, Audio, USB, TPM |
| **Hardware** | x86_64 CPU, RAM, Storage, Network, Peripherals |


## Kernel Subsystems

The NØNOS kernel consists of 33 interconnected subsystems:

### Core Systems

| Subsystem | Purpose |
|-----------|---------|
| `arch/` | x86_64 architecture support (GDT, IDT, paging) |
| `boot/` | Kernel initialization and handoff |
| `mem/` | Physical and virtual memory management |
| `sched/` | Process scheduler |
| `process/` | Process and thread management |
| `syscall/` | System call interface |
| `interrupts/` | Exception and interrupt handling |

### Security Systems

| Subsystem | Purpose |
|-----------|---------|
| `capabilities/` | Capability-based access control |
| `crypto/` | Cryptographic primitives |
| `vault/` | Secure key storage |
| `zk_engine/` | Zero-knowledge proof system |
| `security/` | Security policies and enforcement |

### I/O Systems

| Subsystem | Purpose |
|-----------|---------|
| `fs/` | Virtual filesystem layer |
| `drivers/` | Device driver framework |
| `storage/` | Block storage abstraction |
| `network/` | Network stack |
| `ipc/` | Inter-process communication |

### User Interface

| Subsystem | Purpose |
|-----------|---------|
| `graphics/` | Framebuffer and rendering |
| `ui/` | Desktop environment |
| `shell/` | Command-line interface |
| `input/` | Keyboard and mouse handling |
| `apps/` | Built-in applications |


## Design Principles

### Memory Safety

NØNOS is written in Rust, eliminating entire classes of vulnerabilities:
- No buffer overflows
- No use-after-free
- No data races
- No null pointer dereferences

The kernel contains ~814 `unsafe` blocks, all manually audited.

### Capability-Based Security

Every privileged operation requires a cryptographic capability token:
- No ambient authority (no "root" user)
- Fine-grained permissions
- Cryptographic verification on every system call

### Zero-State Design

By default, all state is volatile:
- RAM filesystem for all files
- No swap to disk
- Keys in CPU registers only
- Nothing survives shutdown

### Cryptographic Verification

Trust is established cryptographically:
- Kernel verified at boot (Ed25519 + Groth16)
- Modules verified on load
- Capabilities signed with Ed25519


## Detailed Documentation

- [**Kernel ABI**](/docs/architecture/kernel-abi/) — Binary interface, system calls, data structures
- [**Memory & Hardware**](/docs/architecture/memory-hardware/) — Memory management, hardware abstraction


## Source Code Layout

```
nonos-kernel/
├── src/
│   ├── lib.rs              # Kernel entry point
│   ├── nonos_main.rs       # Main initialization
│   ├── arch/x86_64/        # Architecture-specific
│   ├── boot/               # Boot and handoff
│   ├── crypto/             # Cryptography
│   ├── drivers/            # Device drivers
│   ├── fs/                 # Filesystem
│   ├── graphics/           # Graphics subsystem
│   ├── input/              # Input handling
│   ├── interrupts/         # Interrupt handling
│   ├── ipc/                # Inter-process communication
│   ├── memory/             # Memory management
│   ├── network/            # Network stack
│   ├── process/            # Process management
│   ├── sched/              # Scheduler
│   ├── security/           # Security subsystem
│   ├── shell/              # Shell commands
│   ├── storage/            # Storage abstraction
│   ├── syscall/            # System calls
│   ├── ui/                 # User interface
│   ├── vault/              # Secure storage
│   └── zk_engine/          # Zero-knowledge proofs
├── tests/                  # Integration tests
├── linker.ld               # Linker script
└── x86_64-nonos.json       # Target specification
```


## Build System

The kernel builds with Cargo using a custom target specification (`x86_64-nonos.json`):

```bash
cargo build --target x86_64-nonos.json \
  -Zbuild-std=core,alloc \
  -Zbuild-std-features=compiler-builtins-mem
```

Key build features:
- No standard library (`no_std`)
- Custom memory allocator
- Static linking
- Position-independent code (PIE)
