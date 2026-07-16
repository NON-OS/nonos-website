---
title: "Compositor client, setup, and the input-router gate"
description: "This page mirrors src/compositorclient/, src/setup/, src/waitforsetup.rs, and the input-router gate under src/server/handlers/routefocus/: the two outbound calls the wm makes an..."
weight: 3
---
This page mirrors `src/compositor_client/`, `src/setup/`, [`src/wait_for_setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs), and the input-router
gate under `src/server/handlers/route_focus/`: the two outbound calls the wm makes and the two registry
lookups it depends on. The operations that trigger these calls are in [operations.md](/docs/userland/wm/operations/); the
focus state they push is in [layout.md](/docs/userland/wm/layout/).

## The compositor client

The wm speaks `NCMP` to the compositor: magic `0x4E43_4D50`, version 1, a 20-byte header
([`src/compositor_client/wire.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L10)). `build_request` frames a little-endian header plus payload, and the
two call helpers send and validate the reply ([`src/compositor_client/wire.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L16)). The reply header is
checked for magic, version, op, request id, and payload length before the status word is read, so a
mismatched or short reply is rejected rather than trusted ([`src/compositor_client/wire/reply.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire/reply.rs#L24),
`reply.rs:40`).

Two operations run over that wire:

- Display size. `query_display_info` sends op `0x0008` at setup and reads back the display width and
  height, rejecting a zero dimension, with a 250 ms boot timeout so a slow compositor does not wedge
  bring-up ([`src/compositor_client/display_info.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/display_info.rs#L19), `display_info.rs:27`, [`src/compositor_client/wire.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L14)).
- Focus push. `push_focus_set` sends op `0x0004` with the focused pid (0 to clear) and a 16 ms
  steady-state timeout, returning an error if the compositor rejects it ([`src/compositor_client/focus_set.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/focus_set.rs#L19),
  `focus_set.rs:22`, [`src/compositor_client/wire.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L13)). This is the wm's only influence on pixels: it
  lets the compositor restyle the focused window's chrome.

`probe_compositor` is a lightweight liveness call used once during setup before the display query
([`src/compositor_client/health.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/health.rs), re-exported at [`src/compositor_client/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/mod.rs#L24)).

## Setup and bring-up

`wait_for_setup` loops until `setup::run` returns a `Context`, yielding 64 times between failed attempts so
a not-yet-ready compositor does not spin the CPU ([`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19), [`src/wait_for_setup.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L24)).
`setup::run` resolves the `compositor` service port by name, probes it with request id 1, then reads the
display size with request id 2 ([`src/setup/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L36), [`src/setup/discover.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L21)). The resulting `Context`
starts `next_request_id` at 3 because ids 1 and 2 were spent probing ([`src/setup/run.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L48)); a failure to
resolve the service returns `"compositor service not announced"` and the loop retries
([`src/setup/discover.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L30)).

## The input-router gate

`OP_ROUTE_FOCUS` is the only verb that can focus a window a capsule does not own, which is exactly what
routing a click requires, so it is gated to one caller. The handler refuses with `E_PERM` unless the body
is the right length and the sender is the live `input_router` ([`src/server/handlers/route_focus/handle.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/route_focus/handle.rs#L25)).

The gate resolves `input_router` by name and caches its pid. It only re-resolves when the sender pid
differs from the cached one, then accepts only when the cached pid is non-zero and equals the sender, so a
router that failed to register or a stale cache stops focus routing rather than opening it up
([`src/server/handlers/route_focus/is_input_router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/route_focus/is_input_router.rs#L34), `is_input_router.rs:23`). Once past the gate the
handler validates the two `u32` fields, requires the target window to exist and be focusable, and pushes
`FOCUS_SET` only when focus actually changes ([`route_focus/handle.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route_focus/handle.rs#L43), [`route_focus/handle.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route_focus/handle.rs#L55)).

## Source map

```
  userland/capsule_wm/src/compositor_client/wire.rs            NCMP magic/version, build_request, timeouts
  userland/capsule_wm/src/compositor_client/wire/reply.rs      validate reply header before reading status
  userland/capsule_wm/src/compositor_client/display_info.rs    op 0x0008, read display width/height
  userland/capsule_wm/src/compositor_client/focus_set.rs       op 0x0004, push focused pid (0 to clear)
  userland/capsule_wm/src/compositor_client/health.rs          probe_compositor liveness call
  userland/capsule_wm/src/wait_for_setup.rs                    retry setup, yield between attempts
  userland/capsule_wm/src/setup/run.rs                         resolve, probe, read display, build Context
  userland/capsule_wm/src/setup/discover.rs                    mk_service_lookup for compositor port
  userland/capsule_wm/src/server/handlers/route_focus/handle.rs        the gated focus-routing verb
  userland/capsule_wm/src/server/handlers/route_focus/is_input_router.rs  resolve + cache input_router pid
```

Every reference above is verified against those trees.
</content>
