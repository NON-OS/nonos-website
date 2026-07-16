---
title: "Enumeration, the transport client, and the poll loop"
description: "The live driver face of capsuledriverusbhid brings up HID devices and drains them, and it does so entirely over IPC to driver.xhci0."
weight: 5
---
The live driver face of `capsule_driver_usb_hid` brings up HID devices and drains them, and it does so
entirely over IPC to `driver.xhci0`. This page walks the three folders that make that work: the xHCI
transport client (`src/xhci/`), the config-descriptor parse and HID classification
(`src/descriptors/`), and the discovery plus the cooperative poll loop (`src/orchestrator/`). The
split with the transport is strict: PCI, MMIO, IRQ, DMA, the xHCI rings, port reset, slot lifecycle,
and interrupt-transfer scheduling all live in `driver.xhci0`; this capsule never touches a device
register. For the class layer that turns a drained report into an input event see the
[input-post path](/docs/userland/driver-usb-hid/input-post/).

## The transport client

The client speaks the `NXHC` protocol (magic `0x4E58_4843`, version 1) to `driver.xhci0`
([`src/xhci/wire/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/wire/constants.rs#L19)). It resolves the transport port once, by name, at startup:
`lookup` calls `mk_service_lookup("driver.xhci0")` and returns the port on success
([`src/xhci/lookup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/lookup.rs#L19), [`src/xhci/lookup.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/lookup.rs#L24)). Every op is then a synchronous `mk_ipc_call`
through `call`, which frames a request with a per-request id, sends the body, parses the response
header, reads the 4-byte signed status, and returns `(status, data_len)`
([`src/xhci/call.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/call.rs#L29), [`src/xhci/call.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/call.rs#L45)). The request id comes from a monotonic counter that
skips zero ([`src/xhci/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/seq.rs#L21)).

The ops the client uses, one file each under `src/xhci/ops/`
([`src/xhci/ops/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/ops/mod.rs#L17)):

```
  OP_PORT_STATUS            0x0003   snapshot connected ports         constants.rs:26
  OP_ENABLE_SLOT            0x0004   enable a device slot             constants.rs:23
  OP_ADDRESS_DEVICE         0x0006   address the device               constants.rs:20
  OP_GET_CONFIG_DESCRIPTOR  0x0008   read the config descriptor       constants.rs:24
  OP_ALLOC_TRANSFER_RING    0x0009   allocate an interrupt ring       constants.rs:21
  OP_CONTROL_TRANSFER       0x000B   SET_PROTOCOL / SET_CONFIGURATION constants.rs:22
  OP_INTERRUPT_IN           0x000E   poll one interrupt IN report     constants.rs:25
```

Each op reply carries a small length prefix and the client bounds-checks it before copying. A
`port_status` reply is a count then 8-byte entries, capped at 255 ports
([`src/xhci/ops/port_status.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/ops/port_status.rs#L41), [`src/xhci/ops/port_status.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/ops/port_status.rs#L42)); a `get_config_descriptor` reply
is a 2-byte actual length then the bytes, bounded to the caller's buffer
([`src/xhci/ops/config_descriptor.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/ops/config_descriptor.rs#L39)); an `interrupt_in` reply is a 2-byte actual length then up to
8 report bytes, and a status of `E_AGAIN` (-11) is returned as `Ok(None)` meaning no report is pending
([`src/xhci/ops/interrupt_in.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/ops/interrupt_in.rs#L38), [`src/xhci/ops/interrupt_in.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/xhci/ops/interrupt_in.rs#L45)).

## The descriptor walk and HID classification

`hid_bindings` is a bounded, variable-length walk over a USB configuration descriptor
([`src/descriptors/parse.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L24)). It first validates the header: the buffer must be at least 9 bytes,
the first byte (the config descriptor's own length) at least 9, the second byte the configuration
descriptor type, and the declared `wTotalLength` at least 9 and no larger than the buffer
([`src/descriptors/parse.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L48)). It then walks the record list from offset 9 up to `wTotalLength`,
rejecting any record whose length is under 2 or runs past the total
([`src/descriptors/parse.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L30), [`src/descriptors/parse.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L32)). An interface descriptor of length 9 or
more sets the current interface; an endpoint descriptor of length 7 or more is paired with that
interface ([`src/descriptors/parse.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L36)). The walk caps at 8 bindings ([`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21),
[`src/descriptors/parse.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L40)).

`HidBinding::from_pair` decides what an interface-endpoint pair becomes
([`src/descriptors/binding.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/binding.rs#L32)). It accepts only a HID-class interface (class `0x03`) on an
interrupt IN endpoint, where interrupt IN is the direction bit set on the address and the interrupt
transfer type on the attributes ([`src/descriptors/binding.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/binding.rs#L33), [`src/descriptors/binding.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/binding.rs#L55)).
A boot-subclass keyboard becomes `HidKind::Keyboard`, a boot-subclass mouse becomes `HidKind::Mouse`,
and any other HID-class interface on such an endpoint becomes `HidKind::Tablet`
([`src/descriptors/binding.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/binding.rs#L36)). The boot subclass and keyboard/mouse protocol constants are in
[`src/descriptors/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/types.rs#L21). This one classification is shared by the live enumerator and the
`OP_PROBE_CONFIG` handler, so a probed descriptor is classified identically to a live one.

## Discovery

`enumerate` is discovery over the transport ([`src/orchestrator/enumerate/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/run.rs#L25)). It asks for a
port-status snapshot of up to 255 ports, and for each port whose `portsc` has the connected bit set it
calls `configure_port` ([`src/orchestrator/enumerate/run.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/run.rs#L31), [`src/orchestrator/enumerate/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/run.rs#L32)).

`configure_port` drives the standard USB bring-up as a sequence of xHCI ops
([`src/orchestrator/enumerate/configure_port.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/configure_port.rs#L28)): enable a slot, address the device, and sanity-check
the returned slot id, port id, speed, and max packet size before proceeding
([`src/orchestrator/enumerate/configure_port.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/configure_port.rs#L35)). It reads a 64-byte configuration descriptor
([`src/orchestrator/enumerate/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/constants.rs#L17), [`src/orchestrator/enumerate/configure_port.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/configure_port.rs#L43)),
walks it for HID bindings, returns early if there are none, then issues a `SET_CONFIGURATION` control
transfer (request type `0x00`, request `0x09`, value 1) before configuring each binding
([`src/orchestrator/enumerate/configure_port.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/configure_port.rs#L46), [`src/orchestrator/enumerate/configure_port.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/enumerate/configure_port.rs#L53)).

For each binding `configure_binding` selects the boot protocol and allocates the interrupt ring
([`src/orchestrator/binding.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/binding.rs#L24)). For a boot keyboard or mouse it first issues a `SET_PROTOCOL`
control transfer (request type `0x21`, request `0x0B`, value 0 = boot) so the device sends the fixed
boot report layout ([`src/orchestrator/binding.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/binding.rs#L30), [`src/orchestrator/binding.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/binding.rs#L33)). It then asks
the transport to allocate a transfer ring for the interrupt IN endpoint and records a `HidEndpoint`
holding the port, slot, device context index, kind, and max packet
([`src/orchestrator/binding.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/binding.rs#L35), [`src/orchestrator/binding.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/binding.rs#L44)). The boot protocol is what makes
the fixed 8-byte keyboard and 3-byte mouse layouts the parsers assume valid, without a report
descriptor parser.

## The poll loop

The runtime is one cooperative loop, not an event system. `orchestrator::run` blocks until the
transport is resolvable, yielding until `lookup` returns a port, then calls the poll loop
([`src/orchestrator/run.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/run.rs#L20), [`src/orchestrator/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/run.rs#L28)). The loop enumerates once, allocates its
receive and transmit buffers, and then repeats three things each iteration
([`src/orchestrator/poll/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/run.rs#L27)):

1. Service one request with `pump_once` (covered on the [protocol](/docs/userland/driver-usb-hid/protocol/) page)
   ([`src/orchestrator/poll/run.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/run.rs#L40)).
2. Drain every bound endpoint with `drain_endpoints`, which loops `interrupt_in` on each endpoint
   until it returns no pending report and feeds each report to the parser
   ([`src/orchestrator/poll/run.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/run.rs#L41), [`src/orchestrator/poll/drain_endpoints.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/drain_endpoints.rs#L29),
   [`src/orchestrator/poll/drain_endpoint.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/drain_endpoint.rs#L30)).
3. If no endpoints are bound and it has been idle for a rescan interval of 64 idle polls, re-enumerate
   to pick up a hot-plugged device ([`src/orchestrator/poll/run.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/run.rs#L46),
   [`src/orchestrator/poll/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/constants.rs#L18), [`src/orchestrator/poll/refresh_endpoints.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/refresh_endpoints.rs#L21)).

The drain is a poll, not an interrupt wait: the actual hardware interrupt handling lives in
`driver.xhci0`, and this capsule polls the transport for completed reports. A report is routed by
endpoint kind in `feed_report`: a keyboard report is copied into a fixed 8-byte buffer and fed to the
keyboard parser, a mouse report is fed to the mouse parser, a tablet report to the tablet parser, with
the key and mouse report counters bumped ([`src/orchestrator/poll/feed_report.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/feed_report.rs#L29)). The first time
any endpoint binds, the loop emits `[USB-HID-ENUM] tablet bound` through `mk_debug` exactly once
([`src/orchestrator/poll/run.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/run.rs#L35)). The parsers themselves are on the [input-post](/docs/userland/driver-usb-hid/input-post/)
page.

## Source map

```
  src/xhci/wire/constants.rs         the NXHC magic, version, op codes, E_AGAIN
  src/xhci/lookup.rs                 resolve driver.xhci0 by name once
  src/xhci/call.rs                   synchronous mk_ipc_call, request framing, status read
  src/xhci/seq.rs                    the monotonic request id counter
  src/xhci/ops/                      port_status, enable_slot, address_device, config descriptor,
                                     alloc_transfer_ring, control_transfer, interrupt_in
  src/descriptors/parse.rs           the bounded config-descriptor walk, hid_bindings
  src/descriptors/binding.rs         HID-class + interrupt-IN classification into HidKind
  src/descriptors/types.rs           the class/subclass/protocol constants and HidKind
  src/orchestrator/run.rs            wait for driver.xhci0, then enter the poll loop
  src/orchestrator/enumerate/run.rs  port scan then configure each connected port
  src/orchestrator/enumerate/configure_port.rs  slot, address, descriptor, SET_CONFIGURATION
  src/orchestrator/binding.rs        SET_PROTOCOL boot + alloc interrupt ring per binding
  src/orchestrator/enumerate/types.rs  HidEndpoint: port, slot, dci, kind, max_packet
  src/orchestrator/poll/run.rs       the cooperative loop: service, drain, rescan
  src/orchestrator/poll/drain_endpoints.rs  drain every bound endpoint
  src/orchestrator/poll/drain_endpoint.rs   loop interrupt_in until E_AGAIN
  src/orchestrator/poll/feed_report.rs      route a raw report to keyboard/mouse/tablet
  src/orchestrator/poll/refresh_endpoints.rs  re-enumerate on the rescan interval
  src/orchestrator/poll/constants.rs        HID_REPORT_MAX, RESCAN_INTERVAL
```

Every reference above is verified against those trees.
