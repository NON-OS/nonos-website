---
title: "Userland Model"
description: "This page describes how NØNOS userland is arranged: capsule source trees, kernel mirror modules, init spawn order, and the residual supervisor loop."
weight: 40
---
This page describes how NØNOS userland is arranged: capsule source trees,
kernel mirror modules, init spawn order, and the residual supervisor loop. Read
[Architecture Overview](/docs/architecture/overview/) first, then read
[Syscall ABI Reference](/docs/abi/syscalls/).

Pages in this section:

| Page | Scope |
|------|-------|
| [Writing an App](/docs/userland/writing-an-app/) | The `App` trait, the manifest, the runtime loop, and the source-to-spawned-capsule pipeline. |
| [The std PAL](/docs/userland/std-pal/) | Running unmodified Rust `std` programs: the graft, the per-facility mapping, gaps, and how to build one. |
| [The nonos_std Crate](/docs/userland/nonos-std/) | The native std-shaped API for `no_std` capsules: collections, net, fs, and the seeded HashMap. |
| [Using the Network](/docs/userland/networking-guide/) | The developer view of networking: `TcpStream` / `UdpSocket`, what happens underneath, and the limits. |
| [The Terminal](/docs/userland/terminal/) | The terminal capsule and shell: the app model, pipelines and redirects, and the builtins. |
| [Capsule Catalog](/docs/userland/) | Every capsule, one by one: a verified per-capsule spec (purpose, ops, behavior, gaps) for the core, desktop, app, and proof capsules. |
| [SDK](/docs/userland/sdk/) | Syscall bindings, runtime crates, and capsule structure. |
| [Desktop](/docs/userland/desktop/) | GUI capsules, desktop IPC, window state, and input routing. |
| [Desktop Service Capsules](/docs/userland/desktop-capsules/) | Compositor, WM, input router, shell, wallpaper, image, clipboard, login, and toolkit internals. |
| [GUI Contracts](/docs/userland/gui-contracts/) | Window placement, move, resize, close, focus, cursor, and input delivery contracts. |
| [Protocol Atlas](/docs/userland/protocols/) | IPC op tables, app control frames, launch frames, and per-family protocol surfaces. |
| [Lifecycle and Launch](/docs/userland/lifecycle/) | Init spawn order, verified spawn, lifecycle tracking, supervisor loop, and taskbar focus. |
| [Runtime Workflows](/docs/userland/workflows/) | End-to-end boot, launch, render, input, window, storage, network, and debug workflows. |
| [Capsule Inventory](/docs/userland/capsules/) | Complete userland capsule inventory with handles, endpoints, caps, entrypoints, and protocol refs. |
| [Applications](/docs/userland/apps/) | App skeleton contract, app manifests, deterministic window geometry, input masks, and direct GUI apps. |
| [Services](/docs/userland/services/) | Core, security, storage, desktop service, proof, policy, market, login, clipboard, image, and toolkit capsules. |
| [Core Service Capsules](/docs/userland/core-capsules/) | RAMFS, VFS, keyring, entropy, crypto, policy, attest, market, installer, payment, power, and proof internals. |
| [Storage Capsules](/docs/userland/storage-capsules/) | RAMFS, VFS, virtio block, AHCI, NVMe, and USB mass storage internals. |
| [Drivers](/docs/userland/drivers/) | User-mode hardware driver capsules, boot group, endpoint, capability, and protocol surface. |
| [Network Capsules](/docs/userland/network-capsules/) | L2, IPv4, UDP, DHCP, TCP, DNS, sockets, and Nym capsule contracts. |

This section is organized as an audit path. Start with source layout, confirm how
a capsule becomes embedded bytes, follow init into verified spawn, then move into
the desktop, app, service, driver, and network pages for subsystem detail.

---

## 1. Capsule source layout

A production capsule has two source locations. The user-mode program lives under
`userland/<capsule>`. The kernel mirror lives under `src/userspace/capsule_*`
and embeds the capsule ELF, NØNOS-ID certificate, and manifest into the kernel
build. The desktop shell mirror is the clean example: `embed.rs` includes the
ELF from `userland/capsule_desktop_shell/target/.../desktop_shell`, the
certificate from `nonos-data/trust/capsules/desktop_shell.nonos_id_cert.bin`,
and the manifest from `nonos-data/trust/capsules/desktop_shell.manifest.bin`
([`src/userspace/capsule_desktop_shell/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/embed.rs#L17)).

The same mirror exposes one spawn function and one lifecycle state accessor.
`mod.rs` exports `spawn_desktop_shell_capsule` and `shared_state`
([`src/userspace/capsule_desktop_shell/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/mod.rs#L17)). The spawn function builds a
`CapsuleSpecVerified` with service port, reply inbox, target triple, embedded
payloads, and requested capability bits, then calls `spawn_verified`
([`src/userspace/capsule_desktop_shell/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/spawn.rs#L36)).

```
  +-----------------------------+
  | userland/capsule_*          |
  | no_std binary, Cargo.toml   |
  | Capsule.mk                  |
  +-------------+---------------+
                |
  +-------------+---------------+
  | build and sign              |
  +-------------+---------------+
                |
  +-----------------------------+
  | target/.../release/<bin>    |
  | nonos-data/trust/capsules   |
  | cert.bin, manifest.bin      |
  +-------------+---------------+
                |
  +-------------+---------------+
  | include_bytes               |
  +-------------+---------------+
                |
  +-----------------------------+
  | src/userspace/capsule_*     |
  | embed.rs, spawn.rs, state.rs|
  +-------------+---------------+
                |
  +-------------+---------------+
  | spawn_verified              |
  +-------------+---------------+
                |
  +-----------------------------+
  | user process on runqueue    |
  +-----------------------------+
```

## 2. Init sequence

The init capsule starts in `run_init`. Its ordered spawn sequence is RAMFS,
core services, display core, drivers, VFS, network, desktop, market, apps, then
the supervisor loop ([`src/userspace/init/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L25)). The source spells the
sequence directly: `spawn_ramfs`, `spawn_core_after_ramfs`, `spawn_display_core`,
`spawn_drivers`, `spawn_vfs`, `spawn_network`, `spawn_desktop`, `spawn_market`,
and `spawn_apps` are called before `init_loop`
([`src/userspace/init/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L25), [`src/userspace/init/entry.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L33)).

The orchestrator splits those phases into small entry points. Drivers are
grouped as virtio, bus, input, NIC, USB, and storage
([`src/userspace/init/spawn_plan/orchestrator.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L29)). Network startup calls L2,
IP, UDP, DHCP, TCP, DNS, Nym, and sockets in that order
([`src/userspace/init/spawn_plan/network.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L17)). Desktop startup calls
input_router and compositor as GUI core, then WM, wallpaper catalog, wallpaper,
desktop shell, and desktop services ([`src/userspace/init/spawn_plan/desktop_fleet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L17)).

```
+--------------------------+
| run_init                 |
+------------+-------------+
             |
+------------+-------------+
| ramfs and core services  |
+------------+-------------+
             |
+------------+-------------+
| driver groups            |
+------------+-------------+
             |
+------------+-------------+
| vfs and network          |
+------------+-------------+
             |
+------------+-------------+
| desktop and market       |
+------------+-------------+
             |
+------------+-------------+
| app fleet (spawn_apps)   |
+------------+-------------+
             |
+------------+-------------+
| supervisor loop          |
+--------------------------+
```

| Phase | Source |
|-------|--------|
| RAMFS first | [`src/userspace/init/entry.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L28) |
| Core after RAMFS | [`src/userspace/init/spawn_plan/core.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L22) |
| Driver groups | [`src/userspace/init/spawn_plan/orchestrator.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L29) |
| VFS | [`src/userspace/init/entry.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L32) |
| Network stack | [`src/userspace/init/spawn_plan/network.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network.rs#L17) |
| Desktop stack | [`src/userspace/init/spawn_plan/desktop_fleet.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L17) |
| Market | [`src/userspace/init/spawn_plan/core.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L35) |
| App fleet | [`src/userspace/init/spawn_plan/apps.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L17) |

## 3. Supervisor loop

After spawning, init lowers its own priority and yields one hundred times before
entering the supervisor loop ([`src/userspace/init/entry.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L73),
[`src/userspace/init/entry.rs:82`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L82)). The loop ticks the lifecycle registry once
per second, then yields ([`src/userspace/init/supervisor/loop_impl.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L31),
[`src/userspace/init/supervisor/loop_impl.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L40)); it does not drain any launcher
inbox, since the apps are already running from boot. With the setup wizard
feature enabled, the same loop waits until the setup wizard is no longer alive,
then calls `spawn_post_wizard` ([`src/userspace/init/supervisor/loop_impl.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L35)).

The lifecycle state is capsule-local. The desktop shell mirror holds a static
`CapsuleState`, records the pid after spawn, and exposes a shared accessor
([`src/userspace/capsule_desktop_shell/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_desktop_shell/state.rs#L17)).

## 4. Verified spawn path

`CapsuleSpecVerified` is the kernel-side contract for a signed capsule. It holds
the service name and port, reply inbox and port, ELF bytes, certificate bytes,
manifest bytes, target triple, requested capability ceiling, and debug tag
([`src/kernel_core/process_spawn/capsule_spawn/spec.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/spec.rs#L31)).

Before install, preflight decodes and verifies the NØNOS-ID certificate, builds
the declared service and reply endpoints, and verifies the manifest against the
certificate, trust anchor, ELF bytes, target triple, requested caps, and
declared endpoints ([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L29)).
The caps installed on the process come from the verified manifest result, not
directly from `requested_caps` ([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L23)).

Install registers the reply inbox, creates the process, registers a per-process
inbox, loads the ELF, installs caps, allocates kernel and user stacks, builds
the first user context, registers the service endpoint, and adds the pid to the
runqueue ([`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L30)).

## 5. Security analysis

The security of the whole userland rests on a single property: nothing runs that
was not verified first. Preflight is the gate, and it runs before the ELF is ever
loaded. It decodes and verifies the NØNOS-ID certificate against the production
policy and trust anchor, then verifies the manifest against the certificate, the
verified identity, the trust anchor, the ELF bytes, the target triple, the
requested caps, and the declared endpoints
([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L29)). Only if all
of that holds does install load the binary. A capsule whose ELF does not match the
hash in its signed manifest, whose target triple is wrong, or whose certificate is
rejected never reaches the loader; the spawn returns a `SpawnError` and init logs
it ([`src/kernel_core/process_spawn/capsule_spawn/spec.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/spec.rs#L48)).

The capability model is least privilege by construction, and the construction is
the part that matters. The caps installed on the process come from the verified
manifest result, not from the `requested_caps` the spawn site passed in
([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L23)). The comment
on that function states the rule directly: `requested_caps` is only the upper bound
the spawn site is willing to grant for optional caps, and the installed set is what
the signed manifest actually asked for. The manifest verifier enforces its own
ceiling on top of that, rejecting a manifest whose caps exceed the certificate's
grant with `CapsExceedCeiling` ([`src/security/capsule_manifest/error.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/error.rs#L50)). So a
capsule cannot widen its own authority by asking for more at the spawn site, and it
cannot ship a manifest that asks for more than its publisher was licensed to grant.
The twenty-two capability bits ([`src/capabilities/types.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L81)) are the vocabulary;
the manifest is the binding contract for which of them a given capsule holds.

Isolation between capsules is the address-space boundary plus the named-endpoint
boundary. Each capsule is a separate process with its own address space and its own
per-process inbox, so one capsule cannot read another's memory or receive another's
messages. They cooperate only through the service endpoints they registered and the
reply inboxes they own, which is why the input router, the compositor, and the WM
are separate services rather than one process: a fault or a compromise in one does
not reach into the others.

## 6. Debugging spawn and boot

Every capsule that boots emits one marker. The init boot helper logs `capsule
spawned` on success and registers the capsule with the lifecycle registry; on
failure it logs the mapped error string and does not register
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). So the first question for a missing
capsule is whether that line appeared. If it did not, the spawn failed, and the
error string names which stage: `capsule binary not embedded (feature off)` means
the mirror was built without its embed feature, `capsule ELF load failed` is a
loader problem, `service endpoint registration failed` is an endpoint collision,
and the certificate and manifest rejections carry their own reason
([`src/userspace/init/capsule_boot/error.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/error.rs#L21)). A capsule that spawned but then
disappears is a runtime exit, not a spawn failure, and the lifecycle registry tick
is what notices its pid went away
([`src/userspace/init/supervisor/loop_impl.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L25)).

The init spawn order is deterministic and is the map for a boot that stalls partway.
The sequence is RAMFS, core services, display core, drivers, VFS, network, desktop,
market, then the app fleet ([`src/userspace/init/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L25)). A boot that reaches the
desktop markers but shows no window is a desktop-fleet problem; one that never
reaches them stalled earlier, and the last `capsule spawned` line tells you which
phase. Because each capsule's caps are logged as part of its identity, an `EPERM`
seen at runtime traces back to the manifest that phase installed.

## 7. Source map

```
  src/userspace/init/entry.rs                        run_init and the ordered spawn sequence
  src/userspace/init/spawn_plan/                      the per-phase spawn entry points
  src/userspace/init/capsule_boot/run.rs, error.rs   the boot marker and the error strings
  src/kernel_core/process_spawn/capsule_spawn/spec.rs        CapsuleSpecVerified and SpawnError
  src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs  cert and manifest verification
  src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs   install_caps from the manifest
  src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs  the install steps
  src/security/capsule_manifest/error.rs             the manifest rejection reasons
  src/capabilities/types.rs                          the 22 capability bits
```

The syscall boundary each capsule compiles against is on
[the syscall ABI page](/docs/abi/syscalls/); the lifecycle and launcher detail is on
[the lifecycle page](/docs/userland/lifecycle/).
