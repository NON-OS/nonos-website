---
title: "Writing an App"
description: "This is the end-to-end guide to building a NØNOS application: the App trait a GUI capsule implements, the runtime that drives it, and the pipeline that turns your source into a ..."
weight: 3
---
This is the end-to-end guide to building a NØNOS application: the `App` trait a GUI capsule implements,
the runtime that drives it, and the pipeline that turns your source into a signed capsule the system
spawns. The [terminal](/docs/userland/terminal/) is the reference implementation to read alongside this. The
framework is `userland/app_skeleton/`.

## The App trait

A GUI application implements one trait ([`userland/app_skeleton/src/app/behavior.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/app/behavior.rs#L21)):

```rust
  pub trait App {
      fn manifest(&self) -> AppManifest;               // window title, size, input mask
      fn on_event(&mut self, event: InputEvent) -> EventOutcome;   // handle input
      fn paint(&mut self, fb: &mut PaintBuffer);        // draw the window
      fn on_tick(&mut self) -> bool { false }           // optional periodic work
      fn tick_interval_ms(&self) -> i64 { ... }         // how often to tick
  }
```

That is the whole surface. You describe your window, react to input, and draw; everything else is the
runtime's job. `on_event` returns an `EventOutcome` telling the runtime what to do next, `Idle`,
`Repaint`, `Close`, `Minimize`, or `Maximize`, and `on_tick` lets an app that animates or polls do
periodic work without an input event, returning whether it needs a repaint.

## The manifest

`AppManifest` ([`app/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/app/manifest.rs)) declares the window the app wants:

```
  AppManifest {
      title, window_id,
      kind,                 // WindowKind: Normal, Dialog, Tooltip, or Popup
      initial_x, initial_y, width, height,
      input_kind_mask,      // which input kinds (keyboard, pointer, ...) to receive
  }
```

The `input_kind_mask` is the capability-shaped part of the window: an app subscribes only to the input
kinds it declares, so a display-only window need not receive keystrokes. The `kind` tells the window
manager how to treat it, a normal window versus a dialog, tooltip, or popup.

## The runtime

`run` (`userland/app_skeleton/src/runner/`) is the entry the capsule hands its constructor to, and it
runs the whole application loop so the app does not have to:

```
  run(App::new):
      register the app's surface with the compositor (from the manifest size)
      subscribe to input per the input_kind_mask
      loop:
          drain IPC: window-manager events (move/resize/focus/close buttons) and input events
          for each input event: app.on_event(event) -> act on the EventOutcome
          on tick interval: app.on_tick()
          if anything requested a repaint: app.paint(buffer); present the surface
```

The runtime owns the [surface](/docs/subsystems/graphics/surfaces/) registration and presentation, the
[input](/docs/subsystems/input/) subscription and delivery, and the window chrome (it draws the
title bar and the close, minimize, and maximize buttons and turns clicks on them into the corresponding
`EventOutcome`). Your `paint` draws the window's content into a `PaintBuffer`; the runtime composites
the frame around it and presents it. So a minimal app is a `manifest`, an `on_event`, and a `paint`,
plus a `_start` that calls `run`:

```rust
  #[no_mangle]
  pub unsafe extern "C" fn _start() -> ! {
      run(MyApp::new)
  }
```

## From source to a running capsule

An app is a capsule, so it goes through the same verified pipeline as everything else. The stages, from
your crate to a spawned window:

```
  1. write    a no_std (or std-PAL) crate implementing App, entry _start -> run(...)
  2. build    cargo build for the capsule target (x86_64-nonos-user, or x86_64-nonos with the std PAL)
  3. sign     produce the capsule's NØNOS-ID certificate and manifest (the signing pipeline)
  4. embed    the kernel mirror (src/userspace/capsule_*) include_bytes the ELF, cert, and manifest
  5. spawn    init spawns it through verified spawn, which checks the signatures and capabilities
```

Steps 1 and 2 are your code and the [build toolchain](/docs/build/toolchain/); a `no_std` capsule builds
`core` + `alloc` against the [nonos_std crate](/docs/userland/nonos-std/) or the raw [SDK](/docs/userland/sdk/), and an unmodified
std crate builds through the [std PAL](/docs/userland/std-pal/). Step 3 is the capsule signing pipeline (the
[build](/docs/build/) pages), which produces the certificate and manifest the trust chain checks.
Steps 4 and 5 are the kernel mirror and init: the [lifecycle](/docs/userland/lifecycle/) page covers the embed-and-spawn
side, and the [verified spawn](/docs/security/capsules-and-trust/) gate is what guarantees only a
correctly signed capsule with in-policy capabilities runs. The capability set your app receives, the
input it subscribes to, the network or filesystem it can reach, is exactly what its manifest declared and
the trust anchor allowed, nothing more.

## Source

```
  userland/app_skeleton/src/app/behavior.rs    the App trait
  userland/app_skeleton/src/app/manifest.rs     AppManifest
  userland/app_skeleton/src/app/event_outcome.rs, window_kind.rs   EventOutcome, WindowKind
  userland/app_skeleton/src/runner/             run and the application loop + window chrome
  userland/capsule_terminal/                    a complete worked example
```
