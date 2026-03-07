---
title: "Full Installation Guide"
description: "Complete NØNOS installation guide with full technical details"
weight: 5
---

# NØNOS Alpha Installation Guide

## Version 0.8.1-alpha

## March 2026


**Document Classification:** Public Technical Documentation

**Document Version:** 1.1

**Applicable Release:** NØNOS 0.8.1-alpha

**License:** GNU Affero General Public License v3.0 (AGPL-3.0)


## Table of Contents

1. [Scope and Audience](#1-scope-and-audience)
2. [System Requirements](#2-system-requirements)
3. [ISO Download and Integrity Verification](#3-iso-download-and-integrity-verification)
4. [Bootable USB Creation](#4-bootable-usb-creation)
5. [First Boot Technical Walkthrough](#5-first-boot-technical-walkthrough)
6. [Desktop Initialization](#6-desktop-initialization)
7. [Persistence Warning](#7-persistence-warning)
8. [Alpha Known Issues](#8-alpha-known-issues)
9. [Safe Shutdown Procedure](#9-safe-shutdown-procedure)
10. [Troubleshooting](#10-troubleshooting)


## 1. Scope and Audience

### 1.1 Document Purpose

This document provides deterministic, reproducible procedures for obtaining, verifying, and booting the NØNOS 0.8.1-alpha operating system from USB media on x86-64 UEFI systems. It assumes the reader possesses working knowledge of UEFI firmware configuration, command-line operations on POSIX systems, cryptographic verification procedures, and low-level system diagnostics.

### 1.2 Intended Audience

This guide is intended for:

- **Security researchers** evaluating NØNOS architecture and implementation
- **Systems engineers** assessing NØNOS for deployment in security-critical environments
- **Penetration testers** requiring ephemeral operating environments
- **Software developers** contributing to NØNOS development
- **Quality assurance engineers** performing hardware compatibility testing

This guide is not intended for general end users. No attempt is made to simplify procedures or omit technical detail for accessibility purposes.

### 1.3 Alpha Software Declaration

**NØNOS 0.8.1-alpha is pre-release software.**

The following conditions apply to all alpha releases:

1. **No stability guarantee.** Kernel panics, driver failures, and data corruption may occur without warning.

2. **No security guarantee.** While the security architecture is implemented, it has not undergone formal verification or third-party audit. Do not rely on alpha releases for operational security.

3. **No hardware compatibility guarantee.** Driver support is limited. Hardware that functions in other operating systems may fail to initialize or operate incorrectly.

4. **No backward compatibility guarantee.** Future releases may change boot procedures, file formats, command syntax, and system behavior without migration path.

5. **No support guarantee.** Alpha testers are expected to diagnose issues independently and report findings through proper channels.

### 1.4 Risk Statement

Operating NØNOS on physical hardware carries inherent risks:

- **Firmware modification.** Incorrect UEFI configuration may render systems unbootable. Ensure firmware recovery procedures are understood before modification.

- **Data loss.** NØNOS is designed to leave no persistent state. Any data created during a session will be irrecoverably lost upon power removal. NØNOS does not access internal storage devices by default, but misconfiguration or software defects could theoretically cause unintended writes.

- **Hardware damage.** While unlikely, driver defects could theoretically cause hardware damage through incorrect voltage regulation, fan control, or thermal management. This risk is present in any operating system but elevated in alpha software.

- **Security exposure.** Alpha software may contain vulnerabilities. Do not use alpha releases in environments where compromise would cause harm.

By proceeding with installation, you acknowledge these risks and accept responsibility for any consequences.


## 2. System Requirements

### 2.1 Processor Requirements

#### 2.1.1 Architecture

NØNOS requires an x86-64 (AMD64/Intel 64) processor. 32-bit x86, ARM, RISC-V, and other architectures are not supported.

#### 2.1.2 Required Instruction Set Extensions

The following instruction set extensions are mandatory:

| Extension | Purpose | Detection |
|-----------|---------|-----------|
| SSE2 | SIMD operations, memory operations | `CPUID.01H:EDX.SSE2[bit 26]` |
| NX/XD bit | No-Execute page protection | `CPUID.80000001H:EDX.NX[bit 20]` |
| CMPXCHG16B | 128-bit atomic operations | `CPUID.01H:ECX.CX16[bit 13]` |
| LAHF/SAHF | Long mode flag operations | `CPUID.80000001H:ECX.LAHF[bit 0]` |

Systems lacking any of these extensions will fail to boot. The bootloader performs explicit feature detection and halts with diagnostic output if requirements are not met.

#### 2.1.3 Recommended Instruction Set Extensions

The following extensions are not required but significantly improve performance and security:

| Extension | Purpose | Impact if Absent |
|-----------|---------|------------------|
| AES-NI | Hardware AES acceleration | RAM encryption uses software AES (~10x slower) |
| RDRAND | Hardware random number generation | Entropy derived from timing sources only |
| RDSEED | Hardware entropy source | Falls back to RDRAND or timing |
| SSE4.2 | CRC32 instruction | Software CRC32 for checksums |
| POPCNT | Population count | Software bit counting |
| AVX/AVX2 | 256-bit SIMD | Reduced cryptographic throughput |
| SMEP | Supervisor Mode Execution Prevention | Reduced kernel exploit mitigation |
| SMAP | Supervisor Mode Access Prevention | Reduced kernel exploit mitigation |

#### 2.1.4 Processor Compatibility Notes

**Intel processors:** Different processors released after 2008 should meet minimum requirements.

**AMD processors:** Phenom II and later meet minimum requirements. Earlier AMD64 processors may lack LAHF/SAHF in long mode.

**Virtual machines:** QEMU/KVM, VMware, VirtualBox, and Hyper-V are supported when configured for x86-64 with UEFI firmware. Ensure CPU feature passthrough is enabled or required extensions are emulated.

### 2.2 Firmware Requirements

#### 2.2.1 UEFI Version

NØNOS requires UEFI 2.0 or later firmware. Legacy BIOS boot is not supported and will not be supported in future releases.

The following UEFI protocols are required:

| Protocol | GUID | Purpose |
|----------|------|---------|
| EFI_SIMPLE_FILE_SYSTEM_PROTOCOL | 964E5B22-6459-11D2-8E39-00A0C969723B | Boot media access |
| EFI_GRAPHICS_OUTPUT_PROTOCOL | 9042A9DE-23DC-4A38-96FB-7ADED080516A | Display output |
| EFI_LOADED_IMAGE_PROTOCOL | 5B1B31A1-9562-11D2-8E3F-00A0C969723B | Bootloader loading |

The following protocols are optional but recommended:

| Protocol | Purpose | Fallback Behavior |
|----------|---------|-------------------|
| EFI_RNG_PROTOCOL | Hardware entropy | Timing-based entropy only |
| EFI_TCG2_PROTOCOL | TPM 2.0 access | TPM features unavailable |

#### 2.2.2 Secure Boot Status

NØNOS boots with UEFI Secure Boot either enabled or disabled:

**Secure Boot Disabled:** The system boots without firmware-level signature verification. The NØNOS bootloader performs its own Ed25519 signature verification and Groth16 ZK proof verification of the kernel.

**Secure Boot Enabled:** Requires the NØNOS signing certificate to be enrolled in the firmware's authorized signature database (db). Alpha releases do not ship with Microsoft-signed shim loaders. To boot with Secure Boot enabled, you must either:

1. Enroll the NØNOS signing certificate manually
2. Disable Secure Boot in firmware configuration

For alpha testing, disabling Secure Boot is the recommended approach.

#### 2.2.3 CSM (Compatibility Support Module)

CSM must be **disabled**. NØNOS is a pure UEFI application and does not support legacy boot.

### 2.3 Memory Requirements

#### 2.3.1 Minimum RAM

**512 MiB** is the absolute minimum for kernel initialization and basic shell operation.

At 512 MiB:
- Graphical desktop may fail to initialize
- Limited process capacity
- No headroom for user applications
- Memory pressure warnings expected during normal operation

#### 2.3.2 Recommended RAM

**2 GiB minimum, 8 GiB recommended** for normal operation.

At 2 GiB:
- Full graphical desktop with window compositor
- Multiple concurrent shell sessions
- Text editor with moderate file sizes
- Network operations with buffering

#### 2.3.3 Memory Architecture Considerations

NØNOS operates entirely from RAM. Unlike conventional operating systems, there is no swap partition or disk-backed virtual memory. Total system capacity—including kernel, drivers, desktop environment, user applications, and user data—is bounded by physical RAM.

The kernel image occupies approximately **375 MiB** after loading. The graphical desktop and compositor require an additional **50-100 MiB** depending on resolution. Remaining memory is available for user processes and the volatile filesystem.

### 2.4 Storage Requirements

#### 2.4.1 Boot Media

NØNOS boots from read-only media. Supported boot devices:

| Device Type | Interface | Notes |
|-------------|-----------|-------|
| USB flash drive | USB 2.0, USB 3.x | Minimum 1 GiB capacity |
| USB hard drive/SSD | USB 2.0, USB 3.x | Functions identically to flash |
| SD card | USB card reader | Depends on reader compatibility |
| SATA optical drive | AHCI | DVD or Blu-ray with ISO image |

**Internal storage devices are not accessed during normal operation.** The kernel does not mount internal SATA, NVMe, or other storage devices unless explicitly commanded.

#### 2.4.2 Boot Media Filesystem

The disk image creates a GPT-partitioned disk with an EFI System Partition (ESP) formatted as FAT32. This is the only supported configuration.

MBR partitioning is not supported.

### 2.5 Display Requirements

#### 2.5.1 Graphics Output Protocol

NØNOS requires a GOP-compatible display adapter. All modern UEFI systems provide GOP through either:

1. Integrated graphics with UEFI GOP driver
2. Discrete graphics with UEFI GOP ROM
3. Firmware-provided GOP for headless servers (virtual display)

#### 2.5.2 Resolution

Minimum supported resolution: **640x480**

Recommended resolution: **1280x800 or higher**

#### 2.5.3 Color Depth

32-bit color (BGRA or RGBA pixel format) is required.

### 2.6 Input Device Requirements

#### 2.6.1 Keyboard

At least one of:
- PS/2 keyboard (built-in driver support)
- USB keyboard (via USB HID driver)

#### 2.6.2 Pointing Device

Optional but required for graphical desktop interaction:
- PS/2 mouse
- USB mouse (via USB HID driver)

### 2.7 Network Hardware

Network connectivity is optional. Supported adapters:

| Chipset | Driver | Status |
|---------|--------|--------|
| Intel E1000/E1000E | e1000 | Stable |
| Intel I217/I218/I219 | e1000e | Stable |
| Realtek RTL8139 | rtl8139 | Stable |
| Realtek RTL8168/8111 | rtl8168 | Experimental |
| VirtIO | virtio-net | Stable (VM only) |

Wireless networking is **experimental** in the alpha release. Supported chipsets include Intel AX200/210 and select Realtek chips. Use wired Ethernet for production stability.

### 2.8 Known Incompatible Hardware

The following hardware classes have known compatibility issues:

| Hardware | Issue | Workaround |
|----------|-------|------------|
| NVIDIA GPUs (discrete) | No native driver; GOP fallback only | Use integrated graphics if available |
| AMD GPUs (post-2015) | Limited GOP support on some models | Verify GOP functionality in firmware |
| Broadcom WiFi | No driver available | Use USB Ethernet adapter |
| Intel WiFi (most) | No driver available | Use USB Ethernet adapter |
| Apple Silicon Macs | Different architecture (ARM64) | Not supported |
| Intel Macs (T2 chip) | T2 blocks non-signed boot | Disable Secure Boot via recoveryOS |


## 3. ISO Download and Integrity Verification

### 3.1 Official Download Source

NØNOS ISO images are distributed exclusively through:

**Primary:** `https://nonos.software`

**Source Repository:** `https://github.com/NON-OS/nonos-kernel`

Do not download NØNOS images from any other source. Third-party mirrors are not authorized and may distribute modified images.

### 3.2 Release Artifacts

**Version 0.8.1-alpha** | Released 2026-03-07

| File | Size | Format |
|------|------|--------|
| `nonos-0.8.1-alpha.iso` | ~380 MB | Hybrid ISO (UEFI boot) |
| `nonos-0.8.1-alpha.img` | ~450 MB | GPT with EFI System Partition |

### 3.3 SHA-256 Verification

SHA-256 verification confirms the download completed without corruption.

**Official SHA-256 Checksums:**

Checksums are published in `SHA256SUMS` alongside the release artifacts. Verify the checksums file signature before trusting its contents.

```bash
# Download checksum file
curl -O https://nonos.software/releases/0.8.1-alpha/SHA256SUMS
curl -O https://nonos.software/releases/0.8.1-alpha/SHA256SUMS.sig
```

#### 3.3.1 Linux

```bash
cd ~/Downloads
sha256sum -c SHA256SUMS
```

Expected output on success:
```
nonos-0.8.1-alpha.iso: OK
```

#### 3.3.2 macOS

```bash
cd ~/Downloads
shasum -a 256 nonos-0.8.1-alpha.iso
```

Compare the output manually with the expected checksum from `SHA256SUMS`.

#### 3.3.3 Windows (PowerShell)

```powershell
cd $HOME\Downloads
Get-FileHash -Algorithm SHA256 nonos-0.8.1-alpha.iso | Format-List
```

Compare the `Hash` field with the expected value from `SHA256SUMS`.

### 3.4 BLAKE3 Verification

BLAKE3 checksums are published in `B3SUMS` alongside the release artifacts.

Verify with:

```bash
b3sum -c B3SUMS
```

### 3.5 GPG Signature Verification

GPG signature verification confirms the ISO was signed by an authorized NØNOS release key.

#### 3.5.1 NØNOS Release Signing Key

**Key Type:** Ed25519 (via GnuPG 2.3+)

**Key ID:** `0x7E4C3A9B2D1F6E8C`

**Fingerprint:**
```
8A3F 2B7C 4D9E 1F6A 5C8B  3E2D 7E4C 3A9B 2D1F 6E8C
```

**Key Creation Date:** 2026-01-15

**Key Expiry:** 2028-01-15

**UID:** `NØNOS Release Signing Key <releases@nonos.systems>`

#### 3.5.2 Import NØNOS Release Key

```bash
# From keyserver
gpg --keyserver keys.openpgp.org --recv-keys 0x7E4C3A9B2D1F6E8C

# Or from official website
curl -sSL https://nonos.software/keys/release-signing-key.asc | gpg --import
```

#### 3.5.3 Verify Key Fingerprint

**Critical:** Verify the fingerprint matches before trusting signatures.

```bash
gpg --fingerprint 0x7E4C3A9B2D1F6E8C
```

Expected output:
```
pub   ed25519 2026-01-15 [SC] [expires: 2028-01-15]
      8A3F 2B7C 4D9E 1F6A 5C8B  3E2D 7E4C 3A9B 2D1F 6E8C
uid           [ unknown] NØNOS Release Signing Key <releases@nonos.systems>
```

Cross-reference this fingerprint with:
- Official website: `https://nonos.software/keys/`
- GitHub repository: `https://github.com/NON-OS/nonos-kernel/blob/main/KEYS.md`
- Keybase: `https://keybase.io/nonos`

#### 3.5.4 Verify Signature

```bash
gpg --verify nonos-0.8.1-alpha.iso.sig nonos-0.8.1-alpha.iso
```

Expected output on success:
```
gpg: Signature made [DATE] using EDDSA key ID 7E4C3A9B2D1F6E8C
gpg: Good signature from "NØNOS Release Signing Key <releases@nonos.systems>" [unknown]
gpg: WARNING: This key is not certified with a trusted signature!
gpg:          There is no indication that the signature belongs to the owner.
Primary key fingerprint: 8A3F 2B7C 4D9E 1F6A 5C8B  3E2D 7E4C 3A9B 2D1F 6E8C
```

The "WARNING" about trust is expected for newly imported keys. The signature is valid if you have verified the fingerprint matches the official key.

### 3.6 Minisign Verification (Alternative)

For users preferring Minisign over GPG:

**NØNOS Minisign Public Key:**
```
RWQ8Kd5rCz6bPQSf4xXjK7NvLm2pHqYt1AeFgDhBwC9MsN3xV0Jy7P8Z
```

```bash
# Install minisign
# macOS: brew install minisign
# Linux: apt install minisign

# Verify
minisign -Vm nonos-0.8.1-alpha.iso -P RWQ8Kd5rCz6bPQSf4xXjK7NvLm2pHqYt1AeFgDhBwC9MsN3xV0Jy7P8Z
```

### 3.7 Ed25519 ISO Signature Verification (Direct)

For cryptographic verification without GPG or Minisign, raw Ed25519 signatures are provided.

**NØNOS ISO Release Ed25519 Public Key (hex):**
```
d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
```

**Signature file:** `nonos-0.8.1-alpha.iso.ed25519.sig` (64 bytes, raw Ed25519 signature)

Verification requires a tool that supports raw Ed25519 signature verification against the ISO file's SHA-256 hash.

### 3.8 Verification Failure Response

If verification fails:

1. **Do not use the downloaded ISO.**
2. **Re-download from the official source.**
3. **Verify using a different network** if re-download fails.
4. **Check for security advisories** at `https://nonos.software`
5. **Report the issue** to security@nonos.systems


## 4. Bootable USB Creation

### 4.1 Overview

The NØNOS disk image contains:

```
/EFI/nonos/
├── bootx64.efi      # UEFI bootloader (BOOTX64.EFI)
├── kernel.bin       # Signed kernel with ZK attestation
└── boot.cfg         # Boot configuration
```

The image must be written directly to the USB device (raw block copy), not copied as a file to an existing filesystem.

### 4.2 Linux Procedure

#### 4.2.1 Identify Target Device

```bash
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL
```

Example output:
```
NAME   SIZE TYPE MOUNTPOINT MODEL
sda    500G disk            Samsung SSD 860
├─sda1 512M part /boot/efi
├─sda2  50G part /
└─sda3 449G part /home
sdb     16G disk            SanDisk Cruzer
└─sdb1  16G part /media/usb
```

In this example, `sdb` is the USB drive. The target device is `/dev/sdb`.

#### 4.2.2 Unmount Target Device

```bash
sudo umount /dev/sdb*
```

#### 4.2.3 Write Image

```bash
sudo dd if=nonos-0.8.1-alpha.iso of=/dev/sdb bs=4M status=progress conv=fsync
sync
```

### 4.3 macOS Procedure

#### 4.3.1 Identify Target Device

```bash
diskutil list
```

#### 4.3.2 Unmount Target Device

```bash
diskutil unmountDisk /dev/diskN
```

#### 4.3.3 Write Image

```bash
sudo dd if=nonos-0.8.1-alpha.iso of=/dev/rdiskN bs=4m
```

#### 4.3.4 Eject

```bash
diskutil eject /dev/diskN
```

### 4.4 Windows Procedure

Use [Rufus](https://rufus.ie/) version 4.0 or later.

1. **Device:** Select your USB drive
2. **Boot selection:** Select the NØNOS ISO file
3. **Partition scheme:** Select **GPT**
4. **Target system:** Select **UEFI (non CSM)**

When prompted, select **Write in DD Image mode**.

### 4.5 Partition Scheme Technical Details

The NØNOS image creates the following partition layout:

```
+-----------------------------------------------------+
| Protective MBR (LBA 0)                              |
+-----------------------------------------------------+
| GPT Header (LBA 1)                                  |
+-----------------------------------------------------+
| GPT Partition Entry Array (LBA 2-33)                |
+-----------------------------------------------------+
| Partition 1: EFI System Partition                   |
| Type GUID: C12A7328-F81F-11D2-BA4B-00A0C93EC93B    |
| Start LBA: 2048 (1 MiB offset)                      |
| Filesystem: FAT32                                   |
| Contents:                                           |
|   /EFI/Boot/BOOTX64.EFI  (NØNOS bootloader)        |
|   /EFI/nonos/kernel.bin  (Signed kernel)           |
|   /EFI/nonos/boot.cfg    (Configuration)           |
+-----------------------------------------------------+
```


## 5. First Boot Technical Walkthrough

### 5.1 Bootloader Initialization

Upon power-on, the UEFI firmware loads `/EFI/Boot/BOOTX64.EFI` and transfers execution to the NØNOS bootloader.

**Initial console output:**
```
[BOOT] NONOS Bootloader v1.0
```

### 5.2 Stage 1: UEFI Environment

The bootloader validates its execution environment and displays system table addresses:

**Graphical log panel output:**
```
[+] GOP framebuffer initialized
[+] SystemTable      0x00000000XXXXXXXX
[+] BootServices     0x00000000XXXXXXXX
[+] RuntimeServices  0x00000000XXXXXXXX
[+] ConfigTable      0x00000000XXXXXXXX
    ConfigTableCount XX
[+] boot.toml loaded
```

Log prefixes indicate status:
- `[+]` — Success (green)
- `[!]` — Warning (yellow)
- `[X]` — Error (red)
- `    ` — Informational (dim)

### 5.3 Stage 2-3: Security Initialization

Security subsystems initialize and report status:

```
[+] SecureBoot ENABLED
```
or
```
    SecureBoot disabled
```

TPM status:
```
[+] TPM2 MeasuredBoot active
```
or
```
    TPM2 not available
```

Security policy enforcement:
```
[+] Security policy: ALLOW_BOOT
```

### 5.4 Stage 4: Hardware Discovery

System hardware is enumerated:

```
[+] ACPI RSDP @      0x00000000XXXXXXXX
[+] ACPI tables parsed
[+] PCI bus enumerated
[+] MemoryMap size   XXXXX bytes
```

### 5.5 Stage 5: Kernel Loading

The kernel binary is loaded from the ESP:

```
[+] kernel.bin       XXXXXXXXX bytes
[+] kernel base      0x00000000XXXXXXXX
[+] kernel end       0x00000000XXXXXXXX
[+] ELF header       7f454c4602010100
```

**If kernel not found:**
```
[X] FATAL: kernel.bin not found

[FATAL] kernel not found
System will restart...
```

### 5.6 Stage 6: BLAKE3 Hash Computation

The kernel code is hashed using BLAKE3-256:

```
  [CRYPTO] Computing BLAKE3 hash...
  [CRYPTO] BLAKE3: a1b2c3d4e5f6a7b8...
[+] BLAKE3-256 hash computed
[+] BLAKE3  a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8
          a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8
```

### 5.7 Stage 7: Ed25519 Signature Verification

The kernel signature is extracted and verified:

```
  [CRYPTO] Initializing keystore...
  [CRYPTO] Keystore initialized ................ [  OK  ]
  [CRYPTO] Extracting Ed25519 signature...
  [CRYPTO] Sig R: a1b2c3d4e5f6a7b8...
  [CRYPTO] Sig S: a1b2c3d4e5f6a7b8...
  [CRYPTO] Verifying Ed25519 signature...
  [CRYPTO] Ed25519 verify ....................... [PASS]
  [CRYPTO] Signer key ID: a1b2c3d4e5f6a7b8...
[+] Ed25519 signature VALID
```

**Signature verification failure:**
```
  [CRYPTO] Ed25519 verify ....................... [FAIL]
  [CRYPTO] ERROR: Signature does not match any trusted key
[X] Ed25519 signature INVALID

[FATAL] kernel signature invalid
System will restart...
```

### 5.8 Stage 8: ZK Attestation Verification

Zero-knowledge proof verification is **mandatory**. The bootloader verifies a Groth16 proof over BLS12-381:

```
[+] ZK proof block found
[+] Groth16/BLS12-381 VERIFIED
[+] ZK prog  a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8
[+] capsule a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8
```

**ZK proof magic bytes:** `0x4E 0xC3 0x5A 0x50`

**ZK proof missing:**
```
    ZK proof not present
[X] ZK proof MISSING

[FATAL] ZK proof missing - attestation required
System will restart...
```

**ZK proof invalid:**
```
[X] ZK attestation FAILED

[FATAL] ZK attestation invalid - Groth16 verification failed
System will restart...
```

### 5.9 Stage 9: ELF Parsing

The kernel ELF binary is parsed and loaded:

```
[+] ELF len    XXXXXXXXX bytes
[+] code_size  XXXXXXXXX bytes
[+] ELF64 parsed successfully
[+] entry      0x00000000XXXXXXXX
[+] base       0x00000000XXXXXXXX
[+] size       XXXXXXXXX bytes
    segments   X
```

### 5.10 Stage 10: Handoff

Entropy is collected and control transfers to the kernel:

```
[+] Entropy collected
[+] RNGseed  a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8
[+] CryptoHandoff prepared
[+] All boot stages COMPLETE
[+] jumping   0x00000000XXXXXXXX
```

### 5.11 Kernel Initialization

After the bootloader exits boot services and jumps to the kernel:

```
kernel online
```

If self-tests detect issues:
```
selftest degraded
```

**Out-of-memory condition:**
```
[OOM] ALLOCATION FAILED
[OOM] Requested size: XXXXX bytes, align: XX
[OOM] System halted - consider freeing memory or reducing usage
```


## 6. Desktop Initialization

### 6.1 Subsystem Initialization Order

The following subsystems initialize in order during desktop startup:

1. **VGA console** — Early text output
2. **Panic handler** — Error handling infrastructure
3. **Early boot** — Core kernel initialization
4. **Drivers** — Device driver initialization
5. **Self-tests** — Cryptographic and subsystem verification
6. **Scheduler** — Process scheduling (if enabled)
7. **Desktop environment** — Graphical interface

### 6.2 Network Mode Selection

NØNOS supports multiple network operational modes:

**Offline Mode (Default):** No network interfaces are activated.

**Direct Network Mode:** Direct connection to local network:
```
$ ifconfig eth0 up
$ dhclient eth0
```

**Anonymous Network Mode:** Traffic routes through integrated onion routing:
```
$ netmode anonymous
```

### 6.3 ZeroState Operational Semantics

**ZeroState** refers to the operational guarantee that the system maintains no persistent state.

Implications:

1. **All filesystems are volatile.** The root filesystem (`/`) is backed by RAM.
2. **No swap.** Memory exhaustion causes allocation failures, not disk swapping.
3. **No logs persist.** Kernel logs and shell history exist only in memory.
4. **No configuration changes persist.** System resets to defaults on every boot.
5. **Cryptographic keys are ephemeral.** Keys do not survive shutdown unless exported.

### 6.4 Filesystem Layout

The volatile filesystem presents a standard Unix-like hierarchy:

```
/
├── bin/        # Core utilities
├── dev/        # Device nodes
├── etc/        # Configuration files (defaults)
├── home/       # User home directories
│   └── user/   # Default user home
├── mnt/        # Mount points for external media
├── proc/       # Process information
├── root/       # Root user home
├── sys/        # System information
├── tmp/        # Temporary files
├── usr/        # User utilities
└── var/        # Variable data
```

All directories and their contents exist in RAM.

### 6.5 User File Storage

User files may be created anywhere in the filesystem. Common locations:

- `/home/user/` — Primary working directory
- `/tmp/` — Temporary files
- `/mnt/usb/` — Mounted USB storage (if attached)

**Files not saved to external media will be lost on shutdown.**

To save files persistently:

```bash
mount /dev/sdb1 /mnt/usb
cp ~/document.txt /mnt/usb/
sync
umount /mnt/usb
```


## 7. Persistence Warning

### 7.1 Volatile Memory Architecture

NØNOS operates exclusively from volatile memory (RAM). **All session data is lost when the system shuts down or loses power.**

The following are **irrecoverably lost** on power-off:

- All files created during the session
- All application state and preferences
- All shell history
- All network configuration
- All cryptographic keys generated during the session
- All clipboard contents
- All unsaved editor buffers
- All log files

There is no warning prompt before shutdown. There is no "save session" feature. There is no recovery mechanism.

### 7.2 External Media Persistence

Files explicitly written to external storage devices persist:

```bash
mount /dev/sdb1 /mnt/usb
cp ~/document.txt /mnt/usb/
sync
umount /mnt/usb
```

**External storage is not encrypted by default.**

### 7.3 Optional Persistence Modes

NØNOS Alpha does not support optional persistence modes. All operation is purely volatile.

### 7.4 Security Implications

**Volatile operation provides:**
- No forensic artifacts after power removal
- No persistent malware
- No accumulated browsing history, logs, or metadata
- Physical seizure resistance

**Volatile operation does not protect against:**
- Cold boot attacks (memory can be recovered briefly after power removal)
- Memory extraction from running system
- Network surveillance during operation

**RAM encryption:** NØNOS encrypts RAM contents using AES-256-GCM with keys stored only in CPU registers. Keys are cleared on shutdown.


## 8. Alpha Known Issues

### 8.1 Driver Limitations

#### 8.1.1 Graphics

| Issue | Description | Workaround |
|-------|-------------|------------|
| NVIDIA discrete GPUs | No native driver | Use integrated graphics; GOP framebuffer only |
| AMD discrete GPUs | Limited models supported | GOP framebuffer mode only |
| Resolution changes | Not supported at runtime | Set resolution in firmware |
| Multi-monitor | Not supported | Single display only |

#### 8.1.2 Storage

| Issue | Description | Workaround |
|-------|-------------|------------|
| SATA hot-plug | Not detected | Connect drives before boot |
| USB hot-plug | Intermittent detection | Remove and reinsert device |
| SD card readers | Some internal readers not detected | Use USB card reader |
| NVMe namespaces | Only namespace 1 accessed | N/A |

#### 8.1.3 Network

| Issue | Description | Workaround |
|-------|-------------|------------|
| WiFi | Experimental support; some access points incompatible | Use wired Ethernet for reliability |
| Bluetooth | No driver support | Not available |
| 2.5 GbE | Limited chipset support | Use 1 GbE port |

**Supported WiFi chipsets (experimental):**
- Intel AX200/201 (WiFi 6)
- Intel AX210/211 (WiFi 6E)
- Realtek RTL8821CE

**Supported USB Ethernet chipsets:**
- ASIX AX88179 (USB 3.0 gigabit)
- Realtek RTL8152/8153

#### 8.1.4 Input

| Issue | Description | Workaround |
|-------|-------------|------------|
| Touchpad | Fully supported | Click, movement, and basic gestures work |
| Multi-finger gestures | Advanced gestures not supported | Two-finger scroll works; three/four finger gestures unavailable |
| Touchscreen | Not supported | Use mouse or touchpad |
| Media keys | Not mapped | Not available |

### 8.2 Memory Pressure Behavior

| Available RAM | Behavior |
|---------------|----------|
| > 128 MiB | Normal operation |
| 64-128 MiB | Warning messages in kernel log |
| 32-64 MiB | Non-essential processes may fail to allocate |
| < 32 MiB | System instability; process creation fails |
| Exhausted | Kernel halt (OOM) |

**There is no OOM killer in alpha.** Memory exhaustion will halt the system.

### 8.3 Hardware Compatibility

#### 8.3.1 Tested Systems (Compatible)

| Vendor | Model | Notes |
|--------|-------|-------|
| HP | ProBook 450 G6 | Fully functional |
| HP | EliteBook 840 G5 | Fully functional |
| Dell | Latitude 7400 | Fully functional |
| Dell | Latitude 5520 | Fully functional |
| Lenovo | ThinkPad T480 | Fully functional |
| Lenovo | ThinkPad X1 Carbon Gen 7 | Fully functional |
| QEMU | KVM with OVMF | Fully functional |
| VMware | Workstation 17 | Fully functional |
| VirtualBox | 7.0+ | Requires EFI mode enabled |

#### 8.3.2 Known Problematic Systems

| Vendor | Model | Issue |
|--------|-------|-------|
| Apple | MacBook (T2 chip) | T2 blocks unsigned boot |
| Apple | Mac Studio (M1/M2) | ARM architecture not supported |
| Microsoft | Surface Pro (pre-2020) | Firmware compatibility issues |
| Chromebooks | Various | Custom firmware required |

### 8.4 Crash Reporting Process

NØNOS Alpha does not include automatic crash reporting. If you experience a kernel panic:

1. **Photograph the screen** if a panic message is displayed
2. **Note the circumstances** (operation, time since boot, hardware)
3. **Report via GitHub Issues:** `https://github.com/NON-OS/nonos-kernel/issues`


## 9. Safe Shutdown Procedure

### 9.1 Standard Shutdown

Execute the shutdown command:

```bash
$ shutdown
```

### 9.2 Shutdown Sequence

The shutdown procedure executes:

1. **Process termination** — SIGTERM, then SIGKILL
2. **Filesystem sync** — Flushes mounted external media
3. **Network shutdown** — Interfaces brought down
4. **Secure memory wipe** — Memory overwritten with random data, then zeroed
5. **Register clearing** — CPU registers containing keys zeroed
6. **Power off** — ACPI power-off command

### 9.3 What Does Not Happen

- **No disk writes** — Boot media is not modified
- **No hibernation** — State is not saved
- **No suspend** — Suspend requests trigger full shutdown

### 9.4 Forced Power-Off Risks

If power is removed without proper shutdown:

- RAM encryption keys remain in CPU registers until power loss
- RAM contents persist briefly (seconds to minutes at room temperature)
- Cold boot attack window is not minimized by secure wipe

**Recommendation:** Always use proper shutdown when possible.


## 10. Troubleshooting

### 10.1 Black Screen at Boot

| Cause | Solution |
|-------|----------|
| Boot media not detected | Verify USB is seated; try different port |
| CSM enabled | Disable CSM; enable UEFI-only boot |
| Secure Boot blocking | Disable Secure Boot |
| Wrong boot order | Set USB device as first boot option |
| GOP not available | Use motherboard video output |

**Serial console diagnostics:** Connect to COM1 at 115200 baud.

### 10.2 Signature Verification Failure

```
[CRYPTO] Ed25519 verify ....................... [FAIL]
[CRYPTO] ERROR: Signature does not match any trusted key

[FATAL] kernel signature invalid
```

**Causes:**
1. ISO corruption during download — Re-download and verify checksum
2. USB write failure — Re-write to USB
3. ISO modification — Use only official ISOs

**This error cannot be bypassed.**

### 10.3 ZK Proof Verification Failure

```
[X] ZK attestation FAILED

[FATAL] ZK attestation invalid - Groth16 verification failed
```

**Causes:**
1. ISO corruption — Re-download and verify
2. Write failure — Re-write USB media

**This error cannot be bypassed.**

### 10.4 No Keyboard Input

| Cause | Solution |
|-------|----------|
| USB keyboard not detected | Try PS/2 keyboard |
| USB controller not initialized | Try USB 2.0 port |
| USB hub not supported | Connect directly to system port |

### 10.5 No Network Connectivity

```bash
$ ifconfig -a          # Show all interfaces
$ dmesg | grep -i eth  # Check driver messages
$ lspci | grep -i net  # List network devices
```

| Cause | Solution |
|-------|----------|
| Interface down | `ifconfig eth0 up` then `dhclient eth0` |
| No driver for chipset | Use USB Ethernet adapter |
| DHCP failure | Configure static IP |

### 10.6 Kernel Panic / OOM

```
[OOM] ALLOCATION FAILED
[OOM] Requested size: XXXXX bytes, align: XX
[OOM] System halted - consider freeing memory or reducing usage
```

**Mitigation:**
1. Use system with more RAM
2. Close unnecessary processes
3. Reboot for fresh memory state

### 10.7 Serial Console Setup

For debugging without functional display:

**Hardware:** Connect null modem cable to COM1

**Host Terminal:**

Linux:
```bash
screen /dev/ttyUSB0 115200
```

macOS:
```bash
screen /dev/tty.usbserial-* 115200
```

**Settings:** 115200 baud, 8N1, no flow control

### 10.8 Diagnostic Commands

| Command | Purpose |
|---------|---------|
| `dmesg` | Display kernel message buffer |
| `free` | Show memory usage |
| `ps` | List processes |
| `lspci` | List PCI devices |
| `lscpu` | Show CPU information |
| `ifconfig -a` | Show all network interfaces |
| `uname -a` | Show system identification |


## Appendix A: Cryptographic Keys Reference

### A.1 Kernel Signing Key Architecture

The NØNOS bootloader embeds an Ed25519 public key at compile time. This key is derived from the 32-byte seed provided during the build process.

**Build-Time Key Embedding:**
```
Source:      keys/signing_key_v1.bin (32-byte Ed25519 seed)
             or NONOS_SIGNING_KEY environment variable
Derivation:  Ed25519 public key derived via PyNaCl/cryptography
Embedding:   Compiled into bootloader binary
Key ID:      BLAKE3 derived with domain "NONOS:KEYID:ED25519:v1"
```

**Official Release Key (0.8.0-alpha):**

The official NØNOS 0.8.0-alpha release is signed with the following key:

```
Algorithm:   Ed25519 (RFC 8032)
Public Key:  [Embedded at build time - see release notes]
Key ID:      [Derived at build time]
Key Version: 1
```

To verify you have an authentic NØNOS release, the kernel signature verification must pass during boot. The bootloader displays:
```
[CRYPTO] Ed25519 verify ....................... [PASS]
[CRYPTO] Signer key ID: [first 8 bytes of key ID]...
```

### A.2 ZK Attestation Keys (Production)

The following ZK verification keys are embedded in the bootloader and used to verify Groth16 proofs during boot. These are **real production keys**.

**Boot Authority Circuit:**
```
Program Hash:    fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230
Curve:           BLS12-381
Proof System:    Groth16
VK Size:         576 bytes
VK Fingerprint:  0dfecffbbc4cf00a97771ca2eb3add4a5c5afba5fa5b1f262436b5ce73d27228
Domain:          NONOS:VK:FINGERPRINT:v1
Purpose:         Boot attestation, kernel integrity
```

**Update Authority Circuit:**
```
Program Hash:    8b3ca7195ef2710adc4592b86d33aa4f17e9285c447bf6913ace08d5621f73e4
Purpose:         System update authorization
```

**Recovery Key Circuit:**
```
Program Hash:    2f9158c4a36bdd876e1249f5708ce13ab924670d5fa83c16ee7d954201bacf58
Purpose:         Emergency recovery operations
```

### A.3 ISO Release Signing Key (GPG)

Official ISO images are signed with the NØNOS release GPG key.

```
Key Type:        Ed25519 (GnuPG 2.3+)
Key ID:          0x7E4C3A9B2D1F6E8C
Fingerprint:     8A3F 2B7C 4D9E 1F6A 5C8B  3E2D 7E4C 3A9B 2D1F 6E8C
UID:             NØNOS Release Signing Key <releases@nonos.systems>
Created:         2026-01-15
Expires:         2028-01-15
Keyserver:       keys.openpgp.org
```

### A.4 ISO Release Signing Key (Minisign)

Alternative signature verification using Minisign.

```
Algorithm:       Ed25519
Public Key:      RWQ8Kd5rCz6bPQSf4xXjK7NvLm2pHqYt1AeFgDhBwC9MsN3xV0Jy7P8Z
```

### A.5 ISO Release Signing Key (Raw Ed25519)

For direct Ed25519 verification without GPG or Minisign.

```
Algorithm:       Ed25519
Public Key:      d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
Signature File:  nonos-0.8.1-alpha.iso.ed25519.sig (64 bytes raw)
```

### A.6 Key Generation

Generate a new kernel signing key:

```bash
cd nonos-boot/tools/keygen
cargo build --release

./target/release/nonos-keygen \
  --count 1 \
  --out-dir ../../keys \
  --allow-write-secrets \
  --operator "release@nonos.systems"
```

Output:
```
keys/
  signer1.key           # 32-byte secret seed (PROTECT THIS)
  signer1.pub.raw       # 32-byte public key
  signer1.pub.hex       # Public key in hex
  generation_log.json   # Audit trail
```

### A.7 Key Verification

Verify ZK verifying key fingerprint:

```bash
# Compute fingerprint using BLAKE3 with domain separator
python3 -c "
import blake3
vk = open('zk-artifacts/attestation_verifying_key.bin', 'rb').read()
h = blake3.blake3(vk, derive_key_context='NONOS:VK:FINGERPRINT:v1')
print(h.hexdigest())
"

# Expected: 0dfecffbbc4cf00a97771ca2eb3add4a5c5afba5fa5b1f262436b5ce73d27228
```

### A.8 Key Rotation Policy

| Key Type | Validity | Rotation |
|----------|----------|----------|
| Kernel signing | Per release | New key per major version |
| ZK verifying keys | Indefinite | Circuit upgrade only |
| ISO release (GPG) | 2 years | 3 months before expiry |
| Revocation list | Real-time | Upon compromise |

Revoked keys: `https://nonos.software/keys/revoked.txt`


## Appendix B: ZK Attestation Technical Details

### B.1 Proof System

| Parameter | Value |
|-----------|-------|
| Curve | BLS12-381 |
| Proof System | Groth16 (zkSNARK) |
| Constraint System | R1CS |
| Security Level | ~128 bits |
| Proof Size | 192 bytes (2 G1 + 1 G2 points) |
| Verification | 3 pairings |

### B.2 ZK Proof Block Format

The ZK proof block is appended to the signed kernel binary:

```
Offset  Size    Field
──────────────────────────────────────────
0x00    4       Magic: 0x4E 0xC3 0x5A 0x50
0x04    4       Version: 0x00000001
0x08    32      Program Hash
0x28    32      Capsule Commitment
0x48    8       Timestamp (Unix epoch)
0x50    192     Groth16 Proof (π_A, π_B, π_C)
0x110   varies  Public Inputs
```

### B.3 Boot Authority Circuit

```
Program Hash:     fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230
VK Fingerprint:   0dfecffbbc4cf00a97771ca2eb3add4a5c5afba5fa5b1f262436b5ce73d27228
Key Gen Seed:     nonos-production-attestation-v1-2026
Circuit Name:     boot-authority
Version:          1.0.0
Permissions:      BootAuthority | Attestation
```

### B.4 Verification Flow

```
1. Parse ZK block from kernel binary
2. Verify magic bytes == 0x4EC35A50
3. Extract program hash
4. Lookup verifying key by program hash
5. Verify Groth16 proof: e(π_A, π_B) = e(α, β) · e(L, γ) · e(π_C, δ)
6. Validate public inputs
7. Boot proceeds only if verification passes
```

### B.5 Generating New Attestation Proofs

```bash
# Generate ZK keys (trusted setup)
make generate-zk-keys

# Generate proof for kernel
make generate-zk-proof

# Embed proof into signed kernel
make embed-zk-proof
```

Output: `target/kernel_attested.bin`


## Appendix C: Build from Source

```bash
git clone https://github.com/NON-OS/nonos-kernel
cd nonos-kernel
make all
make iso
```

**Output:** `target/nonos.iso`

**Write to USB:**
```bash
dd if=target/nonos.iso of=/dev/sdX bs=4M status=progress
```


## Appendix D: GPT Partition Type GUIDs

| Type | GUID |
|------|------|
| EFI System Partition | `C12A7328-F81F-11D2-BA4B-00A0C93EC93B` |


## Appendix E: Release Signing Key Generation

For release maintainers, generate the GPG release signing key:

```bash
# Generate Ed25519 key (requires GnuPG 2.3+)
gpg --quick-gen-key "NØNOS Release Signing Key <releases@nonos.systems>" ed25519 sign 2y

# Export public key
gpg --armor --export releases@nonos.systems > release-signing-key.asc

# Upload to keyserver
gpg --keyserver keys.openpgp.org --send-keys [KEY_ID]
```

**Key storage requirements:**
- Private key stored in HSM or air-gapped system
- Backup copies in geographically distributed secure locations
- Key ceremony documented with witnesses


## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | March 2026 | Initial release for NØNOS 0.8.1-alpha |


**NØNOS: Sovereignty From Ø**

**nonos.software**


Licensed under GNU Affero General Public License v3.0

Copyright (C) 2026 NØNOS Contributors
