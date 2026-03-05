---
title: "Technical Specification"
description: "Complete NØNOS Alpha technical specification"
weight: 5
---

# NØNOS Alpha Technical Specification

**Version 0.8.0-alpha**
**Document Revision: 2026-03-03**


## 1. Abstract

NØNOS represents a fundamental reimagining of operating system design for the modern threat landscape. Rather than retrofitting privacy features onto architectures conceived in an era of implicit trust, NØNOS builds ephemeral execution and cryptographic verification into its foundational abstractions. The system executes on bare metal x86_64 hardware, boots through UEFI firmware, and provides a complete computing environment that leaves no forensic trace upon session termination.

The core innovation of NØNOS lies in its treatment of persistent storage as an exceptional case rather than a default primitive. Traditional operating systems assume disk storage as fundamental infrastructure, layering volatile memory as a performance optimization above persistent backing stores. NØNOS inverts this relationship entirely. Random access memory serves as the primary and default-only storage medium, with all volatile state discarded upon power loss, explicit session termination, or system shutdown. This architectural decision permeates every subsystem: the bootloader verifies artifacts without writing verification state, the kernel manages processes without swap files, the filesystem operates entirely in memory, and applications execute without temporary file creation.

The security architecture of NØNOS surpasses any existing general-purpose operating system in both breadth and depth of protection. The cryptographic subsystem implements a complete post-quantum algorithm suite encompassing ML-KEM for key encapsulation across three security levels, ML-DSA for digital signatures across three parameter sets, SPHINCS+ for stateless hash-based signatures, NTRU for lattice-based key encapsulation, and Classic McEliece for code-based cryptography resistant to all known quantum attacks. Every cryptographic operation executes through constant-time primitives that eliminate timing side channels regardless of input values. The kernel implements comprehensive mitigations for all known microarchitectural vulnerabilities including Spectre variant one through four, Meltdown, MDS, L1 Terminal Fault, and speculative store bypass, utilizing hardware features where available and software countermeasures universally.

Network privacy receives equal attention through a complete Tor-compatible onion routing implementation embedded directly in the kernel networking stack. Circuits traverse three hops using the ntor handshake protocol, cells carry 509 bytes with AES-128-CTR encryption, and the implementation supports directory authority communication, consensus document parsing, and stream multiplexing over established circuits. All network traffic can route through the onion network by default, with DNS resolution through encrypted channels using DNS over HTTPS or DNS over TLS protocols.

Zero-knowledge proof systems enable verification without information disclosure across multiple domains. The kernel can attest to its build properties without revealing signing keys or build environment details through Groth16 proofs over the BLS12-381 curve. User authentication operates through ZK-IDS, a zero-knowledge identity system where users prove knowledge of credentials without transmitting credential material. This proof-based approach eliminates credential theft as an attack vector while maintaining strong authentication guarantees.

The formal guarantee that NØNOS provides is termed ZeroState: under default policy, when a session terminates, the persistent state vector equals null. This property transcends encrypted storage approaches because data that was never written cannot be recovered regardless of cryptographic advances, key compromise, or computational breakthroughs. Non-existence provides stronger guarantees than confidentiality.

This document provides the complete technical specification of NØNOS as implemented for the alpha release, encompassing formal models that define system behavior precisely, architectural decisions with their rationales, subsystem designs with exact implementation parameters drawn from the source code, security properties with their enforcement mechanisms, and the engineering roadmap for subsequent development phases.


## 2. Definitions and Formal Model

### 2.1 Terminology

Precise terminology forms the foundation of any rigorous technical specification. The definitions established in this section are normative throughout the remainder of this document. When these terms appear in subsequent sections, they carry exactly the meanings specified here, enabling unambiguous interpretation of requirements and guarantees.

**State** encompasses any information maintained by the system that influences future computation. This definition is deliberately broad, capturing CPU register contents that determine instruction execution, RAM contents that store program data and code, storage device contents that persist across power cycles, firmware variable contents that configure system behavior, and peripheral device memory contents that may retain information. The totality of state determines system behavior at any instant. State admits a fundamental partition into volatile state, which does not survive power loss under any circumstances, and persistent state, which survives power loss under normal operating conditions. This partition is physical rather than logical: it derives from the electrical properties of storage media rather than software configuration.

**Persistence** describes the property whereby state survives across power boundaries. A piece of data exhibits persistence if and only if it can be recovered after a complete power cycle, defined as system power removed entirely and then restored, without requiring external transmission during the powered session. Persistence requires a storage medium that maintains information without continuous electrical power: magnetic domains on spinning platters, charge states in flash memory cells, battery-backed SRAM, or firmware NVRAM regions. The persistence boundary is not merely a software abstraction but a physical property enforced by the laws of electronics.

**ZeroState** constitutes the formal property that the persistent state written by a NØNOS session equals the empty set under default policy. This property makes a specific and falsifiable claim: examining persistent storage media before and after a NØNOS session under default configuration will reveal identical contents, byte for byte. ZeroState does not claim that persistent storage is inaccessible during a session; read operations proceed normally. The guarantee concerns writes only: the system's default behavior performs no persistent writes whatsoever. Explicit user action or policy override can enable persistence for specific purposes; such overrides are tracked in a session integrity model and surfaced through user interface indicators, ensuring the user always knows whether the ZeroState property holds for their current session.

**Ephemeral execution** describes computation whose byproducts do not persist beyond the execution boundary. An ephemeral session begins at the moment the bootloader transfers control to the kernel and terminates at shutdown, reboot, or power loss. Throughout this interval, all computation products—process memory, kernel data structures, filesystem contents, network state, application data—reside exclusively in volatile memory. When the session boundary is crossed, whether intentionally through shutdown or unintentionally through power failure, all session state vanishes instantaneously and irrecoverably. This is not a promise to delete data eventually; it is a structural guarantee that the data exists only in media that cannot retain information without power.

**Execution boundary** marks the transition between session non-existence and session existence. The boot process constitutes entry across the execution boundary, transitioning from a state where no NØNOS session exists to a state where an active session executes. Shutdown constitutes exit across the execution boundary, transitioning from active execution to session non-existence. At the execution boundary, the system moves between three distinct phases: pre-session, where no NØNOS state resides in memory and the system awaits boot initiation; active-session, where NØNOS state populates memory and computation proceeds; and post-session, where NØNOS state has been discarded from memory either through explicit clearing or power removal and the system returns to the pre-session phase.

**Trust boundary** separates code or components operating at different privilege levels or under different trust assumptions. The primary trust boundaries in NØNOS form a layered hierarchy. The firmware and bootloader boundary assumes firmware operates correctly per its specification; NØNOS cannot verify firmware integrity from a position subordinate to firmware execution. The bootloader and kernel boundary is verified through cryptographic signatures and optional zero-knowledge attestation, establishing that the kernel binary matches an expected and approved artifact. The kernel and userspace boundary is enforced through CPU privilege rings, with the kernel executing at ring zero and applications at ring three, combined with memory protection through separate page table hierarchies that prevent userspace code from accessing kernel memory. The application to application boundary is enforced through process isolation, where each process operates in its own virtual address space with no ability to access memory belonging to other processes except through explicit kernel-mediated shared memory regions.

**Measurement** refers to the cryptographic summarization of a component for purposes of integrity verification. In NØNOS, a measurement is computed as a BLAKE3 hash producing a 256-bit output from the component's complete binary representation. Measurements enable two distinct operations: verification that a component matches an expected and approved state by comparing computed and expected hashes, and attestation that a component was measured by including the measurement in a signed statement or zero-knowledge proof. The BLAKE3 hash function was selected for its combination of security (256-bit preimage and collision resistance), performance (parallel computation across multiple cores), and simplicity (single algorithm suitable for all hashing needs).

**Attestation** constitutes a claim about system state backed by cryptographic evidence that a third party can verify. NØNOS supports two attestation mechanisms with complementary properties. Signature-based attestation uses Ed25519 digital signatures, where a trusted authority signs a measurement or state claim with their private key, producing a 64-byte signature that anyone can verify using the corresponding 32-byte public key. This approach requires trusting the signing authority and reveals the signed content to verifiers. Zero-knowledge attestation uses Groth16 proofs over the BLS12-381 curve, where the prover demonstrates knowledge of information satisfying a predicate without revealing that information, producing a 192-byte proof that verifiers check through elliptic curve pairings. This approach enables verification of properties without disclosure of underlying data.

**Capability** represents an unforgeable token that authorizes access to a specific resource or operation. NØNOS implements capabilities through two complementary mechanisms. A per-process capability bitmask stores 64 bits atomically, where each bit corresponds to a capability type (process execution, input/output, networking, inter-process communication, memory management, cryptography, filesystem, hardware access, debugging, and administration). Capability tokens extend this basic mechanism with delegation and transfer properties: a token encapsulates the owning module identifier, a vector of granted capabilities, an optional expiration timestamp, a unique nonce to prevent replay, and a 64-byte Ed25519 signature binding these fields together. Tokens can be passed between processes and verified at any time, enabling fine-grained permission delegation without kernel involvement in every authorization decision.

**Artifact** refers to any binary object distributed as part of the NØNOS system. The artifact category includes the bootloader that initializes hardware and loads the kernel, the kernel binary that provides operating system services, application binaries that execute in userspace, and resource bundles containing data files. Each artifact follows a defined format with metadata headers describing the artifact type and version, payload sections containing executable code or data, and cryptographic trailers containing signatures and optional zero-knowledge proofs. The artifact format enables verification before execution, ensuring only approved and unmodified components run on the system.

**Session** denotes a single boot-to-termination execution of NØNOS. Sessions receive unique identification through a random 128-bit session identifier generated during early boot from hardware entropy sources. The hardware random number generator, accessed through the RDRAND and RDSEED instructions on supporting processors or through the UEFI random number protocol on systems without direct hardware support, provides the entropy for session identifier generation. This identifier appears in logs and audit records, enabling correlation of events within a single session while providing no linkage between separate sessions.

### 2.2 State Machine Model

Formal modeling enables precise reasoning about system behavior and the guarantees that NØNOS provides. We model a NØNOS session as a deterministic finite state machine augmented with a state vector that captures all information the system maintains. This model is not merely descriptive but prescriptive: the implementation must conform to the model's constraints for the system to be considered correct.

Let S denote the complete state vector of the system at any instant. This vector encompasses every bit of information that influences system behavior, from CPU registers through peripheral memory. We partition S into two disjoint components:

**S = (V, P)**

The volatile component V represents all state that does not survive power loss. This includes CPU register contents, RAM contents across all memory regions, peripheral device volatile memory such as network interface buffers, and any other storage that requires continuous power to maintain its contents. The persistent component P represents all state that survives power loss under normal conditions. This includes storage device contents (hard drives, solid state drives, USB drives), UEFI variables stored in firmware NVRAM, and any battery-backed memory regions.

The system begins execution in an initial state S₀ = (V₀, P₀). The volatile component V₀ is undefined at this point: RAM contents are indeterminate prior to initialization, containing whatever electrical states the memory cells happened to assume during power-on. The persistent component P₀ represents the persistent state inherited from the pre-boot environment, which includes the NØNOS artifacts stored on the boot medium, any UEFI variables set by previous boot sessions or firmware configuration, and the contents of any attached storage devices.

The boot process transitions the system to state S₁ = (V₁, P₁). The volatile component V₁ is now defined and deterministic, representing the result of the boot sequence: initialized memory structures, the loaded kernel image, initialized subsystem data structures, and the ready state of all software components. Under default ZeroState policy, the persistent component P₁ equals P₀ exactly: no persistent writes occurred during boot. The bootloader read artifacts from storage but wrote nothing back. The kernel initialized its data structures entirely in RAM.

During active operation, the system evolves through a sequence of states S₁, S₂, ..., Sₙ. Each transition Sᵢ → Sᵢ₊₁ results from the execution of one or more instructions that modify system state. Under default ZeroState policy, a critical invariant holds for all transitions:

**Pᵢ₊₁ = Pᵢ**

This invariant states that the persistent component remains constant throughout execution. No kernel operation, no application action, no device driver, no interrupt handler modifies persistent storage. The entire session executes within the volatile component of the state vector, treating the persistent component as read-only. This is the operational definition of ZeroState: the persistent partition of the state vector is immutable under default policy.

Session termination transitions the system to a final state Sₜ = (⊥, Pₙ). The symbol ⊥ denotes undefined or invalid state, representing that the volatile component no longer holds meaningful information after power loss or explicit memory clearing. Under ZeroState, Pₙ = P₀, meaning the persistent state after termination equals the persistent state before boot. An external observer examining persistent storage before and after a NØNOS session would find identical contents, with no forensic evidence that any computation occurred.

### 2.3 ZeroState Invariant

The ZeroState property admits a precise mathematical formulation. Let W(t) denote the set of write operations to persistent storage performed by NØNOS at time t during a session. Each write operation is a tuple (address, data, medium) specifying the target address, the data written, and the storage medium involved. The ZeroState invariant states:

**∀t ∈ [boot, termination]: W(t) = ∅**

For all times t between boot and termination, under default policy, the set of write operations to persistent storage is empty. This invariant is significantly stronger than any encryption-based privacy guarantee. Encrypted storage protects data confidentiality assuming the encryption key remains secret and the encryption algorithm remains secure. Both assumptions may fail: keys can be compromised through theft, legal compulsion, or cryptanalysis, and algorithms can be broken through mathematical advances or the advent of quantum computing. The ZeroState invariant is immune to all such attacks because it guarantees non-existence rather than confidentiality. Data that was never written to persistent storage cannot be recovered regardless of cryptographic advances, key compromise, or computational capabilities. Non-existence is a stronger property than encryption in all threat models.

The invariant admits explicit exceptions through policy override. If a user enables a persistence feature, such as saving a document to an attached storage device, the system transitions to a non-ZeroState mode for that specific operation. This transition is logged in the session integrity record, which itself resides in volatile memory and will not persist. The user interface displays indicators showing that persistence has been enabled, ensuring the user maintains awareness of their session's privacy properties. Users who require persistence for specific workflows can enable it deliberately while maintaining ZeroState for all other operations.

### 2.4 Clean Boot Property

A boot sequence is considered "clean" when it satisfies five verification conditions that together establish a trusted foundation for the session. Each condition addresses a distinct threat, and all must pass for boot to proceed.

The first condition requires that the kernel artifact's computed hash matches the signed hash value. The bootloader computes a BLAKE3 hash of the kernel binary as loaded into memory, producing a 256-bit digest. This computed digest must match exactly the digest value embedded in the artifact's cryptographic trailer. Any modification to the kernel binary, whether from storage corruption, malicious tampering, or transmission errors, will cause a hash mismatch and abort boot.

The second condition requires that the Ed25519 signature over the hash verifies against a trusted public key. The artifact contains a 64-byte Ed25519 signature computed over the 32-byte BLAKE3 hash using the distributor's private signing key. The bootloader verifies this signature using a public key either embedded in the bootloader itself or stored in firmware. Successful verification proves that an entity possessing the private key signed the exact kernel binary being booted. Assuming the private key has not been compromised, this establishes that the kernel is an authorized artifact from a trusted source.

The third condition, when applicable, requires that the zero-knowledge proof verifies with the Groth16 verifier. The kernel artifact may optionally include a ZK proof block that attests to properties of the build without revealing the signing key or build environment details. The proof is a 192-byte Groth16 SNARK over the BLS12-381 curve. Verification involves three elliptic curve pairing operations that check the proof against the verification key and public inputs. A valid proof demonstrates that the prover knew a valid signature and build environment satisfying the circuit constraints, without revealing what that signature or environment was.

The fourth condition requires that the bootloader transfers control to the kernel at the designated entry point with correct parameters. The kernel entry point is fixed at physical address 0x100000 (1 MiB), a conventional location above the legacy BIOS region. The bootloader must pass a pointer to a valid BootHandoffV1 structure in the RDI register, providing the kernel with essential information about the system configuration: memory map, framebuffer parameters, ACPI table locations, and boot timing data.

The fifth condition requires that the kernel's early initialization completes without detecting integrity violations. The kernel performs self-verification during early boot, checking that its code segments match expected checksums, that its data structures are properly aligned and sized, and that the CPU features it requires are present and functional. Any anomaly during this phase indicates possible tampering or hardware malfunction and triggers boot abort.

When all five conditions pass, boot succeeds and establishes a clean trust anchor for the session. All subsequent security guarantees rest on this foundation. When any condition fails, boot aborts with a diagnostic message, preventing execution of potentially compromised code.


## 3. System Goals and Non-Goals

### 3.1 Primary Goals

NØNOS pursues five primary engineering goals, listed in descending order of priority. When design decisions create tension between goals, higher-priority goals take precedence. This explicit prioritization ensures consistent decision-making across all subsystems and development phases.

**Goal One: Forensic Resistance**

The highest priority goal is ensuring that no evidence of computation persists after session termination. A forensic investigator with physical access to the hardware after a NØNOS session should find no artifacts indicating what applications ran, what data was processed, what network connections were established, or even that a NØNOS session occurred rather than the machine sitting idle. This goal drives the ZeroState architecture and influences every subsystem design decision.

Forensic resistance encompasses multiple threat scenarios. Cold boot attacks attempt to recover RAM contents by exploiting the gradual decay of DRAM cells after power removal; NØNOS counters this through immediate memory clearing on shutdown when possible and through its fundamental architecture that makes RAM the only location of session data. Disk forensics examines storage media for file remnants, temporary files, swap space contents, and filesystem metadata; NØNOS stores nothing to disk under default policy, eliminating this attack surface entirely. Network traffic analysis examines captured packets and flow data; NØNOS routes traffic through onion networks and uses encrypted protocols to resist content inspection and minimize metadata exposure.

**Goal Two: Cryptographic Verification**

The second priority goal establishes mathematical certainty about system integrity. Every component that executes passes through cryptographic verification that proves authenticity and integrity. The boot chain verifies the kernel through Ed25519 signatures and optional zero-knowledge proofs. The kernel verifies loadable modules through signature checking and manifest validation. Applications can request verification of system state through attestation interfaces.

Cryptographic verification provides a foundation resistant to tampering and substitution attacks. Traditional systems rely on access controls to prevent unauthorized modifications, but access controls can be bypassed through privilege escalation, physical access, or supply chain attacks. NØNOS adds a verification layer that detects modifications regardless of how they were introduced. An attacker who somehow modifies a kernel binary will cause verification failure and boot abort even if they have physical access to the machine and administrator credentials.

**Goal Three: Minimal Attack Surface**

The third priority goal minimizes the code and interfaces available to attackers. Every line of code is a potential vulnerability. Every interface is a potential entry point. NØNOS reduces attack surface through multiple strategies: implementing only essential functionality rather than feature-rich convenience layers, using memory-safe Rust for all new code to eliminate entire vulnerability classes, providing capability-based access control that denies permissions by default, and isolating components so that compromise of one cannot easily spread to others.

Attack surface minimization requires constant vigilance during development. Features must justify their inclusion through clear necessity rather than potential convenience. Code paths must be auditable and understandable. External dependencies must be reviewed for security and minimized where possible. The kernel provides primitives; policy enforcement and rich functionality belong in userspace where their compromise has limited impact.

**Goal Four: Hardware Agnosticism**

The fourth priority goal enables deployment across diverse x86_64 hardware without requiring specific vendor features or specialized security processors. While NØNOS can leverage hardware security features like TPM 2.0 when available, core security guarantees do not depend on them. A user should receive strong privacy protection whether running on a modern system with the latest security features or an older system with only basic x86_64 capabilities.

Hardware agnosticism recognizes the practical reality that users cannot always control their hardware environment. Someone requiring privacy might use borrowed or rented hardware, older equipment, or systems where hardware security features have been disabled or compromised. NØNOS provides software-based guarantees that function regardless of hardware capabilities, while opportunistically strengthening protections when hardware support is available.

**Goal Five: Usability**

The fifth priority goal recognizes that privacy tools unused are privacy tools useless. NØNOS must be accessible to users who are not security experts, providing reasonable defaults that deliver strong protection without requiring extensive configuration. The system should boot quickly, provide a familiar desktop environment, run standard applications, and handle common tasks without requiring users to understand the underlying security mechanisms.

Usability goals constrain security mechanism design. A theoretically optimal security mechanism that users disable because it interferes with their work provides no actual protection. NØNOS seeks mechanisms that provide strong security with minimal user friction, preferring transparent protections that operate without user intervention over configurable options that users must correctly enable.

### 3.2 Non-Goals

Certain objectives lie explicitly outside the NØNOS scope. Documenting non-goals prevents scope creep and clarifies expectations for users evaluating whether NØNOS fits their needs.

**Persistent Data Storage**

NØNOS does not aim to provide long-term data storage within the operating system itself. Users requiring persistent storage must use external mechanisms: network services for cloud storage, attached devices explicitly enabled for storage, or removable media. The operating system provides interfaces for these external storage mechanisms but does not itself offer persistence as a core feature.

**Full Linux Binary Compatibility**

While NØNOS implements Linux-compatible syscall numbers for the most common operations, complete binary compatibility with arbitrary Linux applications is not a goal. The kernel implements essential syscalls using Linux calling conventions and semantics, enabling many applications to run without modification. However, applications relying on Linux-specific features not implemented in NØNOS, advanced filesystem semantics, or kernel interfaces beyond the core syscall set will require porting or may not function.

**Real-Time Guarantees**

NØNOS does not provide hard real-time scheduling guarantees suitable for industrial control, robotics, or other applications requiring deterministic timing. The scheduler supports priority levels including a real-time priority class, but this provides soft priority preference rather than guaranteed timing bounds. Applications requiring certified real-time behavior should use a dedicated real-time operating system.

**Firmware Security**

NØNOS cannot protect against firmware-level attacks including UEFI rootkits, firmware implants, or malicious firmware updates. The operating system executes at a privilege level subordinate to firmware and cannot verify or constrain firmware behavior. Users concerned about firmware attacks should employ separate mitigations: verified firmware sources, firmware integrity measurement where supported, and physical security for hardware.


## 4. Security Architecture

### 4.1 Cryptographic Subsystem

The cryptographic subsystem forms the foundation of NØNOS security, providing primitives for confidentiality, integrity, authenticity, and zero-knowledge verification. Every algorithm implementation prioritizes security over performance, with all secret-dependent operations executing through constant-time code paths that eliminate timing side channels.

#### 4.1.1 Symmetric Encryption

The Advanced Encryption Standard with Galois/Counter Mode (AES-GCM) provides authenticated encryption for data confidentiality and integrity. NØNOS implements all three standard key sizes: AES-128 with 128-bit keys for general use, AES-192 with 192-bit keys for extended security margin, and AES-256 with 256-bit keys for maximum security. The implementation generates round keys through the standard key schedule expansion, producing 11 round keys for AES-128, 13 for AES-192, and 15 for AES-256. The S-box substitution table contains 256 entries accessed through constant-time lookup functions that ensure access patterns do not leak information about indices. All S-box lookups use the ct_lookup_u8() primitive, which accesses all table entries regardless of the target index, preventing cache timing attacks.

The Galois/Counter Mode combines counter mode encryption with polynomial multiplication for authentication. Each encryption operation consumes a 96-bit nonce that must never repeat with the same key. The authentication tag provides 128 bits of integrity protection, detecting any modification to the ciphertext or associated data. Nonce generation uses hardware random number generators, with a fallback to BLAKE3-based derivation from unique session values when hardware entropy is unavailable.

ChaCha20-Poly1305 provides an alternative authenticated encryption construction using the ChaCha20 stream cipher and Poly1305 message authentication code. The implementation initializes the ChaCha20 state with the standard constant words that spell "expand 32-byte k" in ASCII: 0x61707865, 0x3320646e, 0x79622d32, and 0x6b206574. These constants occupy the first four 32-bit words of the 16-word state matrix, followed by the 256-bit key in words four through eleven and the nonce and counter in words twelve through fifteen. The quarter round function performs the core mixing operations, combining additions, XORs, and rotations in a pattern that achieves rapid diffusion. Twenty rounds (ten column rounds alternating with ten diagonal rounds) produce the keystream block.

The Poly1305 authenticator computes a polynomial evaluation modulo the prime 2^130 - 5, producing a 128-bit tag that is computationally unforgeable without knowledge of the one-time key. The one-time key derives from the first ChaCha20 block output, ensuring a unique authenticator key for each message without requiring key management beyond the main encryption key.

#### 4.1.2 Hash Functions

BLAKE3 serves as the primary cryptographic hash function throughout NØNOS. The algorithm processes input in 64-byte blocks using a binary tree structure that enables parallel computation on multi-core processors. The compression function operates on 16 32-bit words using the same quarter round structure as ChaCha20, providing confidence through design similarity to a well-analyzed primitive. BLAKE3 produces variable-length output, with NØNOS standardizing on 256-bit digests for all hashing operations.

The implementation supports several modes distinguished by flag bytes in the compression function. The KEYED_HASH flag (0x10) enables keyed hashing for message authentication codes. The DERIVE_KEY_CONTEXT flag (0x20) marks the first stage of key derivation, processing a context string. The DERIVE_KEY_MATERIAL flag (0x40) marks the second stage, deriving key material from the context-derived key and input material. This key derivation function provides domain separation between keys derived for different purposes, preventing cross-protocol attacks.

The SHA-3 family provides hash function diversity, implementing Keccak-based algorithms standardized by NIST. NØNOS supports SHA3-256 with 256-bit output and 136-byte rate, and SHA3-512 with 512-bit output and 72-byte rate. The SHAKE128 and SHAKE256 extendable output functions produce arbitrary-length digests for applications requiring more than fixed-size output. SHA-3 serves applications where compatibility with external systems requires NIST-standardized algorithms or where hash function diversity provides defense in depth against cryptanalytic advances affecting any single algorithm family.

#### 4.1.3 Asymmetric Cryptography

Ed25519 provides digital signatures with 128-bit security level. The algorithm operates on the edwards25519 elliptic curve, a twisted Edwards curve offering fast arithmetic and complete addition formulas that eliminate exceptional cases. Public keys are 32 bytes (a compressed curve point), private keys are 32 bytes (a scalar after clamping), and signatures are 64 bytes (a compressed point R and scalar s). Signature generation hashes the private key with SHA-512 to derive the signing scalar and prefix, computes the nonce deterministically from the prefix and message, and produces the signature components through scalar multiplication and arithmetic. Signature verification recovers the public key point, computes the hash challenge, and verifies the equation through a combined multi-scalar multiplication.

The implementation performs all scalar and field arithmetic in constant time. Field multiplications use Montgomery representation with a fully unrolled multiplication routine that executes identical operations regardless of operand values. Conditional swaps in the Montgomery ladder use bitwise selection rather than branches. The modular reduction at the end of scalar multiplication executes identical instruction sequences for all inputs.

X25519 provides elliptic curve Diffie-Hellman key agreement, producing a 32-byte shared secret from a 32-byte private scalar and 32-byte public point. The Montgomery ladder implementation processes all 255 bits of the scalar with constant-time conditional swaps, preventing timing attacks from observing which ladder steps perform swaps. Private keys undergo clamping that clears the low three bits (ensuring the scalar is a multiple of the cofactor) and sets the high bit (ensuring a constant-time ladder).

The P-256 elliptic curve (secp256r1) provides ECDSA signatures for compatibility with systems requiring NIST-standardized curves. While Ed25519 is preferred for new designs, P-256 support enables interoperability with existing infrastructure. The implementation uses Jacobian coordinates for point operations and constant-time modular inversion through Fermat's little theorem.

RSA support covers legacy compatibility requirements with 2048, 3072, and 4096-bit key sizes. The implementation provides PKCS#1 v1.5 padding for systems requiring backward compatibility, OAEP with SHA-256 for secure encryption, and PSS for secure signatures. Constant-time modular exponentiation uses a fixed-window method with constant memory access patterns, preventing cache timing attacks that have broken many RSA implementations.

#### 4.1.4 Post-Quantum Cryptography

NØNOS implements a comprehensive post-quantum cryptography suite protecting against future quantum computer attacks. Current public key cryptography, including RSA, DSA, ECDSA, ECDH, and EdDSA, will fall to Shor's algorithm running on sufficiently powerful quantum computers. While such computers do not yet exist, encrypted data captured today could be decrypted in the future when quantum computers become available. Post-quantum algorithms provide protection against this "harvest now, decrypt later" threat model.

ML-KEM (Module Learning with Errors Key Encapsulation Mechanism, formerly CRYSTALS-Kyber) provides key encapsulation based on the module learning with errors problem, which is believed resistant to quantum attack. NØNOS implements all three standardized parameter sets. ML-KEM-512 provides NIST security level one (equivalent to AES-128 against quantum attack), with 800-byte public keys and 768-byte ciphertexts. ML-KEM-768 provides NIST security level three (equivalent to AES-192), with 1184-byte public keys and 1088-byte ciphertexts. ML-KEM-1024 provides NIST security level five (equivalent to AES-256), with 1568-byte public keys and 1568-byte ciphertexts. All three produce 32-byte shared secrets suitable for deriving symmetric encryption keys.

ML-DSA (Module Learning with Errors Digital Signature Algorithm, formerly CRYSTALS-Dilithium) provides digital signatures based on the module learning with errors and module short integer solution problems. The three parameter sets span security levels: ML-DSA-44 provides level two security with 1312-byte public keys and 2420-byte signatures, ML-DSA-65 provides level three security with 1952-byte public keys and 3293-byte signatures, and ML-DSA-87 provides level five security with 2592-byte public keys and 4595-byte signatures.

SPHINCS+ provides stateless hash-based signatures that rely only on the security of the underlying hash function rather than structured mathematical problems. This conservative design provides security even if lattice-based cryptography is eventually broken. NØNOS implements SPHINCS+-128s, SPHINCS+-192s, and SPHINCS+-256s, where the number indicates the classical security level and the 's' suffix indicates the "simple" parameter set optimized for signature size. The implementation zeros all key material through volatile writes followed by compiler fences when keys are dropped, preventing optimization from removing security-critical clearing operations.

NTRU provides lattice-based key encapsulation through a different mathematical approach than ML-KEM, offering algorithm diversity. The implementation covers NTRU-HPS-2048-509, NTRU-HPS-2048-677, and NTRU-HPS-2048-821, where the numbers indicate polynomial degree and modulus parameters.

Classic McEliece provides code-based cryptography relying on the difficulty of decoding random linear codes, a problem studied since 1978 with no known quantum speedup. The implementation supports McEliece-348864 and McEliece-460896. Public keys are very large (approximately 255 kilobytes for McEliece-348864), limiting applicability to scenarios where key size is not constrained, but the conservative security assumptions provide strong confidence in long-term security.

#### 4.1.5 Zero-Knowledge Proof Systems

Zero-knowledge proofs enable one party to prove knowledge of information satisfying a predicate without revealing the information itself. NØNOS uses zero-knowledge proofs for boot attestation, authentication, and privacy-preserving verification across multiple domains.

Groth16 over the BLS12-381 curve provides succinct non-interactive proofs with minimal proof size and fast verification. Each proof consists of 192 bytes: two points on the G1 curve (48 bytes each after compression) and one point on the G2 curve (96 bytes after compression). Verification requires only three pairing operations, executing in constant time regardless of circuit complexity. The tradeoff is that Groth16 requires a per-circuit trusted setup ceremony that generates proving and verification keys; compromise of the toxic waste from this ceremony would enable proof forgery. NØNOS addresses this through multi-party computation ceremonies for its own circuits and careful verification key management.

The implementation enforces configurable resource limits to prevent denial of service through excessively complex circuits. The maximum constraint count defaults to one million (1,000,000), limiting circuit complexity. The maximum witness count defaults to one hundred thousand (100,000), limiting private input size. These limits can be adjusted through kernel configuration for applications requiring larger circuits.

Halo2 with KZG polynomial commitments provides an alternative proof system operating on the BN256 curve (alt_bn128). The key advantage is recursive proof composition: a Halo2 proof can verify another Halo2 proof, enabling construction of proof chains and aggregation schemes. Additionally, Halo2 with a universal reference string avoids per-circuit trusted setup, simplifying deployment of new proof circuits. The polynomial commitment scheme based on Kate-Zaverucha-Goldberg provides efficient batched verification.

Sigma protocols implement simpler zero-knowledge proofs for specific predicates. Schnorr identification proves knowledge of a discrete logarithm in a cyclic group. AND and OR composition combines sigma protocols to prove compound statements. These protocols are more efficient than general SNARK systems for simple predicates and serve as building blocks within larger cryptographic protocols.

Merkle tree membership proofs demonstrate that a value belongs to a committed set without revealing which set element. The prover provides a Merkle path from the leaf to the root, and the verifier checks hash computations along the path. This primitive enables privacy-preserving set operations: a user can prove their identity belongs to an authorized set without revealing which identity is theirs.

#### 4.1.6 Constant-Time Guarantees

All cryptographic operations that depend on secret data execute through constant-time primitives. These primitives ensure that execution time, memory access patterns, and instruction sequences are independent of secret values, eliminating timing side channels that have broken many real-world cryptographic implementations.

The constant-time comparison function ct_compare compares two byte sequences for equality, returning a boolean result. The implementation XORs corresponding bytes, ORs the results together, and performs arithmetic to collapse the accumulator to a zero or one result. All bytes are processed regardless of where a difference occurs, preventing early-exit timing leaks.

The constant-time selection functions ct_select_u8, ct_select_u32, and ct_select_u64 implement a conditional select operation equivalent to "condition ? value_a : value_b" without branching. The implementation computes a mask from the condition bit, then uses bitwise AND and XOR to select the appropriate value. The same instructions execute regardless of which value is selected.

The constant-time table lookup function ct_lookup_u8 retrieves an element from a 256-entry lookup table based on a secret index. Rather than accessing only the target index (which would reveal the index through cache timing), the implementation accesses all 256 table entries and uses conditional selection to accumulate only the desired value. This is 256 times slower than a direct access but reveals no information about the index.

The constant-time swap function ct_swap_slices conditionally swaps two byte sequences based on a secret condition bit. The implementation computes a mask from the condition, XORs corresponding bytes with their masked XOR, storing to both slices. The same memory writes occur regardless of whether a swap was performed.

Additional primitives provide constant-time less-than (ct_lt), greater-than (ct_gt), equality (ct_eq), minimum (ct_min), maximum (ct_max), bounded copy (ct_copy_bounded), HMAC verification (ct_hmac_verify), and signature verification (ct_signature_verify). Together these primitives form a complete toolkit for implementing cryptographic algorithms without timing leaks.

### 4.2 Hardware Vulnerability Mitigations

Modern processors contain microarchitectural features that can leak information across security boundaries. NØNOS implements comprehensive mitigations for all known classes of these vulnerabilities, combining hardware features where available with software countermeasures that function on all x86_64 processors.

#### 4.2.1 Spectre Mitigations

Spectre attacks exploit speculative execution to leak information across security boundaries. When the processor predicts a branch outcome and speculatively executes instructions along the predicted path, those instructions may access memory based on secret values. Even though speculative results are discarded when misprediction is detected, the memory accesses leave observable traces in cache state that an attacker can measure.

Indirect Branch Restricted Speculation (IBRS) prevents the processor from using branch predictions derived from one privilege level when executing at a different privilege level. NØNOS enables IBRS by setting bit zero of the IA32_SPEC_CTRL model-specific register at address 0x48. This write occurs during kernel entry from userspace, ensuring that user-controlled branch training cannot influence kernel indirect branch predictions.

The Indirect Branch Prediction Barrier (IBPB) provides stronger isolation by completely invalidating the branch prediction state. NØNOS issues IBPB by setting bit zero of the IA32_PRED_CMD model-specific register at address 0x49. This write occurs on context switches between processes, ensuring that one process cannot influence branch predictions for another process. The barrier is also issued when transitioning between security domains within the kernel.

Single Thread Indirect Branch Predictors (STIBP) prevents branch predictions from being shared between hardware threads (hyperthreads) on the same physical core. NØNOS enables STIBP by setting bit one of the IA32_SPEC_CTRL register. This prevents one hyperthread from training branch predictors that influence a sibling hyperthread running different security context code.

Retpoline provides software-based indirect branch isolation by converting indirect jumps and calls into return instructions. Instead of executing an indirect jmp or call that uses a potentially poisoned branch prediction, retpoline code pushes the target address onto the stack and executes a ret instruction. The return stack buffer predicts return targets differently than indirect branch predictors, and retpoline fills the return stack buffer with benign targets that capture mispredictions safely.

Return Stack Buffer (RSB) filling addresses attacks that exploit the return stack buffer itself. On context switches, NØNOS fills the RSB with 32 entries pointing to a safe speculation target. This ensures that any return misprediction during kernel execution lands in safe code rather than potentially leaking information. RSB clearing provides underflow protection by ensuring that even if many returns occur, the RSB will not underflow to attacker-controlled predictions.

Memory barriers provide explicit control over speculation. The LFENCE instruction serializes instruction execution, preventing subsequent instructions from executing speculatively until all prior instructions complete. NØNOS inserts LFENCE instructions at speculation boundaries: after loads that might depend on bounds checks, before comparisons that could leak through timing, and at other points where speculation might cross security boundaries.

Array index masking provides Spectre-safe array access. The array_index_mask_nospec function computes a mask that is all-ones if an index is within bounds and all-zeros if it is out of bounds, using arithmetic that produces the same timing regardless of input values. The array_access_nospec function combines this mask with array access to ensure out-of-bounds indices produce no useful speculation even if bounds checks are bypassed speculatively.

#### 4.2.2 Meltdown and Data Sampling Mitigations

Meltdown attacks exploit speculative execution of instructions that would fault, allowing userspace code to potentially read kernel memory. Microarchitectural data sampling attacks read stale data from processor buffers. NØNOS implements comprehensive defenses against both vulnerability classes.

Kernel Page Table Isolation (KPTI) provides the primary Meltdown defense by maintaining separate page table hierarchies for kernel and user execution. The user page tables contain only userspace mappings plus minimal kernel entry code; all other kernel memory is unmapped. When userspace executes, any attempt to access kernel addresses faults immediately rather than speculatively reading data. The kernel page tables contain full mappings for both kernel and user memory. Page table switching occurs on every privilege level transition: entering the kernel switches to kernel page tables, returning to userspace switches to user page tables.

Microarchitectural Data Sampling (MDS) attacks read data from processor-internal buffers including the load buffer, store buffer, and fill buffer. NØNOS mitigates MDS by clearing these buffers on kernel exit using the VERW instruction with an appropriate operand. The VERW instruction, when executed with specific operands on vulnerable processors, triggers a microcode assist that overwrites buffer contents. This clearing occurs before returning to userspace, preventing user code from reading stale kernel data.

L1 Data Cache Flush addresses L1 Terminal Fault and related attacks by flushing the L1 data cache when entering sensitive contexts. NØNOS issues the flush by setting bit zero of the IA32_FLUSH_CMD model-specific register at address 0x10A. This flush occurs on virtual machine entries (when running under a hypervisor), on certain context switches, and when entering regions that process particularly sensitive data.

Speculative Store Bypass Disable (SSBD) prevents the processor from speculatively forwarding store data to loads before the store address is verified. This forwarding optimization can allow speculative loads to read stale data that should have been overwritten. NØNOS enables SSBD by setting bit two of the IA32_SPEC_CTRL register, forcing the processor to wait for store address verification before forwarding.

#### 4.2.3 Mitigation Implementation

The kernel provides entry points that ensure all mitigations are properly applied during sensitive transitions.

The kernel_entry_mitigations routine executes when entering the kernel from userspace. This routine enables IBRS by writing to the IA32_SPEC_CTRL register, executes an LFENCE to serialize speculation, and performs any additional barrier sequences required by the current CPU model.

The kernel_exit_mitigations routine executes before returning to userspace. This routine performs MDS buffer clearing via VERW, switches to user page tables for KPTI, and ensures all pending stores are visible before the privilege transition.

The context_switch_mitigations routine executes when switching between processes. This routine issues IBPB to invalidate branch predictions, fills the RSB with safe return targets, flushes the L1 data cache when switching between different security domains, and updates any per-process mitigation state.

The kernel detects CPU vulnerabilities through CPUID feature flags and adjusts mitigation strategies accordingly. Runtime queries report which mitigations are active, enabling administrators to verify protection status. Per-CPU mitigation state allows asymmetric configurations on heterogeneous systems.

### 4.3 Memory Security

Memory protection prevents processes from accessing data belonging to other processes or the kernel, provides defense in depth against exploitation, and implements security features at the memory management level.

#### 4.3.1 Page Table Architecture

The x86_64 architecture uses a four-level page table hierarchy to translate virtual addresses to physical addresses. NØNOS configures this hierarchy with security as the primary consideration, trading some performance for stronger isolation.

Page table entries (PTEs) are 64-bit values containing physical frame addresses and control flags. The physical address occupies bits 12 through 51, masked by the constant 0x000F_FFFF_FFFF_F000 to extract the frame address. Control flags occupy the remaining bits.

The PRESENT flag at bit position zero indicates whether the page is mapped. Accessing a non-present page triggers a page fault. The WRITABLE flag at bit position one allows write access when set. The USER flag at bit position two allows userspace access when set; pages without this flag are accessible only from kernel mode. The WRITE_THROUGH flag at bit position three enables write-through cache policy. The CACHE_DISABLE flag at bit position four disables caching entirely. The ACCESSED flag at bit position five is set by hardware when the page is accessed. The DIRTY flag at bit position six is set by hardware when the page is written. The HUGE_PAGE flag at bit position seven enables large page sizes at the page directory and PDPT levels. The GLOBAL flag at bit position eight marks the page as global, preventing TLB flush on context switches. The NO_EXECUTE flag at bit position sixty-three prevents instruction fetch from the page.

Page permissions extend beyond the hardware flags with additional software-defined semantics. The permission bits PERM_READ, PERM_WRITE, and PERM_EXECUTE indicate the intended access rights. PERM_USER marks user-accessible pages. PERM_GLOBAL marks globally-mapped pages. PERM_NO_CACHE and PERM_WRITE_THROUGH control cache policy. PERM_COW marks copy-on-write pages that will be duplicated on write. PERM_DEMAND marks pages for demand allocation on first access. PERM_ZERO_FILL indicates pages should be zero-filled when materialized. PERM_SHARED marks pages shared between multiple address spaces. PERM_LOCKED prevents the page from being evicted. PERM_DEVICE marks device memory requiring special cache handling.

Page faults carry error codes indicating the fault cause. Bit zero distinguishes protection violations (page was present but access was denied) from non-present page faults (page was not mapped). Bit one indicates a write access. Bit two indicates a user-mode fault. Bit three indicates a reserved bit violation. Bit four indicates an instruction fetch. Bit five indicates a protection key violation. Bit six indicates a shadow stack fault.

The page table hierarchy spans four levels. The PML4 (Page Map Level 4) table contains 512 entries. Entries zero through 255 map the lower half of the address space (userspace); entries 256 through 511 map the upper half (kernel space). Each PML4 entry points to a PDPT (Page Directory Pointer Table) also containing 512 entries. Each PDPT entry points to a Page Directory with 512 entries. Each Page Directory entry points to a Page Table with 512 entries. Each Page Table entry maps a single 4 KiB page.

NØNOS supports three page sizes. Standard 4 KiB pages provide fine-grained mapping with 12-bit page offsets. Huge 2 MiB pages reduce translation overhead for large allocations, with page directory entries mapping pages directly using 21-bit offsets. Giant 1 GiB pages further reduce translation overhead for very large mappings, with PDPT entries mapping pages directly using 30-bit offsets.

#### 4.3.2 Physical Memory Allocator

The physical memory allocator manages free memory frames using a buddy allocation algorithm. This algorithm provides fast allocation and deallocation with bounded fragmentation through a hierarchical free list structure.

Memory is organized into blocks of power-of-two sizes, measured in terms of allocation order. The minimum order is twelve, corresponding to single 4 KiB pages (2^12 bytes). The maximum order is twenty, corresponding to 1 MiB blocks containing 256 pages (2^20 bytes). Nine free lists track available blocks of each order from twelve through twenty.

Allocation proceeds by finding the smallest order free list that can satisfy the request. If that list is empty, a block from a larger order is split in half repeatedly until the appropriate size is reached. The split fragments become buddies: two blocks that were created from splitting a common parent. Deallocation returns a block to its free list and attempts coalescing: if the block's buddy is also free, both are removed from the free list and merged into a block one order larger. This coalescing continues recursively until no further merges are possible.

Buddy addresses are computed through XOR arithmetic. For a block at physical address A of order O, the buddy address is A XOR (1 << O). This formula relies on the alignment properties of the buddy system: blocks are always aligned to their size.

Allocation flags modify allocator behavior. ALLOC_FLAG_ZERO (0x0001) requests that allocated memory be zeroed before return. ALLOC_FLAG_DMA (0x0002) requests memory below 4 GB suitable for DMA controllers with 32-bit address limitations. ALLOC_FLAG_UNCACHED (0x0004) requests uncached memory mapping for device communication. ALLOC_FLAG_WRITE_COMBINE (0x0008) requests write-combining cache policy for framebuffer and similar uses. ALLOC_FLAG_USER (0x0010) requests memory mappable into userspace. ALLOC_FLAG_EXEC (0x0020) requests executable memory.

#### 4.3.3 Memory Sanitization

Memory returned to the allocator may contain sensitive data from its previous use. NØNOS implements configurable sanitization to prevent information leakage through reallocated memory.

The basic sanitization level performs a single-pass zero write over the memory region. This prevents accidental leakage but does not protect against sophisticated forensic recovery techniques.

The secure sanitization level performs three passes: all zeros, all ones, then random data. This pattern addresses some hardware-level persistence effects where magnetic or flash media may retain traces of previous values.

The maximum sanitization level implements the Gutmann method with thirty-five passes using specific patterns designed to address various data encoding schemes. This level is expensive and primarily relevant for storage media rather than RAM, but is available for high-security scenarios.

Sanitization timing can be configured: immediate sanitization clears memory at deallocation time, ensuring freed memory is immediately safe. Deferred sanitization queues clearing for background processing, improving deallocation performance at the cost of a window where stale data remains in free memory.

### 4.4 Rootkit Detection

Rootkits modify kernel code and data structures to hide malicious activity and maintain persistence. NØNOS implements continuous integrity verification to detect such modifications.

#### 4.4.1 Syscall Table Integrity

The system call table maps syscall numbers to handler function addresses. A common rootkit technique replaces legitimate handler addresses with addresses of malicious code, redirecting system calls to attacker-controlled functions.

NØNOS computes a BLAKE3 hash of the syscall table immediately after boot, when the table is known to be legitimate. Periodic verification recomputes the hash and compares against the original. Any mismatch indicates syscall table modification and triggers an alert.

The verification covers not only the table entries but also the memory permissions protecting the table. The syscall table resides in read-only memory after boot; any change to page permissions for this region indicates an attack attempting to enable modification.

#### 4.4.2 IDT Integrity

The Interrupt Descriptor Table (IDT) defines handlers for CPU exceptions and hardware interrupts. Rootkits may modify IDT entries to intercept interrupt handling and filter events that would reveal their presence.

NØNOS verifies IDT integrity using the same approach as syscall table verification. A baseline BLAKE3 hash is computed after boot. Periodic verification detects modifications. The IDT entries, descriptor limits, and memory permissions are all covered by verification.

#### 4.4.3 Detection Response

When integrity verification detects modification, the system enters an alert state. The detection event is logged with full details: which structure was modified, when the modification was detected, and what verification check failed. The kernel can be configured to respond in several ways: logging only for forensic analysis, displaying a user alert for manual response, restricting functionality to prevent further compromise, or initiating immediate secure shutdown to limit damage.

### 4.5 Zero-Knowledge Identity System

The Zero-Knowledge Identity System (ZK-IDS) enables authentication without credential transmission. Users prove they possess valid credentials without sending the credentials themselves, eliminating credential theft as an attack vector.

#### 4.5.1 Identity Registration

During registration, the user generates a cryptographic identity consisting of a 32-byte identity hash (the public identity), a 32-byte Ed25519 public key (for key-based authentication), and associated capabilities (permissions granted to this identity). The identity hash derives from secret values known only to the user; these secrets are never transmitted to the authentication server.

The server stores the identity hash, public key, and capability assignment. It cannot recover the secrets underlying the identity hash because the hash is one-way. Even compromise of the server database does not reveal credentials that could be used to impersonate users.

#### 4.5.2 Authentication Protocol

Authentication proceeds through a challenge-response protocol where the user proves knowledge of secrets without revealing them.

The server initiates authentication by generating an AuthChallenge containing a 32-byte random nonce, the server's 32-byte public key for key agreement, a 64-byte Ed25519 signature binding these values, and a timestamp preventing replay. The challenge is sent to the client.

The client constructs an AuthResponse demonstrating knowledge of the identity without revealing it. The response contains the identity hash (which the server can look up but cannot use to recover secrets), a 192-byte zero-knowledge proof demonstrating knowledge of the secrets underlying the identity hash, a 32-byte response nonce, a 64-byte signature over the response, and the original challenge for binding.

The zero-knowledge proof is a Groth16 SNARK proving the statement: "I know values (secret_1, secret_2, ..., secret_n) such that BLAKE3(secret_1 || secret_2 || ... || secret_n) equals the claimed identity hash." The verifier learns that the prover knows secrets hashing to the identity hash but learns nothing about the secrets themselves.

The server verifies the proof using the Groth16 verifier, checks the signature using the registered public key, validates the timestamp to prevent replay, and confirms the nonce is fresh. Upon successful verification, the server issues an AuthSession binding the authenticated identity to a session token with an expiration time and granted capabilities.

#### 4.5.3 Security Properties

ZK-IDS provides five key security properties.

Zero-knowledge ensures the verifier learns nothing about the prover's secrets beyond the fact that valid secrets exist. The proof reveals no information usable to impersonate the prover.

Unlinkability ensures that multiple authentication sessions cannot be correlated. Each proof is generated with fresh randomness; an observer cannot determine whether two proofs were generated by the same identity.

Forward secrecy ensures that compromise of a current session does not affect past sessions. Session keys derive from ephemeral key exchanges; capturing a session key enables only access to that session.

Replay resistance ensures that captured authentication exchanges cannot be replayed. The challenge nonce, response nonce, and timestamp ensure each authentication is fresh.

Capability binding ensures that session capabilities are cryptographically bound to the authentication proof. An attacker cannot modify capabilities without invalidating the proof verification.

### 4.6 Quantum Security Engine

The Quantum Security Engine provides centralized management for post-quantum cryptographic operations, key storage, entropy management, and threat detection.

#### 4.6.1 Key Vault

The key vault provides secure storage for cryptographic keys with hardware isolation when available and strong software protection regardless.

Keys are classified by type. Signing keys support ML-DSA and SPHINCS+ digital signatures. Encryption keys support ML-KEM and NTRU key encapsulation. Derivation keys are used only for key derivation functions and never for direct cryptographic operations. Verification keys are public keys stored for verifying external signatures.

Key usage policies restrict how keys can be used. A key marked for signing cannot perform encryption operations. A key marked for encryption cannot sign data. Usage policies are cryptographically bound to keys and enforced by the vault.

Rotation policies govern key lifecycle. Time-based rotation replaces keys after a configured duration. Usage-based rotation replaces keys after a configured number of operations. Event-based rotation replaces keys when security incidents are detected. Manual rotation enables administrative key replacement.

**Planned TPM Integration:** The key vault architecture includes provisions for TPM 2.0 integration, where keys would be sealed to specific system configurations using Platform Configuration Registers (PCRs). This feature is not yet implemented in alpha; the current vault operates entirely in volatile memory with software-based protection. TPM sealing is planned for a future release.

#### 4.6.2 Entropy Management

Cryptographic security ultimately depends on unpredictable random values. The Quantum Security Engine manages entropy collection, quality verification, and distribution.

Entropy sources include hardware random number generators accessed through the RDRAND and RDSEED instructions on Intel and AMD processors, the UEFI random number protocol for firmware-provided entropy, timing jitter collected from interrupt timing variations, and TPM random number generation when available.

Quality verification ensures collected entropy meets randomness requirements. Statistical tests detect biased or correlated outputs. Entropy estimation tracks the available randomness pool. Health monitoring detects degradation in entropy source quality. Failure detection identifies entropy sources that have stopped producing valid output.

The entropy pool mixes multiple sources using cryptographic mixing functions. Even if some sources are biased or predictable, the output remains secure as long as sufficient true entropy enters the pool from any source.

#### 4.6.3 Anomaly Detection

The kernel includes heuristic-based anomaly detection for identifying potentially suspicious behavior patterns. This subsystem uses statistical thresholds and pattern matching rather than machine learning, providing deterministic and auditable detection logic.

The primary detection method analyzes data entropy to identify encrypted or compressed content in unexpected contexts. The current implementation flags data blocks exceeding 1024 bytes with entropy greater than 7.5 bits per byte, which may indicate encrypted payloads or obfuscated code. This threshold-based approach provides a baseline for detecting anomalous data patterns.

Additional heuristics monitor system call frequencies and memory allocation patterns against expected baselines. Significant deviations trigger alerts for administrator review.

**Current Limitations:** This is not an artificial intelligence or machine learning system. Detection relies on simple statistical heuristics with fixed thresholds. The system may produce false positives for legitimate high-entropy data (compressed files, media) and false negatives for sophisticated attacks that remain within statistical norms. Future versions may incorporate more sophisticated behavioral modeling.

### 4.7 Vault Subsystem

The vault subsystem provides application-level secure storage for secrets within the volatile session context. Unlike the kernel key vault which manages cryptographic keys, the vault subsystem stores arbitrary application secrets with access control and audit logging.

#### 4.7.1 Architecture

The vault comprises several integrated components. Core storage uses an isolated memory region protected from other kernel subsystems. The crypto boundary ensures all encryption and decryption occurs within the vault; plaintext secrets never cross the boundary. The policy engine evaluates access control decisions for every operation. The audit trail maintains a tamper-evident log of all vault operations using BLAKE3 hash chaining. Secure deletion uses volatile memory writes with compiler fences to ensure sensitive data is properly cleared.

#### 4.7.2 Operations

The store operation accepts a secret and access policy, encrypts the secret with vault-internal keys, applies the policy, and returns an opaque handle. The caller retains only the handle; the secret exists only within the vault.

The retrieve operation accepts a handle and authentication credentials. The vault verifies the credentials satisfy the stored policy, decrypts the secret, and returns it. Failed authentication attempts are logged.

**Note on TPM Integration:** TPM-based sealing operations (binding secrets to platform configuration) are defined in the interface but not yet implemented. The current vault operates entirely in volatile memory without hardware binding. TPM sealing is planned for a future release when TPM 2.0 driver support matures.

The destroy operation securely removes a secret from the vault. The memory is overwritten with random data, overwritten again with zeros, and verified to not contain the previous contents. The handle is invalidated and removed from the vault index.

#### 4.7.3 Security Properties

Secrets never leave the vault in plaintext except through explicitly authorized retrieve operations. All operations require authentication appropriate to the secret's policy. The audit log provides tamper-evident recording of all operations, enabling forensic analysis of secret access. Policy violations trigger automatic secret destruction when configured. Secure deletion overwrites memory using volatile writes followed by compiler fences, ensuring the compiler cannot optimize away the clearing operations.


## 5. Threat Model

### 5.1 Adversary Classes

NØNOS defends against seven distinct adversary classes, each with characteristic capabilities, objectives, and attack methods.

**Local Software Attacker**

The local software attacker executes code in userspace through some avenue: a vulnerability in an installed application, malicious code downloaded by the user, or exploitation of a network-exposed service. This adversary has the capabilities of a normal user process but seeks privilege escalation to kernel level or data exfiltration from other processes.

Mitigations include Rust memory safety eliminating buffer overflows and use-after-free vulnerabilities in kernel code, process isolation preventing direct access to other processes' memory, capability-based access control limiting what even compromised processes can attempt, Spectre mitigations preventing cross-privilege-level data leakage through speculation, address space layout randomization making exploitation more difficult, and W^X (write XOR execute) preventing code injection through writable-then-executable memory.

**Malware via Application**

Malware executing within an application context inherits that application's privileges and access. Unlike a generic local attacker, malware has persistence: it continues executing and can attempt operations repeatedly, probing for vulnerabilities over time.

Mitigations include the capability system limiting application privileges to the minimum required, syscall filtering preventing unexpected system call patterns, rootkit detection identifying attempts to modify kernel structures, and the ZeroState property ensuring malware gains no persistence beyond the current session.

**Forensic Investigator**

The forensic investigator gains physical access to hardware after a NØNOS session terminates. Their objective is reconstructing session activity: what applications ran, what data was processed, what communications occurred. This adversary has unlimited time and sophisticated equipment for examining storage media, memory chips, and firmware.

Mitigations center on the ZeroState property: since no session data is written to persistent storage under default policy, there are no artifacts to recover. The forensic investigator may learn that NØNOS was installed on the boot medium but cannot determine what occurred during any session. Memory contents are volatile and lost at power removal; cold boot attacks against RAM remanence are addressed through the fundamental architecture where RAM is the only location of sensitive data, combined with shutdown memory clearing when possible.

**Evil Maid Attacker**

The evil maid attacker has physical access to the system before and/or after a session but not during. Named for the scenario of a hotel maid accessing a laptop left in a room, this adversary can modify boot media, install hardware implants, or replace firmware. Their objective is compromising a future session or recovering data from a past session.

Mitigations include Secure Boot preventing execution of unsigned bootloaders, signature verification ensuring only authorized kernels execute, zero-knowledge attestation enabling verification of boot integrity without revealing signing keys, and the ZeroState property ensuring past sessions leave no recoverable artifacts.

**Supply Chain Attacker**

The supply chain attacker compromises NØNOS artifacts before they reach the user: modifying downloads, compromising build infrastructure, or substituting packages. This adversary never interacts with the target system directly but relies on the user installing compromised software.

Mitigations include cryptographic signature verification detecting any modification to artifacts after signing, zero-knowledge attestation enabling verification of build properties without trusting the build infrastructure, reproducible builds enabling independent verification that artifacts match source code, and distribution through multiple channels enabling cross-verification.

**Network Observer**

The network observer monitors network traffic at the ISP level, internet exchange points, or through state-level surveillance capabilities. This adversary sees all traffic entering and leaving the target network and can perform traffic analysis, content inspection of unencrypted communications, and metadata correlation.

Mitigations include onion routing hiding traffic destinations from observers, TLS encryption preventing content inspection of web traffic, no telemetry ensuring the system generates no identifying traffic, MAC address randomization preventing hardware-level identification, and DNS-over-HTTPS/TLS preventing DNS query observation.

**Future Cryptographic Attacker**

The future cryptographic attacker captures encrypted communications or data today and stores them for later decryption when quantum computers become available or cryptographic advances enable new attacks. The "harvest now, decrypt later" strategy means that long-term sensitive data must resist attacks not yet invented.

Mitigations include post-quantum algorithm support (ML-KEM, ML-DSA, SPHINCS+, NTRU, McEliece) providing protection against quantum attack, algorithm agility enabling transition to new algorithms as needed, and the ZeroState property eliminating persistent encrypted artifacts that could be harvested.

### 5.2 Attack Surfaces

NØNOS presents two primary attack surfaces corresponding to different phases of system lifecycle.

**Live Capture (Active Session)**

During active session execution, attack vectors include network exploitation through vulnerabilities in network-facing code, local malware execution through compromised applications or user action, and physical seizure of the running system.

Defenses include careful coding practices with Rust memory safety, minimal network surface exposure, capability-based isolation limiting blast radius of compromise, and runtime mitigations including rootkit detection and integrity verification. Physical seizure while running is difficult to defend completely; the attacker gains access to all volatile state. Mitigations include screen locking, encrypted swap (not used by default), and user vigilance.

**Post-Mortem (After Session)**

After session termination, attack vectors include physical access to storage media, cold boot attacks against RAM remanence, and firmware analysis.

Defenses center on the ZeroState property: no session data exists on persistent storage to recover. RAM contents are volatile and lost at power removal. Shutdown procedures clear memory when possible, reducing the cold boot window. Firmware analysis may reveal the presence of NØNOS but not session contents.

### 5.3 Trust Assumptions

Every security system rests on assumptions that must hold for guarantees to apply. NØNOS explicitly documents its trust assumptions.

First, NØNOS assumes firmware correctly implements the UEFI specification and does not contain malicious functionality. The operating system executes subordinate to firmware and cannot verify firmware integrity from that position. Users requiring firmware security must employ separate mitigations.

Second, NØNOS assumes the CPU operates according to its documented specification. Undocumented CPU behaviors could enable attacks that no software can detect or prevent.

Third, NØNOS assumes hardware random number generators provide sufficient entropy. Compromised or defective RNG hardware could undermine all cryptographic security. NØNOS mitigates this through multiple entropy sources and quality verification, but fundamentally depends on at least some hardware entropy source being genuine.

Fourth, NØNOS assumes signing keys remain uncompromised. If an attacker obtains the private keys used to sign NØNOS artifacts, they can create malicious artifacts that pass signature verification. Key management practices, HSM storage, and multi-party signing ceremonies reduce this risk.

Fifth, NØNOS assumes CPUID accurately reports CPU features. The kernel uses CPUID to determine which security features are available. A CPU that misreports features could cause the kernel to skip necessary mitigations.

### 5.4 Out of Scope

Certain threats lie outside NØNOS's defensive capabilities.

Firmware rootkits that modify UEFI or option ROM code execute before NØNOS boots and cannot be detected or prevented by the operating system. Users must employ firmware security practices separately.

Hardware implants at the chip or board level can intercept any data regardless of software protections. Nation-state level attackers with hardware manufacturing access could potentially install such implants. Defense requires hardware supply chain security beyond software scope.

Side-channel attacks beyond the scope of software mitigation, including power analysis, electromagnetic emanation, and acoustic analysis, require physical countermeasures. NØNOS mitigates software-observable side channels (timing, cache) but cannot address physical emanations.

Operator coercion through legal, physical, or social means can compel users to reveal secrets or disable protections. NØNOS provides technical protections but cannot defend against human-level attacks.


## 6. Networking Architecture

### 6.1 Network Stack Overview

NØNOS implements a complete network stack from device drivers through transport protocols to application interfaces. The stack emphasizes privacy at every layer, with onion routing integrated as a first-class transport option.

The driver layer supports common network interface controllers including Intel Gigabit Ethernet (e1000, e1000e), Intel WiFi adapters across multiple generations (device IDs including 0x2723, 0x2725, 0x34F0, 0x3DF0, 0x4DF0, 0x2729, 0x272B), Realtek Gigabit Ethernet (RTL8111/8168), and virtio network devices for virtualized environments. Driver selection occurs automatically based on PCI vendor and device identification.

The link layer handles Ethernet framing with 1500-byte MTU by default, MAC address management with randomization capability, and ARP for address resolution on local networks.

The network layer implements IPv4 and IPv6 with dual-stack capability. Routing decisions support both direct and onion-routed paths based on application policy.

The transport layer implements TCP for reliable stream communication and UDP for datagram communication. Connection state is maintained entirely in volatile memory.

### 6.2 Onion Routing Implementation

NØNOS includes a complete Tor-compatible onion routing implementation embedded in the kernel network stack. This enables strong network anonymity without requiring external software installation or configuration.

#### 6.2.1 Circuit Construction

Onion routing circuits traverse three nodes (hops) between origin and destination. The entry node (guard) sees the client's real IP address but not the destination. The middle node sees neither source nor destination. The exit node sees the destination but not the client's IP address. This three-hop architecture ensures that no single node can correlate the client with their network activity.

Circuit construction uses the ntor handshake protocol for key agreement with each hop. The client generates an ephemeral X25519 keypair for each hop, producing 84 bytes of client handshake data per hop. The node responds with 64 bytes containing its ephemeral public key and authentication. The completed handshake yields forward and backward keys for encrypting circuit traffic in both directions.

Each cell in the circuit is 509 bytes total. The cell header consumes 5 bytes: 2 bytes for circuit ID, 1 byte for command, and 2 bytes reserved for stream ID in relay cells. The payload consumes 498 bytes of effective data capacity, leaving 6 bytes for per-hop overhead.

#### 6.2.2 Encryption Layers

Circuit traffic is encrypted in layers, with each hop able to remove (for outgoing traffic) or add (for incoming traffic) one encryption layer. Outgoing cells are encrypted three times: first with the exit node's key, then with the middle node's key, then with the entry node's key. Each node decrypts one layer and forwards the result. The exit node receives plaintext destined for the final destination.

Incoming cells follow the reverse process: the exit node encrypts with its key, the middle node adds a second encryption layer, and the entry node adds a third layer. The client decrypts all three layers to recover the original data.

Encryption uses AES-128 in counter mode. Each direction of each hop maintains separate counter state. The counter mode enables efficient stream processing without the padding overhead of block cipher modes.

#### 6.2.3 Directory and Consensus

The onion network relies on directory authorities that publish signed consensus documents describing available nodes. NØNOS implements directory communication to fetch consensus documents over HTTPS connections to directory authorities, parse consensus documents to extract node information (addresses, public keys, capabilities), select nodes for circuit construction based on flags (Guard, Exit, Fast, Stable), and refresh consensus periodically to maintain current network knowledge.

Node selection applies constraints: guard nodes must have the Guard flag and sufficient uptime, exit nodes must have the Exit flag and support the required ports, and all nodes must appear in a recent consensus with valid signatures.

#### 6.2.4 Stream Multiplexing

Multiple application connections can share a single circuit through stream multiplexing. Each stream receives a unique stream ID within the circuit. Relay cells carry the stream ID, enabling the exit node to demultiplex traffic to appropriate destinations.

Stream operations include RELAY_BEGIN to establish a new stream to a destination, RELAY_DATA to carry payload data, RELAY_END to close a stream, and RELAY_CONNECTED to acknowledge successful connection.

### 6.3 DNS Privacy

Domain name resolution can leak browsing patterns to network observers. NØNOS implements encrypted DNS protocols to protect query privacy.

DNS-over-HTTPS (DoH) encapsulates DNS queries in HTTPS requests to a DoH server. The TLS encryption prevents query observation, and the HTTPS protocol makes DNS traffic indistinguishable from web browsing. NØNOS supports configurable DoH servers and includes several privacy-focused defaults.

DNS-over-TLS (DoT) provides a dedicated encrypted channel for DNS queries using TLS on port 853. This approach offers slightly lower latency than DoH but is more easily identified by network observers.

When onion routing is active, DNS resolution can route through the onion network for maximum privacy, ensuring DNS queries cannot be correlated with the client's IP address.

### 6.4 MAC Address Randomization

The MAC address is a hardware identifier that can enable device tracking across networks. NØNOS randomizes MAC addresses to prevent such tracking.

Per-session randomization generates a new random MAC address at boot. The address remains consistent throughout the session for stable network operation but differs between sessions, preventing cross-session tracking.

Per-network randomization can generate different MAC addresses for different networks, preventing correlation of activity across networks visited in the same session.

The randomized addresses are marked as locally-administered (setting the appropriate bit) to avoid conflicting with manufacturer-assigned addresses.


## 7. Onion Network Protocol Details

### 7.1 Cell Format

The fundamental unit of onion network communication is the cell, a fixed-size structure that provides traffic analysis resistance through constant-size transmission units.

Standard cells are 509 bytes total. The header begins with a 2-byte circuit identifier in big-endian byte order, enabling up to 65535 circuits per connection. The 1-byte command field indicates the cell type: PADDING (0) for link padding, CREATE (1) and CREATED (2) for circuit creation, RELAY (3) for relayed data, DESTROY (4) for circuit teardown, CREATE_FAST (5) and CREATED_FAST (6) for fast circuit creation, and RELAY_EARLY (9) for early relay cells during circuit extension.

Relay cells carry the RELAY command and contain additional header fields within the encrypted payload. After decryption at each hop, the relay header becomes visible: the 1-byte relay command, the 2-byte recognized field (zero when correctly decrypted), the 2-byte stream ID, the 4-byte digest for integrity verification, and the 2-byte data length. The remaining 489 bytes carry the relay payload.

The relay payload of 498 bytes provides the effective data capacity after accounting for the 11-byte relay header. This payload carries application data, stream management commands, and circuit extension information.

### 7.2 Handshake Protocol

Circuit creation uses the ntor handshake, a provably secure authenticated key exchange based on the Curve25519 Diffie-Hellman function.

The client begins by generating an ephemeral X25519 keypair (x, X = x·G) and fetching the router's identity key (ID) and onion key (B). The client sends a CREATE2 cell containing the router's identity digest, the client's ephemeral public key X, and an identifier binding the handshake to the circuit.

The router generates its own ephemeral keypair (y, Y = y·G) and computes the shared secret from the Diffie-Hellman exchanges: secret_input = Y·x = X·y. The router responds with Y and an authentication tag proving knowledge of the identity key.

The client verifies the authentication tag and derives circuit keys from the shared secret using HKDF-SHA256. Forward and backward keys, IVs, and digests are extracted for both the forward (client to router) and backward (router to client) directions.

The 84-byte client handshake comprises the 32-byte router identity digest and the 32-byte ephemeral public key, with additional binding data. The 64-byte server handshake comprises the 32-byte ephemeral public key and 32-byte authentication tag.

### 7.3 Directory Authority Protocol

Directory authorities are trusted servers that maintain the authoritative view of the onion network. NØNOS implements the directory protocol to maintain current network knowledge.

Consensus documents are fetched periodically from directory authorities over HTTPS. Each consensus is signed by multiple directory authorities; NØNOS verifies that a threshold of signatures is valid before accepting the document. The consensus contains router entries with IP addresses, OR ports, directory ports, identity keys, onion keys, and capability flags.

Router flags indicate node capabilities. The Guard flag indicates the node is suitable for entry position in circuits. The Exit flag indicates the node allows connections to external destinations. The Fast flag indicates sufficient bandwidth for general use. The Stable flag indicates sufficient uptime for long-lived connections. The Valid flag indicates the authorities consider the node operational.

Consensus freshness is verified through timestamp checking. Expired consensus documents are rejected, and NØNOS maintains multiple directory authority addresses to ensure consensus availability even if some authorities are unreachable.


## 8. Kernel Internal Structures

### 8.1 Boot Handoff

The bootloader passes essential system information to the kernel through a structured handoff mechanism. The BootHandoffV1 structure provides a stable interface between bootloader and kernel.

The structure begins with validation fields: a 32-bit magic number (0x4E4F4E4F, ASCII "NONO") identifies valid handoff structures, an 8-bit version number enables forward compatibility, and a 32-bit size field allows structure extension.

Flag bits indicate available subsystems. Bit 0 indicates framebuffer availability for graphics output. Bit 1 indicates ACPI table presence for hardware enumeration. Bit 2 indicates Secure Boot was active during boot, implying stronger boot chain guarantees.

Framebuffer parameters include the physical base address, horizontal and vertical resolution in pixels, pitch (bytes per row), and pixel format (bits per pixel and color channel positions).

The memory map describes physical memory regions: base address, length, and type for each region. Types distinguish usable RAM, reserved regions, ACPI tables, and memory-mapped devices.

System table pointers include the ACPI RSDP (Root System Description Pointer) address for ACPI table enumeration and the SMBIOS entry point for system inventory information.

Boot timing data records milliseconds elapsed during boot phases, enabling performance analysis and optimization. Security measurements provide BLAKE3 hashes of boot components for attestation. RNG seed material provides initial entropy from the bootloader's entropy collection.

Zero-knowledge attestation data, when present, includes the Groth16 proof block and verification key for boot integrity proofs.

The kernel entry point receives a pointer to this structure in the RDI register, following the System V AMD64 calling convention.

### 8.2 Exception Context

When an interrupt or exception occurs, the CPU pushes state onto the current stack and the kernel wraps this state in context structures for handler use.

The basic ExceptionContext captures the state pushed by the CPU: the instruction pointer (RIP) at the time of the exception, the code segment selector (CS) indicating privilege level, the stack pointer (RSP) at the time of the exception, the stack segment selector (SS), and the flags register (RFLAGS) containing condition codes and status flags.

Privilege level detection examines the two least significant bits of the code segment selector. A value of three indicates user mode execution; a value of zero indicates kernel mode execution. This detection determines whether the exception occurred in user code (requiring user-mode handling semantics) or kernel code (potentially indicating a kernel bug).

Page fault context extends the basic exception context with additional information specific to page faults. The faulting virtual address is read from the CR2 register immediately upon exception entry. The error code, pushed by the CPU for page faults, describes the fault cause through bit fields: bit 0 distinguishes protection violations (page present but access denied) from non-present page faults, bit 1 indicates a write access, bit 2 indicates user mode, bit 3 indicates reserved bit violations, bit 4 indicates instruction fetch, bit 5 indicates protection key violations, bit 6 indicates shadow stack faults, and bit 15 indicates SGX-related faults.

For full process suspension, the kernel captures all sixteen general-purpose registers (RAX through R15), the instruction pointer (RIP), and the flags register (RFLAGS). The SuspendedContext also records the suspension timestamp and the process state at suspension time.

Context switches between kernel threads use a smaller CpuContext containing only callee-saved registers (RBX, RBP, R12-R15), the instruction pointer, stack pointer, flags, and segment selectors. This minimal context suffices because calling conventions guarantee the caller has saved other registers.

### 8.3 Process Control Block

The process control block (PCB) maintains all per-process state in a comprehensive structure that the kernel references for scheduling, memory management, capability enforcement, and resource accounting.

Process identification begins with the process ID (PID), a unique identifier assigned at process creation. The thread group ID (TGID), stored atomically for lock-free reads during signal delivery, identifies the process's thread group for POSIX semantics. The parent process ID (PPID) identifies the creating process. The process group ID (PGID) and session ID (SID), both stored atomically, support job control and session management.

The process name, a string up to 256 bytes, is protected by a mutex for safe concurrent access. This name appears in process listings and debugging output.

Process state tracks lifecycle progression through seven phases. New indicates initial creation before the process is runnable. Ready indicates the process can run and awaits CPU scheduling. Running indicates current execution on a CPU. Sleeping indicates the process is waiting for an event (I/O completion, timer expiration, signal). Stopped indicates the process is suspended by job control. Zombie indicates the process has terminated but its parent has not yet collected its exit status. Terminated indicates final state after the parent has acknowledged termination. The Zombie and Terminated states carry the exit code for parent retrieval.

Memory state describes the process's virtual address space. Code segment bounds record the address range containing executable code. A vector of virtual memory areas (VMAs) describes all mapped regions, each VMA specifying start and end virtual addresses along with permission flags. The resident page count tracks physical memory consumption. The next allocation address provides a hint for efficient sequential allocations.

The capability bits field stores the process's permission mask as a 64-bit atomic value, enabling lock-free capability checks on every system call. Capability tokens derived from this field undergo Ed25519 signing for delegation to other processes.

Zero-knowledge proof statistics track cryptographic operations performed by the process: counts of proofs generated and verified, cumulative proving and verification times in milliseconds, and circuits compiled. These statistics support resource accounting and performance analysis.

The TLS base address field supports thread-local storage using the FS or GS segment bases. The stack base records the initial stack allocation for stack overflow detection. Clone flags preserve the flags from the creating clone syscall, documenting how the process was created. The start time captures process creation in milliseconds since boot.

The file descriptor table, protected by a read-write lock, maps file descriptor numbers to open file handles. The current working directory and umask, each mutex-protected, provide filesystem context for relative path resolution and permission defaults.

Process isolation defaults configure security boundaries. By default, new processes receive maximum restriction: network access disabled, filesystem access disabled, IPC disabled, device access disabled, and memory isolation enabled. Capabilities must be explicitly granted to enable access to protected functionality.

### 8.4 Scheduler

The scheduler determines which process runs on each CPU, balancing responsiveness, throughput, and fairness while respecting priority and affinity constraints.

Six priority levels span the scheduling spectrum. Idle (level 0) runs only when no other work is available, suitable for background maintenance tasks. Low (level 1) accommodates work that should complete eventually but shouldn't interfere with interactive tasks. Normal (level 2) provides the default for typical applications. High (level 3) accommodates latency-sensitive tasks. Critical (level 4) provides near-real-time scheduling for time-critical operations. RealTime (level 5) provides the highest scheduling priority for tasks with strict timing requirements.

Module priority mapping converts the 8-bit priority value from module manifests to the six-level enumeration. Values 0-50 map to Low, 51-100 map to Normal, 101-150 map to High, 151-200 map to Critical, and values above 200 map to RealTime.

Each priority level maintains a run queue implemented as a double-ended queue (deque). Runnable tasks enter at the back of their priority queue. The scheduler selects tasks from the front of the highest-priority non-empty queue, providing FIFO ordering within each priority level and strict priority ordering between levels.

Task entries carry scheduling metadata. A unique task identifier enables task lookup and management. The static name string identifies the task for debugging. An optional function pointer provides the entry point for kernel tasks. The priority assignment determines queue placement. The CPU affinity mask constrains which CPUs can run the task; the default affinity permits execution on CPUs 0 through 15. A completion flag indicates when the task has finished. An optional module identifier associates module-spawned tasks with their creating module.

Scheduling statistics use atomic counters to track scheduler behavior. Context switches counts voluntary and involuntary context switches. Preemptions counts tasks displaced by higher-priority arrivals. Voluntary yields counts tasks that surrendered CPU voluntarily. Wakeups counts tasks transitioning from sleeping to ready. Timer ticks counts scheduler invocations from the timer interrupt. Time slice exhaustions counts tasks that used their full time quantum.

### 8.5 System Call Interface

System calls provide the kernel interface for user processes. NØNOS implements Linux-compatible system call numbers for common operations while extending the interface with NØNOS-specific functionality.

The calling convention follows Linux x86_64 ABI. The system call number is placed in the RAX register before invocation. Arguments occupy registers RDI, RSI, RDX, R10, R8, and R9 in that order (note R10 replaces RCX, which the SYSCALL instruction clobbers). Upon return, RAX contains either a non-negative success value or a negated errno code indicating failure. The kernel does not clobber callee-saved registers, ensuring user code can rely on register preservation across system calls.

Two entry mechanisms are supported. The SYSCALL instruction provides fast system call entry on all x86_64 CPUs. The legacy INT 0x80 software interrupt provides backward compatibility with code expecting the 32-bit interface.

System call numbers 0 through 334 mirror the Linux x86_64 ABI for toolchain compatibility. This includes file operations (read at 0, write at 1, open at 2, close at 3), memory operations (mmap at 9, mprotect at 10, munmap at 11, brk at 12), process operations (fork at 57, execve at 59, exit at 60, exit_group at 231), socket operations (socket at 41, connect at 42, accept at 43), and numerous other interfaces.

NØNOS extends the system call table with custom operations in reserved ranges. IPC primitives occupy numbers 800-803 for inter-process communication beyond POSIX mechanisms. Cryptographic operations occupy numbers 900-908 for direct kernel cryptographic services. Hardware access operations occupy numbers 1000-1002 for controlled port I/O and memory-mapped device access. Debug facilities occupy numbers 1100-1101 for tracing and diagnostic operations. Administrative functions occupy numbers 1200-1204 for system configuration and management.

Each system call handler returns a SyscallResult structure containing the return value (success value or negated errno), a flag indicating whether a capability token was consumed during the call, and a flag indicating whether the call was recorded in the audit log. Error codes follow POSIX conventions: EPERM (1) for permission denial when capabilities are insufficient, ENOENT (2) for missing resources or paths, ENOMEM (12) for allocation failure, EACCES (13) for access violations independent of capabilities, EFAULT (14) for invalid user-provided pointers, EINVAL (22) for invalid arguments, and ENOSYS (38) for unimplemented system calls.


## 9. Capability System

### 9.1 Capability Types

The capability system governs access to kernel services through ten capability types, each controlling a distinct functional domain.

CoreExec (bit 0) authorizes process lifecycle operations: fork, clone, execve, exit, and related calls. Without CoreExec, a process cannot create child processes or replace itself with a new program image.

IO (bit 1) authorizes data transfer operations: read, write, lseek, and related calls. Without IO capability, a process cannot perform file or device I/O even if it has open file descriptors.

Network (bit 2) authorizes socket operations: socket, connect, accept, bind, listen, and related calls. Without Network capability, a process cannot communicate over the network.

IPC (bit 3) authorizes inter-process communication beyond basic file descriptors: shared memory, message queues, semaphores, and NØNOS-specific IPC primitives.

Memory (bit 4) authorizes address space manipulation: mmap, munmap, mprotect, and related calls that modify the process's virtual memory layout.

Crypto (bit 5) authorizes cryptographic system calls that access kernel cryptographic services directly rather than through library implementations.

FileSystem (bit 6) authorizes filesystem operations: open, close, mkdir, rmdir, unlink, and related calls that create, destroy, or enumerate filesystem objects.

Hardware (bit 7) authorizes hardware access: iopl, ioperm for port I/O, and memory-mapped I/O for direct device communication.

Debug (bit 8) authorizes debugging operations: ptrace for process tracing, debug register access, and diagnostic interfaces.

Admin (bit 9) authorizes administrative operations: mount, umount, reboot, module loading, and system configuration changes.

### 9.2 Capability Token

Capability tokens enable permission delegation between processes without kernel involvement in every authorization decision.

A token contains the owning module identifier (an 8-byte value identifying the creating module), a vector of granted capabilities (a subset of the module's own capabilities), an optional expiration timestamp in milliseconds since boot, a 32-byte nonce ensuring uniqueness and preventing replay, and a 64-byte Ed25519 signature binding all fields.

Token creation begins with the granting process specifying which capabilities to include (limited to capabilities the granting process itself holds) and an optional expiration time. The kernel generates a random nonce, constructs the token fields, computes the Ed25519 signature using a kernel signing key, and returns the complete token.

Token validation checks expiration against the current time, verifies the signature against the kernel's public key, and confirms at least one capability is granted. Valid tokens can be presented with system calls to authorize operations the presenting process would not otherwise be permitted.

The default token expiration is 86,400,000 milliseconds (one day), balancing security (limiting exposure from token theft) against usability (not requiring frequent reauthorization).

### 9.3 Capability Requirements by System Call

System call dispatch checks capabilities before invoking handlers. Each system call category requires specific capabilities.

File data operations (read, write, lseek, pread, pwrite) require IO capability. File object operations (open, close, stat, fstat, access) require FileSystem capability. Directory operations (mkdir, rmdir, opendir, readdir) require FileSystem capability. Memory mapping operations (mmap, munmap, mprotect, brk) require Memory capability. Process creation operations (fork, clone, vfork) require CoreExec capability. Program execution (execve, execveat) requires CoreExec capability. Socket creation and connection (socket, connect, bind, listen, accept) require Network capability. Process debugging (ptrace, process_vm_readv, process_vm_writev) requires Debug capability. Port I/O (iopl, ioperm) requires Hardware capability. System administration (mount, umount, reboot, init_module) requires Admin capability. Cryptographic system calls require Crypto capability.

System calls without capability requirements include those that query process state (getpid, getuid), those that yield CPU (sched_yield, nanosleep), and those that exit (exit, exit_group).


## 10. Filesystem Architecture

### 10.1 Virtual Filesystem Layer

The virtual filesystem (VFS) layer provides a uniform interface above filesystem-specific implementations. All filesystem operations pass through VFS, which translates generic operations to implementation-specific calls.

The inode structure represents filesystem objects in memory. Each inode contains a 64-bit inode number (unique within the filesystem), a 32-bit mode (combining type and permission bits), a 32-bit link count, 32-bit user and group IDs, a 64-bit size in bytes, 64-bit timestamps for access, modification, and status change, and a 64-bit block count.

File types are encoded in the mode field's upper bits. Regular files use S_IFREG (0o100000). Directories use S_IFDIR (0o040000). Symbolic links use S_IFLNK (0o120000). Character devices use S_IFCHR (0o020000). Block devices use S_IFBLK (0o060000). Named pipes (FIFOs) use S_IFIFO (0o010000). Sockets use S_IFSOCK (0o140000).

Permission bits occupy the mode field's lower twelve bits. The owner read/write/execute bits occupy positions 8, 7, and 6. Group bits occupy positions 5, 4, and 3. Other bits occupy positions 2, 1, and 0. The setuid, setgid, and sticky bits occupy positions 11, 10, and 9.

### 10.2 RAM Filesystem

Under default ZeroState policy, the root filesystem is a RAM-based filesystem that exists entirely in volatile memory. This filesystem provides full POSIX semantics while maintaining the ZeroState property: nothing is written to persistent storage.

The RAM filesystem allocates inode and data structures from the kernel heap. File contents reside in dynamically allocated buffers that grow and shrink with file size. Directory entries are maintained in in-memory hash tables for efficient lookup.

RAM filesystem capacity is limited by available memory. The kernel can reserve a portion of RAM for filesystem use, or allow the filesystem to compete for memory with other allocations. Memory pressure handling can evict cached filesystem data that can be regenerated, but active file contents must be retained.

### 10.3 Storage Filesystem Support

When users explicitly enable persistence for specific purposes, NØNOS supports mounting external filesystems.

The ext4 filesystem implementation supports reading and writing to Linux-compatible ext4 filesystems on attached storage devices. This enables interoperability with Linux systems and access to files on removable media formatted with ext4.

FAT32 support enables access to USB drives and memory cards formatted with the widely-compatible FAT32 filesystem.

Filesystem mounting requires Admin capability and explicit user action. The mounted filesystem appears in the VFS namespace, but operations on the mounted filesystem do constitute persistent writes, breaking the ZeroState property for those specific operations. User interface indicators clearly show when persistence is active.


## 11. Device Driver Architecture

### 11.1 Driver Model

NØNOS implements a modular driver architecture where device drivers register with the kernel to handle specific hardware.

Device enumeration occurs during boot through ACPI table parsing (for platform devices) and PCI bus scanning (for PCI devices). Each discovered device is matched against registered drivers using vendor ID, device ID, and device class.

Driver registration includes a name string identifying the driver, a list of supported device IDs, probe and remove functions for device lifecycle, and operation functions for device-specific functionality.

The probe function is called when a matching device is discovered. The driver initializes the device, allocates necessary resources, and registers device-specific interfaces. The remove function handles device removal or driver unload, releasing resources and unregistering interfaces.

### 11.2 Storage Drivers

NØNOS supports multiple storage interface standards for broad hardware compatibility.

The AHCI driver supports SATA devices through the Advanced Host Controller Interface. AHCI provides a standardized register interface that most modern SATA controllers implement. The driver handles command queuing, interrupt handling, and error recovery for attached SATA drives.

The NVMe driver supports NVM Express solid-state drives through their native interface. NVMe provides significantly higher performance than AHCI through deeper command queues, reduced latency, and parallelism. The driver manages submission and completion queue pairs, handles interrupts through MSI-X, and supports multiple namespaces on a single controller.

The VirtIO block driver supports paravirtualized storage in virtual machine environments. VirtIO provides efficient virtualized I/O through shared memory rings and notification mechanisms, avoiding the overhead of emulating physical hardware.

USB mass storage support enables access to USB flash drives and external hard drives through the USB mass storage class protocol layered over SCSI commands.

### 11.3 Network Drivers

Network driver support determines which hardware can connect NØNOS to networks.

The Intel e1000 and e1000e drivers support Intel Gigabit Ethernet controllers across multiple generations. These drivers handle common integrated and discrete Intel NICs found in desktop and laptop systems.

The Intel WiFi driver supports Intel wireless adapters with multiple device IDs including 0x2723, 0x2725, 0x34F0, 0x3DF0, 0x4DF0, 0x2729, and 0x272B. The driver implements 802.11 association, WPA2/WPA3 authentication, and frame transmission/reception.

The Realtek driver supports RTL8111/8168 Gigabit Ethernet controllers commonly found in desktop motherboards and some laptops.

The VirtIO network driver supports paravirtualized networking in virtual machines with the same efficiency benefits as VirtIO storage.

### 11.4 Input Drivers

Input drivers provide keyboard and mouse support for user interaction.

The PS/2 keyboard driver handles the legacy PS/2 keyboard interface still present on many systems. The driver processes keyboard scan codes, maintains key state, and generates input events for the input subsystem.

The PS/2 mouse driver handles PS/2 mouse input including motion, button clicks, and scroll wheel events.

USB HID support provides keyboard and mouse functionality for USB-connected input devices through the USB Human Interface Device class protocol.

### 11.5 Graphics Drivers

Graphics output enables the desktop environment and visual user interface.

The UEFI GOP (Graphics Output Protocol) driver uses the framebuffer established during boot for graphics output. This provides basic graphics capability on any UEFI system without requiring hardware-specific drivers.

VBE (VESA BIOS Extensions) support provides legacy graphics capability on systems without UEFI GOP.

Hardware-accelerated drivers for specific GPUs can provide enhanced graphics performance when available.


## 12. Module System

### 12.1 Module Manifest

Loadable modules extend kernel functionality while maintaining security boundaries through manifest-declared requirements and capability constraints.

The module manifest structure declares module metadata and requirements. The name field identifies the module for loading and dependency resolution. The version string enables version checking and compatibility verification. The author field documents module provenance. The description provides human-readable module purpose.

The module type classification determines available privileges. System modules receive elevated privileges for core functionality. User modules operate with restricted access appropriate for applications. Driver modules receive hardware access for device support. Service modules provide background services. Library modules provide shared functionality to other modules.

The privacy policy controls state handling. ZeroStateOnly modules operate purely in RAM with explicit zeroing on exit, maintaining the strongest privacy guarantees. Ephemeral modules lose state on exit without explicit zeroing. EncryptedPersistent modules may use encrypted persistent storage for specific needs. None imposes no privacy restrictions.

Memory requirements specify resource constraints. Minimum and maximum heap sizes bound dynamic allocation. Stack size specifies thread stack allocation. DMA memory requirements reserve appropriate memory for hardware access.

Requested capabilities enumerate the module's permission requirements. The loader validates that requested capabilities are permissible for the module type and that granting them does not violate security policy.

The attestation chain provides cryptographic provenance. Each chain entry contains a 32-byte Ed25519 public key, a 64-byte signature, and a timestamp. The chain links the module to its signers through verifiable signatures.

### 12.2 Module Loading

Module loading validates security properties before granting execution privileges.

The load request includes the module name, code bytes, optional parameters, optional Ed25519 signature and public key for traditional verification, and optional post-quantum signature and public key for ML-DSA-65 verification.

Signature verification confirms the module code has not been modified since signing. The loader computes a BLAKE3 hash of the module code and verifies the signature over this hash. If both traditional and post-quantum signatures are provided, both must verify.

Manifest validation confirms the declared properties are consistent and permissible. The loader checks that requested capabilities are valid for the module type, that memory requirements are within system limits, and that the privacy policy is appropriate.

Hash verification confirms the manifest's code hash matches the computed hash. This binding ensures the manifest applies to the specific code being loaded.

Policy enforcement applies system-wide constraints. Administrator-configured policies may restrict which modules can load, what capabilities they can request, and what resources they can consume.

Upon successful validation, the module receives a unique identifier, its memory is allocated according to manifest requirements, and its entry point is invoked to begin execution.

### 12.3 Module Unloading

Module unloading ensures clean termination and prevents information leakage.

The module's cleanup entry point is invoked, allowing orderly shutdown of module functionality. Resources allocated by the module are freed. Capability tokens issued by the module are invalidated.

Secure erasure clears module memory to prevent information recovery. For modules with sensitive data, the erasure uses volatile writes that cannot be optimized away, followed by compiler fences that prevent instruction reordering. The memory is then verified to not contain recognizable module data.

The module's identifier is released for potential reuse. The module's registration is removed from the kernel's module table.


## 13. Application Environment

### 13.1 Process Model

NØNOS provides a process model enabling concurrent application execution with isolation and controlled communication.

Each process executes in a private virtual address space. The page table hierarchy ensures processes cannot access each other's memory without explicit sharing through kernel interfaces. Address space layout randomization positions code, data, heap, and stack at randomized addresses, complicating exploitation.

Processes may contain multiple threads sharing the same address space. Thread creation uses the clone system call with appropriate flags for shared memory but separate stacks and thread-local storage. The thread-local storage base address is set per-thread using the FS segment base.

Process creation through fork produces a copy of the calling process. Copy-on-write optimization defers physical page duplication until write access occurs. The child process receives a new PID and PPID (set to the parent's PID) but otherwise inherits the parent's state.

Program execution through execve replaces the process's address space with a new program image. The executable is loaded, memory mappings are established, and execution transfers to the program's entry point. Capabilities can be adjusted during exec based on the executable's requirements and system policy.

### 13.2 Desktop Environment

NØNOS includes a complete desktop environment with full graphical rendering, providing a polished user interface for daily computing tasks.

**Desktop Shell:**

The desktop shell renders directly to the framebuffer with a modern glass-effect aesthetic. The implementation includes a top menu bar displaying the system clock, date, brand logo, settings access, network status indicator, battery level, notification bell, search icon, and user avatar with online status. The menu bar updates dynamically to reflect real system state including actual network connectivity and time.

A dock at the bottom of the screen provides quick access to applications. Nine application icons render with detailed pixel art including terminal, file manager, text editor, calculator, wallet, process manager, settings, browser, and about dialog. Each icon features gradient shading, rounded plate backgrounds, and distinct visual designs. Active application indicators appear beneath running applications. Clicking dock icons launches the corresponding application.

**Rendering Implementation:**

The graphics subsystem implements software rendering with alpha blending, gradient fills, and anti-aliased shapes. Rounded rectangles use per-pixel distance calculations for smooth corners. Drop shadows employ multi-layer alpha gradients. Icon rendering includes detailed artwork: the terminal icon shows a miniature terminal window with colored title bar buttons and blinking cursor, the folder icon displays a 3D folder with tab and shadow, the gear icon renders with calculated tooth geometry.

Color management uses a premium dark glass palette with cyan accent colors (0xFF00D4FF), providing visual consistency across all interface elements. The background uses semi-transparent dark tones (0xE8101418) creating depth without obscuring content.

**Input Handling:**

Mouse click events route through the desktop components. The menu bar handles clicks on the settings area to open the settings window. The dock handles clicks on application icons, calculating hit regions for each icon and invoking the window manager to open the corresponding application. The sidebar handles navigation clicks.

**Window Management:**

The window system supports multiple concurrent windows with title bars, close buttons, and content areas. Windows can be opened, closed, and receive focus. Each window type (Terminal, FileManager, TextEditor, Calculator, Wallet, ProcessManager, Settings, Browser, About) has dedicated rendering and functionality.

### 13.3 Native Applications

NØNOS includes essential applications for a functional computing environment.

The terminal emulator provides command-line access for advanced users and administrative tasks. Shell commands execute within the terminal, providing text-mode interaction with the system.

The file manager provides graphical filesystem navigation. Users can browse directories, view file properties, and perform file operations through a visual interface. The file manager clearly distinguishes RAM filesystem contents (ephemeral) from any mounted persistent storage.

The web browser provides internet access through a privacy-focused implementation. Default settings route traffic through the onion network, block tracking scripts, and prevent fingerprinting. Users can adjust privacy settings for specific needs.

The text editor provides basic text editing capability for configuration files, notes, and simple document creation.

Additional applications can be loaded as modules, extending functionality while maintaining the system's security properties.


## 14. Logging and Diagnostics

### 14.1 Log Levels

The logging subsystem categorizes messages by severity to enable appropriate filtering and handling.

Debug level (lowest severity) provides detailed information useful during development and troubleshooting. These messages include internal state details, execution traces, and verbose diagnostic output. Debug messages are typically disabled in production.

Info level provides operational information about normal system events. Service startup, configuration loading, and routine operations generate Info messages. These messages confirm the system is operating correctly.

Warn level indicates recoverable anomalies that may warrant attention. Unexpected but handled conditions, deprecated feature usage, and near-limit resource consumption generate Warn messages. The system continues operating but the condition may indicate developing problems.

Err level indicates failures that prevent a requested operation from completing. I/O errors, invalid requests, and resource exhaustion generate Err messages. The specific operation fails but the system continues running.

Fatal level indicates unrecoverable conditions requiring system termination. Kernel data structure corruption, critical hardware failure, and security violations generate Fatal messages. The system will halt after logging.

Each level has a display tag (DEBUG, INFO, WARN, ERROR, FATAL) and an associated VGA color for visual distinction when messages appear on screen.

### 14.2 Log Destinations

Log output reaches three destinations to ensure message delivery under various conditions.

Serial output writes to COM1 (port 0x3F8) configured at 115200 baud. Serial logging provides reliable output that can be captured by external systems even during graphics failures or kernel panics. Serial output begins operating very early in boot before other subsystems initialize.

VGA output writes directly to the text buffer at physical address 0xB8000. Screen display provides immediate visibility for messages during interactive use. Colors indicate severity: white for Info, yellow for Warn, red for Err and Fatal.

A RAM ring buffer captures recent messages for programmatic access. The ring buffer enables log examination after the fact without requiring serial capture. Post-mortem debugging can examine the ring buffer to understand events leading to a crash.

### 14.3 Exception Logging

Exception handlers log context information to aid debugging.

The logged information includes the exception name (e.g., "Page Fault", "General Protection"), the instruction pointer (RIP) where the exception occurred, the code segment (CS) indicating privilege level, the stack pointer (RSP), and the flags register (RFLAGS).

Page fault handlers log additional context: the faulting virtual address from CR2, and the error code bits indicating whether the fault was a protection violation or non-present page, whether it was a read or write, and whether it occurred in user or kernel mode.

### 14.4 Panic Handling

The panic handler provides consistent termination when unrecoverable errors occur.

Panic writes a tagged message to serial output, ensuring the panic reason is captured even if display output fails. The message includes the source file and line number where panic was triggered, plus any message provided by the panic caller.

Panic then displays the information on VGA if available, using a red background to ensure visibility.

Finally, panic enters an infinite halt loop. The CPU executes HLT instructions repeatedly, reducing power consumption while preventing further execution of potentially corrupted code.

### 14.5 Out-of-Memory Handling

Memory allocation failures receive special handling due to their severity.

The out-of-memory handler logs the allocation request size and alignment to serial, providing diagnostic information for debugging memory exhaustion.

A VGA error display shows the allocation failure prominently, using a red background similar to panic.

The handler then halts, as continued operation without memory is generally impossible and attempting it risks corruption.

Early boot errors before heap availability use a stack-allocated buffer and direct VGA writes, enabling error reporting even when dynamic allocation is unavailable.


## 15. ABI Stability

### 15.1 Stable Interfaces

Certain interfaces carry compatibility guarantees across minor version releases. Code depending on stable interfaces can expect continued functionality without modification.

System call numbers 0 through 334 remain stable for Linux compatibility. These numbers and their associated semantics match the Linux x86_64 ABI, enabling applications compiled for Linux to function on NØNOS for the implemented subset of calls.

Process state enumeration values remain stable. The numeric values assigned to New, Ready, Running, Sleeping, Stopped, Zombie, and Terminated states will not change, enabling persistent process state inspection tools.

Capability bit assignments remain stable. The mapping of capability types to bit positions in the capability mask will not change, enabling binary-compatible capability checking.

Errno values remain stable. The numeric error codes follow POSIX conventions and will not change.

Trap frame field ordering remains stable. The ExceptionContext, SuspendedContext, and CpuContext structures maintain consistent field layouts for debugger compatibility.

### 15.2 Unstable Interfaces

Certain interfaces may change between any releases and should not be relied upon for binary compatibility.

NØNOS-specific system calls numbered 800 and above carry no stability guarantee. These interfaces may change semantics, arguments, or numbers between releases.

Process control block field offsets may change. Code directly accessing PCB fields by offset must be recompiled for each release.

Module manifest format may change. Module manifests are validated at load time, and changes to format or semantics will be documented in release notes.

Capability token serialization may change. Tokens should not be stored persistently or transmitted between systems running different NØNOS versions.

### 15.3 Versioning Policy

Major version increments (e.g., 1.0 to 2.0) may break any interface, stable or unstable. Major releases document all breaking changes.

Minor version increments (e.g., 1.0 to 1.1) preserve all stable interfaces. Unstable interfaces may change with documentation.

Patch version increments (e.g., 1.0.0 to 1.0.1) preserve all interfaces and contain only bug fixes.

Deprecated interfaces receive runtime warnings for one minor version before removal. This provides migration time for code depending on deprecated functionality.

### 15.4 ABI Guarantees

All ABI-critical structures use the `#[repr(C)]` attribute ensuring deterministic field ordering across compiler versions. Structure sizes and field offsets are documented and tested. Padding is explicit rather than implicit to prevent layout surprises.


## 16. Comparative Analysis

### 16.1 Privacy Operating Systems

NØNOS occupies a unique position in the landscape of privacy-focused operating systems. A detailed comparison illuminates the distinctions.

Tails (The Amnesic Incognito Live System) provides ephemeral operation by running entirely from removable media. Like NØNOS, Tails aims to leave no trace on the host system. However, Tails is built on Debian Linux, inheriting that system's complexity and attack surface. Tails routes traffic through Tor but does not integrate Tor into the kernel networking stack. Tails lacks post-quantum cryptography, zero-knowledge proof systems, and kernel-level rootkit detection.

Whonix provides anonymity through a two-VM architecture: a gateway VM running Tor and a workstation VM whose traffic is forced through the gateway. This architecture provides strong isolation between the user environment and Tor routing. However, Whonix runs on top of a general-purpose OS in each VM, inheriting the full attack surface of those operating systems. Whonix does not provide the ZeroState property; both VMs maintain persistent state.

Qubes OS provides security through compartmentalization, running different activities in separate VMs. This isolation limits the impact of compromise in any single VM. However, Qubes relies on Xen virtualization and multiple Linux VMs, creating a large trusted computing base. Qubes does not specifically target forensic resistance or ephemeral operation.

OpenBSD prioritizes security through careful code review, proactive security features, and minimal default attack surface. OpenBSD pioneered many security innovations that other systems later adopted. However, OpenBSD is a general-purpose Unix and does not focus on forensic resistance or privacy-specific features.

NØNOS combines comprehensive security features in a single unified design: native ZeroState ephemeral execution without depending on external OS, kernel-integrated onion routing, post-quantum cryptography, zero-knowledge proofs, comprehensive hardware vulnerability mitigations, and runtime rootkit detection.

### 16.2 Feature Comparison Table

| Feature | NØNOS | Tails | Whonix | Qubes | OpenBSD |
|---------|-------|-------|--------|-------|---------|
| Native ZeroState | Yes | Partial | No | No | No |
| Kernel onion routing | Yes | No | No | No | No |
| Post-quantum crypto | Full suite | No | No | No | No |
| ZK proof systems | Groth16, Halo2 | No | No | No | No |
| Memory-safe kernel | Yes (Rust) | No (C) | No (C) | Partial | No (C) |
| Spectre mitigations | Comprehensive | Partial | Partial | Partial | Partial |
| ZK authentication | Yes (ZK-IDS) | No | No | No | No |
| Rootkit detection | Runtime | No | No | No | No |
| TPM integration | Partial | No | No | Optional | Yes |
| Capability system | Full | No | No | Partial | Partial |
| Constant-time crypto | All operations | Partial | Partial | Partial | Partial |
| Memory sanitization | Gutmann option | Basic | Basic | Basic | Basic |

The table demonstrates NØNOS's comprehensive approach to privacy and security. While other systems excel in specific areas—Tails in ease of ephemeral use, Whonix in anonymity architecture, Qubes in compartmentalization, OpenBSD in code quality—NØNOS uniquely combines all these properties in a ground-up design.


## 17. Hardware Requirements

### 17.1 Minimum Requirements

NØNOS operates on systems meeting the following minimum specifications.

An x86_64 processor with SSE2 support is required. The x86_64 (AMD64/Intel 64) instruction set is mandatory; 32-bit x86 processors are not supported. SSE2 instructions are used for certain optimized operations and must be available.

Two gigabytes of RAM provides minimal functional capacity. With limited RAM, the system can boot and run simple applications but will be constrained in capability. Larger applications, multiple concurrent programs, or significant filesystem contents will require more memory.

UEFI 2.0 firmware is required for boot. Legacy BIOS boot is not supported. UEFI provides the Graphics Output Protocol for display, the Random Number Protocol for entropy, and the boot services through which NØNOS loads.

USB boot support enables booting from USB drives, the typical deployment method for NØNOS. The system can also boot from internal storage if UEFI supports the storage interface.

### 17.2 Recommended Specifications

Optimal NØNOS operation benefits from enhanced hardware.

An x86_64 processor with RDRAND and RDSEED instructions provides hardware random number generation essential for cryptographic security. Most Intel processors from Ivy Bridge (2012) onward and AMD processors from 2015 onward include these instructions.

Eight gigabytes of RAM provides comfortable capacity for the desktop environment, web browsing, multiple applications, and a reasonable RAM filesystem.

TPM 2.0 (Trusted Platform Module) enables hardware-backed key storage, sealed secrets, and enhanced boot integrity verification. While NØNOS functions without TPM, its presence enables additional security features.

Intel or Realtek network interface controllers have well-tested driver support. Other NICs may function but receive less extensive testing.

Intel WiFi adapters are recommended for wireless networking. The specific device IDs with verified support include 0x2723, 0x2725, 0x34F0, and others in the Intel AX/AX200/AX201/AX210 families.


## 18. Development Status

### 18.1 Implemented Features

NØNOS alpha implements a comprehensive feature set.

The boot chain provides Ed25519 signature verification and optional Groth16 zero-knowledge attestation of boot integrity. The bootloader initializes hardware, loads the kernel, and transfers control through the documented handoff interface.

Memory management includes a buddy allocator for physical frames, a four-level paging implementation with KASLR, guard pages for stack overflow detection, and comprehensive allocation flags for various memory types.

Process isolation with capabilities provides the security foundation. Each process operates in its private address space with its assigned capability bits governing permitted operations.

The scheduler supports six priority levels with per-priority run queues, CPU affinity, and comprehensive statistics tracking.

Storage support covers AHCI (SATA), NVMe (native SSD), VirtIO (virtualization), and USB mass storage, providing broad device compatibility.

Network support includes TCP/IP implementation and kernel-integrated onion routing with three-hop circuits, ntor handshakes, and directory consensus handling.

Classical cryptography includes AES-GCM, ChaCha20-Poly1305, BLAKE3, SHA-3, Ed25519, and X25519 with constant-time implementations throughout.

Post-quantum cryptography includes ML-KEM across three security levels, ML-DSA across three parameter sets, SPHINCS+ for hash-based signatures, NTRU for lattice-based KEMs, and Classic McEliece for code-based cryptography.

Zero-knowledge proof systems include Groth16 over BLS12-381 and Halo2 with KZG commitments.

Hardware vulnerability mitigations include IBRS, IBPB, STIBP for Spectre variants, SSBD for speculative store bypass, MDS buffer clearing, L1D cache flush, and RSB filling.

Security features include rootkit detection through syscall table and IDT integrity verification, ZK-IDS for zero-knowledge authentication, the vault subsystem for in-memory secret storage with secure deletion, and the Quantum Security Engine for key and entropy management.

The desktop environment provides a complete graphical interface with dock, menu bar, window management, and native applications.

### 18.2 Partially Implemented Features

TPM 2.0 integration has driver infrastructure but PCR-based sealing operations are not yet functional. The vault currently operates without hardware binding.

### 18.3 In-Progress Features

Several features are under active development for completion before the stable release.

Full ext4 filesystem support will enable mounting Linux-formatted storage for file exchange.

Full-disk encryption will provide an option for users who need to store encrypted data on persistent media while maintaining awareness that this exits ZeroState mode.

WiFi driver expansion will broaden wireless hardware compatibility.

Hardware wallet integration will enable cryptographic key storage in dedicated security hardware.

### 18.4 Planned Features

Future development phases will address additional capabilities.

ARM64 support will enable NØNOS on ARM-based systems including recent Apple hardware and single-board computers.

Secure enclave integration will leverage Intel SGX or AMD SEV where available for enhanced isolation.

Mobile device support will address smartphone and tablet form factors, significantly expanding the user base for privacy-focused computing.


## 19. Glossary

**AES-GCM:** Advanced Encryption Standard in Galois/Counter Mode. AES provides the symmetric encryption with 128, 192, or 256-bit keys. GCM provides authenticated encryption, combining confidentiality with a 128-bit authentication tag that detects any modification to ciphertext or associated data. NØNOS uses AES-GCM for general-purpose authenticated encryption needs.

**BLAKE3:** A cryptographic hash function designed for speed and security. BLAKE3 processes data in 64-byte blocks using a compression function based on ChaCha. The algorithm produces 256-bit digests by default but supports arbitrary output lengths. BLAKE3 serves as the primary hash function throughout NØNOS for integrity verification, key derivation, and general hashing.

**BLS12-381:** A pairing-friendly elliptic curve used for zero-knowledge proofs. The curve provides approximately 128 bits of security and supports efficient pairing operations required for Groth16 proof verification. The name indicates the embedding degree (12) and field size (381 bits).

**ChaCha20-Poly1305:** An authenticated encryption construction combining the ChaCha20 stream cipher with the Poly1305 message authentication code. ChaCha20 generates keystream through a series of quarter-round operations on a 512-bit state. Poly1305 authenticates messages through polynomial evaluation modulo a prime. The combination provides an alternative to AES-GCM with different performance characteristics.

**Groth16:** A zero-knowledge succinct non-interactive argument of knowledge (zk-SNARK). Groth16 produces constant-size proofs (192 bytes for BLS12-381) regardless of the statement being proven. Verification requires only three pairing operations. The tradeoff is a per-circuit trusted setup ceremony.

**Halo2:** A zero-knowledge proof system supporting recursive composition. Proofs can verify other proofs, enabling proof aggregation and incrementally verifiable computation. Halo2 with a universal reference string avoids per-circuit trusted setup. NØNOS uses Halo2 for applications requiring recursion or frequent circuit updates.

**IBPB:** Indirect Branch Prediction Barrier. A hardware mechanism that invalidates all indirect branch predictions when triggered. NØNOS writes to MSR 0x49 (IA32_PRED_CMD) to execute IBPB on context switches, preventing one process from influencing another's branch predictions.

**IBRS:** Indirect Branch Restricted Speculation. A hardware mechanism that prevents indirect branch predictions made at one privilege level from affecting speculation at another privilege level. NØNOS enables IBRS via MSR 0x48 (IA32_SPEC_CTRL) bit 0 on kernel entry to prevent user-trained predictions from affecting kernel execution.

**KASLR:** Kernel Address Space Layout Randomization. A security technique that loads the kernel at a randomized base address on each boot. The randomization prevents attackers from knowing kernel code and data locations, complicating exploitation. NØNOS applies approximately 24 bits of entropy to the kernel base address.

**KPTI:** Kernel Page Table Isolation. A defense against Meltdown attacks that maintains separate page table hierarchies for kernel and user mode. When executing in user mode, kernel memory is unmapped except for minimal entry code. NØNOS switches page tables on every privilege level transition.

**MDS:** Microarchitectural Data Sampling. A class of vulnerabilities that leak data from CPU-internal buffers (load buffer, store buffer, fill buffer). NØNOS mitigates MDS by executing the VERW instruction on kernel exit, which triggers microcode that overwrites vulnerable buffers.

**ML-DSA:** Module-Lattice Digital Signature Algorithm. The NIST-standardized post-quantum signature scheme formerly known as CRYSTALS-Dilithium. Security derives from the hardness of the module learning with errors and module short integer solution problems. NØNOS implements ML-DSA-44 (level 2), ML-DSA-65 (level 3), and ML-DSA-87 (level 5).

**ML-KEM:** Module-Lattice Key Encapsulation Mechanism. The NIST-standardized post-quantum key encapsulation scheme formerly known as CRYSTALS-Kyber. Security derives from the hardness of the module learning with errors problem. NØNOS implements ML-KEM-512 (level 1), ML-KEM-768 (level 3), and ML-KEM-1024 (level 5).

**ntor:** The handshake protocol used in onion routing circuit construction. The ntor handshake provides authenticated key agreement based on Curve25519 Diffie-Hellman. The client and relay each contribute ephemeral keys, producing shared secrets for encrypting circuit traffic in both directions.

**RSB:** Return Stack Buffer. A CPU structure that predicts return instruction targets. Attackers can potentially manipulate RSB entries to influence speculation. NØNOS fills the RSB with safe targets (32 entries) on context switches to prevent RSB-based speculation attacks.

**SSBD:** Speculative Store Bypass Disable. A mitigation for Spectre variant 4 that prevents the CPU from speculatively forwarding store data to loads before the store address is verified. NØNOS enables SSBD via MSR 0x48 (IA32_SPEC_CTRL) bit 2.

**STIBP:** Single Thread Indirect Branch Predictors. A mitigation that prevents branch predictions from being shared between hardware threads (hyperthreads) on the same physical core. NØNOS enables STIBP via MSR 0x48 (IA32_SPEC_CTRL) bit 1 to prevent cross-hyperthread speculation attacks.

**TPM:** Trusted Platform Module. A dedicated hardware security chip that provides cryptographic key generation, secure key storage, and platform integrity measurement. NØNOS includes driver infrastructure for TPM 2.0 and can use TPM-provided entropy. Full TPM sealing operations (binding secrets to specific system configurations) are planned for a future release.

**ZeroState:** The formal property that a NØNOS session writes nothing to persistent storage under default policy. When a session terminates, the persistent state equals the pre-boot state. ZeroState provides forensic resistance stronger than encryption because data that never existed cannot be recovered.

**ZK-IDS:** Zero-Knowledge Identity System. The NØNOS authentication mechanism that proves identity through zero-knowledge proofs rather than credential transmission. Users demonstrate knowledge of secrets without revealing them, eliminating credential theft as an attack vector.


## 20. Notation Index

This section defines mathematical notation used throughout this document.

**S = (V, P):** The system state vector S comprises a volatile component V (RAM, registers, peripheral volatile memory) and a persistent component P (storage, NVRAM, firmware variables).

**W(t):** The set of write operations to persistent storage performed by the system at time t. Each write is characterized by target address, data value, and storage medium.

**∀t ∈ [boot, termination]: W(t) = ∅:** The ZeroState invariant. For all times t between boot and termination, under default policy, no writes to persistent storage occur.

**S₀, S₁, ..., Sₙ, Sₜ:** The sequence of system states. S₀ is the initial state before boot. S₁ through Sₙ are active session states. Sₜ is the terminal state after session end.

**⊥:** The undefined or invalid state, representing RAM contents after power loss or clearing.

**PTE_xxx:** Page table entry flag bits. Each flag controls a specific aspect of memory mapping (presence, writability, user accessibility, caching, execution permission).

**MSR 0x48:** The IA32_SPEC_CTRL model-specific register. Bit 0 enables IBRS, bit 1 enables STIBP, bit 2 enables SSBD.

**MSR 0x49:** The IA32_PRED_CMD model-specific register. Writing bit 0 triggers IBPB.

**MSR 0x10A:** The IA32_FLUSH_CMD model-specific register. Writing bit 0 flushes the L1 data cache.

**G1, G2:** Elliptic curve groups used in BLS12-381 pairings. G1 uses 48-byte compressed points, G2 uses 96-byte compressed points.


## Document Conclusion

This specification describes NØNOS version 0.8.0-alpha in comprehensive technical detail. The system provides the most advanced privacy-focused computing environment available, combining architectural innovations with state-of-the-art cryptography and comprehensive security mechanisms.

The ZeroState architecture ensures that default operation leaves no forensic trace. No swap files, no temporary files, no caches, no logs persist beyond session termination. Users gain strong privacy assurance through structural guarantees rather than trusting encryption alone.

The cryptographic subsystem provides protection against both current and future threats. Classical algorithms (AES, ChaCha20, BLAKE3, Ed25519) secure current communications with constant-time implementations immune to timing attacks. Post-quantum algorithms (ML-KEM, ML-DSA, SPHINCS+, NTRU, McEliece) protect against future quantum computing capabilities. Zero-knowledge proof systems (Groth16, Halo2) enable verification without information disclosure.

The security architecture addresses the complete threat landscape. Hardware vulnerability mitigations protect against speculative execution attacks. Capability-based access control limits application privileges. Rootkit detection identifies kernel-level compromise. The ZK-IDS authentication system eliminates credential theft. The vault subsystem provides secure in-memory secret storage with cryptographic protection.

The networking stack prioritizes privacy at every layer. Kernel-integrated onion routing provides anonymity without external dependencies. Encrypted DNS prevents query observation. MAC randomization prevents hardware tracking.

Every component of NØNOS reflects a singular focus on user privacy and security. Every interface is capability-controlled. Every cryptographic operation executes in constant time. Every known hardware vulnerability is mitigated. Every session leaves no trace.

NØNOS establishes a new standard for what privacy-focused computing can achieve: comprehensive protection without compromise, security without complexity, and privacy as a fundamental right enforced by architecture rather than policy alone.


**Sovereignty From Ø**

AGPL-3.0 | Copyright 2026 NØNOS Contributors
