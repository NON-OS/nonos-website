---
title: "Contributing to capsule_hello"
description: "This page is for someone changing the hello capsule, or copying it to start their own."
weight: 2
---
This page is for someone changing the hello capsule, or copying it to start their own. Because it is the
tutorial reference for the QUICKSTART.md guide in the repository root, keep it minimal: it should stay the simplest
capsule that still opens a window, paints, and closes. For what it does and how it is put together, read the
[overview](/docs/userland/hello/) and the [walkthrough](/docs/userland/hello/walkthrough/). For the general path from a source tree to a
signed capsule, read [writing-an-app.md](/docs/userland/writing-an-app/).

## Where the source lives

The capsule is at `userland/capsule_hello/`. It is a `no_std`/`no_main` app-skeleton GUI app: `_start`
hands `Hello::new` to the skeleton's `run`, and the runtime owns the surface, window, input subscription,
and paint loop ([`userland/capsule_hello/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_hello/src/main.rs#L28)). All app logic is under `src/hello/`, declared as
one module per concern in [`src/hello/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/mod.rs#L17), which re-exports only `Hello` (`mod.rs:22`).

## File map

| File | Owns | Touch it when |
|---|---|---|
| [`src/hello/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/app.rs) | the `App` impl and the empty `Hello` struct | you add per-instance state or change how it wires to the runtime |
| [`src/hello/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/manifest.rs) | the window request and input mask | you change the title, window size or position, or the subscribed inputs |
| [`src/hello/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/paint.rs) | the colours and the drawn frame | you change what the window shows |
| [`src/hello/event.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/event.rs) | input | you change which keys the app reacts to |

## Common changes

1. The greeting text or colours: the four colour constants and the five draw calls in `paint`
   ([`src/hello/paint.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/paint.rs#L19), `paint.rs:24`). Adding a line is one more `text` or `text_scaled` call; there
   is no layout to update.
2. The window size or position: the `width`, `height`, `initial_x`, and `initial_y` fields of the manifest
   ([`src/hello/manifest.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/manifest.rs#L22)). The accent bar in `paint` is drawn 360 wide to match the window, so if you
   change the width, change that `fill_rect` too ([`src/hello/paint.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/paint.rs#L26)).
3. A new key: add a branch to `on_event` returning the outcome you want, and if the key is not a key-down,
   widen `input_kind_mask` in the manifest so the app is subscribed to it ([`src/hello/event.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/event.rs#L19),
   [`src/hello/manifest.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/manifest.rs#L31)). Return `EventOutcome::Close` to exit and `EventOutcome::Idle` for a no-op.
4. Per-instance state: give `Hello` fields and initialise them in `new`, then read them in `paint`
   ([`src/hello/app.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/app.rs#L25)). The moment you do this the capsule stops being the minimal example, so consider
   whether a new capsule is the better home.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_hello/Capsule.mk:14`.

```
  make nonos-mk-hello                build the capsule ELF
  make nonos-mk-hello-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-hello-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-hello-keys     check the per-capsule signing keys exist
```

These are exactly the steps the QUICKSTART.md guide in the repository root runs against this capsule. To spawn it,
the kernel is built with the `nonos-capsule-hello` feature; without it, `spawn_hello` is the empty stub and
nothing spawns ([`src/userspace/init/spawn_plan/apps.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L55)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. The hello capsule has no fallible logic to
  begin with, and the release profile is `panic = "abort"` (`Cargo.toml:24`). Keep it that way.
- One unit per file. Each concern is its own file under `src/hello/`, and `mod.rs` is used only for module
  wiring and re-exports ([`src/hello/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/mod.rs)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/hello/paint.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hello/paint.rs#L1) and every other module.

## Source map

```
  userland/capsule_hello/src/main.rs         _start -> run(Hello::new); declares the hello module
  userland/capsule_hello/src/hello/mod.rs    module wiring, re-exports Hello
  userland/capsule_hello/src/hello/          app, manifest, paint, event
  userland/capsule_hello/Capsule.mk          slug, handle, endpoints, mask, kernel mirror; includes the generated targets
  userland/capsule_hello/Cargo.toml          crate, panic=abort, AGPL license
  nonos-mk/capsule.mk                        the nonos-mk-hello[-sign|-verify] target templates
  src/userspace/init/spawn_plan/apps.rs      the feature-gated spawn
```

Every reference above is verified against those trees.
