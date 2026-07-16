---
title: "Platform Discovery"
description: "Every architecture has to learn its own machine: how many CPUs, where the interrupt controller is, what devices exist."
weight: 6
---
Every architecture has to learn its own machine: how many CPUs, where the interrupt controller is, what
devices exist. x86_64 learns this from ACPI tables; aarch64 and riscv64 learn it from a flattened device
tree. This page documents the two discovery paths and the arch-gated features that follow from them. The
code is `src/arch/fdt/`, `src/arch/x86_64/acpi/`, and the arch gating in [`src/arch/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/mod.rs).

## Two discovery models

The kernel supports the two dominant firmware-description models, selected by architecture:

```
  x86_64             ACPI tables      (src/arch/x86_64/acpi/)
  aarch64, riscv64   flattened device tree (FDT)   (src/arch/fdt/)
```

[`src/arch/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/mod.rs#L20) compiles the FDT module only for aarch64 and riscv64, and the ACPI module is part of
the x86_64 tree, so each build carries exactly the discovery mechanism its target uses. Both answer the
same questions, the CPU inventory the [SMP](/docs/subsystems/smp/) bring-up needs and the interrupt
topology the [interrupt](/docs/subsystems/interrupts/) layer needs, in the format the platform's
firmware provides.

## The device tree

The FDT module ([`src/arch/fdt/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/fdt/mod.rs)) is a from-scratch flattened-device-tree parser: it handles the
big-endian FDT encoding, the header, the token stream, the string table, and property decoding, and
exposes a `Fdt`, a `Property` type, and find and walk helpers over the tree. This is how an ARM or RISC-V
build discovers its hardware: the bootloader passes a device-tree blob, and the kernel walks it to find
the memory ranges, the interrupt controller (the GIC or PLIC), the timer, and the devices. It is the
device-tree analogue of the x86 ACPI table walk.

## ACPI

The [x86_64 backend](/docs/arch/x86_64/) owns the ACPI side: the MADT for the interrupt and processor topology,
the HPET, the IO-APIC and LAPIC addresses, the interrupt source overrides, the NUMA regions, and the PCIe
segments. The two models are not mixed, an x86 build reads ACPI and an ARM or RISC-V build reads the
device tree, and the subsystems above them (SMP, interrupts, the PCI enumeration behind the
[hardware broker](/docs/subsystems/hardware-broker/devices/)) consume whichever one the target provides.

## Arch-gated features

Discovery is one place the architecture shows through; there are a few others where a feature simply does
not exist off one architecture, and the kernel gates them rather than emulating them:

- **PIO** (port-mapped I/O) is an x86 instruction class. The [hardware broker](/docs/subsystems/hardware-broker/pio/)
  compiles its PIO module only on x86_64 ([`src/hardware/broker/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/mod.rs)), and the PIO syscalls fail closed
  with `ENOSYS` on other architectures.
- **The IRQ backend** differs per architecture: the broker's [IRQ grants](/docs/subsystems/hardware-broker/irq/)
  use the IO-APIC and MSI-X on x86, the GIC on ARM, and the PLIC on RISC-V, selected by `target_arch`.

These gates are the honest form of multi-architecture support: where a capability is genuinely
arch-specific, the kernel exposes it where it exists and fails cleanly where it does not, rather than
pretending every architecture is the same.

## Security analysis

Discovery is the point where untrusted firmware data first reaches the kernel, so it is a hardening
surface regardless of which model a target uses. Both the ACPI tables and the device-tree blob are
provided by firmware or the bootloader, before any capsule runs, and both are walked to extract the
interrupt topology, the processor inventory, and the MMIO addresses the kernel will later program. A
malformed table or a lying property is untrusted input, and the parsers are written to walk structure
rather than trust embedded lengths and pointers blindly. The addresses discovery yields (the IO-APIC and
LAPIC on x86, the GIC or PLIC on ARM and RISC-V) are not dereferenced as raw firmware pointers; on x86
they are mapped into the upper half during `init_unified_vm`, after the kernel half is confirmed, so a
bad address faults on a controlled mapping rather than reading arbitrary physical memory in place.

The arch gates are themselves a security posture. PIO is an x86 instruction class and does not exist on
the other targets, so rather than emulate it the kernel compiles the PIO broker only on x86_64 and the
PIO syscalls fail closed with `ENOSYS` elsewhere. Failing closed is the honest choice: a capsule that
asks for port IO on ARM gets a clean refusal, not a silent success against hardware that has no such
concept. The same logic runs through the whole section: where a capability is genuinely arch-specific,
the kernel exposes it where it exists and refuses it where it does not, so no code path pretends a
missing mechanism is present.

## Debugging

Discovery failures are early and total: if the kernel misreads its own machine, almost nothing above it
works, so the symptoms are broad and the cause is narrow.

**No processors beyond the boot CPU, or an IRQ that routes nowhere.** Both trace back to discovery
handing the layers above it wrong topology. The [SMP](/docs/subsystems/smp/) bring-up reads the
processor list to start the application processors, and the
[interrupt](/docs/subsystems/interrupts/) layer reads the IO-APIC and override data (or the GIC or
PLIC node) to route device lines. A missing core or a misrouted line points at the MADT parse on x86 or
the device-tree walk on the other targets, not at SMP or the interrupt layer themselves.

**A device-tree property read as the wrong width or endianness.** The FDT encoding is big-endian, and the
parser decodes the header, token stream, string table, and properties against that. On a little-endian
host a byte-swap mistake shows up as a nonsensical address or size. This is the ARM and RISC-V analogue
of a bad ACPI length, and it is why the parser is a from-scratch decoder rather than a cast over raw
bytes.

**A PIO syscall returning `ENOSYS`.** On aarch64 or riscv64 this is not a bug; it is the arch gate
working. Port IO does not exist off x86, the PIO broker is not compiled in, and the syscall fails closed.
A driver that needs to reach a device on those targets does so through MMIO instead.

## Source map

```
  src/arch/fdt/mod.rs           the flattened-device-tree parser (aarch64, riscv64)
  src/arch/x86_64/acpi/mod.rs   the ACPI tables (x86_64)
  src/arch/mod.rs               the FDT arch gating (compiled only for aarch64, riscv64)
  src/hardware/broker/mod.rs    the PIO arch gate (x86_64 only)
```

The ACPI side and the machinery it feeds are on the [x86_64 backend](/docs/arch/x86_64/) page, the boundary the
whole section sits under is on the [boundary](/docs/arch/boundary/) page, and the PIO broker this page gates is on
the [PIO](/docs/subsystems/hardware-broker/pio/) page. Every reference is verified against those trees.
