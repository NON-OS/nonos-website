---
title: "Debugging the Input Proof"
description: "This capsule reports on the serial log, one line per proven stage, and a single PASS when all six stages close."
weight: 4
---
This capsule reports on the serial log, one line per proven stage, and a single `PASS` when all six stages
close. Debugging it is reading that sequence and finding the first marker that never arrived, because the
missing marker names the stage that stalled. The overview and the identity table live on the
[README](/docs/userland/input-proof/); the exact latch conditions are on the [markers page](/docs/userland/input-proof/markers/). This page is the
checklist for reading the log.

## What a pass looks like

A pass is the marker sequence on the debug surface, every line prefixed `[INPUT-PROOF] `
([`src/proof/emit.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L19)), ending in `PASS`. The lines are latched in the order the events happen, not a
fixed order, but a full run contains all seven of these exactly once each:

```
  [INPUT-PROOF] surface composited
  [INPUT-PROOF] surface ready
  [INPUT-PROOF] key down code=<n>
  [INPUT-PROOF] pointer motion x=<x> y=<y>
  [INPUT-PROOF] click dispatch local=<x>,<y>
  [INPUT-PROOF] focus routed
  [INPUT-PROOF] PASS
```

`surface composited` is latched by the first `paint` ([`src/proof/app.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L47)); the other five stage lines are
latched by the router as events arrive ([`src/proof/markers.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L33), `markers.rs:41`, `markers.rs:52`,
`markers.rs:59`, `markers.rs:45`). `PASS` is emitted once, when `complete()` returns true, and never again
because the `passed` latch guards it ([`src/proof/markers.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L65), [`src/proof/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L33)). Seeing `PASS`
means a real key, a real pointer motion, and a real click all reached a focused CPL=3 surface, and a key
arrived after the click to prove focus held.

## What a failure looks like

There is no `FAIL` line. The verdict is positive only (`markers.rs:65`). A failure is the absence of `PASS`
within the harness window, and the last marker that did print tells you which stage never closed its latch.
`complete()` is the conjunction of all six stage latches ([`src/proof/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L33)), so any one that never
sets holds `PASS` off forever. Read the log from the top and find the first expected line that is missing.

## Reading the markers as checkpoints

Each missing marker points at a different layer. The kernel boot marker comes first, before any of the
capsule's own lines.

| Missing line | What never happened | Where to look |
|---|---|---|
| `[APP-INPUT-PROOF] capsule spawned` | the capsule was not spawned at all | feature flag and spawn plan |
| `surface composited` | the first frame never painted | compositor and surface creation |
| `surface ready` | no event of any kind was delivered | input router to focused surface |
| `key down code=<n>` | no key reached the surface | keyboard driver, ring, and router |
| `pointer motion x=<x> y=<y>` | no pointer motion reached the surface | pointer driver and router |
| `click dispatch local=<x>,<y>` | no button-down reached the surface | button events and hit testing |
| `focus routed` | a key never arrived after a click | focus retention across the click |

### No boot marker: the capsule never spawned

Before the capsule prints anything, the kernel logs `[APP-INPUT-PROOF] capsule spawned` on a successful
spawn ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/userspace/init/spawn_plan/apps.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L33)). If that
line is absent, the capsule is not in the running fleet. The spawn is compiled in only under the
`nonos-capsule-input-proof` feature; without it, `spawn_input_proof` is an empty stub and nothing runs
([`src/userspace/init/spawn_plan/apps.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L29), `apps.rs:39`, `apps.rs:40`). The verified-spawn path also
checks the embedded ELF, id cert, manifest, and attestation trailer and holds the requested six
capabilities against the manifest ceiling before mapping anything
([`src/userspace/capsule_input_proof/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_proof/spawn.rs#L37), `spawn.rs:50`); a rejection there also leaves no boot
marker. If the feature is on and there is still no marker, the spawn was rejected, not skipped.

### No `surface composited`: the first frame never painted

This is the one latch input cannot set. It flips inside `paint` ([`src/proof/app.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L47)), which the skeleton
calls when it primes the first frame during boot ([`userland/app_skeleton/src/runner/boot.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/boot.rs#L47)). If this
line is missing, `paint` never ran, which means the window never opened. Before any window can open the
skeleton must init the heap and resolve the four desktop peers `compositor`, `wm`, `input_router`, and
`toolkit` by name ([`userland/app_skeleton/src/runner/entry.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L32), `entry.rs:36`,
[`userland/app_skeleton/src/discover/require.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/require.rs#L42)). Heap failure exits with code `1` and peer failure with
code `2`, both silently (`entry.rs:34`, `entry.rs:38`), so a capsule that got its boot marker but never
printed `surface composited` most likely exited here because the desktop stack was not up. If the window
opened but `open_window` or the priming paint failed, `boot` returns an error and the loop waits without
painting (`boot.rs:45`, `entry.rs:47`).

### No `surface ready`: nothing was delivered

`surface ready` is set by `announce_ready` on the very first event of any kind ([`src/proof/markers.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L33)).
If it never prints but `surface composited` did, the window is up and drawn but the input router is
delivering nothing to it. That is a delivery or focus problem, not a device problem, because it fires
regardless of what kind of event arrives. Confirm the window actually has focus.

### A stage marker missing: that device class did not reach the surface

If `surface ready` is present but a specific stage is not, that class of event never arrived. No
`key down` means keyboard events are not reaching the surface; no `pointer motion` means pointer motion is
not; no `click dispatch` means button-downs are not. The manifest subscribes to KeyDown, both pointer kinds,
and ButtonDown ([`src/proof/manifest.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/manifest.rs#L23), `manifest.rs:24`, `manifest.rs:25`, `manifest.rs:26`), so a
missing class points at that device path in the [input subsystem](/docs/subsystems/input/path/), driver
through ring through router, rather than at this capsule.

### No `focus routed`: the ordering never held

This latch is a coincidence gate, not a new event ([`src/proof/markers.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L45)). It sets inside `on_key`, but
only when a click has already been latched. If keys and clicks both arrive yet `focus routed` never prints,
the router did not keep focus on this surface across the click, or every key arrived before the first click.
Click the window, then press a key, and watch for the line. If `key down` and `click dispatch` are both
present but `focus routed` is not, the ordering, not the delivery, is what failed.

## Why a marker cannot fail for the wrong reason

Every line is built by `Line`, a fixed 96-byte buffer that opens with the tag and appends with a
bounds-checked `push` ([`src/proof/emit.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L22), `emit.rs:28`, `emit.rs:34`); numbers are formatted in place
by `num` (`emit.rs:44`). There is no allocation and no formatting machinery in the marker path, and `emit`
makes the single `mk_debug` call the capsule's `Debug` capability exists for (`emit.rs:63`). So a missing
marker means the stage did not happen, never that the marker itself ran out of memory or failed to format.
That is what makes the absent-line reading reliable.

## Source map

Everything here is drawn from `userland/capsule_input_proof/src/proof/` (`app.rs`, `markers.rs`, `state.rs`,
`manifest.rs`, and `emit.rs`), the kernel spawn mirror and boot marker under
`src/userspace/capsule_input_proof/` and `src/userspace/init/`, and the app skeleton runner and peer
discovery under `userland/app_skeleton/src/`. Every reference above is verified against those trees.
