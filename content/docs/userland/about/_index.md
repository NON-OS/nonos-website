---
title: "The About Capsule"
description: "capsuleabout is the \"About NØNOS\" application: a small signed userland window that shows the product identity, the running build, the capsule's own capability mask, the primary ..."
weight: 400
---
`capsule_about` is the "About NØNOS" application: a small signed userland window that shows the product
identity, the running build, the capsule's own capability mask, the primary display, an uptime clock, and
the full AGPL-3 license text. It is read-only introspection. Everything it shows is either baked into the
binary at build time or read live from the kernel through two query syscalls, and it never writes anything
back. The source is a handful of concerns under `userland/capsule_about/src/about/`, and this
documentation mirrors that structure so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `about` | `userland/capsule_about/Capsule.mk:1` |
| Service handle | `app.about` | `Capsule.mk:2`, [`src/userspace/capsule_about/spawn.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_about/spawn.rs#L30) |
| Namespace | `systems.nonos.app.about` | `Capsule.mk:7` |
| Service endpoint | `service:4710:app.about` | `Capsule.mk:8`, `spawn.rs:31` |
| Reply endpoint | `reply:4711:endpoint.app.about.reply` | `Capsule.mk:9`, `spawn.rs:32`, `spawn.rs:33` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Binary name | `about` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_about` | `Capsule.mk:12` |

The mask `0x1819` decomposes bit by bit. The names and role text come from the app's own capability table
([`src/about/data/caps.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/caps.rs#L23)), and each bit value is checked against the kernel's `Capability::bit`
([`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)):

```
  0x0001  CoreExec                bit  1        types.rs:56
  0x0008  IPC                     bit  8        types.rs:59
  0x0010  Memory                  bit  16       types.rs:60
  0x0800  GraphicsDisplayQuery    bit  2048     types.rs:67
  0x1000  GraphicsSurfaceCreate   bit  4096     types.rs:68
  ------
  0x1819  = 1 + 8 + 16 + 2048 + 4096
```

The kernel spawn path requests exactly those five capabilities and no others
([`src/userspace/capsule_about/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_about/spawn.rs#L49)). There is no `Network` bit (4), no `FileSystem` bit (64), and
no `Hardware`, `Driver`, `Mmio`, `Irq`, `Dma`, or `Pio` capability in the mask. The app can create a
surface, ask the display for its size, and speak IPC, and that is all. Notably it does not even hold
`GraphicsSurfaceMap` or `GraphicsPresent`: it registers a surface with `GraphicsSurfaceCreate`, and the
runtime and compositor own the mapping and the scanout flush on its behalf. The Authority section renders
this same mask from the app's own copy of the capability table and marks every ungranted capability as
denied ([`src/about/data/caps.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/caps.rs#L47), [`src/about/section_render/authority.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/authority.rs#L52)).

## The pillars

The source under `userland/capsule_about/src/about/` is a thin `App` shell over three concerns, and the
documentation is one page each. A key or click comes in through `event`, mutates the `state`, and the next
`paint` walks the current section's data and turns it into pixels.

```
  event/  ->  state.rs  ->  paint/  +  section_render/  <-  data/
  input       what is       the frame on screen           the facts
  handling    selected      and where the section body     (baked + two
              and scrolled   goes                          live reads)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [content.md](/docs/userland/about/content/) | `src/about/data/`, [`src/about/section.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section.rs), `src/about/section_render/` | The facts the app holds, where each comes from, and the five sections it renders row by row: Identity, Authority, Display, Uptime, License. |
| [interaction.md](/docs/userland/about/interaction/) | `src/about/event/`, [`src/about/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs), [`src/about/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/manifest.rs) | The input the window subscribes to, the key and pointer router, every keybinding, and the selection and scroll model behind them. |
| [rendering.md](/docs/userland/about/rendering/) | `src/about/paint/`, [`src/about/section_render/row.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/row.rs), [`src/about/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/theme.rs) | How a frame is produced: the paint order, the header, tab strip, body, scrollbar, and status bar, the row layout, and the palette and geometry. |
| [contributing.md](/docs/userland/about/contributing/) | the whole tree | Where to work, how to change what a section shows or add one, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/about/debugging/) | runtime | The boot marker, the failure modes, and where to look when input, a live read, or the display misbehaves. |

## Lifecycle

The about app is spawned through [verified spawn](/docs/security/capsules-and-trust/): the spawn helper
verifies the embedded ELF, id cert, manifest, and attestation trailer against the baked trust anchor,
holds its requested capabilities against its manifest ceiling, and only then maps its ELF
([`src/userspace/capsule_about/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_about/spawn.rs#L36)). It registers `app.about` on port 4710 with the reply inbox on
4711 and, on success, logs `[APP-ABOUT] capsule spawned` on the boot log
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). It runs second in the desktop app fleet, right after the
input proof ([`src/userspace/init/spawn_plan/apps.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L18)). It is an [app-skeleton](/docs/userland/writing-an-app/)
GUI app: `_start` hands `About::new` to the skeleton's `run`, and the runtime owns the surface, window,
input subscription, and paint loop ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). The [debugging](/docs/userland/about/debugging/) page covers what the
boot line means and what its absence points at.

## Source map

```
  userland/capsule_about/src/main.rs               _start -> run(About::new)
  userland/capsule_about/src/about/app.rs          the App impl: manifest, on_event, paint
  userland/capsule_about/src/about/manifest.rs     the window descriptor (title, size, input mask)
  userland/capsule_about/src/about/state.rs        State: selected section, scroll, visible-line model
  userland/capsule_about/src/about/section.rs      the five sections and their order
  userland/capsule_about/src/about/section_render/ the per-section renderers and the row layout
  userland/capsule_about/src/about/data/           baked facts + the two live reads (display, uptime)
  userland/capsule_about/src/about/event/          the input router and per-key handlers
  userland/capsule_about/src/about/paint/          header, tab strip, body, scrollbar, status bar, frame
  userland/capsule_about/src/about/format.rs       u64-to-decimal for the rendered numbers
  userland/capsule_about/src/about/theme.rs        colors and window geometry
  userland/capsule_about/build.rs                  stamps the git SHA into ABOUT_GIT_SHA
  userland/capsule_about/Capsule.mk                slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                        the capability bit values
  src/userspace/capsule_about/spawn.rs             the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/apps.rs            the desktop-fleet spawn entry
  userland/libc/src/graphics/display_dimensions.rs the display-size syscall
  userland/libc/src/time/wall.rs                   the wall-clock syscall
```

Every reference above is verified against those trees.
