---
title: "The Device Table and PCI Config"
description: "Before anything can be claimed, the broker has to know what devices exist."
weight: 1
---
Before anything can be claimed, the broker has to know what devices exist. It builds a table from
PCI enumeration (plus registered platform devices), classifies each device so a capsule can
discover the kind of hardware it drives, surfaces that table to userland through `MkDeviceList`,
lets exactly one capsule bind to one device through `MkDeviceClaim`, and mediates the narrow set of
PCI config-space writes a driver legitimately needs. This page documents discovery, the record the
capsule sees, the claim-and-bind model, and the config allowlist. The code is under
`src/hardware/broker/table/`, `device/`, `class.rs`, `pci_index.rs`, `platform.rs`, and `pci/`.

## Contents

- [The device table](#the-device-table)
- [The device record](#the-device-record)
- [Classification](#classification)
- [Platform devices](#platform-devices)
- [How a capsule discovers and binds a device](#how-a-capsule-discovers-and-binds-a-device)
- [What the broker tracks per device](#what-the-broker-tracks-per-device)
- [The PCI config allowlist](#the-pci-config-allowlist)
- [Security analysis](#security-analysis)
- [Debugging the device table](#debugging-the-device-table)
- [Source map](#source-map)

## The device table

`init_from_pci` ([`src/hardware/broker/table/init.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/table/init.rs#L28)) turns the PCI enumeration into the broker's
device table and a parallel PCI handle index:

```
  init_from_pci(devices):
      for each PCI device, index idx:
          records.push(record_from_pci(idx, dev))                 // device_id = idx
          handles.push(PciHandle { device_id: idx, address, bars, msix })
      *TABLE = records
      pci_index::install(handles)
```

Each device gets a stable `device_id` (its enumeration index, `init.rs:32`), a `DeviceRecord` with
its BARs and IRQ pin/line, and a `PciHandle` with its config address, raw PCI BARs, and MSI-X
capability. The table itself is one global `RwLock<Vec<DeviceRecord>>` ([`table/state.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/state.rs#L24)), so
reads (list, lookup, claim checks) run concurrently and the rare writes (init, platform
registration) take the write lock. The `DeviceRecord` is what the [MMIO](/docs/subsystems/hardware-broker/mmio/), [DMA](/docs/subsystems/hardware-broker/dma/),
[IRQ](/docs/subsystems/hardware-broker/irq/), and [PIO](/docs/subsystems/hardware-broker/pio/) paths resolve a request against; the `PciHandle`
(`pci_index.rs:33`) is the kernel-private side table those paths use for MSI/MSI-X programming and
config access, which the capsule never sees. Its module doc is explicit: the wire-form
`DeviceRecord` deliberately does not carry MSI capability descriptors or the bus/device/function, so
those kernel-only structures never reach a capsule.

## The device record

`DeviceRecord` ([`src/hardware/broker/device/record.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/device/record.rs#L21)) is a `repr(C)` struct copied verbatim
into a capsule's buffer by `MkDeviceList`, so its layout is an ABI. It carries:

```
  device_id: u64                          the stable opaque id the capsule uses everywhere
  bus_kind: u8                            Pci / Acpi / Virt (device/bus.rs)
  pci_class, pci_subclass, pci_progif: u8 the raw PCI class triple
  class: u32                              the broker class id (see below)
  vendor, device: u16                     PCI vendor/device (or PNP ids for platform devices)
  flags: u32                              DEVICE_FLAG_CLAIMED / DEVICE_FLAG_DISABLED bits
  bar_count: u8                           number of populated BARs (highest present index + 1)
  irq_line, irq_pin: u8                   the PCI interrupt line and pin
  irq_source: u32                         the GSI the IRQ path binds (init'd from irq_line)
  bars: [Bar; 6]                          the six BAR slots
```

The struct is size-asserted at 176 bytes (`record.rs:61`), and each `Bar`
([`device/bar.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/device/bar.rs#L31)) is size-asserted at 24 bytes, so the ABI cannot drift silently. A `Bar` carries
`base`, `size`, a `kind` (`None` / `Mmio` / `Pio`, `bar.rs:21`), and flags (prefetchable, 64-bit for
memory BARs). `record_from_pci` ([`table/pci_record.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/pci_record.rs#L21)) fills the record from the PCI enumeration:
it copies only present BARs into their original index, sets `bar_count` to the highest present index
plus one, translates memory BARs to `Mmio` and I/O BARs to `Pio`, and sets `irq_source` from the
interrupt line. Note the record's physical BAR bases come from here, from the kernel's enumeration,
never from a capsule request; this is what lets every grant path bound a request to real device
memory.

The `flags` field is worth an honest note. `DEVICE_FLAG_CLAIMED` and `DEVICE_FLAG_DISABLED` are
defined and exported ([`device/flags.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/device/flags.rs#L19)), and `record_from_pci` initializes `flags` to zero, but
no path in the current broker sets or clears them. Claim state does not live on the record; it lives
in the separate claim table (`claim.rs`), which is the single source of truth for who holds a device.
The flag bits are reserved ABI, not live state today.

## Classification

`classify_pci` ([`src/hardware/broker/class.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/class.rs#L49)) maps a device's PCI class, subclass, and prog-if
to a broker class id, and `MkDeviceList` surfaces those ids so a capsule can find the hardware it
knows how to drive (`class.rs:22`):

```
  RNG 0x0001   BLOCK 0x0010   NETWORK 0x0020   DISPLAY 0x0030   INPUT 0x0040
  AUDIO 0x0050   SERIAL 0x0060   USB_HOST 0x0070   USB_HOST_XHCI 0x0071   OTHER 0xFFFF
```

The mapping is a match on the PCI class/subclass pair (`class.rs:50`): mass storage (class 0x01,
including AHCI subclass 0x06 and NVMe subclass 0x08) is `BLOCK`, network (0x02) is `NETWORK`, display
(0x03) is `DISPLAY`, audio (class 0x04 subclass 0x01 or 0x03) is `AUDIO`, input (0x09) is `INPUT`,
serial (0x07 subclass 0x00) is `SERIAL`, and USB host (0x0c subclass 0x03) splits on prog-if.
Anything the broker does not specifically classify lands in `OTHER` so the table still surfaces it
rather than hiding it. The xHCI id is a deliberate subset of USB host: a controller advertising the
xHCI prog-if 0x30 gets `USB_HOST_XHCI` while older UHCI/OHCI/EHCI controllers stay on the generic
`USB_HOST` id (`class.rs:69`), so a userland xHCI driver matches on the specific id and never tries
to drive a controller it does not understand. The same class id also selects the [DMA](/docs/subsystems/hardware-broker/dma/) page
ceiling.

## Platform devices

Not every device comes from PCI. `register_platform_device`
([`src/hardware/broker/table/init.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/table/init.rs#L44)) appends a hand-built `DeviceRecord` and assigns it a
`device_id` above the PCI range: the max existing id plus one, or `0x1_0000_0000` if the table is
still empty. The one caller today is `register_legacy` ([`src/hardware/broker/platform.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/platform.rs#L31)), which
registers the two PS/2 devices the 8042 controller exposes: a keyboard record with a PIO BAR at port
0x60 (5 ports), `BusKind::Acpi`, class `INPUT`, and IRQ 1; and an auxiliary (mouse) record on IRQ 12.
This is how a bus-less legacy device still gets a `device_id`, a class, and a BAR that the
[PIO](/docs/subsystems/hardware-broker/pio/) and [IRQ](/docs/subsystems/hardware-broker/irq/) paths can grant against, exactly like a PCI device. In practice the
`ps2_input` capsule is the one holder of a PIO grant in the running system, and it claims the
keyboard record registered here.

## How a capsule discovers and binds a device

The whole lifecycle a driver capsule goes through is three syscalls, all in
[`src/syscall/microkernel/device.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/device.rs), cap-gated at the contract layer (`MkDeviceList` needs
`DeviceEnum`, claim and release need `Driver`; the handlers do not re-check the capability because
reaching them proves it, `device.rs:17`).

`sys_device_list` (`device.rs:40`) is discovery. A capsule passes a class filter and a buffer; the
handler snapshots `list_by_class` (a class of 0 means all, [`table/list.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/list.rs#L29)), and if the buffer is
non-empty it validates the user write and copies up to `count` `DeviceRecord` structs out with
`write_user_value`, returning the number written. A count of zero returns the total so a capsule can
size its buffer first. The copy is the only way a capsule ever sees a device record, and it sees only
the wire-form record, never the `PciHandle`.

`sys_device_claim` (`device.rs:67`) is the bind. It resolves the caller's pid, refuses a
`device_id` not in the table with `ERRNO_NODEV` (`broker::contains`), then calls `claim_device`,
returning the granted epoch on success or `ERRNO_BUSY` on `AlreadyClaimed`. That epoch is the token
the capsule quotes on every later grant request. A single capsule binds to a single device by
holding its claim; there is no separate bind object, the claim *is* the binding.

`sys_device_release` (`device.rs:88`) is the unbind, covered on the [revocation](/docs/subsystems/hardware-broker/revocation/) page:
it drains all four grant classes for the device, then drops the claim.

## What the broker tracks per device

Per device, the broker keeps exactly two structures, split by trust boundary:

```
  DeviceRecord (table/state.rs, capsule-visible)   device_id, class, vendor/device,
                                                   the BAR table, IRQ pin/line/source
  PciHandle    (pci_index.rs, kernel-private)      device_id, PCI address (BDF),
                                                   raw PciBar array, MSI-X capability
```

Claim ownership (which pid holds the device, at which epoch) is tracked separately in the claim
table, not on either of these. So the device state the broker maintains is: the static hardware
description in the record, the kernel-only PCI programming handle, and the claim that ties a live
holder to the `device_id`. There is no per-device grant list on the record either; grants live in
each class's own global table keyed by `device_id`, which is why revocation drains those tables by
`device_id` rather than walking anything hung off the record.

## The PCI config allowlist

A driver sometimes needs to write device config space, most importantly to set the bus-master enable
bit before DMA. Rather than expose config space, the broker allows exactly two writes and rejects
everything else. The entire authority is one pure validator ([`pci/allowlist.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pci/allowlist.rs)):

```
  validate(req, msix, current):
      if offset == Command:        only Bus Master Enable (bit 2) may flip
      if offset == MSI-X Control:  only Function Mask + MSI-X Enable may flip
      else:                        OffsetNotAllowed
```

Every other config write, BAR programming, interrupt line, device and vendor IDs, status, expansion
ROM, capability-pointer mutation, PCIe and AER, is rejected before it reaches the bus.
`MkPciConfigWrite` ([`pci/write.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pci/write.rs#L26)) resolves the caller's ownership through `resolve`
([`pci/ownership.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pci/ownership.rs#L24), the same claim-pid-epoch check as every grant path), reads the current
register, runs the validator, and applies only the allowed action ([`pci/write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pci/write.rs#L34)), so a capsule
cannot reprogram a BAR to point its device somewhere else or rewrite a field the kernel relies on.
The bus-master bit is allowed because a DMA-capable driver genuinely needs it; the MSI-X control bits
are allowed because the driver enables and masks its own interrupts, but the table entries themselves
are programmed only by the kernel on the [IRQ](/docs/subsystems/hardware-broker/irq/) bind path.

## Security analysis

The device table is the root of discovery, and two properties make it safe to hand to userland.

**The capsule sees a curated record, not the hardware.** `MkDeviceList` copies only the `repr(C)`
`DeviceRecord`, whose fields are the static description plus the BAR table. The kernel-private
`PciHandle`, holding the BDF and the MSI capability descriptors, never crosses the boundary
(`pci_index.rs` module doc). This is what lets the kernel keep MSI/MSI-X programming to itself: a
capsule literally does not have the address it would need to program a vector, which is the same
split the [MMIO](/docs/subsystems/hardware-broker/mmio/) MSI-X clamp enforces from the other side.

**Physical BARs come from enumeration, not requests.** Every BAR base in the table is filled by
`record_from_pci` from the PCI probe. A capsule names a device by `device_id` and an offset within a
BAR; it can never supply a physical address. So the whole grant surface is bounded to real device
memory the kernel enumerated, and a forged physical address is not expressible.

**Claim is the exclusivity gate, and it is separate from the record.** Binding is `MkDeviceClaim`,
which refuses a device already held (`ERRNO_BUSY` from `AlreadyClaimed`), so exactly one capsule
binds to a device. Because claim state lives in the claim table rather than in the mutable record,
there is no path where writing a device record could forge ownership; the record is effectively
read-only description and the claim table is the authority. The config allowlist then narrows even a
claimed device to two writes, so holding a device does not confer the ability to reprogram it, only
to drive it.

## Debugging the device table

The device table is the first thing to check when a driver never starts, because a claim can only
succeed against a device that was enumerated.

`MkDeviceList` with a count of zero returns the total device count for a class without copying
anything (`device.rs:43`), which is the cheapest probe: a driver that finds zero devices of its class
is looking at a discovery problem one layer down (the device was never enumerated from PCI or
registered as a platform device), not a broker refusal. If the device is present but the class is
wrong, that is a `classify_pci` gap: a controller landing in `OTHER` when a driver expected a specific
class id means the class/subclass/prog-if triple did not match any arm, and the fix is in
`class.rs:50`, not in the driver.

A claim that returns `ERRNO_NODEV` means `contains` found no such `device_id`, again a discovery
problem. A claim that returns `ERRNO_BUSY` means the device is already held: either two drivers were
spawned for the same hardware or a previous instance did not release it, which is a spawn-plan
problem and is diagnosed on the [claim](/docs/subsystems/hardware-broker/claim/) page. The `MkDeviceRelease` path emits a bounded
`[DEV-RELEASE]` trace for pid 7 (`device.rs:32`), useful when a claim churns because a prior holder's
release is failing. For the PS/2 case specifically, if the keyboard or mouse device is absent from
the list, `register_legacy` did not run or ran after enumeration; the two records it adds
(`platform.rs`) are the only non-PCI input devices in a stock build.

## Source map

```
  src/hardware/broker/table/init.rs        init_from_pci, register_platform_device
  src/hardware/broker/table/state.rs       the RwLock<Vec<DeviceRecord>> table
  src/hardware/broker/table/list.rs        list, list_by_class, contains, class_of
  src/hardware/broker/table/pci_record.rs  record_from_pci and BAR translation
  src/hardware/broker/device/record.rs     DeviceRecord and its 176-byte ABI assert
  src/hardware/broker/device/bar.rs        Bar, BarKind, the 24-byte assert
  src/hardware/broker/device/bus.rs        BusKind (Pci / Acpi / Virt)
  src/hardware/broker/device/flags.rs      DEVICE_FLAG_CLAIMED / DEVICE_FLAG_DISABLED (reserved)
  src/hardware/broker/class.rs             classify_pci and the class ids
  src/hardware/broker/pci_index.rs         PciHandle, the kernel-private side table
  src/hardware/broker/platform.rs          register_legacy: the PS/2 platform devices
  src/hardware/broker/pci/allowlist.rs     the two-write config allowlist
  src/hardware/broker/pci/write.rs         MkPciConfigWrite orchestration
  src/hardware/broker/pci/ownership.rs     the claim-pid-epoch resolve for config access
  src/syscall/microkernel/device.rs        MkDeviceList / MkDeviceClaim / MkDeviceRelease
```

Every reference above is verified against those trees.
