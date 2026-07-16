---
title: "The report and input-post path"
description: "This is the pillar that does the real work: reading a HID input report over I2C, decoding it into a pointer sample, and turning motion, wheel, and button changes into kernel inp..."
weight: 2
---
This is the pillar that does the real work: reading a HID input report over I2C, decoding it into a
pointer sample, and turning motion, wheel, and button changes into kernel input events. It mirrors
`src/input/`. For the server protocol, the I2C client, and descriptor discovery see
[protocol.md](/docs/userland/driver-i2c-hid/protocol/); for identity and the mask see the [README](/docs/userland/driver-i2c-hid/).

The whole path is `input::poll`, called on every pass of the server loop right after the bounded receive
returns, whether or not a request arrived ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)). It is paced by the loop's 2 ms
receive timeout, not by a hardware interrupt. See the pacing note below.

## The poll guard

`input::poll` returns immediately unless the driver is armed to read: a descriptor must have been found,
the derived input register must be non-zero, and the derived input length must be at least five bytes
([`src/input/poll.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L23)). Those three come from descriptor discovery ([`src/hid/input_register.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_register.rs#L17),
[`src/hid/input_len.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_len.rs#L17)); until they are set the report path does nothing and none of the counters move.
This is the first thing to check when a descriptor is found but no reports arrive; see
[debugging.md](/docs/userland/driver-i2c-hid/debugging/).

## Reading the report

When the guard passes, `poll` ([`src/input/poll.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L22)):

1. Caps the read at `input_len` and at the 64-byte local buffer ([`src/input/poll.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L27)).
2. Builds the two-byte little-endian input-register address ([`src/input/poll.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L28)).
3. Bumps `input_polls` ([`src/input/poll.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L29)).
4. Asks the I2C controller to write that register address and read back up to `len` bytes through
   `write_read` ([`src/input/poll.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L30)). A `None` return, a controller error or a timeout, ends the pass
   without bumping any further counter.
5. Parses the returned bytes with `parse_report` ([`src/input/poll.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L31)). A rejected parse ends the pass.
6. On a good parse it bumps `input_reports` and calls `publish` ([`src/input/poll.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L32)).

So `input_polls` counts read attempts and `input_reports` counts successful parses; the gap between them
is transfers that failed or bytes that did not parse.

## Decoding a report

`parse_report` decodes a length-prefixed HID input report into a `MouseSample`
([`src/input/parse_report.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L19)). The report is length-prefixed: the first two bytes are the total report
length, and the body is what follows ([`src/input/parse_report.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L23)). The parser rejects a buffer under
five bytes and a length prefix that is under five or runs past the buffer
([`src/input/parse_report.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L20), [`src/input/parse_report.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L24)).

It then decides whether the body carries a leading report id. If the body is at least four bytes, its first
byte is non-zero, and its second byte fits in the low five bits, the parser treats the first byte as a
report id and skips it; otherwise it starts at offset zero ([`src/input/parse_report.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L28)). From the
chosen start it reads:

| Field | Bytes | Meaning |
|---|---|---|
| `buttons` | 1, low five bits | button bitmap ([`src/input/parse_report.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L33)) |
| `dx` | 1, signed | relative X motion ([`src/input/parse_report.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L34)) |
| `dy` | 1, signed | relative Y motion ([`src/input/parse_report.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L35)) |
| `wheel` | 1, signed, optional | wheel delta, zero if absent ([`src/input/parse_report.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L36)) |

The `MouseSample` is those four fields ([`src/input/sample.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/sample.rs#L17)).

This is the honest scope of this branch. The decode is a relative-pointer layout, not the absolute
multi-contact Precision Touchpad report. A real Precision Touchpad in its native mode will not decode
correctly here: the parser reads the first contact's fields as if they were mouse deltas
([`src/input/parse_report.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L19)), and the driver never writes the feature report that would switch the
device into a mode this parser understands. A separate branch carries the absolute-mode switch, a
report-descriptor parser that locks onto the touch report id, and gesture handling; that code is not here.

## Publishing events

`publish` turns a `MouseSample` into kernel input events ([`src/input/publish.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L25)):

- A relative-pointer event when `dx` or `dy` is non-zero, carrying the deltas
  ([`src/input/publish.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L28)).
- A wheel event when the wheel byte is non-zero, carrying the wheel delta as `delta_y`
  ([`src/input/publish.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L31)).
- One button event per changed bit. It XORs the new button bitmap against `last_buttons`, masks to the low
  five buttons, and for each changed bit posts a button-down or button-up with `code = bit + 1` so left is
  1 through button 5 ([`src/input/publish.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L33)). It then stores the new bitmap as `last_buttons`
  ([`src/input/publish.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L42)).

The event kinds are the shared libc constants `INPUT_KIND_POINTER_REL`, `INPUT_KIND_WHEEL`,
`INPUT_KIND_BUTTON_DOWN`, and `INPUT_KIND_BUTTON_UP` ([`src/input/publish.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L17),
[`userland/libc/src/surface_registry/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/surface_registry/types.rs#L25)). This build never posts `INPUT_KIND_POINTER_ABS`; there
are no absolute coordinates in the path.

If any post is refused, `publish` bumps `post_failures` once for the sample ([`src/input/publish.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L43)). It
never retries and never blocks the loop on a failed post.

## The post syscall

`post` fills a flat `InputEvent` and hands it to `mk_input_event_post`, returning whether the syscall
succeeded ([`src/input/post.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/post.rs#L19)). It sets `flags` to zero, `x`/`y` to zero, and `timestamp_ns` to zero;
only `kind`, `code`, and the two deltas carry data ([`src/input/post.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/post.rs#L20)). `mk_input_event_post` is the
one syscall the capsule uses that carries hardware-adjacent authority: the kernel gates it on the
`InputSource` capability, refusing the post unless the caller's capability set includes it
([`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78)). That is why `InputSource` is in the mask; see the
[README](/docs/userland/driver-i2c-hid/).

From there the event is out of the capsule's hands. `mk_input_event_post` lands on the kernel's
`post_input`, which pushes the event into the bounded MPSC input ring that the input router capsule drains,
dropping rather than overflowing when the ring is full ([`src/kernel_core/surface_registry/input_ring.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs#L55)).
The full event journey, from a driver post through the ring to the router and on to the focused surface, is
documented in [the input path](/docs/subsystems/input/path/).

## Pacing, honestly

The read cadence is set by the server loop's receive timeout: `mk_ipc_recv_from` is called with a 2 ms
timeout, so if no request arrives the loop wakes roughly every 2 ms and polls the device
([`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13), [`src/server/runner.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L20), [`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)). There is no interrupt
binding and no GPIO doorbell in this build; the capsule holds no `Irq` capability, so it cannot bind the
device interrupt. This is a real gap against a production touchpad driver, which would read only when the
device signals a report ready. The doorbell-paced read lives on a different branch and is not here.

## Source map

```
  userland/capsule_driver_i2c_hid/src/input/poll.rs          the report path: guard, read, parse, publish
  userland/capsule_driver_i2c_hid/src/input/parse_report.rs  length-prefixed report -> MouseSample
  userland/capsule_driver_i2c_hid/src/input/sample.rs        MouseSample: buttons, dx, dy, wheel
  userland/capsule_driver_i2c_hid/src/input/publish.rs       MouseSample -> pointer/wheel/button events
  userland/capsule_driver_i2c_hid/src/input/post.rs          mk_input_event_post wrapper
  userland/capsule_driver_i2c_hid/src/server/runner.rs       the loop that calls poll, 2 ms recv timeout
  userland/capsule_driver_i2c_hid/src/i2c_client/transfer.rs write_read, called to read the input register
  userland/capsule_driver_i2c_hid/src/hid/input_register.rs  the input register that arms poll
  userland/capsule_driver_i2c_hid/src/hid/input_len.rs       the input length that arms poll
  userland/libc/src/surface_registry/types.rs               the INPUT_KIND_* constants and InputEvent
  src/syscall/contract/cap_table/mk.rs                       the InputSource gate on MkInputEventPost
  src/kernel_core/surface_registry/input_ring.rs             post_input and the bounded ring
```

Every reference above is verified against those trees.
