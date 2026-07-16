---
title: "The outbound clients"
description: "The router is the single consumer of the kernel ring, but it cannot decide where an event goes on its own."
weight: 6
---
The router is the single consumer of the kernel ring, but it cannot decide where an event goes on its own.
It asks the window manager who is focused and what is under the cursor, tells the window manager to raise a
clicked window, tells the compositor where to draw the cursor, and reads the pointer sensitivity from the
policy service. This page mirrors `src/clients/`: the three services the router speaks to, the operations
it calls on each, and the shared wire helper underneath them. For the routing that decides which call to
make see the [routing](/docs/userland/input-router/routing/) page; for the tables the answers land in see the [state](/docs/userland/input-router/state/) page;
for the overview and the capability identity see the [README](/docs/userland/input-router/).

Every call on this page is an outbound question. None of them posts an input event; the router holds no
`InputSource` capability and speaks these services over the same `IPC` bit it uses to drain
([README](/docs/userland/input-router/) identity table). A service that does not answer, or answers with the wrong magic or a
short body, is treated as absent, and the port slot is cleared so the next call re-resolves it.

## The shared wire

All three request/reply clients frame the same 20-byte little-endian header and reuse one call path
(`src/clients/wire/`). `build` writes magic, version 1, op, two zero words, the request id, and the payload
length, then the payload ([`src/clients/wire/build.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/build.rs#L21), `HDR_LEN = 20`, `VERSION = 1`,
[`src/clients/wire/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/constants.rs#L17)). `call` sends that frame with `mk_ipc_call_timeout` on a 150 ms budget,
requires the reply to be at least the header plus a 4-byte status plus the expected body and to carry the
same magic, copies the body out, and returns the status word ([`src/clients/wire/call.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/call.rs#L28),
[`src/clients/wire/call.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/call.rs#L47)). A reply that is short or mismatched is an `Err`, which every caller turns
into "no answer".

Two lookup helpers resolve a service by name through `mk_service_lookup`: `lookup_port` returns the port
(rejecting a zero port or pid) and `lookup_pid` returns the pid ([`src/clients/wire/lookup_port.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/lookup_port.rs#L19),
[`src/clients/wire/lookup_pid.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/lookup_pid.rs#L19)). `send_to` frames a request and fires it one-way with
`mk_ipc_send_to_pid`, no reply expected ([`src/clients/wire/send_to.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/send_to.rs#L24)). `u32_at` is the bounds-checked
little-endian field reader every reply decode uses ([`src/clients/wire/u32_at.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wire/u32_at.rs#L17)).

## The window manager client

The router speaks `NWMP` to the `wm` service: magic `0x4E57_4D50`, resolved by the name `wm`
([`src/clients/wm/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/constants.rs#L17), [`src/clients/wm/constants.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/constants.rs#L21)). It makes three calls, each a separate
file, and caches the resolved port in `ctx.wm_port` so only the first call resolves it.

- Focus query. `query_focus` sends `OP_QUERY_FOCUS = 0x000D` with an empty body and reads back the focused
  owner pid, resolving the port on first use and clearing it on a nonzero status; a returned pid of 0 means
  no focus ([`src/clients/wm/query_focus.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/query_focus.rs#L20), [`src/clients/wm/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/constants.rs#L18)). The keyboard path calls
  this on every `KEY_DOWN` ([routing](/docs/userland/input-router/routing/)).
- Hit test. `query_topmost` sends `OP_QUERY_TOPMOST = 0x000B` carrying the cursor `x`/`y` and decodes a
  32-byte `Target`: owner pid, window id, the window-local `local_x`/`local_y`, and the window rect
  `win_x`/`win_y`/`win_w`/`win_h` ([`src/clients/wm/query_topmost.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/query_topmost.rs#L21), [`src/clients/wm/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/types.rs#L17),
  [`src/clients/wm/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/constants.rs#L19)). The pointer path calls this to find the window under a click, touch, or
  wheel, and the local coordinates from the reply are what a window ends up receiving.
- Focus routing. `route_focus` sends `OP_ROUTE_FOCUS = 0x000C` carrying the target's owner pid and window
  id, and returns whether the wm accepted it ([`src/clients/wm/route_focus.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/route_focus.rs#L21),
  [`src/clients/wm/constants.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/wm/constants.rs#L20)). This is the one wm verb gated to the router alone: the wm resolves
  `input_router` by name and refuses any other caller, documented from the wm side in its
  [clients page](/docs/userland/wm/clients/#the-input-router-gate). The router calls it when a `BUTTON_DOWN` or
  `TOUCH` lands on a window, so the click both focuses and raises that window before the event is delivered
  ([routing](/docs/userland/input-router/routing/)).

## The compositor client

The router speaks `NCMP` to the `compositor` service: magic `0x4E43_4D50`, resolved by the name
`compositor` ([`src/clients/compositor/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L17), [`src/clients/compositor/constants.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L20)). It makes
two calls of different shapes.

- Display size. `display_size` sends `OP_DISPLAY_INFO = 0x0008` with an empty body and reads back the
  display width and height, rejecting a zero dimension ([`src/clients/compositor/display_size.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/display_size.rs#L20),
  [`src/clients/compositor/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L19)). `refresh_display` calls it once, the first time a pointer event
  is routed, to configure the cursor bounds to the real screen ([routing](/docs/userland/input-router/routing/), [state](/docs/userland/input-router/state/)).
- Cursor update. `cursor_update` is a one-way send, not a call: it resolves the compositor pid once into a
  static `AtomicU32`, frames `OP_CURSOR_UPDATE = 0x0006` with the cursor `x`/`y` and a visibility flag, and
  fires it with `send_to` ([`src/clients/compositor/cursor_update.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/cursor_update.rs#L24),
  [`src/clients/compositor/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L18)). The loop calls it after routing a batch whenever the cursor
  moved (`ctx.cursor_dirty`), so the compositor redraws the pointer without the router waiting on a reply
  ([`src/server/runner.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L55)).

## The policy read

`mouse_sensitivity` reads one field from the `policy` service ([`src/clients/policy.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L29)). It uses the
policy service's own 12-byte wire, not the shared `NWMP`/`NCMP` header: it resolves `policy` by name into
`ctx.policy_port`, sends `OP_GET = 0x0001` for `FIELD_MOUSE_SENSITIVITY = 0x0102` as a `u8`, and on a
success status returns the single byte ([`src/clients/policy.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L21), [`src/clients/policy.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L43)). The call
has its own 150 ms timeout, and any short or non-`u8` reply clears the port and returns `None`
([`src/clients/policy.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L56)). The loop reads it at most every two seconds and clamps the result into
`1..4` before storing it in the cursor's `mult_x2` ([`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44)), so a missing or misbehaving
policy service simply leaves the previous sensitivity in place.

## How an event reaches a surface

Delivery is not a client on this page: it does not resolve a named service. Every event is delivered
point-to-point to a consumer pid the router already knows (a subscriber pid, a grab holder, a focus target,
or the shell), through `deliver_one` and its `NINP` envelope, documented on the [routing](/docs/userland/input-router/routing/) and
[operations](/docs/userland/input-router/operations/) pages. The clients here only supply the pids and coordinates that decide who
that consumer is. The desktop shell pid itself is resolved once by name (`desktop_shell`) and cached in
`ctx.shell_pid` ([`src/route/pointer/shell_pid.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/shell_pid.rs#L22), [`src/route/pointer/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/constants.rs#L17)); the compositor
cursor pid is cached in the static above; the wm and policy ports are cached on the `Context`. So after the
first event the router makes at most the WM and compositor calls its routing needs, and no repeated service
lookups.

## Source map

```
  src/clients/mod.rs                        the four client modules
  src/clients/wire/build.rs                 the 20-byte NIRS-shaped request header
  src/clients/wire/constants.rs             HDR_LEN = 20, VERSION = 1
  src/clients/wire/call.rs                  mk_ipc_call_timeout, reply validation, status
  src/clients/wire/send_to.rs               one-way mk_ipc_send_to_pid
  src/clients/wire/lookup_port.rs           resolve a service port by name
  src/clients/wire/lookup_pid.rs            resolve a service pid by name
  src/clients/wire/u32_at.rs                bounds-checked little-endian field read
  src/clients/wm/constants.rs               NWMP magic, the three opcodes, service name
  src/clients/wm/query_focus.rs             OP_QUERY_FOCUS, focused owner pid
  src/clients/wm/query_topmost.rs           OP_QUERY_TOPMOST, the 32-byte Target
  src/clients/wm/types.rs                   Target fields
  src/clients/wm/route_focus.rs             OP_ROUTE_FOCUS, the gated raise-and-focus
  src/clients/compositor/constants.rs       NCMP magic, cursor/display opcodes, service name
  src/clients/compositor/display_size.rs    OP_DISPLAY_INFO, one-shot display bounds
  src/clients/compositor/cursor_update.rs   OP_CURSOR_UPDATE, one-way pid send
  src/clients/policy.rs                     policy OP_GET for mouse sensitivity
  src/route/pointer/shell_pid.rs            cached desktop_shell pid
  src/server/runner.rs                      where the cursor push and policy read are driven
```

Every reference above is verified against those trees.
