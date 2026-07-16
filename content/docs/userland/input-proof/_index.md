---
title: "The Input Proof Capsule"
description: "capsuleinputproof is not an application. It is a runtime self-test of the input path, shipped as a signed, least-privilege NØNOS capsule. It draws a plain window, subscribes to ..."
weight: 400
---
`capsule_input_proof` is not an application. It is a runtime self-test of the input path, shipped as a
signed, least-privilege NØNOS capsule. It draws a plain window, subscribes to the input router, and waits
for a hardware event to arrive at a focused CPL=3 client. Each stage that completes latches a marker on the
serial log, and when every stage has fired it prints a single `PASS`. Its only product is that verdict; it
renders nothing but a cleared background and owns no hardware.

The point of the capsule is to close the loop end to end. The [input subsystem](/docs/subsystems/input/path/)
documents the driver, the kernel ring, and the router in isolation; this capsule proves that a real key
press, a pointer motion, a click, and the focus decision behind them actually reach an ordinary app surface
unaltered. It is the acceptance harness for that path, described in the source as Deliverable 2
(`userland/capsule_input_proof/Capsule.mk:2`).

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `input-proof` | `userland/capsule_input_proof/Capsule.mk:7` |
| Service handle | `app.input_proof` | `Capsule.mk:8`, [`src/userspace/capsule_input_proof/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/spawn.rs#L31) |
| Namespace | `systems.nonos.app.input_proof` | `Capsule.mk:13` |
| Service endpoint | `service:4790:app.input_proof` | `Capsule.mk:14`, `spawn.rs:32` |
| Reply endpoint | `reply:4791:endpoint.app.input_proof.reply` | `Capsule.mk:15`, `spawn.rs:33`, `spawn.rs:34` |
| Cargo feature | `nonos-capsule-input-proof` | `Capsule.mk:12` |
| Binary name | `input_proof` | `Capsule.mk:11`, `Cargo.toml:19` |
| Capability mask | `0x1919` | `Capsule.mk:18` |
| Kernel mirror | `src/userspace/capsule_input_proof` | `Capsule.mk:19` |

The mask decomposes into six bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| Debug | `0x0100` | write proof markers to the debug surface | `types.rs:64` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into | `types.rs:68` |

```
  0x1919 = 0x0001 + 0x0008 + 0x0010 + 0x0100 + 0x0800 + 0x1000
```

The kernel spawn path requests exactly those six capabilities and no others
([`src/userspace/capsule_input_proof/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/spawn.rs#L50)). The one bit that separates this capsule from an ordinary
app such as [snake](/docs/userland/snake/) or the [terminal](/docs/userland/terminal/) is `Debug` (`0x0100`),
which lets the CPL=3 surface call `mk_debug` to report its verdict; production apps do not carry it
(`Capsule.mk:2`, `Capsule.mk:5`). There is no `Network` bit (`0x0004`, `types.rs:58`), no `FileSystem` bit
(`0x0040`, `types.rs:62`), and no hardware, driver, MMIO, IRQ, or DMA capability anywhere in the mask. The
capsule can create a surface, learn how big it is, speak IPC, and print a marker, and that is all it can do.
Compromising it yields its mask and nothing more.

## What it proves

The self-test asserts that four kinds of input, plus the surface and focus machinery underneath them, all
reach a focused client. Each is latched exactly once and reported on first occurrence:

| Stage | Marker | Latched by | Source |
|---|---|---|---|
| Surface composited | `surface composited` | first `paint` call | [`src/proof/app.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L47) |
| Surface reachable | `surface ready` | first event of any kind | [`src/proof/markers.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L33) |
| Key delivery | `key down code=<n>` | first `KeyDown` | [`src/proof/markers.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L40) |
| Pointer delivery | `pointer motion x=<x> y=<y>` | first `PointerRel`/`PointerAbs` | [`src/proof/markers.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L51) |
| Click delivery | `click dispatch local=<x>,<y>` | first `ButtonDown` | [`src/proof/markers.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L58) |
| Focus routing | `focus routed` | a key that arrives after a click | [`src/proof/markers.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L45) |

Every marker is prefixed `[INPUT-PROOF] ` on the debug surface ([`src/proof/emit.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L19)). The verdict is
positive only: when all six latches are set, the capsule emits `PASS` once and never again
([`src/proof/markers.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L65), [`src/proof/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L33)). There is no `FAIL` marker in the capsule itself. A
failure is the absence of `PASS` within the harness window, since a stage that never occurs never sets its
latch and `complete()` stays false. The [debugging](/docs/userland/input-proof/debugging/) page reads each marker as a checkpoint and
explains how to tell which stage stalled.

## Code pillars

The source under `userland/capsule_input_proof/src/` is one thin `main` plus a `proof/` module of
single-purpose files. Control flows one way: an event enters the router `on_input`, sets latches, and the
latch set is checked for completion; `paint` contributes the one latch that input alone cannot.

```
  event in  ->  markers  ->  state (Latches)  ->  emit
  on_input      latch and     the six flags      [INPUT-PROOF]
                report        and complete()      serial line
```

| File | Role | Source |
|---|---|---|
| `main.rs` | `_start` entry; hands `InputProof::new` to the app skeleton `run` | [`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27) |
| [`proof/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/proof/app.rs) | the `App` adapter: manifest, `on_event`, and the `paint` that latches compositing | [`src/proof/app.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L36) |
| [`proof/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/proof/manifest.rs) | window geometry and the input kind mask it subscribes to | [`src/proof/manifest.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/manifest.rs#L29) |
| [`proof/markers.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/proof/markers.rs) | the event router that latches each stage and emits its line | [`src/proof/markers.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L22) |
| [`proof/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/proof/state.rs) | the `Latches` record and the `complete()` predicate behind `PASS` | [`src/proof/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L17) |
| [`proof/emit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/proof/emit.rs) | the fixed-capacity line builder and the `mk_debug` call | [`src/proof/emit.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L22) |

The [markers page](/docs/userland/input-proof/markers/) walks each latch and its trigger condition in detail.

## Lifecycle

The capsule is spawned through [verified spawn](/docs/security/capsules-and-trust/): its embedded ELF, id
cert, manifest, and attestation trailer are checked, its requested capabilities are held against its
manifest ceiling, and only then is its ELF mapped ([`src/userspace/capsule_input_proof/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/spawn.rs#L37)). It is
compiled into the desktop fleet only under the `nonos-capsule-input-proof` feature; the fleet spawn plan
calls `spawn_input_proof`, which is the real spawn under that feature and an empty stub without it
([`src/userspace/init/spawn_plan/apps.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L29), `apps.rs:39`). On a successful spawn the kernel logs
`[APP-INPUT-PROOF] capsule spawned` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/userspace/init/spawn_plan/apps.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L33)).

From there the app skeleton owns the runtime. Its `run` loop initializes the heap, resolves its peers,
waits for the first delivery, builds the `InputProof`, opens the window from the manifest, subscribes to the
input router with the manifest mask, and primes the first frame ([`userland/app_skeleton/src/runner/entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L31),
[`runner/boot.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/runner/boot.rs#L44)). That priming paint is what emits `surface composited`. Each delivered event then flows
into `on_event`, which runs the marker router and returns `EventOutcome::Idle` so the loop does not repaint
on input ([`src/proof/app.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L41)). The verdict is reported the moment the sixth latch closes; nothing about
the outcome is persisted, and the markers live only on the ephemeral debug surface.

## Source map

Everything here is drawn from `userland/capsule_input_proof/` (the capsule source, its `Capsule.mk`, and its
`Cargo.toml`), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn mirror under
`src/userspace/capsule_input_proof/`, the fleet spawn plan under `src/userspace/init/`, and the app skeleton
under `userland/app_skeleton/`. Every reference above is verified against those trees.
