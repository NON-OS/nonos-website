---
title: "The selection and paint pipeline"
description: "This page covers the path the wallpaper capsule drives on its own initiative, from choosing an image to putting pixels under the windows: selection from the policy store (src/po..."
weight: 4
---
This page covers the path the wallpaper capsule drives on its own initiative, from choosing an image to
putting pixels under the windows: selection from the policy store (`src/policy_client/`), the subscriber
poll (`src/subscriber/`), the chunked catalog fetch (`src/catalog_client/`), the in-process decode
(`src/paint/`, `src/decode_client/`), the always-stretch paint, and the drive to the compositor
(`src/compositor_client/`). For the request protocol the capsule serves, read the
[operations](/docs/userland/wallpaper/operations/) page.

## Selecting the wallpaper

The wallpaper capsule does not decide which image to show; the [policy store](/docs/userland/policy/) does.
The store keeps a single `wallpaper: u8` field (policy `Field::Wallpaper`, discriminant `0x0117`,
[`userland/policy_proto/src/field.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs#L42)), and the wallpaper client reads it with an `OP_GET` of kind
`KIND_U8` on a 200 ms reply timeout, validating that the reply echoes the op, kind, and field before
trusting the byte ([`src/policy_client/get_wallpaper.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/policy_client/get_wallpaper.rs#L22), [`src/policy_client/get_wallpaper.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/policy_client/get_wallpaper.rs#L44)). The
returned byte is a flat catalog index, passed straight to the catalog fetch. When a user changes the
wallpaper in the settings panel, the panel writes that policy field and the wallpaper capsule re-reads it
and re-fetches; the catalog default index is documented on the
[wallpaper catalog](/docs/userland/wallpaper-catalog/) page.

Selection happens in two places:

- At setup, once the surface exists, `run` reads the policy field and applies it immediately, before the
  live session starts, so the first catalog decode and full-screen recomposite do not stall the single
  core a few seconds into boot ([`src/setup/prime/run.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L62)). On success the index is recorded in
  `applied_wallpaper` so the subscriber will not repeat the work.
- During the session, the subscriber polls the policy store every 300 pacer ticks
  ([`src/subscriber/tick.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L23), [`src/subscriber/tick.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L27)). It lazily resolves the policy and catalog
  ports if either is still unset, then reads the `wallpaper` field; if the wanted index differs from
  `applied_wallpaper` it applies it and records the new index ([`src/subscriber/tick.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L30),
  [`src/subscriber/tick.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L44)). A poll that matches the applied index is a no-op, so a changed wallpaper
  redraws and an unchanged one does not, and a missing policy port simply returns until a later poll
  resolves it ([`src/subscriber/tick.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L36)).

## Fetching image bytes from the catalog

`apply` turns an index into pixels: it looks up the catalog port from the context, calls `fetch_image`
for the index, decodes the JPEG, paints it, issues a request id, and commits damage over the whole
surface, returning `false` if any step fails so the caller does not mark the index applied
([`src/subscriber/apply.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/apply.rs#L22), [`src/subscriber/apply.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/apply.rs#L35)).

The catalog service `wallpaper_catalog` is resolved by name ([`src/catalog_client/lookup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/lookup.rs#L23)) and spoken
with a 16-byte compact header of `op u16`, `status u16`, `index u32`, `offset u32`, `payload_len u32`
([`src/catalog_client/proto.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/proto.rs#L23), [`src/catalog_client/proto.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/proto.rs#L37)), each call on a 500 ms reply timeout.

```
  OP_GET_SIZE   = 0x0002   fetch_size.rs:23    image byte length as a u32
  OP_GET_CHUNK  = 0x0003   fetch_chunk.rs:23   up to 4096 bytes at an offset
```

`fetch_image` is the streaming client ([`src/catalog_client/fetch_image.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/fetch_image.rs#L26)). It calls `OP_GET_SIZE`
once, rejects a size of zero or over 2,000,000 bytes, then loops `OP_GET_CHUNK`, advancing the offset by
each reply's `payload_len` until it has the whole image (`fetch_image.rs:27`, `fetch_image.rs:28`,
`fetch_image.rs:35`). The loop is bounded by a chunk count derived from the maximum image size, a chunk
that would overrun the declared size aborts the fetch, and a reassembled length that does not match the
declared size is rejected (`fetch_image.rs:24`, `fetch_image.rs:37`, `fetch_image.rs:43`,
`fetch_image.rs:49`). The size call validates that the reply echoes the requested op and index and carries
at least four payload bytes ([`src/catalog_client/fetch_size.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/fetch_size.rs#L39)); the chunk call validates the op,
index, and offset, rejects a zero or over-4096 payload length, and rejects a body that runs past the bytes
actually received ([`src/catalog_client/fetch_chunk.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/fetch_chunk.rs#L38), [`src/catalog_client/fetch_chunk.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/fetch_chunk.rs#L44),
[`src/catalog_client/fetch_chunk.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/fetch_chunk.rs#L48)). The catalog protocol is described in full on the
[wallpaper catalog](/docs/userland/wallpaper-catalog/) page.

## Decoding, in-process

Two decode paths exist, and both run inside this capsule. There is no separate image-codec service on the
wallpaper's path: the `decode_client` name notwithstanding, it makes no IPC call and holds no codec port.
A real image parser runs over untrusted-length bytes inside the capsule that also owns the background
surface. The decoders bound their output buffers and reject malformed or oversized inputs, but that parser
exposure lives here rather than in an isolated capsule, and that is the trust boundary to keep in mind.

- `decode_jpeg` ([`src/paint/decode_jpeg.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/decode_jpeg.rs#L33)) is used for catalog images and the embedded boot image.
  It requires at least four bytes and the `FF D8` JPEG marker, decodes into a `1920x1080` scratch buffer
  through `nonos_toolkit::image::jpeg::decode_jpeg_argb8888`, and rejects a zero, oversized, or
  over-`MAX_PIXELS` result before truncating the buffer to the real pixel count
  ([`src/paint/decode_jpeg.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/decode_jpeg.rs#L34), [`src/paint/decode_jpeg.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/decode_jpeg.rs#L41), [`src/paint/decode_jpeg.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/decode_jpeg.rs#L42),
  [`src/paint/decode_jpeg.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/decode_jpeg.rs#L46)).
- The `decode_client` (`src/decode_client/`) handles an image carried inline on a `SET_WALLPAPER` request.
  It parses a four-field decode header of kind, width, height, and payload length, checking that the body
  length equals the header plus the declared payload ([`src/decode_client/header.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/header.rs#L36),
  [`src/decode_client/header.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/header.rs#L52)), maps the kind to PNG, BMP, raw LZ4, or JPEG
  ([`src/decode_client/header.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/header.rs#L55)), and decodes through the toolkit into a buffer sized to the backing
  surface ([`src/decode_client/wire.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/wire.rs#L27), [`src/decode_client/seq.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs#L24)). A decode error becomes `E_INVAL`
  back to the caller ([`src/decode_client/seq.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs#L26)).

## Painting, always stretched

Here is the honest gap. The `Policy` fit style is stored and reported but not consulted by either paint
path. `SET_POLICY` records the selected style and `GET_WALLPAPER` reports it ([`src/state/policy.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/policy.rs#L19),
[`src/server/handlers/set_policy.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_policy.rs#L34)), yet both painters always nearest-neighbor stretch the decoded
image to the full backing dimensions regardless of the stored policy.

- The catalog and embedded path goes through `paint_image`, which calls `blit_argb`
  ([`src/paint/paint_image.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/paint_image.rs#L22)). `blit_argb` walks every destination pixel and maps it back to a source
  pixel by the ratio of destination to source dimensions, clamping at the edges: a pure nearest-neighbor
  stretch to the whole surface, with no branch on any policy ([`src/paint/blit_argb.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/blit_argb.rs#L31),
  [`src/paint/blit_argb.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/blit_argb.rs#L37)).
- The inline path goes through `decode_and_paint`, whose `paint_stretch` does the same integer-ratio
  nearest-neighbor stretch to the full backing size, again with no policy branch
  ([`src/decode_client/seq.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs#L39), [`src/decode_client/seq.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs#L51)).

So `Fill`, `Fit`, `Stretch`, `Center`, and `Tile` are all painted identically today, as a stretch. The
fit style is captured and echoed but does not yet change how pixels land. Wiring the policy into these two
functions is the natural first task, and the [contributing](/docs/userland/wallpaper/contributing/) page points at exactly them.

A flat color path bypasses decoding entirely: `fill_argb` writes one ARGB across every pixel of the
backing surface ([`src/paint/fill.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fill.rs#L20)). The default at setup is `0xFF0080FF` ([`src/setup/prime/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L25)),
painted before the embedded `special-variant-6-1080p.jpg` is decoded over it ([`src/setup/prime/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L26),
[`src/setup/prime/run.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L51)).

## Redraw on change

Every path that changes what should be on screen paints the backing buffer and then commits damage to the
compositor over the whole surface: the subscriber after a catalog swap ([`src/subscriber/apply.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/apply.rs#L37)), the
`SET_WALLPAPER` handler after a color or inline image ([`src/server/handlers/set_wallpaper.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_wallpaper.rs#L61)), and the
fade pacer on each alpha step ([`src/server/tick.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L41)). The fade pacer itself lives on the
[operations](/docs/userland/wallpaper/operations/) page.

## Driving the compositor

The capsule speaks to the compositor with a 20-byte `NCMP` header (`0x4E434D50`, version 1,
[`src/compositor_client/wire.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L10)). The calls it makes:

```
  OP 0x0001  healthcheck    compositor_client/health.rs:19        250 ms boot timeout
  OP 0x0008  display_info   compositor_client/display_info.rs:21  query width/height/stride/format
  OP 0x0002  scene_submit   compositor_client/scene_submit.rs:21  register the surface handle at a Z
  OP 0x0003  damage_commit  compositor_client/damage_commit.rs:20 commit a damaged rectangle
```

`healthcheck`, `display_info`, and `scene_submit` run on the boot timeout during setup; `damage_commit`
runs on the tighter 16 ms live timeout ([`src/compositor_client/wire.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L13), [`src/compositor_client/wire.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L14)).
`display_info` rejects a reply whose width, height, or stride is zero or whose format is not
`ARGB8888` ([`src/compositor_client/display_info.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/display_info.rs#L40)), and the backing surface is registered at Z 0 with
`scene_submit`, rolling back the shared handle if the submit is rejected ([`src/setup/prime/register.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L41),
[`src/setup/prime/register.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L49)). Each reply is validated to echo the magic, version, op, request id, and
payload length before its status is read ([`src/compositor_client/wire/reply.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire/reply.rs#L40),
[`src/compositor_client/wire/reply.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire/reply.rs#L55)).

## Source map

```
  userland/capsule_wallpaper/src/subscriber/tick.rs        300-tick policy poll, apply-on-change
  userland/capsule_wallpaper/src/subscriber/apply.rs       fetch + decode_jpeg + paint_image + commit
  userland/capsule_wallpaper/src/policy_client/get_wallpaper.rs  OP_GET Field::Wallpaper, KIND_U8
  userland/capsule_wallpaper/src/policy_client/lookup.rs   resolve the policy service by name
  userland/capsule_wallpaper/src/catalog_client/proto.rs   the 16-byte catalog header and op codes
  userland/capsule_wallpaper/src/catalog_client/fetch_image.rs  size + chunk streaming, bounds
  userland/capsule_wallpaper/src/catalog_client/fetch_size.rs   OP_GET_SIZE, reply validation
  userland/capsule_wallpaper/src/catalog_client/fetch_chunk.rs  OP_GET_CHUNK, reply validation
  userland/capsule_wallpaper/src/catalog_client/lookup.rs  resolve wallpaper_catalog by name
  userland/capsule_wallpaper/src/paint/decode_jpeg.rs      in-process JPEG decode via nonos_toolkit
  userland/capsule_wallpaper/src/paint/paint_image.rs      hand the decoded image to blit_argb
  userland/capsule_wallpaper/src/paint/blit_argb.rs        nearest-neighbor stretch to full surface
  userland/capsule_wallpaper/src/paint/fill.rs             flat-color fill across the surface
  userland/capsule_wallpaper/src/decode_client/header.rs   inline decode header (kind/w/h/len)
  userland/capsule_wallpaper/src/decode_client/wire.rs     in-process png/bmp/lz4/jpeg via nonos_toolkit
  userland/capsule_wallpaper/src/decode_client/seq.rs      decode + paint_stretch for inline images
  userland/capsule_wallpaper/src/compositor_client/        health, display_info, scene_submit, damage_commit
  userland/capsule_wallpaper/src/setup/prime/run.rs        default color, embedded image, apply policy
  userland/policy_proto/src/field.rs                       Field::Wallpaper discriminant
```

Every reference above is verified against those trees.
