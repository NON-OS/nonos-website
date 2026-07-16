---
title: "Scancode and Mouse Decode"
description: "This page mirrors src/poll/, src/keymap/, and src/mouse/."
weight: 5
---
This page mirrors `src/poll/`, `src/keymap/`, and `src/mouse/`. It covers how a raw byte is taken off the
controller, how a keyboard byte becomes a Scan Code Set 1 event and a translated keycode, how three mouse
bytes become a motion-and-button event, and how each of those reaches the kernel input ring through
`mk_input_event_post`. The bounded rings these decoders feed are on the [protocol](/docs/userland/driver-ps2-input/protocol/) page; how
the drain is triggered is on the [bring-up](/docs/userland/driver-ps2-input/bring-up/) page; the system-wide input path is in
[../../subsystems/input/path.md](/docs/subsystems/input/path/).

## The per-byte drain

`drain` reads up to 16 bytes per call (`MAX_BYTES_PER_DRAIN`, [`src/poll/drain.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/drain.rs#L23)). For each byte it
reads the status port, stops if the output-full bit is clear, counts the parity and timeout bits into the
keyboard ring's error counters if set, then reads the data byte ([`src/poll/drain.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/drain.rs#L31)). It routes the
byte by the AUX-data status bit: if `STATUS_AUX_DATA` (`0x20`) is set the byte goes to the mouse parser,
otherwise to the keyboard absorber ([`src/poll/drain.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/drain.rs#L49)). Every port access is `read_port`, which is a
one-byte `mk_pio_read` against the grant ([`src/poll/read_port.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/read_port.rs#L17)). The 16-byte cap bounds how long a
single drain can hold the loop; the pump calls `drain` repeatedly around each interrupt.

## Keyboard decode

Keyboard decode happens in two steps as each byte is absorbed: the raw byte is pushed onto the diagnostic
ring, and the same byte is translated into a keycode and posted to the kernel input ring
([`src/poll/absorb.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/absorb.rs#L22)).

### The raw scancode event

`absorb` handles the Set 1 stream directly. `0xE0` and `0xE1` are latched as pending prefix flags and
consumed without pushing anything; the next real byte is pushed as an `Event { scancode, flags }` where
the flags carry `FLAG_BREAK` (the high bit `0x80` was set), `FLAG_E0_PREFIX`, or `FLAG_E1_PREFIX`
([`src/poll/absorb.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/absorb.rs#L23), [`src/ring/flags.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ring/flags.rs#L16)). This raw scancode plus flags is exactly the 3-byte
record `OP_POLL_EVENTS` returns; the driver does no layout mapping on the diagnostic path.

### Translate to a keycode

Alongside the raw push, `absorb` calls `keymap::translate` on the byte and its flags
([`src/poll/absorb.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/absorb.rs#L44)). `translate` reads the break bit off the flags, masks the scancode to 7 bits,
and looks the key up in either the E0 table or the base Set 1 table depending on `FLAG_E0_PREFIX`,
returning a `Translated { keycode, is_release }` or `None` for an unmapped code
([`src/keymap/translate.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/translate.rs#L23)).

The base table is split by scancode range so each range is one small file
([`src/keymap/set1/base.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1/base.rs#L18)):

```
  0x01..=0x1D   left.rs      Esc, the number row, the QWERTY top row, backspace/tab, left ctrl
  0x1E..=0x39   right.rs     the home row, ZXCV row, both shifts, left alt, space
  0x3A..=0x58   function.rs  caps lock, F1..F10, num/scroll lock, the numpad, F11/F12
```

Printable keys map to their ASCII code, so `0x1E` becomes `b'a'` and `0x39` becomes `b' '`
([`src/keymap/set1/left.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1/left.rs#L20), [`src/keymap/set1/right.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1/right.rs#L47)). Named keys map to keycode constants above
the ASCII range: modifiers such as `KEYCODE_LSHIFT = 0x1003`, function keys such as `KEYCODE_F1 =
0x1101`, and navigation keys such as `KEYCODE_UP = 0x1201` ([`src/keymap/set1/keycodes.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1/keycodes.rs#L16)). The E0
table maps the extended block: right control and alt, the arrow cluster, Home/End/PageUp/PageDown,
Insert, Delete, and the two meta keys ([`src/keymap/set1_e0.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1_e0.rs#L21)). The layout tables are internal to
this capsule; there is no shared external keymap crate and no set-scancode command sent to the keyboard,
so the driver decodes whatever Set 1 the controller delivers by default.

### Modifier tracking and the input post

`absorb` keeps a modifier bitmask on the drainer. When a translated key is a modifier, `modifier_bit`
maps its keycode to `MOD_SHIFT = 1`, `MOD_CTRL = 2`, `MOD_ALT = 4`, or `MOD_META = 8`, and the bit is set
on press and cleared on release ([`src/poll/absorb.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/absorb.rs#L45), [`src/keymap/post.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/post.rs#L31)). These `MOD_*` values
are chosen to match the app-side contract and the USB HID driver's encoding, as the comment states
([`src/keymap/post.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/post.rs#L23)). Every translated key is then handed to `publish`, which builds an `InputEvent`
with kind `INPUT_KIND_KEY_DOWN` or `INPUT_KIND_KEY_UP`, the keycode in `code`, and the current modifier
mask in `flags`, and posts it with `mk_input_event_post` ([`src/keymap/post.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/post.rs#L41)). The `x`, `y`, and
delta fields are zero for a key event, and `timestamp_ns` is posted as zero.

## Mouse decode

Mouse decode is a standard 3-byte PS/2 packet assembler that never desynchronises silently.

### Assemble the packet

`MouseParser::absorb` collects bytes into a 3-slot buffer (`PACKET_LEN = 3`, [`src/mouse/parser.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L16)).
On the first byte of a packet it requires bit 3 (the always-one sync bit) to be set; a first byte without
it is counted as a sync error and dropped rather than shifting the packet alignment
([`src/mouse/parser.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L30)). When the third byte lands it parses the packet and either pushes the result
on the mouse ring or counts a second sync error if the parse rejects it ([`src/mouse/parser.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L36)). The
parser's own comment records that posting to the kernel ring happens once, from the pump loop draining
this ring, so absorbing must not also post or every event would reach the kernel twice
([`src/mouse/parser.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L26)).

### Parse the bytes

`parse` reads byte 0 for the button bits (left `0x01`, right `0x02`, middle `0x04`) and the X and Y
overflow flags (`0x40`, `0x80`), then sign-extends the two movement bytes using the sign bits in byte 0
(`0x10` for X, `0x20` for Y). Y is negated so that screen-positive is upward, and the wheel delta `dz` is
always zero for the base 3-byte protocol ([`src/mouse/packet.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/packet.rs#L23), [`src/mouse/event.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/event.rs#L16)). `parse`
re-checks the sync bit and returns `None` if it is clear, which is the second sync-error path
([`src/mouse/packet.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/packet.rs#L25)).

### The input post

The pump drains the mouse ring and calls `publish_mouse` on each event, carrying the previous button mask
forward ([`src/server/pump.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump.rs#L36), [`src/mouse/post.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs#L24)). `publish` posts up to three separate
`InputEvent`s per mouse event:

- Relative motion as `INPUT_KIND_POINTER_REL` with `delta_x`/`delta_y`, only when `dx` or `dy` is
  non-zero ([`src/mouse/post.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs#L26)).
- A non-zero wheel as `INPUT_KIND_WHEEL` with the wheel in `delta_y` ([`src/mouse/post.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs#L29)).
- Each changed button as `INPUT_KIND_BUTTON_DOWN` or `INPUT_KIND_BUTTON_UP`. `publish_buttons` XORs the
  previous and current masks over the low three bits and posts only the transitions, with `code = bit +
  1` so left is 1, right is 2, middle is 3 ([`src/mouse/post.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs#L35)). Posting only transitions is why the
  pump must carry `prev_buttons` across iterations.

Each post is a `mk_input_event_post` on a fixed `InputEvent`; a negative return is treated as the event
lost and the boolean is folded into an aggregate `ok` that the caller discards ([`src/mouse/post.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs#L49)).

## What this driver does not decide

The decoder produces events into a shared kernel ring; it does not choose who receives them. Routing,
focus, grabs, and lock-screen policy live above this capsule in the input router and the compositor, and
the whole class of events can only be grabbed by a few named trusted capsules. The keyboard-layout
question (which glyph a keycode prints under which modifiers) is also not decided here: this driver emits
raw Set 1 scancodes on the diagnostic ring and ASCII-or-keycode values on the input ring, and a higher
capsule applies the active layout. That whole downstream path is documented in
[../../subsystems/input/path.md](/docs/subsystems/input/path/).

## Source map

```
  userland/capsule_driver_ps2_input/src/poll/drain.rs        the per-byte drain, parity/timeout counts, AUX routing
  userland/capsule_driver_ps2_input/src/poll/read_port.rs    the one-byte brokered port read
  userland/capsule_driver_ps2_input/src/poll/absorb.rs       the Set 1 absorber, prefixes, ring push, post
  userland/capsule_driver_ps2_input/src/poll/drainer.rs      the pending-prefix and modifier state
  userland/capsule_driver_ps2_input/src/keymap/translate.rs  break-bit strip, 7-bit mask, table select
  userland/capsule_driver_ps2_input/src/keymap/set1/         the base Set 1 tables split by range, keycodes
  userland/capsule_driver_ps2_input/src/keymap/set1_e0.rs    the extended E0 block
  userland/capsule_driver_ps2_input/src/keymap/post.rs       modifier_bit, MOD_* bits, the key input post
  userland/capsule_driver_ps2_input/src/mouse/parser.rs      the 3-byte assembler and sync-error counting
  userland/capsule_driver_ps2_input/src/mouse/packet.rs      button/overflow extraction and sign extension
  userland/capsule_driver_ps2_input/src/mouse/event.rs       the MouseEvent record
  userland/capsule_driver_ps2_input/src/mouse/post.rs        the pointer, wheel, and button input posts
  userland/libc/src/surface_registry/input_post.rs           mk_input_event_post and the InputEvent layout
```

Every reference above is verified against those trees.
