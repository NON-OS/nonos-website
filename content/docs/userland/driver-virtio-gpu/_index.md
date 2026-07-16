---
title: "The virtio-gpu Driver Capsule"
description: "capsuledrivervirtiogpu is the 2D display backend the desktop compositor presents through."
weight: 400
---
`capsule_driver_virtio_gpu` is the 2D display backend the desktop compositor presents through. It is a
signed userland capsule that owns one virtio-gpu PCI function: it claims the device through the broker,
maps its registers, binds its interrupt, allocates its control-queue DMA, runs the virtio negotiation,
builds the primary scanout surface, and then serves an `NVGP` IPC protocol that the compositor drives per
frame. Everything above the device (composition, damage, focus, cursor, window ownership) stays outside
this capsule; the driver holds the hardware authority and nothing else.

The source is organized into three engine pillars plus a wire layer, and this documentation mirrors that
structure one page per pillar so a page can be read beside the folder it describes. There is no VirGL, no
Venus, and no 3D acceleration anywhere in this capsule: it negotiates only `VIRTIO_F_VERSION_1`, drives
the fixed 2D control commands, and copies finished pixels to the host.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-virtio-gpu` | `Capsule.mk:5` |
| Service handle | `driver.virtio_gpu0` | `Capsule.mk:6`, [`src/hardware/virtio_gpu_capsule/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_gpu_capsule/spawn.rs#L31) |
| Namespace | `systems.nonos.driver.virtio_gpu0` | `Capsule.mk:11` |
| Service endpoint | `service:4226:driver.virtio_gpu0` | `Capsule.mk:12`, [`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32), `spawn.rs:32` |
| Reply endpoint | `reply:4227:endpoint.4294967316` | `Capsule.mk:13`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x1F9019` | `Capsule.mk:16` |
| Binary name | `driver_virtio_gpu` | `Capsule.mk:9` |
| Kernel mirror | `src/hardware/virtio_gpu_capsule` | `Capsule.mk:17` |

The service registers itself by name from `main.rs`: `SERVICE_NAME = b"driver.virtio_gpu0"`,
`SERVICE_PORT = 4226` ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31), `:32`). The reply inbox `endpoint.4294967316` and reply port
`4227` come from the kernel spawn record (`spawn.rs:33`). The inbox number `4294967316` is `0x1_0000_0014`,
the reply-endpoint id the spawn machinery assigns; the driver itself replies to each request through
`mk_ipc_reply` addressed to the sender pid, not to a fixed reply port ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)).

The mask `0x1F9019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x000001  CoreExec                bit()       1     types.rs:56
  0x000008  IPC                     bit()       8     types.rs:59
  0x000010  Memory                  bit()      16     types.rs:60
  0x001000  GraphicsSurfaceCreate   bit()    4096     types.rs:68
  0x008000  DeviceEnum              bit()   32768     types.rs:71
  0x010000  Driver                  bit()   65536     types.rs:72
  0x020000  Mmio                    bit()  131072     types.rs:73
  0x040000  Irq                     bit()  262144     types.rs:74
  0x080000  Dma                     bit()  524288     types.rs:75
  0x100000  Pio                     bit() 1048576     types.rs:76
  --------
  0x1F9019  = 1 + 8 + 16 + 4096 + 32768 + 65536 + 131072 + 262144 + 524288 + 1048576
```

The kernel spawn path requests exactly those ten capabilities and no others
([`src/hardware/virtio_gpu_capsule/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_gpu_capsule/spawn.rs#L50)). There is no `Network` bit, no `FileSystem` bit, and no
`GraphicsDisplayQuery` bit. Unlike an app such as the terminal, this capsule holds the driver-broker
authority quartet (`Driver`, `Mmio`, `Irq`, `Dma`) plus `Pio` and `DeviceEnum`. That is the whole basis
of its trust boundary: it can claim one device and touch that device's registers, interrupt, and DMA
region, and it can create a surface and speak IPC, but it has no filesystem, network, or compositor
authority. Compromising the driver yields the driver's mask and one virtio-gpu function, nothing more.

## The three pillars

The source under `userland/capsule_driver_virtio_gpu/src/` is a wire layer over three engine pillars, and
the documentation is one page each. Data flows top to bottom at boot and left to right per frame: bring-up
stands the device up, the engine drives the split virtqueue and holds the resource and scanout tables, and
the client/protocol layer turns compositor IPC into engine calls.

```
  discover/ + setup/ + init/   ->   device/ + state/ + regs/   ->   protocol/ + server/
  find, claim, grant, negotiate     virtqueue, control cmds,       NVGP wire, dispatch,
  the primary surface               resource/scanout tables        the 12 handlers
```

| Page | Mirrors | What it covers |
|---|---|---|
| [bring-up.md](/docs/userland/driver-virtio-gpu/bring-up/) | `src/discover/`, `src/setup/`, `src/init/` | Finding the PCI function, the brokered claim/bus-master/map/irq/dma quartet, the virtio ACK/DRIVER/FEATURES_OK/DRIVER_OK negotiation, seeding scanouts, and building the DMA-backed primary surface. |
| [engine.md](/docs/userland/driver-virtio-gpu/engine/) | `src/device/`, `src/state/`, `src/regs/`, [`src/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs) | The split virtqueue, the six virtio-gpu control commands, the register accessors, and the resource, scanout, and fence tables the handlers act on. |
| [client-protocol.md](/docs/userland/driver-virtio-gpu/client-protocol/) | `src/protocol/`, `src/server/` | The `NVGP` wire format, the receive loop and dispatcher, the twelve ops, primary-surface ownership, and the rect and backing-address bounds every command op enforces. |
| [contributing.md](/docs/userland/driver-virtio-gpu/contributing/) | the whole tree | Where to work, how to add an IPC op or a device command, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-virtio-gpu/debugging/) | runtime | The spawn markers, the no-display and blank-scanout failure modes, and where each `E_*` status comes from. |

## Lifecycle

The capsule is `no_std`/`no_main`. Its `_start` initializes the heap, then loops calling `setup::run()`
until the device comes up, yielding between attempts; on success it registers `driver.virtio_gpu0` on
service port 4226 and enters a blocking IPC loop ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The kernel embeds and verifies the
signed ELF, cert, manifest, and attestation before mapping it, and requests exactly the ten capabilities
above ([`src/hardware/virtio_gpu_capsule/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_gpu_capsule/spawn.rs#L37), `:50`); it is a CPL 3 user binary like every other
capsule. The [bring-up](/docs/userland/driver-virtio-gpu/bring-up/) page walks the setup sequence, and the [debugging](/docs/userland/driver-virtio-gpu/debugging/) page
covers what a failed bring-up looks like on the boot log.

Once running, read-only ops report device and queue state, and the six command ops let the compositor
claim the primary surface and drive real virtio-gpu control commands onto the device. The compositor
resolves `driver.virtio_gpu0` once at setup, fetches its primary surface, and per frame transfers the
dirty rect, sets the scanout on the first frame, and flushes; the client side is documented in the
[compositor gpu-client reference](/docs/userland/compositor/gpu-client/).

## Source map

```
  userland/capsule_driver_virtio_gpu/src/main.rs   _start -> setup::run -> service register -> server::run
  userland/capsule_driver_virtio_gpu/src/discover/ src/setup/ src/init/   the bring-up pillar
  userland/capsule_driver_virtio_gpu/src/device/ src/state/ src/regs/ src/driver.rs   the engine pillar
  userland/capsule_driver_virtio_gpu/src/protocol/ src/server/   the client/protocol pillar
  userland/capsule_driver_virtio_gpu/Capsule.mk    slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                        the capability bit values
  src/hardware/virtio_gpu_capsule                  the kernel-side embed and verified spawn
```

Everything here is drawn from `userland/capsule_driver_virtio_gpu/` (the capsule source and its
`Capsule.mk`), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn mirror under
`src/hardware/virtio_gpu_capsule/`. Every reference above is verified against those trees.
