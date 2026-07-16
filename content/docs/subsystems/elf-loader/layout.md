---
title: "Load Address, ASLR, and Relocation"
description: "The loader decides where an image lands, randomizes that base for a position-independent image, maps its segments, applies the relative relocations a PIE needs, and computes the..."
weight: 3
---
The loader decides where an image lands, randomizes that base for a position-independent image,
maps its segments, applies the relative relocations a PIE needs, and computes the relocated entry
point. This page documents that orchestration. The code is under
`src/elf/loader/core/loader/`.

## The load orchestration

`load_entry_into` ([`src/elf/loader/core/loader/load_entry_into.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/loader/core/loader/load_entry_into.rs#L20)) is the whole trusted load
into a target address space, in order:

```
  load_entry_into(elf_data, target_asid):
      header    = parse_elf_header(elf_data)
      validate_elf(header)                          // the header checks
      ph_count  = program_header_bounds(...)         // bounds-checked table
      base_addr = load_base(header, aslr_manager)    // where it lands
      for each program header:
          if PT_LOAD:  load_segment(...)             // W^X gate + map + zero-fill
      apply_relative_relocations(elf_data, header, ph_count, base_addr, target_asid)
      return entry_point(header, base_addr)
```

Validation precedes any mapping, the base is chosen once, every loadable segment is mapped
through the [segment path](/docs/subsystems/elf-loader/segments/), and only then are relocations applied and the entry
point returned. The function takes a `target_asid`, so it maps into a specific address space, the
freshly created one for the capsule being spawned, not the current one.

## The load base and ASLR

`load_base` ([`loader/base_addr.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/loader/base_addr.rs#L19)) chooses the base from whether the image is
position-independent:

```
  load_base(header, aslr):
      if header.is_pie():  aslr.randomize_base(DEFAULT_PIE_BASE)
      else:                DEFAULT_STATIC_BASE
```

A PIE (an `ET_DYN` image, which is what capsules typically are) is loaded at a randomized base;
a non-PIE executable is loaded at its fixed base. `randomize_base` ([`aslr/manager/randomize.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aslr/manager/randomize.rs#L24))
adds a random offset within the executable randomization range to the preferred base and masks it
back to a page boundary:

```
  randomize_base(preferred):
      if executable_randomization:  (preferred + random_offset(RANGE)) & !0xFFF
      else:                         preferred
```

Randomization is on by default ([`aslr/manager/settings.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aslr/manager/settings.rs)), and each load uses the loader's ASLR
manager, so a capsule's text and data land at an address an attacker cannot predict from the
image alone. The randomization is page-aligned so it does not disturb segment alignment.

## Relocations and the entry point

A PIE's absolute references are fixed up after mapping by `apply_relative_relocations`, which
walks the relocation entries and applies the relative (`R_X86_64_RELATIVE`) fixups against the
chosen base into the target address space. This is the relocation half of the
[capsule RELRO](/docs/security/capsules-and-trust/) posture: the global offset table is
relocated at load, and the paging layer write-protects it afterward. Finally `entry_point`
([`loader/base_addr.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/loader/base_addr.rs#L27)) returns the entry, relocated by the base for a PIE and taken absolute
for a non-PIE:

```
  entry_point(header, base):
      if header.is_pie():  base + header.e_entry
      else:                header.e_entry
```

The returned entry is what the spawn path installs as the capsule's initial instruction pointer.

## Security analysis

This is the orchestration layer, so its properties are about ordering and about not leaking a
half-loaded image into a live address space. Three hold.

**Validation strictly precedes mapping.** `load_entry_into`
([`src/elf/loader/core/loader/load_entry_into.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/loader/core/loader/load_entry_into.rs#L20)) runs `parse_elf_header`, `validate_elf`, and
`program_header_bounds` before it maps a single segment, so no frame is allocated and no page is
installed for an image that fails a header or bounds check. A malformed image is refused up front rather
than partway through mapping, which is what lets the caller treat a load failure as a clean no-op with
nothing to unwind at this level. The header and bounds checks themselves are on the
[validation](/docs/subsystems/elf-loader/validation/) page; the point here is that the orchestration calls them first, every time.

**The load targets a specific ASID, never the current one.** `load_entry_into` takes a `target_asid` and
threads it through `load_segment` and `apply_relative_relocations`, so every page lands in the freshly
created address space for the capsule being spawned. The loader maps into that ASID directly, so the
capsule's text and data are never briefly visible in the kernel's mapping or another capsule's while the
load is in progress. That is what keeps a capsule's memory private from the moment it exists.

**ASLR is on by default and page-aligned.** A position-independent image (an `ET_DYN` PIE, which is what
capsules typically are) is loaded at a randomized base: `load_base` ([`loader/base_addr.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/loader/base_addr.rs#L19)) calls
`randomize_base` ([`aslr/manager/randomize.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aslr/manager/randomize.rs#L24)), which adds a random offset within the executable
randomization range and masks the result back to a page boundary, and randomization is enabled by default
([`aslr/manager/settings.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/aslr/manager/settings.rs)). So a capsule's segments land at an address an attacker cannot predict from
the image alone, and the mask keeps the base page-aligned so it does not disturb segment alignment. The
honest boundary is that the relocation pass, `apply_relative_relocations`, only applies the relative
(`R_X86_64_RELATIVE`) fixups a PIE needs against the chosen base; it is not a general dynamic linker, and
an image needing other relocation types is not what this path is for. The relocated GOT it produces is
write-protected afterward by the paging layer, which is the [capsule RELRO](/docs/security/capsules-and-trust/)
posture.

## Debugging the load orchestration

Because the orchestration calls the header, segment, and relocation stages in order, a failure at any
stage returns that stage's `ElfError` ([`src/elf/errors/types/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/errors/types/state.rs#L17)) straight up, and the spawn
path prints it after the capsule's debug tag ([`.../install/load_elf_into_pid.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../install/load_elf_into_pid.rs#L27)). Reading the printed
string against the order in `load_entry_into` localises the failure to a stage:

```
  Invalid ELF magic / class / type ...   header stage        validate_elf refused the header
  Program headers out of bounds          bounds stage        the program-header table did not fit
  Segment ... / W^X / alignment          segment stage       a PT_LOAD segment was rejected or could not map
  Relocation processing failed           relocation stage    a relative fixup could not be applied
  Unsupported relocation type            relocation stage    a non-RELATIVE relocation was present
```

The value of the ordering is that the stage tells you how far the load got. A header-stage error means
nothing was mapped. A segment-stage error means some earlier segments in the same image may have been
mapped into `target_asid` before the failing one, but since the whole address space belongs to a capsule
that will not be scheduled, the caller discards the ASID rather than unmapping page by page. A
relocation-stage error, `RelocationFailed` or `UnsupportedRelocation`, means every segment mapped
cleanly and only the fixup pass failed, which points at a linker producing relocations this loader does
not apply rather than at a corrupt or oversized image. As everywhere on this path, the top-level spawn log
collapses all of these to `reason=elf_load` ([`.../from_vfs/load.rs:99`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../from_vfs/load.rs#L99)); the preceding `ElfError` string
is the one that says which stage.

## Source map

```
  src/elf/loader/core/loader/load_entry_into.rs   the ordered load orchestration
  src/elf/loader/core/loader/base_addr.rs          load_base, entry_point
  src/elf/aslr/manager/randomize.rs                randomize_base
  src/elf/aslr/manager/settings.rs                 ASLR defaults
  src/elf/loader/core/relocate/                    the relative relocation pass
  src/elf/errors/types/state.rs                    the ElfError stages surface here
```

Every reference above is verified against those trees. The header and bounds checks this orchestration
runs first are on the [validation](/docs/subsystems/elf-loader/validation/) page, the per-segment W^X and zero-fill it drives are on
the [segment loading](/docs/subsystems/elf-loader/segments/) page, and the verify-then-load gate that calls this whole path is on
the [integration](/docs/subsystems/elf-loader/integration/) page.
