---
title: "Debugging capsule_driver_rtl8169"
description: "This page lists the log marker the driver's boot path emits, the setup and bring-up exit codes, and the concrete runtime failure modes with where to look for each."
weight: 8
---
This page lists the log marker the driver's boot path emits, the setup and bring-up exit codes, and the
concrete runtime failure modes with where to look for each. For the shape of the driver see the
[README](/docs/userland/driver-rtl8169/), the [operations](/docs/userland/driver-rtl8169/operations/) page, the [bring-up](/docs/userland/driver-rtl8169/bring-up/) page, and the
[rings](/docs/userland/driver-rtl8169/rings/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[DRIVER-RTL8169] capsule spawned`: the NIC spawn plan calls `boot::capsule` with the tag `DRIVER-RTL8169`
([`src/userspace/init/spawn_plan/drivers_nic.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L52)), which delegates to `capsule_boot::boot`
([`src/userspace/init/spawn_plan/boot.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/boot.rs#L26)), whose `Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which formats `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The driver is feature-gated, so also confirm the build
includes `nonos-capsule-driver-rtl8169`, or `spawn_rtl8169` is the empty stub and nothing spawns
([`src/userspace/init/spawn_plan/drivers_nic.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L59)).

## Setup and bring-up exit codes

If the capsule spawns but its own bring-up fails, the process exits with one of three distinct codes, which
is the fastest way to tell how far it got ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)).

| Exit | Constant | Meaning and where it comes from |
|---|---|---|
| 1 | `EXIT_HEAP_INIT` | `heap_init` failed before anything else ran ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). |
| 2 | `EXIT_SETUP_FAILED` | `setup::run` failed: no device matched, or a claim, bus-master, MMIO, IRQ, or DMA grant was refused ([`src/main.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L45), [`src/setup/sequence.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L25)). |
| 3 | `EXIT_BRING_UP_FAILED` | `init::bring_up` failed after the grants were taken: the soft reset timed out or the MAC was invalid; the driver releases every grant first ([`src/main.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L48), [`src/init/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L24)). |

The `Result<_, &'static str>` messages inside `setup::run` and `init::bring_up` name the exact step, but
they collapse to these three exit codes at `_start`, so the codes tell you which phase and the source tells
you which step within it.

### No device (exit 2, before any grant)

If `find_rtl8169` returns `None`, setup fails immediately with exit 2 ([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26)). The scan
requires a Realtek vendor id, a matching RTL8169 device id, the network class and Ethernet subclass, a usable
IRQ line, and an MMIO BAR of at least `0x100` bytes ([`src/discover/support.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/support.rs#L24), [`src/discover.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L47),
[`src/discover/bar_mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/bar_mmio.rs#L22)). A device that is present but not matched is a discovery problem one layer
down; a `NONOS_DEVICE_CENSUS=1` build renders the broker device table so you can confirm the NIC is even
enumerated, as described on the [claim](/docs/subsystems/hardware-broker/claim/) page.

### A grant refused (exit 2, after the device matched)

The claim, bus-master write, MMIO map, IRQ bind, or a DMA allocation can each be refused by the broker, and
any of them collapses to exit 2. A refused claim usually means a missing `Driver` capability or a device
another capsule already holds ([claim.md](/docs/subsystems/hardware-broker/claim/)); a refused MMIO, IRQ,
or DMA grant means the epoch check failed or the grant class was denied. Each refusal rolls back the grants
already taken before returning ([`src/setup/pci.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L26), [`src/setup/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L25), [`src/setup/irq.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L24),
[`src/setup/dma.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L45)), so a failed setup leaves nothing claimed.

### Reset timeout or bad MAC (exit 3)

Exit 3 is a bring-up failure after the grants exist. There are two causes. The soft reset writes the reset
bit and polls it low for up to a million iterations, returning a timeout if the chip never clears it
([`src/init/reset.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L26)); on real hardware a reset that never completes usually means the register BAR was
mapped but the chip is wedged or the wrong BAR was mapped. The MAC read rejects an all-zero or all-`0xFF`
address ([`src/init/mac.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac.rs#L26)); an invalid MAC points at a register block that is mapped but not responding
with real data. Either way the driver calls `release` to drop every grant before exiting
([`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)).

## Runtime failure modes

After a successful boot, failures surface as status words in the reply, not exit codes.

### Link is down (`OP_LINK_STATUS` returns 0)

A link byte of `0` is not an error; it is the ordinary reported state when the PHY link-up bit is clear
([`src/server/handlers/link_status.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L27), [`src/constants/regs.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L38)). Check the cable and the peer before
suspecting the driver.

### The receive ring is empty (`OP_RX_PACKET` returns `E_AGAIN`)

`E_AGAIN` (`-11`) means the descriptor at the RX cursor still has `OWN` set, so the NIC has not delivered a
frame there yet ([`src/server/handlers/rx_packet.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L32), [`src/rx/recv_one.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L44)). This is the normal
"nothing to receive" answer, not a fault; a client polls again.

### A receive descriptor or interrupt error (`OP_RX_PACKET` returns `E_IO`)

`E_IO` (`-5`) on receive is either the RX-error interrupt bit being set or a descriptor that failed
validation, a frame that was not a single first-and-last segment, a length past the buffer, or a length past
the maximum Ethernet frame ([`src/server/handlers/rx_packet.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L35), [`src/rx/recv_one.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L37),
[`src/rx/recv_one.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L48)). The driver rearms the slot and moves on, so a single bad descriptor does not wedge
the ring.

### A transmit fails (`OP_TX_PACKET` returns `E_MSGSIZE`, `E_INVAL`, or `E_IO`)

`E_MSGSIZE` (`-90`) means the header's `payload_len` did not match the received body length. `E_INVAL`
(`-22`) means the frame was outside the Ethernet size bounds, below 60 or above 1514 bytes
([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24), `tx_packet.rs:28`). Those two are refused before the device is
touched. `E_IO` (`-5`) means the send itself failed at the device: the descriptor was still busy, the
completion poll timed out, or the TX-error interrupt bit was set ([`src/tx/send.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L29),
[`src/tx/poll_done.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/poll_done.rs#L33), [`src/tx/send.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/send.rs#L59)). A transmit timeout on real hardware usually points at bus
mastering not taking effect (the NIC cannot DMA the frame out) or the descriptor address being one the
controller cannot reach.

### Reading state without side effects (`OP_STATS`)

`OP_STATS` is the non-mutating probe. It returns the command register, PHY status, ISR, IMR, RX and TX
config, the receive max size, the software `rx_cur` and `tx_cur` cursors, and the ring depths, and it reads
only registers that do not clear on access ([`src/server/handlers/stats.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L40)). Use it to see whether the
receive and transmit engines are enabled in the command register and where the cursors sit without disturbing
the device.

## Source map

```
  src/userspace/init/spawn_plan/drivers_nic.rs        the DRIVER-RTL8169 spawn entry and the feature gate
  src/userspace/init/spawn_plan/boot.rs               boot::capsule -> capsule_boot::boot
  src/userspace/init/capsule_boot/run.rs              the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                          the [TAG] message formatting
  userland/capsule_driver_rtl8169/src/main.rs         the three exit codes and the phase order
  userland/capsule_driver_rtl8169/src/discover.rs     the match behind a no-device setup failure
  userland/capsule_driver_rtl8169/src/setup/          the claim, bus-master, MMIO, IRQ, and DMA grant failures
  userland/capsule_driver_rtl8169/src/init/reset.rs   the reset timeout
  userland/capsule_driver_rtl8169/src/init/mac.rs     the invalid-MAC check
  userland/capsule_driver_rtl8169/src/server/handlers/rx_packet.rs  the E_AGAIN / E_IO receive paths
  userland/capsule_driver_rtl8169/src/server/handlers/tx_packet.rs  the E_MSGSIZE / E_INVAL / E_IO transmit paths
  userland/capsule_driver_rtl8169/src/rx/recv_one.rs  the receive validation behind E_IO
  userland/capsule_driver_rtl8169/src/tx/send.rs      the send path behind a transmit E_IO
  userland/capsule_driver_rtl8169/src/server/handlers/stats.rs  the side-effect-free snapshot
```

Every reference above is verified against those trees.
