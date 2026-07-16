---
title: "The i2c-HID Driver Capsule"
description: "capsuledriveri2chid is the HID-over-I2C class driver in the NØNOS tree."
weight: 400
---
`capsule_driver_i2c_hid` is the HID-over-I2C class driver in the NØNOS tree. On a laptop the device it
speaks to is the I2C peripheral behind the keyboard deck, most often the touchpad or an I2C touchscreen.
The capsule never touches the bus hardware itself. It sits one level above the I2C controller capsule
`driver.i2c_pci0`, asks that capsule to run bounded I2C transfers on its behalf, reads the device's HID
descriptor, polls its input register for reports, decodes each report, and posts the result into the
kernel input ring as pointer, wheel, and button events.

The source under `userland/capsule_driver_i2c_hid/src/` is a small set of top-level modules, and this
documentation mirrors that structure one page per code pillar so a page can be read beside the folder it
describes. This is the reference for the driver as it exists on this branch. A fuller touchpad build lives
on a different branch and is called out honestly on every page it touches.

Read this branch honestly: the report decode here is a relative-pointer format (buttons, dx, dy, wheel),
not the absolute multi-contact Precision Touchpad report, so it posts `INPUT_KIND_POINTER_REL` rather than
absolute coordinates ([`src/input/parse_report.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L19), [`src/input/publish.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L28)).

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-i2c-hid` | `Capsule.mk:5` |
| Service handle | `driver.i2c_hid0` | `Capsule.mk:6`, [`src/userspace/capsule_driver_i2c_hid/spawn.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_i2c_hid/spawn.rs#L23) |
| Namespace | `systems.nonos.driver.i2c_hid0` | `Capsule.mk:11` |
| Service endpoint | `service:4232:driver.i2c_hid0` | `Capsule.mk:12`, `spawn.rs:24` |
| Reply endpoint | `reply:4233:endpoint.4294967319` | `Capsule.mk:13`, `spawn.rs:25` |
| Capability mask | `0x200019` | `Capsule.mk:14` |
| Binary name | `driver_i2c_hid` | `Capsule.mk:9` |
| Kernel mirror | `src/userspace/capsule_driver_i2c_hid` | `Capsule.mk:15` |

The mask `0x200019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x000001` | run as a process | `types.rs:56` |
| IPC | `0x000008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x000010` | map its own heap and stack | `types.rs:60` |
| InputSource | `0x200000` | post events into the kernel input ring | `types.rs:77` |

```
  0x200019 = 0x000001 + 0x000008 + 0x000010 + 0x200000
           = 1 + 8 + 16 + 2097152
```

The kernel spawn path requests exactly IPC, Memory, and InputSource; CoreExec is the implicit execute bit
every capsule carries (`spawn.rs:42`). `InputSource` is the one capability that separates this driver from
an ordinary IPC capsule: it is the bit the kernel checks before it will accept an input-event post, since
`MkInputEventPost` is gated on `can_input_source` ([`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78)). There is no
`Driver`, `Mmio`, `Irq`, `Dma`, `Pio`, `DeviceEnum`, `Network`, `FileSystem`, or graphics bit in the mask.
The driver cannot claim a device, map a BAR, bind an interrupt, or run a port instruction. It can speak
IPC, hold memory, and post input, and nothing else. Every byte it exchanges with the physical device goes
out as an IPC request to `driver.i2c_pci0`, which owns the controller registers and the interrupt line and
is the only capsule in the pair with MMIO and IRQ authority.

## The code pillars

The capsule is a `no_std`/`no_main` binary. `_start` initialises the heap, runs `setup::run` to resolve
the I2C controller and do a first probe, and then hands the built `State` to the server loop; any setup
failure exits with code 1 ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). Two things then run in one loop: the capsule answers health,
reprobe, and descriptor queries as a small IPC server, and on every pass through that loop it also polls
the device, decodes whatever report came back, and posts input events.

The source is four working modules plus the shared `State`, and the documentation is one page per pillar
([`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23)).

```
  setup ->  hid/  ->  i2c_client/  ->  input/         server/
  first     descriptor  bounded         poll, parse,   the IPC
  probe     discovery   I2C transfers   publish, post  request loop
```

| Page | Mirrors | What it covers |
|---|---|---|
| [protocol.md](/docs/userland/driver-i2c-hid/protocol/) | `src/protocol/`, `src/server/`, `src/i2c_client/`, `src/hid/` | The `NHID` server wire format, the three operations and their replies, the dispatch loop, the `NI2C` client that calls `driver.i2c_pci0`, and the descriptor discovery that arms the report path. |
| [input.md](/docs/userland/driver-i2c-hid/input/) | `src/input/` | The report path from an I2C poll through `parse_report` to `publish` and the `mk_input_event_post` syscall, the relative-pointer decode, the button diff, and the counters. |
| [contributing.md](/docs/userland/driver-i2c-hid/contributing/) | the whole tree | Where to work, how the absolute Precision Touchpad path would be added, the build and sign targets, and the code standards. |
| [debugging.md](/docs/userland/driver-i2c-hid/debugging/) | runtime | The boot marker, the health counters, and the failure modes when the touchpad is dead or no reports arrive. |

## Lifecycle

The driver is spawned from the bus-driver plan through verified spawn: its signature and attestation are
checked, its requested capabilities are held against its manifest ceiling, and only then is its ELF mapped
([`src/userspace/init/spawn_plan/drivers_bus.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L52), `spawn.rs:29`). Bring-up runs in `setup::run`:

1. Resolve the controller. It looks up `driver.i2c_pci0` in the registry through `mk_service_lookup`; a
   missing controller means startup fails closed and the process exits ([`src/i2c_client/service.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/service.rs#L3),
   [`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38)). This is how the driver finds the bus: not by ACPI enumeration in this capsule, but by
   resolving the controller capsule that already owns the claimed I2C host. ACPI discovery of the I2C host
   and its HID device lives in the controller and the kernel broker, not here.
2. Probe for the device. `reprobe` scans a fixed list of common HID-over-I2C slave addresses and validates
   the first descriptor that parses ([`src/setup.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L12), [`src/hid/probe.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L4)).
3. Derive the report registers from the accepted descriptor, which is what arms the poll path
   ([`src/hid/input_register.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_register.rs#L17), [`src/hid/input_len.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_len.rs#L17)).

A successful spawn prints `[DRIVER-I2C-HID] capsule spawned` on the boot log through `boot_log::ok`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); the [debugging](/docs/userland/driver-i2c-hid/debugging/) page covers what an absent
line means. The report path and its journey through the kernel ring to the input router are documented in
[the input path](/docs/subsystems/input/path/).

## Honest scope on this branch

- The report decode is a relative-pointer format (buttons, dx, dy, wheel), not the absolute multi-contact
  Precision Touchpad report. A real Precision Touchpad in its native mode will not decode correctly here;
  the parser reads the first contact's fields as if they were mouse deltas
  ([`src/input/parse_report.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L19)). It posts `INPUT_KIND_POINTER_REL`, never `INPUT_KIND_POINTER_ABS`
  ([`src/input/publish.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L28)).
- No input-mode switch. The driver never writes the feature report that puts a Precision Touchpad into
  absolute mode; it reads whatever mode the device powers up in.
- No interrupt or doorbell pacing. The read cadence is the server loop's 2 ms receive timeout, not a
  hardware interrupt or GPIO doorbell ([`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13), [`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)). The capsule
  holds no `Irq` capability, so it cannot bind the device interrupt even in principle.
- No gesture recognition, palm rejection, or power management.

A separate branch carries the fuller touchpad path: an absolute-mode feature-report switch, a
report-descriptor parser that locks onto the touch report id, GPIO-doorbell-paced reads, and gesture
handling. That code is not on this branch, and none of the file:line references in this folder point at
it. Treat these pages as the reference for the driver as it is shipped here.

## Source map

```
  userland/capsule_driver_i2c_hid/Capsule.mk        slug, handle, ports, capability mask, kernel mirror
  userland/capsule_driver_i2c_hid/src/main.rs       _start -> setup::run -> server::run; the module tree
  userland/capsule_driver_i2c_hid/src/setup.rs      resolve controller, first probe, reprobe
  userland/capsule_driver_i2c_hid/src/state.rs      State: port, pid, address, descriptor, reg/len, counters
  userland/capsule_driver_i2c_hid/src/hid/          descriptor discovery: probe, validate, derive reg/len
  userland/capsule_driver_i2c_hid/src/i2c_client/   the NI2C client to driver.i2c_pci0
  userland/capsule_driver_i2c_hid/src/input/        the report path: poll, parse, publish, post
  userland/capsule_driver_i2c_hid/src/protocol/     the NHID server wire format, ops, errno, limits
  userland/capsule_driver_i2c_hid/src/server/       the recv/poll/dispatch loop and op handlers
  src/capabilities/types.rs                         the capability bit values
  src/syscall/contract/cap_table/mk.rs              the per-syscall capability gate
  src/userspace/capsule_driver_i2c_hid/spawn.rs     the kernel-side verified spawn and cap request
  src/userspace/init/spawn_plan/drivers_bus.rs      the bus-driver spawn entry
  src/userspace/init/capsule_boot/run.rs            the [DRIVER-I2C-HID] capsule spawned marker
```

Every reference above is verified against those trees.
