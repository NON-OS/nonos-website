---
title: "The NVMe Driver Capsule"
description: "capsuledrivernvme is the NØNOS NVMe storage-controller driver: a signed ring-3 capsule that drives a real PCIe NVMe SSD and serves it to the rest of the system as a block device."
weight: 400
---
`capsule_driver_nvme` is the NØNOS NVMe storage-controller driver: a signed ring-3 capsule that drives a
real PCIe NVMe SSD and serves it to the rest of the system as a block device. It does not run in the
kernel and it does not touch the device through any privileged kernel path. It reaches its controller only
through the [hardware broker](/docs/subsystems/hardware-broker/), claiming the PCI function,
mapping BAR0, enabling bus mastering, binding MSI-X, and allocating DMA, all as brokered grants scoped to a
claim epoch. Everything above those grants, the admin queue, the IO queue pair, Identify, SMART, and the
read/write/flush path, is ordinary userland code inside the capsule.

The source under `userland/capsule_driver_nvme/src/` is organized by concern, and this documentation
mirrors that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-nvme` | `Capsule.mk:6` |
| Service handle | `driver.nvme0` | `Capsule.mk:7`, [`src/hardware/nvme_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/nvme_capsule/spawn.rs#L32) |
| Namespace | `systems.nonos.driver.nvme0` | `Capsule.mk:12` |
| Service endpoint | `service:4220:driver.nvme0` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4221:endpoint.4294967313` | `Capsule.mk:14`, `spawn.rs:34` |
| Capability mask | `0xF8019` | `Capsule.mk:16` |
| Binary name | `driver_nvme` | `Capsule.mk:10`, `Cargo.toml:19` |
| Kernel mirror | `src/hardware/nvme_capsule` | [`src/hardware/nvme_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/nvme_capsule/spawn.rs) |

The reply endpoint number `4294967313` is `0x1_0000_0011`, the kernel reply-inbox constant the capsule
sends every reply to ([`src/protocol/endpoint.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L18), [`src/server/error.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L26)).

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

The kernel spawn path requests exactly those seven capabilities and no others
([`src/hardware/nvme_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/nvme_capsule/spawn.rs#L51)), which matches the comment and value in the manifest
(`Capsule.mk:15`). Unlike an application capsule, this driver holds the hardware-broker authority bits:
`DeviceEnum` (enumerate devices), `Driver` (claim and release a device), `Mmio` (map device registers),
`Irq` (bind a device interrupt), and `Dma` (map DMA), the exact set the broker checks before it hands out
any grant ([`src/capabilities/types.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L34)). It has no `Network` bit (4), no `FileSystem` bit (64), and no
graphics or raw-physmem authority. `IPC` and `Memory` are the only bits it shares with an ordinary app.
The security consequences of holding those bits are worked through on the
[bring-up](/docs/userland/driver-nvme/bring-up/) page; the [claim](/docs/subsystems/hardware-broker/claim/) page documents how
the broker enforces them.

## The three pillars

The capsule reads as three concerns, and the documentation is one page each. A client request enters
through the protocol and server (the operations page), which reaches a controller that a one-time bring-up
sequence brought to life (the bring-up page), by driving the submission and completion queues the queue
engine owns (the queues page).

```
  client op   ->   server/protocol   ->   admin + IO queues   ->   controller
  NNVM IPC         decode, dispatch       SQ/CQ, PRP, DMA         real NVMe SSD

  one-time bring-up (setup):
  discover -> claim -> bus master -> BAR0 map -> MSI-X ->
  reset -> admin queues -> enable -> identify -> SMART -> IO queue pair
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-nvme/operations/) | `src/protocol/`, `src/server/` | The `NNVM` wire format, the request loop, the nine client ops, per-op payloads, the errno set, and the read/write bounds. |
| [bring-up.md](/docs/userland/driver-nvme/bring-up/) | `src/setup/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/controller/`, `src/dma/`, `src/handles/`, `src/regs/`, `src/constants/` | Discovery, the broker grants (claim, bus master, BAR0, MSI-X, DMA), the register block, reset and enable, and grant teardown. |
| [queues.md](/docs/userland/driver-nvme/queues/) | `src/admin/`, `src/nvm/` | The submission and completion queue model, doorbells and the phase bit, the PRP path, the admin commands, and the Identify and SMART parsers. |
| [contributing.md](/docs/userland/driver-nvme/contributing/) | the whole tree | Where each concern lives, how to add a client op or an NVMe command, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-nvme/debugging/) | runtime | The boot marker, the bring-up exit codes, and the runtime failure modes: controller not ready, no namespaces, and a DMA timeout on real hardware. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, runs `setup::run`, and hands the built
`Driver` to the request server, which loops forever ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). `setup::run` is the whole bring-up
([`src/setup/sequence.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L30)); if any step fails the process exits with a distinct code and never serves a
request ([`src/main.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L44), [`src/error/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L30)). The kernel spawns it through
[verified spawn](/docs/security/capsules-and-trust/) under the storage spawn plan, checking its
signature and attestation and holding its requested capabilities against its manifest ceiling before its
ELF is mapped ([`src/userspace/init/spawn_plan/drivers_storage.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L49)). A successful spawn prints
`[DRIVER-NVME] capsule spawned` on the boot log; the [debugging](/docs/userland/driver-nvme/debugging/) page covers what that and
each exit code mean.

Once setup succeeds the capsule is a block-device backend. Clients speak the small `NNVM` binary protocol
over IPC to ask for controller info, controller and namespace identity, a SMART snapshot, the namespace
capacity, and to read, write, or flush 512-byte sectors on namespace 1. The capsule does not parse
partitions, mount filesystems, or cache payloads; it is the mechanism a higher-level storage service is
built on, not the policy.

## Source map

```
  userland/capsule_driver_nvme/src/main.rs        _start -> setup::run -> server::run
  userland/capsule_driver_nvme/src/protocol/      the NNVM wire format: header, ops, errno, limits, decode/encode
  userland/capsule_driver_nvme/src/server/        the request loop and one handler per op
  userland/capsule_driver_nvme/src/setup/         the bring-up sequence and the broker calls
  userland/capsule_driver_nvme/src/discover.rs    the mk_device_list scan for the NVMe PCI function
  userland/capsule_driver_nvme/src/controller/    ControllerInfo: read and decode the register block
  userland/capsule_driver_nvme/src/dma/           DmaRegion: the mk_dma_map wrapper and its Drop unmap
  userland/capsule_driver_nvme/src/handles/       BrokerHandles: device id, MMIO and IRQ grants, Drop teardown
  userland/capsule_driver_nvme/src/regs/          Regs: volatile 32/64-bit access over the BAR0 mapping
  userland/capsule_driver_nvme/src/constants/     register offsets, CC/CSTS bits, CAP decoders, PCI class
  userland/capsule_driver_nvme/src/admin/         AdminQueue, the admin commands, and the Identify/SMART parsers
  userland/capsule_driver_nvme/src/nvm/           IoQueue: allocate, create queues, PRP build, transfer, flush
  userland/capsule_driver_nvme/src/error/         NvmeError and the exit-code mapping
  userland/capsule_driver_nvme/Capsule.mk         slug, handle, ports, capability mask, kernel mirror
  src/hardware/nvme_capsule/                       the kernel-side embed and verified spawn
  src/capabilities/types.rs                        the capability bit values behind the mask
```

Every reference above is verified against those trees.
</content>
</invoke>
