---
title: "The descriptor rings and the DMA engine"
description: "The RTL8169 is a descriptor-ring device. The driver keeps two rings in DMA memory, one for receive and one for transmit, each a fixed array of sixteen descriptors that point at ..."
weight: 6
---
The RTL8169 is a descriptor-ring device. The driver keeps two rings in DMA memory, one for receive and one
for transmit, each a fixed array of sixteen descriptors that point at packet buffers. Each descriptor carries
an ownership bit that hands the slot back and forth between the driver and the NIC: the driver sets `OWN`
when it wants the controller to act on a slot, and the controller clears `OWN` when it is done. This page
mirrors the three folders that own that machinery: `src/queue/` (the descriptor struct and the ring
cursors), `src/tx/` (the transmit path), and `src/rx/` (the receive path). How the rings are first allocated
and programmed is on the [bring-up](/docs/userland/driver-rtl8169/bring-up/) page; the client ops that call into them are on the
[operations](/docs/userland/driver-rtl8169/operations/) page.

## Two rings

The driver runs two rings, each sixteen descriptors deep (`RX_DESC_COUNT` and `TX_DESC_COUNT`, both `16`,
[`src/constants/queue.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L17)). A descriptor is `16` bytes (`DESC_BYTES`), so each ring is `256` bytes, and
each ring is backed by a pool of sixteen `2048`-byte packet buffers (`BUFFER_SIZE`,
[`src/constants/queue.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L19)). The ring bytes and buffer bytes are the DMA region sizes the bring-up allocates
([`src/constants/queue.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L21)).

Each ring is a `RxRing` or `TxRing`: the descriptor-array user VA, the buffer-pool user VA, the descriptor
device address, the buffer device address, and a software cursor `cur` into the ring
([`src/queue/rx_ring.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx_ring.rs#L20), [`src/queue/tx_ring.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx_ring.rs#L20)). Both expose a `buffer_va(idx)` and a `buffer_da(idx)`
that index into the pool at `idx % COUNT * BUFFER_SIZE`, so a descriptor's buffer is a fixed slot in the pool
([`src/queue/rx_ring.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx_ring.rs#L33), [`src/queue/tx_ring.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx_ring.rs#L33)).

## The descriptor

A descriptor is a `#[repr(C)]` struct of four `u32` fields: `opts1`, `opts2`, and the low and high halves of
the buffer device address ([`src/queue/desc.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/desc.rs#L19)). The `desc` and `desc_mut` helpers do a volatile read and
write of a descriptor at an index off the ring base, so a descriptor update is always a volatile store the
NIC can observe ([`src/queue/desc.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/desc.rs#L28), [`src/queue/desc.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/desc.rs#L32)).

The `opts1` field packs the control bits and the length ([`src/constants/regs.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L51)):

```
  OWN       1 << 31   set: the NIC owns the slot; clear: the driver owns it
  EOR       1 << 30   end of ring, set on the last descriptor so the NIC wraps
  FS        1 << 29   first segment of a frame
  LS        1 << 28   last segment of a frame
  LEN_MASK  0x3FFF    the buffer or frame length in the low 14 bits
```

## The OWN handshake

The `OWN` bit is the whole synchronization mechanism, and it works in opposite directions on the two rings.

On the RX ring, the driver primes every descriptor with `OWN` set and the buffer size as the length, handing
all sixteen slots to the NIC up front ([`src/init/rx_setup.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L31)). The NIC DMAs a received frame into the
slot's buffer, writes the frame length and the `FS`/`LS` bits into `opts1`, and clears `OWN`. The driver's
receive path reads the descriptor at its cursor and treats a set `OWN` as "nothing here yet"
([`src/rx/recv_one.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L44)); a cleared `OWN` means a frame has landed.

On the TX ring, it is the reverse. The driver primes every descriptor with `OWN` clear, keeping ownership
([`src/init/tx_setup.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/tx_setup.rs#L29)). To transmit, the driver copies the frame into the slot's buffer, writes the
descriptor with `OWN | FS | LS` and the frame length, and rings the transmit-poll register; the NIC DMAs the
buffer out and clears `OWN` when done ([`src/tx/send.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L42)). The driver's send path waits for `OWN` to clear
to know the frame left ([`src/tx/poll_done.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/poll_done.rs#L28)).

A `compiler_fence` sits on both sides of each ownership transfer so the buffer copy and the descriptor store
are not reordered around the `OWN` write. The send path fences `Release` after copying the frame and before
writing `OWN` ([`src/tx/send.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L39)); the receive path fences `Acquire` before reading the descriptor and the
rearm fences `Release` before handing a slot back ([`src/rx/recv_one.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L41), [`src/rx/rearm.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/rearm.rs#L33)). These are
compiler fences, correct against a device that observes program-order stores on this target; they order the
compiler, not a weakly-ordered interconnect.

## The transmit path

`tx::send` transmits one frame ([`src/tx/send.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L27)):

1. It reads the descriptor at the current TX cursor and returns "descriptor busy" if `OWN` is still set,
   meaning the previous frame in that slot has not drained ([`src/tx/send.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L29)).
2. It copies the frame into the slot's buffer with `copy_nonoverlapping`, bounded by the caller's frame
   length, which the [operations](/docs/userland/driver-rtl8169/operations/) page already checked against the Ethernet size limits
   ([`src/tx/send.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L33)).
3. After a `Release` fence it writes the descriptor with `OWN | FS | LS`, the `EOR` bit if this is the last
   slot, and the frame length, then writes `TX_POLL_HPQ` to the transmit-poll register to tell the NIC a
   high-priority descriptor is ready ([`src/tx/send.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L42), [`src/tx/send.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L50)).
4. `poll_done` spins up to a million iterations for `OWN` to clear, returning a timeout otherwise
   ([`src/tx/poll_done.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/poll_done.rs#L25)).
5. It reads the ISR, acknowledges the interrupt sources it enabled by writing them back, and returns a
   transmit error if the TX-error bit is set ([`src/tx/send.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L53)). On success it advances the cursor modulo
   the ring depth ([`src/tx/send.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L62)).

## The receive path

`rx::recv_one` polls for one frame and returns `Ok(Some(len))` on a frame, `Ok(None)` on an empty ring, or an
error ([`src/rx/recv_one.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L30)):

1. It reads the ISR, acknowledges the enabled sources, and if the RX-error bit is set acknowledges the IRQ
   grant and returns an error ([`src/rx/recv_one.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L31)).
2. After an `Acquire` fence it reads the descriptor at the RX cursor. If `OWN` is still set the ring is empty:
   it acknowledges the IRQ grant and returns `Ok(None)` ([`src/rx/recv_one.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L44)).
3. It extracts the length from `LEN_MASK` and validates the descriptor: both `FS` and `LS` must be set (a
   single-descriptor frame), the length must be more than the 4-byte trailing CRC, no larger than the buffer,
   no larger than the maximum Ethernet frame after removing the CRC, and no larger than the caller's output
   slice. A descriptor that fails any check is rearmed and dropped with an error
   ([`src/rx/recv_one.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L48)).
4. It copies the frame, minus its 4-byte CRC, out of the slot's buffer into the caller's slice
   ([`src/rx/recv_one.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L59)).
5. `rearm` re-primes the descriptor with `OWN` set, the `EOR` bit if it is the last slot, and the buffer
   size, handing the slot back to the NIC ([`src/rx/rearm.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/rearm.rs#L24)). It advances the cursor, acknowledges the
   IRQ grant, and returns the frame length ([`src/rx/recv_one.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L67)).

Stripping the 4-byte Ethernet FCS is why the reported frame length is the descriptor length minus four
([`src/rx/recv_one.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L59)), and the descriptor-error check rejects a length of four or less so the subtraction
can never underflow ([`src/rx/recv_one.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L50)).

## The interrupt

The bound interrupt is acknowledged, not waited on. The receive path is where the IRQ grant is acked, on
every outcome: an RX error, an empty ring, a bad descriptor, and a good frame all call `mk_irq_ack` before
returning ([`src/rx/recv_one.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L38), [`src/rx/recv_one.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L45), [`src/rx/recv_one.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L56),
[`src/rx/recv_one.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L69)). The transmit path clears the ISR sources it enabled but does not touch the grant
([`src/tx/send.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L53)). Because the server loop drives receive by client poll rather than by an interrupt wait
(see [operations](/docs/userland/driver-rtl8169/operations/)), the interrupt is a device-level acknowledgement, and correctness comes
from the `OWN` handshake, not from interrupt delivery.

## Security posture at the DMA boundary

The ring engine is where attacker-influenced data crosses into the capsule, so its checks are the ones that
matter. Every buffer copy is length-bounded: the transmit copy is bounded by a frame length the server
already clamped to the Ethernet range ([`src/tx/send.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L33), [operations](/docs/userland/driver-rtl8169/operations/)), and the receive
copy is bounded by a descriptor length the receive path validates against the buffer size, the maximum
Ethernet frame, and the caller's slice before copying a byte ([`src/rx/recv_one.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L48)). A malformed
descriptor, a length past the buffer, or a non-single-segment frame is dropped and the slot rearmed rather
than trusted. The buffers themselves are broker-issued DMA regions the driver never chose the physical
address of; it programs only their broker device addresses into the descriptors
([`src/init/rx_setup.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L32), [`src/tx/send.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L44)). The one boundary the driver cannot enforce is the NIC's own
DMA: without an IOMMU nothing stops a malicious controller from writing outside the buffers it was pointed
at, the universal DMA caveat covered on the [bring-up](/docs/userland/driver-rtl8169/bring-up/) page.

## Source map

```
  userland/capsule_driver_rtl8169/src/constants/queue.rs  RX_DESC_COUNT, TX_DESC_COUNT, BUFFER_SIZE, ring/buffer bytes
  userland/capsule_driver_rtl8169/src/constants/regs.rs   the OWN / EOR / FS / LS / LEN_MASK descriptor bits
  userland/capsule_driver_rtl8169/src/queue/desc.rs       the Descriptor struct and the volatile desc / desc_mut
  userland/capsule_driver_rtl8169/src/queue/rx_ring.rs    RxRing: the cursor and buffer_va / buffer_da
  userland/capsule_driver_rtl8169/src/queue/tx_ring.rs    TxRing: the cursor and buffer_va / buffer_da
  userland/capsule_driver_rtl8169/src/tx/send.rs          the transmit path and the OWN / poll / ack sequence
  userland/capsule_driver_rtl8169/src/tx/poll_done.rs     the bounded wait for the NIC to clear OWN
  userland/capsule_driver_rtl8169/src/rx/recv_one.rs      the receive path, validation, and CRC strip
  userland/capsule_driver_rtl8169/src/rx/rearm.rs         re-priming a descriptor back to the NIC
  userland/capsule_driver_rtl8169/src/init/rx_setup.rs    the initial RX descriptor fill
  userland/capsule_driver_rtl8169/src/init/tx_setup.rs    the initial TX descriptor fill
```

Every reference above is verified against those trees.
