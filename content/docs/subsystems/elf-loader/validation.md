---
title: "ELF Validation"
description: "Before any byte of a capsule image is mapped, its ELF header and program-header table are validated."
weight: 1
---
Before any byte of a capsule image is mapped, its ELF header and program-header table are
validated. A malformed or unexpected image is rejected up front with a specific error, not
partway through mapping. This page documents the header checks and the program-header bounds.
The code is under `src/elf/loader/core/parse_header/`.

## Parsing the header

`parse_elf_header` ([`src/elf/loader/core/parse_header/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/loader/core/parse_header/header.rs#L18)) refuses an image smaller
than a header before reading anything:

```
  parse_elf_header(elf_data):
      if elf_data.len() < ElfHeader::SIZE:  FileTooSmall
      read_unaligned an ElfHeader from the front
```

The read is unaligned because the caller's buffer is arbitrary bytes; the size check ahead of
it means the read never runs off the end.

## The header checks

`validate_elf` ([`parse_header/validate.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/validate.rs#L17)) runs ten checks in order and returns a distinct
error for each, so a rejected image says exactly why:

```
  is_valid_magic()                    else InvalidMagic          (0x7F "ELF")
  is_64bit()                          else InvalidClass          (ELFCLASS64)
  is_little_endian()                  else InvalidEndian         (ELFDATA2LSB)
  version_is_current()                else InvalidVersion
  has_native_header_size()            else InvalidHeaderSize
  has_native_program_header_size()    else InvalidProgramHeaderSize   (56 bytes)
  has_native_section_header_size()    else InvalidSectionHeaderSize   (64 bytes)
  has_valid_section_name_table_index() else InvalidIndex
  e_machine == EM_X86_64              else InvalidMachine        (value 62)
  e_type in { ET_EXEC, ET_DYN }       else InvalidType
```

The image must be a little-endian 64-bit x86_64 object, and it must be either an executable
(`ET_EXEC`) or a shared object (`ET_DYN`, the PIE form); a relocatable object or a core file is
rejected with `InvalidType`. The entry-size checks pin the program- and section-header entry
sizes to the native struct sizes, so the loader's later fixed-stride indexing into those tables
is sound by construction.

## Program-header bounds

The program-header table is where the loadable segments are described, and its extent is
bounds-checked before it is walked ([`parse_header/bounds.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/bounds.rs#L18)):

```
  program_header_bounds(elf_data, header):
      ph_offset = header.e_phoff        (checked into usize, else ProgramHeadersOutOfBounds)
      ph_count  = header.e_phnum
      if ph_count == 0:  return (nothing to load)
      if ph_entsize != sizeof(ProgramHeader):  InvalidProgramHeaderSize
      table_bytes = ph_entsize * ph_count       (checked_mul)
      table_end   = ph_offset + table_bytes      (checked_add)
      if table_end > elf_data.len():  ProgramHeadersOutOfBounds
```

Every multiplication and addition is checked, and the table end is required to lie inside the
image, so a header claiming a table that runs past the buffer is refused rather than read out of
bounds. `parse_program_header_at` ([`parse_header/program_entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/program_entry.rs#L19)) re-checks the index
against the count and computes each entry's offset with checked arithmetic, so no individual
program-header read can escape the image either.

## The error type

Every rejection is one variant of `ElfError` ([`src/elf/errors/types/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/errors/types/state.rs#L17)), a flat enum
covering the header checks above, the segment and relocation failures the [loading](/docs/subsystems/elf-loader/segments/)
path can raise (`SegmentDataOutOfBounds`, `MemoryAllocationFailed`, `MemoryMappingFailed`,
`WXViolation`, `AlignmentError`, `AddressOverflow`), and the dynamic-linking errors the userland
path uses. The load path converts an `ElfError` into a spawn failure; the specific variant is
logged so a rejected capsule is diagnosable.

## Security analysis

The header parser is the loader's first contact with an untrusted image, and everything downstream
assumes it did its job. Two properties hold, and one boundary is worth stating plainly.

**Every read is size-checked before it happens.** `parse_elf_header` ([`parse_header/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/header.rs#L18))
refuses an image smaller than `ElfHeader::SIZE` with `FileTooSmall` before it reads a single byte, and
it reads unaligned because the caller's buffer is arbitrary bytes rather than a placed struct. The
program-header table is bounds-checked the same way: `program_header_bounds` ([`parse_header/bounds.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/bounds.rs#L18))
computes `ph_entsize * ph_count` and `ph_offset + table_bytes` with `checked_mul` and `checked_add`, and
requires the end to lie inside the image, so a header claiming a table that runs past the buffer is
refused with `ProgramHeadersOutOfBounds` rather than read out of bounds. `parse_program_header_at`
([`parse_header/program_entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/program_entry.rs#L19)) re-checks the index against the count and recomputes each entry
offset with checked arithmetic, so no individual entry read can escape the image either. The image is
treated as hostile input: the header claims a shape, and the loader confirms that shape fits the bytes
it was actually given before trusting any field.

**The entry-size pins make later fixed-stride indexing sound.** `has_native_program_header_size` and
`has_native_section_header_size` ([`parse_header/validate.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse_header/validate.rs#L17)) require the program- and section-header
entry sizes to equal the native struct sizes (56 and 64 bytes). Because the loader later indexes those
tables at a fixed stride, pinning the stride here is what makes that indexing correct by construction
rather than by hope, and it also rejects an object built for a different ABI up front. Alongside them the
class, endianness, machine, and type checks confine the loader to a little-endian 64-bit x86_64 `ET_EXEC`
or `ET_DYN` object; a relocatable object or a core file is refused with `InvalidType`.

The boundary worth naming: these checks establish that the image is a *well-formed* x86_64 ELF whose
tables fit inside the buffer. They do not establish that it is *trustworthy*. Authenticity, the publisher
signature and the manifest, is a separate gate that runs before the loader is ever called, described on
the [integration](/docs/subsystems/elf-loader/integration/) page. Header validation is structural safety, not attestation, and the
two are deliberately different layers.

## Debugging ELF validation

Every rejection here is one variant of `ElfError` ([`src/elf/errors/types/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/errors/types/state.rs#L17)) with a fixed
string form ([`src/elf/errors/types/strings.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/errors/types/strings.rs#L20)), and on the spawn path that string is printed after
the caller's debug tag when a load fails ([`.../install/load_elf_into_pid.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../install/load_elf_into_pid.rs#L27)). For a driver capsule the
tag is the `[DRIVER-*] load_elf_executable error:` line the spawn site passes in (for example
[`src/hardware/nvme_capsule/spawn.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/nvme_capsule/spawn.rs#L58)), so a failed load reads as a named stage:

```
  [DRIVER-NVME] load_elf_executable error:
  ELF file too small                 FileTooSmall                  the buffer is shorter than a header
  Invalid ELF magic number           InvalidMagic                  not 0x7F "ELF"
  Invalid ELF class (not 64-bit)     InvalidClass                  not ELFCLASS64
  Invalid ELF machine type ...       InvalidMachine                not EM_X86_64
  Invalid ELF type (not EXEC or DYN) InvalidType                   a relocatable object or core file
  Invalid ELF program header ...     InvalidProgramHeaderSize      e_phentsize is not the native size
  Program headers out of bounds      ProgramHeadersOutOfBounds     the table runs past the buffer
```

The distinction these give you is between a *malformed* image and an *unexpected* one.
`FileTooSmall`, `ProgramHeadersOutOfBounds`, and the `InvalidProgramHeaderSize` from the bounds check
mean the bytes do not describe a coherent object, which points at truncation or corruption in the
artifact. `InvalidMachine` and `InvalidType` mean the object is well-formed but built for the wrong
target or as the wrong kind of file, which points at a build or packaging mistake, not a damaged file. On
the top-level spawn path the same failure also surfaces as `reason=elf_load`
([`.../from_vfs/load.rs:99`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../from_vfs/load.rs#L99)), so a `[RUNTIME-LOAD] FAILED ... reason=elf_load` line tells you the image got
as far as the loader, meaning it had already passed verification, and the specific `ElfError` string that
precedes it says which structural check refused it.

## Source map

```
  src/elf/loader/core/parse_header/header.rs         parse_elf_header, the size floor
  src/elf/loader/core/parse_header/validate.rs        the ten header checks
  src/elf/loader/core/parse_header/bounds.rs          program-header table bounds
  src/elf/loader/core/parse_header/program_entry.rs   per-entry bounds-checked read
  src/elf/errors/types/state.rs                       the ElfError enum
  src/elf/errors/types/strings.rs                     ElfError::as_str, the logged strings
```

Every reference above is verified against those trees. The segment W^X gate these checks hand off to is
on the [segment loading](/docs/subsystems/elf-loader/segments/) page, the load orchestration that calls them in order is on the
[layout](/docs/subsystems/elf-loader/layout/) page, and the verify-then-load gate that runs before any of this is on the
[integration](/docs/subsystems/elf-loader/integration/) page.
