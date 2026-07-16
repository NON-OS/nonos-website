---
title: "Debugging capsule_driver_nvme"
description: "This page lists the log marker the driver's boot path emits, the bring-up exit codes, and the concrete runtime failure modes with where to look for each."
weight: 7
---
This page lists the log marker the driver's boot path emits, the bring-up exit codes, and the concrete
runtime failure modes with where to look for each. For the shape of the driver see the [README](/docs/userland/driver-nvme/),
the [operations](/docs/userland/driver-nvme/operations/) page, the [bring-up](/docs/userland/driver-nvme/bring-up/) page, and the [queues](/docs/userland/driver-nvme/queues/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[DRIVER-NVME] capsule spawned`: the storage spawn plan calls `boot::capsule` with the tag `DRIVER-NVME`
([`src/userspace/init/spawn_plan/drivers_storage.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L49)), whose `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which formats `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)).

## Bring-up exit codes

If the capsule spawns but `setup::run` fails, the process exits with a distinct code, which is the fastest
way to tell how far setup got ([`src/error/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L30)). Each maps to one `NvmeError`.

| Exit | Error | Meaning and where it comes from |
|---|---|---|
| 30 | `DeviceNotFound` | No PCI function matched NVMe class/subclass/prog-if `01/08/02` with a `>= 0x4000` MMIO BAR0 ([`src/discover.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L49)). |
| 31 | `ClaimFailed` | `mk_device_claim` was refused, usually a missing `Driver` capability or a device already claimed ([`src/setup/claim.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L23)). |
| 32 | `BrokerCallFailed` | A bus-master write, MMIO map, or DMA map was refused ([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23), [`src/setup/mmio.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L26), [`src/dma/region.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L31)). |
| 33 | `UnsupportedController` | The mapped block did not look like NVMe, or the controller raised `CSTS.CFS` (fatal) during reset or enable ([`src/controller/info/is_nvme_register_block.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info/is_nvme_register_block.rs#L21), [`src/admin/controller.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L41)). |
| 34 | `UnsupportedPageSize` | The controller's minimum page shift is not 12; the driver only supports 4 KiB pages ([`src/admin/controller.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L30)). |
| 35 | `ControllerTimeout` | A ready poll or a queue completion never landed within the fixed spin limit ([`src/admin/controller.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L49), [`src/admin/queue/wait.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/wait.rs#L36), [`src/nvm/wait.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nvm/wait.rs#L35)). |
| 36 | `AdminCommandFailed` | An admin or IO command completed with a non-zero status field ([`src/admin/queue/wait.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/wait.rs#L32), [`src/nvm/wait.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nvm/wait.rs#L31)). |

### Controller not ready

Exit 33 (`UnsupportedController`) is the "controller not ready" case. It fires either because
`is_nvme_register_block` rejected the mapping (`CAP == 0`, `VS == 0`, or a zero max-queue-entries, which
points at the wrong BAR being mapped or a device that is not really NVMe,
[`src/controller/info/is_nvme_register_block.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info/is_nvme_register_block.rs#L21)), or because the reset or enable poll saw `CSTS.CFS`
raised, meaning the controller declared itself fatal ([`src/admin/controller.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/controller.rs#L41)). The two are
distinguished by how far the boot got: a register-block rejection happens before any admin queue exists, a
fatal-status rejection during reset or enable.

### DMA or completion timeout on real hardware

Exit 35 (`ControllerTimeout`) is the DMA/completion timeout case. The driver spins a fixed
`5_000_000`-iteration loop on `CSTS.RDY` and on every queue completion, and gives up if nothing lands
([`src/admin/queue/constants.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/queue/constants.rs#L22), [`src/nvm/constants.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nvm/constants.rs#L26)). On QEMU this is rare. On real hardware it
usually points at one of three things: bus mastering not actually taking effect (the controller cannot DMA
its completion back), an addressing problem (the controller was handed a device address it cannot reach), or
a controller that hung. Because the interrupt is only a wake hint and the completion is found by polling
([`src/server/runner.rs:75`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L75), [queues](/docs/userland/driver-nvme/queues/)), a missing MSI-X bind does not cause this; a real
completion that never arrives does.

## Runtime failure modes

After a successful boot, the failures surface as errno words in the reply, not exit codes.

### No namespaces (every block op returns `E_NODEV`)

Every read, write, flush, or capacity call returns `E_NODEV` (`-19`) when no IO queue was brought up, because
NSID 1 did not report a 512-byte LBA with a non-zero size at setup ([`src/setup/sequence.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L63)). Identify and
SMART still answer, so `OP_IDENTIFY_NAMESPACE` is the probe: an absent namespace shows nsid 0
([`src/admin/namespace.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/admin/namespace.rs#L30)). This is the "no namespaces" case. It is not a claim or grant failure, the
controller is up; it just has no usable namespace the driver will serve.

### A read or write returns `E_NXIO` or `E_INVAL`

The requested range runs past capacity (`E_NXIO`, `-6`), or the sector count is zero or above 64 (`E_INVAL`,
`-22`) ([`src/server/handlers/rw_parse.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L26)). Check the reported capacity with `OP_CAPACITY` first, then
confirm `lba + sectors` stays within it.

### A read or write returns `E_MSGSIZE`

The payload length did not match the fixed layout: exactly 12 bytes for a read request, and 12 bytes plus
`sectors * 512` for a write, with the payload_len field and the received body both checked
([`src/server/handlers/read.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L33), [`src/server/handlers/write.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write.rs#L33)).

### A read, write, or flush returns `E_IO`

The command reached the controller but completed with a non-zero status, which the transfer path maps to
`E_IO` (`-5`) ([`src/server/handlers/read.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read.rs#L40), `write.rs:43`, `flush.rs:27`). This is a device-side error,
distinct from the request-validation errors above, which never reach the controller.

## Source map

```
  src/userspace/init/spawn_plan/drivers_storage.rs   the DRIVER-NVME spawn entry
  src/userspace/init/capsule_boot/run.rs             the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                         the [TAG] message formatting
  userland/capsule_driver_nvme/src/error/types.rs    NvmeError and the exit-code mapping
  userland/capsule_driver_nvme/src/discover.rs       the NVMe device match behind DeviceNotFound
  userland/capsule_driver_nvme/src/setup/            the claim, bus-master, MMIO, and grant failures
  userland/capsule_driver_nvme/src/controller/info/is_nvme_register_block.rs  the register-block sanity check
  userland/capsule_driver_nvme/src/admin/controller.rs   reset/enable, the fatal-status and timeout paths
  userland/capsule_driver_nvme/src/admin/queue/wait.rs   the admin completion poll and its errors
  userland/capsule_driver_nvme/src/nvm/wait.rs           the IO completion poll and its errors
  userland/capsule_driver_nvme/src/setup/sequence.rs     the NSID-1 gate that decides E_NODEV
  userland/capsule_driver_nvme/src/server/handlers/rw_parse.rs  the E_NXIO / E_INVAL bounds
  userland/capsule_driver_nvme/src/server/handlers/read.rs, write.rs, flush.rs  the E_MSGSIZE and E_IO paths
```

Every reference above is verified against those trees.
</content>
