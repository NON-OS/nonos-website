---
title: "Memory and Hardware Architecture"
description: "Complete NØNOS memory and hardware architecture specification"
weight: 20

# NØNOS Memory and Hardware Architecture Specification

**Version 0.8.0** | March 2026


## 1. CPU Mode Transition

The NØNOS bootloader executes as a UEFI application targeting the x86_64-unknown-uefi platform. UEFI firmware completes the transition from real mode through protected mode to long mode before the bootloader receives control. The bootloader inherits a 64-bit execution environment with paging enabled and identity-mapped physical memory.

The bootloader prepares the kernel execution environment, constructs the boot handoff structure, and transfers control to the kernel entry point. At kernel entry, the processor executes in ring 0 with interrupts disabled. The RDI register holds a pointer to the BootHandoffV1 structure containing memory maps, ACPI pointers, and firmware state.

### 1.1 Control Register State

CR0 enters the kernel with protected mode enabled (PE, bit 0), paging enabled (PG, bit 31), write protect active (WP, bit 16), and numeric error reporting enabled (NE, bit 5). The emulation bit (EM, bit 2) is cleared to permit SSE execution. The task switched bit (TS, bit 3) is cleared.

CR3 contains the physical address of the PML4 table established by the bootloader. The kernel replaces this page table after initializing its own memory management.

CR4 enables physical address extension (PAE, bit 5), page global enable (PGE, bit 7), SSE support (OSFXSR, bit 9), and SSE exception handling (OSXMMEXCPT, bit 10). On supporting hardware, the kernel enables supervisor mode execution prevention (SMEP, bit 20) and supervisor mode access prevention (SMAP, bit 21). The FSGSBASE bit (bit 16) permits direct manipulation of FS and GS base registers.

### 1.2 Extended Feature Enable Register

The EFER MSR at address 0xC0000080 enters the kernel with long mode enabled (LME, bit 8), long mode active (LMA, bit 10), and no-execute page protection enabled (NXE, bit 11). The kernel enables the SYSCALL extension (SCE, bit 0) during initialization.

### 1.3 Model-Specific Registers

The kernel configures SYSCALL/SYSRET registers during initialization. MSR 0xC0000081 (STAR) receives the segment selectors for kernel and user modes. MSR 0xC0000082 (LSTAR) receives the syscall handler address. MSR 0xC0000084 (SFMASK) receives a mask of RFLAGS bits to clear on syscall entry, specifically interrupt enable (bit 9), direction (bit 10), trap (bit 8), alignment check (bit 18), and IOPL (bits 12-13).

FS and GS base addresses occupy MSRs 0xC0000100 and 0xC0000101 respectively. The kernel GS base for SWAPGS resides at MSR 0xC0000102.

### 1.4 Boot Stack

The initial boot stack occupies physical memory from 0x100000 to 0x110000, providing 64 KiB of stack space. The stack pointer initializes to 0x10FFF0, aligned to 16 bytes per the System V ABI. The kernel allocates per-CPU stacks after memory management initialization.


## 2. Physical Memory Layout

### 2.1 Reserved Regions

Physical addresses below 1 MiB contain legacy firmware structures. The real mode interrupt vector table occupies addresses 0x00000 through 0x003FF. The BIOS data area spans 0x00400 through 0x004FF. Extended BIOS data may appear at the address stored at 0x0040E. The VGA text buffer maps to 0xB8000 through 0xBFFFF. The BIOS ROM occupies 0xE0000 through 0xFFFFF.

The kernel identity maps these regions for early boot diagnostics. The VGA text buffer remains accessible for panic output.

### 2.2 Kernel Load Address

The bootloader loads the kernel binary at physical address 0x100000 (1 MiB). The kernel text section begins at this address. The bootloader parses the kernel ELF headers to determine section sizes and establishes mappings accordingly.

### 2.3 Page Table Memory

The bootloader allocates page table memory from high physical addresses to avoid conflicts with the kernel image. Initial page tables occupy approximately 16 KiB for the identity mapping and an additional 16 KiB for the kernel high-half mapping.

### 2.4 Direct Physical Map

The kernel establishes a direct mapping of physical memory at virtual address 0xFFFFFFFFB0000000. This mapping provides kernel access to any physical address by adding the base offset. The initial mapping covers 256 MiB and expands as the kernel discovers additional memory through the memory map.

### 2.5 ACPI Regions

The bootloader passes ACPI region locations through the boot handoff structure. ACPI reclaimable memory (type 3) contains tables that the kernel may reclaim after parsing. ACPI NVS memory (type 4) must remain untouched throughout system operation. The kernel maps ACPI regions into the fixmap area for table access.

### 2.6 Memory Map Processing

The boot handoff memory map follows UEFI conventions. Region types include usable (1), reserved (2), ACPI reclaimable (3), ACPI NVS (4), and MMIO (7). The kernel physical allocator consumes only usable regions, maintaining a bitmap to track frame availability.

### 2.7 Physical Allocator Constants

| Parameter | Value | Description |
|-----------|-------|-------------|
| Max Physical Memory | 64 GiB | `0x1000000000` |
| Max Frame Count | 16,777,216 | Frames at 4 KiB each |
| Max Bitmap Size | 2 MiB | Frame tracking bitmap |

### 2.8 Buddy Allocator Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Minimum Order | 12 | 4 KiB (PAGE_SIZE) |
| Maximum Order | 20 | 1 MiB |
| Free List Count | 9 | Orders 12-20 |
| Min Block Size | 4,096 bytes | 2^12 |
| Max Block Size | 1,048,576 bytes | 2^20 |

**Allocation Flags:**

| Flag | Value | Description |
|------|-------|-------------|
| ALLOC_FLAG_ZERO | 0x0001 | Zero-fill allocation |
| ALLOC_FLAG_DMA | 0x0002 | DMA-suitable region |
| ALLOC_FLAG_UNCACHED | 0x0004 | Uncached mapping |
| ALLOC_FLAG_WRITE_COMBINE | 0x0008 | Write-combining |
| ALLOC_FLAG_USER | 0x0010 | User-accessible |
| ALLOC_FLAG_EXEC | 0x0020 | Executable |

### 2.9 KASLR Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Default Window | 1 GiB | `0x40000000` |
| Min Slide | 256 MiB | `0x10000000` |
| Max Slide | 2 GiB | `0x80000000` |
| Safe Slide Min | 16 MiB | `0x1000000` |
| Safe Slide Max | 4 GiB | `0x100000000` |
| Hash Output | 32 bytes | SHA3-256 |


## 3. Virtual Address Space Layout

The x86_64 architecture enforces canonical address requirements. Valid addresses occupy two ranges: 0x0000000000000000 through 0x00007FFFFFFFFFFF for user space, and 0xFFFF800000000000 through 0xFFFFFFFFFFFFFFFF for kernel space. Addresses between these ranges fault on access.

### 3.1 User Space

User processes occupy virtual addresses from 0x0000000000000000 through 0x00007FFFFFFFFFFF. The kernel reserves no specific addresses within user space. Process address space layouts follow standard conventions with text at low addresses, heap growing upward, and stack growing downward from the canonical limit.

### 3.2 Kernel Address Regions

The kernel occupies the upper half of the virtual address space with the following layout:

| Region | Virtual Address | Size | Description |
|--------|-----------------|------|-------------|
| Kernel Text | `0xFFFF_FFFF_8000_0000` | 32 MiB | Executable code |
| Kernel Data | `0xFFFF_FFFF_A000_0000` | 32 MiB | Initialized/uninitialized data |
| Direct Physical Map | `0xFFFF_FFFF_B000_0000` | 256 MiB | Identity map of physical memory |
| Kernel Heap | `0xFFFF_FF00_0000_0000` | 256 MiB | Dynamic allocations |
| KVM (Virtual Memory) | `0xFFFF_FF10_0000_0000` | 512 MiB | Kernel virtual allocator |
| MMIO Region | `0xFFFF_FF30_0000_0000` | 512 MiB | Device registers |
| VMAP Region | `0xFFFF_FF50_0000_0000` | 256 MiB | Temporary mappings |
| DMA Region | `0xFFFF_FF60_0000_0000` | 256 MiB | DMA buffer allocations |
| FIXMAP Region | `0xFFFF_FFA0_0000_0000` | 64 GiB | Boot-time and ACPI mappings |
| Boot Identity Map | `0xFFFF_FFB0_0000_0000` | 256 MiB | Early boot identity mapping |
| Per-CPU Data | `0xFFFF_FFC0_0000_0000` | 1 GiB | Per-processor state (16 MiB × 64 CPUs) |
| Per-CPU Stacks | `0xFFFF_FFD0_0000_0000` | 1 GiB | Per-processor kernel stacks |
| KPTI Trampoline | `0xFFFF_FFFF_FFFE_0000` | 64 KiB | User/kernel transition pages |

### 3.3 Canonical Address Boundaries

| Boundary | Address | Description |
|----------|---------|-------------|
| User Space Max | `0x0000_7FFF_FFFF_FFFF` | Maximum user-accessible address |
| Kernel Space Min | `0xFFFF_8000_0000_0000` | Minimum kernel address |
| Physical Address Max | `0x0000_FFFF_FFFF_FFFF` | 52-bit physical addressing limit |

### 3.4 Stack Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Kernel Stack Size | 64 KiB | Per-CPU kernel stack |
| IST Stack Size | 32 KiB | Interrupt Stack Table stacks |
| IST Stacks per CPU | 8 | NMI, DF, MCE, Debug, PF, GP, etc. |
| Guard Pages | 1 | Unmapped page before each stack |
| Maximum CPUs | 64 | Per-CPU stride = 16 MiB |

### 3.3 Guard Pages

Stack regions include guard pages to detect overflow. One guard page (4 KiB, unmapped) precedes each kernel stack. Stack overflow attempts fault immediately rather than corrupting adjacent memory.

### 3.4 W^X Enforcement

The kernel enforces write XOR execute protection. Pages may be writable or executable but never both simultaneously. The kernel text section maps with read and execute permissions. The kernel data and heap map with read and write permissions. User process memory follows the same constraint, with code pages executable and data pages writable.

Page table entries use the no-execute bit (bit 63) to prevent execution. The EFER.NXE bit must remain set for this protection to function.


## 4. Paging Hierarchy

### 4.1 Four-Level Page Tables

NØNOS uses the standard x86_64 four-level page table hierarchy: PML4, PDPT, PD, and PT. Each level contains 512 entries of 8 bytes each, occupying exactly one 4 KiB page.

Virtual address translation extracts indices from the address: bits 47-39 index the PML4, bits 38-30 index the PDPT, bits 29-21 index the PD, and bits 20-12 index the PT. The final 12 bits provide the page offset.

### 4.2 Page Table Entry Format

Each page table entry contains a physical address and flags. The physical address occupies bits 12-51, providing support for 52-bit physical addressing.

**PTE Flag Bits:**

| Bit | Name | Description |
|-----|------|-------------|
| 0 | Present (P) | Valid mapping |
| 1 | Writable (R/W) | Write access permitted |
| 2 | User (U/S) | Ring 3 access permitted |
| 3 | Write-Through (PWT) | Write-through caching |
| 4 | Cache Disable (PCD) | Caching disabled |
| 5 | Accessed (A) | Set by hardware on access |
| 6 | Dirty (D) | Set by hardware on write |
| 7 | Huge Page (PS) | 2 MiB (PD) or 1 GiB (PDPT) |
| 8 | Global (G) | Survives CR3 switch |
| 63 | No Execute (NX) | Instruction fetch prohibited |

**Physical Address Mask:** `0x000F_FFFF_FFFF_F000` (bits 12-51)

**Page Sizes:**

| Size | Bytes | Hex | Level |
|------|-------|-----|-------|
| 4 KiB | 4,096 | 0x1000 | PT entry |
| 2 MiB | 2,097,152 | 0x200000 | PD huge page |
| 1 GiB | 1,073,741,824 | 0x40000000 | PDPT giant page |

**Virtual Address Index Extraction:**

| Level | Bits | Mask | Shift |
|-------|------|------|-------|
| PML4 | 47-39 | 0x1FF | 39 |
| PDPT | 38-30 | 0x1FF | 30 |
| PD | 29-21 | 0x1FF | 21 |
| PT | 20-12 | 0x1FF | 12 |
| Offset | 11-0 | 0xFFF | 0 |

**Page Fault Error Codes:**

| Bit | Name | Description |
|-----|------|-------------|
| 0 | PF_PRESENT | Page was present |
| 1 | PF_WRITE | Write access |
| 2 | PF_USER | User mode |
| 3 | PF_RESERVED | Reserved bit violation |
| 4 | PF_INSTRUCTION | Instruction fetch |
| 5 | PF_PROTECTION_KEY | Protection key violation |
| 6 | PF_SHADOW_STACK | Shadow stack access |

### 4.3 Kernel PML4 Entries

The kernel occupies PML4 entries 256 through 511 (the upper half). Entry 256 corresponds to virtual address 0xFFFF800000000000. All processes share these kernel entries to avoid TLB invalidation on context switch.

User space occupies PML4 entries 0 through 255. Each process receives a private PML4 with entries 0-255 mapped to process-specific page tables and entries 256-511 copied from the kernel PML4.

### 4.4 Recursive Mapping

PML4 entry 510 points to the PML4 itself, establishing a recursive mapping. This arrangement permits page table manipulation through virtual addresses without maintaining separate mappings for each table page. The recursive mapping base address is 0xFFFFFF7FBFDFE000.

### 4.5 TLB Management

Translation lookaside buffer entries cache recent translations. The kernel issues INVLPG instructions to invalidate individual entries after unmapping. CR3 writes flush all non-global entries. Global pages (kernel mappings with the G bit set) survive CR3 switches.

On multiprocessor systems, TLB shootdown IPIs notify other cores of mapping changes. The kernel tracks which cores require notification based on address space usage.


## 5. ACPI Parsing

### 5.1 RSDP Discovery

The bootloader locates the Root System Description Pointer through UEFI configuration tables. The RSDP signature consists of the eight bytes "RSD PTR " at a 16-byte aligned address. Legacy BIOS search locations include the extended BIOS data area (address stored at 0x040E) and the BIOS ROM region from 0xE0000 to 0xFFFFF.

The RSDP structure contains a checksum, OEM identifier, revision number, and RSDT physical address. Revision 0 indicates ACPI 1.0 with a 32-bit RSDT pointer. Revision 2 or higher indicates ACPI 2.0+ with an extended structure containing a 64-bit XSDT address.

Checksum validation sums all bytes in the structure. The sum must equal zero modulo 256. Extended RSDP structures require validation of both the base checksum and the extended checksum.

### 5.2 XSDT/RSDT Parsing

The Extended System Description Table (XSDT, signature "XSDT") contains 64-bit pointers to other tables. The Root System Description Table (RSDT, signature "RSDT") contains 32-bit pointers. The kernel prefers XSDT when available.

Each table begins with a standard header containing signature, length, revision, checksum, OEM identifier, OEM table identifier, OEM revision, creator identifier, and creator revision. The kernel validates the checksum before interpreting table contents.

Table discovery iterates through XSDT entries, reading each pointer and validating the referenced table header.

### 5.3 MADT Interpretation

The Multiple APIC Description Table (signature "APIC") describes the interrupt controller configuration. The fixed portion contains the local APIC physical address and flags. The PCAT_COMPAT flag (bit 0) indicates the presence of legacy 8259 PICs that require masking.

Following the fixed portion, variable-length entries describe processors, I/O APICs, and interrupt routing. Entry type 0 describes local APIC structures with processor ID, APIC ID, and enabled flag. Entry type 1 describes I/O APICs with ID, physical address, and GSI base. Entry type 2 describes interrupt source overrides mapping ISA IRQs to global system interrupts with polarity and trigger mode. Entry type 4 describes local APIC NMI configuration. Entry type 5 overrides the local APIC address. Entry type 9 describes x2APIC processors.

The kernel iterates entries by reading the two-byte header (type and length) and advancing by the length value. Entries with unrecognized types are skipped. Entries extending beyond the table boundary terminate parsing.

### 5.4 Interrupt Routing

Interrupt source override entries remap legacy ISA interrupts. Without an override, IRQ N maps to GSI N. Each override specifies the source IRQ, target GSI, polarity (active high or active low), and trigger mode (edge or level). The kernel maintains a translation table for interrupt routing.

### 5.5 Error Handling

Malformed ACPI tables trigger fallback behavior rather than system failure. Invalid checksums cause table rejection with a warning log. Missing required tables (MADT) result in uniprocessor operation with default interrupt configuration. Truncated entries terminate parsing of the affected table. The kernel logs anomalies for diagnostic purposes.


## 6. Interrupt Architecture

### 6.1 Legacy PIC Disablement

The kernel disables the 8259 Programmable Interrupt Controllers during initialization. Disablement proceeds by masking all interrupts on both controllers. The master PIC command port resides at 0x20 with data at 0x21. The slave PIC command port resides at 0xA0 with data at 0xA1. Writing 0xFF to both data ports masks all IRQs.

On systems with the IMCR (Interrupt Mode Control Register), the kernel writes 0x70 to port 0x22 followed by 0x01 to port 0x23 to route interrupts through the APIC.

### 6.2 Local APIC Configuration

The Local APIC controls interrupt delivery to each processor core. The base address defaults to 0xFEE00000 but may be overridden by MADT entry type 5. The kernel maps this address into the MMIO region.

Initialization enables the APIC by setting bit 8 of the Spurious Vector Register at offset 0x0F0. The spurious vector uses 0xFF. The kernel programs the Task Priority Register at offset 0x080 to zero, accepting all interrupt priorities.

Timer configuration uses the LVT Timer register at offset 0x320. The kernel selects periodic mode (bit 17) with vector 0x20. The initial count register at offset 0x380 and divide configuration register at offset 0x3E0 control timer frequency.

Error handling uses the LVT Error register at offset 0x370 with vector 0x22.

End of interrupt signaling writes zero to offset 0x0B0 after handling any interrupt.

### 6.3 I/O APIC Configuration

I/O APICs route external interrupts to processors. Each I/O APIC provides 24 redirection entries mapping global system interrupts to APIC delivery. The base address comes from MADT entry type 1, typically 0xFEC00000.

Register access uses memory-mapped I/O with an indirect addressing scheme. Writing the register number to offset 0x00 (IOREGSEL) selects the register. Reading or writing offset 0x10 (IOWIN) accesses the selected register.

Redirection entries occupy two 32-bit registers each, starting at register 0x10 for GSI 0. The low 32 bits contain the vector number (bits 0-7), delivery mode (bits 8-10), destination mode (bit 11), delivery status (bit 12), polarity (bit 13), remote IRR (bit 14), trigger mode (bit 15), and mask (bit 16). The high 32 bits contain the destination APIC ID (bits 24-31 in physical mode).

### 6.4 Vector Assignment

Exception vectors occupy 0 through 31. Vector 0 handles divide errors. Vector 6 handles invalid opcodes. Vector 8 handles double faults. Vector 13 handles general protection faults. Vector 14 handles page faults.

The Local APIC timer uses vector 0x20. Thermal monitoring uses vector 0x21. APIC error uses vector 0x22.

External interrupts from I/O APICs use vectors 0x30 through 0x7E. The kernel assigns vectors dynamically during interrupt routing configuration.

The syscall software interrupt uses vector 0x80.

Inter-processor interrupts use vectors 0x40 (TLB shootdown), 0x41 (reschedule), 0x42 (panic), 0x43 (stop), 0x44 (call function), and 0x45 (barrier).

The spurious interrupt vector is 0xFF.

### 6.5 Timer Source

The Local APIC timer provides the primary timing source. The kernel calibrates timer frequency against a reference (typically PIT or TSC) during boot. Periodic mode generates interrupts at consistent intervals for scheduler preemption.

Systems with TSC deadline mode support may use MSR 0x6E0 for precise timer programming.


## 7. SMP Architecture

### 7.1 Processor Discovery

The kernel discovers processors through MADT parsing. Local APIC entries (type 0) and x2APIC entries (type 9) enumerate available processors. Each entry contains the processor UID and APIC ID. The enabled flag (bit 0) indicates whether the processor is available. The online capable flag (bit 1) indicates hot-plug capability.

The kernel maintains a processor descriptor array indexed by APIC ID. Maximum supported processors is 256.

### 7.2 Application Processor Startup

The bootstrap processor (BSP) starts application processors (APs) through the INIT-SIPI-SIPI sequence. The AP trampoline code resides at physical address 0x8000, within the first 1 MiB to satisfy 16-bit addressing requirements.

Startup proceeds by sending an INIT IPI to the target processor, waiting 10 milliseconds, then sending two SIPI IPIs 200 microseconds apart. The SIPI vector field contains the physical page number of the trampoline code (0x08 for address 0x8000).

The trampoline code transitions from real mode to protected mode to long mode, establishes a stack, and jumps to the ap_entry function.

### 7.3 Per-CPU State

Each processor maintains private state including kernel stack, TSS, GDT, and IDT. The per-CPU data region provides 16 MiB per processor at staggered virtual addresses starting from 0xFFFFFFC000000000.

Kernel stacks occupy 64 KiB per processor. IST stacks for double fault, NMI, and machine check occupy 32 KiB each.

### 7.4 Inter-Processor Interrupts

IPI delivery uses the Local APIC Interrupt Command Register. The low register at offset 0x300 contains the vector, delivery mode, destination mode, level, trigger mode, and shorthand. The high register at offset 0x310 contains the destination APIC ID.

Defined IPI vectors serve specific purposes. Vector 0x40 triggers TLB invalidation on remote processors. Vector 0x41 requests rescheduling. Vector 0x42 broadcasts panic state. Vector 0x43 halts remote processors.

IPI handlers check pending flags in the per-CPU descriptor and perform requested actions. The idle loop polls these flags between halt instructions.

### 7.5 Synchronization

AP startup uses an atomic barrier counter. Each AP increments the barrier after completing initialization. The BSP spins until all expected APs have reported ready.

Cross-processor function calls use a work queue per CPU. The initiating processor enqueues work and sends an IPI. The target processor processes the queue and signals completion through an atomic flag.


## 8. DMA and IOMMU

### 8.1 Current DMA Support

The kernel provides coherent and streaming DMA interfaces. Coherent allocations return memory with consistent CPU and device views, suitable for descriptor rings and command structures. Streaming mappings provide temporary access for data buffers.

DMA constraints specify alignment requirements, maximum segment sizes, and address restrictions. The dma32_only constraint limits allocations to physical addresses below 4 GiB for devices with 32-bit addressing limitations.

Bounce buffers handle cases where the source buffer does not meet DMA constraints. The kernel allocates a compliant buffer, copies data before device access (for device writes), performs the DMA operation, and copies data back (for device reads).

### 8.2 DMA Region Layout

The kernel reserves virtual addresses 0xFFFFFF6000000000 through 0xFFFFFF6FFFFFFFFF (256 MiB) for DMA buffer mappings. Physical frames for DMA come from dedicated pools to ensure constraint satisfaction.

### 8.3 IOMMU Status

IOMMU support is not currently implemented. All DMA operations use identity-mapped physical addresses. Devices receive physical addresses directly without translation.

### 8.4 Security Implications

Without IOMMU protection, malicious or buggy devices can access arbitrary physical memory through DMA. This vulnerability affects systems with untrusted peripherals or Thunderbolt/PCIe hot-plug capability.

Mitigations include restricting DMA-capable device access to trusted hardware and verifying firmware integrity. Future IOMMU support will enable per-device address space isolation.

DMA buffers undergo zeroing before allocation and after deallocation to prevent information leakage between uses.


## Appendix A: Control Register Reference

### CR0 Bits

| Bit | Name | Function |
|-----|------|----------|
| 0 | PE | Protected mode enable |
| 1 | MP | Monitor coprocessor |
| 2 | EM | Emulation (disable FPU) |
| 3 | TS | Task switched |
| 4 | ET | Extension type |
| 5 | NE | Numeric error |
| 16 | WP | Write protect |
| 18 | AM | Alignment mask |
| 29 | NW | Not write-through |
| 30 | CD | Cache disable |
| 31 | PG | Paging enable |

### CR4 Bits

| Bit | Name | Function |
|-----|------|----------|
| 0 | VME | Virtual 8086 mode extensions |
| 1 | PVI | Protected mode virtual interrupts |
| 2 | TSD | Time stamp disable |
| 3 | DE | Debugging extensions |
| 4 | PSE | Page size extension |
| 5 | PAE | Physical address extension |
| 6 | MCE | Machine check enable |
| 7 | PGE | Page global enable |
| 8 | PCE | Performance counter enable |
| 9 | OSFXSR | SSE enable |
| 10 | OSXMMEXCPT | SSE exception enable |
| 11 | UMIP | User mode instruction prevention |
| 16 | FSGSBASE | Enable RDFSBASE/WRFSBASE |
| 17 | PCIDE | Process context identifiers |
| 18 | OSXSAVE | XSAVE enable |
| 20 | SMEP | Supervisor mode execution prevention |
| 21 | SMAP | Supervisor mode access prevention |


## Appendix B: MSR Reference

| Address | Name | Function |
|---------|------|----------|
| 0x0000001B | IA32_APIC_BASE | Local APIC base address |
| 0xC0000080 | EFER | Extended feature enable |
| 0xC0000081 | STAR | SYSCALL segment selectors |
| 0xC0000082 | LSTAR | SYSCALL target address |
| 0xC0000084 | SFMASK | SYSCALL RFLAGS mask |
| 0xC0000100 | FS_BASE | FS segment base |
| 0xC0000101 | GS_BASE | GS segment base |
| 0xC0000102 | KERNEL_GS_BASE | Swap target for SWAPGS |
| 0x000006E0 | TSC_DEADLINE | TSC deadline for APIC timer |


## Appendix C: GDT Layout

| Selector | Description | DPL |
|----------|-------------|-----|
| 0x00 | Null descriptor | - |
| 0x08 | Kernel code | 0 |
| 0x10 | Kernel data | 0 |
| 0x18 | User data | 3 |
| 0x20 | User code | 3 |
| 0x28 | TSS | 0 |

User segment selectors include RPL 3 in bits 0-1: user data selector is 0x1B, user code selector is 0x23.


## Appendix D: IST Assignment

| Index | Usage | Stack Size |
|-------|-------|------------|
| 1 | Double fault | 32 KiB |
| 2 | NMI | 32 KiB |
| 3 | Machine check | 32 KiB |
| 4 | Debug | 32 KiB |
| 5 | Page fault | 32 KiB |
| 6 | General protection | 32 KiB |


AGPL-3.0 | Copyright 2026 NØNOS Contributors
