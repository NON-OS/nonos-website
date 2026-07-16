---
title: "Protocol"
description: "This page mirrors src/protocol/, the wire format the codec speaks."
weight: 2
---
This page mirrors `src/protocol/`, the wire format the codec speaks. The module owns the frame: the fixed
header, the five operations, the reply layout, the size limits, and the typed error codes. It re-exports
its surface through [`src/protocol/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L24).

## The frame

Every request and reply is a 20-byte header followed by a payload, all little-endian. The magic is `GMIN`,
`0x474D494E`, the version is `1`, and the header length is `HDR_LEN = 20` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17),
`header.rs:18`, `header.rs:19`).

```
  +0   u32  magic = 0x474D494E ('GMIN')     header.rs:17   decode.rs:28
  +4   u16  version = 1                      header.rs:18   decode.rs:35
  +6   u16  op                               header.rs:22   decode.rs:39
  +8   u16  flags                            header.rs:23   decode.rs:43
  +10  u16  reserved                         skipped by the parser
  +12  u32  request_id                       header.rs:24   decode.rs:47
  +16  u32  payload_len                      decode.rs:54
  +20  ...  payload (payload_len bytes)      decode.rs:65
```

The parser reads the fields in order, validates magic, version, and the declared payload length, and
returns the `Request` (op, flags, request id) together with a body slice ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). It
requires the whole buffer to be exactly `HDR_LEN + payload_len`; a mismatch is `E_BAD_LEN`
(`decode.rs:58`, `decode.rs:62`). The reserved `u16` at offset 10 is never read on the request and is
zeroed on the reply. The parser reads defensively: it uses `try_from` on fixed sub-slices and `checked_add`
for the payload end, so a malformed frame returns a typed errno rather than reading past the buffer
(`decode.rs:28`, `decode.rs:58`). See [safety](/docs/userland/image-codec/safety/) for the parser posture in full.

The reply reuses the header with the same op, flags, and request id, a zeroed reserved field, and the reply
payload length, written by `response_header` ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)). A 4-byte status word follows
the header, written by `write_status` at offset `HDR_LEN` (`encode.rs:29`); the status is `0` on success
and a negative errno on failure. Any reply body follows the status word.

## Operations

Five operations are defined ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)). One is a healthcheck; the other four are decodes,
one per supported format.

| Op | Opcode | Body | What it does | Handler |
|----|--------|------|--------------|---------|
| `OP_HEALTHCHECK` | `0x0001` | empty | reply with status 0, no payload | `ops.rs:17`, [`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52), [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20) |
| `OP_DECODE_PNG` | `0x0002` | PNG bytes | decode a PNG to ARGB8888, register a surface | `ops.rs:18`, `runner.rs:53`, [`src/server/handlers/decode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L28) |
| `OP_DECODE_BMP` | `0x0003` | BMP bytes | decode a BMP to ARGB8888, register a surface | `ops.rs:19`, `runner.rs:53`, `decode.rs:29` |
| `OP_DECODE_LZ4_RAW` | `0x0004` | `width(4) height(4) lz4-raw-argb` | decode raw LZ4-ARGB with a dimension prefix | `ops.rs:20`, `runner.rs:53`, `decode.rs:31` |
| `OP_DECODE_JPEG` | `0x0005` | JPEG bytes | decode a baseline JPEG to ARGB8888, register a surface | `ops.rs:21`, `runner.rs:53`, `decode.rs:30` |

The four supported formats are PNG, BMP, JPEG, and LZ4-raw. The three container formats (PNG, BMP, JPEG)
carry the image bytes directly in the payload, and the decoder reads the dimensions out of the format's own
header. `OP_DECODE_LZ4_RAW` is not a container: the first eight payload bytes are a little-endian `width`
and `height`, and the remainder is raw ARGB8888 already expanded to four bytes per pixel, which the handler
forwards to the LZ4 decoder along with the parsed dimensions (`decode.rs:49`). The prefix length is
`DECODE_LZ4_PREFIX_LEN = 8` ([`src/protocol/limits.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L19)); a body shorter than that is treated as truncated
(`decode.rs:50`). How each op reaches its decoder is covered on the [decode](/docs/userland/image-codec/decode/) page.

## The decode reply descriptor

A successful decode writes a fixed `DECODE_RESP_LEN = 32` byte descriptor after the 4-byte status word, at
offset `HDR_LEN + STATUS_LEN` ([`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20), [`src/server/handlers/decode.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L37)):

```
  +0   u64  surface handle (from mk_surface_share)   decode.rs:38
  +8   u32  width                                    decode.rs:39
  +12  u32  height                                   decode.rs:40
  +16  u32  stride (width * 4 bytes)                 decode.rs:41
  +20  u32  format tag = 1 (ARGB8888)                decode.rs:42
  +24  u64  byte length (stride * height)            decode.rs:43
```

The caller receives a shareable surface handle plus its geometry, not a copy of the pixels back over IPC.
The format tag is the constant `1` written at `decode.rs:42`. Every error path writes only the 4-byte
status word and no descriptor ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)).

## Size limits

The limits are constants in one file ([`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs)):

- `IPC_PAYLOAD_MAX = 131072` bytes bounds a single request's compressed input at 128 KiB
  (`limits.rs:17`). The receive and transmit buffers are each `HDR_LEN + IPC_PAYLOAD_MAX`
  ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)), so a frame that would exceed the cap cannot fit the receive buffer and is
  bounded at the transport before any decode runs.
- `STATUS_LEN = 4` is the width of the status word (`limits.rs:18`).
- `DECODE_LZ4_PREFIX_LEN = 8` is the LZ4-raw dimension prefix (`limits.rs:19`).
- `DECODE_RESP_LEN = 32` is the decode descriptor width (`limits.rs:20`).

The decode handler additionally caps the output at `MAX_PIXELS = 16384` 32-bit pixels
([`src/server/handlers/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L23)), so an image whose pixel count exceeds that budget fails rather than
allocating an unbounded buffer. That is a handler concern rather than a protocol constant; it is covered on
the [decode](/docs/userland/image-codec/decode/) and [safety](/docs/userland/image-codec/safety/) pages.

## Error codes

Errors are typed `i32` values returned in the status word ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

| Error | Value | Meaning | Where raised |
|-------|-------|---------|--------------|
| `E_INVAL` | `-22` | bad body, or a decoder `BadMagic` | `errno.rs:17`, [`src/server/runner.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L55), [`src/server/handlers/decode.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L57) |
| `E_NOMEM` | `-12` | surface allocation or registration failed | `errno.rs:22`, [`src/server/handlers/surface.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/surface.rs#L34), `surface.rs:51` |
| `E_BAD_OP` | `-38` | unknown opcode with an empty body | `errno.rs:18`, `runner.rs:54` |
| `E_BAD_MAGIC` | `-74` | frame magic is not `GMIN` | `errno.rs:20`, `decode.rs:33` |
| `E_BAD_LEN` | `-90` | short header, declared length mismatch, or a decoder length error | `errno.rs:19`, `decode.rs:26`, `decode.rs:63`, [`src/server/handlers/decode.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L57) |
| `E_BAD_VERSION` | `-93` | header version is not 1 | `errno.rs:21`, `decode.rs:52` |
| `E_UNSUPPORTED` | `-95` | the format is recognised but a feature is not supported | `errno.rs:23`, [`src/server/handlers/decode.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L57) |

Those are all seven codes; the codec defines no others. The toolkit `DecodeError` variants map onto three
of them in one place (`map_decode_error`, [`src/server/handlers/decode.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L56)): `BadMagic` to `E_INVAL`,
`Unsupported` to `E_UNSUPPORTED`, and `BadDimensions`, `OutputTooSmall`, and `Truncated` all to
`E_BAD_LEN`. The `DecodeError` enum lives at [`userland/toolkit/src/image/types.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/types.rs#L1).

## Source map

This page is drawn from `userland/capsule_image_codec/src/protocol/` (`header.rs`, `decode.rs`,
`encode.rs`, `ops.rs`, `errno.rs`, `limits.rs`, `mod.rs`), the dispatch and handlers under
`src/server/` that raise these codes, and the `DecodeError` enum at [`userland/toolkit/src/image/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/image/types.rs).
Every reference above is verified against those trees.
