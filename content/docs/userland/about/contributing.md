---
title: "Contributing to capsule_about"
description: "This page is for a contributor who wants to change the about window: where the source lives, which module owns which behaviour, how to change what a section shows or add a new o..."
weight: 4
---
This page is for a contributor who wants to change the about window: where the source lives, which module
owns which behaviour, how to change what a section shows or add a new one, the build and sign steps, and
the code standards a change has to meet. For what the app does and how it is put together, read the
[README](/docs/userland/about/), the [content reference](/docs/userland/about/content/), the [interaction model](/docs/userland/about/interaction/), and the
[rendering](/docs/userland/about/rendering/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_about/`. It is a `no_std`/`no_main` app-skeleton GUI app: `_start`
hands `About::new` to the skeleton's `run`, and the runtime owns the surface, window, input subscription,
and paint loop ([`userland/capsule_about/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_about/src/main.rs#L28)). The `About` struct holds one `State` and forwards
the three trait methods to the manifest, the event router, and the frame renderer
([`src/about/app.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/app.rs#L34)).

## Module map

| Folder or file | Owns | Touch it when |
|---|---|---|
| `src/about/data/` | the baked facts and the two live reads | you change a value the app shows or where it comes from |
| `src/about/section_render/` | the five per-section renderers and the row layout | you change how a section is laid out |
| [`src/about/section.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section.rs) | the section enum, order, and titles | you add, remove, or reorder a section |
| `src/about/event/` | the input router and per-key handlers | you change a keybinding or the pointer hit test |
| [`src/about/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs) | the selection and scroll model | you change how selection or scrolling behaves |
| `src/about/paint/` | header, tab strip, body, scrollbar, status bar, frame | you change how a frame is drawn |
| [`src/about/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/theme.rs) | colors and window geometry | you change the palette or the layout dimensions |

## Changing what a section shows

To change a value, edit its data module and its renderer together. A value that appears in more than one
place lives once: the tagline is `product::TAGLINE` and is used by both the header and the Identity section
([`src/about/data/product.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/product.rs#L18), [`src/about/paint/header.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/header.rs#L31), [`src/about/section_render/identity.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/identity.rs#L27)).

The Identity, Display, and Uptime sections have a fixed row count declared as `LINE_COUNT`, so if you add
or remove a row you must update that constant to match, or the scrollbar and the End key will be off
([`src/about/section_render/identity.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/identity.rs#L22), `display.rs:23`, `uptime.rs:23`). The Authority and License
sections compute their line count at runtime, so they need no manual count
(`authority.rs:25`, `license.rs:24`).

## Adding a section

1. Add a variant to `Section`, extend the `SECTIONS` array, and give it a title and an index
   ([`src/about/section.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section.rs#L18), `section.rs:26`, `section.rs:35`, `section.rs:44`).
2. Add a renderer module under `src/about/section_render/` exposing
   `render(scroll, visible, top, fb)` and either a `const LINE_COUNT` or a `fn line_count()`, then wire
   both into the two match arms in [`src/about/section_render/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/mod.rs#L28) and `mod.rs:38`.
3. Draw label/value rows with `row::pair` and full-width rows with `row::single`; they handle the column
   layout and the per-line y offset for you ([`src/about/section_render/row.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/row.rs#L24), `row.rs:29`).

The header breadcrumb and the tab strip both read `SECTIONS.len()`, so a new section shows up in the
`n / 5` counter and the tab strip without any further wiring ([`src/about/paint/header.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/header.rs#L35),
[`src/about/paint/tabs.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/tabs.rs#L30)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_about/Capsule.mk:14`:

```
  make nonos-mk-about              build the capsule ELF                    capsule.mk:182
  make nonos-mk-about-sign         id cert, manifest, attestation trailer   capsule.mk:261
  make nonos-mk-about-verify       verify artifacts vs the trust anchor     capsule.mk:263
  make nonos-mk-check-about-keys   assert the per-capsule signing keys exist capsule.mk:184
```

For a bootable desktop image that includes the about app:

```
  make nonos-mk-about-prod         full desktop GUI image                   Makefile:1162
```

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. The two live reads return `Option` and
  fall back to `unavailable` rather than panicking ([`src/about/data/display.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/display.rs#L23), [`data/uptime.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L21)),
  and the release profile is `panic = "abort"` (`Cargo.toml:29`).
- One unit per file, with `mod.rs` used only for module declarations and re-exports, matching the existing
  tree ([`src/about/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/mod.rs#L17), [`src/about/data/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/mod.rs#L17), [`src/about/event/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/mod.rs#L17)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/about/app.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/app.rs#L1) and every other module.

## Source map

```
  userland/capsule_about/src/main.rs        _start -> run(About::new)
  userland/capsule_about/src/about/app.rs   the App impl over State
  userland/capsule_about/src/about/data/    the facts and the two live reads
  userland/capsule_about/src/about/section.rs        the section enum and order
  userland/capsule_about/src/about/section_render/   the renderers and row layout
  userland/capsule_about/src/about/event/   the input router and handlers
  userland/capsule_about/src/about/paint/   the frame renderer
  userland/capsule_about/src/about/theme.rs the palette and geometry
  userland/capsule_about/Capsule.mk         slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                       the nonos-mk-about[-sign|-verify] target templates
  Makefile                                  the -prod desktop image target
```

Every reference above is verified against those trees.
