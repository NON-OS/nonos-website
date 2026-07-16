---
title: "ELF Loader"
description: "How a verified capsule image becomes a running address space."
weight: 5
---
How a verified capsule image becomes a running address space. The loader validates an ELF header
and its program-header table, maps each loadable segment with permissions derived from its flags,
enforces write-xor-execute so no page is ever both writable and executable, randomizes the load
base for a position-independent image, applies relative relocations, and returns the entry point.
It is invoked by the spawn pipeline only after the image's signatures and capabilities have been
verified.

| Page | What it covers |
|------|----------------|
| [validation.md](/docs/subsystems/elf-loader/validation/) | The size floor, the ten header checks (class, endianness, machine, type), the bounds-checked program-header table, and the `ElfError` type. |
| [segments.md](/docs/subsystems/elf-loader/segments/) | `load_segment`: the W^X gate, permission derivation from `p_flags`, and per-page allocate-map-zero-fill (with `.bss` for free). |
| [layout.md](/docs/subsystems/elf-loader/layout/) | The load orchestration, the PIE-randomized load base, the relative relocations, and the relocated entry point. |
| [integration.md](/docs/subsystems/elf-loader/integration/) | Where the loader sits in the spawn pipeline: verify first, then create the address space and load into its ASID. |

The property that defines the subsystem is that untrusted bytes are treated as untrusted until
proven otherwise and never gain more authority than their flags allow: the header and every table
offset are bounds-checked before use, a writable-executable segment is rejected outright, a
segment is mapped exactly as readable/writable/executable as its flags say and no more, backing
pages are zeroed before file data lands, and the whole load happens only after cryptographic
verification and only into the target capsule's own address space.

## Sources

The trusted capsule-load path lives under `src/elf/loader/core/`: `parse_header/` (validation and
bounds), `load_segment/` (the W^X gate, permissions, and page population), `loader/` (the
orchestration, load base, and entry point), and `relocate/` (relative relocations). The ASLR
manager is `src/elf/aslr/`, the error type is `src/elf/errors/`, and the spawn integration is
under `src/kernel_core/process_spawn/capsule_spawn/`. The wider `src/elf/` tree also carries a full
dynamic linker (`dynlink`, `got`, `hash`, `libmgr`, `tls`, `auxv`) used by the userland std
runtime, which is out of scope for the capsule-load path documented here. Every page is verified
against those trees with `file:line` references.
