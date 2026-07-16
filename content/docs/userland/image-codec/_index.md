---
title: "The Image Codec Capsule"
description: "The image codec is a decode service. It takes encoded image bytes over IPC, runs a real format parser over them, and hands back a shared ARGB8888 surface handle that another cap..."
weight: 400
---
The image codec is a decode service. It takes encoded image bytes over IPC, runs a real format parser
over them, and hands back a shared ARGB8888 surface handle that another capsule can present. It holds no
session and renders nothing itself: it turns compressed bytes into pixels and gets out of the way. Because
every image it sees is attacker-influenced input and a full PNG or JPEG parser is exactly the class of
code that carries parser bugs, the parser runs in its own capsule under a narrow capability mask rather
than inside the compositor or a caller. This documentation mirrors the source one page per pillar so a
page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the codec comes from its
`Capsule.mk`.

| Field | Value | Source |
|-------|-------|--------|
| Slug | `image-codec` | `userland/capsule_image_codec/Capsule.mk:1` |
| Service handle | `image_codec` | `Capsule.mk:2` |
| Namespace | `systems.nonos.image_codec` | `Capsule.mk:7` |
| Service endpoint | `service:4412:image_codec` | `Capsule.mk:8` |
| Reply endpoint | `reply:4413:endpoint.image_codec.reply` | `Capsule.mk:9` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Binary name | `image_codec` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_image_codec` | `Capsule.mk:12` |

The mask `0x1819` decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | receive requests and reply on its endpoints |
| Memory | `0x0010` | map its own heap, stack, and the pixel region |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for display geometry |
| GraphicsSurfaceCreate | `0x1000` | create the surface it publishes the decoded pixels into |

```
  0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000
         = CoreExec + IPC + Memory + GraphicsDisplayQuery + GraphicsSurfaceCreate
```

That is the whole mask and nothing else. There is no `Network` bit (`0x0004`), no `FileSystem` (`0x0040`),
no `Crypto` (`0x0020`), no `Hardware` (`0x0080`), no `Debug` (`0x0100`), and no driver, MMIO, IRQ, DMA, or
PIO capability. The codec also does not hold `GraphicsSurfaceMap` (`0x2000`) or `GraphicsPresent`
(`0x4000`): it creates a surface and shares its handle, but it does not map arbitrary surfaces and it does
not paint the screen. The comment on `Capsule.mk:10` lists `Debug`, but the actual value on `Capsule.mk:11`
is `0x1819`, not `0x1919`; the comment is stale relative to the number. Compromising the codec yields the
codec's mask and nothing more, which is the entire point of running the parser here. The
[safety](/docs/userland/image-codec/safety/) page works through what that containment buys.

## The pillars

The source under `userland/capsule_image_codec/src/` is two top-level modules, `protocol` (the wire
format) and `server` (the loop and handlers), and this documentation is one page per real pillar. A request
arrives, `protocol` parses the frame, `server` dispatches on the opcode, the decode handler runs a toolkit
decoder over the untrusted body, and the surface handler publishes the pixels and returns a handle.

```
  IPC in  ->  protocol/  ->  server/ dispatch  ->  decode handler  ->  surface  ->  reply
  frame       parse the      route the op         toolkit decoder     register     handle +
  bytes       header                              over the body       ARGB pixels  geometry
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/image-codec/protocol/) | `src/protocol/` | The `GMIN` frame, the five operations, the request and reply layout, the 32-byte decode descriptor, the size limits, and the seven typed error codes. |
| [server.md](/docs/userland/image-codec/server/) | `src/server/` | The receive/dispatch/reply loop, the blocking-then-drain behaviour, the dispatch table, and the reply builders. |
| [decode.md](/docs/userland/image-codec/decode/) | `src/server/handlers/` | The parser boundary: the format dispatch, the shared toolkit decoders, the LZ4-raw prefix, the error mapping, and the surface registration path. |
| [safety.md](/docs/userland/image-codec/safety/) | the untrusted-input posture | Why the mask is narrow, how the wire parser and the decoders are bounded, and what a subverted decoder can and cannot reach. |
| [contributing.md](/docs/userland/image-codec/contributing/) | the whole tree | Where to work, how to add a format or decoder, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/image-codec/debugging/) | runtime | The boot marker, the typed failure signatures on the wire, and where to look when a decode fails. |

## Lifecycle

The codec is spawned as part of the desktop services fleet at boot. The desktop services plan calls
`spawn_image_codec`, which runs the boot helper with prefix `IMAGE-CODEC` and hands the embedded ELF, id
cert, manifest, and attestation trailer to `spawn_verified`
([`src/userspace/init/spawn_plan/desktop_services.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L43), [`src/userspace/capsule_image_codec/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_image_codec/spawn.rs#L37)).
`spawn_verified` preflights the id cert and manifest, holds the requested capabilities against the manifest
ceiling, installs the caps the manifest declares, and registers `image_codec` on port 4412 with a reply
inbox on 4413 ([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L26)). A successful spawn
prints `[SPAWN] name=image_codec ... caps=0x1819 ...` and then `[IMAGE-CODEC] capsule spawned` on the boot
log; the [debugging](/docs/userland/image-codec/debugging/) page covers what each marker means. The capsule's `_start` initializes
its heap and enters the receive/dispatch/reply loop forever ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)).

At the time of writing no in-tree capsule calls this service over IPC. The wallpaper capsule, for instance,
decodes its PNG in-process with the same toolkit decoder rather than through port 4412
([`userland/capsule_wallpaper/src/decode_client/wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/decode_client/wire.rs#L21)). The service exists as the isolated decode
boundary for callers that want the parser off their own stack; the [protocol](/docs/userland/image-codec/protocol/) page is the
contract to target when wiring one.

## Source map

Everything here is drawn from `userland/capsule_image_codec/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn mirror under
`src/userspace/capsule_image_codec/`, and the shared decoders at `userland/toolkit/src/image/`. Every
reference above is verified against those trees.
