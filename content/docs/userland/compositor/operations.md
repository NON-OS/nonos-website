---
title: "Operations and the wire"
description: "This page mirrors src/protocol/ and src/server/: the NCMP frame the compositor speaks with its clients, the batch drain that pulls requests off the inbox, the dispatch that rout..."
weight: 3
---
This page mirrors `src/protocol/` and `src/server/`: the `NCMP` frame the compositor speaks with its
clients, the batch drain that pulls requests off the inbox, the dispatch that routes them, and every one of
the eight handlers. For what a handler mutates once it runs, see [scene-and-damage.md](/docs/userland/compositor/scene-and-damage/)
and [cursor-and-input.md](/docs/userland/compositor/cursor-and-input/). Back to the [README](/docs/userland/compositor/).

## The NCMP frame

The inbound frame is `NCMP` ([`src/protocol/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L20)): magic `0x4E43_4D50` ("NCMP"), version 1, and a
20-byte header (`HDR_LEN`, `header.rs:22`) laid out as `magic (u32), version (u16), op (u16), flags (u16),
reserved (u16), request_id (u32), payload_len (u32)`. The payload that follows is capped at
`IPC_PAYLOAD_MAX = 256` bytes ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)).

`parse` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)) is strict. It reads the header fields first so it can build a
`Request` to attach to an error, then rejects:

- a buffer shorter than the header, or any field it cannot read, with `E_BAD_LEN` (`decode.rs:20`);
- a wrong magic with `E_BAD_MAGIC` (`decode.rs:39`);
- a wrong version with `E_BAD_VERSION` (`decode.rs:45`);
- a `payload_len` that does not make `HDR_LEN + payload_len` equal the received length exactly, with
  `E_BAD_LEN` (`decode.rs:51`).

On success it returns the `Request` and a slice of exactly the payload bytes (`decode.rs:55`). There is no
path that reads past the buffer: the payload slice is `&buf[HDR_LEN..end]` where `end == buf.len()`.

The reply reuses the request's op, flags, and request_id and carries a signed little-endian status word.
`response_header` writes the 20-byte header with the reserved field zeroed ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19));
`write_status` places the `i32` status right after it (`encode.rs:29`). `respond::status` sends header plus
status; `respond::status_payload` appends a data block after the status ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21), `:32`).
Both fail closed: a negative return from `mk_ipc_reply` becomes `Err("ipc reply send failed")`
(`respond.rs:46`).

Error codes are defined once ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

| Code | Value | Meaning |
|------|-------|---------|
| `E_INVAL` | `-22` | malformed payload, bad geometry, or a full table |
| `E_BAD_OP` | `-38` | unknown opcode with an empty body |
| `E_BAD_MAGIC` | `-71` | header magic is not `NCMP` |
| `E_BAD_LEN` | `-90` | short buffer or a payload_len that does not match |
| `E_BAD_VERSION` | `-93` | header version is not 1 |

## The batch drain

The inbox is drained in batches ([`src/server/runner/drain.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/drain.rs#L28)). For up to `MAX_BATCH = 16` iterations
(`drain.rs:26`), `drain_ipc` calls `mk_ipc_recv_from` on the service inbox with `RECV_NOWAIT`, so an empty
inbox returns immediately rather than blocking the frame (`drain.rs:25`, `:31`). It stops the batch as soon
as a receive returns nothing or a zero sender pid (`drain.rs:38`). A parse error is answered with a status
reply and the batch continues; a dispatch that fails to send its reply ends the batch (`drain.rs:44`,
`:48`). Capping the batch at 16 keeps a burst of scene submissions from starving the frame.

## Dispatch

`dispatch` ([`src/server/runner/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L24)) matches on `req.op`. Three ops that take no payload
(`HEALTHCHECK`, `INPUT_SUBSCRIBE`, `DISPLAY_INFO`) are gated on `body.is_empty()` in the match arm itself
(`dispatch.rs:32`, `:38`, `:41`); the payload-carrying ops route to their handler, which checks its own
length first. An unknown op with an empty body is `E_BAD_OP`; anything else that falls through is `E_INVAL`
(`dispatch.rs:44`, `:45`).

## The operations

The compositor exposes eight operations ([`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs)). Each request is the 20-byte header plus a
fixed-size payload; the reply is the header plus a four-byte status, and `DISPLAY_INFO` adds a 16-byte data
block. Request lengths come from [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs).

| Op | Code | Request payload | Handler | What it does |
|----|------|-----------------|---------|--------------|
| `HEALTHCHECK` | `0x0001` | empty | [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) | reply status 0, liveness probe |
| `SCENE_SUBMIT` | `0x0002` | 32 B | [`handlers/scene_submit.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/scene_submit.rs#L21) | register or replace the caller's layer, damage its rect |
| `DAMAGE_COMMIT` | `0x0003` | 16 B | [`handlers/damage_commit.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/damage_commit.rs#L21) | expand the damage box by a rectangle |
| `FOCUS_SET` | `0x0004` | 8 B | [`handlers/focus_set.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/focus_set.rs#L21) | record which pid holds keyboard focus |
| `INPUT_SUBSCRIBE` | `0x0005` | empty | [`handlers/input_subscribe.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/input_subscribe.rs#L21) | mark the caller focused |
| `CURSOR_UPDATE` | `0x0006` | 16 B | [`handlers/cursor_update.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/cursor_update.rs#L22) | move or hide the cursor, damage old and new cells |
| `SCENE_REMOVE` | `0x0007` | 8 B | [`handlers/scene_remove.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/scene_remove.rs#L21) | drop the caller's layers and forget their surfaces |
| `DISPLAY_INFO` | `0x0008` | empty | [`handlers/display_info.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/display_info.rs#L23) | return width, height, stride, pixel format |

Opcodes are the `OP_*` constants in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) through `:24`.

### SCENE_SUBMIT (0x0002)

The 32-byte payload is `surface_handle (u64)`, then `x, y, width, height, z` as five `u32`
(`scene_submit.rs:31` through `:47`; `SCENE_SUBMIT_REQ_LEN = 32`, `limits.rs:19`). The handler validates
`width > 0`, `height > 0`, and that `x + width` and `y + height` fit inside the display, rejecting with
`E_INVAL` otherwise using saturating adds (`scene_submit.rs:49`). On success it builds a `Layer` owned by
the sender pid and calls `SceneTable::submit`, which replaces the sender's existing layer if it has one or
takes a free slot, then accumulates the layer rectangle as damage (`scene_submit.rs:56`, `:70`). A submit
past the 32-slot table returns `E_INVAL` ([`state/scene/submit.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/scene/submit.rs#L28), surfaced at `scene_submit.rs:67`).

### DAMAGE_COMMIT (0x0003)

The 16-byte payload is `x, y, width, height` as four `u32` (`damage_commit.rs:31`;
`DAMAGE_COMMIT_REQ_LEN = 16`, `limits.rs:20`). After the same in-display validation
(`damage_commit.rs:43`) it merges the rectangle into the damage box (`damage_commit.rs:50`). This is how a
client that has already submitted a layer asks for a repaint of a sub-region without resubmitting.

### FOCUS_SET (0x0004)

The 8-byte payload's first `u32` is the target pid (`focus_set.rs:31`; `FOCUS_SET_REQ_LEN = 8`,
`limits.rs:21`). It stores that pid in the focus table and replies status 0 (`focus_set.rs:34`). The pid is
recorded but v1 does not yet use it to highlight the focused window
([cursor-and-input.md](/docs/userland/compositor/cursor-and-input/)).

### INPUT_SUBSCRIBE (0x0005)

Empty body. It marks the sender itself focused and replies status 0 (`input_subscribe.rs:27`). v1 does not
fan input out through the compositor; the [input router](/docs/userland/input-router/) does the fan-out. See
[cursor-and-input.md](/docs/userland/compositor/cursor-and-input/).

### CURSOR_UPDATE (0x0006)

The 16-byte payload is `x, y, visible` as three `u32`, `visible` non-zero meaning shown
(`cursor_update.rs:32`; `CURSOR_UPDATE_REQ_LEN = 16`, `limits.rs:22`). If the position is off-screen it is
dropped (`cursor_update.rs:42`). Otherwise it updates the cursor tracker and damages both the previous
cursor cell (if it was visible) and the new one, each a `CURSOR_SIDE = 32` box clipped to the screen
(`cursor_update.rs:45` through `:55`). This handler does not send a status reply; it returns `Ok` so the
drain moves on (`cursor_update.rs:30`).

### SCENE_REMOVE (0x0007)

The 8-byte payload is present but the handler acts on the sender pid, not the body
(`SCENE_REMOVE_REQ_LEN = 8`, `limits.rs:23`). A zero sender pid is `E_INVAL` (`scene_remove.rs:31`). It
collects the caller's surface handles, drops the caller's layers and accumulates their union rectangle as
damage, then releases each surface from the attach cache; a release failure is `E_INVAL`
(`scene_remove.rs:37`, `:43`, `:46`). Only the caller's own layers are touched.

### DISPLAY_INFO (0x0008)

Empty body. It returns a 16-byte data block, `width, height, stride, SURFACE_FORMAT_ARGB8888` as four
`u32`, after the status word (`display_info.rs:29`; `DISPLAY_INFO_RESP_LEN = STATUS_LEN + 16`,
`limits.rs:25`). This is how a client learns the display geometry before submitting a layer.

### HEALTHCHECK (0x0001)

Empty body, status 0 reply (`health.rs:20`). A liveness probe with no side effects.

## Length discipline

Every payload-carrying handler re-checks its own request length before touching the body
(`scene_submit.rs:28`, `damage_commit.rs:28`, `focus_set.rs:28`, `cursor_update.rs:29`,
`scene_remove.rs:28`), and every field read goes through `u32_at` / `u64_at`, which return `None` on a
short slice rather than indexing out of bounds ([`src/server/handlers/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L26)). A short or malformed frame
is a status error, never a read past the buffer.
</content>
