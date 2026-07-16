---
title: "The RTL8139 Driver Capsule"
description: "capsuledriverrtl8139 is the NØNOS Realtek RTL8139 Fast Ethernet driver: a signed ring-3 capsule that drives a real RTL8139 NIC and serves it to the rest of the system as a raw E..."
weight: 400
---
`capsule_driver_rtl8139` is the NØNOS Realtek RTL8139 Fast Ethernet driver: a signed ring-3 capsule that
drives a real RTL8139 NIC and serves it to the rest of the system as a raw Ethernet frame device. It does
not run in the kernel and it does not touch the device through any privileged kernel path. It reaches its
controller only through the [hardware broker](/docs/subsystems/hardware-broker/), claiming the PCI
function, enabling bus mastering, granting the port BAR for I/O, binding the INTx line, and allocating DMA,
all as brokered grants scoped to a claim epoch. Everything above those grants, the reset and MAC read, the
receive ring, the four transmit slots, and the frame protocol, is ordinary userland code inside the capsule.

Unlike the NVMe or e1000 drivers, the RTL8139 has no memory-mapped register block: its registers live behind
a port BAR and are reached with `MkPioRead`/`MkPioWrite`, never MMIO. The driver holds `Pio` and never asks
for `Mmio`. The [drivers](/docs/subsystems/networking/drivers/) page places it beside the other NIC
capsules, and the [networking](/docs/subsystems/networking/) README shows where the frame path goes
next.

The source under `userland/capsule_driver_rtl8139/src/` is organized by concern, and this documentation
mirrors that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its `Capsule.mk`
and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-rtl8139` | `Capsule.mk:6` |
| Service handle | `driver.rtl8139_0` | `Capsule.mk:7`, [`src/hardware/rtl8139_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8139_capsule/spawn.rs#L32) |
| Namespace | `systems.nonos.driver.rtl8139_0` | `Capsule.mk:12` |
| Service endpoint | `service:4212:driver.rtl8139_0` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4213:endpoint.4294967309` | `Capsule.mk:14`, `spawn.rs:34` |
| Capability mask | `0x1D8019` | `Capsule.mk:16` |
| Binary name | `driver_rtl8139` | `Capsule.mk:10`, `Cargo.toml:14` |
| Kernel mirror | `src/hardware/rtl8139_capsule` | [`src/hardware/rtl8139_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8139_capsule/spawn.rs) |

The reply endpoint number `4294967309` is `0x1_0000_000D`, the kernel reply-inbox constant the capsule sends
every reply to ([`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17), [`src/server/error.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L26)). The kernel side names the same
inbox `endpoint.4294967309` ([`src/hardware/rtl8139_capsule/client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8139_capsule/client/transport.rs#L25)).

### The capability mask

The manifest mask `0x1D8019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x000001  CoreExec     bit()        1   types.rs:56
  0x000008  IPC          bit()        8   types.rs:59
  0x000010  Memory       bit()       16   types.rs:60
  0x008000  DeviceEnum   bit()    32768   types.rs:71
  0x010000  Driver       bit()    65536   types.rs:72
  0x040000  Irq          bit()   262144   types.rs:74
  0x080000  Dma          bit()   524288   types.rs:75
  0x100000  Pio          bit()  1048576   types.rs:76
  --------
  0x1D8019  = 1 + 8 + 16 + 32768 + 65536 + 262144 + 524288 + 1048576
```

There is a discrepancy worth stating plainly. The manifest value `0x1D8019` is the capability *ceiling*
baked into the signed manifest from `CAPSULE_REQUIRED_CAPS` (`Capsule.mk:16`, threaded through
`nonos-mk/capsule.mk:71`), and it sets eight bits including `CoreExec` (bit 0). The comment on that line
reads `IPC|Memory|Driver|DeviceEnum|Irq|Dma|Pio = 0x1D8019`, but that named set is only seven bits and sums
to `0x1D8018`; the extra bit 0 in the value is `CoreExec`, which the comment does not name. The kernel spawn
path requests exactly those seven caps and no others, which is `0x1D8018`
([`src/hardware/rtl8139_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8139_capsule/spawn.rs#L51)). Because the requested set is a subset of the manifest ceiling,
the spawn check passes and the capsule is granted only the seven it asks for; the `CoreExec` bit in the
ceiling is latent and never requested. The security-relevant set the driver actually holds is the seven, not
the eight.

Those seven are the hardware-broker authority profile minus `Mmio`. `DeviceEnum` enumerates devices,
`Driver` claims and releases one, `Irq` binds a device interrupt, `Dma` maps DMA, and `Pio` mints a
port-window grant, the set the broker checks before it hands out any grant ([`src/capabilities/types.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L34)).
It has no `Mmio` bit (this NIC is port-mapped, so there is nothing to map), no `Network` bit (4), and no
`FileSystem` bit (64). `IPC` and `Memory` are the only bits it shares with an ordinary app. The security
consequences of holding those bits are worked through on the [bring-up](/docs/userland/driver-rtl8139/bring-up/) page; the
[PIO](/docs/subsystems/hardware-broker/pio/) and [claim](/docs/subsystems/hardware-broker/claim/) pages
document how the broker enforces them.

## The three pillars

The capsule reads as three concerns, and the documentation is one page each. A client request enters through
the protocol and server (the operations page), which reaches a NIC that a one-time bring-up sequence brought
to life (the bring-up page), by moving frames through the receive ring and the four transmit slots the buffer
engine owns (the buffers page).

```
  client op   ->   server/protocol   ->   rx ring / tx slots   ->   RTL8139 NIC
  NNET IPC         decode, dispatch       PIO regs + DMA bufs       real Realtek NIC

  one-time bring-up (setup + init):
  discover -> claim -> bus master -> PIO grant -> INTx bind -> DMA map ->
  reset -> read MAC -> program RX -> program TX -> unmask IRQ -> enable RX/TX
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-rtl8139/operations/) | `src/protocol/`, `src/server/` | The `NR89` wire format, the request loop, the six client ops (link, MAC, TX, RX, stats, health), per-op payloads, and the errno set. |
| [bring-up.md](/docs/userland/driver-rtl8139/bring-up/) | [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/setup/`, `src/init/`, [`src/pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pio.rs), `src/constants/` | Discovery, the broker grants (claim, bus master, PIO, INTx, DMA), the checked port access, and the reset/MAC/enable init sequence with its rollback. |
| [buffers.md](/docs/userland/driver-rtl8139/buffers/) | `src/rx/`, `src/tx/`, [`src/constants/dma.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/dma.rs), [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs) | The circular receive buffer with its `CAPR`/wrap arithmetic, the four transmit descriptors, the DMA layout, and where the frame bytes cross the copy boundary. |
| [contributing.md](/docs/userland/driver-rtl8139/contributing/) | the whole tree | Where each concern lives, how to add a client op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-rtl8139/debugging/) | runtime | The boot marker, the bring-up exit codes, and the runtime failure modes: no device, reset timeout, TX timeout, and RX-empty. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, runs `setup::run` to acquire the grants and
build the `Driver`, runs `init::bring_up` to reset and program the NIC, and hands the driver to the request
server, which loops forever ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). If heap init fails it exits `1`; if `setup::run` fails it
exits `2`; if `init::bring_up` fails it releases every grant and exits `3` ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36),
[`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41), [`src/main.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L43)). The kernel spawns it under the NIC bring-up plan through
[verified spawn](/docs/security/capsules-and-trust/), checking its signature and attestation and holding
its requested capabilities against its manifest ceiling before its ELF is mapped
([`src/userspace/init/spawn_plan/drivers_nic.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L37)). A successful spawn prints `[DRIVER-RTL8139] capsule
spawned` on the boot log; the [debugging](/docs/userland/driver-rtl8139/debugging/) page covers what that and each exit code mean.

Once bring-up succeeds the capsule is a raw Ethernet frame device. Clients speak the small `NR89` binary
protocol over IPC to read the link state and MAC address, transmit one frame, poll one received frame, and
read a side-effect-free register snapshot. The capsule does not speak ARP, IP, DHCP, or any higher protocol,
and it does not persist frames; it is the mechanism the [net_core](/docs/subsystems/networking/stack/) stack
is built on, not the policy. The kernel does not route packets or retain network state.

## Source map

```
  userland/capsule_driver_rtl8139/src/main.rs        _start -> setup::run -> init::bring_up -> server::run
  userland/capsule_driver_rtl8139/src/protocol/      the NR89 wire format: header, ops, errno, limits, decode/encode, endpoint
  userland/capsule_driver_rtl8139/src/server/        the request loop and one handler per op
  userland/capsule_driver_rtl8139/src/discover.rs    the mk_device_list scan for the RTL8139 PCI function
  userland/capsule_driver_rtl8139/src/setup/         the grant sequence: claim, bus master, PIO, INTx, DMA, rollback
  userland/capsule_driver_rtl8139/src/init/          reset, MAC read, RX/TX programming, IRQ unmask, RX/TX enable
  userland/capsule_driver_rtl8139/src/pio.rs         Pio: checked 8/16/32-bit port access over the grant
  userland/capsule_driver_rtl8139/src/rx/            the circular receive buffer read path
  userland/capsule_driver_rtl8139/src/tx/            the four transmit slots and the completion poll
  userland/capsule_driver_rtl8139/src/constants/     register offsets and bits, PCI ids, DMA sizes, frame bounds
  userland/capsule_driver_rtl8139/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/hardware/rtl8139_capsule/                       the kernel-side embed, spawn record, and client transport
  src/userspace/init/spawn_plan/drivers_nic.rs        the NIC spawn plan entry
  src/capabilities/types.rs                           the capability bit values behind the mask
```

Every reference above is verified against those trees.
