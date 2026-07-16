---
title: "The Hello Capsule"
description: "The hello capsule is the tutorial reference for NØNOS userland."
weight: 400
---
The hello capsule is the tutorial reference for NØNOS userland. It is the simplest capsule that still does
everything a real one does: it opens its own window, paints a greeting, closes on a key, and reaches the
system only through capability-checked IPC. It is kept in the tree as the living reference for
the QUICKSTART.md guide in the repository root, so its five source files map one to one onto the steps that guide
takes you through, from an empty folder to a signed, attested capsule the kernel spawns. Read this page to
see what it is; read [walkthrough.md](/docs/userland/hello/walkthrough/) to read the source file by file.

## What it does

On spawn the capsule hands its `Hello` app to the shared skeleton's `run`, and the runtime owns the
surface, window, input subscription, and paint loop ([`userland/capsule_hello/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/main.rs#L28)). The app
itself is three tiny pieces: a manifest that requests a 360x180 window, a paint routine that draws the
greeting, and an event handler that closes on Escape. It holds no state between frames; the paint is a pure
function of nothing but its own constants ([`userland/capsule_hello/src/hello/paint.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/paint.rs#L24)).

The drawn frame is a cleared background, an accent bar, and four lines of text: `hello, NØNOS` at double
scale, then `a signed, attested capsule`, `built from QUICKSTART.md`, and `press Esc to close`
([`userland/capsule_hello/src/hello/paint.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/paint.rs#L26)). The window title is `Hello NØNOS`
([`userland/capsule_hello/src/hello/manifest.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/hello/manifest.rs#L23)).

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `hello` | `userland/capsule_hello/Capsule.mk:1` |
| Service handle | `app.hello` | `Capsule.mk:2` |
| Service endpoint | `service:4810:app.hello` | `Capsule.mk:8` |
| Reply endpoint | `reply:4811:endpoint.app.hello.reply` | `Capsule.mk:9` |
| Capability mask | `0x1819` | `Capsule.mk:11` |

The mask decomposes into five bits, each checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | send and receive on its endpoints |
| Memory | `0x0010` | map its own heap and stack |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into |

The five values sum to `0x1819` (`1 + 8 + 16 + 2048 + 4096`), and the bit values are the ones returned by
`Capability::bit` ([`src/capabilities/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L56), `:59`, `:60`, `:67`, `:68`). The kernel spawn mirror
requests exactly these five and nothing else, assembled from the same `Capability` variants rather than the
raw constant ([`src/userspace/capsule_hello/spawn.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_hello/spawn.rs#L47)). The hello capsule holds no filesystem, network,
driver, hardware, crypto, admin, DMA, PIO, IRQ, or debug capability of its own. It is the smallest authority
a graphical app can run with, which is exactly why it is the tutorial: the mask is short enough to read in
full and understand every bit.

## The code pillars

The source under `userland/capsule_hello/src/` is a thin `main.rs` and one `hello` module split into four
files by concern, declared in [`src/hello/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/mod.rs#L17), which re-exports only `Hello` (`mod.rs:22`). The whole
app is small enough to hold in your head at once.

```
  main.rs   ->   app.rs   ->   manifest.rs   window request
  entry          the App        paint.rs      the frame
  point          impl           event.rs      Esc to close
```

| Piece | Mirrors | What it covers |
|-------|---------|----------------|
| [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs) | the entry point | `_start` hands `Hello::new` to the skeleton's `run` (`main.rs:28`). |
| [`src/hello/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/app.rs) | the `App` impl | the `Hello` struct and the three trait methods that delegate to manifest, event, and paint (`app.rs:31`). |
| [`src/hello/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/manifest.rs) | the window request | title, window id, kind, position, 360x180 size, and the key-down input mask (`manifest.rs:22`). |
| [`src/hello/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/paint.rs) | the frame | the four colours and the five draw calls that produce the greeting (`paint.rs:24`). |
| [`src/hello/event.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/event.rs) | input | the single rule: key-down Escape closes, everything else is idle (`event.rs:19`). |
| [walkthrough.md](/docs/userland/hello/walkthrough/) | the whole tree | the same files read in order as the teaching example. |
| [contributing.md](/docs/userland/hello/contributing/) | the whole tree | where to work, how to change the greeting or window, and the build and sign steps. |
| [debugging.md](/docs/userland/hello/debugging/) | runtime | the boot marker and what a blank window or a dead Escape key means. |

## Lifecycle

The hello capsule is spawned through [verified spawn](/docs/security/capsules-and-trust/): its signature
and attestation are checked, its requested capabilities are held against its manifest ceiling, and only then
is its ELF mapped ([`src/userspace/capsule_hello/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_hello/spawn.rs#L34)). A successful spawn prints `[APP-HELLO]
capsule spawned` on the boot log ([`src/userspace/init/spawn_plan/apps.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L53),
[`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); the [debugging](/docs/userland/hello/debugging/) page covers what its absence
means. It is compiled into the fleet only under the `nonos-capsule-hello` feature; without it, `spawn_hello`
is the empty stub and nothing spawns ([`src/userspace/init/spawn_plan/apps.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L55)).

This whole path is what the QUICKSTART.md guide in the repository root walks you through end to end, using this same
capsule: write the app, declare it, generate a publisher identity, build and sign, let the kernel spawn it,
and run it. For the App trait and the runtime that drives it in depth, read [writing-an-app.md](/docs/userland/writing-an-app/).

## Source map

```
  userland/capsule_hello/src/main.rs         _start -> run(Hello::new); declares the hello module
  userland/capsule_hello/src/hello/mod.rs    module wiring, re-exports Hello
  userland/capsule_hello/src/hello/          app, manifest, paint, event
  userland/capsule_hello/Capsule.mk          slug, handle, endpoints, mask, kernel mirror
  userland/capsule_hello/Cargo.toml          crate, panic=abort, AGPL license
  src/capabilities/types.rs                  the capability bit values
  src/userspace/capsule_hello/spawn.rs       the kernel spawn mirror and its requested caps
  src/userspace/init/spawn_plan/apps.rs      the feature-gated spawn and the [APP-HELLO] marker
```

Every reference above is verified against those trees.
