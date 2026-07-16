---
title: "Protocol and Catalog"
description: "This page covers the request protocol the catalog speaks and the catalog structure it serves from."
weight: 2
---
This page covers the request protocol the catalog speaks and the catalog structure it serves from. It
mirrors three folders: `src/server/` (the receive loop, the handlers, and reply framing), `src/protocol/`
(the wire header, op codes, errnos, and limits), and `src/catalog/` (the four embedded image groups and
the accessors over them). For identity and capabilities see the [README](/docs/userland/wallpaper-catalog/); for how to add an
image see the [contributing](/docs/userland/wallpaper-catalog/contributing/) page; for runtime failures see the
[debugging](/docs/userland/wallpaper-catalog/debugging/) page.

## The wire header

Every request and every reply begins with a fixed 16-byte header (`HDR_LEN`, [`src/protocol/hdr.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/hdr.rs#L17)).
There is no magic number and no version field; the header is the compact catalog form. It is five
little-endian fields in this order ([`src/protocol/hdr.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/hdr.rs#L29), [`src/protocol/hdr.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/hdr.rs#L37)):

```
  op          u16   operation code
  status      u16   E_OK on a reply, an errno on failure
  index       u32   wallpaper index for size, chunk, and slug
  offset      u32   byte offset into the image for a chunk
  payload_len u32   number of body bytes that follow the header
```

`Header::decode` returns `None` if the buffer is shorter than 16 bytes (`hdr.rs:38`), and `Header::encode`
lays the five fields back out little-endian (`hdr.rs:29`).

## The receive loop

`run` ([`src/server/runner.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L24)) allocates one stack buffer of `IPC_PAYLOAD_MAX` bytes and loops. Each
pass:

- `recv::poll` ([`src/server/recv.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/recv.rs#L21)) calls `mk_ipc_recv_from` with a zero flag, so the receive is
  non-blocking. If it returns nothing, the loop yields with `mk_yield` and retries
  ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)).
- A message shorter than the 16-byte header is dropped silently ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)).
- `Header::decode` parses the header, and a decode failure continues the loop ([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)).
- The `op` field selects a handler ([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)). Anything unrecognized is answered with
  `E_INVAL` ([`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45)).

The loop is poll-yield, not a blocking wait. A caller cannot pin the server on a slow receive because the
poll returns immediately; the only cost of a flood is repeated small replies, each bounded to at most
`IPC_PAYLOAD_MAX` bytes.

## The operations

Four operation codes ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)):

```
  OP_GET_COUNT = 0x0001
  OP_GET_SIZE  = 0x0002
  OP_GET_CHUNK = 0x0003
  OP_GET_SLUG  = 0x0004
```

| Operation | Input | Reply body |
|---|---|---|
| `OP_GET_COUNT` | none | image count as a little-endian `u32` |
| `OP_GET_SIZE` | `index` | image byte length as a little-endian `u32` |
| `OP_GET_SLUG` | `index` | the image's slug bytes, no terminator |
| `OP_GET_CHUNK` | `index`, `offset` | up to 4096 bytes of the image starting at `offset` |

`OP_GET_COUNT` ([`src/server/handlers/op_get_count.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/op_get_count.rs#L22)) always replies with the total catalog count in
`index = 0`, `offset = 0`, and a four-byte body.

`OP_GET_SIZE` ([`src/server/handlers/op_get_size.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/op_get_size.rs#L22)) looks up the image bytes and returns their length;
a missing index replies `E_NOT_FOUND`. The size is derived, not stored: `get_size` is
`get_bytes(index).map(len)` ([`src/catalog/get_size.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/get_size.rs#L19)).

`OP_GET_SLUG` ([`src/server/handlers/op_get_slug.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/op_get_slug.rs#L22)) returns the slug bytes for the index, or
`E_NOT_FOUND`.

`OP_GET_CHUNK` ([`src/server/handlers/op_get_chunk.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/op_get_chunk.rs#L22)) is the streaming path. It fetches the image
bytes, then:

- a missing index replies `E_NOT_FOUND` (`op_get_chunk.rs:25`);
- an `offset` strictly greater than the image length replies `E_RANGE` (`op_get_chunk.rs:28`); note that
  `offset == len` is allowed and returns an empty slice, which is how a client detects end-of-image;
- otherwise it returns `min(offset + CHUNK_MAX, len) - offset` bytes, at most 4096
  (`op_get_chunk.rs:31`).

That is why a client fetches a large image incrementally: call `OP_GET_SIZE` once, then loop
`OP_GET_CHUNK` advancing `offset` by the returned `payload_len` until it reaches the size. The wallpaper
client's `fetch_image` ([`userland/capsule_wallpaper/src/catalog_client/fetch_image.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/catalog_client/fetch_image.rs#L26)) does exactly
this, capping any single image at 2,000,000 bytes (`fetch_image.rs:23`) and bounding the loop with a
chunk count.

## Reply framing

Success replies go through `respond::ok` ([`src/server/respond/ok.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/ok.rs#L24)). It rejects a payload larger than
`IPC_PAYLOAD_MAX - HDR_LEN` with `E_BAD_LEN` (`ok.rs:25`), then encodes the header with `status = E_OK`
and the true `payload_len`, copies the body in behind the header, and sends only the used prefix through
`reply::send` ([`src/server/reply.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/reply.rs#L19), which calls `mk_ipc_reply`).

Error replies go through `respond::err` ([`src/server/respond/err.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/err.rs#L21)). An error frame echoes the
original `op` and `index`, sets `offset = 0` and `payload_len = 0`, and carries only the 16-byte header.

## The errno set

The errnos are five constants ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_OK        = 0
  E_INVAL     = 22   unknown operation
  E_BAD_LEN   = 90   reply payload would exceed the buffer
  E_NOT_FOUND = 91   index has no image
  E_RANGE     = 93   chunk offset past the end of the image
```

One thing to know when reading the source tree. The capsule's own `README.md` names an `E_BAD_OP` code
for unknown operations (`userland/capsule_wallpaper_catalog/README.md:38`); that name does not exist in
`errno.rs`. The code returns `E_INVAL` (22) for an unknown op ([`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45)) and does not
decode a separate body-length error, so there is no `E_INVAL`-versus-`E_BAD_OP` distinction in practice.
Trust `errno.rs`, not the source README.

## The limits

Two constants set the sizes ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)):

```
  CHUNK_MAX        = 4096          the most image bytes a chunk carries
  IPC_PAYLOAD_MAX  = 4096 + 32     the receive and reply buffer size
```

The 32-byte slack over `CHUNK_MAX` covers the 16-byte header with room to spare, so a full 4096-byte
chunk plus its header fits in one buffer.

## The catalog

The catalog is not loaded at runtime. It is four static slices of `Entry`, and `Entry` is just a slug and
a byte slice ([`src/catalog/entry.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entry.rs#L17)), each byte slice an `include_bytes!` of a JPEG under
`nonos-data/wallpapers/`. The four groups are concatenated in this order ([`src/catalog/entries/groups.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/groups.rs#L23)):

| Group | Const | Entries | Slug range | Source |
|---|---|---|---|---|
| Field focus | `FIELD_FOCUS` | 13 | `field-focus-1` .. `field-focus-13` | [`src/catalog/entries/field_focus.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/field_focus.rs#L19) |
| Hardware aesthetic | `HARDWARE_AESTHETIC` | 14 | `hardware-aesthetic-1` .. `hardware-aesthetic-14` | [`src/catalog/entries/hardware_aesthetic.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/hardware_aesthetic.rs#L19) |
| Network topology | `NETWORK_TOPOLOGY` | 18 | `network-topology-1` .. `-19`, skipping 12 | [`src/catalog/entries/network_topology.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/network_topology.rs#L19) |
| Special variant | `SPECIAL_VARIANT` | 17 | `-1a`, `-1b`, `-2a`, `-2b`, `-3` .. `-15` | [`src/catalog/entries/special_variant.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/special_variant.rs#L19) |

That is 62 served images (13 + 14 + 18 + 17).

Two details make the file-on-disk count differ from the served count. The `network-topology` group has no
`network-topology-12` entry: it jumps from 11 to 13 (`network_topology.rs:30`, `network_topology.rs:31`),
so eighteen slugs span the numbers 1 through 19. And the `special-variant-6` slug embeds
`special-variant-6-1080p.jpg`, not `special-variant-6.jpg` (`special_variant.rs:27`); the plain
`special-variant-6.jpg` file exists in `nonos-data/wallpapers/` but is not referenced by any entry. There
are 63 JPEGs on disk and 62 in the catalog. The `Capsule.mk` comment that says "63 Full-HD wallpaper
JPEGs" (`Capsule.mk:2`) counts disk files, not served entries.

## Indexing across the groups

Indexing is flat across the four groups. `entry_at`, re-exported as `entry_by_index`
([`src/catalog/entries/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/mod.rs#L24)), walks the groups in order, subtracting each group's length until the
remaining index lands inside a group ([`src/catalog/entries/entry_at.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/entry_at.rs#L20)), so index 0 is
`field-focus-1`, index 13 is `hardware-aesthetic-1`, and so on. `get_slug` and `get_bytes` both resolve
through `entry_by_index` ([`src/catalog/get_slug.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/get_slug.rs#L19), [`src/catalog/get_bytes.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/get_bytes.rs#L19)); `get_size` is
`get_bytes` composed with `len` ([`src/catalog/get_size.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/get_size.rs#L19)). `count` is the saturating sum of the group
lengths and is the only accessor that walks `ENTRY_GROUPS` directly ([`src/catalog/count.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/count.rs#L19)). All of
them are recomputed on every call; there is no cached total.

## Source map

```
  userland/capsule_wallpaper_catalog/src/protocol/hdr.rs           the 16-byte header, encode and decode
  userland/capsule_wallpaper_catalog/src/protocol/ops.rs           the four op codes
  userland/capsule_wallpaper_catalog/src/protocol/errno.rs         the errno constants
  userland/capsule_wallpaper_catalog/src/protocol/limits.rs        CHUNK_MAX and IPC_PAYLOAD_MAX
  userland/capsule_wallpaper_catalog/src/server/runner.rs          poll/decode/dispatch loop
  userland/capsule_wallpaper_catalog/src/server/recv.rs            non-blocking receive
  userland/capsule_wallpaper_catalog/src/server/reply.rs           mk_ipc_reply wrapper
  userland/capsule_wallpaper_catalog/src/server/handlers/          count, size, slug, chunk
  userland/capsule_wallpaper_catalog/src/server/respond/           ok and err framing
  userland/capsule_wallpaper_catalog/src/catalog/                  count/size/slug/bytes accessors
  userland/capsule_wallpaper_catalog/src/catalog/entries/          the four embedded groups and entry_at
  userland/capsule_wallpaper_catalog/README.md                     the source README with the E_BAD_OP slip
  userland/capsule_wallpaper/src/catalog_client/fetch_image.rs     the client that streams images
```

Every reference above is verified against those trees.
