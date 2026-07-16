---
title: "The GUI Proof Capsule"
description: "capsuleguiproof is a proof capsule, not an application."
weight: 400
---
`capsule_gui_proof` is a proof capsule, not an application. It is a small runtime self-test that asserts
one thing: the sovereign standard library, `nonos_std`, can drive a real GUI window. It stores its window
state in a `nonos_std` `HashMap`, builds a string with `nonos_std::format`, and paints both into a
surface through the shared [app-skeleton](/docs/userland/writing-an-app/). If it opens, draws its label, and counts
clicks, then a GUI-shaped Rust capsule links and runs against `nonos_std`, not just the CLI-shaped
capsules that came first. There is no game and no service behind the window; the window is the assertion.

Its whole implementation is two files under `userland/capsule_gui_proof/src/`: `main.rs`, the entry point
that hands the app to the skeleton runner, and `app.rs`, the `App` the skeleton drives. This page is the
hub; a single detail page covers exactly what the self-test exercises and checks, beside the file it
mirrors.

## Identity

This capsule is currently parked. It ships no `Capsule.mk`, so it declares no service endpoint and no
capability mask, and there is no kernel spawn mirror for it. Its own `README.md` states the contract
plainly: the capsule is parked "unless a `Capsule.mk` declares a service endpoint and
`CAPSULE_REQUIRED_CAPS`" and "must not own hardware; GUI authority must flow through Mk graphics and IPC
surfaces only" (`userland/capsule_gui_proof/README.md:3`). What identity it does have is the app manifest
it declares in code and the binary it builds.

| Field | Value | Source |
|---|---|---|
| Binary name | `gui_proof` | [`userland/capsule_gui_proof/Cargo.toml:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_gui_proof/Cargo.toml#L15), `Cargo.toml:16` |
| Crate name | `nonos_capsule_gui_proof` | `Cargo.toml:8` |
| License | `AGPL-3.0` | `Cargo.toml:11` |
| Window title | `std GUI proof` | [`src/app.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L39) |
| Window id | `0x53544447` | [`src/app.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L40) |
| Window kind | `Normal` | [`src/app.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L41) |
| Initial rect | `160,140 360x200` | [`src/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L42), `app.rs:43`, `app.rs:44`, `app.rs:45` |
| Input mask | `0x21` (KeyDown, ButtonDown) | [`src/app.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L46) |
| Capsule.mk | none (parked) | `userland/capsule_gui_proof/README.md:3` |
| Capability mask | none declared (parked) | `userland/capsule_gui_proof/README.md:3` |
| Kernel mirror | none | verified absent under `src/userspace/` |

Because there is no `Capsule.mk`, there is no capability mask to decompose. For comparison, a normal GUI
capsule such as [snake](/docs/userland/snake/) declares `0x1819`, five bits checked against
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs): CoreExec `0x0001` (`types.rs:56`), IPC `0x0008` (`types.rs:59`), Memory
`0x0010` (`types.rs:60`), GraphicsDisplayQuery `0x0800` (`types.rs:67`), and GraphicsSurfaceCreate
`0x1000` (`types.rs:68`). That is the envelope this capsule would need to be spawned as a window, and no
more: its own README forbids it from owning hardware, so a live `Capsule.mk` would carry those graphics
and IPC bits and nothing from the driver, MMIO, IRQ, DMA, network, or filesystem range. Until that
manifest exists, the mask is honestly not set, and the capsule is not in any build.

The input mask `0x21` is the two bits the app subscribes to: bit 0 KeyDown and bit 5 ButtonDown
([`src/app.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L46), matched against `InputKind` in [`userland/app_skeleton/src/input/kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/kind.rs#L20),
`kind.rs:25`). The skeleton widens that to also deliver KeyUp, the pointer, wheel, button-up, and touch
before it subscribes the window ([`userland/app_skeleton/src/setup/input_mask.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/input_mask.rs#L27)).

## What the proof exercises

The self-test is the `GuiProof` type in [`src/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs), a two-field struct wrapped by the `App` trait. The
work is deliberately minimal so that a pass means the plumbing, not the logic, is what was proven.

```
  new()          ->   on_event()        ->   paint()
  seed the            count a click,         draw the label and
  HashMap label       ask for a repaint      the live click count
```

| Pillar | Mirrors | What it does |
|---|---|---|
| State | [`src/app.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L23), `app.rs:28` | A `nonos_std::collections::HashMap<u32, &str>` seeded with one label and a `u32` click counter. |
| Event | [`src/app.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L50) | Button-down increments the counter and asks for a repaint; Escape closes; everything else is idle. |
| Paint | [`src/app.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L61) | Clears the surface, fills a header bar, draws the HashMap label and a `format!`-built count line. |

The [self-test page](/docs/userland/gui-proof/self-test/) walks each of these in turn and states exactly which `nonos_std`
surface each one puts under test.

## Lifecycle and how it reports its result

This capsule has no pass/fail exit code and prints no proof marker of its own. It reports the way a GUI
proof can: by drawing. The assertion is observational. If the window titled `std GUI proof` opens and
shows the seeded label and a click count that rises as you click, then `nonos_std` drove a real GUI. If
`nonos_std` collections or formatting had failed to link or run, the capsule would not build or would not
paint, and there would be no window to see.

The skeleton owns the runtime. `_start` calls `run(app::GuiProof::new)` ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)), which
initializes the heap, resolves the desktop peers (`compositor`, `wm`, `input_router`, `toolkit`) by name,
and enters its loop ([`userland/app_skeleton/src/runner/entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L31),
[`userland/app_skeleton/src/discover/require.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/require.rs#L24)). On each delivery it builds a fresh `GuiProof`, opens
the window from the manifest, primes the first frame, and runs the event-and-tick loop
([`userland/app_skeleton/src/runner/boot.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/boot.rs#L39)). The app declares no tick, so it repaints only when
`on_event` returns `Repaint`, which is on every click. Escape returns `Close`, and the skeleton tears the
window down. The [debugging](/docs/userland/gui-proof/debugging/) page covers what to check when the window does not appear.

Because there is no `Capsule.mk` and the capsule is in no workspace member, `make` does not build or sign
it today. Wiring it into the fleet is a `Capsule.mk` and a kernel mirror away, and
[contributing](/docs/userland/gui-proof/contributing/) describes what that would take.

## Source map

Everything here is drawn from `userland/capsule_gui_proof/` (the capsule source, its `README.md`, and its
`Cargo.toml`), the app skeleton under `userland/app_skeleton/`, and [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the
capability bits used for the comparison mask). The absence of a `Capsule.mk` and of a kernel spawn mirror
under `src/userspace/` is itself verified. Every reference above is verified against those trees.
