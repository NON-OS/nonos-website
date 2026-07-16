---
title: "ABI"
description: "The binary contract a capsule compiles against: how a syscall is made, how arguments and return values are passed, and what every call does."
weight: 60
---
The binary contract a capsule compiles against: how a syscall is made, how
arguments and return values are passed, and what every call does.

| Page | What it covers |
|------|----------------|
| [syscalls.md](/docs/abi/syscalls/) | The full syscall reference. Calling convention, number encoding, capability gating, and a per-call table for every family: process and time, memory, capabilities, IPC, the device broker, port IO, surfaces, input, crypto, and admin. |
| [errors.md](/docs/abi/errors/) | The error codes. The negative-i64 return convention, the full errno table with values, and what causes the common ones. |

The authoritative sources behind this section are [`src/syscall/numbers/defs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/defs.rs)
for the numbers and [`src/syscall/contract/cap_table/mk.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs) for the capability
each call requires. The page mirrors them; when in doubt, the code wins.
