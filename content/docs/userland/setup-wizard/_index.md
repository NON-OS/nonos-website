---
title: "The Setup Wizard Capsule"
description: "capsulesetupwizard is the machine's first-boot screen: a full-screen guided flow that runs after the GUI core is up but before the desktop fleet, and walks the user through lang..."
weight: 400
---
`capsule_setup_wizard` is the machine's first-boot screen: a full-screen guided flow that runs after the
GUI core is up but before the desktop fleet, and walks the user through language, keyboard, identity keys,
a disk passphrase, persistence, network mode, an admin password, privacy toggles, and appearance, then
commits the non-secret choices to the policy service and exits so the kernel brings up the desktop. It is a
direct compositor-surface runner, not an [app-skeleton](/docs/userland/writing-an-app/) window: it owns the whole
screen and grabs the keyboard for the duration. Its source is organized into a handful of pillars, and this
documentation mirrors that structure one page per pillar so a page can be read beside the folder it
describes.

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `setup-wizard` | `Capsule.mk:6` |
| Service handle | `app.setup_wizard` | `Capsule.mk:7`, [`src/userspace/capsule_setup_wizard/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_setup_wizard/spawn.rs#L31) |
| Namespace | `systems.nonos.app.setup_wizard` | `Capsule.mk:12` |
| Service endpoint | `service:4794:app.setup_wizard` | `Capsule.mk:13`, `spawn.rs:32` |
| Reply endpoint | `reply:4795:endpoint.app.setup_wizard.reply` | `Capsule.mk:14`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x1819` | `Capsule.mk:15` |
| Binary name | `setup_wizard` | `Capsule.mk:10` |
| Kernel mirror | `src/userspace/capsule_setup_wizard` | `Capsule.mk:16` |

The mask `0x1819` decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | create the full-screen surface it draws into | `types.rs:68` |

```
  0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000
         = 1 + 8 + 16 + 2048 + 4096
```

The kernel spawn path requests exactly those five capabilities and no others
([`src/userspace/capsule_setup_wizard/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_setup_wizard/spawn.rs#L50)). It is the same graphics-client mask the terminal and
the other full-screen leaf renderers carry. There is no `GraphicsSurfaceMap` (`0x2000`), no
`GraphicsPresent` (`0x4000`), no `Network` (`0x0004`), no `FileSystem` (`0x0040`), and no crypto,
hardware, driver, MMIO, or DMA capability ([`src/capabilities/types.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L69), `types.rs:70`, `types.rs:58`,
`types.rs:62`). On the strength of its mask alone it can register one surface, ask the display for its
size, and speak IPC, and nothing more.

The wizard's power over the machine does not come from this mask. It comes from being one of exactly two
names the policy service trusts to write configuration, and one of three names the input router allows to
take an exclusive keyboard grab. The policy set-handler hard-codes two trusted setters, `app.settings` and
`app.setup_wizard`, and rejects a write from any other pid with `E_ACCES`
([`userland/capsule_policy/src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L23), `handle_set.rs:41`). The input router hard-codes
three trusted grabbers, `app.boot_splash`, `app.setup_wizard`, and `app.input_probe`
([`userland/capsule_input_router/src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/grab_request.rs#L25)). Those two boundaries live in the
[policy](/docs/userland/policy/) and [input-router](/docs/userland/input-router/) services, gated on the wizard's
name, and the [policy write page](/docs/userland/setup-wizard/policy-writes/) sets out what the wizard actually does with that trust.

## The pillars

The source under `userland/capsule_setup_wizard/src/` splits into a small model (`state.rs`), a bring-up
stage (`setup/`), a driver loop and step machine (`server/`), the screens and widgets (`render/`), and the
IPC clients (`clients/`). Data flows in one direction: a key comes in through the input router, the
`server` loop routes it to the current screen's `on_key`, that mutates `Context`, and the loop redraws the
screen through `render`. When the last step commits, the review screen writes the choices out through the
policy client.

```
  key in  ->  server loop  ->  screen on_key  ->  Context  ->  render redraw
                                                     |
                                                     v  (final step only)
                                              policy write out
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [steps.md](/docs/userland/setup-wizard/steps/) | `src/render/screens/` | The ten steps as a user reference: each screen, its keys, and what it stores in `Context`. |
| [state-machine.md](/docs/userland/setup-wizard/state-machine/) | `src/server/`, `src/render/`, `src/setup/`, [`src/protocol.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs) | The step counter and its clamps, the global keys, the key-driven loop, service bring-up, and how a screen becomes pixels. |
| [policy-writes.md](/docs/userland/setup-wizard/policy-writes/) | [`src/render/screens/review.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs), [`src/clients/policy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs) | The review commit, the two-name policy gate, the keyboard grab, and the honest gaps between what the wizard collects and what it writes. |
| [contributing.md](/docs/userland/setup-wizard/contributing/) | the whole tree | Where to work, the exact steps to add a wizard step, the build and sign targets, and the code standards. |
| [debugging.md](/docs/userland/setup-wizard/debugging/) | runtime | The boot marker, the failure modes, and where to look when bring-up, input, or a policy write misbehaves. |

## Lifecycle

Under the `microkernel-setup-wizard` feature the orchestrator first spawns the GUI core, then boots the
wizard through the shared capsule-boot path and holds the desktop fleet back until it exits
([`src/userspace/init/spawn_plan/orchestrator.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L56), `orchestrator.rs:58`, `orchestrator.rs:67`). Boot
verifies the embedded ELF, id cert, manifest, and ZK attestation, registers `app.setup_wizard` on port
4794, and logs `[SETUP-WIZARD] capsule spawned` ([`src/userspace/capsule_setup_wizard/spawn.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_setup_wizard/spawn.rs#L57),
[`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). `_start` initialises the heap, runs `setup::run` to discover
services and put a surface on screen, then hands the resulting `Context` to `server::runner::run`, which
never returns ([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16)). The runner grabs the keyboard, draws, and loops on key deliveries; when
the step counter reaches `DONE`, the review step has already committed the choices, the runner removes the
scene and calls `mk_exit(0)`, and the supervisor then starts the desktop ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31),
[`src/userspace/init/supervisor/loop_impl.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/supervisor/loop_impl.rs#L36)). The [state machine page](/docs/userland/setup-wizard/state-machine/) walks each
stage in detail.

## Source map

```
  userland/capsule_setup_wizard/src/main.rs        _start -> setup::run -> server::runner::run
  userland/capsule_setup_wizard/src/state.rs       Context: step, every selection, pass/admin/host buffers
  userland/capsule_setup_wizard/src/setup/         service discovery and surface bring-up
  userland/capsule_setup_wizard/src/server/        the key loop and the step machine
  userland/capsule_setup_wizard/src/render/        the ten screens, widgets, panel, and theme
  userland/capsule_setup_wizard/src/clients/       compositor, display-info, input-router, policy clients
  userland/capsule_setup_wizard/src/protocol.rs    the input-router request and key-delivery wire
  userland/capsule_setup_wizard/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                        the capability bits behind the mask
  src/userspace/capsule_setup_wizard/spawn.rs      the kernel-side embed and verified spawn
```

Everything here is drawn from `userland/capsule_setup_wizard/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn mirror under
`src/userspace/capsule_setup_wizard/`. Every reference above is verified against those trees.
</content>
</invoke>
