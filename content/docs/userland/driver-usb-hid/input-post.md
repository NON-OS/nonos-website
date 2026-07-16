---
title: "Report parsing and the input-post path"
description: "The class layer of capsuledriverusbhid lives under src/hid/."
weight: 6
---
The class layer of `capsule_driver_usb_hid` lives under `src/hid/`. It takes a raw HID boot report,
diffs or decodes it into typed events, and posts each event into the kernel input ring with
`mk_input_event_post`. This is the path that actually reaches the desktop: not the poll ops, but a
syscall. This page walks the keyboard diff and keymap, the mouse and tablet parse, and the
`post_key` / `post_mouse` / `post_wire` wire into the ring. The same parsers run for a live endpoint
drain and for the `OP_FEED_*` service ops, so both converge here. For the wider input path across
capsules see the [input path](/docs/subsystems/input/path/).

The post-side files are `post_key.rs`, `post_mouse.rs`, and `post_wire.rs`. An older subsystem page
refers to a [`hid/publish.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hid/publish.rs) file for this driver; there is no such file. The button code, the mouse
publisher, and the `post_failures` bump named there now live in [`src/hid/post_mouse.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs),
[`src/hid/post_wire.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs), and [`src/hid/mouse.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs). The [debugging](/docs/userland/driver-usb-hid/debugging/) page and the
[README](/docs/userland/driver-usb-hid/) note the same correction.

## The InputEvent and the syscall

Every post is one `InputEvent`, the shared 32-byte flat record whose userland mirror is
[`userland/libc/src/surface_registry/types.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/surface_registry/types.rs#L44), carrying a kind, modifier flags, a code, absolute
x/y, relative deltas, and a timestamp. This capsule sets `timestamp_ns` to zero on every event
([`src/hid/post_wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs#L21)). The `INPUT_KIND_*` constants it uses are defined once, in userland
([`userland/libc/src/surface_registry/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/surface_registry/types.rs#L23)).

`post_wire` is the one place the syscall is made ([`src/hid/post_wire.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs#L19)). `send` fills a relative
event (kind, flags, code, and dx/dy) and calls `mk_input_event_post`, returning true when the syscall
returns `>= 0` ([`src/hid/post_wire.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs#L19), [`src/hid/post_wire.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs#L22)). `send_abs` fills an absolute
event with x/y and zeroed deltas for the tablet path ([`src/hid/post_wire.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs#L25)). The wrapper
`mk_input_event_post` is the libc entry for the `MkInputEventPost` syscall
([`userland/libc/src/surface_registry/input_post.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/surface_registry/input_post.rs#L22)). Because every event routes through these two
functions, a change to how events reach the ring belongs here and nowhere else.

## The keyboard diff

`Keyboard::feed` takes the 8-byte boot report: byte 0 is the modifier mask and bytes 2 through 7 are
the up to six currently-pressed usage codes ([`src/hid/keyboard/feed.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs#L21)). It stores the modifier
mask, then diffs the six usages against the previous frame `self.prev`
([`src/hid/keyboard/feed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs#L22), [`src/hid/keyboard/feed.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs#L24)). A usage present now that was not
present before is a press; a usage that was present and is now gone is a release
([`src/hid/keyboard/feed.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs#L25), [`src/hid/keyboard/feed.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs#L30)). A usage code of 0 or 1 is filtered as
not a real key ([`src/hid/keyboard/is_real_key.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/is_real_key.rs#L17)). The frame is then remembered as the new `prev`,
so a held key repeats no event ([`src/hid/keyboard/feed.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs#L34)).

Each transition calls `push_key(scancode, pressed)` ([`src/hid/keyboard/push_key.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/push_key.rs#L22)). On a press it
toggles Caps Lock if the usage is `0x39` ([`src/hid/keymap.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs#L22)), resolves an ASCII byte from the
usage code, the modifier mask, and Caps Lock through `keymap::ascii`, and builds a `KeyEvent` of
scancode, ascii, modifiers, and pressed ([`src/hid/keyboard/push_key.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/push_key.rs#L26),
[`src/hid/keyboard/push_key.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/push_key.rs#L28)). It publishes the event through `post_key::publish`, bumping
`post_failures` on a failed post, and mirrors the event into the bounded local queue for `OP_POLL_KEYS`
if the queue is under its cap of 64 ([`src/hid/keyboard/push_key.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/push_key.rs#L29),
[`src/hid/keyboard/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/constants.rs#L17)).

The keymap covers letters, digits, whitespace, and punctuation ([`src/hid/keymap.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs#L26)). A letter
usage `0x04..=0x1d` is mapped with an upper-case decision that is `shift XOR caps`, so Shift and Caps
Lock combine the way a real keyboard does ([`src/hid/keymap.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs#L29), [`src/hid/keymap.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs#L41)). Digit
usages `0x1e..=0x27` map to their plain or shifted symbols ([`src/hid/keymap.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs#L46)); Enter, Escape,
Backspace, Tab, and Space are direct ([`src/hid/keymap.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs#L31)); punctuation usages `0x2d..=0x38` go
through a shifted/unshifted table ([`src/hid/punctuation.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/punctuation.rs#L17)). A usage outside those ranges yields
ASCII 0.

## The keyboard post

`post_key::publish` turns a `KeyEvent` into an `InputEvent` ([`src/hid/post_key.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_key.rs#L32)). The kind is
`INPUT_KIND_KEY_DOWN` on a press and `INPUT_KIND_KEY_UP` on a release
([`src/hid/post_key.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_key.rs#L33)). The code is chosen in two steps. Navigation usages map to private key
codes `0xE000..0xE008`: arrows, Home, End, Delete, Page Up, and Page Down
([`src/hid/post_key.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_key.rs#L37)). Otherwise the code is the ASCII byte, with `\n` normalized to `0x0D`, or,
for a key the keymap did not resolve (ASCII 0), the fallback `0x2000 | scancode`
([`src/hid/post_key.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_key.rs#L52)). The modifier mask is packed into shift/ctrl/alt/meta flag bits by testing
the left and right pairs of the HID modifier byte ([`src/hid/post_key.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_key.rs#L60)). A consumer that sees a
high `0x2000` code is receiving a key the keymap does not cover.

## The mouse parse and post

`Mouse::feed` requires at least 3 bytes: byte 0 is the button mask (low 5 bits), byte 1 is signed dx,
byte 2 is signed dy, and an optional byte 3 is the signed wheel delta
([`src/hid/mouse.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L35), [`src/hid/mouse.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L40)). It enqueues an event only if something changed:
motion, wheel, or a button transition ([`src/hid/mouse.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L46)). The event carries dx, dy, dz, the
button mask, and a flags byte recording which of those changed ([`src/hid/mouse.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L47)). `push`
publishes it through `post_mouse::publish` with the previous button mask, bumping `post_failures` on a
failed post, and mirrors it into the local queue under a cap of 64 ([`src/hid/mouse.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L65),
[`src/hid/mouse.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L66), [`src/hid/mouse.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs#L69)).

`post_mouse::publish` posts up to three kinds, each a separate `send`
([`src/hid/post_mouse.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs#L24)). A non-zero dx/dy sends `INPUT_KIND_POINTER_REL` with `delta_x`/`delta_y`
([`src/hid/post_mouse.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs#L26)); a non-zero wheel sends `INPUT_KIND_WHEEL` with `delta_y`
([`src/hid/post_mouse.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs#L29)); and each changed button bit sends `INPUT_KIND_BUTTON_DOWN` or
`INPUT_KIND_BUTTON_UP` with `code = bit + 1`, so left is 1, right is 2, middle is 3
([`src/hid/post_mouse.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs#L35), [`src/hid/post_mouse.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs#L44)). The button diff is `previous XOR current`
masked to the low five bits, so only a bit that flipped emits an event
([`src/hid/post_mouse.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs#L36)).

## The tablet path

The absolute tablet path is separate and post-only: it keeps no local queue and is not exposed as a
poll op ([`src/hid/tablet.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs#L23)). `Tablet::feed` requires at least 5 bytes: byte 0 is the button mask
(low 3 bits), bytes 1 to 2 are a little-endian 16-bit x, bytes 3 to 4 a 16-bit y, and an optional byte
5 is a signed wheel delta ([`src/hid/tablet.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs#L33), [`src/hid/tablet.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs#L36)). It posts an
`INPUT_KIND_POINTER_ABS` with x/y through `send_abs`, a `INPUT_KIND_WHEEL` if the wheel moved, then
button transitions the same way the mouse does but over the low three bits
([`src/hid/tablet.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs#L40), [`src/hid/tablet.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs#L44), [`src/hid/tablet.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs#L49)). Absolute coordinates leaving
here are device-space; the router maps them onto the display, as the
[input path](/docs/subsystems/input/path/) documents.

## Where the event goes

`mk_input_event_post` lands in the kernel: `do_post` reads the `InputEvent` out of user memory and
calls `post_input`, which pushes it onto the global MPSC input ring, bumps the sequence, and wakes the
parked router ([`src/syscall/dispatch/router/input_ops.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs#L53),
[`src/kernel_core/surface_registry/input_ring.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs#L55)). The capability required is exactly `InputSource`
(or `Irq`/`Admin`), checked at [`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78). From there the single
`capsule_input_router` drains the ring and routes each event to the focused consumer, as documented in
the [input path](/docs/subsystems/input/path/). A full ring returns negative from the syscall and
the driver counts it as a post failure; the event is lost, which the router's own drop analysis on
that page covers.

## Source map

```
  src/hid/keyboard/feed.rs        the 8-byte boot report diff into press/release
  src/hid/keyboard/is_real_key.rs the 0/1 usage filter
  src/hid/keyboard/push_key.rs    caps toggle, keymap, KeyEvent, publish, local mirror
  src/hid/keyboard/constants.rs   the local queue cap of 64
  src/hid/keymap.rs               usage -> ASCII with shift/caps XOR
  src/hid/punctuation.rs          the shifted/unshifted punctuation table
  src/hid/key_event.rs            the KeyEvent record and its 8-byte wire form
  src/hid/post_key.rs             KeyEvent -> InputEvent kind, navigation codes, flag bits
  src/hid/mouse.rs                boot mouse parse, change gate, local queue, post_failures
  src/hid/mouse_event.rs          the MouseEvent record and its 8-byte wire form
  src/hid/post_mouse.rs           MouseEvent -> POINTER_REL / WHEEL / button events
  src/hid/tablet.rs               absolute pointer parse and post-only path
  src/hid/post_wire.rs            send / send_abs, the mk_input_event_post call
  userland/libc/src/surface_registry/input_post.rs  the mk_input_event_post wrapper
  userland/libc/src/surface_registry/types.rs       InputEvent and the INPUT_KIND_* constants
  src/kernel_core/surface_registry/input_ring.rs    the kernel input ring post_input targets
  src/syscall/contract/cap_table/mk.rs              the InputSource gate on MkInputEventPost
```

Every reference above is verified against those trees.
