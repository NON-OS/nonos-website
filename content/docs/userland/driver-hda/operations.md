---
title: "Operations, protocol, and the request loop"
description: "This page mirrors the serving half of the driver: src/protocol/ (the wire format), src/server/ (the request loop and the per-op handlers), and src/handles/ (the broker-grant own..."
weight: 3
---
This page mirrors the serving half of the driver: `src/protocol/` (the wire format), `src/server/` (the
request loop and the per-op handlers), and `src/handles/` (the broker-grant owner). It is what happens
after `setup::run` returns a `Driver`: an endless loop that decodes one request, dispatches on the
opcode, and sends one reply, touching the broker only to drain the controller interrupt. For the
privileged bring-up that produced the `Driver`, see [bringup.md](/docs/userland/driver-hda/bringup/); for the driver's identity
and mask, see the [README](/docs/userland/driver-hda/).

The driver is a pure server. It never calls another userland service. Every inbound message is a query on
its endpoint, and the only outbound calls it makes are the interrupt poll and ack.

## The wire format

The protocol is a fixed 20-byte header on both request and reply, tagged `NHDA`
([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17), `:19`). A request carries an opcode and no body; a reply reuses the same
header shape and begins its body with a 4-byte status word.

```
  offset  size  field                         source
  0       4     magic     = 0x4e48_4441 NHDA   header.rs:17, decode.rs:23
  4       2     version   = 1                   header.rs:18, decode.rs:26
  6       2     op                              decode.rs:30
  8       2     flags                           decode.rs:31
  10      2     reserved                         encode.rs:24 (zeroed on reply)
  12      4     request_id                       decode.rs:32
  16      4     payload_len                      decode.rs:33
```

`decode_request` validates the frame before it is trusted: a buffer shorter than 20 bytes, a magic that
is not `NHDA`, or a version that is not 1 all return `None`, and the caller answers `E_INVAL`
([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), `:23`, `:26`). A valid header decodes into a `Request` carrying the op,
flags, request id, and payload length ([`src/protocol/header.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L22), [`src/protocol/decode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L29)).

`encode_response_header` writes the reply header back, echoing the request's op, flags, and request id,
zeroing the reserved field, and stamping the reply's payload length; `write_status` writes the 4-byte
little-endian status word that opens every reply body ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19), `:29`).

## Errno

Only two status values exist ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_OK       0     success
  E_INVAL  -22     bad magic/version, an unknown opcode, or any op carrying a payload
```

`E_INVAL` is the only error the runtime returns. There is no per-operation failure: every op is a
register read or an in-memory projection that cannot fail once the header is accepted.

## The five operations

The service accepts one request at a time, decodes the header, and dispatches on the operation id
([`src/server/runner/run.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L54)). The opcodes are defined in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs).

| Op | Opcode | Request | Reply body | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | none | status word only | `ops.rs:17`, [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_CONTROLLER_INFO` | 2 | none | status + 28-byte register record | `ops.rs:18`, [`handlers/controller_info.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/controller_info.rs#L26) |
| `OP_CODEC_MASK` | 3 | none | status + 8-byte mask payload | `ops.rs:19`, [`handlers/codec_mask.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/codec_mask.rs#L26) |
| `OP_STREAM_LAYOUT` | 4 | none | status + 4-byte count + 8-byte entries | `ops.rs:20`, [`handlers/stream_layout.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/stream_layout.rs#L26) |
| `OP_CODEC_LIST` | 5 | none | status + 4-byte count + 8-byte entries | `ops.rs:21`, [`handlers/codec_list.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/codec_list.rs#L25) |

Every op is payload-free and fixed-shape. Each handler builds its reply directly, prepends the response
header and the status word, and sends the whole frame to the kernel reply inbox with `mk_ipc_send`.

### OP_HEALTHCHECK

The simplest handler: it replies `E_OK` with a status word and no body
([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). It confirms the service is up and answering without touching a
register.

### OP_CONTROLLER_INFO

Re-reads the HDA global registers live at request time and returns a 28-byte record
([`src/server/handlers/controller_info.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L26)). It calls `ControllerInfo::read` again, so the reply is the
current controller state, not the setup-time snapshot ([`src/server/handlers/controller_info.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L27)). The
record is laid out in order ([`src/server/handlers/controller_info.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L32)):

```
  u16 gcap
  u8  vmin
  u8  vmaj
  u16 outpay
  u16 inpay
  u32 gctl
  u16 statests
  u16 gsts
  u32 intctl
  u32 intsts
  u8  input_streams        GCAP-derived
  u8  output_streams       GCAP-derived
  u8  bidi_streams         GCAP-derived
  u8  addr64               GCAP bit 0
```

The four trailing counts are the `GCAP` decode described on the [bringup](/docs/userland/driver-hda/bringup/) page
([`src/controller/info.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L53)). The payload length is `4 + 28` and the frame is sent to the reply inbox
([`src/server/handlers/controller_info.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L28), `:49`).

### OP_CODEC_MASK

Returns the codec-presence mask ([`src/server/handlers/codec_mask.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/codec_mask.rs#L26)). It re-reads `ControllerInfo`,
masks `STATESTS` to its low 15 bits, and returns that mask as a `u16`, two reserved bytes, and the
popcount of the mask as a 4-byte set count ([`src/server/handlers/codec_mask.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/codec_mask.rs#L28), `:32`). The 8-byte
payload is therefore the presence bitmap plus the count of codecs the controller sees on the link.

### OP_STREAM_LAYOUT

Returns the computed stream layout ([`src/server/handlers/stream_layout.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stream_layout.rs#L26)). It re-reads
`ControllerInfo`, runs `layout`, and emits a 4-byte entry count followed by one 8-byte entry per stream
([`src/server/handlers/stream_layout.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stream_layout.rs#L28), `:35`):

```
  u8  kind                 1 input, 2 output, 3 bidirectional
  u8  local_index          index within its kind
  u16 global_index
  u32 stream_descriptor_offset   0x80 + global_index * 0x20
```

The offset is computed, not read from a live descriptor; the derivation is on the [bringup](/docs/userland/driver-hda/bringup/)
page ([`src/controller/stream_layout.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/stream_layout.rs#L48)). The reply length grows with the number of streams the
controller advertises.

### OP_CODEC_LIST

Returns the probed codec inventory captured at setup ([`src/server/handlers/codec_list.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/codec_list.rs#L25)). Unlike the
three handlers above, this one does not re-read a register: it filters the `Driver`'s stored `codecs`
array to the present entries and emits a 4-byte count followed by one 8-byte entry per present codec
([`src/server/handlers/codec_list.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/codec_list.rs#L26), `:33`):

```
  u8  codec_address
  u8  probe_ok             1 = vendor id read, 0 = present but the verb timed out
  u16 vendor_id
  u16 device_id
  u16 reserved             zeroed
```

A present codec with `probe_ok = 0` was detected on the link but its immediate-command verb timed out at
setup, so its ids are zero ([`src/controller/codec_probe.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L56)). This is the honest inventory: presence
and identity are separate fields.

## The request loop

`run` is the endless server loop ([`src/server/runner/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L32)). Its buffers are sized once: the receive
buffer is exactly the 20-byte header, and the transmit buffer is the header plus a status word plus the
largest possible body, computed at compile time ([`src/server/runner/run.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L30),
[`src/server/runner/max_tx_body.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/max_tx_body.rs#L19)). `max_tx_body` takes the max of the stream-layout and codec-list
worst cases, both derived from the protocol limits, so the buffer never needs to grow
([`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22), `:25`).

Each iteration ([`src/server/runner/run.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L37)):

1. Poll and drain the controller interrupt (below).
2. `mk_ipc_recv` blocks for a request; a non-positive length is skipped
   ([`src/server/runner/run.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L39)).
3. `decode_request` validates the header; a bad frame is answered with `E_INVAL` through
   `reply_decode_failed` and the loop continues ([`src/server/runner/run.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L43),
   [`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)).
4. Any request declaring a non-zero `payload_len` is rejected with `E_INVAL` before dispatch, so no op
   ever sees caller data ([`src/server/runner/run.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L50)).
5. The opcode selects a handler; an unknown opcode falls to the `_ =>` arm and answers `E_INVAL`
   ([`src/server/runner/run.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L54), `:60`).

The two guards in steps 3 and 4 mean the entire input surface is a bare 20-byte `NHDA` v1 header with an
opcode. `reply_with_status` and `reply_decode_failed` are the two error replies; both build a
status-only frame and send it to `KERNEL_REPLY_ENDPOINT` ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23), `:29`).

## The runtime interrupt poll

`poll_irq` runs at the top of every loop iteration ([`src/server/runner/poll_irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/poll_irq.rs#L21)). It calls
`mk_irq_poll` on the IRQ grant id; when the returned sequence number differs from the last seen one, it
records the new sequence and acknowledges with `mk_irq_ack` ([`src/server/runner/poll_irq.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/poll_irq.rs#L23)). This
keeps the controller interrupt drained but gates nothing: every op is a synchronous register read, so no
request ever waits on an interrupt. The interrupt is bound purely so the controller is owned end to end
and does not raise an unhandled line. There is no interrupt-driven work in this slice, because there is no
stream DMA to complete.

## Endpoints and the broker-grant owner

The service name and the reply inbox are constants ([`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17), `:18`):

```
  SERVICE_NAME          = "driver.hda0"
  KERNEL_REPLY_ENDPOINT = 0x1_0000_0010   (endpoint.4294967312 on the kernel side)
```

Every reply is sent to `KERNEL_REPLY_ENDPOINT`; the [README](/docs/userland/driver-hda/) identity table shows that this id
is the same reply inbox the kernel spawn record names.

All three broker grants the driver holds are owned by one `BrokerHandles`, built at the end of setup from
the device id, the MMIO grant id and user VA, and the IRQ grant id
([`src/handles/broker_handles.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles.rs#L17), `:25`). Its accessors expose the IRQ grant id for the poll and the
MMIO user VA for the register base ([`src/handles/broker_handles_irq_grant_id.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_irq_grant_id.rs#L20),
[`src/handles/broker_handles_mmio_user_va.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_mmio_user_va.rs#L20)). Its `Drop` releases the grants in reverse acquisition
order: it unbinds the interrupt, unmaps BAR0, and releases the device claim
([`src/handles/broker_handles_drop.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_drop.rs#L22)). Because the `Driver` lives for the whole program, this cleanup
runs at process teardown, and the kernel's exit-path revocation is the backstop if the process is killed.

## Outbound broker calls

The driver makes no calls to other userland services. Its only outbound syscalls are broker calls, all
documented in the hardware-broker subsystem:

```
  mk_device_list       enumerate audio-class devices   src/discover.rs:34
  mk_device_claim      claim the HDA function           src/setup/claim.rs:22   (claim.md)
  mk_pci_config_write  set the PCI bus-master bit        src/setup/pci.rs:22     (claim.md)
  mk_mmio_map          map BAR0 into the capsule VA      src/setup/mmio.rs:24    (mmio.md)
  mk_mmio_unmap        unmap BAR0 on failure or teardown src/setup/mmio.rs:26, handles/broker_handles_drop.rs:24   (mmio.md)
  mk_irq_bind          bind the controller interrupt     src/setup/irq.rs:24     (irq.md)
  mk_irq_poll          poll for interrupt events         src/server/runner/poll_irq.rs:23   (irq.md)
  mk_irq_ack           acknowledge a delivered interrupt src/server/runner/poll_irq.rs:25   (irq.md)
  mk_irq_unbind        release the interrupt on teardown src/handles/broker_handles_drop.rs:23   (irq.md)
  mk_device_release    release the device claim          src/handles/broker_handles_drop.rs:25   (claim.md)
```

There is no `mk_dma_map` anywhere in the capsule, which matches the missing `Dma` bit in the mask. The
[claim](/docs/subsystems/hardware-broker/claim/), [mmio](/docs/subsystems/hardware-broker/mmio/), and
[irq](/docs/subsystems/hardware-broker/irq/) pages describe how each grant is validated, bounded to the
claim epoch, and revoked.

## Source map

This page is drawn from the protocol, server, and handles modules of the capsule, and the broker grant
contracts under `docs/subsystems/hardware-broker/`.

```
  userland/capsule_driver_hda/src/protocol/header.rs            the NHDA header and Request
  userland/capsule_driver_hda/src/protocol/decode.rs            decode_request and its validation
  userland/capsule_driver_hda/src/protocol/encode.rs            encode_response_header, write_status
  userland/capsule_driver_hda/src/protocol/ops.rs               the five opcode constants
  userland/capsule_driver_hda/src/protocol/errno.rs             E_OK / E_INVAL
  userland/capsule_driver_hda/src/protocol/limits.rs            payload sizes and worst-case bodies
  userland/capsule_driver_hda/src/protocol/endpoint.rs          SERVICE_NAME, KERNEL_REPLY_ENDPOINT
  userland/capsule_driver_hda/src/server/runner/run.rs          the request loop, dispatch, and guards
  userland/capsule_driver_hda/src/server/runner/poll_irq.rs     mk_irq_poll / mk_irq_ack each iteration
  userland/capsule_driver_hda/src/server/runner/max_tx_body.rs  the compile-time tx buffer size
  userland/capsule_driver_hda/src/server/handlers/              one file per op
  userland/capsule_driver_hda/src/server/error.rs               reply_with_status / reply_decode_failed
  userland/capsule_driver_hda/src/handles/                      BrokerHandles and its Drop
  docs/subsystems/hardware-broker/claim.md                      the claim and epoch
  docs/subsystems/hardware-broker/mmio.md                       the BAR0 mapping
  docs/subsystems/hardware-broker/irq.md                        the interrupt bind, poll, and ack
```

Every reference above is verified against those trees.
