---
title: "Debugging capsule_driver_ahci"
description: "This page lists the log markers and exit codes the AHCI driver and its boot path emit, and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log markers and exit codes the AHCI driver and its boot path emit, and the concrete
failure modes with where to look for each. For the driver's structure see the [README](/docs/userland/driver-ahci/), the
[operation surface](/docs/userland/driver-ahci/operations/), the [bring-up](/docs/userland/driver-ahci/bringup/), and the [command engine](/docs/userland/driver-ahci/engine/) pages
in this folder.

## Boot marker

The first thing to confirm is that the capsule ran. The storage fleet boots the driver under the tag
`DRIVER-AHCI` ([`src/userspace/init/spawn_plan/drivers_storage.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L27)), and a live driver prints
`[DRIVER-AHCI] capsule spawned` on the boot log through the capsule boot path
(`docs/userland/drivers.md:294`). If that line is absent the capsule never ran: its ELF failed signature
verification or its manifest asked for more than the trust anchor allows. If the ELF itself fails to load,
the spawn path emits the debug tag `[DRIVER-AHCI] load_elf_executable error:`
([`src/hardware/ahci_capsule/spawn.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ahci_capsule/spawn.rs#L58)).

## Setup exit codes

Setup failures are hard barriers. Each `AhciError` maps to a distinct process exit code, so a driver that
never comes up tells you where it stopped ([`src/error/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L27), [`src/main.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L45)):

```
  2  DeviceNotFound     no PCI AHCI SATA function matched discovery       discover.rs:34
  3  BrokerCallFailed   a claim/pci/mmio/irq/dma broker call returned <0   setup/*, engine/region.rs:31
  4  CommandFailed      IDENTIFY reported PxIS/PxTFD error at bring-up     engine/issue.rs:39
  5  Timeout            a command spun past COMPLETION_POLL_LIMIT          engine/issue.rs:29, :45
```

Exit code 2 means discovery found nothing: no device on the block-class list was a PCI storage controller
with subclass SATA and prog-IF AHCI and BAR5 present as MMIO ([`src/discover.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L52)). Exit code 3 means one
of the broker grants was refused, which usually points at the capability mask or the claim, not the
controller. Exit codes 4 and 5 come from `IDENTIFY` failing during `init_port`, which means a port was
present and SATA-signature but did not answer, so the driver could not record its capacity
([`src/engine/init.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/init.rs#L34)).

## Failure modes

### No block port

If discovery found the controller but no present SATA-signature port came up, `driver.block` is `None` and
every data op returns `E_NODEV` (-19) while `OP_CONTROLLER_INFO` and `OP_PORT_LIST` still answer
([`src/setup/block_port.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/block_port.rs#L35), [`src/server/handlers/capacity.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L27)). `OP_PORT_LIST` is the probe: it
returns the setup-time snapshot, so check each entry's `present` flag, its `PxSSTS` (`DET` and `IPM`), and
its `PxSIG` signature to see whether a disk is actually attached and what it reports
([`src/controller/scan_ports.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/scan_ports.rs#L65), [`src/controller/signature.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/signature.rs#L20)). A port marked present but not SATA,
for example an ATAPI or SEMB signature, is skipped by `bring_up`, which takes only SATA
([`src/setup/block_port.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/block_port.rs#L29)).

### Command timeout or error

A read, write, or flush that returns `E_IO` (-5) means `issue_slot0` saw an error in `PxIS` or `PxTFD` or
spun past `COMPLETION_POLL_LIMIT`, after which `recover` cleared `PxSERR` and `PxIS` and cycled the port
([`src/engine/issue.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/issue.rs#L35), [`src/engine/recover.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/recover.rs#L20)). Reissuing the same request after a recover is
safe. A persistent `E_IO` points at the controller or the disk, not the wire format. Because completion is
polled and the poll limit is 5,000,000 iterations, a hung controller shows up as a long stall followed by
`E_IO`, not a wedged loop ([`src/constants/ata.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L33)).

### Range or size rejects

These are decided before any hardware access, so they are pure client-side protocol errors:

- `E_NXIO` (-6) is an LBA range past the identified capacity ([`src/server/handlers/rw_parse.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L30)).
- `E_INVAL` (-22) is a zero or over-64 sector count, a bad opcode, a bad magic or version, or a fixed-size
  op that carried a payload ([`src/server/handlers/rw_parse.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L26), [`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57)).
- `E_MSGSIZE` (-90) is a read or write whose declared length did not match `12 + count * 512`
  ([`src/server/handlers/read.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L34), [`src/server/handlers/write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L34)).

### A malformed request that is silently answered

A frame whose first four bytes are not `NAHC` or whose version is not 1 is dropped inside `decode_request`
and answered `E_INVAL` through the decode-failed path, with a zeroed request id
([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23), [`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)). A client that gets a bare `E_INVAL` with no echo
of its request id should check that it is sending the 20-byte `NAHC` v1 header.

## On real hardware

Two design choices exist specifically so the driver comes up on real x86_64 SATA controllers, not only on
QEMU's `ich9-ahci`. First, discovery does not require a routed interrupt line: a controller reporting
`irq_line = 0xff` (common on APIC and MSI laptop platforms) is still a candidate, because completion is
polled and never waits on the interrupt ([`src/discover.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L60)). Second, there is no controller-wide HBA
reset; the bring-up asserts AHCI mode and does a per-port stop/start cycle instead, which idles the port
before reprogramming its command-list and FIS base and re-enables the engines afterward
([`src/engine/stop.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/stop.rs#L21), [`src/engine/start.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/start.rs#L21)). If a controller that works under QEMU does not come
up on real hardware, the `OP_PORT_LIST` snapshot and the setup exit code are the two probes: exit code 3
is a refused grant, exit code 4 or 5 is a present port that would not answer `IDENTIFY`.

The no-IOMMU caveat is the standing limit. A bus-mastering SATA controller programmed with physical DMA
addresses can, at the silicon level, read or write any physical address it is told to. This driver only
ever programs addresses `mk_dma_map` returned ([`src/engine/region.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/region.rs#L28)) and range-checks every client
LBA before issuing ([`src/server/handlers/rw_parse.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L30)), but on a platform where the kernel has not
engaged an IOMMU the hardware does not enforce that the controller stays inside those regions. The
enforcement is the driver's correctness plus the broker's grant discipline, described on the
[broker DMA page](/docs/subsystems/hardware-broker/dma/).

## Source map

```
  src/userspace/init/spawn_plan/drivers_storage.rs   the DRIVER-AHCI spawn tag
  src/hardware/ahci_capsule/spawn.rs                 the load_elf_executable error debug tag
  src/main.rs                        _start: setup exit code on failure
  src/error/types.rs                 AhciError and exit_code (2/3/4/5)
  src/discover.rs                    the candidate match and the irq_line 0xff tolerance
  src/setup/block_port.rs            picks the first present SATA port; None on no port
  src/controller/scan_ports.rs       the present test and the port snapshot
  src/controller/signature.rs        the PxSIG classification
  src/engine/init.rs                 init_port and the IDENTIFY at bring-up
  src/engine/issue.rs                the poll path: CommandFailed and Timeout
  src/engine/recover.rs              clear SERR/IS and cycle the port after an error
  src/engine/stop.rs                 the per-port stop before reprogramming
  src/engine/start.rs                the per-port start after reprogramming
  src/engine/region.rs               DmaRegion: only broker-returned addresses
  src/server/runner.rs               the fixed-size payload guard and dispatch
  src/server/error.rs                the decode-failed reply
  src/server/handlers/rw_parse.rs    E_INVAL / E_NXIO / E_MSGSIZE range and size checks
  src/protocol/decode.rs             magic/version rejection
  docs/userland/drivers.md           the [DRIVER-AHCI] capsule-spawned marker
  docs/subsystems/hardware-broker/dma.md   the no-IOMMU DMA caveat
```

Every reference above is verified against those trees.
