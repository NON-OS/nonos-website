---
title: "Boot Process"
description: "NØNOS boot sequence, verification, and initialization"
weight: 11
---
# NØNOS Boot Process

**Version 0.8.0** | March 2026

NØNOS implements a cryptographically verified boot process. Before the kernel executes a single line of code, the bootloader has verified its signature and zero-knowledge attestation. This document walks through the complete boot sequence.


## Boot Overview

The NØNOS boot process consists of three major phases:

**Phase 1: FIRMWARE (UEFI)**
Power-on → POST → Load bootloader → Exit boot services

**Phase 2: BOOTLOADER**
10 sequential stages with cryptographic verification

**Phase 3: KERNEL**
Hardware init → Drivers → Filesystems → Shell/Desktop


## Phase 1: Firmware

### Power-On Self Test (POST)

When you press the power button, the CPU begins executing firmware (UEFI) from flash memory. POST checks:

- CPU functionality
- Memory presence and basic tests
- Storage controller detection
- Boot device enumeration

### UEFI Boot Manager

UEFI searches for bootable media:

1. Check UEFI boot entries (NVRAM)
2. Search removable media for `\EFI\BOOT\BOOTX64.EFI`
3. Load and execute the bootloader

For NØNOS, the bootloader is located at:
```
\EFI\BOOT\BOOTX64.EFI     (removable media default)
\EFI\nonos\BOOTX64.EFI    (installed system)
```


## Phase 2: Bootloader

The NØNOS bootloader executes exactly 10 stages in strict sequence. Each stage must succeed for boot to continue.

### Stage 1: UEFI Initialization

**What Happens:**
- Initialize UEFI services and memory allocator
- Set up Graphics Output Protocol (GOP) framebuffer
- Configure serial output for diagnostics
- Install panic handler for error display

**Display:**
The screen shows the NØNOS boot interface with a split layout:
- Left panel: Boot log messages
- Right panel: Cryptographic verification status

**Output:**
```
[BOOT] NONOS Bootloader v1.0
[+] GOP framebuffer initialized
```

### Stage 2: Configuration Loading

**What Happens:**
- Locate `EFI/nonos/boot.toml` on the ESP
- Parse security policies
- Parse network policies
- Parse graphics settings
- Apply boot timeout and fallback behavior

**Configuration File Location:**
```
\EFI\nonos\boot.toml
```

**Key Settings:**
- `security.require_secure_boot` — Require UEFI Secure Boot
- `security.require_tpm_measurement` — Require TPM
- `network.network_policy` — Network boot behavior
- `display.graphics_mode` — Full graphics or headless
- `boot.timeout` — Seconds to wait before auto-boot

### Stage 3: Security Initialization

**What Happens:**
- Detect Secure Boot status
- Initialize TPM 2.0 (if present)
- Start measured boot process
- Enumerate UEFI security variables
- Check platform keys and signature databases
- Enforce security policy

**Security Policies:**

| Policy | Description |
|--------|-------------|
| MAXIMUM | Require Secure Boot + TPM + all checks |
| STANDARD | Require Secure Boot if available |
| RELAXED | Allow unsigned boot (development only) |
| CUSTOM | User-defined requirements |

**Output:**
```
[SECURITY] Secure Boot: ENABLED
[SECURITY] TPM 2.0: DETECTED
```

### Stage 4: Hardware Discovery

**What Happens:**
- Parse ACPI tables (RSDP, RSDT/XSDT, MADT, etc.)
- Enumerate PCI bus and all devices
- Detect graphics controllers
- Detect network interfaces
- Detect storage controllers
- Determine CPU count
- Build complete memory map
- Detect CPU features (RDRAND, RDSEED, AES-NI, etc.)

**Memory Map:**
The bootloader queries UEFI for all memory regions and their types:
- Conventional memory (usable RAM)
- Reserved regions
- ACPI tables
- Memory-mapped I/O
- Boot services memory (reclaimable after boot)

**Output:**
```
[HARDWARE] Memory: 8192 MB detected
[HARDWARE] CPUs: 4 cores
[HARDWARE] PCI devices: 12
```

### Stage 5: Kernel Binary Loading

**What Happens:**
- Locate `EFI/nonos/kernel.bin` on ESP
- Allocate memory for kernel (up to 512 MB)
- Load entire kernel binary into memory
- Record memory address for later stages

**File Location:**
```
\EFI\nonos\kernel.bin
```

**Memory:**
The kernel is loaded as UEFI LOADER_DATA memory, which becomes available to the kernel after ExitBootServices.

**Output:**
```
[LOADER] Loading kernel: 67,892,224 bytes
[LOADER] Kernel loaded at 0x00100000
```

### Stage 6: BLAKE3 Hash Computation

**What Happens:**
- Compute BLAKE3-256 hash of the entire kernel binary
- Use domain separator: `NONOS:ZK:PROGRAM:v1`
- Display hash computation with animation
- Store hash for signature verification

**Why BLAKE3:**
- Extremely fast (parallelizable)
- Cryptographically secure (256-bit output)
- Modern design with no known weaknesses

**Display:**
The right panel shows hash bytes appearing one by one for visual verification.

**Output:**
```
[CRYPTO] BLAKE3: fa02d10e8804169a47233e34a6ff356624895...
```

### Stage 7: Ed25519 Signature Verification

**What Happens:**
- Extract 64-byte Ed25519 signature from kernel binary
- Split into R (32 bytes) and S (32 bytes) components
- Load embedded public key (compiled into bootloader)
- Verify signature against computed hash
- Use constant-time comparison

**Signature Format:**
The signature is appended to the kernel binary:

| Offset | Content |
|--------|---------|
| 0 | Kernel ELF Code |
| end | Ed25519 Signature (64 bytes) |
| | R: 32 bytes |
| | S: 32 bytes |

**Failure Behavior:**
If verification fails, the bootloader halts with an error. No fallback to unsigned boot.

**Output:**
```
[CRYPTO] Ed25519 signature: VALID
```

### Stage 8: Zero-Knowledge Attestation

**What Happens:**
- Locate ZK proof block by magic bytes (`0x4E 0xC3 0x5A 0x50`)
- Parse proof header (80 bytes)
- Extract program hash (32 bytes)
- Extract capsule commitment (32 bytes)
- Verify Groth16 proof over BLS12-381
- Match program hash against expected value

**ZK Proof Block Format:**

| Offset | Field | Size |
|--------|-------|------|
| 0x00 | Magic: `4E C3 5A 50` | 4 bytes |
| 0x04 | Version: `00 00 00 01` | 4 bytes |
| 0x08 | Program Hash | 32 bytes |
| 0x28 | Capsule Commitment | 32 bytes |
| 0x48 | Public Inputs Length | 4 bytes |
| 0x4C | Proof Length | 4 bytes |
| 0x50 | Public Inputs | variable |
| 0x50+N | Groth16 Proof | 192 bytes |

**What the Proof Proves:**
1. Program hash matches the expected value
2. Hardware attestation meets threshold
3. Capsule commitment is valid
4. PCR preimage has sufficient entropy

**Mandatory:**
Boot fails without a valid ZK proof. There is no bypass.

**Output:**
```
[ZK] Groth16 proof: VERIFIED
[ZK] Program hash matches expected value
```

### Stage 9: ELF Loading

**What Happens:**
- Parse ELF64 header with full validation
- Support both ET_EXEC (fixed address) and ET_DYN (PIE) binaries
- Load all program segments into memory
- Handle LOAD, INTERP, DYNAMIC, NOTE, GNU_STACK segments
- Process relocations (RELA format)
- Validate page alignment
- Check for W+X violations (reject if found)

**ELF Header Constants:**

| Field | Value | Description |
|-------|-------|-------------|
| Magic | `\x7FELF` | ELF magic number |
| Class | 2 (ELFCLASS64) | 64-bit format |
| Data | 1 (ELFDATA2LSB) | Little-endian |
| Machine | 0x3E (EM_X86_64) | x86-64 |
| Entry Symbol | `_start` | Kernel entry point |

**Target Specification:**

| Parameter | Value |
|-----------|-------|
| LLVM Target | x86_64-unknown-none-elf |
| Pointer Width | 64 bits |
| Data Layout | `e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128` |
| Endianness | Little |
| Max Atomic Width | 64 bits |
| Panic Strategy | Abort |
| Red Zone | Disabled |
| Stack Probes | Inline |
| Code Model | Small |
| Relocation Model | PIC |
| PIE | Enabled |
| CPU Features | +sse,+sse2,-sse3,-mmx,-avx |

**Section Layout:**

| Section | Alignment | Flags | Purpose |
|---------|-----------|-------|---------|
| .multiboot | 0x1000 | r-x | Bootloader data |
| .text | 0x1000 | r-x | Executable code |
| .rodata | 0x1000 | r-- | Read-only data |
| .data | 0x1000 | rw- | Initialized data |
| .nonos.manifest | 0x1000 | rw- | Module manifest |
| .nonos.sig | 8 | rw- | Ed25519 signature |
| .bss | 0x1000 | rw- | Uninitialized data |
| .rela.dyn | 8 | - | Dynamic relocations |
| .got | 8 | - | Global offset table |

**Program Headers (PHDRS):**

| Segment | Type | Flags | Description |
|---------|------|-------|-------------|
| text | PT_LOAD | R+X (5) | Executable code |
| rodata | PT_LOAD | R (4) | Read-only data |
| data | PT_LOAD | R+W (6) | Read/write data |
| dynamic | PT_DYNAMIC | R+W (6) | Dynamic linking |

**Address Space:**
For PIE kernels, the base address can be randomized (ASLR). The kernel is mapped into the higher half of virtual memory at `0xFFFF_FFFF_8000_0000`.

**Segment Permissions:**

| Segment | Permissions | Contents |
|---------|-------------|----------|
| .text | R-X | Executable code |
| .rodata | R-- | Read-only data |
| .data | RW- | Initialized data |
| .bss | RW- | Uninitialized data |

**Output:**
```
[ELF] Entry point: 0xffffffff80000000
[ELF] Loaded 4 segments
```

### Stage 10: Handoff to Kernel

**What Happens:**
- Collect 64 bytes of boot entropy
- Entropy sources: RDRAND, RDSEED, TSC jitter, RTC
- Extend TPM PCRs with boot measurements
- Build BootHandoffV1 structure
- Exit UEFI boot services
- Jump to kernel entry point

**Boot Entropy Collection:**
Entropy is critical for cryptographic operations. The bootloader gathers entropy from:

| Source | Contribution |
|--------|--------------|
| RDRAND | 64 iterations |
| RDSEED | 64 iterations |
| TSC Jitter | 512 rounds |
| RTC Timestamp | 8 bytes |

All sources are mixed using BLAKE3 key derivation.

**BootHandoffV1 Structure:**
The kernel receives a pointer to this structure in the RDI register:

| Field | Description |
|-------|-------------|
| Magic | `0x4E4F4E4F` ("NONO") |
| Version | Structure version |
| Flags | Feature availability |
| Framebuffer | Base, resolution, pitch, format |
| Memory Map | Physical memory regions |
| ACPI RSDP | ACPI table pointer |
| Boot Entropy | 64 bytes of collected entropy |
| Boot Timing | Performance measurements |
| ZK Attestation | Proof block for kernel use |

**ExitBootServices:**
Once UEFI boot services are exited, the bootloader cannot use UEFI anymore. All hardware is now the kernel's responsibility.

**Output:**
```
[HANDOFF] Entropy collected: 64 bytes
[HANDOFF] TPM PCRs extended
[HANDOFF] Jumping to kernel...
```


## Phase 3: Kernel Initialization

### Entry Point

The kernel entry point is `_start` in `nonos_main.rs`:

```rust
#[unsafe(naked)]
#[no_mangle]
pub extern "C" fn _start() -> ! {
    // Enable SSE
    // Call rust_main(boot_info)
}
```

The function:
1. Enables SSE/SSE2 for floating-point operations
2. Calls the Rust main function with BootHandoffV1 pointer

### Early Initialization

In order:

1. **Validate Boot Handoff** — Check magic number and version
2. **Initialize Serial Console** — COM1 at 115200 baud for diagnostics
3. **Initialize VGA/Framebuffer** — Set up graphics output
4. **Parse ACPI Tables** — Hardware information
5. **Initialize Memory Manager** — Physical frame allocator, page tables
6. **Set Up Interrupts** — IDT, exception handlers
7. **Initialize Heap** — Kernel heap allocator

### Driver Initialization

After core systems are ready:

1. **PCI Enumeration** — Discover all PCI devices
2. **Storage Drivers** — AHCI, NVMe, VirtIO
3. **Network Drivers** — e1000, RTL8139, etc.
4. **Input Drivers** — Keyboard, mouse
5. **USB Stack** — xHCI controller

**Boot Output:**
```
N0N-OS Kernel v0.8.0
Production kernel loaded
[KERNEL] Kernel initialized successfully
[KERNEL] System operational
kernel online
pci ok devices=8 msix=2
console ok msgs=5 bytes=156
keyboard ok
ahci ok ports=1 r=0 w=0
nvme ok ns=0 br=0 bw=0
xhci ok dev=0 irq=0
gpu ok 0000:0000 frames=0
audio ok codecs=0 streams=0
SELFTEST PASS
```

### Selftest

The kernel runs self-tests before declaring operational status:

- Cryptographic algorithm tests (BLAKE3, Ed25519, etc.)
- Memory allocation tests
- Interrupt delivery tests
- Hardware access tests

If any self-test fails, the kernel halts with a diagnostic message.

### User Environment

Once initialization completes, the kernel launches either:

**Desktop Mode:**
- Initialize window compositor
- Draw desktop environment
- Show dock and menu bar
- Ready for user interaction

**Headless Mode:**
- Launch shell on serial console
- Command-line interface only
- Lower memory usage


## Boot Timing

Typical boot times on reference hardware:

| Stage | Time |
|-------|------|
| UEFI POST | ~2-5 seconds |
| Bootloader Stages 1-4 | ~500ms |
| Kernel Load | ~200ms |
| Signature Verification | ~10ms |
| ZK Proof Verification | ~100ms |
| ELF Loading | ~50ms |
| Kernel Init | ~500ms |
| **Total** | **~4-7 seconds** |

ZK proof verification is the most computationally intensive stage but remains fast due to the Groth16 verifier efficiency.


## Boot Failure Handling

### Verification Failures

If Ed25519 or ZK verification fails:

1. Display error message with details
2. Log to audit trail
3. Increment failure counter in NVRAM
4. Options:
   - Enter recovery mode (if available)
   - Reboot
   - Halt

### Multiple Failures

After 3 consecutive boot failures:
- Factory reset option offered
- Clears failure counter
- Does NOT bypass verification

### Recovery Mode

If `recovery.bin` exists on the ESP:
- Separate signed recovery kernel
- Diagnostic tools
- Factory reset capability
- Still requires signature verification


## Secure Boot Integration

NØNOS can integrate with UEFI Secure Boot:

### Signed Bootloader

The bootloader (`BOOTX64.EFI`) can be signed with:
- Microsoft's UEFI CA (for broad compatibility)
- Custom Secure Boot key (requires key enrollment)

### Chain of Trust

| Level | Component | Trust |
|-------|-----------|-------|
| 1 | **Platform Key (PK)** | OEM controlled |
| 2 | **Key Exchange Key (KEK)** | Trust anchor |
| 3 | **Signature Database (db)** | Contains NØNOS bootloader signature |
| 4 | **Bootloader** | Verifies kernel (Ed25519 + Groth16) |
| 5 | **Kernel** | Verifies modules (Ed25519) |


## TPM Measured Boot

When TPM 2.0 is present:

### PCR Extensions

| PCR | Contents |
|-----|----------|
| 0 | UEFI firmware |
| 1 | UEFI configuration |
| 2 | Option ROMs |
| 4 | Bootloader code |
| 8 | Kernel hash |
| 9 | Command line |
| 14 | Custom measurements |

### Attestation

The TPM can provide remote attestation:
- Quote PCR values with TPM signature
- Prove exact boot configuration
- Detect tampering or modification


## Boot Configuration

### boot.toml Options

```toml
[security]
require_secure_boot = true
require_tpm_measurement = true
security_policy = "STANDARD"
signature_verification_level = "STRICT"

[network]
network_policy = "STANDARD"
preferred_boot_method = "LOCAL"
network_timeout_seconds = 30

[display]
graphics_mode = "FULL_GRAPHICS"
boot_splash_enabled = true
verbose_logging = true

[boot]
timeout = 10
default = "kernel"
auto_boot_enabled = true
fallback_behavior = "ENTER_SETUP"
kernel_command_line = ""
```

### Kernel Command Line

Pass options to the kernel via `kernel_command_line`:

| Option | Effect |
|--------|--------|
| `headless` | Skip desktop, serial console only |
| `debug` | Enable debug logging |
| `nosmp` | Single CPU only |
| `noacpi` | Skip ACPI parsing |


## Debugging Boot Issues

### Serial Console

Connect to COM1 (0x3F8) at 115200 baud for boot diagnostics:

```bash
# Linux
screen /dev/ttyUSB0 115200

# macOS
screen /dev/cu.usbserial-* 115200

# QEMU (automatic)
qemu-system-x86_64 ... -serial mon:stdio
```

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| No boot menu | UEFI not finding ESP | Check GPT/FAT32 format |
| Signature failed | Wrong key or corrupted kernel | Re-sign kernel |
| ZK proof failed | Proof not embedded | Run embed-zk-proof |
| Black screen | GOP not initialized | Check UEFI graphics settings |
| Hang at drivers | Hardware incompatibility | Try with less hardware |

### Debug Build

Build with debug symbols for GDB debugging:

```bash
make debug
qemu-system-x86_64 ... -s -S
gdb -ex 'target remote :1234'
```


AGPL-3.0 | Copyright 2026 NØNOS Contributors
