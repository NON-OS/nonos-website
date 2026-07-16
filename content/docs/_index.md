---
title: "NØNOS Documentation"
description: "Reference documentation for the NØNOS microkernel: a from-scratch, nostd, capability-based, RAM-resident operating system."
weight: 1
---
Reference documentation for the NØNOS microkernel: a from-scratch, `no_std`,
capability-based, RAM-resident operating system. It is multi-architecture by
construction: x86_64 is the production-first target, with aarch64 and riscv64
as architecture-ready backends behind a shared arch boundary.

This repository is the single source of truth for how the system is built and
why. It is written against the actual source tree, with file and line
references, so a reader can open the kernel beside a page and confirm every
claim. Nothing here is aspirational. If a page describes behaviour, that
behaviour exists in the code at the cited location.

The documentation is mounted into the kernel repository as a Git submodule at
`docs/`, so a checkout of the kernel always carries the matching documentation
revision.

## Layout

```
nonos-docs/
├── architecture/      System model in one document: the whole map
├── subsystems/        Per-subsystem deep dives (broker, input, graphics, ipc, ...)
├── security/          Trust anchor, capsule signing, capabilities, tokens
├── userland/          The capsule userland model, the SDK, the desktop stack
├── arch/              The x86_64, aarch64, and riscv64 backends
├── abi/               Syscall numbers, calling convention, per-call contracts
└── build/             The toolchain, the cargo and Make build, capsule signing
```

## Start here

Read the [mission](/docs/architecture/mission/) first: what NØNOS is for, the problem it solves, why it
differs from monolithic OSes, other microkernels, and "secure OS" products, and the crypto and Ethereum
use case. Then the [architecture overview](/docs/architecture/overview/), the map the rest of the
documentation hangs off: one document that walks the arch boundary, the privilege model, the boot order,
memory, capsules, verified spawn, capabilities, syscalls, IPC, scheduling, the hardware broker, and the
input and graphics paths. Every other page zooms into one box of it. Then the
[verification](/docs/architecture/verification/) page, which states exactly what NØNOS proves and does not
prove, and how to reproduce every claim.

After that, pick a wing:

| Area | Where | What it covers |
|------|-------|----------------|
| Architecture | [architecture/](/docs/architecture/) | The mission and use cases, the whole-system model in one overview, and the honest verification scope (Lean, Verus, Kani, known-answer proofs). |
| Subsystems | [subsystems/](/docs/subsystems/) | Per-subsystem deep dives: boot, memory, process model, ELF loader, scheduler, SMP, syscall, IPC, hardware broker, interrupts, input, graphics, networking, storage, time, crypto, proof system. |
| Security | [security/](/docs/security/) | The trust anchor, capsule signing and MAC, the certificate and manifest schemas, capabilities and tokens, delegation, revocation, and attestation. |
| Userland | [userland/](/docs/userland/) | The capsule userland model, the capsule catalog, the SDK and nonos_std, the desktop stack, and how to write an app. |
| Arch | [arch/](/docs/arch/) | The arch boundary, platform discovery, and the x86_64, aarch64, and riscv64 backends behind it. |
| ABI | [abi/](/docs/abi/) | Every syscall with its calling convention, number, capability, and semantics; the error codes; and the driver-broker ABI. |
| Build | [build/](/docs/build/) | The toolchain, the cargo and Make workflows, and the capsule signing pipeline. |

Each page follows the same rule as the overview: code-accurate, cross
referenced, and verifiable against the tree.

## Conventions

Source references use the form `path/to/file.rs:LINE` relative to the kernel
repository root. Function and type names are quoted exactly as they appear in
the tree. Diagrams are plain ASCII so they render identically in a terminal, a
pager, a code review, and a browser.

## License

This documentation is part of the NØNOS project and is licensed under the GNU
Affero General Public License, version 3. The full text is in [LICENSE](https://github.com/NON-OS/nonos-micro-kernel/blob/main/docs/LICENSE).
The documentation carries the same terms as the kernel it describes: the right
to use, study, share, and modify it, with the obligation to pass those same
rights on.
