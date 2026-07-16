---
title: "Userspace Init"
description: "Once the core is ready, the kernel creates one process, init, enters user space, and from there the whole system is capsules."
weight: 3
---
Once the core is ready, the kernel creates one process, `init`, enters user space, and from there the
whole system is capsules. Init is the supervisor: it spawns the capsule fleet in dependency order and
then stays resident to watch over them. This page documents that transition. The code is
[`src/kernel_core/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs) and `src/userspace/init/`.

## Creating init

`microkernel_main` (`entry.rs:112`) is where the kernel crosses into user space:

```
  microkernel_main():
      spin-wait a short settling window (~2.5 s guard)
      init_pid = create_process("init", Running, High)
      create_address_space(init_pid)
      allocate_kernel_stack(init_pid)
      CURRENT_PID = init_pid
      userspace::run_init()
```

Init is created like any process, a [PCB](/docs/subsystems/process/pcb/), a fresh [address space](/docs/subsystems/memory/unified-vm/),
and a kernel stack, at high priority because it is the supervisor. Each of these steps is fatal on
failure: a system that cannot create its init process cannot boot, so the failure halts with a reason
rather than continuing. Once init is current, control enters `run_init`, which is the first code that
runs conceptually in user space.

## Spawning the fleet

`run_init` ([`src/userspace/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs)) spawns the capsule fleet in dependency order:

```
  run_init():
      spawn_ramfs()               the filesystem first
      spawn_core_after_ramfs()
      spawn_display_core()
      spawn_drivers()             bus, input, NIC drivers
      spawn_vfs()
      spawn_network()             net_core, sockets, nym
      spawn_desktop()             compositor, window manager, shell
      spawn_market()
      spawn_apps()
      lower_init_priority()
      init_loop()                 the supervisor loop
```

The order is a dependency order: the [filesystem](/docs/subsystems/storage/) comes up first because later
capsules read from it, the [drivers](/docs/subsystems/hardware-broker/) before the stacks that use them, the
[network](/docs/subsystems/networking/) and [display](/docs/subsystems/graphics/) before the desktop, and the
applications last. Each spawn goes through the [verified-spawn](/docs/subsystems/elf-loader/integration/) pipeline,
so every capsule in the fleet is signature- and capability-checked as it is loaded. After the fleet is
up, init lowers its own priority so it does not compete with the capsules it launched.

## The supervisor loop

Init does not exit; it becomes the supervisor (`src/userspace/init/supervisor/`). The `init_loop` is
the resident parent that the [process lifecycle](/docs/subsystems/process/lifecycle/) reaps children into: when a
capsule exits, init is where the final teardown accounting settles, and a supervised capsule that dies
can be restarted per policy. This is the userspace analogue of the kernel's fatal invariants, the
system always has a live supervisor, just as it always has a keyed IPC path and a working VM. From here
the system is running: the kernel holds the primitives, and the capsule fleet, filesystem, network,
display, and applications, does the work.

## Security analysis

Userspace init is where the trust chain reaches the capsules, so its properties are about what a capsule
must prove before it is allowed to run and what happens to the system if the proof fails.

**The spawn is fail-closed on attestation.** Every capsule goes through the verified-spawn pipeline, and
the ZK attestation gate ([`src/kernel_core/process_spawn/capsule_spawn/runner/attest_gate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/attest_gate.rs)) is the
last check before load. By default the gate is closed: a capsule with an empty attestation trailer is
rejected with `SpawnError::AttestationRejected` (`attest_gate.rs:28`), and a trailer that fails
`verify_capsule_attestation` is rejected the same way (`attest_gate.rs:49`). Only the
`nonos-zk-rollout` build feature turns the gate permissive, logging the failure but returning `Ok`
(`attest_gate.rs:30`, `attest_gate.rs:52`); a production build without that feature will not spawn an
unattested or wrongly attested capsule. Because init spawns the whole fleet through this one pipeline, a
capsule that cannot prove its attestation simply does not join the system.

**Attestation is one layer of a stacked check, not the only one.** The spawn also verifies the NØNOS id
certificate against the baked trust anchor, the manifest against the publisher signature and the
capability ceiling, and the payload hash, before the attestation gate runs (the `SpawnError` variants in
[`capsule_spawn/spec.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_spawn/spec.rs#L47) name each: `NonosIdCertRejected`, `ManifestRejected`, `AttestationRejected`).
The attestation gate is the innermost of these, so a capsule reaching it has already passed cert and
manifest verification.

**The system always has a live supervisor.** Init does not exit; it lowers its own priority and enters
`init_loop` (`src/userspace/init/supervisor/`). This is the userspace analogue of the kernel's fatal
invariants: just as the kernel refuses to run without a keyed IPC path or a working VM, the running
system always has a resident parent that reaps and can restart supervised capsules. The honest boundary
is that restart is per policy, not unconditional, so a capsule the supervisor is not configured to
restart stays down after it exits.

## Debugging userspace init

The fleet spawn is a serial-log stream, since the on-screen kernel log stays off (see
[kernel init](/docs/subsystems/boot/kernel-init/)). Init's own progress prints through `boot_log::ok` as "[UKERNEL]
Creating init" and "[UKERNEL] Entering userspace" ([`src/kernel_core/init/entry.rs:124`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs#L124),
`entry.rs:146`), so those two lines confirm the kernel crossed into user space at all. Each capsule
attestation prints one line from the gate: "[ZK-ATTEST] ok <name>" on success (`attest_gate.rs:35`),
"[ZK-ATTEST] FAIL <name>: <reason>" when verification fails (`attest_gate.rs:42`), and "[ZK-ATTEST] none
<name>" when a capsule has no trailer (`attest_gate.rs:24`). A spawn that is refused prints
"[RUNTIME-LOAD] FAILED name=<name> reason=<reason>" from the load path
([`capsule_spawn/from_vfs/load.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_spawn/from_vfs/load.rs)), where the reason string names the exact stage: "attestation" for the
ZK gate, "manifest:pub_sig" or the other "manifest:*" reasons for manifest checks, and "elf_load" or
"address_space" for the mechanical steps. The classic failure mode is a system that boots to the
bootloader splash and then stalls with no desktop: in a fail-closed build this is usually the
attestation gate refusing the fleet, which is what "[ZK-ATTEST] FAIL" or "[ZK-ATTEST] none" on the
first capsules confirms. Enrollment is a build-time concern (the `NONOS_DEV=1` make targets mint the
dev attestation material); a build whose capsules were never enrolled will show the "none" line and,
without `nonos-zk-rollout`, refuse every spawn.

## Source map

```
  src/kernel_core/init/entry.rs                                    microkernel_main, create init, enter userspace
  src/userspace/init/entry.rs                                       run_init, the fleet spawn order
  src/userspace/init/spawn_plan/                                    the per-group spawn plans
  src/userspace/init/supervisor/                                    the resident supervisor loop
  src/kernel_core/process_spawn/capsule_spawn/runner/attest_gate.rs the ZK attestation gate and its markers
  src/kernel_core/process_spawn/capsule_spawn/spec.rs               CapsuleSpecVerified and the SpawnError variants
  src/kernel_core/process_spawn/capsule_spawn/from_vfs/load.rs      the RUNTIME-LOAD failure marker and reason strings
```

Every reference above is verified against those trees. The core init that runs before this transition is
on the [kernel init](/docs/subsystems/boot/kernel-init/) page; the full capability and manifest verification the spawn layers
around the attestation gate is on the [verified-spawn](/docs/subsystems/elf-loader/integration/) and
[capsule trust](/docs/security/capsules-and-trust/) pages.
