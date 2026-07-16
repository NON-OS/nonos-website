---
title: "Controller bring-up and the broker grants"
description: "Before the capsule serves a single IPC request it has to find its controller, take exclusive ownership of it, map its registers, bind its interrupt, allocate every DMA structure..."
weight: 2
---
Before the capsule serves a single IPC request it has to find its controller, take exclusive ownership of
it, map its registers, bind its interrupt, allocate every DMA structure the controller reads, and drive
the controller from halted to running. That whole path is one ordered sequence in [`src/setup/sequence.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L34),
and this page mirrors it together with the folders it leans on: `src/setup/` (the sequence and the broker
calls), [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) (finding the device), `src/handles/` (the grant wrappers), `src/dma/` (the DMA
pool), and the `src/controller/` steps the sequence calls. The ring and TRB machinery the last steps drive
is on the [rings](/docs/userland/driver-xhci/rings/) page; the per-device slot work that comes later is on the
[enumeration](/docs/userland/driver-xhci/enumeration/) page; the wire surface the finished driver serves is on the
[operations](/docs/userland/driver-xhci/operations/) page. Identity and the capability mask are on the [README](/docs/userland/driver-xhci/).

The broker syscalls themselves are documented on the
[claim](/docs/subsystems/hardware-broker/claim/), [MMIO](/docs/subsystems/hardware-broker/mmio/),
[DMA](/docs/subsystems/hardware-broker/dma/), and [IRQ](/docs/subsystems/hardware-broker/irq/) pages.

Each step is a broker call or a controller register step, and any failure returns an `XhciError` that
`_start` negates into the process exit code ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40), [`src/error/errno_value.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/errno_value.rs#L23)), so a
half-built driver never reaches the server loop.

## The bring-up sequence

1. **Discover.** `find_xhci` calls `mk_device_list` and returns the first record whose broker class is
   `CLASS_USB_HOST_XHCI` and whose PCI triple is `0c/03/30` (serial-bus / USB / xHCI) on a PCI bus with a
   non-empty MMIO BAR0 ([`src/discover.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L27), [`src/discover.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L49)). It carries forward the device id and
   BAR0 size only. No match is `DeviceNotFound`.
2. **Claim.** `mk_device_claim` on that device id returns a claim epoch ([`src/setup/claim.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L18)). The
   epoch is the token every later broker call must present, so a stale or revoked claim fails cleanly. A
   refusal is `BrokerCallFailed`. See [device claim and epochs](/docs/subsystems/hardware-broker/claim/).
3. **Bus master.** `enable_bus_master` writes `MK_PCI_CMD_BUS_MASTER` into the PCI command register through
   `mk_pci_config_write` so the controller may DMA ([`src/setup/pci.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L21)). On failure the device is
   released before the error propagates ([`src/setup/sequence.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L37)).
4. **Map the register window.** `mmio_map` maps BAR index 0, clamped to `REGISTER_WINDOW_LEN = 0x3000`
   (three pages: capability, operational, and runtime blocks), and returns a user VA, a length, and a grant
   id ([`src/setup/mmio_map.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio_map.rs#L18)). The broker withholds the MSI-X table pages from this mapping; see
   [MMIO grants](/docs/subsystems/hardware-broker/mmio/).
5. **Bind MSI-X.** `irq_bind` calls `mk_irq_bind` with `MK_IRQ_BIND_MSIX` for one vector
   ([`src/setup/irq_bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq_bind.rs#L23)). On failure it rolls back by unmapping the MMIO grant and releasing the
   device before returning `BrokerCallFailed` ([`src/setup/irq_bind.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq_bind.rs#L25)). This is the point the
   `Capsule.mk` header comment is out of date on: it still describes an INTx model with MSI/MSI-X "later
   behind a separate broker work item" (`Capsule.mk:1`), but the code binds MSI-X here and the server
   acknowledges the interrupter every loop pass. The [debugging](/docs/userland/driver-xhci/debugging/) page records that
   discrepancy. See [IRQ grants](/docs/subsystems/hardware-broker/irq/).
6. **Read the layout.** `read_layout` first calls `refuse_unsupported`, which requires 64-bit addressing
   (`AC64`) and a non-zero `max_slots` before the mapping is trusted ([`src/controller/refuse_unsupported.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/refuse_unsupported.rs#L18)).
   It then reads `CAPLENGTH`, `RTSOFF`, and `DBOFF` and checks each derived block start with a one-page
   guard against the mapped length (`require_window`, [`src/setup/require_window.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/require_window.rs#L18)), producing the
   operational base, doorbell base, primary interrupter base, and the `max_slots` / `max_ports` /
   `max_scratchpad` / `context_size` fields ([`src/setup/layout.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/layout.rs#L25)).
7. **Halt.** `halt` clears `USBCMD.RUN` if it is set and polls `USBSTS.HCH` high, bailing after
   `200_000` spins with `HaltTimeout` ([`src/controller/halt.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/halt.rs#L20)).
8. **Reset.** `reset` sets `USBCMD.HCRST` and polls it back to zero, `ResetTimeout` on expiry
   ([`src/controller/reset.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset.rs#L20)). Then `wait_cnr_clear` polls `USBSTS.CNR` (controller-not-ready) low
   before any structure is programmed ([`src/controller/wait_cnr_clear.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/wait_cnr_clear.rs#L20)).
9. **Scratchpads.** `Scratchpads::allocate` reads `max_scratchpad` and, if non-zero, allocates a pointer
   array plus one 4 KiB page per scratchpad from the DMA pool and writes each page's device address into
   the array ([`src/controller/scratchpad.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/scratchpad.rs#L26)). A zero count is `Scratchpads::None`. These are the
   controller's private working pages, handed to it through the DCBAA entry 0.
10. **DCBAA.** `program_dcbaa` allocates `(max_slots + 1) * 8` bytes, writes the scratchpad array device
    address into entry 0, programs `DCBAAP` with the region's device address, and sets `CONFIG.MaxSlotsEn`
    to `max_slots` ([`src/controller/program_dcbaa.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/program_dcbaa.rs#L20), [`src/regs/op/dcbaap_program.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/op/dcbaap_program.rs#L18)). The Device
    Context Base Address Array is how the controller finds each device's output context by slot id.
11. **Command ring.** `CommandRing::new` allocates the 64-TRB ring, writes a wrap link TRB into its last
    slot, and `program_command_ring` writes `CRCR` with the ring's device address and its ring-cycle-state
    bit ([`src/rings/command/state.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/command/state.rs#L27), [`src/controller/program_command_ring.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/program_command_ring.rs#L18)). Covered on the
    [rings](/docs/userland/driver-xhci/rings/) page.
12. **Event ring.** `EventRing::new` allocates the 64-TRB segment and a one-entry ERST, `imod_program`
    sets the interrupter moderation interval, and `program_event_ring` writes `ERSTSZ`, `ERDP`, and
    `ERSTBA` and sets `IMAN.IE` ([`src/rings/event/state.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/event/state.rs#L28), [`src/controller/program_event_ring.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/program_event_ring.rs#L19),
    [`src/setup/sequence.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L60)). Also on the [rings](/docs/userland/driver-xhci/rings/) page.
13. **Start.** `start` clears `USBSTS.HSE` and sets `USBCMD.RUN | USBCMD.INTE`
    ([`src/controller/start.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/start.rs#L18)), then `wait_hc_running` polls `USBSTS.HCH` low, `StartTimeout` on expiry
    ([`src/controller/wait_hc_running.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/wait_hc_running.rs#L20)).
14. **No-op probe.** `issue_noop_and_wait` enqueues a No Op command TRB, rings doorbell 0, and waits for its
    completion event ([`src/controller/issue_noop_and_wait.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/issue_noop_and_wait.rs#L22)). This is the end-to-end proof that the
    command ring, the doorbell, the event ring, and the interrupter all work before any device is touched.

`assemble` then builds the `Driver` that the server threads through every request: the broker handles, the
DCBAA region, the scratchpads, the DMA pool, the command and event rings, the layout, and a fresh empty
slot table ([`src/setup/assemble.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/assemble.rs#L24), [`src/setup/driver.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L22)).

There is no USBLEGSUP BIOS-handoff step. On real hardware the firmware often still owns the controller
through the legacy-support capability, and a compliant handshake would request ownership and spin on the
BIOS-owned bit before the reset in step 8. The [debugging](/docs/userland/driver-xhci/debugging/) page notes this as the first
suspect when the controller comes up on QEMU but stalls on a physical machine.

## The broker grants the capsule holds

The driver reaches hardware only through grants, each scoped to the claim epoch. The wrappers are thin: a
grant is a syscall result and a `Drop` that revokes it.

| Grant | Wrapper | What it is |
|---|---|---|
| Device claim | `BrokerHandles` | the exclusive hold on the PCI function; the root of every other grant ([`src/handles/broker_handles.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles.rs#L17)) |
| MMIO | `BrokerHandles` | the capability/operational/runtime window mapped as a user VA ([`src/setup/mmio_map.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio_map.rs#L20)) |
| IRQ | `BrokerHandles` | one MSI-X vector ([`src/setup/irq_bind.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq_bind.rs#L21)) |
| DMA | `DmaRegion` | one broker-issued buffer with a user VA and a device address ([`src/dma/region.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L16)) |

The `DmaPool` is just the device id and the claim epoch ([`src/dma/pool.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/pool.rs#L17)); every ring, context, and
data buffer is one `DmaPool::alloc`, which rounds the request up to whole pages, refuses more than
`MAX_PAGES_PER_GRANT`, calls `mk_dma_map`, and returns a `DmaRegion` carrying the grant id, user VA, and
device address ([`src/dma/pool_alloc.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/pool_alloc.rs#L22)). The capsule programs the controller only with the
broker-issued device addresses ([`src/regs/op/dcbaap_program.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/op/dcbaap_program.rs#L18), [`src/rings/command/crcr_value.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rings/command/crcr_value.rs#L18)),
never a physical address it chose. The USB-host DMA class ceiling is 256 pages, matching the mask's `Dma`
authority; see the ceiling table on [DMA grants](/docs/subsystems/hardware-broker/dma/).

## Grant teardown

The `Driver` owns the `BrokerHandles`, so ownership drives revocation. On drop, `BrokerHandles` unbinds the
IRQ, unmaps the MMIO grant, and releases the device claim, in that reverse order
([`src/handles/broker_handles_drop.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_drop.rs#L18)). Because the server loop never returns, this runs only on an
early error exit; the kernel also revokes every grant tied to the claim when the process dies, so a crash
cannot leak a claim, a mapping, or a DMA buffer (see
[revocation](/docs/subsystems/hardware-broker/revocation/)).

## Security posture at bring-up

This capsule holds the most powerful mask in the driver tree, so the trust question is not whether it can
reach hardware but how tightly that reach is bounded. The broker bounds it in four ways, each visible in
the sequence above. The claim is device-scoped and epoch-gated, so the capsule can only act on the one
xHCI function it claimed ([`src/setup/claim.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L18);
[claim.md](/docs/subsystems/hardware-broker/claim/)). The MMIO grant is the register window of that
function minus the MSI-X table, at a broker-chosen user address, so the driver never sees a physical
address, another device's registers, or its own interrupt-vector table
([`src/setup/mmio_map.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio_map.rs#L20); [mmio.md](/docs/subsystems/hardware-broker/mmio/)). Each DMA region is a
separate grant with its own device address, capped at the USB-host class ceiling, and the controller is
programmed only with those device addresses ([`src/dma/pool_alloc.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/pool_alloc.rs#L22);
[dma.md](/docs/subsystems/hardware-broker/dma/)). And the interrupt is programmed by the kernel: the
capsule receives a grant id and a vector, never the MSI-X table
([`src/setup/irq_bind.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq_bind.rs#L23); [irq.md](/docs/subsystems/hardware-broker/irq/)).

The honest caveat is the absence of an IOMMU on the current target. Bus mastering is enabled
([`src/setup/pci.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L21)) and the controller is handed device addresses for its rings, contexts, and data
buffers, but nothing in hardware forces it to confine its DMA to those buffers. A correct xHCI controller
only touches the addresses the driver programmed; a malicious or buggy one could DMA elsewhere, and without
an IOMMU the broker cannot prevent that. This is the same universal DMA caveat that applies to every
hardware driver capsule.

## Source map

```
  userland/capsule_driver_xhci/src/setup/sequence.rs        the whole ordered bring-up
  userland/capsule_driver_xhci/src/setup/claim.rs           mk_device_claim -> epoch
  userland/capsule_driver_xhci/src/setup/pci.rs             the bus-master config write
  userland/capsule_driver_xhci/src/setup/mmio_map.rs        mk_mmio_map for the 0x3000 window
  userland/capsule_driver_xhci/src/setup/irq_bind.rs        MSI-X bind with rollback
  userland/capsule_driver_xhci/src/setup/layout.rs          read_layout: cap/op/runtime bases and limits
  userland/capsule_driver_xhci/src/setup/require_window.rs  the one-page window guard
  userland/capsule_driver_xhci/src/setup/assemble.rs        the built Driver struct
  userland/capsule_driver_xhci/src/setup/driver.rs          the Driver fields
  userland/capsule_driver_xhci/src/discover.rs              mk_device_list scan and the xHCI match
  userland/capsule_driver_xhci/src/controller/refuse_unsupported.rs  AC64 and non-zero max_slots
  userland/capsule_driver_xhci/src/controller/halt.rs       clear RUN, wait HCH
  userland/capsule_driver_xhci/src/controller/reset.rs      set HCRST, wait clear
  userland/capsule_driver_xhci/src/controller/wait_cnr_clear.rs  wait CNR low
  userland/capsule_driver_xhci/src/controller/scratchpad.rs Scratchpads::allocate
  userland/capsule_driver_xhci/src/controller/program_dcbaa.rs  DCBAA + DCBAAP + CONFIG
  userland/capsule_driver_xhci/src/controller/program_command_ring.rs  CRCR
  userland/capsule_driver_xhci/src/controller/program_event_ring.rs    ERSTSZ/ERDP/ERSTBA/IMAN
  userland/capsule_driver_xhci/src/controller/start.rs      set RUN | INTE
  userland/capsule_driver_xhci/src/controller/wait_hc_running.rs  wait HCH low
  userland/capsule_driver_xhci/src/controller/issue_noop_and_wait.rs  the end-to-end probe
  userland/capsule_driver_xhci/src/dma/pool.rs              DmaPool: device id + epoch
  userland/capsule_driver_xhci/src/dma/pool_alloc.rs        DmaPool::alloc over mk_dma_map
  userland/capsule_driver_xhci/src/dma/region.rs            DmaRegion fields
  userland/capsule_driver_xhci/src/handles/broker_handles.rs       BrokerHandles
  userland/capsule_driver_xhci/src/handles/broker_handles_drop.rs  reverse-order Drop
  userland/capsule_driver_xhci/src/error/errno_value.rs     XhciError -> exit code
  userland/capsule_driver_xhci/Capsule.mk                   the stale INTx / no-legacy-handoff header
  docs/subsystems/hardware-broker/                          the claim/mmio/dma/irq grant paths
```

Every reference above is verified against those trees.
