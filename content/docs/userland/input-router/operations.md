---
title: "Operations and the wire"
description: "This page covers the two wire formats the router speaks and the four operations it serves."
weight: 3
---
This page covers the two wire formats the router speaks and the four operations it serves. It mirrors
`src/protocol/` (the frame layouts and the opcodes) and `src/server/` (the loop's IPC side: the drain, the
handlers, the reply). For the routing that follows a drained event see the [routing engine](/docs/userland/input-router/routing/);
for the tables the handlers mutate see the [state](/docs/userland/input-router/state/) page; for the overview and the capability
identity see the [README](/docs/userland/input-router/).

The router holds no `InputSource` capability. Nothing on this page changes that: the operations here let a
consumer register interest or claim a grab, and the reply path acknowledges the request. None of them can
inject an event into the kernel ring.

## Two wire formats

Inbound requests and outbound deliveries use deliberately different magics so a subscriber can never
mistake a delivery for a reply on its own inbox.

| Frame | Magic | Direction | Layout | Source |
|---|---|---|---|---|
| `NIRS` request | `0x4E49_5253` | consumer to router, and router to reply | 20-byte header, then payload | [`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17) |
| `NINP` delivery | `0x4E49_4E50` | router to subscriber | 8-byte header, then the 32-byte event, 40 bytes total | [`src/protocol/delivery.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/delivery.rs#L23) |

### The NIRS request frame

The request header is magic, version 1, op, flags, a reserved word, a request id, and a declared payload
length, in that order ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17), [`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). `parse` checks the magic
and version, reads the op / flags / request id, and requires the declared payload length to match the
received body exactly, so a truncated or padded body is rejected before dispatch
([`src/protocol/decode.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L32)). A reply reuses the same header with a 4-byte status appended
([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19), [`src/protocol/encode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L29)).

The status values the router returns are `0` for success, `E_INVAL` (-22), `E_ACCES` (-13), and `E_BAD_OP`
(-38) ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)), plus `E_NOMEM` (-12) from subscribe and `E_BUSY` (-16) from grab
request, both defined locally in their handlers ([`src/server/handlers/subscribe.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/subscribe.rs#L21),
[`src/server/handlers/grab_request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L22)).

### The NINP delivery frame

`encode_delivery` writes the 4-byte magic, a 2-byte version (1), two zero bytes, then the 32-byte
`InputEvent` field by field, little-endian, for 40 bytes total ([`src/protocol/delivery.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/delivery.rs#L29)). The frame
size is `HDR_LEN + size_of::<InputEvent>()`, computed from the libc struct so the two stay in lockstep
([`src/protocol/delivery.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/delivery.rs#L25)). This is the envelope every consumer decodes; the desktop shell's inverse
is documented in the [event path](/docs/subsystems/input/path/#delivery-envelope). The delivery path
itself lives with the routing engine ([`src/route/deliver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/deliver.rs)), documented on the [routing](/docs/userland/input-router/routing/)
page.

## The four operations

The router exposes four opcodes on its service inbox ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).

| Op | Opcode | What it does | Handler |
|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | reply `0` to a liveness probe (empty body required) | `ops.rs:17`, [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_SUBSCRIBE` | `0x0002` | record a pid and a kind mask so it receives those event kinds | `ops.rs:18`, [`handlers/subscribe.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/subscribe.rs#L23) |
| `OP_GRAB_REQUEST` | `0x0003` | claim exclusive keyboard or pointer events (trusted callers only) | `ops.rs:19`, [`handlers/grab_request.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/grab_request.rs#L31) |
| `OP_GRAB_RELEASE` | `0x0004` | drop the caller's grabs (empty body required) | `ops.rs:20`, [`handlers/grab_release.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/grab_release.rs#L21) |

## The IPC drain

`drain_ipc` reads each pending request without blocking and dispatches it ([`src/server/drain_ipc.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L28)).
It calls `mk_ipc_recv_from` on the service inbox with `RECV_NOWAIT` in a loop; a return of zero or less, or
a zero sender pid, ends the loop and hands control back to the main loop ([`src/server/drain_ipc.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L38)). A
request that fails `parse` is skipped and the loop continues ([`src/server/drain_ipc.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L41)). The dispatch
then matches on the opcode ([`src/server/drain_ipc.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L44)):

```
  match req.op:
      OP_HEALTHCHECK  if body empty  -> health::handle
      OP_SUBSCRIBE                   -> subscribe::handle
      OP_GRAB_REQUEST                -> grab_request::handle
      OP_GRAB_RELEASE if body empty  -> grab_release::handle
      _ if body empty                -> E_BAD_OP
      _                              -> E_INVAL
```

The two empty-body guards on the match arms are load bearing. `OP_HEALTHCHECK` and `OP_GRAB_RELEASE`
require an empty body, so a probe or a release carrying stray bytes falls through to the wildcard arms: an
unknown opcode with an empty body gets `E_BAD_OP`, and any request with a non-empty body it does not
recognise gets `E_INVAL` ([`src/server/drain_ipc.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L51)).

## The four handlers

Each handler is one file under `src/server/handlers/` and replies through
`respond::status`.

### Health

`health::handle` replies `0` and does nothing else; it is the liveness probe
([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). The empty-body requirement is enforced by the caller's match arm, not
the handler.

### Subscribe

The body is exactly 8 bytes: a `u32` kind mask and a `u32` pad ([`src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L23)). The mask is a
bitset over the `INPUT_KIND_*` values, so bit `n` set means the subscriber wants events whose `kind == n`
([`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20)). The handler validates the length, rejecting anything but 8 bytes with
`E_INVAL`, reads the mask, and `upsert`s it into the subscription table
([`src/server/handlers/subscribe.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/subscribe.rs#L24)). `upsert` updates an existing entry for that pid or claims a free
slot; a mask of `0` removes the entry, and a full table returns `false`, which the handler maps to
`E_NOMEM` ([`src/server/handlers/subscribe.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/subscribe.rs#L32)). The table and its 16-slot cap are on the
[state](/docs/userland/input-router/state/) page.

### Grab request

The body is 8 bytes carrying a `u32` kind mask ([`src/server/handlers/grab_request.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L23)). The handler is
gated first: `is_trusted_grabber` resolves each name in
`GRABBERS = [app.boot_splash, app.setup_wizard, app.input_probe]` to a pid and compares it to the sender,
and a non-match is `E_ACCES` ([`src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L25), `:32`). Only then does it check the
body length (`E_INVAL` on a mismatch) and read the mask; a zero mask is `E_INVAL`
([`src/server/handlers/grab_request.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L44)). The grab table splits the mask into keyboard and pointer
classes and stores each separately; a class already held by a different pid makes `request` return `false`,
which the handler maps to `E_BUSY` ([`src/server/handlers/grab_request.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L48)). The split and the busy check
are on the [state](/docs/userland/input-router/state/) page.

### Grab release

The body must be empty, enforced by the match arm ([`src/server/drain_ipc.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L48)). The handler drops
whichever keyboard and pointer grabs the caller held and replies `0` ([`src/server/handlers/grab_release.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_release.rs#L22)).
It is unconditional and does not check that the caller was ever trusted, because releasing a grab you do not
hold is a no-op: `GrabTable::release` only clears a class whose holder pid matches the caller.

## The reply

Every handler replies through one helper. `respond::status` writes the response header with a 4-byte
payload length, writes the status word after the header, and calls `mk_ipc_reply` to the sender pid
([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). The reply travels on the reply endpoint, port 4321
(`Capsule.mk:13`). The reply frame is `HDR_LEN + STATUS_LEN` bytes, a 20-byte `NIRS` header plus the
4-byte status ([`src/server/respond.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L24), [`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)).

## Source map

```
  src/protocol/header.rs      NIRS magic, version, 20-byte header, Request
  src/protocol/decode.rs      parse: magic/version check, exact payload-length match
  src/protocol/encode.rs      response_header + write_status
  src/protocol/errno.rs       E_INVAL, E_ACCES, E_BAD_OP
  src/protocol/limits.rs      SUBSCRIBE_REQ_LEN, STATUS_LEN, the kind-mask contract
  src/protocol/ops.rs         the four opcodes
  src/protocol/delivery.rs    NINP magic and encode_delivery, the 40-byte frame
  src/protocol/read_u32.rs    the little-endian body reader the handlers use
  src/server/drain_ipc.rs     RECV_NOWAIT loop, parse, opcode dispatch, empty-body guards
  src/server/handlers/health.rs        liveness reply
  src/server/handlers/subscribe.rs     length + mask validation, upsert, E_NOMEM
  src/server/handlers/grab_request.rs  trusted-grabber gate, mask checks, E_BUSY
  src/server/handlers/grab_release.rs  unconditional release
  src/server/respond.rs       status reply on the reply endpoint
  Capsule.mk                  the service and reply endpoints (ports 4320 and 4321)
```

Every reference above is verified against those trees.
</content>
