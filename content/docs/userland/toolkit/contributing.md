---
title: "Contributing to the toolkit"
description: "This page is for a contributor who wants to change the toolkit."
weight: 3
---
This page is for a contributor who wants to change the toolkit. It covers where the source lives, which
module owns which behaviour, the exact steps to add a widget to the library, how the service render path
is wired if you touch it, how to build and sign the `toolkit` slug, and the code standards a change has to
meet. For what the toolkit is and how it is put together, read the [README](/docs/userland/toolkit/), the
[library](/docs/userland/toolkit/library/), and the [service](/docs/userland/toolkit/service/) pages in this folder.

## Where the source lives

The crate is at `userland/toolkit/`. It is one crate with two build products from the same tree: the
`#![no_std]` library `nonos_toolkit` ([`userland/toolkit/Cargo.toml:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L12), [`src/lib.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L17)) and the `toolkit`
service binary ([`userland/toolkit/Cargo.toml:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L15), [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs)). Almost all work is in the library. The
eight library modules are declared in [`src/lib.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L21) and re-exported in [`src/lib.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L33). The dependencies
are only `alloc`, `nonos_userland_libc`, and `spin` ([`userland/toolkit/Cargo.toml:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L19)).

## Module map

| Module | Owns | Touch it when |
|---|---|---|
| `src/font/` | the 8x8 atlas, glyph tables, and text/glyph drawing | you change how text is drawn or add a glyph |
| `src/design/` | the value tokens: color, spacing, border, shadow, typography | you add or change a design token |
| `src/components/` | the widget helpers, one module per widget | you add a widget or change one |
| `src/decorations/` | window chrome and hit testing | you change the titlebar, buttons, borders, or hit test |
| `src/image/` | the bmp, png, jpeg, and lz4 decoders | you change a decoder |
| `src/qr/` | QR matrix build and render | you change QR generation or blitting |
| `src/animation/` | easing, timing, transitions, the shared tick counter | you change animation math or the counter |
| `src/theme/` | the global palette store, apply, and snapshot | you change the theme model |
| `src/server/`, `src/protocol/`, `src/component_dispatch/` | the service binary | you change the IPC surface (see the [service](/docs/userland/toolkit/service/) page) |

## Adding a widget

A widget is one module under `src/components/`, next to the existing twenty ([`src/components/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/mod.rs#L1)).
There are two edits: the module itself and its declaration.

1. Write the widget as one file per widget under `src/components/`, for example [`src/components/badge.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/badge.rs).
   A widget takes one of two shapes, both already in the tree. A drawing widget takes the shared drawing
   interface and fills the caller's buffer: `render_button` is the reference shape
   ([`src/components/button.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L45)), taking `buf`, `stride`, `w`, `h`, `x`, `y`, the geometry, a label, and
   a style struct, and calling `fill_rect` then `draw_text`. A state or style widget returns a value the
   caller uses to decide colors and positions, the way `checkbox_color` returns a `u32`
   ([`src/components/checkbox.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/checkbox.rs#L18)) or `ScrollState::clamp` returns a clamped state
   ([`src/components/scroll.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/scroll.rs#L9)). Give the style struct a `Default` so a capsule can take the defaults or
   override a field, matching `ButtonStyle` ([`src/components/button.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L10)). A drawing widget must clip to
   the caller-supplied `w`/`h` and bound every write against `buf.len()` with saturating arithmetic, the
   way `render_button`'s `fill_rect` does ([`src/components/button.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L27)); the library never writes past
   the buffer the caller handed in.

2. Declare it. Add the module to [`src/components/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/mod.rs) ([`src/components/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/mod.rs#L1)), and if the widget or
   its style struct should be reachable as `nonos_toolkit::<name>`, add it to the `pub use components::{...}`
   re-export in [`src/lib.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L34). A linking capsule then reaches it by path, the way `app_skeleton` reaches
   `nonos_toolkit::font::render::draw_text` ([`userland/app_skeleton/src/paint/text.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/paint/text.rs#L17)). No IPC and no
   dispatch table is involved: the library is linked, not called over the wire.

If instead you want the service binary to render a new component kind over IPC, that is the
`component_dispatch` path, not the library: add a `ComponentKind` variant and its `from_raw` mapping
([`src/component_dispatch/kind.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/kind.rs#L24)) and a match arm in `paint` ([`src/component_dispatch/paint/paint.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/paint/paint.rs#L39)).
Note that with mask `0x19` the service's `COMPONENT_RENDER` always returns `E_SURFACE` and never reaches
`paint` (see the [service](/docs/userland/toolkit/service/) page), so a new kind is only exercised if the service is later
granted `GraphicsSurfaceMap`.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/toolkit/Capsule.mk:14`.

```
  make nonos-mk-toolkit               build the capsule ELF              capsule.mk:182
  make nonos-mk-toolkit-sign          id cert, manifest, attestation     capsule.mk:261
  make nonos-mk-toolkit-verify        verify artifacts vs trust anchor   capsule.mk:263
  make nonos-mk-check-toolkit-keys    assert the per-capsule signing keys exist   capsule.mk:184
```

The slug, endpoints, and mask come from `userland/toolkit/Capsule.mk` (`CAPSULE_SLUG := toolkit`,
`CAPSULE_REQUIRED_CAPS := 0x19`, `Capsule.mk:1`, `:11`). Building the ELF also builds the library, since
they share the tree; a library-only change is exercised by rebuilding any capsule that links it.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule or library code. No `unwrap`, `expect`, or `panic!`. A drawing helper drops or
  clips out-of-range pixels rather than indexing past the slice ([`src/font/render/draw_glyph.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/draw_glyph.rs#L41)), and a
  decoder returns a `DecodeError` rather than panicking on bad input ([`src/image/types.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/types.rs#L1)).
- One unit per file. New widgets are one module per widget under `src/components/`, and `mod.rs` is used
  only for module declarations and re-exports, matching the existing tree ([`src/components/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/mod.rs#L1),
  [`src/lib.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L33)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/lib.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L1) and every other module.

## Source map

```
  userland/toolkit/Cargo.toml                   lib nonos_toolkit + bin toolkit, deps
  userland/toolkit/src/lib.rs                   module tree and re-exports
  userland/toolkit/src/components/              the widget modules and their mod.rs
  userland/toolkit/src/font/render/             the shared drawing interface
  userland/toolkit/src/component_dispatch/      the service render path (kind, paint)
  userland/toolkit/Capsule.mk                   slug, endpoints, mask; includes the generated targets
  nonos-mk/capsule.mk                           the nonos-mk-toolkit[-sign|-verify] target templates
  userland/app_skeleton/src/paint/text.rs       a reference in-process call into the library
```

Every reference above is verified against those trees.
