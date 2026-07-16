---
title: "The service protocol and handlers"
description: "The request/reply face of capsuledriverusbhid is a small tree under src/protocol/ and src/server/."
weight: 4
---
The request/reply face of `capsule_driver_usb_hid` is a small tree under `src/protocol/` and
`src/server/`. `src/protocol/` defines the `NUHI` wire format, the op codes, the size limits, and the
errno set; `src/server/` receives one request per poll iteration, parses it, dispatches by op code,
and writes a reply. This page walks the wire format, the receive-and-dispatch path, and each of the
seven handlers. For the identity and the capability mask see the [README](/docs/userland/driver-usb-hid/); for the live
event stream that does not use these ops see the [input-post path](/docs/userland/driver-usb-hid/input-post/).

## The wire format

A request is a 20-byte `NUHI` header followed by an optional payload
([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)). The header is magic `0x4E55_4849` ("NUHI"), version 1, then the op,
the flags, two pad bytes, a request id, and the payload length
([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17), [`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)).

```
  offset 0   magic     u32   0x4E55_4849 "NUHI"
  offset 4   version   u16   1
  offset 6   op        u16   one of OP_*
  offset 8   flags     u16
  offset 10  pad       u16   zero
  offset 12  request   u32   request id, echoed in the reply
  offset 16  payload   u32   body length; header + this must equal the frame
```

`parse` rejects a frame shorter than the header, a wrong magic, a wrong version, or a payload length
whose sum with the header does not equal the frame length exactly
([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20), [`src/protocol/decode.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L33)). Only a fully consistent frame yields a
`(Request, body)` pair; anything else returns `None` and the receiver drops it.

A reply echoes the request's magic, version, op, flags, and request id with a fresh payload length
([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)), and its body always begins with a 4-byte signed status word
([`src/protocol/encode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L29)). `respond::status` sends just the header and the status;
`respond::payload` sends the header, a zero status, and a body, and is used by the probe, poll, and
state ops ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21), [`src/server/respond.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L27)). Both call `mk_ipc_reply` to the
sender pid ([`src/server/respond.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L24)).

The size limits are fixed constants ([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)): the header is 20 bytes and the
status word 4, a probed config descriptor is at most 512 bytes, the IPC payload buffer is 768 bytes,
a HID binding record on the wire is 8 bytes and at most 8 are returned, a key report is 8 bytes, a
mouse report is 3 to 4 bytes, and a poll returns at most 16 events of 8 bytes each. The errno set is
three values: `E_INVAL` (-22), `E_BAD_OP` (-38), `E_NO_HID` (-61) ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

## Receive and dispatch

The service side is one non-blocking receive per poll iteration. `pump_once` calls
`mk_ipc_recv_from` on the service inbox with a 1 ms timeout, and a timeout, a zero sender, or a frame
that does not parse is simply skipped so the loop keeps draining endpoints
([`src/server/pump_once.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump_once.rs#L26), [`src/server/pump_once.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump_once.rs#L35)). A parsed frame is handed to `dispatch`
with the sender pid, the request, the body, and the shared transmit buffer
([`src/server/pump_once.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump_once.rs#L41)).

`dispatch` matches on the op code ([`src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L22)). The ops that take no input are gated
on an empty body in the match arm itself (`OP_HEALTHCHECK`, `OP_POLL_KEYS`, `OP_POLL_MOUSE`,
`OP_GET_STATE`), so a body on one of those falls through. The two feed ops and the probe op validate
their body length inside the handler. An op that carries an unexpected body lands on the
`_ if body.is_empty()` false case and returns `E_INVAL` (-22); an unknown op with an empty body
returns `E_BAD_OP` (-38) ([`src/server/dispatch.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L30), [`src/server/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L33)).

| Op | Body gate | On bad body |
|---|---|---|
| `OP_HEALTHCHECK` | empty, in the match arm | `E_INVAL` (-22) |
| `OP_PROBE_CONFIG` | `<= 512` bytes, in the handler | `E_INVAL` for oversize or bad header |
| `OP_FEED_KEYBOARD_REPORT` | exactly 8 bytes, in the handler | `E_INVAL` |
| `OP_FEED_MOUSE_REPORT` | 3 to 4 bytes, in the handler | `E_INVAL` |
| `OP_POLL_KEYS` | empty, in the match arm | `E_INVAL` |
| `OP_POLL_MOUSE` | empty, in the match arm | `E_INVAL` |
| `OP_GET_STATE` | empty, in the match arm | `E_INVAL` |
| unknown op | empty | `E_BAD_OP` (-38) |

## The handlers

Each handler is one file under `src/server/handlers/`, declared in
[`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17). None panics; every failure is a signed status word.

### Healthcheck

`OP_HEALTHCHECK` replies with a zero status and no body ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). It is
the liveness probe.

### Probe config

`OP_PROBE_CONFIG` classifies a raw USB configuration descriptor. It rejects a body over 512 bytes with
`E_INVAL`, then runs the same descriptor walk the live enumerator uses, `hid_bindings`
([`src/server/handlers/probe_config.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L25), [`src/server/handlers/probe_config.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L29)). A malformed
descriptor is `E_INVAL`; a well-formed descriptor with no boot HID interface is `E_NO_HID` (-61)
([`src/server/handlers/probe_config.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L32), [`src/server/handlers/probe_config.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L37)). On success it
bumps `configs_probed`, writes the binding count as a `u32`, then one 8-byte record per binding, and
replies with the payload ([`src/server/handlers/probe_config.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L40)). A record is
`kind, interface, endpoint, interval, max_packet(le16), pad` ([`src/descriptors/wire.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/wire.rs#L20)). The walk
is covered on the [enumeration](/docs/userland/driver-usb-hid/enumeration/) page.

### Feed keyboard, feed mouse

`OP_FEED_KEYBOARD_REPORT` requires exactly 8 bytes; it copies the body into a fixed report and runs it
through the same `Keyboard::feed` the endpoint drain uses, bumps `key_reports`, and replies with a zero
status ([`src/server/handlers/feed_key.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/feed_key.rs#L22), [`src/server/handlers/feed_key.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/feed_key.rs#L28)).
`OP_FEED_MOUSE_REPORT` requires 3 to 4 bytes and runs `Mouse::feed` the same way, bumping
`mouse_reports` ([`src/server/handlers/feed_mouse.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/feed_mouse.rs#L22), [`src/server/handlers/feed_mouse.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/feed_mouse.rs#L26)). The
offline feed and the live endpoint drain converge on one parser and one post path, so a fed report
posts into the input ring exactly as a hardware report would.

### Poll keys, poll mouse

`OP_POLL_KEYS` drains up to 16 events from the keyboard's bounded local queue, writes each as an
8-byte record, prefixes the count as a `u32`, and replies with the payload
([`src/server/handlers/poll_keys.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_keys.rs#L24), [`src/server/handlers/poll_keys.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_keys.rs#L30)). A key record is
`scancode, ascii, modifiers, pressed, then four zero bytes` ([`src/hid/key_event.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/key_event.rs#L26)).
`OP_POLL_MOUSE` is the mirror over the mouse queue ([`src/server/handlers/poll_mouse.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_mouse.rs#L24)); a mouse
record is `dx(le16), dy(le16), dz, buttons, flags, pad` ([`src/hid/mouse_event.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse_event.rs#L27)). These queues
are a diagnostic mirror of what was posted; a consumer that wants the live stream reads the input ring
through the router, not these ops.

### Get state

`OP_GET_STATE` returns a 48-byte counter block, in order: the descriptor probe count, the key report
count, the mouse report count (each a `u64`), the keyboard and mouse queue depths (each a `u32`), and
the keyboard and mouse post-failure counts (each a `u64`)
([`src/server/handlers/get_state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_state.rs#L23)). The post-failure counts are the diagnostic signal that a
report parsed but `mk_input_event_post` returned negative; a rising count points at a full ring or a
denied `InputSource` gate, covered on the [debugging](/docs/userland/driver-usb-hid/debugging/) page.

## Source map

```
  src/protocol/header.rs    the NUHI magic, version, 20-byte header, Request
  src/protocol/decode.rs    parse: frame validation and (Request, body) split
  src/protocol/encode.rs    response_header, write_status
  src/protocol/ops.rs       the seven OP_* codes
  src/protocol/errno.rs     E_INVAL, E_BAD_OP, E_NO_HID
  src/protocol/limits.rs    the size limits: descriptor, payload, report, event counts
  src/server/pump_once.rs   one non-blocking mk_ipc_recv_from per loop iteration
  src/server/dispatch.rs    op-code dispatch, empty-body gates, E_INVAL / E_BAD_OP fall-through
  src/server/respond.rs     status and payload replies over mk_ipc_reply
  src/server/handlers/      health, probe_config, feed_*, poll_*, get_state
  src/descriptors/wire.rs   the 8-byte HID binding record layout probe_config returns
  src/hid/key_event.rs      the 8-byte key event record poll_keys returns
  src/hid/mouse_event.rs    the 8-byte mouse event record poll_mouse returns
```

Every reference above is verified against those trees.
