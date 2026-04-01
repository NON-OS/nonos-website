---
title: "NØNOS v0.8.4-alpha: First Complete Microkernel Desktop"
date: 2026-03-31
description: "Zero-state capability-based microkernel with full graphical desktop, 12 isolated userspace services, and privacy-preserving boot attestation"
---

## NØNOS v0.8.4-alpha

After extensive work on the microkernel architecture, we are releasing v0.8.4-alpha: the first version where the complete graphical desktop runs on top of fully isolated userspace services. Every component described in this document is running in production on real hardware.

This release represents a fundamental shift in how operating systems should be built. No marketing. Just architecture.

## The Microkernel Imperative

Traditional monolithic kernels like Linux, Windows NT, and XNU run device drivers, filesystems, and networking inside kernel address space. A single vulnerability anywhere becomes a full system compromise. CVE-2024-1086 (nf_tables), CVE-2023-32233 (Netfilter), CVE-2024-26581 (io_uring) all demonstrate this pattern.

NØNOS inverts this model entirely. The kernel provides exactly four primitives:

- **Memory management**: Page table manipulation, physical frame allocation
- **Scheduling**: Context switching, timer interrupts
- **IPC**: Synchronous message passing between services
- **Capability management**: Token creation, delegation, revocation

Everything else runs as isolated userspace services: filesystems, networking, graphics, and input handling. The kernel is approximately 15,000 lines of Rust. Attack surface minimization through architectural constraint.

## Service Isolation Architecture

Twelve isolated services, each in its own virtual address space:

| Service | Port | Responsibility |
|---------|------|----------------|
| vfs_service | 0x1000 | Filesystem abstraction, capability-gated access |
| display_service | 0x1001 | Framebuffer, compositor, window management |
| input_service | 0x1002 | PS/2, USB HID, event routing |
| network_service | 0x1003 | E1000/virtio, TCP/IP, TLS 1.3 |
| crypto_service | 0x1004 | Ed25519, X25519, ChaCha20-Poly1305, key storage |
| zk_service | 0x1005 | Groth16 proving, BN254 operations |
| audio_service | 0x1006 | AC97/HDA, mixing, PCM streams |
| gpu_service | 0x1007 | Hardware acceleration, shader compilation |
| apps_service | 0x1008 | Application lifecycle, sandboxing |
| agents_service | 0x1009 | Local AI agents, inference |
| shell_service | 0x100A | NOSH command interpreter |
| desktop_service | 0x100B | Window chrome, taskbar, system tray |

IPC uses synchronous rendezvous: sender blocks until receiver accepts. No buffering, no async queues, no TOCTOU races. Message size limit of 4096 bytes forces explicit data copying, eliminating shared memory side channels by default.

### Security Implications

When network_service processes a malformed TCP packet and an attacker achieves code execution, they control network_service. They cannot:

- Read files (vfs_service is a separate address space)
- Access cryptographic keys (crypto_service is separate)
- Draw fake UI (display_service is separate)
- Inject input events (input_service is separate)

Lateral movement requires finding vulnerabilities in the IPC protocol itself, a much smaller attack surface than the millions of lines in a typical network stack.

## Boot Verification Chain

Modern systems face boot-level threats: UEFI rootkits, Evil Maid attacks, supply chain implants. NØNOS implements cryptographic verification at every stage.

### Stage 1: UEFI Signature Verification

The UEFI firmware verifies the bootloader signature before execution.

| Parameter | Value |
|-----------|-------|
| Bootloader binary | nonos-boot.efi |
| Signature algorithm | Ed25519 (RFC 8032) |
| Key size | 256-bit (equivalent to ~3000-bit RSA) |
| Public key location | Embedded in UEFI Secure Boot db |

Unsigned or tampered bootloaders are rejected at the firmware level.

### Stage 2: Kernel Hash Attestation

| Parameter | Value |
|-----------|-------|
| Hash algorithm | BLAKE3-256 |
| Expected hash | Embedded in signed bootloader |
| Measured hash | Computed over kernel.elf in memory |
| TPM extension | PCR[8] ← SHA256(PCR[8] \|\| kernel_hash) |

The bootloader computes the BLAKE3 hash of the kernel image and extends it into TPM PCR 8. Any modification to the kernel produces a different PCR value, detectable by remote attestation.

### Stage 3: Zero-Knowledge Boot Proof

| Parameter | Value |
|-----------|-------|
| Circuit | Groth16 over BN254 (alt_bn128) |
| Public inputs | expected_hash, pcr_value, timestamp |
| Private witness | kernel_image, boot_sequence, memory_layout |
| Proof size | 192 bytes |
| Verification time | ~5ms on commodity hardware |

The ZK proof demonstrates: "I booted a kernel with hash H at time T and the TPM recorded PCR value P" without revealing the actual kernel code, memory layout, or any intermediate boot state. Privacy-preserving attestation.

## Memory Architecture

Memory corruption remains the dominant vulnerability class. NØNOS implements multiple architectural barriers.

### Kernel Heap

| Parameter | Value |
|-----------|-------|
| Allocator | linked_list_allocator (no_std compatible) |
| Heap base | 0xFFFF_8000_0000_0000 |
| Heap size | 256 MB |
| Guard pages | 4KB unmapped regions at boundaries |
| Canary | Random 64-bit value checked on deallocation |

### Per-Process Virtual Address Space

```
User code:    0x0000_0000_0040_0000 - 0x0000_7FFF_FFFF_FFFF
User heap:    0x0000_0000_1000_0000 - 0x0000_0000_8000_0000
User stack:   0x0000_7FFF_FFFF_0000 (grows down)
Kernel map:   0xFFFF_8000_0000_0000 - 0xFFFF_FFFF_FFFF_FFFF (not accessible from user mode)
```

### Page Table Enforcement

- 4-level paging: PML4 → PDPT → PD → PT
- NX bit: Enforced on all data pages
- Write protection: Code pages marked read-execute only
- SMAP: Supervisor Mode Access Prevention enabled
- SMEP: Supervisor Mode Execution Prevention enabled

Every process gets isolated page tables. CR3 is switched on context switch. There is no kernel address space shared with userspace. Complete separation.

Even if an attacker achieves arbitrary read/write in one process, they cannot read another process's memory, execute shellcode on the heap, or access kernel memory from userspace.

## Graphics Subsystem

Display drivers have historically been catastrophic attack vectors. GPU command stream parsing, display buffer handling, and window compositor logic all run in kernel space in traditional designs. NØNOS isolates the entire display stack.

### Framebuffer Architecture

| Parameter | Value |
|-----------|-------|
| Base address | 0xFD000000 (from UEFI GOP) |
| Resolution | Up to 3840x2160 @ 32bpp |
| Stride | 15360 bytes/line |
| Size | ~31.6 MB for 4K |

### Double Buffering

Only modified regions are copied to the front buffer using dirty region tracking. The display is divided into 1024 tiles of 120x68 pixels. A typical frame with cursor movement copies approximately 8KB instead of 31MB, reducing memory bandwidth by 99.97% in common cases.

### PNG Decoder

| Parameter | Value |
|-----------|-------|
| Decompression | miniz_oxide (pure Rust zlib) |
| Filter reconstruction | Sub, Up, Average, Paeth |
| Color formats | RGB, RGBA, Grayscale |
| Max resolution | 3840x2160 (validated on load) |

v0.8.4 fixed a critical bug where PNG decompression would hang if invoked before VFS and network services initialized. The zlib decompressor was blocking on heap allocation while the allocator waited for a service that hadn't started, creating a classic initialization ordering deadlock.

## Input Subsystem

Input devices are a fascinating attack vector. BadUSB, malicious keyboards injecting keystrokes, and HID protocol fuzzing all demonstrate why the input path must be treated as untrusted.

### PS/2 Protocol Implementation

| Parameter | Value |
|-----------|-------|
| IRQ | 12 (mapped to IDT vector 0x2C) |
| Data port | 0x60 |
| Status port | 0x64 |

**Standard 3-byte packet:**
```
Byte 0: [Yovf|Xovf|Ysign|Xsign|1|MB|RB|LB]
Byte 1: X movement (signed 9-bit with overflow)
Byte 2: Y movement (signed 9-bit with overflow)
```

**IntelliMouse 4-byte packet:**
```
Bytes 0-2: Same as standard
Byte 3: Scroll wheel delta (signed 8-bit)
```

### v0.8.4 Bug Fix: Packet State Machine Desync

The previous implementation only handled 3-byte packets. But the mouse driver initializes IntelliMouse mode (scroll wheel support) by sending the magic sequence `0xF3,200 0xF3,100 0xF3,80`. The mouse responds with device ID `0x03` indicating 4-byte packet mode.

The handler would process bytes 0-2 as a complete packet, then interpret byte 3 (scroll delta) as byte 0 of the next packet. Since scroll deltas rarely have bit 3 set (the PS/2 "always 1" bit), the handler saw an "invalid" first byte and reset, desyncing the packet stream.

Fix: Check `SCROLL_WHEEL_AVAILABLE` flag and wait for 4th byte when enabled.

## Network Stack

Network-facing code is the most attacked surface on any system. NØNOS isolates the entire network stack in network_service.

### E1000 Ethernet Driver

| Parameter | Value |
|-----------|-------|
| Device | Intel 82540EM Gigabit Ethernet |
| BAR0 (MMIO) | 0xFEB80000 (128KB region) |
| IRQ | 11 (mapped to IDT vector 0x2B) |
| RX buffers | 256 descriptors x 2048 bytes |
| TX buffers | 256 descriptors x 2048 bytes |

### TCP/IP Implementation

- Layer 2: Ethernet frame parsing (14-byte header)
- Layer 3: IPv4 (RFC 791)
- Layer 4: TCP (RFC 793) + UDP (RFC 768)
- Layer 7: DNS resolver, HTTP/1.1 client

TCP state machine: CLOSED → SYN_SENT → ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED

### TLS 1.3

| Parameter | Value |
|-----------|-------|
| Handshake | ECDHE with X25519 (RFC 7748) |
| Key derivation | HKDF-SHA256 (RFC 5869) |
| Cipher suite | TLS_CHACHA20_POLY1305_SHA256 |
| Record layer | 16KB max fragment, AEAD authenticated |

A remote TCP exploit gives the attacker control of network_service. From there, they cannot read the filesystem, access crypto keys, draw fake UI, or inject input events. Traditional kernels give network RCE full system access. NØNOS gives network RCE access to send more packets.

## Cryptographic Subsystem

Cryptographic implementations and key storage represent the crown jewels. NØNOS isolates all cryptographic operations in crypto_service.

### Supported Primitives

| Primitive | Implementation |
|-----------|----------------|
| Signatures | Ed25519 (RFC 8032) |
| Key Exchange | X25519 (RFC 7748) |
| Hashing | BLAKE3-256 |
| Symmetric | ChaCha20-Poly1305 |
| ZK Proofs | Groth16 (BN254) |

### Key Storage Architecture

| Parameter | Value |
|-----------|-------|
| Key derivation | BIP-32/SLIP-0010 hierarchical deterministic |
| Master seed | 256-bit entropy from RDRAND + jitter sampling |
| Key encryption | XChaCha20-Poly1305 with hardware-derived KEK |

Applications pass `key_id` references, never raw key material. Private keys exist only inside crypto_service's address space. Malware in your browser cannot exfiltrate your wallet's private keys. The keys physically exist in a different address space. There is no file path to read, no memory address to dump, no API to extract raw key material.

## Filesystem Architecture

Traditional filesystems use discretionary access control, where every process can attempt to open any file. This model fails catastrophically when applications are compromised.

### VFS Layer

| Filesystem | Purpose |
|------------|---------|
| FAT32 | USB mass storage, external media |
| CryptoFS | Encrypted block device (XChaCha20-Poly1305) |
| RamFS | Ephemeral scratch space |

### Capability-Based Access

Applications cannot enumerate directories they don't have capabilities for. Cannot guess file paths. Cannot access files outside their granted capability set.

```rust
struct FileCapability {
    path_hash: [u8; 32],      // BLAKE3 hash of canonical path
    permissions: u8,          // READ=1, WRITE=2, APPEND=4, EXEC=8
    owner_pid: u32,           // Process that owns this capability
    expiry: u64,              // Unix timestamp, 0 = never
    signature: [u8; 64],      // Ed25519 signature by vfs_service
}
```

The vfs_service validates capability signatures on every operation. A compromised browser cannot enumerate your home directory looking for cryptocurrency wallets, SSH keys, or password databases.

## Scheduler

A compromised process that can monopolize CPU can denial-of-service the entire system. NØNOS implements preemptive round-robin with priority levels.

### APIC Timer Configuration

| Parameter | Value |
|-----------|-------|
| Timer mode | Periodic |
| Frequency | 100 Hz (10ms quantum) |
| Vector | 0x20 (IRQ 0, remapped via APIC) |

### Service Priority Assignments

| Priority | Services |
|----------|----------|
| 0 | Kernel (interrupt handlers) |
| 1 | crypto_service, zk_service |
| 2 | input_service, display_service |
| 3 | vfs_service, network_service |
| 4 | desktop_service, applications |

A compromised service spinning in an infinite loop gets preempted after 10ms. It cannot starve crypto_service (higher priority), cannot block input handling, cannot prevent the kernel from scheduling other work. The system remains responsive even under active attack.

## Desktop Environment

Microkernels have a reputation for being research projects that never achieve practical usability. NØNOS proves this wrong.

### Built-in Applications

| Application | Description |
|-------------|-------------|
| Terminal | VT100 emulator, shell with tab completion |
| File Manager | Directory browser, copy/paste/rename/delete |
| Browser | HTTP/HTTPS client, HTML renderer, CSS subset |
| Wallet | HD key derivation, transaction signing, balance |
| Calculator | Basic arithmetic, expression parser |
| Settings | Wallpaper, network, display, time zone |

Each application runs as a separate process. The wallet handling your cryptocurrency keys is completely isolated from the browser rendering untrusted web content. A browser exploit cannot access wallet memory. This is not sandboxing. This is architectural isolation at the hardware page table level.

## v0.8.4 Changelog

### Initialization Order Fix

The monolithic kernel initialized: storage → VFS → network → agents → SDK → wallpaper → timer → desktop

The initial microkernel port initialized: wallpaper → timer → storage → VFS → ... (HANGS)

PNG decompression allocates memory dynamically. The allocator internally uses IPC to coordinate with other services. Those services weren't initialized yet. Deadlock.

**Fix**: Match the monolithic kernel's initialization order. Initialize all services before loading the 4K wallpaper.

### IntelliMouse 4-Byte Packet Fix

PS/2 mouse initialization enables IntelliMouse protocol by sending the magic sequence. The interrupt handler only processed 3 bytes, treating byte 4 (scroll delta) as byte 0 of the next packet.

**Fix**: Check `SCROLL_WHEEL_AVAILABLE` flag and wait for 4th byte when enabled.

### Boot Progress Logging

Added serial output at each boot stage for debugging:

```
[DESKTOP] Initializing storage
[DESKTOP] Initializing services
[WALLPAPER] Loading PNG data
[WALLPAPER] Decoding PNG
[DESKTOP] Setting up timer
[DESKTOP] Drawing desktop
[DESKTOP] Ready
```

### VFS Blocking Removal

Desktop initialization was blocking waiting for VFS service registration. In microkernel architecture, services initialize concurrently. This created a potential deadlock.

**Fix**: Non-blocking VFS check with fallback to continue without filesystem if unavailable during early boot.

## Roadmap to v1.0

NØNOS v0.8.4 is feature-complete for a single-core graphical workstation. Remaining work:

**Multi-Core SMP Support**
- Per-CPU scheduler queues
- IPI (Inter-Processor Interrupt) for cross-core signaling
- RCU-style synchronization for shared kernel structures
- CPU affinity for latency-sensitive services

**Secure Enclave Support**
- Intel SGX integration for hardware-isolated computation
- Enclave ↔ service IPC protocol
- Attestation chain extending to enclave measurements
- Protected key storage in enclave memory

**Hardware Attestation Expansion**
- Remote attestation protocol (RATS architecture)
- TPM 2.0 quote generation and verification
- FIDO2/WebAuthn integration
- Hardware security key support

**Performance Optimization**
- IPC fast path (register-only small messages)
- Page table sharing for read-only mappings
- Zero-copy networking with capability-gated DMA
- GPU compute offload for ZK proof generation

## Download

Coming soon. Builds are being validated on reference hardware.

---

The computing industry has spent fifty years adding security features to fundamentally insecure architectures. Patches on patches. Mitigations for mitigations.

NØNOS asks: what if we started over, with isolation as the foundation instead of an afterthought?

v0.8.4 is the answer. A fully functional graphical operating system where no component trusts any other component. Where compromise is containment, not catastrophe.

*The source is the specification. The architecture is the documentation.*

---

*NØNOS v0.8.4 continues the project's mission of creating a secure, privacy-focused operating system. The entire codebase remains open source under the GNU Affero General Public License.*
