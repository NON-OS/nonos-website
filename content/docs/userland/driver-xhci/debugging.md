---
title: "Debugging the xHCI driver"
description: "This page is for diagnosing a driver that does not come up or does not enumerate."
weight: 6
---
This page is for diagnosing a driver that does not come up or does not enumerate. It covers the bring-up
markers the capsule prints, the distinct timeout and error variants each stage produces, and the
real-hardware failure modes: the controller not halting or running, no ports reporting a device, and no
devices enumerating. For the bring-up sequence itself see [bring-up](/docs/userland/driver-xhci/bring-up/); for the ring machinery
the errors come from see [rings](/docs/userland/driver-xhci/rings/); for the enumeration path see [enumeration](/docs/userland/driver-xhci/enumeration/).

## The bring-up markers

Bring-up narrates its progress through `mk_debug` markers, printed in order as each stage clears
([`src/setup/marker.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/marker.rs#L17)). They land on the serial console, or the framebuffer on a `NONOS_FBCONSOLE=1`
build. Seeing the marker means the stage before it completed:

```
  [driver_xhci] reset ok                       halt + HCRST reset both returned   sequence.rs:47
  [driver_xhci] cnr cleared                    USBSTS.CNR went low                sequence.rs:49
  [driver_xhci] scratchpads ok                 scratchpad pages allocated         sequence.rs:52
  [driver_xhci] dcbaa ok                       DCBAA programmed, MaxSlotsEn set   sequence.rs:55
  [driver_xhci] cmd ring ok                    command ring allocated + CRCR set  sequence.rs:58
  [driver_xhci] evt ring ok                    event ring + ERST + IMAN.IE set    sequence.rs:62
  [driver_xhci] running                        USBSTS.HCH went low after RUN      sequence.rs:65
  [driver_xhci] noop ok                        a No Op command completed          sequence.rs:72
  [driver_xhci] endpoint driver.xhci0 ready    the service is about to run        sequence.rs:73
```

The missing marker names the stage that blocked. No `reset ok` at all means discovery, claim, the
bus-master write, the MMIO map, or the MSI-X bind failed before the controller was ever touched, and the
process exit code is the negated errno for that failure ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40),
[`src/error/errno_value.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/errno_value.rs#L23)). A trace that reaches `running` but never `noop ok` means the controller
started but the command ring, doorbell, event ring, or interrupter is not carrying completions, which is
the machinery on the [rings](/docs/userland/driver-xhci/rings/) page.

## The error variants

Every bring-up and runtime failure is one `XhciError` ([`src/error/xhci_error.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/xhci_error.rs#L16)), and the mapping to an
exit errno is explicit ([`src/error/errno_value.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/errno_value.rs#L23)). The distinct timeouts are the useful ones, because
each names exactly one poll loop:

```
  HaltTimeout                  USBSTS.HCH never set after clearing RUN     controller/halt.rs:19
  ResetTimeout                 USBCMD.HCRST never self-cleared             controller/reset.rs:19
  ControllerNotReadyTimeout    USBSTS.CNR never cleared                    controller/wait_cnr_clear.rs:19
  StartTimeout                 USBSTS.HCH never cleared after RUN          controller/wait_hc_running.rs:19
  CommandCompletionTimeout     no command completion event landed          controller/wait_command_completion.rs:20
  TransferCompletionTimeout    no transfer event landed                    controller/wait_transfer_completion.rs:20
  PortResetTimeout             PORTSC.PRC + PED never both set             controller/reset_port.rs:21
```

`DeviceNotFound` is discovery finding no matching xHCI function; `ControllerUnsupported` is the register
block failing the `AC64` / non-zero `max_slots` sanity check or a zero-slot Enable Slot completion;
`BrokerCallFailed(rc)` is any broker syscall refusing (claim, MMIO, IRQ, DMA), carrying the broker return
code; `NoDeviceOnPort` is a port with no connect status; and the `CommandCompletionFailed(cc)` /
`TransferCompletionFailed(cc)` / `UnexpectedCompletionSlot` variants are a command or transfer that
completed with a non-success completion code or the wrong slot id
([`src/controller/wait_command_completion.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/wait_command_completion.rs#L44)).

## Controller not halting or not running

A `HaltTimeout` or `ResetTimeout` before `reset ok`, or a `StartTimeout` before `running`, is the
controller refusing to change run state. On real hardware the first suspect is the missing USBLEGSUP
BIOS-handoff step: the bring-up sequence does not request ownership from the firmware's legacy-support
capability before it resets (noted on the [bring-up](/docs/userland/driver-xhci/bring-up/) page), so a controller the BIOS still
owns can ignore or fight the reset. The second suspect is a bad register window: `read_layout` derives the
operational and runtime bases from `CAPLENGTH`, `RTSOFF`, and `DBOFF` and guards each against the mapped
length ([`src/setup/layout.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/layout.rs#L25), [`src/setup/require_window.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/require_window.rs#L18)), so a controller whose capability
registers read as zero or garbage produces `ControllerUnsupported` rather than a wild write, but a
controller mapped at the wrong offset halts silently. The MMIO map is clamped to `0x3000`
([`src/setup/mmio_map.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio_map.rs#L19)); a controller whose runtime block sits above that window would fail the guard.
The [MMIO debugging](/docs/subsystems/hardware-broker/mmio/) markers show how far the mapping itself got.

## No ports, or a port with no device

A `NoDeviceOnPort` from `reset_port` means the port never asserted `PORTSC.CCS`
([`src/controller/reset_port.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset_port.rs#L28)). On QEMU this is almost always a device that is not attached to that
port. On real hardware the more common cause is port power: firmware often leaves the port unpowered, and
until the driver drives `PORTSC.PP` and waits the power-good delay, no device is ever reported. The
`power_on` step exists for exactly this and spins `POWER_SETTLE_LIMIT` times waiting for connect
([`src/controller/reset_port.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset_port.rs#L50)); a real controller that needs a longer settle than that budget will
still read as empty. A `PortResetTimeout` is the opposite: the device connected but the reset never
completed with both `PRC` and `PED` set, which points at a link-training or speed-negotiation problem on
that physical port.

## No devices enumerated

If the controller runs and a port shows a device but enumeration produces nothing, the failure is in the
command or transfer path and shows up as a specific status word to the class capsule, not a crash. An
Enable Slot that times out or returns slot 0 is `E_IO` / `ControllerUnsupported`
([`src/controller/issue_enable_slot.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_enable_slot.rs#L33)). An Address Device that fails leaves the slot unaddressed and
rolls back its DCBAA entry ([`src/server/handlers/address_flow/complete_address.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/address_flow/complete_address.rs#L37)). A descriptor fetch
that never completes is a `TransferCompletionTimeout`, which on real hardware usually means the interrupt
is bound but never firing, so the event never lands: the completion waiters find events by the
cycle-and-pointer poll, not the interrupt (see [rings](/docs/userland/driver-xhci/rings/)), so a stuck transfer is the event ring
not advancing, which is the interrupter routing or the controller not writing completions. The
[IRQ debugging](/docs/subsystems/hardware-broker/irq/) section covers the "bound but never fires" case:
on a laptop the MSI-X vector can route to a CPU the running core is not listening on, which is exactly the
shape of "the driver claimed the device and started the controller but no completions arrive."

## Two stale in-tree comments

Two comments in the tree no longer match the code, and both can mislead a reader debugging bring-up. The
`Capsule.mk` header still describes an INTx interrupt model with MSI/MSI-X deferred "behind a separate
broker work item" (`Capsule.mk:1`), but the code binds MSI-X and the server acknowledges the interrupter
each loop pass ([`src/setup/irq_bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq_bind.rs#L23), [`src/server/service_interrupts.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/service_interrupts.rs#L19)). And the same header's
capability comment spells the mask as `IPC|Memory|Driver|DeviceEnum|Mmio|Irq|Dma` (`Capsule.mk:15`),
omitting the `CoreExec` bit that `0xF8019` also sets, as the [README](/docs/userland/driver-xhci/) mask decomposition shows.
Neither affects behaviour, but both are worth correcting when the file is next touched.

## Source map

```
  userland/capsule_driver_xhci/src/setup/marker.rs        the mk_debug marker helper
  userland/capsule_driver_xhci/src/setup/sequence.rs      where each marker is printed
  userland/capsule_driver_xhci/src/error/xhci_error.rs    every XhciError variant
  userland/capsule_driver_xhci/src/error/errno_value.rs   XhciError -> exit errno
  userland/capsule_driver_xhci/src/controller/halt.rs     HaltTimeout
  userland/capsule_driver_xhci/src/controller/reset.rs    ResetTimeout
  userland/capsule_driver_xhci/src/controller/wait_cnr_clear.rs      ControllerNotReadyTimeout
  userland/capsule_driver_xhci/src/controller/wait_hc_running.rs     StartTimeout
  userland/capsule_driver_xhci/src/controller/reset_port.rs          port power, reset, and the waits
  userland/capsule_driver_xhci/src/controller/wait_command_completion.rs   command completion + timeout
  userland/capsule_driver_xhci/src/controller/wait_transfer_completion.rs  transfer completion + timeout
  userland/capsule_driver_xhci/src/setup/mmio_map.rs      the 0x3000 window clamp
  userland/capsule_driver_xhci/Capsule.mk                 the stale INTx and mask comments
  docs/subsystems/hardware-broker/mmio.md                 the MMIO stage markers
  docs/subsystems/hardware-broker/irq.md                  the bound-but-never-fires diagnosis
```

Every reference above is verified against those trees.
