---
title: "Safety"
description: "The reason this capsule exists is isolation."
weight: 1
---
The reason this capsule exists is isolation. It parses untrusted image bytes, and everything on this page
is about bounding what a subverted parser can do. The capability mask (decomposed on the
[README](/docs/userland/image-codec/)) is what makes the isolation worth having; the bounds below are what keep a malformed
image from turning into anything worse than a typed error.

## Untrusted input, contained blast radius

Every image the codec sees is attacker-influenced bytes, and the decoders are real format parsers from
`nonos_toolkit::image` running over them ([`src/server/handlers/decode.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L18)). A full PNG or JPEG parser is
exactly the class of code that carries parser bugs, which is the entire reason this work runs in its own
capsule rather than inside the compositor or a caller.

The installed mask `0x1819` is `CoreExec | IPC | Memory | GraphicsDisplayQuery | GraphicsSurfaceCreate`
(`userland/capsule_image_codec/Capsule.mk:11`, decomposed against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs)). It has no
`Network` (`0x0004`), no `FileSystem` (`0x0040`), no `Crypto` (`0x0020`), no `Hardware` (`0x0080`), no
`Debug` (`0x0100`), and no driver, MMIO, IRQ, DMA, or PIO capability. A decoder subverted by a malformed
image is trapped in a capsule that can receive IPC, allocate memory, query the display, create a surface,
and reply, and nothing else. It cannot read a file, open a socket, or reach a device off the back of a
parser exploit. It also holds neither `GraphicsSurfaceMap` (`0x2000`) nor `GraphicsPresent` (`0x4000`): it
creates a surface and shares its handle, but it cannot map arbitrary surfaces or paint the screen.

The mask on the running process is decided by the signed manifest, not by the number passed at the spawn
site. `spawn_verified` treats `requested_caps` only as the upper bound for optional caps and installs the
capabilities the verified manifest declares
([`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L24),
[`src/security/capsule_manifest/verify/caps.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/verify/caps.rs#L39)). With every cap declared required and none optional, that
resolves to exactly `0x1819`, the number the `[SPAWN]` line reports at boot.

## The wire parser is bounded end to end

Before any decoder runs, the frame parser validates the header without trusting a single field
([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)):

- A buffer shorter than `HDR_LEN` returns `E_BAD_LEN` immediately (`decode.rs:25`).
- Each header field is read with `try_from` on a fixed sub-slice, so a short read returns `E_BAD_LEN`
  rather than reading past the buffer (`decode.rs:28`, `decode.rs:35`, `decode.rs:39`).
- The magic must be `GMIN` or the frame is `E_BAD_MAGIC`, and the version must be `1` or it is
  `E_BAD_VERSION` (`decode.rs:32`, `decode.rs:51`).
- The payload end is computed with `checked_add`, so a declared length near `usize::MAX` cannot wrap
  (`decode.rs:58`), and the whole buffer must be exactly `HDR_LEN + payload_len` or it is `E_BAD_LEN`
  (`decode.rs:62`).

Every failure returns a typed errno paired with a default `Request`, never a silent drop and never an
out-of-bounds read. The parser hands the body to the handler only once the frame is fully validated. The
error codes are listed on the [protocol](/docs/userland/image-codec/protocol/) page.

## No panics, no partial surfaces

The capsule builds with `panic = "abort"` in both profiles ([`userland/capsule_image_codec/Cargo.toml:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/Cargo.toml#L19),
`Cargo.toml:26`), so there is no unwinding path to exploit. The decode path returns errors as status codes,
never a partial surface: a decoder error becomes `fail(...)` with a mapped errno and no handle
([`src/server/handlers/decode.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L34), `decode.rs:47`), and the surface is written into the reply only after
registration and sharing both succeed (`decode.rs:36`, `decode.rs:44`). Capsule code carries no `unwrap` or
`expect` on these paths; every error is a typed errno returned through `respond::status`.

## Bounded output

A crafted image cannot make the codec allocate an unbounded pixel buffer. The decode buffer is a fixed
`MAX_PIXELS = 16384` 32-bit pixels ([`src/server/handlers/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L23), `decode.rs:26`), and each toolkit
decoder checks its output against that buffer length before it writes:

- The LZ4-raw decoder rejects zero dimensions (`BadDimensions`), an output larger than the buffer
  (`OutputTooSmall`), and a decompressed input shorter than the dimensions imply (`Truncated`)
  ([`userland/toolkit/src/image/lz4_raw.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/lz4_raw.rs#L9), `lz4_raw.rs:11`, `lz4_raw.rs:15`).
- `ImageSize::new` rejects a zero width or height with `BadDimensions` before any decode proceeds
  ([`userland/toolkit/src/image/types.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/types.rs#L1)).

Because the decoder guards its output against the buffer, `count = width * height` on success is at most
`MAX_PIXELS`, so the `pixels[..count]` slice handed to the surface path is always in bounds
([`src/server/handlers/decode.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L35), `decode.rs:36`).

## Bounded input

A single request's compressed input is capped at `IPC_PAYLOAD_MAX = 131072` bytes
([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)). The receive buffer is `HDR_LEN + IPC_PAYLOAD_MAX`
([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)), so a frame that would exceed the cap cannot fit and is bounded at the transport
before decode.

## The surface path is checked

The surface registration multiplies stride and height with `checked_mul` and returns `E_INVAL` on overflow
before it maps anything ([`src/server/handlers/surface.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/surface.rs#L29), `surface.rs:30`). A mapping failure returns
`E_NOMEM` (`surface.rs:34`), and a registration failure unmaps the region before returning rather than
leaking it (`surface.rs:49`). The copy into the mapped region is bounded by the byte length the checked
multiplications produced (`surface.rs:36`, `surface.rs:38`).

## Stateless

No session is carried between requests, so one caller's image cannot influence another's decode. The
buffers are allocated once and reused, and each request is parsed, decoded, and answered independently
([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29), `runner.rs:46`). The only shared artifact produced is the surface, owned by the
surface registry once registered. Isolation from other capsules is the kernel's: the codec is a CPL 3 user
binary that speaks only IPC and its own surfaces, verified and enrolled at spawn like every other capsule
([`src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/preflight.rs#L49),
[`src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L24)).

## Source map

This page is drawn from `userland/capsule_image_codec/` (`Capsule.mk`, `Cargo.toml`, the `src/protocol/`
parser, the `src/server/` loop and handlers), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the
kernel-side verification under `src/kernel_core/process_spawn/capsule_spawn/runner/` and
`src/security/capsule_manifest/verify/`, and the shared decoders at `userland/toolkit/src/image/`. Every
reference above is verified against those trees.
