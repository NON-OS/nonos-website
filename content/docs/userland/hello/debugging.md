---
title: "Debugging capsule_hello"
description: "This page lists the one log marker the hello capsule emits and the concrete failure modes with where to look for each."
weight: 3
---
This page lists the one log marker the hello capsule emits and the concrete failure modes with where to look
for each. Hello is the smallest complete capsule in the tree, so most debugging is narrowing a symptom to
the right one of its four tiny files rather than reading a trace. For what it does and how it is put together
see the [overview](/docs/userland/hello/) and the [walkthrough](/docs/userland/hello/walkthrough/); for the general App trait and runtime,
see [writing-an-app.md](/docs/userland/writing-an-app/).

## Log marker

The first thing to confirm is that the capsule spawned. On a successful boot the kernel logs `[APP-HELLO]
capsule spawned`: the `Ok` arm of the capsule boot path calls `boot_log::ok(prefix, "capsule spawned")`, and
`ok` prints the tag in brackets followed by the message ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). The `[APP-HELLO]` prefix is the one the spawn plan passes for this capsule
([`src/userspace/init/spawn_plan/apps.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L53)). If that line is absent the capsule never started, and the
`Err` arm logged an `[ERROR]` line built from the spawn error instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability failure.

Hello is compiled into the fleet only under the `nonos-capsule-hello` feature. On a build without that
feature `spawn_hello` is the empty stub and no line appears at all, because the plan calls the stub
([`src/userspace/init/spawn_plan/apps.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L55)). There is no serial self-test build and no debug marker beyond
the spawn line.

## What a successful run looks like

A working hello capsule opens one 360x180 window titled `Hello NØNOS`
([`userland/capsule_hello/src/hello/manifest.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/manifest.rs#L24), `manifest.rs:29`). Inside it is a constant frame, drawn
by the five calls in `paint`: a cleared dark background, a teal accent bar four pixels tall across the top,
`hello, NØNOS` at double scale, then `a signed, attested capsule` and `built from QUICKSTART.md`, and a
dimmed `press Esc to close` at the bottom ([`userland/capsule_hello/src/hello/paint.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/paint.rs#L24)). The frame never
changes: `paint` is a pure function of nothing but its own colour constants, so nothing you do to the window
alters what it shows except closing it. Pressing Escape closes the window and exits the process
([`userland/capsule_hello/src/hello/event.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/event.rs#L20)). That is the entire visible behaviour, and any deviation
from it is one of the modes below.

## Failure modes

### The window never opens

If the boot log has no `[APP-HELLO] capsule spawned` line, the surface is not missing, the capsule is: check
the feature and the spawn error as above ([`src/userspace/init/spawn_plan/apps.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L55),
[`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). If the spawn line is present but no window appears, the app
reached the runtime but the surface or window request did not land, which is the skeleton's job and not the
app's: hello only hands over its manifest and never touches the compositor directly
([`userland/capsule_hello/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/main.rs#L28)).

### The window opens but is blank or wrong

`paint` is a pure projection into the surface, so a blank or stale frame with the window present points at
the paint path under the skeleton, not at app logic: hello makes exactly five draw calls and has no
branching or layout math to get wrong ([`userland/capsule_hello/src/hello/paint.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/paint.rs#L24)). If only the accent
bar is off, note it is drawn a fixed 360 wide to match the window, so a changed window width without a
matching `fill_rect` edit is the usual cause (`paint.rs:26`).

### Escape does not close the window

The capsule acts only on a key-down of `KEY_ESC` and returns `Idle` for every other event
([`userland/capsule_hello/src/hello/event.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/event.rs#L20)). If Escape does nothing, the suspect is the input path into
the app, since the manifest subscribes to key-down only through `INPUT_KEY_DOWN_BIT` and the skeleton
resolves the compositor, wm, and input router by name at startup, none of which the app controls
([`userland/capsule_hello/src/hello/manifest.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/manifest.rs#L31)). A window that paints correctly but ignores Escape is an
input-delivery problem, not an event-handler bug, because the handler is a single unconditional rule.

### Any other key seems dead

That is correct behaviour, not a fault. The manifest subscribes to key-down and nothing else, and `on_event`
closes only on Escape, returning `Idle` for all other keys, so every non-Escape key is a deliberate no-op
([`userland/capsule_hello/src/hello/event.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/event.rs#L23), `manifest.rs:31`).

## Source map

```
  src/userspace/init/capsule_boot/run.rs      [APP-HELLO] capsule spawned / error path
  src/sys/boot_log/output.rs                  the ok() tag-and-message format
  src/userspace/init/spawn_plan/apps.rs       the [APP-HELLO] prefix and the feature-gated spawn stub
  userland/capsule_hello/src/main.rs          _start hands Hello::new to the skeleton run()
  userland/capsule_hello/src/hello/manifest.rs  the 360x180 Hello NØNOS window and key-down mask
  userland/capsule_hello/src/hello/paint.rs   the cleared frame, accent bar, and four text lines
  userland/capsule_hello/src/hello/event.rs   key-down Escape closes, everything else is idle
```

Every reference above is verified against those trees.
