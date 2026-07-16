---
title: "The Protocol and the Rings"
description: "This page mirrors src/protocol/, src/ring/, and src/mouse/ring.rs."
weight: 4
---
This page mirrors `src/protocol/`, `src/ring/`, and [`src/mouse/ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs). It covers the `NKBD` wire
header, the five ops the driver answers, the exact byte layout of each reply, the fixed kernel reply
endpoint, and the two bounded rings that sit between the decoder and the poll ops with their two opposite
drop disciplines. For where the bytes on these rings come from see the [decode](/docs/userland/driver-ps2-input/decode/) page; for how
the controller is brought up see [bring-up](/docs/userland/driver-ps2-input/bring-up/). This driver is a pure server: it never opens a
client connection to another service.

## The wire header

Every request and every reply begins with a 20-byte header ([`src/protocol/header.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L16)):

```
  offset 0   u32  MAGIC        0x4E4B4244  ("NKBD")
  offset 4   u16  VERSION      1
  offset 6   u16  op
  offset 8   u16  flags
  offset 10  u16  reserved     zero on replies
  offset 12  u32  request_id
  offset 16  u32  payload_len
```

`decode_request` rejects a buffer shorter than 20 bytes, a wrong magic, or a wrong version by returning
`None` ([`src/protocol/decode.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L18)), and the runner answers that failure `E_INVAL` (-22)
([`src/server/runner.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L59), [`src/protocol/errno.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L16)). `encode_response_header` echoes the request's
`op`, `flags`, and `request_id` back, writes zero into the reserved field, and sets the reply's own
`payload_len` ([`src/protocol/encode.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L17)). A reply's payload always opens with a little-endian signed
32-bit status word written by `write_status`; status `0` means the operation completed
([`src/protocol/encode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L26), [`src/protocol/limits.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L16)).

Requests carry no payload. The runner rejects any request whose `payload_len` is non-zero with `E_INVAL`
before it ever dispatches ([`src/server/runner.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L64)), so the five ops are distinguished only by the `op`
field.

## The five ops

The op constants are defined once in [`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16) and dispatched by the match in `run`
([`src/server/runner.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L68)). An unknown op is answered `E_INVAL` by the wildcard arm
([`src/server/runner.rs:74`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L74)).

| Op | Value | What it does | Handler |
|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | reply with status only, for liveness | `ops.rs:16`, [`handlers/health.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L18) |
| `OP_POLL_EVENTS` | `0x0002` | drain the keyboard ring, reply `u32 count` then `count` 3-byte records | `ops.rs:17`, [`handlers/poll.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/poll.rs#L23) |
| `OP_GET_STATE` | `0x0003` | reply seven little-endian `u64` diagnostic counters | `ops.rs:18`, [`handlers/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/state.rs#L22) |
| `OP_CONTROLLER_STATUS` | `0x0004` | reply a 28-byte i8042 status snapshot without consuming a data byte | `ops.rs:19`, [`handlers/controller_status.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/controller_status.rs#L27) |
| `OP_POLL_MOUSE` | `0x0005` | drain the mouse ring, reply `u32 count` then `count` 8-byte records | `ops.rs:20`, [`handlers/mouse.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mouse.rs#L23) |

### Healthcheck

`handlers/health::handle` calls `reply_with_status(tx, req, 0)` and nothing else
([`src/server/handlers/health.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L18)). A live driver replies status 0; a dead one never replies at all.

### Poll events

`OP_POLL_EVENTS` first drains the ports and acknowledges both IRQ lines so the reply reflects the current
controller state, then pops up to `MAX_POLL_EVENTS` (256) keyboard events off the ring
([`src/server/handlers/poll.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll.rs#L24), [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)). Each event is packed as three bytes:
the raw scancode, the event flags, and a reserved zero ([`src/server/handlers/poll.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll.rs#L42),
`EVENT_WIRE_LEN = 3` at `limits.rs:18`). The reply payload is a `u32` count at offset 4 past the status
word (`POLL_PAYLOAD_PREFIX_LEN = STATUS_LEN + 4`, `limits.rs:22`) followed by that many 3-byte records.
The record is the raw make/break scancode plus prefix flags; keyboard-layout policy is not this driver's
job.

### Get state

`OP_GET_STATE` writes seven `u64` counters in a fixed order, straight out of the two rings
([`src/server/handlers/state.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/state.rs#L27)). No drain runs, so the counters are a snapshot.

```
  index 0  ring.events_seen        keyboard bytes pushed to the keyboard ring
  index 1  ring.events_dropped     keyboard events overwritten on a full ring
  index 2  ring.parity_errors      controller parity-bit counts during drain
  index 3  ring.timeout_errors     controller timeout-bit counts during drain
  index 4  mouse_ring.events_seen  mouse packets assembled
  index 5  mouse_ring.events_dropped  mouse events dropped on a full ring
  index 6  mouse_ring.sync_errors  mouse packets refused for a bad sync byte
```

The state payload is `8 * 7 = 56` bytes (`STATE_PAYLOAD_LEN` at `limits.rs:20`). The two ring types own
these counters directly ([`src/ring/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/state.rs#L22), [`src/mouse/ring.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs#L23)).

### Controller status

`OP_CONTROLLER_STATUS` reads only the status port, so it cannot swallow a pending keyboard or mouse byte
the way a data-port read would ([`src/server/handlers/controller_status.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_status.rs#L28)). If that single read
faults it replies `E_IO` (-5) (`controller_status.rs:31`, `errno.rs:17`). Otherwise it packs a 28-byte
snapshot (`CONTROLLER_STATUS_PAYLOAD_LEN = 28` at `limits.rs:21`):

```
  offset 0   u8   raw status byte from port 0x64
  offset 1   u8   output-full bit set          (STATUS_OUTPUT_FULL 0x01)
  offset 2   u8   parity bit set               (STATUS_PARITY 0x80)
  offset 3   u8   timeout bit set              (STATUS_TIMEOUT 0x40)
  offset 4   u32  keyboard ring depth          (ring.queued)
  offset 8   u32  keyboard ring head
  offset 12  u32  keyboard ring tail
  offset 16  u32  current output byte is AUX    (STATUS_AUX_DATA 0x20)
  offset 20  u32  mouse_enabled at setup
  offset 24  u32  mouse ring depth             (mouse_ring.queued)
```

The status-bit constants are in [`src/constants/status.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L16), and the ring depth, head, and tail come
from the ring accessors ([`src/ring/state.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/state.rs#L39)).

### Poll mouse

`OP_POLL_MOUSE` mirrors `OP_POLL_EVENTS`: it drains, acknowledges both IRQ lines, and pops up to 256
events off the mouse ring ([`src/server/handlers/mouse.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mouse.rs#L24)). Each event is packed as eight bytes
(`MOUSE_EVENT_WIRE_LEN = 8` at `limits.rs:19`):

```
  offset 0  i16  dx      relative X
  offset 2  i16  dy      relative Y, screen-positive up
  offset 4  i8   dz      wheel, always 0 for the base 3-byte protocol
  offset 5  u8   buttons left|right|middle bitfield
  offset 6  u8   flags   X and Y overflow bits
  offset 7  u8   reserved zero
```

## The reply endpoint

Every reply is sent with `mk_ipc_send` to the fixed kernel reply endpoint `KERNEL_REPLY_ENDPOINT`
(`0x1_0000_000A`), not back through the recv socket the request arrived on
([`src/protocol/endpoint.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L16), used in [`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23) and every handler, for example
[`src/server/handlers/poll.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll.rs#L51)). That value is slot 10 in the per-service reply table, and the
kernel-side transport binds the matching inbox string `endpoint.4294967306`
([`src/hardware/ps2_kbd_capsule/client/transport.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/client/transport.rs#L30)); the userland endpoint comment ties the two
together ([`src/protocol/endpoint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs), `transport.rs:29`).

The runner sizes one transmit buffer large enough for the biggest of the four payload-bearing replies and
reuses it across ops ([`src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L35)). The poll reply is the largest at
`20 + 8 + 256 * 3` bytes for the keyboard and `20 + 8 + 256 * 8` for the mouse.

## The two rings

The decoded stream lands on two bounded, fixed-size rings before it is ever read out by a poll op. They
are deliberately given opposite drop disciplines, because a lost keystroke and a lost mouse sample fail
differently.

### The keyboard ring: overwrite oldest

`Ring` is a 256-slot array of `Event { scancode, flags }` with a head, a tail, and four `u64` counters
([`src/ring/state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/state.rs#L18), `RING_CAPACITY = 256` at [`src/constants/ports.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ports.rs#L32)). `push` advances head, and
when the ring is full it also advances tail, dropping the *oldest* event and incrementing
`events_dropped` ([`src/ring/push.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/push.rs#L20)). `pop` returns the event at tail or `None` when head equals tail
([`src/ring/pop.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/pop.rs#L20)). The rationale is that a keystroke that arrived long ago and was never polled is
staler than the one that just arrived; under overflow the newest keys survive.

### The mouse ring: drop newest

`MouseRing` is a 128-slot array of `MouseEvent` with the same head/tail shape and three counters
([`src/mouse/ring.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs#L19), `MOUSE_RING_CAPACITY = 128`). Its `push` does the opposite: when the ring is
full it drops the *incoming* event and increments `events_dropped`, leaving the queued samples untouched
([`src/mouse/ring.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs#L38)). For a mouse the accumulated motion already queued is what matters; discarding
the newest delta loses the least position information. Both rings expose `queued`, and both count every
arrival in `events_seen` whether or not it was kept ([`src/ring/state.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/state.rs#L39), [`src/mouse/ring.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs#L39)).

A full ring never blocks the drain, the interrupt handler, or a poll reply; overflow is a counted,
deterministic data-plane event, not a fault.

## Source map

```
  userland/capsule_driver_ps2_input/src/protocol/header.rs    NKBD magic, version, header layout
  userland/capsule_driver_ps2_input/src/protocol/decode.rs    request decode and validation
  userland/capsule_driver_ps2_input/src/protocol/encode.rs    response header and status word
  userland/capsule_driver_ps2_input/src/protocol/ops.rs       the five op constants
  userland/capsule_driver_ps2_input/src/protocol/limits.rs    payload sizes and record widths
  userland/capsule_driver_ps2_input/src/protocol/errno.rs     E_INVAL and E_IO
  userland/capsule_driver_ps2_input/src/protocol/endpoint.rs  the kernel reply endpoint
  userland/capsule_driver_ps2_input/src/server/runner.rs      the op dispatch and the tx buffer sizing
  userland/capsule_driver_ps2_input/src/server/error.rs       reply_with_status / reply_decode_failed
  userland/capsule_driver_ps2_input/src/server/handlers/      health, poll, mouse, state, controller_status
  userland/capsule_driver_ps2_input/src/ring/                 the keyboard ring, overwrite-oldest push
  userland/capsule_driver_ps2_input/src/mouse/ring.rs         the mouse ring, drop-newest push
  userland/capsule_driver_ps2_input/src/constants/status.rs   the i8042 status-bit constants
  src/hardware/ps2_kbd_capsule/client/transport.rs            the kernel-side reply inbox binding
```

Every reference above is verified against those trees.
