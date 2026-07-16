---
title: "CPU backends"
description: "How NØNOS runs on more than one instruction set."
weight: 50
---
How NØNOS runs on more than one instruction set. Generic kernel code never names an architecture; it
calls a small trait, `ArchOps`, through one `cfg`-selected type alias, and the build links the backend
for its target. x86_64 is the production architecture; aarch64 and riscv64 are architecture-ready
backends that implement the same boundary. Read the [architecture overview](/docs/architecture/overview/)
first for the system-level picture.

| Page | What it covers |
|------|----------------|
| [boundary.md](/docs/arch/boundary/) | The `ArchOps` trait, its eight leaf primitives, the `Arch` alias, the fail-to-link discipline, and why the boundary is narrow. |
| [x86_64.md](/docs/arch/x86_64/) | The production backend: the direct instruction sequences and ACPI platform discovery. |
| [aarch64.md](/docs/arch/aarch64/) | The architecture-ready ARM backend: the GIC, PSCI, MMU, and generic timer, with an honest maturity note. |
| [riscv64.md](/docs/arch/riscv64/) | The architecture-ready RISC-V backend: the PLIC, SBI, MMU, and `mtime`, with the same maturity note. |
| [platform-discovery.md](/docs/arch/platform-discovery/) | ACPI versus the flattened device tree, and the arch-gated features (PIO, the IRQ backend). |

The principle that runs through the section is that portability is a boundary, not a sprinkling of
`cfg`. The shared kernel goes through `ArchOps` and the other arch seams (the syscall bridge, the IRQ
backend, PIO) rather than into per-arch modules directly, a backend that cannot implement a primitive
does not exist as an `Arch` and the build fails to link rather than misbehaving, and where a capability
is genuinely arch-specific the kernel exposes it where it exists and fails cleanly where it does not.
The maturity ladder is explicit: x86_64 in production, aarch64 and riscv64 architecture-ready, then
QEMU, then hardware.

## Source map

```
  src/arch/abi.rs        the ArchOps trait and its eight primitives        -> boundary.md
  src/arch/mod.rs        the cfg-selected Arch alias and the module gating  -> boundary.md
  src/arch/x86_64/       the production backend (abi.rs, acpi/, iommu/)     -> x86_64.md
  src/arch/aarch64/      the architecture-ready ARM backend (abi/, gic/)    -> aarch64.md
  src/arch/riscv64/      the architecture-ready RISC-V backend (abi/, plic/) -> riscv64.md
  src/arch/fdt/          the flattened-device-tree platform discovery       -> platform-discovery.md
  src/arch/x86_64/acpi/  the ACPI platform discovery                        -> platform-discovery.md
```

Each backend carries an `abi` module implementing `ArchOps`; x86_64 discovers its platform through ACPI,
aarch64 and riscv64 through the device tree. Every page in this section is verified against those trees
with `file:line` references, and the per-arch pages state maturity honestly: x86_64 in production,
aarch64 and riscv64 architecture-ready.
