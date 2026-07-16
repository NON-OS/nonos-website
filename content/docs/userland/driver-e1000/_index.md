---
title: "The e1000 NIC Driver Capsule"
description: "capsuledrivere1000 is the NØNOS Intel 8254x (\"e1000\") gigabit Ethernet driver: a signed ring-3 capsule that drives a real e1000-class NIC and serves it to the rest of the system..."
weight: 400
---
`capsule_driver_e1000` is the NØNOS Intel 8254x ("e1000") gigabit Ethernet driver: a signed ring-3 capsule
that drives a real e1000-class NIC and serves it to the rest of the system as a raw-frame transport. It does
not run in the kernel and it does not reach the NIC through any privileged kernel path. It reaches its
controller only through the [hardware broker](/docs/subsystems/hardware-broker/), claiming the PCI
function, mapping BAR0, binding the device interrupt, and allocating DMA for its receive and transmit rings,
all as brokered grants scoped to a claim epoch. Everything above those grants, the reset and link bring-up,
the EEPROM MAC read, the descriptor rings, and the frame move, is ordinary userland code inside the capsule.

The driver stops at the Ethernet frame boundary. It never parses ARP, IP, TCP, UDP, or any socket state;
that authority belongs to the [network stack](/docs/subsystems/networking/) capsules that bind to
it over IPC. The wire protocol matches `capsule_driver_virtio_net` so a single kernel-side network client
can drive either NIC backend without knowing which one it holds.

The source under `userland/capsule_driver_e1000/src/` is organised by concern, and this documentation
mirrors that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its `Capsule.mk`
and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-e1000` | `Capsule.mk:9` |
| Service handle | `driver.e1000_0` | `Capsule.mk:10`, [`src/hardware/e1000_capsule/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/spawn.rs#L37) |
| Namespace | `systems.nonos.driver.e1000_0` | `Capsule.mk:15` |
| Service endpoint | `service:4210:driver.e1000_0` | `Capsule.mk:16`, [`src/hardware/e1000_capsule/spawn.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/spawn.rs#L38) |
| Reply endpoint | `reply:4211:endpoint.4294967308` | `Capsule.mk:17`, [`src/hardware/e1000_capsule/spawn.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/spawn.rs#L39) |
| Capability mask | `0xF8019` | `Capsule.mk:19` |
| Binary name | `driver_e1000` | `Capsule.mk:13`, `Cargo.toml:22` |
| Kernel mirror | `src/hardware/e1000_capsule` | `Capsule.mk:20`, [`src/hardware/e1000_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/spawn.rs) |

The reply endpoint number `4294967308` is `0x1_0000_000C`, the kernel reply-inbox constant the capsule sends
every reply to: it is slot 12 in the per-service reply numbering (ramfs=1 through e1000=C), declared on both
sides as `endpoint.4294967308` in the kernel client ([`src/hardware/e1000_capsule/client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/client/transport.rs#L25))
and as `KERNEL_REPLY_ENDPOINT = 0x1_0000_000C` in the capsule ([`src/protocol/endpoint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L22)).

The mask `0xF8019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00008  IPC          bit()      8   types.rs:59
  0x00010  Memory       bit()     16   types.rs:60
  0x08000  DeviceEnum   bit()  32768   types.rs:71
  0x10000  Driver       bit()  65536   types.rs:72
  0x20000  Mmio         bit() 131072   types.rs:73
  0x40000  Irq          bit() 262144   types.rs:74
  0x80000  Dma          bit() 524288   types.rs:75
  -------
  0xF8019  = 8 + 16 + 32768 + 65536 + 131072 + 262144 + 524288
```

The kernel spawn path requests exactly those seven capabilities and no others, building the mask by ORing
the same seven bits ([`src/hardware/e1000_capsule/spawn.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/spawn.rs#L56)), which matches the comment and value in the
manifest (`Capsule.mk:19`). Like the NVMe driver and unlike an application capsule, this driver holds the
hardware-broker authority bits: `DeviceEnum` (enumerate devices), `Driver` (claim and release a device),
`Mmio` (map device registers), `Irq` (bind a device interrupt), and `Dma` (map DMA), the exact set the
broker checks before it hands out any grant. It has no `Network` bit (4): a NIC driver moves frames, it does
not hold network-service authority; that bit is reserved for a future net-stack capsule layered on top
([`src/hardware/e1000_capsule/capability.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/capability.rs#L17)). `IPC` and `Memory` are the only bits it shares with an
ordinary app. The security consequences of holding those bits, and the no-IOMMU caveat, are worked through
on the [bring-up](/docs/userland/driver-e1000/bring-up/) page; the [claim](/docs/subsystems/hardware-broker/claim/) page documents
how the broker enforces them.

One discrepancy is worth flagging against the source README (`userland/capsule_driver_e1000/README.md`). That
README lists `MkIrqPoll` and `MkIrqAck` in the microkernel contract and describes an "IRQ completion path
owned by capsule". The live server loop does not poll or acknowledge the interrupt: it blocks on
`mk_ipc_recv` for a request and finds every completion by polling a descriptor status bit
([`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42), and the [queues](/docs/userland/driver-e1000/queues/) page). The IRQ is bound at setup
([`src/setup/irq.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L28)) and released at teardown but is never serviced in the request loop today. The README
interface table also lists a sixth `OP_STATS` operation; the capsule serves it ([`src/protocol/ops.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L28)),
but the kernel-side client does not call it ([`src/hardware/e1000_capsule/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/protocol/ops.rs#L21) defines only
ops 1 through 5). Treat `OP_STATS` as a capsule-side telemetry op with no kernel caller yet.

## The three pillars

The capsule reads as three concerns, and the documentation is one page each. A client request enters through
the protocol and server (the operations page), which drives a controller that a one-time bring-up sequence
brought to life (the bring-up page), by moving frames through the receive and transmit descriptor rings the
queue engine owns (the queues page).

```
  client op   ->   server/protocol   ->   RX / TX rings   ->   controller
  NE10 IPC         decode, dispatch       descriptors, DMA     real e1000 NIC

  one-time bring-up (setup then init):
  discover -> claim -> MMIO BAR0 -> IRQ bind ->
  RX ring DMA -> RX buffer DMA -> TX ring DMA -> TX buffer DMA ->
  reset -> link up -> EEPROM MAC -> RAL/RAH + MTA -> RX enable -> TX enable
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-e1000/operations/) | `src/protocol/`, `src/server/` | The `NE10` wire format, the request loop, the six client ops, per-op payloads, the errno set, and the frame-size bounds. |
| [bring-up.md](/docs/userland/driver-e1000/bring-up/) | `src/setup/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/init/`, [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs), `src/constants/` | Discovery, the broker grants (claim, BAR0, IRQ, four DMA regions), reset and link bring-up, the EEPROM MAC read, the receive-address filter, and grant teardown. |
| [queues.md](/docs/userland/driver-e1000/queues/) | `src/queue/`, the RX/TX setup and handlers | The legacy 16-byte descriptor layout, the RX and TX ring cursors, the DD/EOP status handshake, the doorbell tail writes, and the DMA buffer pools. |
| [contributing.md](/docs/userland/driver-e1000/contributing/) | the whole tree | Where each concern lives, how to add a client op or a register, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-e1000/debugging/) | runtime | The boot marker, the three setup exit codes, and the runtime failure modes: no link, no packets, and a TX completion timeout on real hardware. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, runs `setup::run` to take every broker
grant, then `init::bring_up` to program the hardware, and hands the built `Driver` to the request server,
which loops forever ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38)). If the heap init, the setup handshake, or the hardware bring-up
fails, the process exits with a distinct code and never serves a request; a bring-up failure releases every
grant first ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39), [`src/main.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L46)). The kernel spawns it under the NIC bring-up plan through
verified spawn, checking its signature and attestation and holding its requested capabilities against its
manifest ceiling before its ELF is mapped ([`src/userspace/init/spawn_plan/drivers_nic.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L24),
[`src/hardware/e1000_capsule/spawn.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/spawn.rs#L65)). A successful spawn prints `[DRIVER-E1000] capsule spawned` on the
boot log; the [debugging](/docs/userland/driver-e1000/debugging/) page covers what that and each exit code mean.

Once bring-up succeeds the capsule is a raw-frame NIC backend. Clients speak the small `NE10` binary
protocol over IPC to ask for link state, the hardware MAC, a live register snapshot, to transmit one
Ethernet frame, or to poll one received frame. The capsule does not parse Ethernet, keep peer state, or
persist captures; it is the mechanism the [network stack](/docs/subsystems/networking/) is built
on, not the policy.

## Source map

```
  userland/capsule_driver_e1000/src/main.rs        _start -> setup::run -> init::bring_up -> server::run
  userland/capsule_driver_e1000/src/protocol/      the NE10 wire format: header, ops, errno, limits, decode/encode
  userland/capsule_driver_e1000/src/server/        the request loop and one handler per op
  userland/capsule_driver_e1000/src/setup/         the broker handshake: discover, claim, MMIO, IRQ, four DMA grants
  userland/capsule_driver_e1000/src/discover.rs    the mk_device_list scan for the Intel NIC PCI function
  userland/capsule_driver_e1000/src/init/          reset, link, EEPROM MAC, RAL/RAH + MTA, RX and TX programming
  userland/capsule_driver_e1000/src/queue/         the RxRing and TxRing state and the 16-byte descriptor layout
  userland/capsule_driver_e1000/src/regs.rs        Regs: volatile 32-bit access over the BAR0 mapping
  userland/capsule_driver_e1000/src/constants/     register offsets, control/status bits, PCI ids, ring sizing
  userland/capsule_driver_e1000/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/hardware/e1000_capsule/                       the kernel-side embed, spawn, and network client
  src/userspace/init/spawn_plan/drivers_nic.rs      the NIC bring-up plan that spawns this capsule
  src/capabilities/types.rs                         the capability bit values behind the mask
```

Every reference above is verified against those trees.
