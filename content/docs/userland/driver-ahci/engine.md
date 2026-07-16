---
title: "The AHCI command engine"
description: "This page mirrors src/engine/: the DMA regions the broker hands back, the fixed hardware structures the driver builds in them, the per-port program and stop/start cycle, and the..."
weight: 4
---
This page mirrors `src/engine/`: the DMA regions the broker hands back, the fixed hardware structures the
driver builds in them, the per-port program and stop/start cycle, and the issue path that puts a command
in slot 0 and polls it to completion. Everything here is driven either by `init_port` at bring-up or by a
read, write, or flush handler at request time. For how the port is chosen and the register window is
mapped, see [bringup.md](/docs/userland/driver-ahci/bringup/); for the requests that reach `transfer` and `flush`, see
[operations.md](/docs/userland/driver-ahci/operations/).

## DMA regions

Every device-visible buffer is a `DmaRegion` obtained from the broker with `mk_dma_map`, which returns a
user VA the driver reads and writes, a device physical address it programs into the hardware structures,
and a grant id ([`src/engine/region.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/region.rs#L28)). The driver never invents a physical address; it only programs
the ones the broker handed it. Each region unmaps itself on drop with `mk_dma_unmap`
([`src/engine/region.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/region.rs#L46)), so the port's four regions are freed when the `Port` drops. The
[dma](/docs/subsystems/hardware-broker/dma/) broker page describes how the allocation is bounded and
tracked.

`init_port` allocates four regions ([`src/engine/init.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/init.rs#L24)):

```
  clb    STRUCT_REGION_BYTES  4 KiB   the command-list base (command header 0)
  ctba   STRUCT_REGION_BYTES  4 KiB   the command-table base (CFIS, ACMD, PRDT)
  fb     STRUCT_REGION_BYTES  4 KiB   the received-FIS base
  data   DATA_BUF_BYTES      32 KiB   the read/write data buffer (MAX_SECTORS * 512)
```

`STRUCT_REGION_BYTES` is 4096 and `DATA_BUF_BYTES` is `MAX_SECTORS * SECTOR_SIZE`, that is `64 * 512` =
32 KiB ([`src/constants/ata.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L29)). The `fb` region is held only to keep the mapping alive; the port
stores it as `_fb` ([`src/engine/port.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/port.rs#L22)).

## The hardware structures

The three structures the controller reads are fixed C layouts with `repr(C, packed)` and compile-time
size assertions, so a layout mistake fails the build:

```
  CmdHeader   32 bytes   flags, pm, prdtl, prdbc, ctba_low/high, rsv[4]   engine/cmd_header.rs:19, :29
  CmdTable   144 bytes   cfis[64], acmd[16], rsv[48], prdt[1]             engine/cmd_table.rs:21, :28
  FisH2D      20 bytes   Register Host-to-Device FIS                      engine/fis.rs:19, :39
  PrdtEntry   16 bytes   dba_low, dba_high, rsv, dbc                      engine/prdt.rs:19, :26
```

The PRDT sits inside the command table at byte offset 128, `PRDT_OFFSET` ([`src/engine/cmd_table.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/cmd_table.rs#L29)).
Only one PRDT entry is used, so `prdtl` is always 1 for a data command.

## Programming the port

`init_port` runs three steps against the port before issuing anything: stop, program, start
([`src/engine/init.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/init.rs#L30)).

`stop` clears `PxCMD.ST`, spins until the command-list-running and FIS-receive-running bits (`CR`, `FR`)
clear or the poll limit is hit, then clears `PxCMD.FRE` ([`src/engine/stop.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/stop.rs#L21)). Idling the engines is
required before the command-list and FIS base addresses can be reprogrammed.

`program` writes command header 0 into the command-list region pointing at the command table's physical
address, programs `PxCLB`/`PxCLBU` and `PxFB`/`PxFBU` with the command-list and FIS physical addresses,
clears `PxIS` and `PxSERR` by writing back what it read, sets the port interrupt-enable default
`PORT_IE_DEFAULT`, disables aggressive link power management by setting `PxSCTL.IPM` to the disable
pattern `7 << 8`, and spins the port up with `PxCMD.POD | PxCMD.SUD`
([`src/engine/program.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/program.rs#L24), [`src/constants/regs.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L43)).

`start` waits for `CR` to clear, then sets `FRE | ST` to re-enable the FIS-receive and command engines
([`src/engine/start.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/start.rs#L21)). Both spins in stop and start are bounded by `COMPLETION_POLL_LIMIT`
([`src/constants/ata.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L33)).

There is no controller-wide HBA reset in this slice; the per-port stop/start cycle here, together with
discovery tolerating an `irq_line` of `0xff`, is what makes the driver come up on real x86_64 SATA
controllers as well as on QEMU's `ich9-ahci` ([`src/engine/stop.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/stop.rs#L21), [`src/engine/start.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/start.rs#L21),
[`src/discover.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L60)).

## Building a command in slot 0

Every command is issued in slot 0. `build_slot0` constructs the command table and command header for a
data command ([`src/engine/build.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/build.rs#L26)):

1. It builds a Register Host-to-Device FIS carrying the ATA command byte, the 48-bit LBA split across
   `lba0..lba5`, and the sector count in `countl`/`counth`. For anything but `IDENTIFY` it sets the
   LBA-mode device bit `ATA_DEV_LBA` (`1 << 6`); `IDENTIFY` uses device 0
   ([`src/engine/build.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/build.rs#L29), [`src/constants/ata.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L25)).
2. It zeroes the whole command table, then writes the FIS at the table base
   ([`src/engine/build.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/build.rs#L63)).
3. It writes one PRDT entry at `table + PRDT_OFFSET` pointing at the data buffer's physical address with a
   byte-count-minus-one length in `dbc`, as the hardware expects ([`src/engine/prdt_write.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/prdt_write.rs#L19)).
4. It writes command header 0 into the command-list region with the FIS length in dwords
   (`FIS_H2D_LEN_DWORDS`, 5), `prdtl = 1`, the command table's physical address, and the write flag
   `CMD_HEADER_WRITE` (`1 << 6`) when the transfer is outbound ([`src/engine/build.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/build.rs#L54),
   [`src/constants/ata.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L22)).

`flush` builds a simpler command by hand: the same H2D FIS with `FLUSH CACHE EXT` and the LBA device bit,
a command header with `prdtl = 0` and no PRDT because there is no data transfer
([`src/engine/flush.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/flush.rs#L27)).

## Issuing and polling

`issue_slot0` is the single completion path for every command ([`src/engine/issue.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/issue.rs#L22)):

1. Clear `PxIS` by writing all-ones.
2. Spin until the task file leaves `BSY | DRQ`, returning `Timeout` if the spin passes
   `COMPLETION_POLL_LIMIT` ([`src/engine/issue.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/issue.rs#L26)).
3. Write 1 to `PxCI` to issue command slot 0 ([`src/engine/issue.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/issue.rs#L33)).
4. Loop: if an error bit appears in `PxIS` (`IS_ERR_MASK`, the four highest error bits) or `PxTFD.ERR` is
   set, return `CommandFailed`; if `PxCI` bit 0 has cleared, return success; otherwise keep spinning until
   the poll limit yields `Timeout` ([`src/engine/issue.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/issue.rs#L35)).

Completion is decided entirely here by polling, never by the interrupt. `COMPLETION_POLL_LIMIT` is
5,000,000 spin iterations ([`src/constants/ata.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L33)).

On any error the caller runs `recover`, which clears `PxSERR` and `PxIS` by writing them back, then does a
stop/start cycle to re-idle and re-enable the port before the error propagates
([`src/engine/recover.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/recover.rs#L20)). Reissuing the same request after a recover is safe.

## The three command wrappers

Three functions wrap build, issue, and recover for the ATA commands the driver uses:

- `identify` issues `IDENTIFY` (0xEC) into the data buffer, then reads the 48-bit sector count from
  IDENTIFY words 100..103, falling back to the 28-bit count in words 60..61 when the extended count is
  zero, and stores the result as `port.capacity_sectors` ([`src/engine/identify.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/identify.rs#L22),
  [`src/constants/ata.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L17)). This runs once at bring-up and is what `OP_CAPACITY` and the read/write
  range check read back.
- `transfer` issues `READ DMA EXT` (0x25) or `WRITE DMA EXT` (0x35) for the requested LBA and count,
  chosen by the `write` flag ([`src/engine/transfer.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/transfer.rs#L22), [`src/constants/ata.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L18)).
- `flush` issues `FLUSH CACHE EXT` (0xEA) with no PRDT ([`src/engine/flush.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/flush.rs#L27),
  [`src/constants/ata.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs#L20)).

All three run `recover` and return the error on an issue failure, so a caller sees a clean `Err` and the
port is left re-idled and restarted ([`src/engine/identify.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/identify.rs#L24), [`src/engine/transfer.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/transfer.rs#L25),
[`src/engine/flush.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/flush.rs#L48)).

## The port model

A `Port` owns its four DMA regions, its register base offset, and its identified capacity
([`src/engine/port.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/port.rs#L19)). The base is `PORT_BASE + index * PORT_STRIDE` computed once at bring-up
([`src/engine/init.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/init.rs#L29)) and reused for every register access, so the engine never needs the port index
again. The capacity starts at zero and is filled in by `identify`. Read and write copy client data through
`port.data.user_va()` and program `port.data.device_addr()` into the PRDT, keeping the CPU-visible and
device-visible views of the same buffer separate and explicit ([`src/engine/build.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/build.rs#L27),
[`src/server/handlers/read.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L48)).

## Source map

```
  src/engine/init.rs         init_port: allocate DMA, stop/program/start, identify
  src/engine/region.rs       DmaRegion: mk_dma_map / mk_dma_unmap, user and device addresses
  src/engine/port.rs         the Port: four regions, base offset, capacity
  src/engine/cmd_header.rs   the 32-byte command header layout
  src/engine/cmd_table.rs    the 144-byte command table and PRDT_OFFSET
  src/engine/fis.rs          the 20-byte Register H2D FIS
  src/engine/prdt.rs         the 16-byte PRDT entry
  src/engine/prdt_write.rs   writing the single PRDT entry (byte-count-minus-one)
  src/engine/build.rs        build_slot0: FIS, PRDT, and command header 0
  src/engine/program.rs      port register programming (CLB/FB, IE, SCTL, POD/SUD)
  src/engine/stop.rs         clear ST, wait CR|FR idle, clear FRE
  src/engine/start.rs        wait CR clear, set FRE|ST
  src/engine/issue.rs        issue_slot0: clear IS, wait BSY|DRQ, set CI, poll to completion
  src/engine/recover.rs      clear SERR/IS and cycle the port after an error
  src/engine/identify.rs     IDENTIFY and the capacity read
  src/engine/transfer.rs     READ/WRITE DMA EXT
  src/engine/flush.rs        FLUSH CACHE EXT, no PRDT
  src/constants/ata.rs       ATA commands, FIS fields, SECTOR_SIZE, MAX_SECTORS, poll limit
  src/constants/regs.rs      port register offsets and the command/TFD bit masks
  docs/subsystems/hardware-broker/dma.md   the mk_dma_map allocation contract
```

Every reference above is verified against those trees.
