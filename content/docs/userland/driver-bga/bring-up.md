---
title: "Bring-up: discover, claim, and map the BARs"
description: "This page covers the broker half of the capsule: how it finds the BGA device, takes exclusive ownership, enables bus mastering, maps the two BARs into its address space, and tea..."
weight: 2
---
This page covers the broker half of the capsule: how it finds the BGA device, takes exclusive ownership,
enables bus mastering, maps the two BARs into its address space, and tears all of that down again on
drop. It mirrors `src/setup/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), and [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs). For what the capsule then writes
into those mappings, read [mode-set](/docs/userland/driver-bga/mode-set/). For the parked status and the identity, read the
[README](/docs/userland/driver-bga/).

The bring-up is one linear function, `setup::run`, with each step in its own module. On any error after
the claim it releases what it took, so a partial bring-up never leaves the device claimed or a BAR mapped
([`src/setup/sequence.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L30), [`src/setup/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L25)). The order is fixed, and the steps below are exactly
the order `run` performs them ([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)).

## The sequence

1. **Discover.** `find_bga` calls `mk_device_list` for the display class into a fixed 32-entry buffer and
   scans the returned records for a PCI device with class `0x03`, vendor `0x1234`, device `0x1111`, at
   least three BARs, and both BAR 0 (framebuffer) and BAR 2 (registers) present as MMIO BARs with
   non-zero size ([`src/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L32), [`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41)). It returns the broker device id and the
   two BAR sizes, or `None` if nothing matches, which becomes `DeviceNotFound`
   ([`src/discover.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L51), [`src/setup/sequence.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L28)).
2. **Claim.** `claim` calls `mk_device_claim` and keeps the returned epoch ([`src/setup/claim.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L22)). The
   claim is exclusive and the epoch is the token every later grant is checked against
   ([device claim](/docs/subsystems/hardware-broker/claim/)). A negative return is wrapped as
   `BrokerCallFailed` ([`src/setup/claim.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L23)).
3. **Bus-master.** `enable_bus_master` writes the PCI Command register's Bus Master Enable bit through
   `mk_pci_config_write` with `MK_PCI_CFG_COMMAND` and `MK_PCI_CMD_BUS_MASTER`
   ([`src/setup/pci.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L22)). The broker only accepts a write into that specific register-and-bit (the
   Command register's Bus Master Enable bit at offset `0x04`, or the MSI-X control bits this capsule never
   touches), so this is the one PCI configuration change the capsule can make
   ([`userland/libc/src/broker/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/broker/pci.rs#L17)). If this fails, setup releases the device and returns
   ([`src/setup/sequence.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L30)).
4. **Map the register BAR.** `mmio::map` calls `mk_mmio_map` for BAR 2 over the whole reported BAR size,
   receiving a user virtual address and a grant id in an `MmioMapOut` ([`src/setup/mmio.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L23)). The broker
   maps the slice uncached, no-execute, read-write, bounded to the BAR, and stops short of any MSI-X
   table ([MMIO grants](/docs/subsystems/hardware-broker/mmio/)). This VA becomes the `Regs` register
   window ([`src/setup/sequence.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L36)). On failure, `mmio::map` releases the device before returning
   ([`src/setup/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L25)).
5. **Map the framebuffer BAR.** The same `mmio::map` runs for BAR 0, giving the linear framebuffer virtual
   address the capsule writes pixels into ([`src/setup/mmio.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L23), [`src/setup/sequence.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L35)).
6. **Hand off to mode-set.** With both BARs mapped, `run` calls `set_mode` on the register window and then
   `clear` on the framebuffer window; those two steps are the subject of [mode-set](/docs/userland/driver-bga/mode-set/)
   ([`src/setup/sequence.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L37), [`src/setup/sequence.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L39)).
7. **Build the `Driver`.** `run` builds the `Driver` holding the `BrokerHandles` (device id and the two
   grant ids), the framebuffer VA, the width, the height, and the stride (`width * 4 = 4096` bytes)
   ([`src/setup/sequence.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L40), [`src/setup/driver.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L19)). `_start` keeps it alive in the yield loop.

## The discovery filter

`find_bga` is a strict filter, not a first-match on class alone. A record passes only when every one of
these holds ([`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41)):

| Field | Required value | Constant | Source |
|---|---|---|---|
| bus kind | PCI | `BUS_KIND_PCI` | [`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41) |
| PCI class | `0x03` display | `PCI_CLASS_DISPLAY` | [`src/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L18) |
| vendor | `0x1234` | `VENDOR_QEMU_BOCHS` | [`src/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L19) |
| device | `0x1111` | `DEVICE_BGA` | [`src/constants.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L20) |
| bar count | more than BAR 2 | `REG_BAR` | [`src/discover.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L45) |
| BAR 0 kind | MMIO, size > 0 | `FB_BAR` | [`src/discover.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L46) |
| BAR 2 kind | MMIO, size > 0 | `REG_BAR` | [`src/discover.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L47) |

`mk_device_list` enumerates the display class into a 32-entry `DeviceRecord` buffer and returns the count;
the scan reads at most that many records ([`src/discover.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L33), [`src/discover.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L38)). Both BARs are
required to be MMIO with non-zero size, which is what lets the capsule reach the DISPI registers through
the register BAR rather than through x86 I/O ports (see [mode-set](/docs/userland/driver-bga/mode-set/)).

## The epoch threads every grant

The epoch the claim returns is not decorative. It is passed to `enable_bus_master` and to both `mmio::map`
calls ([`src/setup/pci.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L22), [`src/setup/mmio.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L23)), and the broker re-checks it on each grant, so a
grant minted under a stale claim is refused. This is what makes a release-and-reclaim cycle safe: authority
from a prior ownership cannot be replayed after the device changes hands
([device claim](/docs/subsystems/hardware-broker/claim/)).

## Teardown

Teardown is RAII and complete. `BrokerHandles` owns the device id and the two grant ids, and its `Drop`
unmaps the framebuffer, unmaps the registers, and releases the device, in that order
([`src/handles.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L31), [`src/handles.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L33)). Because the `Driver` owns the `BrokerHandles`
([`src/setup/driver.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L20)) and `_start` never drops the `Driver` on the success path, teardown normally
fires only if the capsule exits. As a backstop, the broker's own per-pid release runs from the process
exit path, so even a crash cannot leak the claim or the mappings
([device claim](/docs/subsystems/hardware-broker/claim/)).

There is a second, earlier teardown path: the eager release inside `setup::run` and `mmio::map`. If the
bus-master write fails, `run` calls `mk_device_release` directly before returning
([`src/setup/sequence.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L31)); if either MMIO map fails, `mmio::map` calls `mk_device_release` before
returning the error ([`src/setup/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L25)). These fire before the `BrokerHandles` exists, so they clean
up a device that is claimed but has no RAII owner yet.

## Source map

```
  userland/capsule_driver_bga/src/setup/sequence.rs   run: discover -> claim -> bus-master -> map x2 -> mode-set -> Driver
  userland/capsule_driver_bga/src/setup/claim.rs      mk_device_claim, returns the epoch
  userland/capsule_driver_bga/src/setup/pci.rs        mk_pci_config_write: Bus Master Enable
  userland/capsule_driver_bga/src/setup/mmio.rs       mk_mmio_map for a BAR, release on failure
  userland/capsule_driver_bga/src/setup/driver.rs     Driver: broker handles, fb VA, width, height, stride
  userland/capsule_driver_bga/src/discover.rs         find_bga: vendor/device/class + two-MMIO-BAR filter
  userland/capsule_driver_bga/src/handles.rs          BrokerHandles: unmap both BARs and release on drop
  userland/capsule_driver_bga/src/constants.rs        PCI identity and BAR indices
  docs/subsystems/hardware-broker/claim.md            the exclusive claim and epoch
  docs/subsystems/hardware-broker/mmio.md             the bounded BAR mapping
  userland/libc/src/broker/pci.rs                     the PCI config-write authority (Bus Master Enable only)
```

Every reference above is verified against those trees.
