---
title: "The toolkit"
description: "The toolkit is the shared GUI library that every NØNOS GUI capsule links against."
weight: 400
---
The toolkit is the shared GUI library that every NØNOS GUI capsule links against. It is one crate,
`nonos_toolkit` ([`userland/toolkit/Cargo.toml:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L4)), that ships two things from the same source tree: a
`#![no_std]` library (`[lib] name = "nonos_toolkit"`, [`userland/toolkit/Cargo.toml:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L12), [`src/lib.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L17))
that GUI capsules compile into their own binary, and a small `toolkit` service binary
(`[[bin]] name = "toolkit"`, [`userland/toolkit/Cargo.toml:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L15), [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs)) that answers a few
operations over IPC.

Read the library first. The library is the real product. It gives a capsule a font renderer, a design
vocabulary, window decorations, a set of widget helpers, image decoders, a QR renderer, an animation
store, and a theme snapshot, all of which run inside the calling capsule's address space and paint into a
framebuffer the capsule already owns. There is no syscall, no IPC, and no privilege change on a library
call. The service binary is a thin leaf that holds a global theme and an animation counter over IPC; as
this documentation shows, its component-render op cannot actually draw, because the mask it is admitted
with lacks the graphics-surface-map right. This folder mirrors the source one page per pillar so a page
can be read beside the code it describes.

## Identity

The Identity table and the mask decomposition live only on this page. They describe the service binary,
which is the only part of the crate that runs as its own capsule; the library has no identity of its own
because it links into the identity of whatever capsule pulls it in.

| Field | Value | Source |
|-------|-------|--------|
| Slug | `toolkit` | `userland/toolkit/Capsule.mk:1` |
| Service handle | `toolkit` | `Capsule.mk:2` |
| Service endpoint | `service:4610:toolkit` | `Capsule.mk:8` |
| Reply endpoint | `reply:4611:endpoint.toolkit.reply` | `Capsule.mk:9` |
| Capability mask | `0x19` | `Capsule.mk:11` |

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | send and receive on its endpoints (`types.rs:59`) |
| Memory | `0x0010` | map its own heap and stack (`types.rs:60`) |

`0x1 | 0x8 | 0x10 = 0x19`. The service holds no graphics bit. In particular it lacks
`GraphicsSurfaceMap` (`0x2000`, `types.rs:69`), `GraphicsSurfaceCreate` (`0x1000`, `types.rs:68`), and
`GraphicsPresent` (`0x4000`, `types.rs:70`), so it can neither map, create, nor present a surface. This is
the single fact that decides the service's behaviour and is carried through the service page.

## The code pillars

The source under `userland/toolkit/src/` divides cleanly into a library surface and a service binary. The
library is a stack of independent modules a capsule links a la carte; the service is a small receive loop
over four of them. [`src/lib.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L21) declares the library modules and [`src/lib.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L33) re-exports them.

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [library.md](/docs/userland/toolkit/library/) | `src/font/`, `src/design/`, `src/components/`, `src/decorations/`, `src/image/`, `src/qr/`, `src/animation/`, `src/theme/` | The linked library: the shared drawing interface, the 8x8 font, the design tokens, the widget helpers, window decorations, the image decoders, the QR renderer, the animation store, and the theme snapshot. |
| [service.md](/docs/userland/toolkit/service/) | [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs), `src/server/`, `src/protocol/`, `src/component_dispatch/` | The `toolkit` service binary: the port-4610 receive loop, the NOTK wire protocol, the five operations, and the honest finding that `COMPONENT_RENDER` cannot draw with mask `0x19`. |
| [contributing.md](/docs/userland/toolkit/contributing/) | the whole tree | Where to work, how to add a widget, the build and sign steps for the `toolkit` slug, and the code standards. |
| [debugging.md](/docs/userland/toolkit/debugging/) | runtime | The library failure modes that surface in the linking capsule, the service wire signatures, and the spawn marker. |

## The library modules

[`src/lib.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L21) declares eleven modules. `component_dispatch`, `protocol`, and `server` belong to the
service and are covered on the [service](/docs/userland/toolkit/service/) page; the remaining eight are the linked library and
are covered on the [library](/docs/userland/toolkit/library/) page.

```
  animation           easing, timing, transitions, a shared tick counter (src/animation/mod.rs:1)
  components          widget helpers: button, label, checkbox, ... (src/components/mod.rs:1)
  decorations         window chrome: titlebar, close/min/max buttons, borders, hit test (src/decorations/mod.rs:17)
  design              color, spacing, border/radius, shadow, typography (src/design/mod.rs)
  font                an 8x8 bitmap atlas and text/glyph drawing (src/font/mod.rs)
  image               bmp, png, jpeg, and a raw lz4 decoder to ARGB8888 (src/image/mod.rs:1)
  qr                  QR matrix generation (ecc, format, mask, place) and a renderer (src/qr/mod.rs:1)
  theme               a global palette snapshot with a revision counter (src/theme/mod.rs:17)
```

The other three modules, `component_dispatch`, `protocol`, and `server`, exist to serve the binary and
are not part of what a linking capsule uses.

## What links it

Six capsules declare `nonos_toolkit` as a path dependency and reach into it by function call, not by IPC:
`app_skeleton` ([`userland/app_skeleton/Cargo.toml:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/Cargo.toml#L16)), `capsule_boot_splash`
([`userland/capsule_boot_splash/Cargo.toml:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_boot_splash/Cargo.toml#L13)), `capsule_desktop_shell`
([`userland/capsule_desktop_shell/Cargo.toml:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_desktop_shell/Cargo.toml#L17)), `capsule_image_codec`
([`userland/capsule_image_codec/Cargo.toml:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/Cargo.toml#L16)), `capsule_setup_wizard`
([`userland/capsule_setup_wizard/Cargo.toml:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_setup_wizard/Cargo.toml#L13)), and `capsule_wallpaper`
([`userland/capsule_wallpaper/Cargo.toml:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/Cargo.toml#L27)). `app_skeleton` calls `nonos_toolkit::font::render::draw_text`
([`userland/app_skeleton/src/paint/text.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/paint/text.rs#L17)) and `nonos_toolkit::decorations::{hit_test, DecorationHit}`
([`userland/app_skeleton/src/runner/decorations.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/decorations.rs#L19)); `capsule_image_codec` calls
`nonos_toolkit::image::{bmp, jpeg, lz4_raw, png::decoder, types::DecodeError}`
([`userland/capsule_image_codec/src/server/handlers/decode.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L18)). That is how the toolkit is used: as
ordinary in-process calls, with no capability crossing and no service round trip.

## Lifecycle

Two lifecycles run side by side.

The library has no lifecycle of its own. Its code runs when a linking capsule calls it, inside that
capsule's address space, bounded by that capsule's own page tables and capability token. A bug in the
library is a bug in the linking capsule, not a privilege boundary.

The service binary is spawned as its own capsule. `_start` initializes the heap, tolerating an
already-initialized heap, and calls `server::runner::run` ([`src/main.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L26)), which registers on endpoint
4610 and loops: receive, decode the `NOTK` header, dispatch, encode the reply ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)).
A successful spawn logs `[SPAWN] name=toolkit ... caps=0x19`; the [debugging](/docs/userland/toolkit/debugging/) page covers
the wire signatures and what `caps=0x19` implies for the render op.

## Source map

Everything here is drawn from `userland/toolkit/` (the crate source, `Cargo.toml`, and `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bit values), and the six linking capsules under `userland/`
that declare `nonos_toolkit`. Every reference above is verified against those trees.
