---
title: "Protocol, server, and discovery"
description: "This page covers everything the driver does that is not the report path: the NHID server protocol other capsules call, the three operations and their replies, the dispatch loop,..."
weight: 1
---
This page covers everything the driver does that is not the report path: the `NHID` server protocol other
capsules call, the three operations and their replies, the dispatch loop, the `NI2C` client protocol the
driver calls against `driver.i2c_pci0`, and the HID descriptor discovery that arms the report path. It
mirrors `src/protocol/`, `src/server/`, `src/i2c_client/`, and `src/hid/`. For the report path itself see
[input.md](/docs/userland/driver-i2c-hid/input/); for identity and the capability mask see the [README](/docs/userland/driver-i2c-hid/).

## The server loop

`server::run` is the whole capsule after setup, a single loop that does two things per iteration
([`src/server/runner.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L15)):

1. It receives with `mk_ipc_recv_from` on the service inbox with a 2 ms timeout
   ([`src/server/runner.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L20), [`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13)).
2. Whether or not a request arrived, it calls `input::poll` ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)). The report path
   therefore runs on every pass, paced by the receive timeout, not by an operation. See
   [input.md](/docs/userland/driver-i2c-hid/input/).
3. If the receive returned nothing, or the sender pid is zero, it loops ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)).
4. Otherwise it parses the frame and dispatches ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31)).

The 2 ms timeout is the read cadence. When no capsule is calling, the loop wakes roughly every 2 ms, polls
the device, and goes back to waiting. There is no interrupt binding and no GPIO doorbell in this build; the
capsule holds no `Irq` capability, so it cannot bind the device interrupt. This is a real gap against a
production touchpad driver, which would read only when the device signals a report ready. The fuller,
doorbell-paced path lives on a different branch and is not here.

## The NHID server protocol

The server protocol is magic `NHID` `0x4E484944`, version 1, with a 20-byte header
([`src/protocol/header.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L1)).

A request is:

```
  magic(4) | version(2) | op(2) | request_id(8) | body_len(4) | body(body_len)
```

`parse` rejects anything shorter than the header, with the wrong magic, with the wrong version, or whose
declared `body_len` runs past the buffer ([`src/protocol/decode.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L3)). It returns the op and request id
along with a borrow of the body.

A reply reuses the header with the request's op and id, then a four-byte signed status word, then the
body ([`src/protocol/encode.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L3)). Note the header's `body_len` on a reply counts the status word: it is
encoded as `4 + body.len()` ([`src/protocol/encode.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L12)), so a reader recovers the payload by subtracting
the four status bytes. Replies go out through `respond::send`, which formats the frame and calls
`mk_ipc_reply` to the sender pid ([`src/server/respond.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L4)). The payload cap is 96 bytes
([`src/protocol/limits.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L1)), and the receive and transmit buffers are each sized `HDR_LEN +
IPC_PAYLOAD_MAX` ([`src/server/runner.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L16)).

## Dispatch and validation

`dispatch` matches the op, and each operation is accepted only when its request body is empty
([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)):

- A recognised op (`OP_HEALTHCHECK`, `OP_PROBE`, `OP_DESCRIPTOR`) with an empty body runs its handler.
- A recognised or unrecognised op carrying a non-empty body draws `E_INVAL` ([`src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L53)).
- An unrecognised op with an empty body draws `E_BAD_OP` ([`src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L50)).

Ops come from [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and error codes from [`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs).

| Op | Value | Request | Reply | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | empty | a 56-byte status body | `ops.rs:1`, [`src/server/handlers/health.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L5) |
| `OP_PROBE` | 2 | empty | re-runs the bus probe, replies with the found flag and address | `ops.rs:2`, [`src/server/handlers/probe.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L6) |
| `OP_DESCRIPTOR` | 3 | empty | the address and the cached descriptor bytes, or `E_NOT_FOUND` | `ops.rs:3`, [`src/server/handlers/descriptor.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/descriptor.rs#L5) |

Error codes: `E_OK 0`, `E_NOT_FOUND -2`, `E_INVAL -22`, `E_BAD_OP -38` ([`src/protocol/errno.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L1)).

### OP_HEALTHCHECK

Always succeeds with `E_OK` and a 56-byte body ([`src/server/handlers/health.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L5)). The layout is fixed:

| Offset | Field | Source |
|---|---|---|
| 0 | found flag | `health.rs:7` |
| 1 | I2C address | `health.rs:8` |
| 4..8 | controller port | `health.rs:9` |
| 8..12 | controller pid | `health.rs:10` |
| 16..24 | probe count | `health.rs:11` |
| 24..26 | discovered input register | `health.rs:12` |
| 26..28 | discovered input length | `health.rs:13` |
| 32..40 | `input_polls` | `health.rs:14` |
| 40..48 | `input_reports` | `health.rs:15` |
| 48..56 | `post_failures` | `health.rs:16` |

Those three trailing counters are the only externally visible sign that polling is happening; the
[debugging](/docs/userland/driver-i2c-hid/debugging/) page uses them to isolate report-path failures.

### OP_PROBE

Calls `reprobe`, which bumps the probe counter and re-runs the address scan, then replies with the found
flag and the selected address ([`src/server/handlers/probe.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L7), [`src/setup.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L12)).

### OP_DESCRIPTOR

Returns `E_NOT_FOUND` when no descriptor has been read yet, that is when `found()` is false
([`src/server/handlers/descriptor.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/descriptor.rs#L6)). Otherwise it replies `E_OK` with the address, the descriptor
length, and the descriptor bytes trimmed to `descriptor_len` ([`src/server/handlers/descriptor.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/descriptor.rs#L10)).

## The NI2C client protocol

Every byte the driver exchanges with the physical device is an `OP_TRANSFER` call to `driver.i2c_pci0`.
The client protocol is magic `NI2C` `0x4E493243`, version 1, 20-byte header, `OP_TRANSFER 5`
([`src/i2c_client/wire.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/wire.rs#L1)).

`write_read` is the single entry point ([`src/i2c_client/transfer.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/transfer.rs#L7)):

1. It takes a fresh request id from a monotonic atomic counter, so a stale reply for an earlier transfer
   is rejected ([`src/i2c_client/seq.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/seq.rs#L5)).
2. `wire::request` encodes the slave address, the write bytes, the requested read length, and a
   restart-on-read flag into the request buffer ([`src/i2c_client/wire.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/wire.rs#L7)). The flag is set only when
   there are both write bytes and a non-zero read length, so a write-then-read transfer issues a repeated
   start rather than a stop between the phases ([`src/i2c_client/wire.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/wire.rs#L22)).
3. It makes a blocking call to the controller's port with a 250 ms timeout through `mk_ipc_call_timeout`
   ([`src/i2c_client/transfer.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/transfer.rs#L15)).
4. `wire::response` checks the reply for the right magic, a matching request id, and a zero status word
   before copying the payload out; it also bounds the declared read length against both the caller's buffer
   and the reply size ([`src/i2c_client/wire.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/wire.rs#L28)). Anything else returns `None`, and the transfer is
   treated as having failed.

The HID-over-I2C register model rides on top of this: the driver writes a little-endian register address,
then reads the report bytes back, both inside one `OP_TRANSFER` envelope. It never touches a controller
register directly ([`src/hid/probe.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L9), [`src/input/poll.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L30)).

## Descriptor discovery

`setup::run` builds the `State` and calls `reprobe` once before entering the loop ([`src/setup.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L5)).
`reprobe` bumps the probe counter and calls `probe_bus`; on success it stores the address, the descriptor
length, and derives the two report registers ([`src/setup.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L12)).

`probe_bus` scans a fixed list of common HID-over-I2C slave addresses and, for each, writes the HID
descriptor register `0x0001` and reads back 30 bytes ([`src/hid/probe.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L6), [`src/hid/probe.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L9)):

```
  CANDIDATE_ADDRS = 0x10, 0x15, 0x2C, 0x38, 0x4B, 0x4C, 0x20, 0x24
```

covering ELAN, Synaptics, and FocalTech ranges ([`src/hid/probe.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L4)). The first address whose 30 bytes
parse as a valid HID descriptor wins.

`valid_descriptor` accepts a candidate only if the descriptor-length field is in `28..=256` and the BCD
version field is in `0x0100..=0x0111` ([`src/hid/descriptor.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/descriptor.rs#L3)). From the accepted descriptor the capsule
derives:

- the input register, read little-endian from descriptor offset 8..10 ([`src/hid/input_register.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_register.rs#L17));
- the maximum input length, read little-endian from offset 10..12 and capped at 64
  ([`src/hid/input_len.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_len.rs#L17)).

Those two values are what arm the report path: `input::poll` refuses to run until a descriptor is found,
the input register is non-zero, and the input length is at least five bytes ([`src/input/poll.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L23)). See
[input.md](/docs/userland/driver-i2c-hid/input/).

## Source map

```
  userland/capsule_driver_i2c_hid/src/protocol/header.rs      NHID magic, version, 20-byte header, Request
  userland/capsule_driver_i2c_hid/src/protocol/decode.rs      parse: magic/version/body-len validation
  userland/capsule_driver_i2c_hid/src/protocol/encode.rs      response: reply frame, status-in-body-len
  userland/capsule_driver_i2c_hid/src/protocol/ops.rs         OP_HEALTHCHECK / OP_PROBE / OP_DESCRIPTOR
  userland/capsule_driver_i2c_hid/src/protocol/errno.rs       E_OK / E_NOT_FOUND / E_INVAL / E_BAD_OP
  userland/capsule_driver_i2c_hid/src/protocol/limits.rs      IPC_PAYLOAD_MAX
  userland/capsule_driver_i2c_hid/src/server/runner.rs        recv/poll/dispatch loop, 2 ms recv timeout
  userland/capsule_driver_i2c_hid/src/server/respond.rs       response frame + mk_ipc_reply
  userland/capsule_driver_i2c_hid/src/server/handlers/health.rs      the 56-byte status body
  userland/capsule_driver_i2c_hid/src/server/handlers/probe.rs       reprobe then found flag + address
  userland/capsule_driver_i2c_hid/src/server/handlers/descriptor.rs  address + cached descriptor bytes
  userland/capsule_driver_i2c_hid/src/i2c_client/service.rs   resolve driver.i2c_pci0 via mk_service_lookup
  userland/capsule_driver_i2c_hid/src/i2c_client/transfer.rs  write_read: OP_TRANSFER call, 250 ms timeout
  userland/capsule_driver_i2c_hid/src/i2c_client/wire.rs      NI2C encode/decode, restart-on-read flag
  userland/capsule_driver_i2c_hid/src/i2c_client/seq.rs       monotonic request-id counter
  userland/capsule_driver_i2c_hid/src/hid/probe.rs            candidate-address scan, descriptor read
  userland/capsule_driver_i2c_hid/src/hid/descriptor.rs       30-byte descriptor validation
  userland/capsule_driver_i2c_hid/src/hid/input_register.rs   input register from offset 8..10
  userland/capsule_driver_i2c_hid/src/hid/input_len.rs        input length from offset 10..12, capped 64
  userland/capsule_driver_i2c_hid/src/setup.rs                run + reprobe
```

Every reference above is verified against those trees.
