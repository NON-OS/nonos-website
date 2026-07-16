---
title: "Decode"
description: "This page mirrors src/server/handlers/, the parser boundary."
weight: 4
---
This page mirrors `src/server/handlers/`, the parser boundary. When the loop routes a decode op here, this
is where the untrusted image bytes meet a real format parser and, on success, become a published surface.
The dispatch that reaches these handlers is on the [server](/docs/userland/image-codec/server/) page; the frame and reply layout are
on the [protocol](/docs/userland/image-codec/protocol/) page; the containment argument for running the parser here is on the
[safety](/docs/userland/image-codec/safety/) page.

## The decode handler

`handle` takes the sender pid, the parsed `Request`, the untrusted body, and the transmit buffer
([`src/server/handlers/decode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L25)). It allocates a fixed pixel buffer, matches the opcode to a toolkit
decoder, runs it over the body, and on success registers the pixels as a surface:

```
  pixels = vec![0u32; MAX_PIXELS]                          decode.rs:26
  decoded = match op:
    OP_DECODE_PNG  => png::decoder::decode_png_argb8888     decode.rs:28
    OP_DECODE_BMP  => bmp::decode_bmp_argb8888              decode.rs:29
    OP_DECODE_JPEG => jpeg::decode_jpeg_argb8888            decode.rs:30
    OP_DECODE_LZ4_RAW => decode_lz4                         decode.rs:31
  size  = decoded?  else fail(map_decode_error(e))         decode.rs:34
  count = size.pixel_count()                               decode.rs:35
  (handle, stride, byte_len) = register_argb_surface(&pixels[..count], size)?   decode.rs:36
  write the 32-byte descriptor, respond::payload           decode.rs:37..44
```

`MAX_PIXELS = 16384` (`decode.rs:23`) is the output budget: the buffer is exactly that many 32-bit pixels,
and each toolkit decoder checks its output against the buffer length before it writes, so an image whose
pixel count exceeds the budget returns `OutputTooSmall` rather than overrunning (see the decoders below).
On success `count = width * height` (`decode.rs:35`), and the surface is registered from `pixels[..count]`
so only the decoded region is published (`decode.rs:36`). A decode error goes to `fail`, which replies a
mapped errno through `respond::status` and returns no handle, never a partial surface (`decode.rs:34`,
`decode.rs:47`).

## The toolkit decoders

The decoders are not in this capsule. They live in the shared toolkit at `userland/toolkit/src/image/` and
are the same code any other capsule uses to decode in-process. The handler imports them from
`nonos_toolkit::image` (`decode.rs:18`), and each has the same shape,
`decode_<fmt>_argb8888(input, out) -> Result<ImageSize, DecodeError>`:

| Format | Entry point | File |
|--------|-------------|------|
| PNG | `png::decoder::decode_png_argb8888` | [`userland/toolkit/src/image/png/decoder.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/png/decoder.rs#L11) |
| BMP | `bmp::decode_bmp_argb8888` | [`userland/toolkit/src/image/bmp.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/bmp.rs#L13) |
| JPEG | `jpeg::decode_jpeg_argb8888` | [`userland/toolkit/src/image/jpeg/decode/decode_jpeg_argb8888.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/jpeg/decode/decode_jpeg_argb8888.rs#L30) |
| LZ4-raw | `lz4_raw::decode_lz4_raw_argb8888` | [`userland/toolkit/src/image/lz4_raw.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/lz4_raw.rs#L3) |

These are real parsers. The PNG path carries its own zlib inflate and scanline filtering
(`userland/toolkit/src/image/png/inflate/`, [`png/scanline.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/png/scanline.rs)), and the JPEG path carries Huffman table
building, dequantization, IDCT, and MCU walking (`userland/toolkit/src/image/jpeg/`). The image module
re-exports the four format submodules and the shared types through [`userland/toolkit/src/image/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/mod.rs#L1).
The `ImageSize` returned on success carries the decoded `width` and `height`, and `pixel_count` is
`width * height` ([`userland/toolkit/src/image/types.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/types.rs#L1)).

## The LZ4-raw prefix

`OP_DECODE_LZ4_RAW` is the one op that is not a self-describing container, so the handler parses its
dimensions before calling the decoder (`decode_lz4`, [`src/server/handlers/decode.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L49)):

```
  if body.len() < DECODE_LZ4_PREFIX_LEN: Err(Truncated)    decode.rs:50
  width  = le u32 body[0..4]                               decode.rs:51
  height = le u32 body[4..8]                               decode.rs:52
  lz4_raw::decode_lz4_raw_argb8888(width, height, &body[8..], out)   decode.rs:53
```

The prefix is `DECODE_LZ4_PREFIX_LEN = 8` bytes ([`src/protocol/limits.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L19)). The decoder itself checks
that the dimensions are non-zero, that `width * height` fits the output buffer, and that the decompressed
input carries the bytes the dimensions imply, returning `BadDimensions`, `OutputTooSmall`, or `Truncated`
otherwise ([`userland/toolkit/src/image/lz4_raw.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/lz4_raw.rs#L9), `lz4_raw.rs:11`, `lz4_raw.rs:15`).

## Error mapping

Every toolkit `DecodeError` maps onto a protocol errno in one place (`map_decode_error`,
[`src/server/handlers/decode.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L56)):

| DecodeError | Errno | Value |
|-------------|-------|-------|
| `BadMagic` | `E_INVAL` | `-22` |
| `Unsupported` | `E_UNSUPPORTED` | `-95` |
| `BadDimensions` | `E_BAD_LEN` | `-90` |
| `OutputTooSmall` | `E_BAD_LEN` | `-90` |
| `Truncated` | `E_BAD_LEN` | `-90` |

The `DecodeError` variants are defined at [`userland/toolkit/src/image/types.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/types.rs#L1). Keeping the mapping in
one function means a caller sees a stable errno per failure class regardless of which format produced it.

## Surface registration

On a successful decode the handler publishes the pixels through `register_argb_surface`
([`src/server/handlers/surface.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/surface.rs#L28)). This is the only place the codec touches its graphics capability:

```
  stride   = width.checked_mul(4)?          E_INVAL on overflow   surface.rs:29
  byte_len = stride * height (checked)?      E_INVAL on overflow   surface.rs:30
  base = mk_mmap(null, byte_len, RW, PRIVATE|ANON, -1, 0)          surface.rs:31
  if base <= 0: return E_NOMEM                                     surface.rs:33
  copy_nonoverlapping(pixels -> base)                             surface.rs:38
  desc = SurfaceDescriptor { width, height, stride, ARGB8888, byte_len, base_va, flags: 0 }   surface.rs:39
  sid = mk_surface_register(&desc)                                surface.rs:48
  if sid < 0: munmap(base); return the error                     surface.rs:49
  handle = mk_surface_share(sid)                                  surface.rs:55
  if handle <= 0: return the error                               surface.rs:56
  Ok((handle, stride, byte_len))                                 surface.rs:59
```

It maps an anonymous private region of `stride * height` bytes, copies the decoded pixels into it, fills a
`SurfaceDescriptor` with the `SURFACE_FORMAT_ARGB8888` tag, registers it with `mk_surface_register`, and
shares it with `mk_surface_share`, returning the shared handle, stride, and byte length (`surface.rs:28`).
The stride and byte-length multiplications use `checked_mul` and return `E_INVAL` on overflow before
anything is mapped (`surface.rs:29`, `surface.rs:30`). A registration failure unmaps the region before
returning rather than leaking it (`surface.rs:49`), and a mapping failure returns `E_NOMEM`
(`surface.rs:34`). The handler then writes the returned handle and geometry into the 32-byte reply
descriptor documented on the [protocol](/docs/userland/image-codec/protocol/) page ([`src/server/handlers/decode.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L37)).

The codec does not map arbitrary surfaces and it does not paint the screen: it creates a surface and shares
its handle, which is why it holds `GraphicsSurfaceCreate` but not `GraphicsSurfaceMap` or `GraphicsPresent`.
The caller gets a handle it can hand to the compositor rather than a raw copy of the pixels back over IPC.

## Source map

This page is drawn from `userland/capsule_image_codec/src/server/handlers/` (`decode.rs`, `surface.rs`,
`health.rs`, `mod.rs`), the protocol limits and errno constants under `src/protocol/`, and the shared
decoders and types at `userland/toolkit/src/image/` (`png/`, `bmp.rs`, `jpeg/`, `lz4_raw.rs`, `types.rs`,
`mod.rs`). Every reference above is verified against those trees.
