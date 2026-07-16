---
title: "Operations and protocol"
description: "This page mirrors src/protocol/ and src/server/: the NWMP wire, the fourteen opcodes, the run loop and dispatch, and what each verb does."
weight: 1
---
This page mirrors `src/protocol/` and `src/server/`: the `NWMP` wire, the fourteen opcodes, the run loop
and dispatch, and what each verb does. For the placement and focus mechanics a handler calls into, read
[layout.md](/docs/userland/wm/layout/); for the window table and subscriber list it mutates, read [state.md](/docs/userland/wm/state/);
for the outbound compositor calls, read [clients.md](/docs/userland/wm/clients/). Identity and the capability mask live on
the [README](/docs/userland/wm/).

## The wire

The request frame is `NWMP` (magic `0x4E57_4D50`, version 1): a 20-byte header (magic, version, op, flags,
request id, payload length) followed by a payload capped at 256 bytes ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17),
[`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)). `parse` rejects any frame whose declared payload length does not match the
buffer ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)). Replies reuse the request's op, flags, and request id and carry a
4-byte status followed by any payload ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19), [`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)).

Two replies carry more than a status word: `OP_WINDOW_OPEN` returns a 16-byte rect
([`src/server/respond_window_opened.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond_window_opened.rs#L22)), `OP_QUERY_TOPMOST` returns a 32-byte hit descriptor
([`src/server/handlers/query_topmost.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/query_topmost.rs#L49)), and `OP_QUERY_FOCUS` returns an 8-byte
`(owner_pid, window_id)` ([`src/server/handlers/query_focus.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/query_focus.rs#L32)).

Outbound lifecycle notifications use a separate `NWMV` envelope (magic `0x4E57_4D56`, version 1) so a
subscriber cannot accidentally reply over the request channel; the body carries the event kind (0 opened,
1 closed), owner pid, window id, and the window's x and y ([`src/protocol/notify.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/notify.rs#L21)).

## The run loop and dispatch

`server::run` allocates a receive and a transmit buffer, then loops ([`src/server/runner/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L28)). Each
iteration bumps a tick counter and, every fourth tick, runs the dead sweep; it then blocks on the service
inbox with a 250 ms receive timeout, drops empty or unsourced frames, parses the frame, and dispatches on
the opcode ([`src/server/runner/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L32), [`src/server/runner/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/constants.rs#L17)).

`dispatch` is a single match on `req.op` ([`src/server/runner/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L33)). The three bodyless verbs
(`OP_HEALTHCHECK`, `OP_QUERY_FOCUS`, `OP_LIFECYCLE_SUBSCRIBE`) are matched only when the body is empty; an
opcode the match does not recognise replies `E_BAD_OP` (-38) when its body is empty and `E_INVAL` (-22)
otherwise ([`src/server/runner/dispatch.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L52)). The error codes are defined in [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17).

## The fourteen opcodes

Defined in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17); the body lengths are the `WINDOW_*_REQ_LEN` constants in
[`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21), and each verb handler checks its exact length first and replies `E_INVAL` on
a mismatch.

| Op | Code | Body length | Handler |
|---|---|---|---|
| `OP_HEALTHCHECK` | 0x01 | 0 | [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_WINDOW_OPEN` | 0x02 | 24 | [`handlers/window_open/handle.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_open/handle.rs#L26) |
| `OP_WINDOW_CLOSE` | 0x03 | 8 | [`handlers/window_close.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_close.rs#L22) |
| `OP_WINDOW_MOVE` | 0x04 | 16 | [`handlers/window_move.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_move.rs#L22) |
| `OP_WINDOW_RESIZE` | 0x05 | 16 | [`handlers/window_resize/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_resize/handle.rs#L24) |
| `OP_WINDOW_FOCUS` | 0x06 | 8 | [`handlers/window_focus.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_focus.rs#L22) |
| `OP_WINDOW_RAISE` | 0x07 | 8 | [`handlers/window_raise.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_raise.rs#L21) |
| `OP_LIFECYCLE_SUBSCRIBE` | 0x08 | 0 | [`handlers/lifecycle_subscribe.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/lifecycle_subscribe.rs#L21) |
| `OP_WINDOW_MINIMIZE` | 0x09 | 8 | [`handlers/window_minimize.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_minimize.rs#L23) |
| `OP_WINDOW_RESTORE` | 0x0A | 8 | [`handlers/window_restore.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_restore.rs#L22) |
| `OP_QUERY_TOPMOST` | 0x0B | 8 | [`handlers/query_topmost.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/query_topmost.rs#L27) |
| `OP_ROUTE_FOCUS` | 0x0C | 8 | [`handlers/route_focus/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/route_focus/handle.rs#L24) |
| `OP_QUERY_FOCUS` | 0x0D | 0 | [`handlers/query_focus.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/query_focus.rs#L24) |
| `OP_WINDOW_MAXIMIZE` | 0x0E | 24 | [`handlers/window_maximize.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/window_maximize.rs#L22) |

## Opening a window

`OP_WINDOW_OPEN` places the window and wires it into focus and the subscribers
([`src/server/handlers/window_open/handle.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/window_open/handle.rs#L26)):

```
  window_open(ctx, sender_pid, req):
      decode (window_id, kind, requested_rect)   // 24-byte body, clamped to display
      if the window already exists for this pid:
          refocus if Normal, reply the current rect (idempotent)
      rect = place(ctx, kind, requested)          // clamp, then collide-and-step
      z    = z.allocate()                          // next monotonic z
      insert Window { owner_pid, window_id, rect, kind, Visible, z }
      if kind == Normal: focus_new_window(...)     // set focus + push FOCUS_SET
      notify_fanout(OPENED, ...)                   // tell subscribers
      reply (status, rect)                         // 16-byte rect reply
```

The reply carries the rect the wm actually chose, which may differ from the requested one after clamping
and collision avoidance ([`src/server/respond_window_opened.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond_window_opened.rs#L22)). A repeat open of an existing
`(pid, window_id)` is idempotent: it returns the current rectangle and, for a normal window, re-asserts
focus ([`window_open/handle.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/handle.rs#L32)). If the table is full the insert fails and the reply is `E_NOMEM`
([`window_open/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_open/handle.rs#L51)). The placement policy itself lives in [layout.md](/docs/userland/wm/layout/).

## Focus, raise, and z-order

- `OP_WINDOW_FOCUS` focuses one of the sender's own windows if its kind is focusable, pushing `FOCUS_SET`
  to the compositor and updating the focus model; a non-focusable kind is refused with `E_PERM`
  (`window_focus.rs:41`), and an unchanged focus is a no-op that still replies success (`window_focus.rs:47`).
- `OP_WINDOW_RAISE` stamps the window with the next monotonic z so it draws on top, without changing focus
  (`window_raise.rs:30`).
- `OP_ROUTE_FOCUS` is the privileged focus path. It is refused with `E_PERM` unless the sender is the live
  `input_router` service, resolved by name and cached ([`route_focus/handle.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route_focus/handle.rs#L25),
  [`route_focus/is_input_router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route_focus/is_input_router.rs#L34)). Given `(owner_pid, window_id)` for any capsule it focuses a
  focusable window and pushes `FOCUS_SET`. This is what turns a pointer click into a focus change. The gate
  is covered in [clients.md](/docs/userland/wm/clients/).

## Visibility

- `OP_WINDOW_MINIMIZE` hides the window; if it was the focused window the wm first clears focus and pushes
  `FOCUS_SET(0)` so the compositor drops the focus styling (`window_minimize.rs:36`).
- `OP_WINDOW_RESTORE` marks the window visible again and stamps it with a fresh z, but does not on its own
  re-take focus (`window_restore.rs:36`).
- `OP_WINDOW_MAXIMIZE` sets the window to the caller-supplied rect (clamped to display) and raises it; its
  24-byte body carries the target rect, so the caller, not the wm, decides the maximized geometry
  (`window_maximize.rs:41`).

## Geometry

- `OP_WINDOW_MOVE` re-origins the window, keeping its size, clamped to the display (`window_move.rs:45`).
- `OP_WINDOW_RESIZE` changes width and height at the current origin; for a normal window it rejects a size
  that would overlap another visible normal window with `E_INVAL`, so a resize cannot be used to force a
  collision ([`window_resize/handle.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_resize/handle.rs#L51), [`window_resize/collides.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/window_resize/collides.rs#L20)).

## Queries and closing

- `OP_QUERY_TOPMOST` hit-tests a point and returns the topmost visible focusable window containing it,
  packing owner pid, window id, the point in the window's local coordinates, and the window rectangle
  (`query_topmost.rs:40`). The hit test lives in [layout.md](/docs/userland/wm/layout/).
- `OP_QUERY_FOCUS` returns the currently focused `(owner_pid, window_id)`, or zeros when nothing is
  focused (`query_focus.rs:24`).
- `OP_WINDOW_CLOSE` clears the focus model and pushes `FOCUS_SET(0)` if the window held focus, removes the
  window, then broadcasts a `CLOSED` notification to the subscribers (`window_close.rs:41`,
  `window_close.rs:64`).
- `OP_LIFECYCLE_SUBSCRIBE` records the sender in the 16-entry subscriber list; a full list replies
  `E_NOMEM` (`lifecycle_subscribe.rs:21`). `OP_HEALTHCHECK` replies status 0 (`health.rs:20`).

## Reply and notification encoders

Replies go out through `respond::status` for the status-only path, `respond_window_opened::window_opened`
for the open rect, and the dedicated encoders in the query handlers ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21),
[`src/server/respond_window_opened.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond_window_opened.rs#L22)). Lifecycle notifications are fire-and-forget sends to each
subscriber pid; a send that fails marks the pid stale and it is dropped from the list
([`src/server/notify_fanout.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/notify_fanout.rs#L22)).

## Source map

```
  userland/capsule_wm/src/protocol/decode.rs           parse: validate NWMP frame, split header/body
  userland/capsule_wm/src/protocol/encode.rs           response_header, write_status
  userland/capsule_wm/src/protocol/header.rs           magic 0x4E574D50, version 1, 20-byte header
  userland/capsule_wm/src/protocol/limits.rs           the WINDOW_*_REQ_LEN body lengths
  userland/capsule_wm/src/protocol/errno.rs            E_INVAL, E_PERM, E_NOENT, E_NOMEM, E_BAD_OP
  userland/capsule_wm/src/protocol/ops.rs              the fourteen opcodes
  userland/capsule_wm/src/protocol/notify.rs           NWMV notify envelope, OPENED/CLOSED kinds
  userland/capsule_wm/src/server/runner/run.rs         the receive loop and sweep cadence
  userland/capsule_wm/src/server/runner/dispatch.rs    the opcode match
  userland/capsule_wm/src/server/runner/constants.rs   inbox 0, 250 ms timeout, sweep every 4 ticks
  userland/capsule_wm/src/server/handlers/             one file per op (window_open/ is multi-step)
  userland/capsule_wm/src/server/respond.rs            status-only reply
  userland/capsule_wm/src/server/respond_window_opened.rs  the 16-byte open rect reply
  userland/capsule_wm/src/server/notify_fanout.rs      best-effort broadcast, stale-pid drop
```

Every reference above is verified against those trees.
</content>
