---
title: "The TRB rings, doorbells, and the event engine"
description: "xHCI is a TRB-ring protocol. The driver builds a Transfer Request Block, writes it into a ring in DMA memory, rings a doorbell register, and the controller writes a completion T..."
weight: 3
---
xHCI is a TRB-ring protocol. The driver builds a Transfer Request Block, writes it into a ring in DMA
memory, rings a doorbell register, and the controller writes a completion TRB into the event ring and
raises the interrupter. This page mirrors the folders that own that machinery: `src/trb/` (the TRB struct,
its field accessors, and the builders), `src/rings/` (the command, event, and transfer ring state and
enqueue), the interrupter side of `src/regs/runtime/`, and `src/constants/` (the TRB kinds, flags,
completion codes, and ring sizes). How the rings are first allocated and programmed into the controller is
on the [bring-up](/docs/userland/driver-xhci/bring-up/) page; how enumeration drives them is on the [enumeration](/docs/userland/driver-xhci/enumeration/)
page; the wire surface above them is on the [operations](/docs/userland/driver-xhci/operations/) page.

## The TRB

A TRB is a 16-byte, 16-aligned block of four little-endian dwords ([`src/trb/base.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/base.rs#L16)). Everything else is
field access on those four dwords, one accessor per file under `src/trb/`:

```
  d0, d1   the parameter (a 64-bit pointer, or a setup packet)
  d2       the status (transfer length, completion code, residual)
  d3       the control (TRB type, cycle bit, flags, slot id)
```

`get_type` reads the six type bits out of `d3` ([`src/trb/get_type.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/get_type.rs#L19), shift `TRB_TYPE_SHIFT = 10`,
mask `TRB_TYPE_MASK`, [`src/constants/trb_flags.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/trb_flags.rs#L19)); `set_type` writes them ([`src/trb/set_type.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/set_type.rs)).
`get_cycle` / `set_cycle` handle the low bit `TRB_CYCLE` ([`src/constants/trb_flags.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/trb_flags.rs#L16)); `get_pointer`
recombines `d0` and `d1` into a 64-bit address ([`src/trb/get_pointer.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/get_pointer.rs#L18)), and `set_pointer` splits one.
`completion_code` reads the high byte of `d2`, and `slot_id` reads the high byte of `d3`. Ring memory is
touched only through `read_volatile_at` and `write_volatile_at` ([`src/trb/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/mod.rs#L32)), never a plain load
or store, because it is DMA memory the controller reads and writes concurrently.

The TRB type numbers the driver uses are named constants ([`src/constants/trb_kinds.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/trb_kinds.rs#L16)): Normal `1`,
Setup Stage `2`, Data Stage `3`, Status Stage `4`, Link `6`, Enable Slot `9`, Disable Slot `10`, Address
Device `11`, Configure Endpoint `12`, No Op `23`, Transfer Event `32`, and Command Completion Event `33`.
The completion codes are two constants: Success `1` and Short Packet `13` ([`src/constants/completion_codes.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/completion_codes.rs#L16)).

## The cycle bit and the link TRB

A ring has no head or tail register the driver reads; producer and consumer agree on ownership through the
cycle bit. Each ring tracks a `cycle` value, and every TRB it enqueues is stamped with it. The controller
consumes a TRB only when the TRB's cycle bit matches the cycle state it expects, and the driver reads an
event only when the event's cycle bit matches its own `consumer_cycle`. On every full lap the side that
wrapped flips its cycle, so a slot not yet written this lap still shows the old cycle and is skipped.

A ring wraps with a Link TRB in its last slot, pointing back at the ring base. `LinkTrbBuilder` builds it
with the target address, the `toggle_cycle` flag (`LINK_TC`, so the controller flips its cycle state when
it follows the link), and the current cycle ([`src/trb/builders/link/build.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/trb/builders/link/build.rs#L18),
[`src/constants/trb_flags.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/trb_flags.rs#L21)). The rings never actually run into the link at runtime because enqueue
stops one slot short, but the link is what makes the ring circular for the controller.

## The command ring

`CommandRing` is a 64-TRB DMA region, a cycle byte, and an enqueue index ([`src/rings/command/state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/command/state.rs#L21),
`COMMAND_RING_TRBS = 64`, [`src/constants/ring.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ring.rs#L17)). `new` allocates and zeroes the region and writes a
wrap link into the last slot (`state.rs:27`). `enqueue` refuses at the slot before the link
(`CommandRingFull`), stamps the TRB with the current cycle, writes it volatile at the enqueue index,
advances, and returns the TRB's device address so the completion can be matched by pointer
([`src/rings/command/enqueue.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/command/enqueue.rs#L22)). When the index reaches the last data slot it rewrites the link with the
current cycle, flips `self.cycle`, and wraps the index to zero (`enqueue.rs:31`). `crcr_value` is the value
step 11 of bring-up writes into `CRCR`: the ring's device address (aligned to 64) or'd with the cycle bit
([`src/rings/command/crcr_value.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/command/crcr_value.rs#L18)).

A command is issued by the same shape everywhere: build the command TRB with the ring's current cycle,
`enqueue` it to get its device address, ring doorbell 0 with target 0, then wait its completion. `No Op`
during bring-up ([`src/controller/issue_noop_and_wait.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_noop_and_wait.rs#L22)), and Enable Slot, Disable Slot, Address
Device, and Configure Endpoint during enumeration, all do exactly this.

## The doorbell

`ring_doorbell` writes a 32-bit doorbell register at `doorbell_base + slot * 4`
([`src/controller/ring_doorbell.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/ring_doorbell.rs#L17)). Doorbell 0 is the command ring; its target is always 0. A device's
doorbell is at `slot * 4`, and its target is the DCI of the endpoint whose ring just gained a TRB, so an
EP0 transfer rings `(slot, 1)` and an interrupt-IN endpoint rings `(slot, int_dci)`. The write is the only
thing that tells the controller a ring moved.

## The event ring and ERST

The controller reports completions on one event ring, described to it by an Event Ring Segment Table.
`EventRing` is the segment DMA region, the one-entry ERST region, a consumer cycle, a dequeue index, and a
running drained total ([`src/rings/event/state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/event/state.rs#L20), `EVENT_RING_SEGMENT_TRBS = 64`,
`EVENT_RING_SEGMENT_TABLE_ENTRIES = 1`, [`src/constants/ring.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ring.rs#L18)). `new` allocates both regions, zeroes
them, and writes the ERST entry: the segment's device address (low then high dword) and the segment size
(`state.rs:36`). `program_event_ring` then writes `ERSTSZ`, `ERDP`, and `ERSTBA` into the interrupter and
sets `IMAN.IE` ([`src/controller/program_event_ring.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/program_event_ring.rs#L19)).

The interrupter registers live at a fixed stride above the runtime base. `interrupter_addr` computes the
primary interrupter as `runtime_base + INTERRUPTER_STRIDE` (index 0, one stride in),
([`src/regs/runtime/interrupter_addr.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/runtime/interrupter_addr.rs#L17), `INTERRUPTER_STRIDE = 0x20`,
[`src/constants/runtime_offsets.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/runtime_offsets.rs#L16)). Within an interrupter: `IMAN` at `0x00`, `IMOD` at `0x04`, `ERSTSZ`
at `0x08`, `ERSTBA` at `0x10`, `ERDP` at `0x18` ([`src/constants/runtime_offsets.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/runtime_offsets.rs#L17)). `erdp_program`
writes the current dequeue device address, low three bits reserved for the segment index, with the
Event-Handler-Busy bit set when clearing (`ERDP_EHB`, [`src/regs/runtime/erdp_program.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/runtime/erdp_program.rs#L18),
[`src/constants/erdp_bits.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/erdp_bits.rs#L16)).

`has_event` reads the TRB at the dequeue index and returns true when its cycle bit equals the consumer
cycle ([`src/rings/event/has_event.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/event/has_event.rs#L18)). `advance` zeroes the consumed slot, bumps the drained total,
advances the dequeue index, and flips the consumer cycle on wrap ([`src/rings/event/advance.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/event/advance.rs#L20)).
`current_dequeue_phys` is the device address to write back into `ERDP` after consuming
([`src/rings/event/current_dequeue_phys.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/event/current_dequeue_phys.rs#L19)).

## Matching a completion

A blocking wait polls the event ring for the completion of a specific issued TRB.
`wait_command_completion` spins up to `1_000_000` times: on each event it reads the TRB, advances,
rewrites `ERDP`, skips anything that is not a Command Completion Event or whose pointer does not match the
issued device address (compared with the low nibble masked off), and on the match returns the completion
slot id or `CommandCompletionFailed(cc)` when the code is not Success
([`src/controller/wait_command_completion.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/wait_command_completion.rs#L25)). `wait_transfer_completion` is the same shape for a
Transfer Event, accepting Success or Short Packet as success ([`src/controller/wait_transfer_completion.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/wait_transfer_completion.rs#L21)).
Both time out into a distinct error the [debugging](/docs/userland/driver-xhci/debugging/) page maps.

## Draining and acknowledging in the server loop

The blocking waiters consume the events for commands and transfers the driver initiated. Everything else
(port status change events, and events that arrive between requests) is drained at the top of every server
loop pass so it cannot pile up. `service_interrupts` calls `drain_events` then `ack_irq`
([`src/server/service_interrupts.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/service_interrupts.rs#L19)). `drain_events` pulls up to `DRAIN_BATCH = 32` events, but stops
early on a Transfer Event or Command Completion Event, because those belong to a blocking waiter and must
not be swallowed here (`reserved_for_waiter`, [`src/controller/drain_events.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/drain_events.rs#L30)). It rewrites `ERDP`
once at the end. `ack_irq` clears the interrupt-pending bit in `IMAN` if set and calls `mk_irq_ack` on the
grant so the next MSI-X can be delivered ([`src/controller/ack_irq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/ack_irq.rs#L19), `IMAN_IP`,
[`src/constants/interrupter_bits.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/interrupter_bits.rs#L16)).

The interrupt is a wake hint, not the correctness mechanism. Every completion the driver actually depends
on is found by the cycle-and-pointer poll in the waiters, which is why the driver is correct even when the
event drain finds nothing and why the MSI-X binding is about latency, not liveness.

## Source map

```
  userland/capsule_driver_xhci/src/trb/base.rs                  the 16-byte Trb
  userland/capsule_driver_xhci/src/trb/get_type.rs              type field access (and the sibling accessors)
  userland/capsule_driver_xhci/src/trb/get_pointer.rs           the 64-bit pointer recombine
  userland/capsule_driver_xhci/src/trb/mod.rs                   read_volatile_at / write_volatile_at
  userland/capsule_driver_xhci/src/trb/builders/link/build.rs   the wrap Link TRB
  userland/capsule_driver_xhci/src/rings/command/state.rs       CommandRing and its link
  userland/capsule_driver_xhci/src/rings/command/enqueue.rs     enqueue, wrap, and the full check
  userland/capsule_driver_xhci/src/rings/command/crcr_value.rs  the CRCR value
  userland/capsule_driver_xhci/src/rings/event/state.rs         EventRing and the ERST entry
  userland/capsule_driver_xhci/src/rings/event/has_event.rs     the cycle-bit ownership test
  userland/capsule_driver_xhci/src/rings/event/advance.rs       dequeue advance and cycle flip
  userland/capsule_driver_xhci/src/controller/ring_doorbell.rs  the doorbell write
  userland/capsule_driver_xhci/src/controller/wait_command_completion.rs  command completion poll
  userland/capsule_driver_xhci/src/controller/wait_transfer_completion.rs transfer completion poll
  userland/capsule_driver_xhci/src/controller/drain_events.rs   the batch drain and the waiter reservation
  userland/capsule_driver_xhci/src/controller/ack_irq.rs        IMAN.IP clear and mk_irq_ack
  userland/capsule_driver_xhci/src/regs/runtime/               interrupter_addr, erdp/erstba/erstsz/imod/iman
  userland/capsule_driver_xhci/src/constants/trb_kinds.rs      the TRB type numbers
  userland/capsule_driver_xhci/src/constants/trb_flags.rs      cycle, IOC, IDT, LINK_TC, the type shift/mask
  userland/capsule_driver_xhci/src/constants/ring.rs           ring sizes and TRB_BYTES
  userland/capsule_driver_xhci/src/constants/completion_codes.rs  Success and Short Packet
  userland/capsule_driver_xhci/src/constants/runtime_offsets.rs   interrupter stride and register offsets
  userland/capsule_driver_xhci/src/constants/erdp_bits.rs      ERDP_EHB
  userland/capsule_driver_xhci/src/constants/interrupter_bits.rs  IMAN_IP / IMAN_IE
```

Every reference above is verified against those trees.
