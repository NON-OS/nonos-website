---
title: "Contributing to the Input Proof Capsule"
description: "This capsule is small on purpose. It is a self-test, not an application, so the bar for adding to it is whether the change proves something new about the input path, not whether..."
weight: 500
---
This capsule is small on purpose. It is a self-test, not an application, so the bar for adding to it is
whether the change proves something new about the input path, not whether it makes a nicer program. Before
editing, read the [README](/docs/userland/input-proof/) for what the capsule already asserts and [markers.md](/docs/userland/input-proof/markers/) for
how each latch is set. The general capsule-writing guide is [writing-an-app.md](/docs/userland/writing-an-app/); this
page covers only what is specific here.

## Where to work

The whole capsule is `userland/capsule_input_proof/`. The source is one entry file and a `proof/` module of
single-purpose files:

| You want to | Edit | Notes |
|---|---|---|
| add a new proven stage | [`src/proof/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs), [`src/proof/markers.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs) | add a latch, set it in the router, and add it to `complete()` |
| change what a marker reports | [`src/proof/markers.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs) | the `Line` builder chain in the relevant `on_*` handler |
| change which event kinds arrive | [`src/proof/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/manifest.rs) | the `INPUT_MASK` bits on the subscription |
| change the window size or title | [`src/proof/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/manifest.rs) | `WIDTH`, `HEIGHT`, `TITLE`, `WINDOW_ID` |
| change the marker prefix or buffer | [`src/proof/emit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs) | the `TAG` and `CAP` constants |

## Adding a stage

A new stage is three edits and one rule. Add a `bool` field to `Latches` ([`src/proof/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L17)), set it
once in the matching handler in `markers.rs` behind an `if !latch` guard and emit its line, and add the
field to the `complete()` conjunction ([`src/proof/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L33)). The rule: only add a field to `complete()`
if the harness can actually drive it, because `PASS` is the conjunction of every field and one that never
fires will suppress the verdict forever. If a stage is informational and not a gate, emit its marker but
leave it out of `complete()`.

## The input mask

The kinds the capsule receives are set by `INPUT_MASK` in the manifest ([`src/proof/manifest.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/manifest.rs#L27)), built
from `KEY_DOWN_BIT`, `POINTER_REL_BIT`, `POINTER_ABS_BIT`, and `BUTTON_DOWN_BIT`. The app skeleton
subscribes the window to exactly this mask on boot ([`userland/app_skeleton/src/runner/boot.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/boot.rs#L46),
[`userland/app_skeleton/src/clients/input_router/subscribe.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/input_router/subscribe.rs#L22)). If you prove a new kind, add its bit here
or the router will never deliver it, and add the matching arm to `on_input` ([`src/proof/markers.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L24)).

## Capabilities

The mask is `0x1919` and is declared in two places that must agree: `CAPSULE_REQUIRED_CAPS` in
`Capsule.mk:18` and the `requested_caps` list in the kernel mirror ([`src/userspace/capsule_input_proof/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/spawn.rs#L50)).
The `Debug` bit (`0x0100`) is what makes this capsule different from a production app; it exists so the
CPL=3 surface can call `mk_debug` to report the verdict, and it is confined to the end-to-end test profiles
(`Capsule.mk:2`, `Capsule.mk:5`). Do not add capabilities to make a proof easier. If a stage needs authority
the capsule does not hold, that authority belongs in another capsule that this one talks to over IPC, and
the proof should exercise that boundary rather than absorb the right.

## Build and sign

The capsule is built for the `x86_64-nonos-user` target ([`src/userspace/capsule_input_proof/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/spawn.rs#L35))
and embedded into the kernel under the `nonos-capsule-input-proof` feature
([`src/userspace/capsule_input_proof/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/embed.rs#L17)), which also pulls in the id cert, manifest, and
attestation trailer alongside the ELF (`embed.rs:24`, `embed.rs:28`, `embed.rs:32`). The signing and
embedding steps are the same as any capsule and are covered in [writing-an-app.md](/docs/userland/writing-an-app/);
this capsule adds nothing to that flow beyond the feature gate.

## Code standards

Keep it lean and allocation-free. The proof logic makes exactly one syscall, `mk_debug` through `Line::emit`
([`src/proof/emit.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L63)); do not introduce heap formatting or a second syscall path for a marker. Do not
panic; the release profile is `panic = "abort"` (`Cargo.toml:27`), so a panic is a crashed proof, not a
`FAIL`. Every public change should keep the one-way flow intact: event in, latch, emit, and the verdict as a
pure function of the latch set.

## Source map

Everything here is drawn from `userland/capsule_input_proof/` (the capsule source, its `Capsule.mk`, and its
`Cargo.toml`), the kernel spawn and embed mirror under `src/userspace/capsule_input_proof/`, and the app
skeleton under `userland/app_skeleton/`. Every reference above is verified against those trees.
