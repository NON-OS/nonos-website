---
title: "The Rust std PAL"
description: "NØNOS can run unmodified Rust programs. A crate that says use std::..., opens files, spawns threads, and connects TCP sockets compiles for NØNOS and runs as a capsule, because N..."
weight: 4
---
NØNOS can run unmodified Rust programs. A crate that says `use std::...`, opens files, spawns
threads, and connects TCP sockets compiles for NØNOS and runs as a capsule, because NØNOS ships a
platform abstraction layer (PAL) that grafts real Rust `std` onto NØNOS backends. This page documents
how the graft works, what each `std` facility maps to, the honest gaps, and how to build and run an
unmodified Rust app. The code is `toolchain/nonos-std/`.

## How the graft works

The PAL is applied to the pinned `rust-src` by [`toolchain/nonos-std/apply.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/toolchain/nonos-std/apply.sh). It copies NØNOS
platform modules into the standard library's `library/std/src/sys/` tree and patches the `cfg_select`
selectors in each `sys/*/mod.rs` to add an arm keyed on `target_vendor = "nonos"`:

```
  target_vendor = "nonos" => { mod nonos; pub use nonos::*; }
```

The capsule std target sets `target_vendor = "nonos"`, so building with `-Zbuild-std=std` compiles the
**real** upstream `std`, but with the NØNOS `sys` backends selected. The key insight is that only the
platform layer is replaced; all of `std`'s portable code, the collections, the formatting, the
iterator adapters, the sync types built on the platform primitives, is the genuine upstream code. The
script is idempotent and is re-run after a `rustup` update
(`RUSTUP_TOOLCHAIN=nightly-2026-01-16 apply.sh`). Capsules that only build `core` and `alloc` are
unaffected, because the arm is keyed on the vendor the std target sets.

## What each facility maps to

Each `sys` backend under `toolchain/nonos-std/sys/` implements one `std` facility against a NØNOS
syscall or capsule:

```
  std facility        NØNOS backend                          maps to
  ----------------    -----------------------------------    -------------------------
  stdout / stderr     sys/stdio/nonos.rs                      the MDBG kernel debug syscall (serial)
  File / fs           sys/fs/nonos.rs                          the VFS service (vfs_pool) over IPC
  TcpStream / Udp     sys/net/connection/nonos.rs              the net.sockets + net.dns capsules over IPC
  thread              sys/thread/nonos.rs                      the MTSP mk_thread_spawn syscall
  time / Instant      sys/pal/nonos/time.rs                    the MTMS time syscall
  random              sys/random/nonos.rs                      the kernel secure-random syscall
  global allocator    sys/alloc/nonos.rs                       the NØNOS heap
  env / args / os     sys/args/nonos.rs, pal/nonos/os.rs       args and os stubs (reused common layer)
```

So `println!` becomes a `MDBG` syscall to the serial sink, `File::open` becomes a VFS `OP_OPEN` request
to the vfs_pool capsule, `TcpStream::connect` becomes a `net.sockets` `OP_CONNECT`, and
`thread::spawn` becomes a real kernel thread sharing the capsule's address space. The mappings are
thin: the file backend speaks the same VFS wire protocol documented on the
[storage](/docs/subsystems/storage/vfs-capsule/) page, and the net backend speaks the same
[sockets](/docs/subsystems/networking/sockets/) op set.

## The threads backend

The thread backend is worth a note because it is real, not emulated. `thread::spawn`
([`sys/thread/nonos.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/sys/thread/nonos.rs)) calls the `MTSP` syscall, which creates a kernel thread sharing the capsule's
address space; the backend hands it an `mmap`'d stack whose top word holds the boxed start routine, and
a small naked trampoline pops that pointer and calls the Rust entry. The default stack is one megabyte.
`join` spins on a shared atomic flag the thread sets before it exits, which is honest about the current
scheduler: it is single-core and cooperative, so join is a cooperative spin rather than a blocking
wait.

## The honest gaps

The PAL is deliberate about what it does not support, and each backend's source states it:

- **Filesystem**: open, read, write, close, stat, unlink, mkdir, and readdir are wired; symlinks,
  permissions, times, and locks are unsupported, because the VFS does not model them, so those paths
  return an error or no-op.
- **Networking**: connect, read, write, bind, accept, and send/recv are wired; socket options are
  best-effort no-ops, and IPv6 and multicast are unsupported, because the userland stack is IPv4.
- **stdin**: empty until a console source is wired, so a program that reads stdin gets end-of-file.
- **threads**: join is a cooperative single-core spin, as above.

These are limits of the current backends, not of the approach; a program that stays within the wired
surface (which is most non-interactive Rust code) runs unmodified. A program that needs an unsupported
facility gets a clean error rather than silent wrong behavior.

## How to use it

Building an unmodified Rust program for NØNOS is a std target plus `build-std`:

```
  # one-time: graft the PAL into the pinned rust-src
  RUSTUP_TOOLCHAIN=nightly-2026-01-16 toolchain/nonos-std/apply.sh

  # build any std crate for the NØNOS std target
  cargo +nightly-2026-01-16 build --release \
      --target x86_64-nonos.json \
      -Zbuild-std=std,panic_abort
```

The resulting binary is a NØNOS capsule payload: it is then signed and embedded like any other
capsule (see [writing an app](/docs/userland/writing-an-app/) and the [build](/docs/build/toolchain/) toolchain
pages), and spawned through the verified-spawn pipeline. The point of the PAL is that the *source* did
not have to change: the same crate builds for a host with `cargo build` and for NØNOS with the std
target. The alternative, for a capsule written natively against `no_std`, is the
[nonos_std crate](/docs/userland/nonos-std/).

## Source

```
  toolchain/nonos-std/apply.sh              the graft: copy backends + patch cfg_select
  toolchain/nonos-std/sys/stdio/nonos.rs     stdout/stderr over MDBG
  toolchain/nonos-std/sys/fs/nonos.rs        File over the VFS service
  toolchain/nonos-std/sys/net/connection/nonos.rs   TCP/UDP over net.sockets + DNS
  toolchain/nonos-std/sys/thread/nonos.rs    threads over mk_thread_spawn
  toolchain/nonos-std/sys/pal/nonos/         os, time, and the reused common layer
```
