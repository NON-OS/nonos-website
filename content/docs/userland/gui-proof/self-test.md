---
title: "What the Self-Test Exercises"
description: "This page reads beside userland/capsuleguiproof/src/app.rs, the one file that holds the whole self-test."
weight: 3
---
This page reads beside [`userland/capsule_gui_proof/src/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_gui_proof/src/app.rs), the one file that holds the whole
self-test. `main.rs` only hands the app to the skeleton ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)); the assertion lives here. The
capsule is a proof, not an application, so the goal is not a feature but evidence: each of the three
pieces below puts one `nonos_std` surface under test, and a running window is the pass.

## State: the HashMap and the counter

`GuiProof` has two fields: a `HashMap<u32, &'static str>` and a `u32` click counter ([`src/app.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L23),
`app.rs:24`). The map is the whole point. `new` builds it with `HashMap::default()` and inserts one entry,
key `0` mapping to the label `"nonos_std drives this GUI"` ([`src/app.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L29), `app.rs:31`). That
`HashMap` comes from `nonos_std::collections` ([`src/app.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L20)), so constructing it, seeding it, and later
reading it back is the test that the sovereign standard library's hash map works inside a GUI capsule and
not only in a CLI one.

The counter is an ordinary `u32` starting at zero ([`src/app.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L32)). It exists to give the paint step a
value that visibly changes, so a viewer can tell live frames from a single static one.

## Event: counting a click, closing on Escape

`on_event` is a three-arm match on the incoming `InputKind` ([`src/app.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L50)). A `ButtonDown` increments
the click counter and returns `EventOutcome::Repaint`, which tells the skeleton to call `paint` again
([`src/app.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L52)). A `KeyDown` whose code is `KEY_ESC` returns `EventOutcome::Close`, which tears the
window down ([`src/app.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L56); `KEY_ESC` is `0x1B`, [`userland/app_skeleton/src/input/keys.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/keys.rs#L20)).
Everything else returns `EventOutcome::Idle` and changes nothing ([`src/app.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L57)).

These are the only two input kinds the manifest subscribes to, bit 0 and bit 5 of the input mask
([`src/app.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L46)). The `InputKind` values matched here, `ButtonDown = 5` and `KeyDown = 0`, are the same
enum the router delivers ([`userland/app_skeleton/src/input/kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/kind.rs#L20), `kind.rs:25`). Handling a real
delivered `InputEvent` is a second, quieter part of the proof: input reaches a `nonos_std`-backed GUI
capsule and mutates its owned state.

## Paint: drawing the HashMap read-back and the formatted count

`paint` is where the assertion becomes visible ([`src/app.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L61)). It runs four draw calls on the
skeleton's `PaintBuffer`:

- `fb.clear(0xFF101820)` fills the surface with the dark background ([`src/app.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L62)).
- `fb.fill_rect(20, 20, 320, 60, 0xFF2A7FFF)` draws the blue header bar ([`src/app.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L63);
  bounds-clamped in [`userland/app_skeleton/src/paint/fill_rect.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/paint/fill_rect.rs#L20)).
- `fb.text(34, 44, label.as_bytes(), 0xFFFFFFFF)` draws the label read back out of the HashMap
  (`self.labels.get(&0)`), white on the bar ([`src/app.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L64), `app.rs:65`). Reading the value back through
  `HashMap::get` is the map half of the proof made visible.
- `fb.text(34, 120, line.as_bytes(), 0xFFCFE8FF)` draws the click line, where `line` was built with
  `nonos_std::format!("clicks: {}", self.clicks)` ([`src/app.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L66), `app.rs:67`). Producing that string is
  the `format` half of the proof.

Both text calls go through the toolkit font renderer ([`userland/app_skeleton/src/paint/text.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/paint/text.rs#L22)), and
the buffer is the surface the skeleton shares with the compositor. So a single painted frame demonstrates
three `nonos_std` facts at once: a hash map was seeded and read, a string was formatted, and the result
reached the screen through the capability-checked graphics path rather than any hardware the capsule owns.

## Why this is enough, and what it does not claim

The self-test is honest about its scope. It does not assert correctness of any application logic, because
there is none; the click counter has no meaning beyond "frames are live." It does not exercise the
network, the filesystem, or a service protocol, and it defines no opcodes. It asserts exactly one
guarantee, that `nonos_std` collections and formatting drive a real GUI window, and it reports that
guarantee by being visible rather than by an exit code. A blank or absent window is the failure signal;
the [debugging](/docs/userland/gui-proof/debugging/) page covers how to read one.

## Source map

Everything here is drawn from [`userland/capsule_gui_proof/src/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_gui_proof/src/app.rs) and [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs), and from the app
skeleton under `userland/app_skeleton/` that provides the `App` trait, the `PaintBuffer`, and the input
enums. Every reference above is verified against those trees.
