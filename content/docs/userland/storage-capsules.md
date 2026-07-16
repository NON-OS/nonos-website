---
title: "Storage Capsules"
description: "This page documents the storage-facing capsule set: RAMFS, VFS, virtio block, AHCI, NVMe, and USB mass storage."
weight: 20
---
This page documents the storage-facing capsule set: RAMFS, VFS, virtio block,
AHCI, NVMe, and USB mass storage. Read [Core Service Capsules](/docs/userland/core-capsules/),
[Drivers](/docs/userland/drivers/), and [Storage](/docs/subsystems/storage/) first.

The storage path is split deliberately. File state is owned by RAMFS and VFS.
Block device control is owned by driver capsules. USB mass storage is a command
builder and state tracker that sits behind xHCI and USB descriptors.

---

## 1. Storage Stack Shape

RAMFS starts before core services, VFS starts after drivers and before network,
virtio block starts in the virtio I/O driver group, AHCI and NVMe start in the
storage driver group, and USB MSC starts in the USB group after xHCI and USB HID
([`src/userspace/init/entry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L23),
[`src/userspace/init/entry.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L26),
[`src/userspace/init/spawn_plan/drivers_virtio_io.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio_io.rs#L17),
[`src/userspace/init/spawn_plan/drivers_storage.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L17),
[`src/userspace/init/spawn_plan/drivers_usb.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L17)).

```
+--------------------------+
| ramfs                    |
+------------+-------------+
             |
+------------+-------------+
| core services            |
+------------+-------------+
             |
+------------+-------------+
| block and usb drivers    |
+------------+-------------+
             |
+------------+-------------+
| vfs                      |
+------------+-------------+
             |
+------------+-------------+
| apps and services        |
+--------------------------+
```

## 2. RAMFS and VFS Boundary

RAMFS stores named encrypted file records in memory and dispatches open, read,
write, truncate, and close ([`userland/capsule_ramfs/src/store/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L23),
[`userland/capsule_ramfs/src/store/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L24),
[`userland/capsule_ramfs/src/store/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L25),
[`userland/capsule_ramfs/src/store/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L26),
[`userland/capsule_ramfs/src/store/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L29),
[`userland/capsule_ramfs/src/store/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L30),
[`userland/capsule_ramfs/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L27),
[`userland/capsule_ramfs/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L28),
[`userland/capsule_ramfs/src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L29),
[`userland/capsule_ramfs/src/server/dispatch.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L30),
[`userland/capsule_ramfs/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L31),
[`userland/capsule_ramfs/src/server/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L32)).

VFS owns directory/file entries and open FD slots. It caps files, open FDs, and
file bytes, then dispatches open, close, read, write, stat, list, mkdir, unlink,
rename, and healthcheck ([`userland/capsule_vfs/src/store/fdtable/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L20),
[`userland/capsule_vfs/src/store/fdtable/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L21),
[`userland/capsule_vfs/src/store/fdtable/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L22),
[`userland/capsule_vfs/src/store/fdtable/types.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L37),
[`userland/capsule_vfs/src/store/fdtable/types.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L43),
[`userland/capsule_vfs/src/store/fdtable/types.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/store/fdtable/types.rs#L51),
[`userland/capsule_vfs/src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L27) to
[`userland/capsule_vfs/src/server/dispatch.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L38)).

```
+--------------------------+
| vfs path operation       |
+------------+-------------+
             |
+------------+-------------+
| validate path fd owner   |
+------------+-------------+
             |
+------------+-------------+
| file table mutation      |
+------------+-------------+
             |
+------------+-------------+
| ramfs or vfs response    |
+--------------------------+
```

## 3. Virtio Block

Virtio block allocates receive and transmit buffers sized around read/write
payload limits, receives requests from inbox `0`, decodes the request, and
routes healthcheck, capacity, read blocks, write blocks, and flush
([`userland/capsule_driver_virtio_blk/src/server/runner.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L25),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L26),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L27),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L31),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L37),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L45),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L46),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L47),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L48),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L49),
[`userland/capsule_driver_virtio_blk/src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L50)). The protocol op
table declares those five operations ([`userland/capsule_driver_virtio_blk/src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/protocol/ops.rs#L16),
[`userland/capsule_driver_virtio_blk/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/protocol/ops.rs#L17),
[`userland/capsule_driver_virtio_blk/src/protocol/ops.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/protocol/ops.rs#L18),
[`userland/capsule_driver_virtio_blk/src/protocol/ops.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/protocol/ops.rs#L19),
[`userland/capsule_driver_virtio_blk/src/protocol/ops.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/protocol/ops.rs#L20)).

## 4. AHCI and NVMe

AHCI polls and acknowledges its IRQ grant, receives fixed-size requests,
rejects payload-bearing requests, then handles healthcheck, controller info, and
port list ([`userland/capsule_driver_ahci/src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L31),
[`userland/capsule_driver_ahci/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L38),
[`userland/capsule_driver_ahci/src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L39),
[`userland/capsule_driver_ahci/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L43),
[`userland/capsule_driver_ahci/src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L46),
[`userland/capsule_driver_ahci/src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L57),
[`userland/capsule_driver_ahci/src/server/runner.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L61),
[`userland/capsule_driver_ahci/src/server/runner.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L62),
[`userland/capsule_driver_ahci/src/server/runner.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L63),
[`userland/capsule_driver_ahci/src/server/runner.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L64)).

NVMe polls and acknowledges its IRQ grant, receives fixed-size requests,
rejects payload-bearing requests, then handles healthcheck, controller info,
identify controller, identify namespace, and SMART health
([`userland/capsule_driver_nvme/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L30),
[`userland/capsule_driver_nvme/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L37),
[`userland/capsule_driver_nvme/src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L38),
[`userland/capsule_driver_nvme/src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L49),
[`userland/capsule_driver_nvme/src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L53),
[`userland/capsule_driver_nvme/src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L54),
[`userland/capsule_driver_nvme/src/server/runner.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L55),
[`userland/capsule_driver_nvme/src/server/runner.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L56),
[`userland/capsule_driver_nvme/src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L57),
[`userland/capsule_driver_nvme/src/server/runner.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L58),
[`userland/capsule_driver_nvme/src/server/runner.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L64),
[`userland/capsule_driver_nvme/src/server/runner.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L66),
[`userland/capsule_driver_nvme/src/server/runner.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L68)).

```
+--------------------------+
| ahci or nvme irq poll    |
+------------+-------------+
             |
+------------+-------------+
| ipc request decode       |
+------------+-------------+
             |
+------------+-------------+
| payload length must zero |
+------------+-------------+
             |
+------------+-------------+
| controller query handler |
+--------------------------+
```

## 5. USB Mass Storage

USB MSC owns a binding table, binding count, command tags, probe count, CSW
success and failure counts, phase error count, and residue byte count
([`userland/capsule_driver_usb_msc/src/state/types.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L20),
[`userland/capsule_driver_usb_msc/src/state/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L21),
[`userland/capsule_driver_usb_msc/src/state/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L22),
[`userland/capsule_driver_usb_msc/src/state/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L23),
[`userland/capsule_driver_usb_msc/src/state/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L24),
[`userland/capsule_driver_usb_msc/src/state/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L25),
[`userland/capsule_driver_usb_msc/src/state/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L26),
[`userland/capsule_driver_usb_msc/src/state/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L27),
[`userland/capsule_driver_usb_msc/src/state/types.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L28),
[`userland/capsule_driver_usb_msc/src/state/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/state/types.rs#L29)). Its runner receives
from inbox `0`, parses the request, and passes it to the dispatch layer
([`userland/capsule_driver_usb_msc/src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/runner.rs#L27),
[`userland/capsule_driver_usb_msc/src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/runner.rs#L28),
[`userland/capsule_driver_usb_msc/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/runner.rs#L30),
[`userland/capsule_driver_usb_msc/src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/runner.rs#L37),
[`userland/capsule_driver_usb_msc/src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/runner.rs#L41),
[`userland/capsule_driver_usb_msc/src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/runner.rs#L42)).

The dispatch layer handles healthcheck, probe config, build inquiry, build read
capacity 10, build read 10, build write 10, accept CSW, and get state
([`userland/capsule_driver_usb_msc/src/server/dispatch.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L21),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L22),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L23),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L24),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L25),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L28),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L31),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L32),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L33),
[`userland/capsule_driver_usb_msc/src/server/dispatch.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L34)).

```
+--------------------------+
| usb msc request          |
+------------+-------------+
             |
+------------+-------------+
| binding state            |
| command tag state        |
+------------+-------------+
             |
+------------+-------------+
| build command or accept  |
| command status wrapper   |
+------------+-------------+
             |
+------------+-------------+
| status snapshot reply    |
+--------------------------+
```

## 6. Failure Map

| Symptom | First source path to inspect | Why |
|---------|------------------------------|-----|
| VFS write fails | [`userland/capsule_vfs/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/dispatch.rs#L31) | Write must reach the VFS write handler after protocol decode. |
| RAMFS handle cannot read | [`userland/capsule_ramfs/src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/server/dispatch.rs#L29) | RAMFS read is a distinct handler from open and write. |
| Virtio block read returns bad status | [`userland/capsule_driver_virtio_blk/src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/server/runner.rs#L48) | Read blocks enters the virtio block read handler from this match arm. |
| AHCI reports no ports | [`userland/capsule_driver_ahci/src/server/runner.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/server/runner.rs#L64) | Port list is the AHCI visible device inventory path. |
| NVMe health data missing | [`userland/capsule_driver_nvme/src/server/runner.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/server/runner.rs#L58) | SMART health is the NVMe health handler. |
| USB MSC command sequence stalls | [`userland/capsule_driver_usb_msc/src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/server/dispatch.rs#L31) | Read and write command builders depend on USB MSC binding and tag state. |
