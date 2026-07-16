---
title: "Device slots, addressing, and transfers"
description: "Bringing a USB device to life on xHCI is a sequence of controller commands and endpoint-0 transfers: enable a device slot, reset and read the root port, build an input context, ..."
weight: 4
---
Bringing a USB device to life on xHCI is a sequence of controller commands and endpoint-0 transfers:
enable a device slot, reset and read the root port, build an input context, run Address Device, then fetch
descriptors and configure the endpoints the device advertises. This page mirrors the folders that own that
per-device state: `src/slots/` (the slot table, the DCI mapping, and the per-slot resources),
`src/contexts/` (the input and device contexts), and `src/server/handlers/address_flow/` (the Address
Device flow), together with the control and interrupt transfer paths under `src/controller/` and
`src/trb/builders/`. The client ops that drive all this are described on the [operations](/docs/userland/driver-xhci/operations/)
page, which covers the request and reply bytes; this page covers the internals behind them. The rings and
TRBs everything stands on are on the [rings](/docs/userland/driver-xhci/rings/) page.

## The slot table

`SlotTable` holds two 256-wide boolean arrays (allocated and addressed), a vector of per-slot resources,
and a count ([`src/slots/table/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/table/types.rs#L21), `XHCI_SLOT_TABLE_LEN = 256`). A slot id is valid only when it
is non-zero and no greater than the controller's `max_slots` ([`src/slots/table/valid.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/table/valid.rs#L16)), so a request
can never index past the arrays. `mark_allocated` records an Enable Slot result, `attach_addressed` records
a completed Address Device and pushes the slot's resources, and `mark_released` / `take_resources` undo a
Disable Slot. `is_allocated` and `is_addressed` gate every op against the current state
(`src/slots/table/`).

## Enable Slot

`OP_ENABLE_SLOT` runs `issue_enable_slot`: build an Enable Slot command with slot type 0, enqueue, ring
doorbell 0, wait the completion, and read the assigned slot id out of the completion event; a zero id is a
controller error ([`src/controller/issue_enable_slot.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_enable_slot.rs#L22)). The handler then marks the id allocated in the
table, and if the table refuses it (already set), issues a compensating Disable Slot and returns `E_NODEV`
([`src/server/handlers/enable_slot.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/enable_slot.rs#L36)). The device slot exists at this point but has no context and no
address.

## Reset, speed, and the Address Device flow

`OP_ADDRESS_DEVICE` is large enough to be its own subtree, `address_flow/`
([`src/server/handlers/address_flow/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/mod.rs#L16)). The handler first checks `slot_ready`: the port is in
range, the slot is allocated, and it is not yet addressed ([`src/server/handlers/address_flow/slot_ready.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/slot_ready.rs#L18)).
Then it resets the root port and threads the result through five files:

1. **Reset the port.** `reset_port` first asserts Port Power if the firmware left it off and spins for the
   power-good delay while `PORTSC.CCS` (current connect status) settles, returning `NoDeviceOnPort` if
   nothing connects ([`src/controller/reset_port.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset_port.rs#L26), `power_on` at line 50). It then clears the port's
   change bits, writes `PORTSC.PR` (port reset) with the link-state field masked, and polls for both
   `PORTSC.PRC` (reset change) and `PORTSC.PED` (enabled) before returning the settled `PORTSC` word
   (`reset_port.rs:33`). The power-on step and the comment explaining it exist specifically because QEMU
   asserts connect immediately while real host controllers need the driver to power the port and wait.
2. **Read the speed.** `port_speed` extracts the four speed bits from `PORTSC`
   ([`src/server/handlers/address_flow/port_speed.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/port_speed.rs#L18)). A zero speed is a device that went away, and
   `address_after_reset` returns `E_NODEV` ([`src/server/handlers/address_flow/address_after_reset.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/address_after_reset.rs#L30)).
3. **Allocate resources.** `alloc_resources` calls `SlotResources::allocate`, which allocates the output
   (device) context, the input context, and the EP0 transfer ring from the DMA pool, derives EP0's max
   packet size from the speed, and writes the Address Device input context
   ([`src/server/handlers/address_flow/alloc_resources.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/alloc_resources.rs#L20), [`src/slots/resources.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/resources.rs#L36)).
4. **Program the DCBAA and run the command.** `complete_address` writes the output-context device address
   into the slot's DCBAA entry, then `command_address` runs the Address Device command
   ([`src/server/handlers/address_flow/complete_address.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/complete_address.rs#L24),
   [`src/server/handlers/address_flow/command_address.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/command_address.rs#L21), [`src/controller/issue_address_device.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_address_device.rs#L22)).
   A command failure clears the DCBAA entry and returns `E_IO`.
5. **Attach and reply.** `attach_resources` records the slot as addressed and stores its resources, or
   rolls the DCBAA entry back and returns `E_INVAL` if the table refuses; on success it replies with slot,
   port, speed, and EP0 max packet size ([`src/server/handlers/address_flow/attach_resources.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/attach_resources.rs#L23),
   [`src/server/handlers/address_reply.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_reply.rs#L20)).

## The input and device contexts

The controller reads a device's configuration from a context in DMA memory. The context slot size is
`context_size`, 32 or 64 bytes per context depending on the `CSZ` capability bit, decoded at bring-up
([`src/regs/cap/context_size.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/cap/context_size.rs#L19)). A device (output) context is 32 context slots; an input context is 33
(a leading Input Control context plus 32) ([`src/contexts/size.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/contexts/size.rs#L16)).

`write_address_device_input` builds the input context for Address Device
([`src/contexts/input.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/contexts/input.rs#L21)): the Input Control context adds the Slot and EP0 contexts (`ADD_SLOT_AND_EP0 =
0x3`); the Slot context carries the root port number and the speed with one context entry; and the EP0
context is a Control endpoint (type 4) with the max packet size, the CErr retry count, and the EP0 ring's
device address with the Dequeue Cycle State bit set (`write_ep0`, `input.rs:40`). Every field is written at
`context * context_size + dword * 4`, so the same code lays out 32- and 64-byte contexts correctly
(`write_dw`, `input.rs:47`). `max_packet_for_speed` maps the xHCI speed id to the EP0 default: 512 for
SuperSpeed (speeds 4 and 5), 64 for High Speed (3), 8 otherwise ([`src/contexts/ep0.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/contexts/ep0.rs#L16)).

`write_configure_endpoint_input` builds the input context for Configure Endpoint
([`src/contexts/configure_ep.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/contexts/configure_ep.rs#L26)): the Input Control context adds the slot and the endpoint's DCI, the
Slot context is rewritten with the new context-entries count, and the endpoint context is an Interrupt IN
endpoint (type 7) with its ring device address, max packet, interval, and max-ESIT-payload
(`write_endpoint`, `configure_ep.rs:43`).

## The DCI

An endpoint is named to the controller by its Device Context Index, not its USB endpoint address.
`dci_from_ep_address` computes it: `2 * ep_num + (dir_in ? 1 : 0)`, so EP0 is DCI 1, endpoint 1 OUT is
DCI 2, endpoint 1 IN is DCI 3, and so on ([`src/slots/dci.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/dci.rs#L16)). Every endpoint doorbell target and every
endpoint context index derives from this.

## Control transfers

A control transfer is a three-stage TRB sequence on the EP0 ring: a Setup Stage TRB carrying the eight-byte
USB setup packet, an optional Data Stage TRB, and a Status Stage TRB, then doorbell `(slot, 1)` and a wait
on the Status Stage's completion. `issue_control_transfer` builds them, choosing the direction from
`bmRequestType` and the data length, and picking the Data and Status stage direction accordingly: a
device-to-host read gets a Data Stage IN and a Status Stage OUT, a host-to-device write the reverse, and a
no-data request just Setup and Status ([`src/controller/issue_control_transfer.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_control_transfer.rs#L27), the `direction`
helper at line 56). The Setup Stage TRB packs the setup packet into `d0`/`d1`, the transfer type into `d2`,
and sets the Immediate Data flag ([`src/trb/builders/setup_stage_generic.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/builders/setup_stage_generic.rs#L24)). This path backs
`OP_CONTROL_TRANSFER`, and the descriptor fetches are specialisations of it.

`get_device_descriptor` is the fixed 18-byte case: a `GET_DESCRIPTOR(Device)` setup, a Data Stage IN into
an 18-byte DMA buffer, a Status Stage OUT, doorbell `(slot, 1)`, and a wait
([`src/controller/get_device_descriptor.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/get_device_descriptor.rs#L26)). The configuration-descriptor and general control-transfer
handlers build on the same three-stage machinery with a caller-sized data buffer, described in the op table
on the [operations](/docs/userland/driver-xhci/operations/) page. The driver copies the raw descriptor bytes back and never parses
them; a malformed descriptor is a class-capsule concern.

## Interrupt-IN transfers

A HID device delivers reports on an Interrupt IN endpoint, which needs its own transfer ring and a
Configure Endpoint command first. `OP_ALLOC_TRANSFER_RING` runs `do_configure`: allocate a new transfer
ring and a report buffer, store them plus the DCI on the slot's resources, write the Configure Endpoint
input context, and run the Configure Endpoint command ([`src/server/handlers/alloc_transfer_ring/configure.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/alloc_transfer_ring/configure.rs#L23),
[`src/controller/issue_configure_endpoint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_configure_endpoint.rs#L22)). The handler converts the endpoint address to a DCI and
returns it ([`src/server/handlers/alloc_transfer_ring/handle.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/alloc_transfer_ring/handle.rs#L23)).

`OP_INTERRUPT_IN` then polls that endpoint without blocking the server. `poll_interrupt_in` arms the ring
once, if not already armed, by enqueuing a Normal TRB pointing at the report buffer and ringing the
endpoint's doorbell ([`src/controller/poll_interrupt_in/mod.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/poll_interrupt_in/mod.rs#L25),
[`src/controller/poll_interrupt_in/arm.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/poll_interrupt_in/arm.rs#L20)). `scan` then checks the event ring for a Transfer Event
matching the armed TRB: if present it consumes it, disarms, and returns the transferred byte count computed
from the residual; if absent it returns `Pending` ([`src/controller/poll_interrupt_in/scan.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/poll_interrupt_in/scan.rs#L23)). The
handler turns `Pending` into an `E_AGAIN` status so a HID capsule can poll in a loop without the driver
ever blocking on a device that has nothing to report ([`src/server/handlers/interrupt_in.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/interrupt_in.rs#L22)).

## Security of the per-device path

The slot id in every request is validated against `max_slots` and the local allocation state before it
indexes anything ([`src/slots/table/valid.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/slots/table/valid.rs#L16), `slot_ready`), so a caller cannot walk off the slot arrays
or address a slot it never enabled. State transitions are one-way and checked: an Enable the table cannot
record is rolled back with a Disable (`enable_slot.rs:36`), an Address Device the table refuses rolls back
the DCBAA entry (`attach_resources.rs:32`), and a failed command clears the DCBAA slot it set
(`complete_address.rs:37`). Every context and ring is a broker DMA grant with a device address the
controller is programmed from, never a physical address the capsule chose. Descriptor bytes are returned
raw, so descriptor parsing is never a driver or kernel memory-safety concern.

## Source map

```
  userland/capsule_driver_xhci/src/slots/table/types.rs      SlotTable arrays and count
  userland/capsule_driver_xhci/src/slots/table/valid.rs      the slot-id bound
  userland/capsule_driver_xhci/src/slots/table/attach_addressed.rs  record an addressed slot
  userland/capsule_driver_xhci/src/slots/resources.rs        SlotResources::allocate
  userland/capsule_driver_xhci/src/slots/dci.rs              dci_from_ep_address
  userland/capsule_driver_xhci/src/contexts/size.rs          input/device context byte sizes
  userland/capsule_driver_xhci/src/contexts/input.rs         Address Device input context
  userland/capsule_driver_xhci/src/contexts/ep0.rs           max_packet_for_speed
  userland/capsule_driver_xhci/src/contexts/configure_ep.rs  Configure Endpoint input context
  userland/capsule_driver_xhci/src/server/handlers/address_flow/  the five-file Address Device flow
  userland/capsule_driver_xhci/src/server/handlers/address_reply.rs  the address reply body
  userland/capsule_driver_xhci/src/server/handlers/enable_slot.rs    Enable Slot + rollback
  userland/capsule_driver_xhci/src/server/handlers/alloc_transfer_ring/  Configure Endpoint + DCI reply
  userland/capsule_driver_xhci/src/server/handlers/interrupt_in.rs   the non-blocking poll handler
  userland/capsule_driver_xhci/src/controller/reset_port.rs   power-on, reset, and the CCS/PRC/PED waits
  userland/capsule_driver_xhci/src/controller/issue_enable_slot.rs   Enable Slot command
  userland/capsule_driver_xhci/src/controller/issue_address_device.rs Address Device command
  userland/capsule_driver_xhci/src/controller/issue_configure_endpoint.rs Configure Endpoint command
  userland/capsule_driver_xhci/src/controller/dcbaa_slot.rs   set/clear a DCBAA slot entry
  userland/capsule_driver_xhci/src/controller/issue_control_transfer.rs  the three-stage EP0 transfer
  userland/capsule_driver_xhci/src/controller/get_device_descriptor.rs  the fixed 18-byte fetch
  userland/capsule_driver_xhci/src/controller/poll_interrupt_in/  arm and scan the interrupt-IN endpoint
  userland/capsule_driver_xhci/src/trb/builders/setup_stage_generic.rs  the Setup Stage TRB
  userland/capsule_driver_xhci/src/rings/transfer/            the per-endpoint TransferRing
```

Every reference above is verified against those trees.
