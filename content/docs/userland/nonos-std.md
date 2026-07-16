---
title: "The nonos_std Crate"
description: "The std PAL runs unmodified Rust programs by grafting real std."
weight: 5
---
The [std PAL](/docs/userland/std-pal/) runs unmodified Rust programs by grafting real `std`. The other option, for a
capsule written natively for NØNOS, is `nonos_std`: a `no_std` crate that gives a capsule a
standard-library-shaped API without the full std port. A capsule writes `use nonos_std::...` in place
of `use std::...`, builds with only `core` and `alloc`, and gets collections, networking, files,
processes, sync, time, and environment access. This page documents it. The code is
`userland/sdk/nonos_std/`.

## What it provides

`nonos_std` ([`userland/sdk/nonos_std/src/lib.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/sdk/nonos_std/src/lib.rs)) is `#![no_std]` and layers a std-shaped surface over
`core` and `alloc`:

```
  re-exported from core/alloc:  fmt, iter, mem, ops, slice, str, string, vec, boxed, rc, ...
  collections   HashMap, HashSet (seeded), plus BTreeMap/BTreeSet/VecDeque/BinaryHeap from alloc
  net           TcpStream, TcpListener, UdpSocket
  fs            file operations
  process       process control
  sync          synchronization primitives
  env           args and consts
  time          clocks and durations
  io, path, error, prelude
```

The portable parts (`fmt`, `iter`, the containers) are the real `core` and `alloc` types, re-exported so
a capsule can `use nonos_std::collections::BTreeMap` and get exactly `alloc::collections::BTreeMap`. The
platform parts (`net`, `fs`, `process`, `time`) are thin wrappers over the same NØNOS syscalls and
capsules the [std PAL](/docs/userland/std-pal/) uses, so the two share a backend and differ only in whether the
program is unmodified std code or native NØNOS code.

## The seeded HashMap

One detail worth calling out is the hash map. `nonos_std::collections::HashMap`
(`src/collections/hash/`) uses a `SeededState` whose seed is drawn from kernel randomness rather than a
fixed constant. This matters because a hash map seeded with a constant is vulnerable to algorithmic
complexity attacks (an adversary who knows the hash function can force every key into one bucket); a
per-capsule random seed makes the iteration order and bucket assignment unpredictable to an outside
party, which is the same reason the upstream `std` HashMap is randomly seeded. The seed comes from the
same secure-random path the rest of the kernel uses.

## Networking

`nonos_std::net` (`src/net/`) gives a capsule `TcpStream`, `TcpListener`, and `UdpSocket` with the
familiar shape, `connect`, `bind`, `send`, `recv`, over the [net.sockets](/docs/userland/networking-guide/) service.
It is the native-capsule route to the same networking the std PAL exposes; the
[networking guide](/docs/userland/networking-guide/) covers using it.

## When to use which

Two routes to a standard library, for two situations:

```
  nonos_std      a capsule written for NØNOS; builds core+alloc; use nonos_std::... explicitly
  the std PAL    an unmodified crate written for std; builds -Zbuild-std=std; use std::... unchanged
```

Use `nonos_std` when writing a capsule from scratch for NØNOS, where depending on it directly is natural
and the `no_std` build is lighter. Use the [std PAL](/docs/userland/std-pal/) when porting an existing crate that
already says `use std::...` and you do not want to touch its source. Both end up calling the same
kernel; the difference is which library surface the capsule's source names.

## Source

```
  userland/sdk/nonos_std/src/lib.rs            the crate surface
  userland/sdk/nonos_std/src/collections/hash/  the seeded HashMap
  userland/sdk/nonos_std/src/net/               TcpStream, TcpListener, UdpSocket
  userland/sdk/nonos_std/src/{fs,process,sync,env,time}/   the platform modules
```
