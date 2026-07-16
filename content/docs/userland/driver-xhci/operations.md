---
title: "xHCI client operations and the IPC surface"
description: "This page is the wire contract of capsuledriverxhci: the message format under src/protocol/, the eleven operations a USB class capsule can call, and the server under src/server/..."
weight: 1
---
This page is the wire contract of `capsule_driver_xhci`: the message format under `src/protocol/`, the
eleven operations a USB class capsule can call, and the server under `src/server/` that receives, decodes,
dispatches, and replies. For the controller bring-up that must complete before any of this runs see
[bring-up](/docs/userland/driver-xhci/bring-up/); for the ring and TRB machinery every op stands on see [rings](/docs/userland/driver-xhci/rings/); for the
slot and descriptor work behind the enumeration ops see [enumeration](/docs/userland/driver-xhci/enumeration/). Identity and the
capability mask are on the [README](/docs/userland/driver-xhci/).

## The message format

Every request and reply carries a 20-byte header (`HDR_LEN`, [`src/protocol/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L18)) followed by a
payload. The header is magic `NXHC` (`0x4E58_4843`, `header.rs:16`), version `1` (`header.rs:17`), the op,
the flags, a reserved half-word, a request id, and the payload length, all little-endian. `decode_request`
parses it and rejects a short buffer, a wrong magic, or a wrong version by returning `None`
([`src/protocol/decode.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L17)); `encode_response_header` writes the same shape back into the reply, echoing
the request op, flags, and request id and zeroing the reserved word ([`src/protocol/encode.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L17)).

A reply is always the 20-byte header, then a 4-byte little-endian status word (`STATUS_LEN`,
[`src/protocol/limits.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L16)), then any op-specific body. `write_status` lays the status word down
(`encode.rs:26`), and the status value is one of the errno constants in [`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs): `0`
success, `E_INVAL = -22`, `E_IO = -5`, `E_NODEV = -19`, `E_AGAIN = -11` (`errno.rs:16`). The fixed body
lengths every handler uses are named constants in [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs), so the wire layout is defined
in one place rather than scattered as literals.

## The server loop

`server::run` is a single strictly sequential loop ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)). It sizes a receive buffer
of `HDR_LEN + MAX_REQUEST_PAYLOAD_LEN` and a transmit buffer large enough for the biggest reply, the full
port-status table (`TX_LEN`, `runner.rs:27`), then loops:

1. `service_interrupts` drains the event ring and acks the interrupter before touching IPC
   (`runner.rs:34`, covered under [rings](/docs/userland/driver-xhci/rings/)).
2. `mk_ipc_recv_from` blocks for a message and records the sender pid (`runner.rs:36`). The pid is stored
   for the reply path immediately (`set_sender`, `runner.rs:37`).
3. `decode_request` validates magic and version; a failure replies `E_INVAL` through
   `reply_decode_failed` and continues (`runner.rs:41`).
4. The frame is length-checked: the received byte count must equal `HDR_LEN + payload_len`, and
   `payload_len` must not exceed `MAX_REQUEST_PAYLOAD_LEN = 10`. Either failure replies `E_INVAL`
   (`runner.rs:49`). This is the outer bound that keeps every handler's body slice small and known.
5. `dispatch` routes the op to its handler (`runner.rs:55`).

Because the loop is one message at a time, the sender pid captured in step 2 is the correct reply
destination for every send the handler makes. `reply::send` uses it: a capsule caller (pid non-zero) gets
a correlation-matched `mk_ipc_reply` to its own reply inbox; a kernel-internal caller (pid 0) gets a
`mk_ipc_send` to the fixed `KERNEL_REPLY_ENDPOINT` `0x1_0000_000B` ([`src/server/reply.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/reply.rs#L37)).

`dispatch` is a match on `req.op` ([`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25)). The four empty-body status ops are gated
with `if body.is_empty()`, so a status op that arrives with a body falls through to the default arm; the
body-carrying ops are routed unconditionally and validate their own body length inside the handler. Any op
that matches nothing, including the unassigned opcodes `0x000A`, `0x000C`, and `0x000D`, hits the default
arm and returns `E_INVAL` (`dispatch.rs:40`). Each handler follows one shape: validate the body length,
do the work, and either `reply_with_status` on error or `encode_response_header` plus `write_status` plus
`reply::send` on success ([`src/server/error.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L19)).

## The operations

Opcodes are defined in [`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16). All lengths below are body bytes after the status word,
and every request length is the body after the 20-byte header.

| Op | Opcode | Request body | Reply body (after status) | Errors |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | empty | none (status only) | `E_INVAL` if body present |
| `OP_CONTROLLER_STATUS` | `0x0002` | empty | 56-byte controller snapshot | `E_INVAL` if body present |
| `OP_PORT_STATUS` | `0x0003` | empty | 4-byte count header + 8 bytes/port | `E_INVAL` if body present |
| `OP_ENABLE_SLOT` | `0x0004` | empty | 4 bytes, byte 0 = slot id | `E_IO`, `E_NODEV` |
| `OP_DISABLE_SLOT` | `0x0005` | 1 byte: slot id | none (status only) | `E_INVAL`, `E_IO` |
| `OP_ADDRESS_DEVICE` | `0x0006` | 2 bytes: slot id, root port | slot, port, speed, rsvd, EP0 MPS (LE), pad | `E_INVAL`, `E_NODEV`, `E_IO` |
| `OP_GET_DEVICE_DESCRIPTOR` | `0x0007` | 1 byte: slot id | 18-byte device descriptor | `E_INVAL`, `E_IO` |
| `OP_GET_CONFIG_DESCRIPTOR` | `0x0008` | 4 bytes: slot, index(=0), len (LE) | 4-byte prefix (count LE + pad) + config bytes | `E_INVAL`, `E_IO` |
| `OP_ALLOC_TRANSFER_RING` | `0x0009` | 6 bytes: slot, ep addr, max packet (LE), ep type | 4 bytes, byte 0 = DCI | `E_INVAL`, `E_IO` |
| `OP_CONTROL_TRANSFER` | `0x000B` | 10 bytes: slot, rsvd, bmRequestType, bRequest, wValue, wIndex, wLength | 2-byte count + returned data | `E_INVAL`, `E_IO` |
| `OP_INTERRUPT_IN` | `0x000E` | 4 bytes: slot, rsvd, length (LE) | 2-byte count + report bytes, or `E_AGAIN` | `E_INVAL`, `E_IO`, `E_AGAIN` |

Each op, cited:

- `OP_HEALTHCHECK` replies with a bare `status = 0`; it is the liveness probe
  ([`src/server/handlers/health.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L18)).
- `OP_CONTROLLER_STATUS` reads `USBSTS`, `USBCMD`, and `IMAN` live and packs a 56-byte snapshot: max slots
  and ports, max scratchpad and scratchpad page count, the three register words, the command-ring cycle
  bit, the total events drained, the DCBAA and scratchpad physical addresses, and the count of allocated
  slots ([`src/server/handlers/controller_status.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_status.rs#L23); `CONTROLLER_STATUS_PAYLOAD_LEN = 56`,
  [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)).
- `OP_PORT_STATUS` walks ports `1..=max_ports`, capped at `MAX_PORTS_REPORTED = 255`, reading each `PORTSC`
  and clearing its change bits, and returns a 4-byte count then an 8-byte record per port (port id then
  the raw `PORTSC` word) ([`src/server/handlers/port_status.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/port_status.rs#L22)). Clearing the change bits on read is
  deliberate: it acknowledges the port-change events so they do not re-fire.
- `OP_ENABLE_SLOT` issues an Enable Slot command, waits for its completion, and marks the returned slot id
  allocated in the local table; if the table refuses the id it issues a compensating Disable Slot and
  returns `E_NODEV` ([`src/server/handlers/enable_slot.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/enable_slot.rs#L23)). A command failure is `E_IO`.
- `OP_DISABLE_SLOT` validates the slot is allocated, issues Disable Slot, and on success, if the slot was
  addressed, clears its DCBAA entry and drops the per-slot DMA resources before marking it released
  ([`src/server/handlers/disable_slot.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/disable_slot.rs#L20)). An unallocated slot id is `E_INVAL`.
- `OP_ADDRESS_DEVICE` requires the slot allocated but not yet addressed and the port in range
  ([`src/server/handlers/address_flow/slot_ready.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/slot_ready.rs#L18)), resets the root port, then runs the Address
  Device flow and replies with slot, port, the xHCI speed id, and the EP0 max packet size
  ([`src/server/handlers/address_device.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_device.rs#L21), [`src/server/handlers/address_reply.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_reply.rs#L20)). Covered in
  detail on the [enumeration](/docs/userland/driver-xhci/enumeration/) page.
- `OP_GET_DEVICE_DESCRIPTOR` allocates an 18-byte DMA buffer, runs the EP0 `GET_DESCRIPTOR(Device)`
  control transfer against the slot's EP0 ring, and copies the raw descriptor into the reply
  ([`src/server/handlers/device_descriptor.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/device_descriptor.rs#L23)).
- `OP_GET_CONFIG_DESCRIPTOR` accepts only index `0` and rejects a zero slot (`handle.rs:24`), clamps the
  requested length to `CONFIG_DESCRIPTOR_MAX = 512`, runs the EP0 configuration fetch, and prefixes the
  reply body with the actual 16-bit byte count plus a two-byte pad (`CONFIG_DESCRIPTOR_REPLY_PREFIX = 4`,
  [`src/server/handlers/config_descriptor/handle.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/config_descriptor/handle.rs#L23), [`.../reply.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../reply.rs#L22)).
- `OP_CONTROL_TRANSFER` is the general EP0 control passthrough: it unpacks a USB setup packet
  (`bmRequestType`, `bRequest`, `wValue`, `wIndex`, `wLength`), allocates a `wLength` data buffer when
  non-zero, runs the three-stage control transfer, and returns the actual 16-bit byte count plus any data
  read ([`src/server/handlers/control_transfer/handle.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/control_transfer/handle.rs#L22), [`.../reply.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../reply.rs#L22)).
- `OP_ALLOC_TRANSFER_RING` converts an endpoint address to a device context index, configures the
  endpoint through a Configure Endpoint command, and returns the assigned DCI
  ([`src/server/handlers/alloc_transfer_ring/handle.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/alloc_transfer_ring/handle.rs#L23), [`src/slots/dci.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/dci.rs#L16)).
- `OP_INTERRUPT_IN` polls a slot's interrupt-IN endpoint for one report up to `HID_REPORT_MAX = 8` bytes; a
  completed report returns the bytes, and a still-pending endpoint returns `E_AGAIN` in the status word so
  a HID capsule can poll without blocking the driver ([`src/server/handlers/interrupt_in.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/interrupt_in.rs#L22),
  [`src/server/handlers/interrupt_in/reply.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/interrupt_in/reply.rs#L23)).

## The handler layout

Handlers live under `src/server/handlers/`, one module per op ([`src/server/handlers/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L16)). A simple
op is a single file (`port_status.rs`, `health.rs`); an op with a data stage is a folder with `handle.rs`,
`reply.rs`, and `transfer.rs` split apart (`control_transfer/`, `config_descriptor/`,
`alloc_transfer_ring/`). The Address Device flow is large enough to be its own subtree, `address_flow/`,
covered on the [enumeration](/docs/userland/driver-xhci/enumeration/) page. Each handler takes the `Context` (which owns the one
`Driver`, [`src/server/context.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/context.rs#L17)), the decoded `Request`, the body slice, and the transmit buffer.

## Security of the surface

The surface is narrow and validated at three layers. The loop rejects a bad magic, a wrong version, a
length mismatch, or an over-long payload before any handler runs (`runner.rs:41`). Each body-carrying
handler then checks its exact body length before acting (the 1-byte disable, the 2-byte address, the
10-byte control transfer). And the slot id in a request is validated against the controller's `max_slots`
and the local table before it indexes anything ([`src/slots/table/valid.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/table/valid.rs#L16)), so a caller cannot walk
off the slot array. An enable the table cannot record is rolled back with a compensating disable
(`enable_slot.rs:36`). USB descriptor parsing is kept out entirely: the driver returns raw bytes, so a
malformed descriptor is a class-capsule concern, not a driver or kernel memory-safety one.

## Source map

```
  src/protocol/header.rs     the NXHC magic, version, and 20-byte header layout
  src/protocol/decode.rs     decode_request: magic/version validation
  src/protocol/encode.rs     encode_response_header, write_status
  src/protocol/ops.rs        the eleven opcodes
  src/protocol/errno.rs      E_INVAL, E_IO, E_NODEV, E_AGAIN
  src/protocol/limits.rs     every fixed body-length constant
  src/protocol/endpoint.rs   KERNEL_REPLY_ENDPOINT for pid-0 callers
  src/server/runner.rs       the sequential recv/dispatch/reply loop and length gate
  src/server/dispatch.rs     op -> handler routing and the E_INVAL default
  src/server/reply.rs        pid-correlated mk_ipc_reply / fixed-endpoint mk_ipc_send
  src/server/error.rs        reply_with_status, reply_decode_failed
  src/server/context.rs      the Context wrapping the one Driver
  src/server/handlers/       one handler (or handler folder) per op
```

Every reference above is verified against those trees.
