---
title: "The AHCI Driver Capsule"
description: "capsuledriverahci is the SATA storage driver in the NØNOS tree: a signed userland capsule that owns one AHCI host bus adapter, enumerates its ports, brings up the first usable S..."
weight: 400
---
`capsule_driver_ahci` is the SATA storage driver in the NØNOS tree: a signed userland capsule that owns
one AHCI host bus adapter, enumerates its ports, brings up the first usable SATA disk, and serves sector
read, write, and flush over IPC. It is a block-device backend and nothing more. Partitioning,
filesystems, encryption, and cache policy all live above it in separate storage capsules; this capsule
only moves sectors and reports controller state. It reaches hardware exclusively through the
[hardware broker](/docs/subsystems/hardware-broker/), never through kernel driver code.

The source under `userland/capsule_driver_ahci/src/` splits cleanly into a client-facing wire protocol, a
one-shot privileged bring-up, and a hardware command engine. This documentation mirrors that split one
page per pillar, so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-ahci` | `Capsule.mk:6` |
| Service handle | `driver.ahci0` | `Capsule.mk:7`, [`src/hardware/ahci_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/spawn.rs#L32) |
| Namespace | `systems.nonos.driver.ahci0` | `Capsule.mk:12` |
| Service endpoint | `service:4216:driver.ahci0` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4217:endpoint.4294967311` | `Capsule.mk:14`, `spawn.rs:34` |
| Reply inbox (kernel) | `endpoint.4294967311` (`0x1_0000_000f`) | [`src/hardware/ahci_capsule/client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/client/transport.rs#L25), [`src/protocol/endpoint.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L18) |
| Capability mask | `0xf8019` | `Capsule.mk:16` |
| Binary name | `driver_ahci` | `Capsule.mk:10` |
| Kernel mirror | `src/hardware/ahci_capsule` | [`src/hardware/ahci_capsule/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/mod.rs) |

The reply endpoint name `endpoint.4294967311` is the decimal spelling of the reply-inbox id the capsule
sends every response to. That id is `KERNEL_REPLY_ENDPOINT = 0x1_0000_000f` in the capsule
([`src/protocol/endpoint.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L18)) and `REPLY_INBOX = "endpoint.4294967311"` on the kernel side
([`src/hardware/ahci_capsule/client/transport.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/client/transport.rs#L25)); `0x1_0000_000f` is 4294967311, so the two agree.

### The capability mask

The mask `0xf8019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), where each capability's
numeric value is the return of its `bit()` method:

```
  0x00001  CoreExec     bit()      1     types.rs:56
  0x00008  IPC          bit()      8     types.rs:59
  0x00010  Memory       bit()     16     types.rs:60
  0x08000  DeviceEnum   bit()  32768     types.rs:71
  0x10000  Driver       bit()  65536     types.rs:72
  0x20000  Mmio         bit() 131072     types.rs:73
  0x40000  Irq          bit() 262144     types.rs:74
  0x80000  Dma          bit() 524288     types.rs:75
  -------
  0xf8019  = 1 + 8 + 16 + 32768 + 65536 + 131072 + 262144 + 524288
```

Those are exactly the capabilities a bus-mastering MMIO device driver needs and nothing more.
`DeviceEnum` is enumerate-only, `Driver` allows claim and release of one device, `Mmio` maps a device's
register window, `Irq` binds its interrupt, and `Dma` allocates device-visible buffers; the comment on
the capability enum spells out that split ([`src/capabilities/types.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L35)). There is no `Pio` bit
(0x100000, `types.rs:76`), no `FileSystem` bit (64, `types.rs:62`), no `Network` bit (4, `types.rs:58`),
and no `Admin` (512, `types.rs:65`) or `Debug` (256, `types.rs:64`). The driver cannot touch an I/O port,
read a file, open a socket, or reach raw kernel memory.

The `Dma` bit is the one that separates this driver from a non-bus-mastering device driver such as `hda`
or `i2c_pci`, which get `Mmio` and `Irq` but not `Dma` (`docs/userland/drivers.md:269`). AHCI holds it
because it moves sector data through descriptor rings in RAM.

Two identity notes worth recording, because they are places where the code and its neighbours can drift:

- The `Capsule.mk` comment on line 15 lists `IPC|Memory|Driver|DeviceEnum|Mmio|Irq|Dma = 0xf8019`, but
  that seven-name set sums to `0xf8018`. The extra `0x1` in the real mask is `CoreExec`, which every
  runnable capsule needs and which the comment simply omits. The numeric value `0xf8019` on line 16 is
  the authority signed into the manifest, and it is the one decomposed above.
- The kernel-side spawn record requests only the seven hardware and IPC bits and not `CoreExec`
  explicitly ([`src/hardware/ahci_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/spawn.rs#L51)). The signed manifest mask `0xf8019`
  (`Capsule.mk:16`) is the ceiling the trust anchor enforces; the spawn `requested_caps` is a request
  bounded by that manifest, and `CoreExec` is granted to the capsule as a matter of being an executable
  process.

## The three pillars

`_start` initialises the heap, runs the one-shot setup sequence, and hands the resulting `Driver` to the
server loop; if setup fails it exits with a code derived from the error
([`userland/capsule_driver_ahci/src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/main.rs#L38)). The two halves stay clean: `setup::run` performs every
privileged bring-up step once and returns a `Driver` that owns the broker grants and the mapped register
window, and `server::run` is an endless request loop that never touches the broker again except to poll
and acknowledge the controller interrupt ([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26), [`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)).

The source is three top-level concerns. Setup drives the engine to bring a port up; the server drives the
engine to answer requests.

```
   setup/  controller/  discover.rs        engine/               protocol/  server/
   +--------------------------------+      +----------------+    +-------------------+
   | discover -> claim -> mmio ->   |----->| DMA regions,   |<---| NAHC wire format, |
   | irq -> enable -> scan -> port  |      | FIS, cmd list, |    | request loop, and |
   | bring-up (broker grants)       |      | PRDT, issue,   |    | the seven ops     |
   +--------------------------------+      | recover        |    +-------------------+
        the privileged bring-up           the command path        the client surface
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-ahci/operations/) | `src/protocol/`, `src/server/` | The `NAHC` wire format, the request loop and dispatch, the IRQ poll, and every one of the seven ops with its opcode, payloads, and errno set. |
| [bringup.md](/docs/userland/driver-ahci/bringup/) | [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/setup/`, `src/controller/`, `src/handles/` | The one-shot bring-up: PCI discovery, the broker claim, bus-master enable, ABAR mapping, IRQ bind, AHCI-mode enable, port scan, and the grant owners that free everything on drop. |
| [engine.md](/docs/userland/driver-ahci/engine/) | `src/engine/`, `src/regs/` | The command engine: DMA regions, the command list, FIS, command table and PRDT layouts, port program and stop/start, and issue, identify, transfer, flush, and recover. |
| [contributing.md](/docs/userland/driver-ahci/contributing/) | the whole tree | Where each behaviour lives, how to add an op or an ATA command, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-ahci/debugging/) | runtime | The boot marker, the setup exit codes, the no-port and command-timeout failure modes, and the real-hardware notes. |

## Lifecycle

The driver is spawned by the kernel as part of the storage driver fleet. Its signature and attestation
are checked, its `requested_caps` are held against the signed manifest ceiling `0xf8019`, and only then
is its ELF mapped and run ([`src/hardware/ahci_capsule/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/spawn.rs#L37)). `setup::run` executes the whole
privileged path once and returns a `Driver`, or exits the process with a setup exit code
([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26), [`src/main.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L43)). On success the storage fleet logs `[DRIVER-AHCI] capsule
spawned` ([`src/userspace/init/spawn_plan/drivers_storage.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L27), `docs/userland/drivers.md:294`), and the
server enters its request loop. The [debugging](/docs/userland/driver-ahci/debugging/) page covers what each later exit code and
errno means.

## Operation summary

The service accepts one request at a time on its endpoint, decodes the 20-byte `NAHC` header, and
dispatches on the operation id ([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)). The seven ops and their opcodes
([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)):

| Op | Opcode | Purpose |
|---|---|---|
| `OP_HEALTHCHECK` | 1 | liveness probe, replies with a status word only |
| `OP_CONTROLLER_INFO` | 2 | read the HBA global registers live and return them |
| `OP_PORT_LIST` | 3 | return the setup-time snapshot of every implemented port |
| `OP_CAPACITY` | 4 | return the identified sector count of the block port |
| `OP_READ_BLOCKS` | 5 | read `count` sectors from `lba` |
| `OP_WRITE_BLOCKS` | 6 | write `count` sectors to `lba` |
| `OP_FLUSH` | 7 | issue `FLUSH CACHE EXT`, no data transfer |

The full request and reply layouts, the errno set, and the range and size checks are on the
[operations](/docs/userland/driver-ahci/operations/) page.

## Source map

```
  src/main.rs                        _start -> setup::run -> server::run
  src/discover.rs                    find_ahci: PCI storage/SATA/AHCI match, irq_line 0xff tolerated
  src/setup/                         the one-shot bring-up: claim, pci, mmio, irq, block_port, sequence
  src/controller/                    AHCI enable, global registers, port scan, signature classify
  src/engine/                        DMA regions, command list/FIS/table/PRDT, issue/identify/transfer/flush/recover
  src/protocol/                      the NAHC wire format: header, decode, encode, ops, errno, limits, endpoint
  src/server/                        the request loop, dispatch, IRQ poll, and one handler per op
  src/handles/                       BrokerHandles: device, mmio, irq grants freed on drop
  src/regs/                          the volatile 32-bit MMIO register wrapper
  src/constants/                     HBA/port register offsets, ATA commands, signatures, port kinds
  src/error/                         AhciError and the setup exit-code mapping
  Capsule.mk                         slug, handle, ports, capability mask
  src/capabilities/types.rs          the capability bits the mask decomposes into
  src/hardware/ahci_capsule/         the kernel-side embed, verified spawn, and client
  src/userspace/init/spawn_plan/drivers_storage.rs   the storage-fleet spawn entry
  docs/subsystems/hardware-broker/   the claim, mmio, dma, and irq grant contracts
```

Every reference above is verified against those trees.
