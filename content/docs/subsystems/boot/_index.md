---
title: "Boot and Init"
description: "How NØNOS comes up, from a verified image to a running capsule fleet."
weight: 2
---
How NØNOS comes up, from a verified image to a running capsule fleet. Boot has three phases: a signed
bootloader authenticates the kernel and hands it a description of the machine, the kernel brings its
subsystems up in a fixed dependency order, and a single init process enters user space and spawns the
capsule fleet that is the actual system.

| Page | What it covers |
|------|----------------|
| [handoff.md](/docs/subsystems/boot/handoff/) | The `KernelHandoff` structure (memory, framebuffer, timing, firmware, arch), and the bootloader's hybrid-signature and TPM-rollback verification in front of it. |
| [kernel-init.md](/docs/subsystems/boot/kernel-init/) | `microkernel_init`: the ordered bring-up (RNG, IPC key, SMP, scheduler, clock, VM, framebuffer, process, loader, keys, APs) and why the order is fixed. |
| [userspace-init.md](/docs/subsystems/boot/userspace-init/) | Creating the init process, crossing into user space, spawning the capsule fleet in dependency order, and the resident supervisor. |

The through-line is that trust and dependencies both flow in one direction. Trust flows from the
firmware root: the bootloader vouches for the kernel, the kernel's baked anchor vouches for capsule
certificates, and each manifest vouches for its image, so nothing runs unverified. Dependencies flow
through the init order: entropy before the keyed IPC path, the bootstrap CPU before the scheduler, the
virtual-memory manager before any process, and the filesystem and drivers before the stacks and
applications that use them. When both chains have run, the kernel holds only the primitives and the
capsule fleet does the work, which is the whole design of the system in one boot.

## Sources

The handoff types are `src/boot/handoff/`, the firmware init is [`src/boot/firmware.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/boot/firmware.rs), the kernel init
sequence is `src/kernel_core/init/`, and the userspace supervisor is `src/userspace/init/`. The
bootloader that verifies the kernel and produces the handoff is the separate `nonos-bootloader` crate.
Every page is verified against those trees with `file:line` references.
