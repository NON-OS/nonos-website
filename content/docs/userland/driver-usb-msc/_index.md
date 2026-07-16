---
title: "The USB MSC driver capsule"
description: "capsuledriverusbmsc is the USB Mass Storage class capsule in the NØNOS tree."
weight: 400
---
`capsule_driver_usb_msc` is the USB Mass Storage class capsule in the NØNOS tree. It sits one layer above
the xHCI host-controller driver: it classifies USB configuration descriptors, extracts the bulk-in and
bulk-out endpoints of a SCSI-transparent Bulk-Only Transport interface, builds the BOT command block
wrappers and the SCSI command blocks the storage path needs, and validates the command status wrappers
that come back. Its source is a handful of small module trees, and this documentation mirrors that
structure one page per pillar so a page can be read beside the folder it describes.

Be honest about scope up front, because it is the load-bearing fact. This is a real, compiling, signed,
kernel-spawnable capsule, but it is a partial slice. It builds and validates the BOT/SCSI wire correctly;
it does not schedule any USB transfer, and it does not publish a block device. It owns class framing only.
It never touches a controller register, an interrupt, a DMA buffer, or an I/O port, and it does not move a
single byte of block data itself. The caller runs the actual bulk transfer through the xHCI driver and
feeds each status wrapper back for accounting. The [operations page](/docs/userland/driver-usb-msc/operations/) and the
[contributing page](/docs/userland/driver-usb-msc/contributing/) draw the implemented-versus-stub line exactly.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-usb-msc` | `userland/capsule_driver_usb_msc/Capsule.mk:6` |
| Capsule handle | `driver.usb_msc0` | `Capsule.mk:7`, [`src/userspace/capsule_driver_usb_msc/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_msc/spawn.rs#L31) |
| Domain | `systems.nonos` | `Capsule.mk:8` |
| Namespace | `systems.nonos.driver.usb_msc0` | `Capsule.mk:12` |
| Service endpoint | `service:4224:driver.usb_msc0` | `Capsule.mk:13`, `spawn.rs:32` |
| Reply endpoint | `reply:4225:endpoint.4294967315` | `Capsule.mk:14`, `spawn.rs:33`, `spawn.rs:34` |
| Binary name | `driver_usb_msc` | `Capsule.mk:10` |
| Kernel feature | `nonos-capsule-driver-usb-msc` | `Capsule.mk:11` |
| Capability mask | `0x19` | `Capsule.mk:18` |

The reply inbox string `endpoint.4294967315` is the decimal spelling of `0x1_0000_0013`; the kernel spawn
record stores it as the `REPLY_INBOX` name paired with reply port `4225`
([`src/userspace/capsule_driver_usb_msc/spawn.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_msc/spawn.rs#L33), `spawn.rs:34`).

The mask `0x19` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x01  CoreExec   run as a process
  0x08  IPC        send and receive on its endpoints
  0x10  Memory     map its own heap and stack
  ----
  0x19  = 1 + 8 + 16
```

The kernel spawn path requests exactly those three capabilities and no others: `Capability::CoreExec.bit()
| Capability::IPC.bit() | Capability::Memory.bit()` ([`src/userspace/capsule_driver_usb_msc/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_msc/spawn.rs#L51)).
There is no `DeviceEnum`, no `Driver`, no `Mmio`, no `Irq`, and no `Dma`. There is also no `Debug` bit: the
`Capsule.mk` comment says it is deliberately absent so bulk-transfer payloads never reach the serial
surface, and the spawn spec passes an empty `debug_tag` (`Capsule.mk:16`, `Capsule.mk:17`, `spawn.rs:54`).
That empty hardware and driver surface is the whole basis of the security posture: this is a class capsule
that lives entirely above xHCI and speaks IPC only. The mask is decomposed here and only here; the other
pages assume it.

## The two pillars

The source under `userland/capsule_driver_usb_msc/src/` is a set of small module trees. Two of them carry
the driver's real work and get a page each; the rest are the plumbing that connects them. Data flows in a
straight line: a request arrives over IPC, the operations layer parses and routes it, a build handler asks
the BOT and SCSI layer for a command wrapper, and the reply carries that wrapper back.

```
  IPC request  ->  protocol/ + server/  ->  bot/ + scsi/  ->  IPC reply
  the NUMS         parse, dispatch,          the CBW/CSW      the 31-byte
  envelope         state, descriptors        and the CDBs     wrapper (or a status)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-usb-msc/operations/) | `src/protocol/`, `src/server/`, `src/state/`, `src/descriptors/` | The wire and the request loop: the NUMS envelope, the eight opcodes and their dispatch, the errno set, the descriptor probe, the process-local counters, and the state snapshot. |
| [bot-scsi.md](/docs/userland/driver-usb-msc/bot-scsi/) | `src/bot/`, `src/scsi/` | The command framing: the 31-byte Bulk-Only Transport CBW writer, the 13-byte CSW parser, the INQUIRY / READ CAPACITY(10) / READ(10) / WRITE(10) CDB builders, the transfer-length guard, and the little-endian versus big-endian split. |
| [contributing.md](/docs/userland/driver-usb-msc/contributing/) | the whole tree | Where to work, how to add an operation, what an end-to-end transfer path would still need, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-usb-msc/debugging/) | runtime | The boot marker, the errno failure modes, and how to read the counter snapshot to tell a transport that never bound from one that is failing its transfers. |

## The eight operations at a glance

The capsule speaks eight opcodes on the `driver.usb_msc0` service; the full contract, request bodies, and
reply payloads live on the [operations page](/docs/userland/driver-usb-msc/operations/).

| Op | Opcode | Purpose | Handler |
|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | liveness ping | [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20) |
| `OP_PROBE_CONFIG` | `0x0002` | classify a configuration descriptor, bind endpoints | [`src/server/handlers/probe_config.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe_config.rs#L22) |
| `OP_BUILD_INQUIRY` | `0x0003` | build the INQUIRY CBW | [`src/server/handlers/build_inquiry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_inquiry.rs#L23) |
| `OP_BUILD_READ_CAPACITY10` | `0x0004` | build the READ CAPACITY(10) CBW | [`src/server/handlers/build_capacity.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_capacity.rs#L23) |
| `OP_BUILD_READ10` | `0x0005` | build the READ(10) CBW | [`src/server/handlers/build_read.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_read.rs#L23) |
| `OP_BUILD_WRITE10` | `0x0006` | build the WRITE(10) CBW | [`src/server/handlers/build_write.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_write.rs#L23) |
| `OP_ACCEPT_CSW` | `0x0007` | validate a CSW, fold it into the counters | [`src/server/handlers/accept_csw.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/accept_csw.rs#L22) |
| `OP_GET_STATE` | `0x0008` | return the 48-byte counter snapshot | [`src/server/handlers/get_state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_state.rs#L21) |

## Lifecycle

The capsule is spawned at boot through the USB spawn plan, gated on the `nonos-capsule-driver-usb-msc`
feature. The plan runs `spawn_xhci` then `spawn_usb_hid` then `spawn_usb_msc`, so the transport it depends
on comes up first ([`src/userspace/init/spawn_plan/drivers_usb.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L17), `:51`). The spawn verifies the
embedded ELF, ID cert, manifest, and attestation trailer against the baked trust anchor, requests the
`0x19` capability set, and registers `driver.usb_msc0` on port 4224
([`src/userspace/capsule_driver_usb_msc/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_msc/spawn.rs#L37), `:51`, `:56`). On success the kernel prints
`[DRIVER-USB-MSC] capsule spawned`, from the boot-log `ok` path with the tag string set at the spawn plan
([`src/userspace/init/spawn_plan/drivers_usb.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L55), [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). The capsule's own `_start` initializes the heap and enters the server
loop, which never returns ([`userland/capsule_driver_usb_msc/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/main.rs#L32), `:36`,
[`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)).

From there a storage caller drives it: `OP_PROBE_CONFIG` with the device's configuration descriptor to
bind the endpoints, then the build ops for the command wrappers, then `OP_ACCEPT_CSW` with each status
wrapper the caller read back over xHCI. The capsule never runs a transfer itself. The intended chain, from
the capsule's own README, is `driver.xhci0 -> driver.usb_msc0 -> block service -> filesystem capsules`
(`userland/capsule_driver_usb_msc/README.md:139`). Everything past "build the wrapper" is the caller's job,
and the block-service and mount links in that chain are a later slice.

The xHCI transport this capsule sits on holds the hardware authority this one does not: the device claim,
the MMIO windows, the IRQ binding, and the DMA rings. That authority is documented under the hardware
broker in [claim.md](/docs/subsystems/hardware-broker/claim/),
[mmio.md](/docs/subsystems/hardware-broker/mmio/), [dma.md](/docs/subsystems/hardware-broker/dma/), and
[irq.md](/docs/subsystems/hardware-broker/irq/). This MSC capsule holds none of it.

## Source map

```
  userland/capsule_driver_usb_msc/src/main.rs      _start -> heap_init -> server::run
  userland/capsule_driver_usb_msc/src/protocol/    the NUMS wire, opcodes, errno, limits
  userland/capsule_driver_usb_msc/src/server/      the receive/parse/dispatch/reply loop and handlers
  userland/capsule_driver_usb_msc/src/descriptors/ the configuration-descriptor probe
  userland/capsule_driver_usb_msc/src/state/       process-local bindings, tag, and counters
  userland/capsule_driver_usb_msc/src/bot/         the CBW writer and the CSW parser
  userland/capsule_driver_usb_msc/src/scsi/        the CDB builders and the block-request guard
  userland/capsule_driver_usb_msc/Capsule.mk       slug, handle, ports, capability mask, feature
  src/userspace/capsule_driver_usb_msc/spawn.rs    the kernel-side verified spawn (0x19 caps)
  src/userspace/init/spawn_plan/drivers_usb.rs     the USB spawn plan (xhci, usb_hid, usb_msc)
  src/capabilities/types.rs                        the capability bits the mask decomposes into
```

Every reference above is verified against those trees.
