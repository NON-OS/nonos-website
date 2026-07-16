---
title: "Segment Loading and W^X"
description: "Each PTLOAD segment becomes a run of mapped pages in the target address space."
weight: 2
---
Each `PT_LOAD` segment becomes a run of mapped pages in the target address space. This is where
the loader enforces the invariant that no page is both writable and executable, derives page
permissions from the segment flags, and zero-fills backing memory so a segment never exposes
stale bytes or uninitialized `.bss`. This page documents `load_segment`. The code is under
`src/elf/loader/core/load_segment/`.

## The W^X gate

Before a segment is planned, `input_fields` ([`src/elf/loader/core/load_segment/validate.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/loader/core/load_segment/validate.rs#L20))
validates it, and the load-bearing check is the write-xor-execute gate:

```
  input_fields(elf_len, header):
      if p_filesz > p_memsz:                      SegmentDataOutOfBounds
      if header.is_writable() and header.is_executable():   WXViolation
      if p_align > 1 and not power_of_two(p_align):         AlignmentError
      if p_align > 1 and p_vaddr % p_align != p_offset % p_align:   AlignmentError
      if file_offset + file_size > elf_len:       SegmentDataOutOfBounds
```

A segment carrying both the writable and executable flags is rejected outright with
`WXViolation`. There is no code path that maps a `W|X` segment, so the classic attack surface of
a writable-executable region does not exist for a loaded capsule. The other checks reject a
segment whose file size exceeds its memory size, whose alignment is not a power of two, whose
virtual and file offsets are not congruent modulo the alignment (the ELF alignment invariant),
or whose file contents run past the end of the image.

## Permission derivation

For a segment that passes the gate, its page permissions are derived directly from its flags
([`load_segment/pte_flags.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/load_segment/pte_flags.rs#L20)):

```
  pte_perms_from_phdr(ph):
      perms = READ | USER          // always readable, always user
      if ph.is_writable():   perms |= WRITE
      if ph.is_executable(): perms |= EXECUTE
      perms
```

The base is `READ | USER`: a loaded capsule segment is always user-accessible and readable. Write
is added only for a writable segment and execute only for an executable one, so a read-only data
segment is mapped non-writable and non-executable, a text segment is read-execute, and a data
segment is read-write with no execute. Because the W^X gate already ran, `WRITE` and `EXECUTE`
are never both present. These permissions feed straight into the [paging manager](/docs/subsystems/memory/paging-manager/),
which is the layer that actually enforces them in the page tables.

## Populating pages

`load_segment` ([`load_segment/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/load_segment/run.rs#L28)) builds a page plan, derives the permissions once, and
populates each page ([`load_segment/populate_page.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/load_segment/populate_page.rs)):

```
  populate_page(asid, page_va, perms, dst_off, src):
      frame = allocate_frame()                    else MemoryAllocationFailed
      if map_page_in_asid(asid, page_va, frame, perms) fails:
          free frame; MemoryAllocationFailed       // no leak on the error path
      dst = directmap(frame)
      write_bytes(dst, 0, PAGE)                    // zero the whole page first
      if src not empty:  copy src into dst at dst_off (clamped to the page)
```

Each page is allocated, mapped into the target address space with the segment's permissions, and
then zeroed in full through the direct map before the file bytes are copied in. Zeroing the whole
page first is what gives `.bss` for free: a segment whose `p_memsz` exceeds its `p_filesz` has its
trailing pages (and the tail of its last file page) already zero, with no separate `.bss`
handling. If the mapping fails, the just-allocated frame is freed before returning, so an error
midway through a segment does not leak physical memory. The pages are written through the kernel
direct map rather than through the user mapping, so the loader never dereferences a user virtual
address it just created.

## Security analysis

Segment loading is where untrusted file contents become executable memory, so its invariants are the
ones that decide whether a capsule can turn a data buffer into code or read a previous tenant's bytes.
Three properties hold.

**W^X by construction, not by later check.** `input_fields`
([`src/elf/loader/core/load_segment/validate.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/loader/core/load_segment/validate.rs#L20)) rejects a segment carrying both the writable and
executable flags with `WXViolation` before the segment is ever planned, and `pte_perms_from_phdr`
([`load_segment/pte_flags.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/load_segment/pte_flags.rs#L20)) derives permissions from the flags such that `WRITE` and `EXECUTE` are
never both set, since the gate already ran. There is no code path that maps a `W|X` segment, so the
classic writable-executable region does not exist for a loaded capsule. This is the same invariant the
[paging manager](/docs/subsystems/memory/paging-manager/) enforces at the PTE level, checked here at load time so a
hostile segment header is refused rather than mapped and then caught.

**File contents cannot escape the image, and memory cannot exceed the declared size.** The gate refuses a
segment whose `p_filesz` exceeds its `p_memsz` (`SegmentDataOutOfBounds`), whose alignment is not a power
of two (`AlignmentError`), whose virtual and file offsets are not congruent modulo the alignment, or
whose `file_offset + file_size` runs past the end of the image, again with `checked_add`. So the slice
`&elf_data[plan.file_offset..plan.file_end]` that `load_segment` ([`load_segment/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/load_segment/run.rs#L28)) copies from is
always inside the buffer, and a malicious header cannot point the copy source at bytes the image does not
contain.

**Every page is zeroed before file bytes land, so `.bss` and page tails never leak.** `populate_page`
([`load_segment/populate_page.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/load_segment/populate_page.rs#L28)) allocates a frame, maps it into the target ASID with the segment's
permissions, then does `write_bytes(dst, 0, PAGE)` across the whole page through the direct map before
copying any file bytes, and it clamps the copy length to the space remaining in the page. A segment whose
`p_memsz` exceeds its `p_filesz` therefore gets zeroed `.bss` for free, with no separate handling, and the
tail of the last file page is zero rather than whatever the frame held before. If the mapping fails, the
just-allocated frame is freed before returning `MemoryAllocationFailed`, so an error midway through a
segment leaks no physical memory. The write goes through the kernel direct map, not the user mapping, so
the loader never dereferences a user virtual address it just created.

## Debugging segment loading

The segment path raises the same `ElfError` variants ([`src/elf/errors/types/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/elf/errors/types/state.rs#L17)) the rest of the
loader uses, and on a spawn they are printed after the capsule's debug tag
([`.../install/load_elf_into_pid.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../install/load_elf_into_pid.rs#L27)), so a segment failure names its own cause:

```
  Segment requested both writable and executable permissions   WXViolation             a W|X program header
  Segment data out of bounds                                    SegmentDataOutOfBounds  filesz > memsz, or file bytes past the image
  Alignment requirements not met                                AlignmentError          p_align not a power of two, or vaddr/offset not congruent
  Memory allocation failed                                      MemoryAllocationFailed  no frame, or the per-page map into the ASID failed
```

The useful split is between a *rejected* segment and an *exhausted* one. `WXViolation`,
`SegmentDataOutOfBounds`, and `AlignmentError` all come out of `input_fields` before any frame is touched,
so they mean the program header itself is malformed or hostile and the load never started allocating.
`MemoryAllocationFailed` is different: it comes from `populate_page` after validation passed, so it means
the image was fine but either the frame allocator was empty or the map into the target ASID failed
partway through a segment. A capsule that loads on one boot and fails with `MemoryAllocationFailed` on
another is a memory-pressure signal, not a bad image, whereas a `WXViolation` is a property of the binary
that will fail every time until the binary is rebuilt without a writable-executable segment. On the
top-level spawn path all of these surface as `reason=elf_load` ([`.../from_vfs/load.rs:99`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../from_vfs/load.rs#L99)); the `ElfError`
string that precedes that line is what tells the two apart.

## Source map

```
  src/elf/loader/core/load_segment/validate.rs      the W^X gate and segment validation
  src/elf/loader/core/load_segment/pte_flags.rs      permission derivation from p_flags
  src/elf/loader/core/load_segment/run.rs            the per-page load loop
  src/elf/loader/core/load_segment/populate_page.rs  frame alloc, map, zero-fill, copy
  src/elf/errors/types/state.rs                      the ElfError variants raised here
```

Every reference above is verified against those trees. The header checks that run before any segment is
loaded are on the [validation](/docs/subsystems/elf-loader/validation/) page, the paging layer that enforces these permissions in
the page tables is the [paging manager](/docs/subsystems/memory/paging-manager/), and the load orchestration that
calls `load_segment` per program header is on the [layout](/docs/subsystems/elf-loader/layout/) page.
