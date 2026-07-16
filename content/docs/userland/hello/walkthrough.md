---
title: "A walk through the hello capsule"
description: "This page reads the hello capsule one file at a time as a teaching example."
weight: 1
---
This page reads the hello capsule one file at a time as a teaching example. It is the shortest complete
capsule in the tree, so nothing here is elided: every source line has a place. Read it beside the
[overview](/docs/userland/hello/), and when you want to build your own from this shape, follow
the QUICKSTART.md guide in the repository root and the deeper [writing-an-app.md](/docs/userland/writing-an-app/).

## The entry point

[`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs) is the whole binary. It is `#![no_std]` and `#![no_main]`: there is no standard library and no
Rust-provided entry, so the capsule defines its own `_start` ([`userland/capsule_hello/src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/main.rs#L17),
`main.rs:27`). That entry does one thing: it calls the shared skeleton's `run`, handing it `Hello::new`
(`main.rs:28`). From that point the skeleton owns the process. It creates the surface, registers the window,
subscribes to input, and runs the paint loop, calling back into the app for the manifest, each event, and
each frame ([`userland/app_skeleton/src/runner/entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L31)). The app never touches IPC directly.

## The module

[`src/hello/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/mod.rs) is wiring only. It declares the four concern files and re-exports the one type the entry
point needs, `Hello` ([`userland/capsule_hello/src/hello/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/mod.rs#L17), `mod.rs:22`). This is the one-unit-per-file
convention: `mod.rs` holds no logic.

## The App impl

[`src/hello/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/app.rs) is the seam between the runtime and the app. `Hello` is a zero-field struct, and its
`App` implementation forwards each of the three trait methods to a free function in its own file: `manifest`
returns the window request, `on_event` handles a key, and `paint` draws the frame
([`userland/capsule_hello/src/hello/app.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/app.rs#L23), `app.rs:31`). Keeping the struct empty is deliberate; the
hello capsule has no per-instance state to carry.

## The manifest

[`src/hello/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/manifest.rs) is what the app asks the window manager for. The `AppManifest` gives the title
`Hello NØNOS`, a window id, a `Normal` window kind, an initial position of (360, 240), a size of 360x180,
and an input mask ([`userland/capsule_hello/src/hello/manifest.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/manifest.rs#L22)). The input mask is the single bit
`INPUT_KEY_DOWN_BIT` (`1 << 0`), so the capsule subscribes to key-down events and nothing else
(`manifest.rs:20`, `manifest.rs:31`). The window id is a fixed constant, `0x4845_4C4F`, the ASCII bytes of
`HELO` (`manifest.rs:19`).

## The frame

[`src/hello/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/paint.rs) is a pure projection: given a `PaintBuffer`, it draws the same frame every time. Four
named colours sit at the top as `0xAARRGGBB` constants: a dark background, a teal accent, a bright text, and
a dimmed grey ([`userland/capsule_hello/src/hello/paint.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/paint.rs#L19)). The `paint` function then makes five draw
calls in order: clear to the background, a 360x4 accent bar across the top, the greeting `hello, NØNOS` at
double scale, two lines of body text, and one dimmed hint (`paint.rs:24`). Each call is a method on the
skeleton's `PaintBuffer`: `clear`, `fill_rect`, `text_scaled`, and `text`
([`userland/app_skeleton/src/paint/clear.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/paint/clear.rs#L20), `fill_rect.rs:20`, `text_scaled.rs:22`, `text.rs:22`). There
is no layout math and no branching; that is what makes it the example.

## The event

[`src/hello/event.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/event.rs) is the app's entire input logic in one rule. `on_event` returns `EventOutcome::Close`
when the event is a key-down of `KEY_ESC`, and `EventOutcome::Idle` for everything else
([`userland/capsule_hello/src/hello/event.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/event.rs#L19)). The skeleton reads that outcome: `Close` tears the window
down and exits, `Idle` does nothing. Because the manifest only subscribed to key-down, this handler never
sees a key-up or a pointer move to begin with.

## Putting it together

Trace one keystroke to see how thin the app is. The skeleton delivers a key-down event to `on_event`
(`event.rs:19`). If it is Escape, the app returns `Close` and the runtime exits; otherwise the app returns
`Idle` and the loop waits for the next event. No key ever changes what `paint` draws, which is why the frame
is constant. That is the smallest shape a real graphical capsule can take, and every other GUI capsule in
`userland/` is this same shape with more state, more events, and a richer frame.

## Source map

```
  userland/capsule_hello/src/main.rs          _start -> run(Hello::new)
  userland/capsule_hello/src/hello/mod.rs     module wiring, re-exports Hello
  userland/capsule_hello/src/hello/app.rs     the App impl over the empty Hello struct
  userland/capsule_hello/src/hello/manifest.rs  the 360x180 window request and key-down mask
  userland/capsule_hello/src/hello/paint.rs   the colours and the five draw calls
  userland/capsule_hello/src/hello/event.rs   key-down Escape closes, else idle
  userland/app_skeleton/src/runner/entry.rs   the run() the entry point hands the app to
  userland/app_skeleton/src/paint/            clear, fill_rect, text, text_scaled
```

Every reference above is verified against those trees.
