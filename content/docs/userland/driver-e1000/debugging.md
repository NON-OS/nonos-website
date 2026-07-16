---
title: "Debugging capsule_driver_e1000"
description: "This page lists the log marker the driver's boot path emits, the setup exit codes, and the concrete runtime failure modes with where to look for each."
weight: 8
---
This page lists the log marker the driver's boot path emits, the setup exit codes, and the concrete runtime
failure modes with where to look for each. For the shape of the driver see the [README](/docs/userland/driver-e1000/), the
[operations](/docs/userland/driver-e1000/operations/) page, the [bring-up](/docs/userland/driver-e1000/bring-up/) page, and the [queues](/docs/userland/driver-e1000/queues/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[DRIVER-E1000] capsule spawned`: the NIC spawn plan calls `boot::capsule` with the tag `DRIVER-E1000`
([`src/userspace/init/spawn_plan/drivers_nic.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L26)), whose `Ok` arm calls `boot_log::ok(prefix, "capsule
spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which formats `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The spawn is feature-gated, so a build without
`nonos-capsule-driver-e1000` compiles the spawn out entirely ([`src/userspace/init/spawn_plan/drivers_nic.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L33)).

## Setup exit codes

If the capsule spawns but `setup::run` or `init::bring_up` fails, the process exits with one of three codes,
which is the fastest way to tell how far bring-up got ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)).

| Exit | Constant | Meaning and where it comes from |
|---|---|---|
| 1 | `EXIT_HEAP_INIT` | The capsule heap failed to initialise before any device work ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). |
| 2 | `EXIT_SETUP_FAILED` | The broker handshake failed: no e1000 device matched, the claim was refused, the BAR0 map failed, the IRQ bind failed, or a DMA grant was refused ([`src/main.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L43), [`src/setup/sequence.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L31)). |
| 3 | `EXIT_BRING_UP_FAILED` | The hardware bring-up failed: the reset bit never self-cleared or an EEPROM word never signalled done. Every grant is released before the exit ([`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46), [`src/init/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L26)). |

### Exit 2: which broker step failed

`setup::run` returns a distinct `&'static str` per step, so if you can see the setup error string the step is
unambiguous: `"no e1000 device"` (discovery found no matching Intel NIC, [`src/setup/sequence.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L32)),
`"claim failed"` (`mk_device_claim` refused, usually a missing `Driver` capability or a device already
claimed, [`src/setup/claim.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L24)), `"mmio map failed"` ([`src/setup/mmio.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L33)), `"irq bind failed"`
([`src/setup/irq.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L29)), or one of the four `"dma map failed (...)"` strings naming the RX ring, RX buffers,
TX ring, or TX buffers ([`src/setup/dma.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L53)). Discovery requires an Intel vendor id, a matching e1000
device id, network/Ethernet class, a real interrupt line, and an MMIO BAR0 ([`src/discover.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L43)), so a NIC
that is not e1000-class, has no INTx line, or exposes no memory BAR is skipped and shows as "no e1000
device".

### Exit 3: reset or EEPROM

`init::bring_up` fails in one of two places. `reset::run` returns `"CTRL.RST did not self-clear"` if the
self-clearing reset bit is still set after a generous spin budget, which points at a wedged controller or the
wrong BAR mapped ([`src/init/reset.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L40)). `eeprom::read_mac` returns `"EERD did not signal DONE"` if an
EEPROM word read never completes, which on real hardware usually means the part uses a different EEPROM access
path than the direct `EERD` register the driver drives ([`src/init/eeprom.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/eeprom.rs#L51)).

## Runtime failure modes

After a successful boot, failures surface as errno words in the reply, not exit codes.

### No link

`OP_LINK_STATUS` returns a single byte, `0` when the live `STATUS.LU` bit is clear ([`src/server/handlers/link_status.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L36)).
A persistent `0` means the PHY has not reported link up. Bring-up sets `CTRL.SLU` and `CTRL.ASDE` to set the
link and let the device auto-negotiate ([`src/init/reset.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L49)), so a down link after that is a cable, peer,
or auto-negotiation issue rather than a driver-state issue. Confirm with `OP_STATS`, which returns the live
`STATUS` register as its first word ([`src/server/handlers/stats.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L41)); the link-up bit there and the
`OP_LINK_STATUS` byte read the same register.

### No packets received (every OP_RX_PACKET returns E_AGAIN)

`E_AGAIN` (`-11`) is the normal empty-ring reply: `RxRing::consume` found the head descriptor's done bit clear
([`src/queue/rx.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L49), [`src/server/handlers/rx_packet.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L31)). A steady stream of `E_AGAIN` while the link is
up means the NIC is not DMAing frames into the ring. Check `OP_STATS`: if the device receive head `RDH` is not
advancing past the driver's `head` cursor, the NIC is not writing descriptors, which points at the receiver
not being enabled, the receive-address filter rejecting traffic, or no frames arriving. Bring-up enables the
receiver with broadcast-accept and clears the multicast table ([`src/init/rx_setup.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/rx_setup.rs#L45),
[`src/init/mac_filter.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac_filter.rs#L39)), so unicast to the card's own MAC and broadcast should be accepted.

### A received frame returns E_IO

`OP_RX_PACKET` returns `E_IO` (`-5`) when the ring flagged the descriptor bad: not end-of-packet, an error
bit set, a zero length, or a length above `MAX_ETHERNET_FRAME`. The handler recycles the descriptor back to
the NIC and reports the error rather than copying a malformed frame out ([`src/queue/rx.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/rx.rs#L59),
[`src/server/handlers/rx_packet.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L35)). This is a device-side or wire-side error, distinct from `E_AGAIN`,
which is simply an empty ring.

### A transmit returns E_IO on real hardware

`OP_TX_PACKET` returns `E_IO` (`-5`) when the posted transmit descriptor's done bit never gets set within the
one-million-spin budget ([`src/server/handlers/tx_packet.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L50), [`src/queue/tx.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/tx.rs#L67)). On QEMU this is rare.
On real hardware it usually points at one of three things: bus mastering not taking effect so the NIC cannot
write the done bit back, an addressing problem where the controller was handed a ring or buffer device
address it cannot reach, or a controller that hung. Because the transmit path polls the descriptor done bit
rather than waiting on the interrupt (the IRQ is bound but not serviced, [queues](/docs/userland/driver-e1000/queues/)), a missing
interrupt does not cause this; a completion the device never writes does. `OP_STATS` helps here too: if the
device transmit head `TDH` is not catching up to the tail `TDT` the driver wrote, the NIC is not draining the
transmit ring.

### A transmit returns E_INVAL or E_MSGSIZE

`E_INVAL` (`-22`) means the frame was outside the legal Ethernet window, shorter than 60 bytes or longer than
1514 ([`src/server/handlers/tx_packet.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L31), [`src/constants/frame.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/frame.rs#L26)). `E_MSGSIZE` (`-90`) means the
declared `payload_len` did not match the number of bytes the request actually carried, caught either by the
loop's envelope check or the handler's re-check ([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54), [`src/server/handlers/tx_packet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L27)).
Both are request-shape errors that never reach the ring.

## Source map

```
  src/userspace/init/spawn_plan/drivers_nic.rs   the DRIVER-E1000 spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs         the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                     the [TAG] message formatting
  userland/capsule_driver_e1000/src/main.rs      the three exit codes and the release-on-fail path
  userland/capsule_driver_e1000/src/setup/sequence.rs   the per-step broker error strings
  userland/capsule_driver_e1000/src/discover.rs  the e1000 device match behind "no e1000 device"
  userland/capsule_driver_e1000/src/init/reset.rs       the CTRL.RST self-clear and link bring-up
  userland/capsule_driver_e1000/src/init/eeprom.rs      the EERD DONE poll
  userland/capsule_driver_e1000/src/init/rx_setup.rs    the receiver enable and RX ring priming
  userland/capsule_driver_e1000/src/init/mac_filter.rs  the receive-address filter and multicast clear
  userland/capsule_driver_e1000/src/queue/rx.rs         the empty-ring and bad-frame screen
  userland/capsule_driver_e1000/src/queue/tx.rs         the transmit done-bit poll
  userland/capsule_driver_e1000/src/server/handlers/rx_packet.rs  the E_AGAIN and E_IO receive paths
  userland/capsule_driver_e1000/src/server/handlers/tx_packet.rs  the E_INVAL, E_MSGSIZE, and E_IO transmit paths
  userland/capsule_driver_e1000/src/server/handlers/link_status.rs  the live STATUS.LU read
  userland/capsule_driver_e1000/src/server/handlers/stats.rs        the live ring-register snapshot
```

Every reference above is verified against those trees.
