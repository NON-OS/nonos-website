---
title: "Kernel Internal Interface & ABI"
description: "Complete NØNOS kernel internal interface and ABI specification"
weight: 25

# NØNOS Kernel Internal Interface & ABI Specification

**Version 0.8.0** | March 2026


## 1. Syscall Calling Convention

The kernel accepts system calls through two entry mechanisms: the legacy `INT 0x80` software interrupt and the `SYSCALL` instruction. Both use the Linux x86_64 register convention for argument passing.

The syscall number is placed in RAX before invocation. Arguments occupy RDI, RSI, RDX, R10, R8, and R9 in that order. Upon return, RAX contains either a non-negative success value or a negated errno code indicating failure. The kernel does not clobber callee-saved registers.

Syscall numbers 0 through 334 mirror the Linux x86_64 ABI for compatibility with existing tooling. NØNOS extends this range with IPC primitives at 800–803, cryptographic operations at 900–908, hardware access at 1000–1002, debug facilities at 1100–1101, and administrative functions at 1200–1204.

Each syscall handler returns a `SyscallResult` containing the return value, a flag indicating whether a capability token was consumed, and a flag for audit logging. Error codes follow POSIX conventions: EPERM (1) for permission denial, ENOENT (2) for missing resources, ENOMEM (12) for allocation failure, EACCES (13) for access violation, EFAULT (14) for bad pointers, EINVAL (22) for invalid arguments, and ENOSYS (38) for unimplemented calls.


## 2. Trap Frame Structure

When an interrupt or exception occurs, the CPU pushes the instruction pointer, code segment, stack pointer, stack segment, and flags register onto the current stack. The kernel wraps these values in an `ExceptionContext` structure for handler use. Privilege level detection examines the two least significant bits of the code segment selector: a value of 3 indicates user mode, while 0 indicates kernel mode.

Page faults extend this context with the faulting virtual address from CR2 and an error code describing the fault cause. Bit 0 distinguishes protection violations from non-present pages. Bit 1 indicates a write access. Bit 2 marks user-mode faults. Bit 4 flags instruction fetches. Additional bits cover protection keys, shadow stacks, and SGX violations.

For full context saves during process suspension, the kernel captures all sixteen general-purpose registers along with RIP and RFLAGS. This `SuspendedContext` also records the suspension timestamp and the process state at the time of suspension. Context switches between kernel threads use a smaller `CpuContext` containing only callee-saved registers, the instruction pointer, stack pointer, flags, and segment selectors.

User mode entry prepares the CPU context with the target entry point, user stack address, user code and data segment selectors, and appropriate flags. The reserved bit at position 1 in RFLAGS must remain set per x86_64 requirements.


## 3. Process Control Block

The process control block maintains all per-process state. The structure begins with numeric identifiers: the process ID, thread group ID, parent process ID, process group ID, and session ID. Thread group, process group, and session IDs use atomic storage for lock-free reads during signal delivery.

The process name occupies a mutex-protected string with a 256-byte limit. Process state tracks lifecycle progression through New, Ready, Running, Sleeping, Stopped, Zombie, and Terminated phases. Zombie and Terminated states carry the exit code.

Memory state records the code segment bounds, a vector of virtual memory areas with their address ranges and page table flags, a count of resident pages, and the next available virtual address for allocation. Each VMA specifies start and end addresses alongside permission flags.

The capability bits field stores the process permission mask as a 64-bit atomic value. Capability tokens derived from this field undergo Ed25519 signing before use. The PCB also tracks ZK proof statistics: counts of proofs generated and verified, cumulative proving and verification times in milliseconds, and circuits compiled.

Thread-local storage uses the TLS base address field. The stack base records the initial stack allocation. Clone flags preserve the flags from the creating clone syscall. The start time captures process creation in milliseconds since boot.

Process isolation defaults to maximum restriction: no network, no filesystem, no IPC, no devices, and memory isolation enabled.


## 4. Scheduler Structures

The scheduler maintains per-priority run queues implemented as double-ended queues. Tasks enter at the back and exit from the front, providing FIFO ordering within each priority level. The scheduler supports six priority levels: Idle, Low, Normal, High, Critical, and RealTime.

Each task carries a unique identifier, a static name string, an optional function pointer for kernel tasks, priority assignment, CPU affinity mask, completion flag, optional module identifier for module-spawned tasks, entry point address, and stack pointer. Module tasks map their 0–255 priority byte to the six-level enum: 0–50 becomes Low, 51–100 becomes Normal, 101–150 becomes High, 151–200 becomes Critical, and above 200 becomes RealTime.

CPU affinity constrains task execution to specified processor cores. The default affinity permits execution on cores 0 through 15. Scheduler statistics track context switches, preemptions, voluntary yields, wakeups, timer ticks, and time slice exhaustions using atomic counters.


## 5. Capability System

The capability system governs access to kernel services through ten capability types: CoreExec for process lifecycle operations, IO for data transfer, Network for socket operations, IPC for inter-process communication, Memory for address space manipulation, Crypto for cryptographic services, FileSystem for file operations, Hardware for port and MMIO access, Debug for tracing and ptrace, and Admin for system configuration.

Each capability maps to a bit position in a 64-bit mask. CoreExec occupies bit 0, IO bit 1, Network bit 2, IPC bit 3, Memory bit 4, Crypto bit 5, FileSystem bit 6, Hardware bit 7, Debug bit 8, and Admin bit 9. The process control block stores this mask atomically.

Capability tokens encapsulate permissions for delegation and verification. A token contains the owning module identifier, a vector of granted capabilities, an optional expiration timestamp in milliseconds, a unique nonce, and a 64-byte Ed25519 signature. Token validation checks both expiration and the presence of at least one permission.

Syscall entry consults the current process capability token before dispatch. Read and write operations require IO capability. File open and close require FileSystem. Memory mapping requires Memory. Socket operations require Network. Fork and exec require CoreExec. Signal delivery requires CoreExec. Ptrace requires Debug. Mount and reboot require Admin. Cryptographic syscalls require Crypto. Port IO requires Hardware.


## 6. Memory Allocation

Physical memory allocation operates on 4 KiB frames. The `Frame` type wraps a physical address as a transparent u64. Allocation requests specify flags for zeroing, high-memory preference, DMA suitability, and contiguity requirements.

The physical allocator maintains a bitmap tracking frame availability. Allocator state records the starting frame address, total frame count, bitmap pointer and size, a hint for the next allocation search, and a random seed for allocation randomization. The allocator initializes from boot memory information and expands as the kernel discovers additional memory regions.

The kernel heap uses a secure allocator with corruption detection. Heap operations acquire locks, perform allocation or deallocation, and validate guard regions. Allocation failures trigger the out-of-memory handler.


## 7. Panic and Logging

The logging subsystem supports five severity levels: Debug for development diagnostics, Info for operational events, Warn for recoverable anomalies, Err for failures, and Fatal for unrecoverable conditions. Each level maps to a three-to-five character tag and a VGA color for visual distinction.

Log output targets three backends. Serial output writes to COM1 at port 0x3F8 with 115200 baud configuration. VGA output writes directly to the text buffer at physical address 0xB8000. A RAM ring buffer captures recent messages for post-mortem analysis.

Exception handlers log context information including the exception name, instruction pointer, code segment, stack pointer, and flags. Page fault handlers additionally log the faulting address and error code bits.

The panic handler writes a tagged message to serial, displays the panic information on VGA, and enters an infinite halt loop. The out-of-memory handler follows a similar pattern: it writes the allocation request size and alignment to serial, displays a red-background error on VGA, and halts. Early boot errors before heap availability use a stack-allocated buffer and direct VGA writes.


## 8. Module Interface

Loadable modules declare their requirements through a manifest structure. The manifest specifies the module name, version string, author, description, type classification, privacy policy, memory requirements, requested capabilities, attestation chain, and a BLAKE3 hash of the module code.

Module types distinguish System modules with full privileges, User modules with restricted access, Driver modules for hardware interaction, Service modules for background tasks, and Library modules providing shared functionality.

Privacy policies control state persistence. ZeroStateOnly modules operate in RAM with state zeroed on exit. Ephemeral modules lose state on exit without explicit zeroing. EncryptedPersistent modules may store encrypted state to disk. None imposes no restrictions.

Memory requirements specify minimum and maximum heap sizes, stack size, and DMA memory needs. The loader enforces these constraints during module instantiation.

The attestation chain contains entries linking the module to its signers. Each entry holds a 32-byte Ed25519 public key, a 64-byte signature, and a timestamp. Chain verification walks the entries and validates each signature against the signing key.

Module loading accepts a request containing the module name, code bytes, optional parameters, optional Ed25519 signature and public key, and optional post-quantum signature and public key for ML-DSA-65 verification. The loader validates signatures, checks the manifest hash against computed values, enforces policy constraints, and registers the module with a unique identifier.

Module unloading invokes secure erasure. Sensitive fields undergo volatile writes followed by a compiler fence to prevent optimization of the clearing operations.


## 9. ABI Stability

Stable interfaces carry compatibility guarantees across minor versions. Syscall numbers 0 through 334 remain stable for Linux compatibility. Process state enumeration values remain stable. Capability bit assignments remain stable. Errno values remain stable. Trap frame field ordering remains stable.

Unstable interfaces may change between any releases. NØNOS-specific syscalls numbered 800 and above carry no stability guarantee. Process control block field offsets may change. Module manifest format may change. Capability token serialization may change.

Major version increments may break unstable interfaces. Minor version increments preserve all stable interfaces. Deprecated interfaces receive runtime warnings for one minor version before removal.

All ABI-critical structures use `#[repr(C)]` layout for deterministic field ordering across compiler versions.


## Appendix A: Boot Handoff

The bootloader passes system information to the kernel through a `BootHandoffV1` structure. The kernel receives a pointer to this structure in RDI at entry.

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| Magic | `0x4E4F4E4F` | "NONO" in ASCII |
| Version | 1 | Handoff protocol version |
| Max Command Line | 4096 bytes | Maximum cmdline length |

### BootHandoffV1 Structure Layout

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0x00 | magic | u32 | 4 | Magic number (0x4E4F4E4F) |
| 0x04 | version | u16 | 2 | Handoff version (1) |
| 0x06 | size | u16 | 2 | Total structure size |
| 0x08 | flags | u64 | 8 | Feature flags bitmap |
| 0x10 | entry_point | u64 | 8 | Kernel entry address |
| 0x18 | fb | FramebufferInfo | var | Framebuffer configuration |
| var | mmap | MemoryMap | var | Physical memory map |
| var | acpi | AcpiInfo | 8 | ACPI RSDP pointer |
| var | smbios | SmbiosInfo | 8 | SMBIOS entry point |
| var | modules | Modules | 16 | Loaded module list |
| var | timing | Timing | 16 | TSC frequency and epoch |
| var | meas | Measurements | 40 | Security measurements |
| var | rng | RngSeed | 32 | Entropy seed |
| var | zk | ZkAttestation | 72 | ZK proof data |
| var | cmdline_ptr | u64 | 8 | Command line pointer |
| var | reserved0 | u64 | 8 | Reserved |

### Handoff Flags

| Bit | Name | Description |
|-----|------|-------------|
| 0 | WX | Write XOR Execute enforced |
| 1 | NXE | No-Execute Enable active |
| 2 | SMEP | Supervisor Mode Execution Prevention |
| 3 | SMAP | Supervisor Mode Access Prevention |
| 4 | UMIP | User Mode Instruction Prevention |
| 5 | IDMAP_PRESERVED | Identity mapping preserved |
| 6 | FB_AVAILABLE | Framebuffer available |
| 7 | ACPI_AVAILABLE | ACPI tables available |
| 8 | TPM_MEASURED | TPM PCR extended |
| 9 | SECURE_BOOT | UEFI Secure Boot active |
| 10 | ZK_ATTESTED | ZK attestation verified |

### FramebufferInfo Structure

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0x00 | ptr | u64 | Physical address |
| 0x08 | size | u64 | Size in bytes |
| 0x10 | width | u32 | Width in pixels |
| 0x14 | height | u32 | Height in pixels |
| 0x18 | stride | u32 | Bytes per scanline |
| 0x1C | pixel_format | u32 | Format code (0=RGB, 1=BGR, 2=RGBX, 3=BGRX) |

### MemoryMapEntry Structure

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0x00 | memory_type | u32 | Region type |
| 0x04 | padding | u32 | Alignment padding |
| 0x08 | physical_start | u64 | Physical base address |
| 0x10 | virtual_start | u64 | Virtual address (reserved) |
| 0x18 | page_count | u64 | Number of 4 KiB pages |
| 0x20 | attribute | u64 | Region attributes |

### Memory Type Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | RESERVED | Do not use |
| 1 | LOADER_CODE | Bootloader code |
| 2 | LOADER_DATA | Bootloader data |
| 3 | BOOT_SERVICES_CODE | UEFI boot services code |
| 4 | BOOT_SERVICES_DATA | UEFI boot services data |
| 5 | RUNTIME_SERVICES_CODE | UEFI runtime code |
| 6 | RUNTIME_SERVICES_DATA | UEFI runtime data |
| 7 | CONVENTIONAL | Usable memory |
| 8 | UNUSABLE | Bad memory |
| 9 | ACPI_RECLAIM | ACPI tables (reclaimable) |
| 10 | ACPI_NVS | ACPI NVS (preserve) |
| 11 | MMIO | Memory-mapped I/O |
| 12 | MMIO_PORT_SPACE | MMIO port space |
| 13 | PAL_CODE | Processor abstraction layer |
| 14 | PERSISTENT | Persistent memory |

### Security Measurements Structure (40 bytes)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0x00 | kernel_sha256 | [u8; 32] | Kernel hash |
| 0x20 | kernel_sig_ok | u8 | Signature verified |
| 0x21 | secure_boot | u8 | Secure Boot status |
| 0x22 | zk_attestation_ok | u8 | ZK proof valid |
| 0x23 | reserved | [u8; 5] | Reserved |

### ZkAttestation Structure (72 bytes)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0x00 | verified | u8 | Proof verified |
| 0x01 | flags | u8 | Attestation flags |
| 0x02 | reserved | [u8; 6] | Reserved |
| 0x08 | program_hash | [u8; 32] | Circuit program hash |
| 0x28 | capsule_commitment | [u8; 32] | Proof commitment |

Validation checks the magic value, version number, and size field against the expected structure size. Flag bits indicate framebuffer availability, ACPI presence, and Secure Boot status.


## Appendix B: Segment Selectors

The GDT establishes four primary segments. Selector 0x08 provides kernel code with ring 0 privilege. Selector 0x10 provides kernel data with ring 0 privilege. Selector 0x18 provides user data with ring 3 privilege. Selector 0x20 provides user code with ring 3 privilege.

User mode execution sets CS to 0x23 and SS to 0x1B, incorporating the ring 3 privilege level in the selector low bits.


## Appendix C: IDT Vectors

The interrupt descriptor table assigns handlers to CPU exceptions and hardware interrupts. Vector 0 handles divide errors. Vector 1 handles debug exceptions. Vector 2 handles non-maskable interrupts. Vector 3 handles breakpoints. Vector 6 handles invalid opcodes. Vector 8 handles double faults on a separate stack. Vector 13 handles general protection faults. Vector 14 handles page faults. Vector 18 handles machine check exceptions.

Hardware interrupts begin at vector 32. The timer occupies vector 32. The keyboard occupies vector 33. The mouse occupies vector 44. Software interrupt 0x80 provides the legacy syscall entry point.


AGPL-3.0 | Copyright 2026 NØNOS Contributors
