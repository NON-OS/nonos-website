---
title: "The RTL8169 NIC Driver Capsule"
description: "capsuledriverrtl8169 is the NØNOS Realtek RTL8168/RTL8169 gigabit Ethernet driver: a signed ring-3 capsule that drives a real PCIe NIC and serves it to the rest of the system as..."
weight: 400
---
`capsule_driver_rtl8169` is the NØNOS Realtek RTL8168/RTL8169 gigabit Ethernet driver: a signed ring-3
capsule that drives a real PCIe NIC and serves it to the rest of the system as a raw-frame device. It does
not run in the kernel and it does not touch the device through any privileged kernel path. It reaches its
controller only through the [hardware broker](/docs/subsystems/hardware-broker/), claiming the PCI
function, mapping its register BAR, enabling bus mastering, binding the device interrupt, and allocating DMA
for its rings and buffers, all as brokered grants scoped to a claim epoch. Everything above those grants,
the reset, the descriptor rings, the transmit and receive path, and the request server, is ordinary
userland code inside the capsule.

The frames it moves belong to the [network stack](/docs/subsystems/networking/): the
[NIC driver page](/docs/subsystems/networking/drivers/) describes how `net_core` binds to a driver like
this one over IPC and feeds its frames into smoltcp. This driver never speaks IP; it moves Ethernet frames
and reports link and MAC state. Policy lives above the driver boundary.

The source under `userland/capsule_driver_rtl8169/src/` is organized by concern, and this documentation
mirrors that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-rtl8169` | `Capsule.mk:6` |
| Service handle | `driver.rtl8169_0` | `Capsule.mk:7`, [`src/hardware/rtl8169_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8169_capsule/spawn.rs#L32) |
| Namespace | `systems.nonos.driver.rtl8169_0` | `Capsule.mk:12` |
| Service endpoint | `service:4214:driver.rtl8169_0` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4215:endpoint.4294967310` | `Capsule.mk:14`, `spawn.rs:34`, [`client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/client/transport.rs#L25) |
| Capability mask | `0xF8019` | `Capsule.mk:16`, `spawn.rs:51` |
| Binary name | `driver_rtl8169` | `Capsule.mk:10`, `Cargo.toml:14` |
| Kernel mirror | `src/hardware/rtl8169_capsule` | [`src/hardware/rtl8169_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8169_capsule/spawn.rs) |

The reply endpoint number `4294967310` is `0x1_0000_000E`, the kernel reply-inbox constant the capsule
sends every reply to. The kernel names it `REPLY_INBOX = "endpoint.4294967310"`
([`src/hardware/rtl8169_capsule/client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8169_capsule/client/transport.rs#L25)), and the capsule hard-codes the same value as
`KERNEL_REPLY_ENDPOINT = 0x1_0000_000E` ([`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17)). The service port `4214` and reply
port `4215` in the manifest match `SERVICE_PORT` and `REPLY_PORT` in the kernel spawn record exactly
(`spawn.rs:33`, `spawn.rs:34`).

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

The kernel spawn path requests exactly those seven capabilities and no others (`spawn.rs:51`), which matches
the value and comment in the manifest (`Capsule.mk:15`). Like the NVMe driver, this NIC driver holds the
hardware-broker authority bits: `DeviceEnum` (enumerate devices), `Driver` (claim and release a device),
`Mmio` (map device registers), `Irq` (bind a device interrupt), and `Dma` (map DMA). It has no `Network`
bit (4), no `FileSystem` bit (64), no PIO, and no graphics or raw-physmem authority. `IPC` and `Memory` are
the only bits it shares with an ordinary application capsule. Holding no `Network` bit is the point: this
driver is the mechanism under the network stack, not a participant in it.

One note on the source README. That file lists `MkIrqPoll` among the broker calls the driver uses
(`README.md:24`), but the shipped code binds the interrupt ([`src/setup/irq.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L23)) and acknowledges it
([`src/rx/recv_one.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L38)) without ever polling a notification slot; the server loop is a blocking IPC
receive, not an IRQ poll. Treat the manifest, the kernel spawn record, and the source as authoritative over
that one line of the README. Everything else in the source README matches the code, including the mask and
the MMIO-only rule.

## The three pillars

The capsule reads as three concerns, and the documentation is one page each. A client request enters through
the protocol and server (the operations page), which reaches a NIC that a one-time bring-up sequence brought
to life (the bring-up page), by driving the transmit and receive descriptor rings the ring engine owns (the
rings page).

```
  client op    ->   server/protocol   ->   tx / rx rings   ->   controller
  NR69 IPC          decode, dispatch       descriptors, DMA     real RTL8169 NIC

  one-time setup + bring-up:
  discover -> claim -> bus master -> BAR map -> IRQ bind -> DMA rings ->
  soft reset -> read MAC -> program rx ring -> program tx ring -> enable
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-rtl8169/operations/) | `src/protocol/`, `src/server/` | The `NR69` wire format, the request loop, the six client ops, per-op payloads, the errno set, and the frame bounds. |
| [bring-up.md](/docs/userland/driver-rtl8169/bring-up/) | `src/setup/`, `src/discover*`, `src/init/`, [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs), `src/constants/` | Discovery, the broker grants (claim, bus master, MMIO, IRQ, DMA), the register block, the soft reset, MAC read, and device enable. |
| [rings.md](/docs/userland/driver-rtl8169/rings/) | `src/queue/`, `src/tx/`, `src/rx/` | The transmit and receive descriptor rings, the `OWN` bit handshake, the DMA buffers, and the send and receive paths. |
| [contributing.md](/docs/userland/driver-rtl8169/contributing/) | the whole tree | Where each concern lives, how to add a client op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-rtl8169/debugging/) | runtime | The boot marker, the setup and bring-up exit codes, and the runtime failure modes: link down, RX empty, and a TX timeout on real hardware. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, runs `setup::run` to acquire the grants
and build the `Driver`, runs `init::bring_up` to reset and enable the device, and hands the driver to the
request server, which loops forever ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). `setup::run` acquires the broker grants
([`src/setup/sequence.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L25)) and `init::bring_up` programs the device ([`src/init/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L24)); a failure in
either exits with a distinct code and never serves a request, and a bring-up failure releases the grants
first ([`src/main.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L44), [`src/main.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L48)). The kernel spawns it through
[verified spawn](/docs/security/capsules-and-trust/) under the NIC driver plan, checking its signature and
attestation and holding its requested capabilities against its manifest ceiling before its ELF is mapped
([`src/userspace/init/spawn_plan/drivers_nic.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L50)). A successful spawn prints `[DRIVER-RTL8169] capsule
spawned` on the boot log; the [debugging](/docs/userland/driver-rtl8169/debugging/) page covers what that and each exit code mean.

Once bring-up succeeds the capsule is a raw-frame backend. Clients speak the small `NR69` binary protocol
over IPC to ask for liveness, link state, the hardware MAC, a register snapshot, and to transmit one
Ethernet frame or poll one received frame. The capsule does not parse ARP, IP, or any higher protocol, hold
peer identity, or persist traffic; it is the mechanism the [network stack](/docs/subsystems/networking/stack/)
is built on, not the policy.

## Source map

```
  userland/capsule_driver_rtl8169/src/main.rs        _start -> setup::run -> init::bring_up -> server::run
  userland/capsule_driver_rtl8169/src/protocol/      the NR69 wire format: header, ops, errno, limits, decode/encode
  userland/capsule_driver_rtl8169/src/server/        the request loop and one handler per op
  userland/capsule_driver_rtl8169/src/discover.rs    the mk_device_list scan for the Realtek NIC
  userland/capsule_driver_rtl8169/src/discover/      the PCI id match, the MMIO BAR pick, the command bits
  userland/capsule_driver_rtl8169/src/setup/         the grant sequence, the Driver struct, and rollback
  userland/capsule_driver_rtl8169/src/init/          reset, MAC read, rx/tx ring programming, device enable
  userland/capsule_driver_rtl8169/src/queue/         the descriptor struct and the RxRing / TxRing cursors
  userland/capsule_driver_rtl8169/src/tx/            the send path and the completion poll
  userland/capsule_driver_rtl8169/src/rx/            the receive path and descriptor rearm
  userland/capsule_driver_rtl8169/src/regs.rs        Regs: volatile 8/16/32-bit access over the BAR mapping
  userland/capsule_driver_rtl8169/src/constants/     register offsets, command and descriptor bits, PCI ids, ring sizes
  userland/capsule_driver_rtl8169/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/hardware/rtl8169_capsule/                       the kernel-side embed and verified spawn
  src/capabilities/types.rs                           the capability bit values behind the mask
```

Every reference above is verified against those trees.
