---
title: "RAMFS"
description: "The default filesystem in NØNOS is in RAM."
weight: 2
---
The default filesystem in NØNOS is in RAM. A microkernel that boots RAM-resident and leans on the
[ZeroState](/docs/subsystems/memory/zeroization/) posture keeps its live filesystem in memory, and RAMFS is that
filesystem: an in-kernel tree of files whose contents are zeroed the moment they are freed. This page
documents it. The code is under `src/fs/ramfs/`.

## The file

A RAMFS file is a `NonosFile` ([`src/fs/ramfs/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/ramfs/types.rs)), a name, a byte vector, and POSIX metadata:

```
  struct NonosFile {
      name: String, data: Vec<u8>, size: usize,
      created, modified: u64,
      encrypted, quantum_protected: bool,
      mode, uid, gid: u32,
  }
```

The filesystem is a tree of these behind a global instance, and it supports the expected operations,
`create_file`, `read_file`, `write_file`, `create_dir`, `mkdir_all`, `delete_file`, `list_dir`
([`ramfs/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ramfs/mod.rs)). It is the default: every path that is not routed to a capsule or to the on-disk
`/data` store is served here in the kernel.

## Zero on free

The property that ties RAMFS to the kernel's RAM-residency claim is that a file's bytes are zeroed
when the file is dropped. `secure_zeroize` (`types.rs`) overwrites the data with volatile writes and a
compiler fence, `secure_clear` calls it and clears the vector, and `Drop` calls `secure_clear`:

```
  secure_zeroize(data):
      for byte in data: write_volatile(byte, 0)
      compiler_fence(SeqCst)

  impl Drop for NonosFile:
      fn drop(&mut self):  secure_clear(self)   // zeroize + clear + size = 0
```

The volatile write is what keeps the compiler from optimizing the wipe away as a dead store, and the
fence orders it, so a freed file's contents do not linger in the heap to be read back by a later
allocation. This is the per-file half of the [zeroization](/docs/subsystems/memory/zeroization/) story: RAMFS
does not depend on the whole-system wipe to avoid leaving file data in RAM, because each file zeroes
itself on the way out. It complements the [heap](/docs/subsystems/memory/heap/)'s own zero-on-free.

## Where it sits

RAMFS is reached two ways: directly, as the in-kernel default for kernel-side paths, and through the
[VFS dispatcher](/docs/subsystems/storage/vfs-and-paths/), which routes most paths to it. The IPC-facing `/ram` tree is a
separate capsule (`ramfs_capsule`), documented on the [VFS capsule](/docs/subsystems/storage/vfs-capsule/) page; that capsule
serves the modern capsule-client filesystem while this in-kernel RAMFS backs the kernel's own paths.

## Security analysis

RAMFS is different from the block drivers in the rest of this section: it runs in the kernel, not in a
capsule, so it has no broker grants and no device to reach. Its security story is not isolation, it is
that a file's bytes do not outlive the file, and that the in-kernel default never touches a disk.

The **zero-on-free is an information-leak barrier.** A `NonosFile`'s data vector is scrubbed with
volatile writes before it is freed. `secure_zeroize` (`types.rs`) overwrites the bytes and issues a
`compiler_fence(SeqCst)`, `secure_clear` calls it and clears the vector, and `Drop` calls
`secure_clear`, so a freed file's contents cannot be read back by a later heap allocation. The
volatile write is what stops the compiler from eliding the wipe as a dead store. This is the per-file
half of the [zeroization](/docs/subsystems/memory/zeroization/) posture: RAMFS does not depend on the whole-system
wipe to keep file data out of reclaimed RAM, and it complements the [heap](/docs/subsystems/memory/heap/)'s own
zero-on-free rather than relying on it.

The **default path never reaches a disk.** Every path that is not routed to a capsule or to the
on-disk `/data` store is served here in RAM ([`ramfs/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ramfs/mod.rs)), so the live filesystem is memory-resident
and there is no persistent medium for its contents to linger on after a power cycle. The on-disk
[blockfs](/docs/subsystems/storage/vfs-and-paths/#the-on-disk-store) store and its block drivers are reached only when
something explicitly asks for persistence; the RAM default carries no DMA and no controller in its
trust boundary.

The **honest boundary is that RAMFS is in-kernel and trusted.** Because RAMFS runs in the kernel rather
than in a ring-3 capsule, a bug in it is a kernel bug, not a contained capsule fault. This is a
deliberate trade: the kernel's own paths need a filesystem that does not depend on a capsule being
spawned, so the in-kernel RAMFS backs them while the IPC-routed [ramfs capsule](/docs/subsystems/storage/vfs-capsule/) serves
the isolated capsule-client tree. The wipe is best effort against software reclaim; it does not defend
against a cold-boot RAM remanence attack on the physical DIMMs, which is out of scope for the wipe.

## Debugging RAMFS

RAMFS has no device to fail and no grant to be refused, so its failure modes are ordinary in-kernel
ones rather than the driver-bring-up signatures of the block layer. Two are worth naming.

**A path that will not open.** Because RAMFS is the fall-through destination of the
[VFS router](/docs/subsystems/storage/vfs-and-paths/#routing), a read that returns nothing is usually a routing question
before it is a RAMFS question: a `/ram` path went to the [ramfs capsule](/docs/subsystems/storage/vfs-capsule/) over IPC and a
`/data` path went to blockfs, and only everything else reached the in-kernel RAMFS. So the first check
is which backend the prefix selected, not whether the file exists in RAMFS. The operations themselves
(`create_file`, `read_file`, `write_file`, `list_dir` in [`ramfs/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ramfs/mod.rs)) return through the ordinary
`Result` path and do not panic on a missing name.

**A wipe you want to confirm.** The zero-on-free is the property most worth verifying, and it is a
`Drop` effect, so it fires when a `NonosFile` is dropped rather than at an explicit call site. If a
freed file's bytes appear to survive, the question is whether the value was actually dropped (moved
into a longer-lived owner, or leaked) rather than whether `secure_zeroize` ran, because `Drop` calls
`secure_clear` unconditionally (`types.rs`). The volatile write and the fence mean the wipe is not
optimized away, so a surviving byte points at a lifetime bug above RAMFS, not at the scrub itself.

## Source map

```
  src/fs/ramfs/types.rs              NonosFile, secure_zeroize, secure_clear, the Drop wipe
  src/fs/ramfs/mod.rs                the file and directory operations
  src/fs/ramfs/filesystem/global.rs  the global RAMFS instance
  src/fs/vfs/vfs_core.rs             the prefix router that falls through to RAMFS
```

Every reference above is verified against those trees. The whole-system wipe this complements is on the
[zeroization](/docs/subsystems/memory/zeroization/) page, the heap's own zero-on-free on the [heap](/docs/subsystems/memory/heap/)
page, the prefix router that reaches RAMFS on the [VFS routing](/docs/subsystems/storage/vfs-and-paths/) page, and the
IPC-routed capsule variant on the [filesystem capsule](/docs/subsystems/storage/vfs-capsule/) page.
