---
title: "Roadmap"
description: "NØNOS Alpha to Beta Development Roadmap"
---

# Alpha → Beta Roadmap

**Version 0.8.0-alpha → 1.0.0-beta** | March–July 2026


## Mission Statement

NØNOS exists to deliver an operating system where privacy is not a feature but an architectural guarantee. Every byte of user data remains under user control. No telemetry. No cloud dependencies. No trust assumptions beyond verified cryptographic proofs. The kernel enforces isolation not through policy but through mathematical certainty.

This roadmap defines the 16-week journey from alpha to beta. Upon completion, NØNOS will stand as the most secure general-purpose operating system available to individuals who refuse compromise on privacy.


## Current State: Alpha (0.8.0)

The alpha release is a fully functional operating system with a complete feature set:

**What's Working:**
- Full graphical desktop environment with 8 built-in applications
- 100+ shell commands (ls, grep, vi, curl, ssh, wallet, etc.)
- Complete TCP/IP network stack with integrated onion routing
- 20+ device drivers (AHCI, NVMe, e1000, RTL8139/8168, WiFi, xHCI, audio)
- RAM filesystem with CryptoFS (ChaCha20-Poly1305 + Merkle tree integrity)
- Post-quantum cryptography (ML-KEM-768, ML-DSA-3)
- Ed25519 + Groth16 ZK boot verification
- 17-type capability-based security system
- TPM 2.0 integration (basic)
- ext4/FAT32 read/write for external media

**Alpha Limitations:**
- All processes execute in ring 0 (user-space isolation for beta)
- Some WiFi chipsets untested
- No formal security audit yet
- Documentation being completed


## Target State: Beta (1.0.0-beta)

The beta release delivers a complete privacy-first operating system suitable for daily use by security-conscious individuals. All data at rest encrypted. All network traffic anonymized by default. All processes capability-restricted. All code paths audited. All cryptographic implementations verified against test vectors and timing attacks.

Beta capabilities:
- ext4 filesystem with full-disk encryption (XChaCha20-Poly1305)
- Onion-routed networking as default transport
- ZK-proven attestation for all loaded code
- Post-quantum cryptography throughout
- Hardware security module integration
- Reproducible builds with deterministic output
- Comprehensive documentation and threat model


## Infrastructure Targets

### Cryptographic Foundation

NØNOS implements cryptography without external dependencies. No OpenSSL. No system libraries. Every primitive built from specification, verified against test vectors, analyzed for timing leaks.

| Primitive | Algorithm | Status | Beta Target |
|-----------|-----------|--------|-------------|
| Symmetric encryption | XChaCha20-Poly1305 | Implemented | Audited |
| Key exchange | X25519 | Implemented | Audited |
| Signatures | Ed25519 | Implemented | Audited |
| Hashing | BLAKE3, SHA-3 | Implemented | Audited |
| KDF | Argon2id | Implemented | Audited |
| PQ-KEM | ML-KEM-768 | Implemented | NIST vectors |
| PQ-Signatures | ML-DSA-65 | Implemented | NIST vectors |
| ZK Proofs | Groth16/BLS12-381 | Implemented | Optimized |
| RNG | ChaCha20-based CSPRNG | Implemented | Entropy audit |

### Storage Stack

| Layer | Technology | Alpha | Beta |
|-------|------------|-------|------|
| Block devices | AHCI, NVMe, VirtIO, USB | Production | Production |
| Partition tables | GPT | Read/write | Read/write |
| Filesystems | RAM FS, CryptoFS, ext4, FAT32 | Functional | Hardened |
| Encryption | CryptoFS (ChaCha20-Poly1305) | Functional | Full-disk mandatory |
| Integrity | Merkle tree (CryptoFS) | Functional | dm-verity equivalent |

### Network Stack

| Layer | Technology | Alpha | Beta |
|-------|------------|-------|------|
| Link | e1000, RTL8139/8168, VirtIO-net, WiFi | Production | Production |
| IP | IPv4, IPv6 | Functional | Hardened |
| Transport | TCP, UDP, QUIC | Functional | RFC-compliant |
| Privacy | Onion routing, MAC randomization | Functional | Default + hardened |
| DNS | DoH/DoT through onion network | Functional | Audited |

### Hardware Support

| Category | Alpha | Beta |
|----------|-------|------|
| CPU | x86_64 | x86_64 (ARM64 planned) |
| Boot | UEFI with Ed25519+Groth16 | UEFI + legacy BIOS |
| Storage | AHCI, NVMe, VirtIO, USB mass storage | Production |
| Network | e1000, RTL, VirtIO, WiFi (Realtek/Intel) | + more WiFi chipsets |
| Input | PS/2, USB HID, I2C HID | Production |
| Graphics | UEFI GOP framebuffer | + basic GPU acceleration |
| Security | TPM 2.0 (basic) | TPM 2.0 (full) |
| Audio | Intel HD Audio (basic) | Production |


## 16-Week Development Schedule

### Phase 1: Foundation Hardening (Weeks 1–4)

#### Week 1: 0.8.1 — Memory Subsystem Audit

**Release Date:** 2026-03-10

The memory subsystem receives comprehensive hardening. Physical frame allocator validates bitmap integrity on every operation. Double-free and use-after-free detection halts execution with diagnostic output. Heap allocator implements red zones with cryptographic canaries. KASLR entropy expands to 24 bits. Guard pages enforce stack boundaries with unmapped regions.

Deliverables:
- Bitmap corruption detection in physical allocator
- Red zone implementation with BLAKE3-derived canaries
- Guard page enforcement on all kernel stacks
- KASLR entropy expansion
- Memory sanitizer for debug builds

#### Week 2: 0.8.2 — Scheduler and Process Isolation

**Release Date:** 2026-03-17

Process isolation strengthened through address space separation verification. Each process receives independent page tables with kernel mappings read-only. Scheduler implements priority inheritance to prevent inversion. CPU time accounting enables resource limiting. Process capabilities inherited through documented rules only.

Deliverables:
- Address space isolation verification
- Priority inheritance implementation
- CPU time accounting per-process
- Capability inheritance rules enforcement
- Process resource limits (memory, file descriptors, threads)

#### Week 3: 0.8.3 — Storage Driver Hardening

**Release Date:** 2026-03-24

Storage drivers receive production-quality error handling. AHCI driver handles controller reset and recovery. NVMe driver supports multiple namespaces with proper queue management. All drivers implement timeout handling to prevent hang on faulty hardware. DMA operations use bounce buffers when source memory does not meet alignment requirements.

Deliverables:
- AHCI controller reset recovery
- NVMe multi-namespace support
- Timeout handling in all storage paths
- DMA bounce buffer implementation
- Unified storage error reporting

#### Week 4: 0.8.4 — ext4 Filesystem Implementation

**Release Date:** 2026-03-31

ext4 filesystem support enables persistent storage. Read support complete for standard ext4 features: extents, directory indexing, large files. Write support follows with journaling for crash consistency. Filesystem driver operates through VFS layer for uniform access semantics.

Deliverables:
- ext4 superblock and group descriptor parsing
- Inode reading and extent tree traversal
- Directory entry enumeration
- File read operations
- Basic write support with journaling


### Phase 2: Security Infrastructure (Weeks 5–8)

#### Week 5: 0.8.5 — Full-Disk Encryption

**Release Date:** 2026-04-07

All persistent storage encrypted by default. XChaCha20-Poly1305 provides authenticated encryption. Key derivation uses Argon2id with user passphrase. Master key encrypted to multiple slots for recovery. Encryption operates at block layer beneath filesystem.

Deliverables:
- Block-layer encryption driver
- XChaCha20-Poly1305 disk encryption
- Argon2id key derivation (64 MiB memory, 4 iterations)
- Multi-slot key management
- Secure key erasure on shutdown

#### Week 6: 0.8.6 — Cryptographic Audit

**Release Date:** 2026-04-14

All cryptographic implementations verified against specifications. Ed25519 matches RFC 8032 test vectors. X25519 matches RFC 7748. ChaCha20-Poly1305 matches RFC 8439. ML-KEM-768 and ML-DSA-65 match NIST submission test vectors. Timing analysis confirms constant-time execution for all secret-dependent operations.

Deliverables:
- RFC 8032 Ed25519 test vector suite
- RFC 7748 X25519 test vector suite
- RFC 8439 ChaCha20-Poly1305 test vector suite
- NIST PQC test vector validation
- Timing analysis tooling and results

#### Week 7: 0.8.7 — Network Stack Hardening

**Release Date:** 2026-04-21

TCP/IP stack hardened against network attacks. Fragment reassembly bounded to prevent memory exhaustion. TCP state machine validated against RFC 9293. SYN flood mitigation through SYN cookies. IP spoofing prevented through reverse path filtering. All network buffers bounded per-connection.

Deliverables:
- Fragment reassembly memory limits
- TCP RFC 9293 compliance
- SYN cookie implementation
- Reverse path filtering
- Per-connection buffer limits

#### Week 8: 0.8.8 — Onion Routing Integration

**Release Date:** 2026-04-28

Network traffic routes through onion network by default. Tor-compatible circuit construction. Three-hop circuits with cryptographic layering. DNS resolution through onion network. Fallback to clearnet only with explicit user override. Circuit rotation on configurable interval.

Deliverables:
- Onion routing circuit construction
- Cell encryption and relay
- Directory authority communication
- Onion DNS resolution
- Circuit management and rotation


### Phase 3: Advanced Security (Weeks 9–12)

#### Week 9: 0.8.9 — ZK Attestation Enforcement

**Release Date:** 2026-05-05

All loaded code requires ZK attestation proof. Module loader verifies Groth16 proofs before execution. Proof verification under 10ms on reference hardware. Attestation covers code hash, signing authority, and capability grants. Invalid proofs prevent module load with audit log entry.

Deliverables:
- Mandatory ZK verification in module loader
- Proof verification optimization
- Attestation format specification
- Verification failure handling
- Audit logging for attestation events

#### Week 10: 0.8.10 — Capability System Completion

**Release Date:** 2026-05-12

Capability enforcement covers all system interfaces. No syscall bypasses capability checks. Token expiration enforced with millisecond precision. Capability delegation follows principle of least privilege. Audit log captures all capability operations.

Deliverables:
- Comprehensive syscall capability checks
- Token expiration enforcement
- Capability delegation constraints
- Revocation propagation
- Complete audit trail

#### Week 11: 0.8.11 — TPM Integration

**Release Date:** 2026-05-19

TPM 2.0 provides hardware-backed security. Measured boot extends PCRs with boot component hashes. Disk encryption keys sealed to PCR state. Remote attestation proves system integrity. TPM random number generator supplements software entropy.

Deliverables:
- TPM 2.0 driver implementation
- PCR extension during boot
- Key sealing to PCR values
- Remote attestation protocol
- TPM RNG integration

#### Week 12: 0.8.12 — SMP Correctness Verification

**Release Date:** 2026-05-26

Multiprocessor operation verified correct under all conditions. IPI delivery reliable under load. TLB shootdown protocol prevents stale mappings. Per-CPU data properly isolated. Lock ordering prevents deadlock. Memory ordering correct on all architectures.

Deliverables:
- IPI delivery verification
- TLB shootdown correctness
- Per-CPU isolation validation
- Lock order enforcement
- Memory barrier audit


### Phase 4: Polish and Release (Weeks 13–16)

#### Week 13: 0.9.0 — USB and Hardware Expansion

**Release Date:** 2026-06-02

USB stack reaches production quality. xHCI driver handles all transfer types. Mass storage class enables USB boot media. HID class supports keyboards and mice. Hub support enables multi-device configurations. Hot-plug reliable.

Deliverables:
- xHCI transfer completion
- USB mass storage class
- USB HID class
- Hub support
- Hot-plug handling

#### Week 14: 0.9.1 — WiFi Support

**Release Date:** 2026-06-09

Wireless networking for select chipsets. Realtek RTL8821CE and Intel AX200 prioritized. WPA3-SAE authentication. Traffic routes through onion network same as wired. Power management for mobile use.

Deliverables:
- WiFi driver framework
- RTL8821CE driver
- WPA3-SAE implementation
- Power management
- Roaming support

#### Week 15: 0.9.2 — Documentation and Reproducibility

**Release Date:** 2026-06-16

Documentation complete for all public interfaces. Build process fully reproducible. Bit-identical output from independent builds. Source tarball self-contained. Threat model documented.

Deliverables:
- Architecture specification
- ABI reference
- Build manual
- Installation guide
- Threat model document
- Reproducible build verification

#### Week 16: 1.0.0-beta — Beta Release

**Release Date:** 2026-06-23

All prior deliverables integrated. Full regression suite passes. 72-hour stability test completes. Known issues documented. Release artifacts signed and published.

Deliverables:
- Integrated beta release
- Complete test suite passage
- Stability verification
- Release notes
- Signed ISO images


## Privacy Architecture

### Data At Rest

All persistent storage encrypted. No unencrypted writes to disk under any circumstance. Temporary files use encrypted RAM filesystem. Swap disabled by default; if enabled, encrypted with ephemeral key. Secure deletion overwrites freed blocks.

### Data In Transit

All network traffic routes through onion network by default. DNS queries resolve through encrypted channels. No cleartext connections without explicit user override. TLS for any direct connections uses post-quantum key exchange.

### Data In Memory

Process memory isolated through hardware page tables. Kernel memory randomized through KASLR. Sensitive data cleared after use. DMA restricted to designated regions.

### Metadata Protection

Filesystem timestamps optionally disabled. File sizes padded to reduce fingerprinting. Network packet sizes normalized. Access patterns obscured through dummy operations.

### User Identity

No hardware identifiers exposed to applications. MAC addresses randomized per connection. No telemetry or analytics. No account requirements.


## Security Guarantees

### Cryptographic

- All primitives constant-time implementation
- No weak random number generation
- Post-quantum algorithms for long-term secrets
- Forward secrecy on all key exchanges
- Authenticated encryption for all data protection

### Isolation

- Process address spaces hardware-enforced
- Capabilities required for all privileged operations
- Module sandboxing prevents escape
- Kernel/user boundary enforced by CPU

### Integrity

- Measured boot with TPM attestation
- ZK proofs verify code authenticity
- Filesystem integrity verification
- Signed updates only

### Availability

- Resource limits prevent exhaustion
- Watchdog timers detect hangs
- Graceful degradation under load
- Recovery mechanisms for corruption


## Comparison: NØNOS vs Existing Solutions

| Feature | NØNOS | Tails | Whonix | QubesOS |
|---------|-------|-------|--------|---------|
| Kernel | Custom microkernel | Linux | Linux | Xen + Linux |
| FDE mandatory | Yes | No | No | Optional |
| Onion default | Yes | Yes | Yes | No |
| ZK attestation | Yes | No | No | No |
| PQ crypto | Yes | No | No | No |
| TPM integration | Yes | No | No | Optional |
| Capability system | Yes | No | No | Partial |
| RAM-only option | Native | Live USB | VM | No |
| Reproducible | Yes | Partial | Partial | Partial |


## Post-Beta Roadmap

| Version | Date | Focus |
|---------|------|-------|
| 1.0.1-beta | 2026-06-30 | Critical bug fixes |
| 1.0.2-beta | 2026-07-07 | Community feedback |
| 1.0.3-beta | 2026-07-14 | Performance tuning |
| 1.0.0-rc1 | 2026-07-21 | Release candidate |
| 1.0.0 | 2026-07-28 | Stable release |

### Future Directions (Post-1.0)

- ARM64 architecture support
- Secure enclave integration (SGX, TrustZone)
- Hardware wallet integration
- Mobile device support
- Mesh networking
- Distributed storage backend


## Governance

### Decision Making

Technical decisions by consensus among core developers. Security-critical changes require cryptography specialist approval. Architecture changes require documentation update before merge.

### Contribution

All contributions require signed commits. Code review mandatory for all changes. Security-sensitive code requires two reviewers. Test coverage required for new features.

### Disclosure

Security vulnerabilities reported privately. 90-day disclosure timeline. Coordinated release with fix availability. Credit to reporters.


**Sovereignty From Ø**
