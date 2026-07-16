---
title: "Contributing to the GUI Proof Capsule"
description: "This capsule is a proof, so the bar for a change is different from an application."
weight: 5
---
This capsule is a proof, so the bar for a change is different from an application. The question is not
"does the feature work" but "does the self-test still assert one clear guarantee and stay honest about
it." Keep it small. If a change makes the capsule look like a general GUI app rather than a `nonos_std`
GUI proof, it belongs in a new capsule, not here.

## Where to work

The whole capsule is two files under `userland/capsule_gui_proof/src/`:

- `main.rs` is the entry point. `_start` calls `run(app::GuiProof::new)` and nothing else
  ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). You should rarely touch this.
- `app.rs` is the self-test: the `GuiProof` struct, its `new`, and the `App` impl with `manifest`,
  `on_event`, and `paint` ([`src/app.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L23), `app.rs:29`, `app.rs:36`).

Everything the window can do, open, subscribe to input, paint, close, comes from the shared
[app-skeleton](/docs/userland/writing-an-app/) under `userland/app_skeleton/`. Read that page before changing how
the capsule reaches the compositor or the input router; the capsule itself only implements the `App`
trait.

## Common changes and where they go

- To change what the proof asserts about `nonos_std`, edit the state and paint together in `app.rs`. If
  you want to prove another `nonos_std` surface (for example a `Vec` or `BTreeMap`), seed it in `new` and
  read it back in `paint` so the result is visible. The rule from the [self-test page](/docs/userland/gui-proof/self-test/)
  holds: the assertion has to show up in a drawn frame, because a drawn frame is how this proof reports.
- To change the window, edit the `AppManifest` returned by `manifest` ([`src/app.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L37)): title, initial
  rect, and the `input_kind_mask`. If you add an input kind, add its bit to the mask (bit 0 KeyDown, bit 5
  ButtonDown today, [`src/app.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L46)) and handle it in `on_event`, or it will be delivered and ignored.
- Do not add a filesystem, network, or hardware touch. The capsule's own contract forbids owning hardware
  and requires GUI authority to flow through Mk graphics and IPC only
  (`userland/capsule_gui_proof/README.md:3`). A change that reaches outside the graphics and IPC surfaces
  is out of scope for this capsule.

## Taking it out of the parked state

The capsule ships no `Capsule.mk` and is in no workspace, so `make` does not build or sign it today, and
there is no kernel spawn mirror for it. To make it a live, spawnable window you would add:

- a `Capsule.mk` next to the crate declaring the slug, service and reply endpoints, cargo feature,
  namespace, kernel mirror, and `CAPSULE_REQUIRED_CAPS`. Model it on `userland/capsule_snake/Capsule.mk`.
  The mask should be the graphics-and-IPC envelope described on the [hub](/docs/userland/gui-proof/): CoreExec, IPC,
  Memory, GraphicsDisplayQuery, GraphicsSurfaceCreate, and nothing from the driver, MMIO, IRQ, DMA,
  network, or filesystem range, per the capability bits in [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs).
- a kernel spawn mirror under `src/userspace/`, and an entry in the fleet spawn plan behind the new cargo
  feature, the same shape snake uses ([`src/userspace/init/spawn_plan/apps.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs)).

That is a real piece of work and changes the capsule from a compile-and-run proof into a spawned one. Do
not do it as a side effect of an unrelated change.

## Build and code standards

Build the crate directly with cargo against the userland target; it is not part of the default fleet
build. It is `#![no_std]` and `#![no_main]` with `panic = "abort"` ([`src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L17), [`src/main.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L18),
`Cargo.toml`), so no panics, no `std`, and only `core`, `alloc`, and the `nonos_std` and skeleton crates
it already depends on (`Cargo.toml`). Run `cargo fmt` and keep `cargo clippy` clean. Keep the AGPL header
at the top of every file ([`src/app.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L1)).

## Source map

Everything here is drawn from `userland/capsule_gui_proof/` (the two source files, its `README.md`, and
its `Cargo.toml`), the app skeleton under `userland/app_skeleton/`, the snake capsule under
`userland/capsule_snake/` used as the live-capsule model, and [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs). Every reference
above is verified against those trees.
