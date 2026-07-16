---
title: "The Markers and the Verdict"
description: "This page mirrors userland/capsuleinputproof/src/proof/."
weight: 5
---
This page mirrors `userland/capsule_input_proof/src/proof/`. It documents each latch the self-test sets,
the exact condition that sets it, the line it emits, and how the six latches combine into the single `PASS`
verdict. The overview and the identity table live on the [README](/docs/userland/input-proof/); this page is the mechanics.

## The latch record

All state is a flat record of booleans, `Latches` ([`src/proof/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L17)), built empty by
`Latches::new()` ([`src/proof/state.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L29)). There are seven fields: `ready`, `composited`, `key`, `motion`,
`click`, `focus_routed`, and `passed`. Six of them are stages to prove; `passed` is the guard that keeps the
verdict from repeating.

Every stage marker is emitted at most once. The pattern in the router is uniform: check the latch, and on
the first time it is false, set it and emit the line. A repeated event of the same kind finds the latch
already set and does nothing. This keeps the serial log to one line per proven stage regardless of how many
events the harness feeds.

## The event router

Delivered events reach `on_input` ([`src/proof/markers.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L22)), which runs on every event before dispatch:

1. `announce_ready` sets `ready` on the first event of any kind and emits `surface ready`
   ([`src/proof/markers.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L33)). This proves the router delivers to the focused surface at all.
2. The event kind is matched. `KeyDown` runs `on_key`, `PointerRel` and `PointerAbs` both run `on_motion`,
   `ButtonDown` runs `on_click`, and every other kind is ignored ([`src/proof/markers.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L24)). The kinds are
   the app skeleton's `InputKind` enum ([`userland/app_skeleton/src/input/kind.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/kind.rs#L19)).
3. `finish` checks for completion and may emit the verdict ([`src/proof/markers.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L30)).

## The six stages

| Latch | Set when | Line emitted | Source |
|---|---|---|---|
| `composited` | the first `paint` runs | `surface composited` | [`src/proof/app.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L47) |
| `ready` | the first event of any kind arrives | `surface ready` | [`src/proof/markers.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L34) |
| `key` | the first `KeyDown` arrives | `key down code=<code>` | [`src/proof/markers.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L41) |
| `motion` | the first pointer motion arrives | `pointer motion x=<x> y=<y>` | [`src/proof/markers.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L52) |
| `click` | the first `ButtonDown` arrives | `click dispatch local=<x>,<y>` | [`src/proof/markers.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L59) |
| `focus_routed` | a `KeyDown` arrives after a click has been seen | `focus routed` | [`src/proof/markers.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L45) |

Two stages are worth reading closely.

The `composited` latch is the only one that input cannot set. It is flipped inside `paint`
([`src/proof/app.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L47)), which the app skeleton calls when it primes the first frame during boot
([`userland/app_skeleton/src/runner/boot.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/boot.rs#L47)). This proves the compositor accepted the surface and drew
it, independent of any device event. The frame itself is just a clear to a dark background
([`src/proof/app.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L24), [`src/proof/app.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/app.rs#L51)); the capsule draws no content.

The `focus_routed` latch is a coincidence gate, not a new event type. It is set inside `on_key`, but only
when a click has already been latched ([`src/proof/markers.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L45)). A key that arrives after a click proves
the router kept focus on this surface across a pointer button event, which is the routing decision the
[input path](/docs/subsystems/input/path/) makes for focus. If keys arrive but no click has yet, the gate
stays closed until the ordering holds.

## The line builder

Every marker is built by `Line` ([`src/proof/emit.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L22)), a fixed 96-byte buffer that always opens with the
tag `[INPUT-PROOF] ` ([`src/proof/emit.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L19), [`src/proof/emit.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L28)). `push` appends bytes and silently
stops at capacity ([`src/proof/emit.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L34)), and `num` formats a signed integer in place for the codes and
coordinates ([`src/proof/emit.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L44)). `emit` hands the buffer to `mk_debug` ([`src/proof/emit.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/emit.rs#L63)), which
is the only syscall the proof logic makes and the reason the capsule carries the `Debug` capability. There
is no allocation and no formatting machinery, so a marker cannot fail for lack of memory.

## The verdict

`finish` runs after every event ([`src/proof/markers.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/markers.rs#L65)). It emits `PASS` once, guarded by the `passed`
latch, when `complete()` returns true. `complete()` is the conjunction of the six stage latches:
`ready && composited && key && motion && click && focus_routed` ([`src/proof/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proof/state.rs#L33)). All six must be
set, so the order that finally satisfies it is a click, then pointer motion, then a key after the click, on
a composited and reachable surface.

There is no `FAIL` line. The verdict is positive only. A stage that never happens never sets its latch,
`complete()` stays false, and `PASS` is never printed. The harness treats the absence of `PASS` within its
window as the failure, and the missing checkpoint marker tells it which stage stalled. The
[debugging](/docs/userland/input-proof/debugging/) page reads the marker sequence for exactly that purpose.

## Source map

Everything here is drawn from `userland/capsule_input_proof/src/proof/` (`app.rs`, `markers.rs`, `state.rs`,
and `emit.rs`) and the app skeleton input and runner modules under `userland/app_skeleton/src/`. Every
reference above is verified against those trees.
