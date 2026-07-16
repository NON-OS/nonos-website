---
title: "Kernel Initialization"
description: "When the bootloader hands control to the kernel, microkernelinit brings the system up in a fixed order, each step a precondition for the next, and any step that cannot complete ..."
weight: 2
---
When the bootloader hands control to the kernel, `microkernel_init` brings the system up in a fixed
order, each step a precondition for the next, and any step that cannot complete is fatal. This page
walks that sequence. The code is [`src/kernel_core/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs).

## The sequence

`microkernel_init(handoff)` (`entry.rs:24`) runs the bring-up in order:

```
  1.  init_arch_memory_and_framebuffer   EFI memory map -> frame allocator; early framebuffer
  2.  boot_log init                       the on-screen and serial boot log
  3.  init_arch_firmware                  ACPI / SMBIOS tables
  4.  hostname_init
  5.  crypto::rng::init_rng               FATAL if entropy is unavailable
  6.  ipc::init_ipc_secret                FATAL: seed the IPC MAC key
  7.  smp::init_bsp                       FATAL: bring up the bootstrap processor
  8.  sched::init                         the scheduler
  9.  clock::init                          TSC frequency + boot epoch from the handoff
  10. memory::init_unified_vm             FATAL: the paging manager and kernel address space
  11. init_arch_framebuffer               MMIO-map the framebuffer (needs paging)
  12. init_broker_irq_routing            the IO-APIC routing for device IRQs
  13. process::init_process_management    the process tables
  14. elf::loader::init_elf_loader        the capsule loader
  15. crypto::kernel_keys::init           the kernel Ed25519 signing keypair
  16. start_secondary_cpus                the application processors
```

Each numbered step depends on the ones before it, which is why the order is fixed and not merely
conventional.

## Why the order

The dependencies are load-bearing, and the code comments call the sharp ones out:

- **RNG before the IPC secret.** The [IPC MAC key](/docs/subsystems/ipc/envelope/) is drawn from the secure RNG,
  so entropy must be up first; both are fatal on failure, because the kernel will not run with an
  unseeded generator or an unkeyed IPC path.
- **The BSP before the scheduler.** The scheduler and everything per-CPU need the
  [bootstrap processor's per-CPU data](/docs/subsystems/smp/per-cpu/) established first.
- **The virtual-memory manager before any process.** `init_unified_vm` brings up the
  [paging manager](/docs/subsystems/memory/unified-vm/) and the kernel's own address space; no process, not even
  init, can be created before it, so process-management init and the userspace init process both come
  after.
- **The framebuffer MMIO map after paging.** The framebuffer is mapped as MMIO, which needs the
  paging machinery, so the early step only records it and the real mapping happens at step 11; doing
  it earlier failed on real GOP framebuffers because the page tables were not ready.
- **The ELF loader before the kernel keys are used, and both before spawning.** The
  [capsule loader](/docs/subsystems/elf-loader/) and the [signing key](/docs/subsystems/crypto/asymmetric/) must exist
  before any capsule is verified and loaded.

## Fatal failures

Steps marked fatal call `fatal` (`entry.rs:73`), which writes the stage and detail to the boot log
and serial and halts. These are the invariants the kernel refuses to run without: entropy, a keyed
IPC path, a live bootstrap processor, and a working virtual-memory manager. The kernel does not limp
along in a degraded state past any of them; it stops with a legible reason. After step 16 the core is
ready, and control passes to [userspace init](/docs/subsystems/boot/userspace-init/).

## Security analysis

Init is a security event because it establishes the invariants everything later depends on, and it does
so fail-closed: a missing precondition halts rather than degrades.

**Fatal preconditions halt, they do not degrade.** The four steps that call `fatal` (`entry.rs:73`) are
the RNG (`entry.rs:33`), the IPC MAC secret (`entry.rs:36`), the bootstrap processor (`entry.rs:39`),
and the unified VM (`entry.rs:49`). Each writes its stage to the boot log and serial and then calls
`crate::arch::halt_loop()`, so the kernel never runs a capsule with an unseeded generator, an unkeyed
IPC path, no live CPU, or no virtual-memory manager. There is no partial-boot mode past these; the
system stops with a legible reason. The same discipline appears in `microkernel_main`, where a failure
to create the init process, its address space, or its kernel stack halts (`entry.rs:125` onward).

**The trust primitives are established before any capsule can spawn.** The kernel signing keypair
(`crypto::kernel_keys::init`, `entry.rs:64`) and the ELF loader (`entry.rs:63`) come up in the core
sequence, and no capsule is spawned until `microkernel_main` runs afterward. So by the time the first
capsule is verified, the loader and the keys it checks against both exist. The baked trust anchor the
capsule certificates root in is compiled into the kernel image the bootloader already authenticated, so
it is not something init has to fetch or establish.

**Ordering is the safety property, not a convenience.** RNG precedes the IPC secret because the secret
is drawn from it; the BSP precedes the scheduler because per-CPU state must exist first; the VM manager
precedes every process creator. A reordering that ran a dependent step first would not fail safe, it
would run on uninitialised state, which is why the order is fixed in code rather than left to
convention.

## Debugging kernel init

On a machine with no serial port the kernel's on-screen text log is deliberately off: `init_after_fb`
([`src/sys/boot_log/init.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/init.rs#L22)) prints "[fbconsole] on-screen log disabled; serial only" and leaves the
bootloader's verified-boot splash in the framebuffer for the compositor to build on, so the kernel log
is a serial-only stream. Each successful stage prints through `boot_log::ok` as a bracketed tag line,
"[NØNOS] Microkernel init" (`entry.rs:29`), "[NØNOS] broker IO-APIC routing ready" (`entry.rs:59`),
"[NØNOS] Core ready" (`entry.rs:69`), and the pre-init steps in `core_init.rs` print their own
"[NØNOS] ..." lines ("[NØNOS] PCI enumerated", "[NØNOS] hardware broker seeded"). A fatal stop is the
"[ERROR] ..." line from `boot_log::error` followed by "[FATAL] <stage>: <detail>" on serial
(`entry.rs:74`), so the last two serial lines name exactly which precondition failed. The common early
symptom, a black screen with the bootloader splash frozen and the kernel serial silent after the
handoff, means bring-up died before or at the first `boot_log` call rather than at any specific stage.
The `bench::mark` breadcrumbs ("vm_ready", "process_runtime_ready", "microkernel_core_ready" at
`entry.rs:52`, `65`, `70`) bracket the sequence for locating where progress stopped.

## Source map

```
  src/kernel_core/init/entry.rs             microkernel_init, the ordered sequence, fatal, microkernel_main
  src/kernel_core/init/memory.rs             the early arch memory bring-up
  src/kernel_core/init/framebuffer.rs        the framebuffer MMIO map
  src/kernel_core/init/start_secondary.rs    the AP bring-up
  src/boot/main/core_init.rs                 the pre-init serial markers (PCI, broker, APIC)
  src/sys/boot_log/init.rs                   init_after_fb, why the on-screen log stays off
  src/sys/boot_log/output.rs                 boot_log::ok / error, the bracketed tag lines
```

Every reference above is verified against those trees. The handoff and its verification that precede
this sequence are on the [handoff](/docs/subsystems/boot/handoff/) page; the userspace transition that follows it is on the
[userspace init](/docs/subsystems/boot/userspace-init/) page; the VM manager step 10 brings up is the
[paging manager](/docs/subsystems/memory/paging-manager/).
