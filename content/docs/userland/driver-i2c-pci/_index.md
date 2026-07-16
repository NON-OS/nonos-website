---
title: "The i2c-pci Driver Capsule"
description: "capsuledriveri2cpci is the Intel LPSS I2C host controller driver: the PCI bus master that i2c-HID devices ride on."
weight: 400
---
`capsule_driver_i2c_pci` is the Intel LPSS I2C host controller driver: the PCI bus master that
i2c-HID devices ride on. It is a userspace driver capsule that owns exactly one Intel LPSS DesignWare
I2C function, which it claims through the hardware broker, maps BAR0 for, binds the interrupt line for,
and drives as an I2C master. Everything above the bus, HID report parsing, touchpad gestures, sensor
policy, and input focus, stays in higher capsules; this driver only moves bytes on the wire and reports
controller state.

The source is organized into a handful of top-level modules, and this documentation mirrors that
structure one page per pillar so a page can be read beside the folder it describes.

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-i2c-pci` | `Capsule.mk:6` |
| Service handle | `driver.i2c_pci0` | `Capsule.mk:7`, [`src/hardware/i2c_pci_capsule/spawn.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/i2c_pci_capsule/spawn.rs#L23) |
| Service endpoint | `service:4230:driver.i2c_pci0` | `Capsule.mk:13`, `spawn.rs:24` |
| Reply endpoint | `reply:4231:endpoint.4294967318` | `Capsule.mk:14`, `spawn.rs:25`, `spawn.rs:26` |
| Namespace | `systems.nonos.driver.i2c_pci0` | `Capsule.mk:12` |
| Binary name | `driver_i2c_pci` | `Capsule.mk:10` |
| Capability mask | `0x78019` | `Capsule.mk:16` |
| Kernel mirror | `src/hardware/i2c_pci_capsule` | `Capsule.mk:17` |

The mask `0x78019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs). Each bit is the value of
`Capability::bit()` for that variant ([`src/capabilities/types.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L52)):

```
  0x00008  IPC          bit()      8   run send/recv on its endpoints
  0x00010  Memory       bit()     16   map its own heap and stack
  0x08000  DeviceEnum   bit()  32768   enumerate devices (enumerate-only)
  0x10000  Driver       bit()  65536   claim and release a device
  0x20000  Mmio         bit() 131072   map a slice of a BAR
  0x40000  Irq          bit() 262144   bind a device interrupt
  -------
  0x78019  = 8 + 16 + 32768 + 65536 + 131072 + 262144
```

The kernel spawn path requests exactly those six capabilities and no others
([`src/hardware/i2c_pci_capsule/spawn.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/i2c_pci_capsule/spawn.rs#L42)). The semantics of the four broker bits are documented on the
capability type itself: `DeviceEnum` is enumerate-only, `Driver` lets a capsule claim and release a
device, `Mmio` lets a claim holder map a slice of a BAR, and `Irq` lets a claim holder bind a device
interrupt ([`src/capabilities/types.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L35)). There is no `CoreExec` (this is not a top-level app), no
`Dma`, no `Pio`, no `FileSystem`, no `Network`, and no display or input-focus capability. The whole
hardware footprint is the register window it maps and the interrupt it binds.

The kernel mirror embeds the signed ELF, id cert, manifest, and attestation trailer, and spawns the
capsule at boot through the bus-driver spawn plan ([`src/hardware/i2c_pci_capsule/embed.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/i2c_pci_capsule/embed.rs#L10),
[`src/userspace/init/spawn_plan/drivers_bus.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L38)).

## The pillars

The source under `userland/capsule_driver_i2c_pci/src/` is a short bring-up path plus a request server
over a transfer engine. The documentation is one page per real pillar. The flow is linear: bring-up
claims the controller and programs its clock once, then the server answers requests, and a transfer
request drives the polled engine on the bus.

```
  setup/ + init/   ->   server/ + protocol/   ->   transaction/
  bring-up and          the request server        the polled
  the clock program     and the six operations    transfer engine
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/driver-i2c-pci/operations/) | `src/protocol/`, `src/server/` | The `NI2C` wire header, the six opcodes, the status words, and the per-op handlers. |
| [bring-up.md](/docs/userland/driver-i2c-pci/bring-up/) | `src/setup/`, `src/init/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | Intel/PCI discovery, the claim/map/bind broker grants, and the DesignWare reset with its SCL clock program. |
| [transfer-engine.md](/docs/userland/driver-i2c-pci/transfer-engine/) | `src/transaction/` | The polled master transfer: address and length checks, the enable/disable bracket, and the four-phase engine loop with its timing budget. |
| [contributing.md](/docs/userland/driver-i2c-pci/contributing/) | the whole tree | Where to work, how to add a controller or an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/driver-i2c-pci/debugging/) | runtime | The boot marker, the bring-up failure strings, the "no SCL clock" trap, and how the transfer status words map to real faults. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, runs the one-shot bring-up
`setup::run`, and on success hands the resulting `Driver` to the blocking IPC server `server::run`; a
bring-up failure exits with code 1 ([`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)). There is no runtime path that reaches hardware
except through the broker grants obtained during bring-up. The `Driver` value the server carries is the
whole runtime state: the claimed device id, the PCI device id, the claim epoch, the MMIO and IRQ grant
ids, the bound vector, the source clock, the family name, the cached DesignWare component and status
words read at init, and the register accessor ([`src/driver.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L3)).

The intended client is the i2c-HID driver. `capsule_driver_i2c_hid` resolves `driver.i2c_pci0` by name
and issues `OP_TRANSFER` requests, building the exact same `NI2C` header and 8-byte transfer head that
this driver parses ([`userland/capsule_driver_i2c_hid/src/i2c_client/service.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/i2c_client/service.rs#L3),
[`userland/capsule_driver_i2c_hid/src/i2c_client/wire.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/i2c_client/wire.rs#L1)). HID-over-I2C sits above this driver and
drives its descriptor and report registers through bounded transfers.

## Honest gaps

The I2C stack this capsule provides is a partial slice, and the source is explicit about it.

- **Discovery is Intel and PCI only.** A record qualifies only if it is an Intel vendor PCI serial-bus
  device whose PCI id is in the driver's static table ([`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41), [`src/constants/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L28)).
  A controller enumerated through ACPI rather than PCI, or a PCI id not in the table, is not matched and
  the capsule exits with `controller not found`. See [bring-up.md](/docs/userland/driver-i2c-pci/bring-up/).
- **Transfers are polled, not interrupt-driven.** The IRQ is bound and acked once at bring-up so the
  line does not stay asserted ([`src/setup/sequence.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L16)), but transfers busy-wait on FIFO status inside
  a fixed iteration budget rather than blocking on the interrupt ([`src/transaction/engine/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L32)).
  See [transfer-engine.md](/docs/userland/driver-i2c-pci/transfer-engine/).
- **The IRQ bind is legacy INTx, not MSI-X.** The bind request passes the `irq_line` with zero flags, so
  the broker takes the INTx path ([`src/setup/irq.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L7)). The MSI-X table pages are withheld by the broker
  from the MMIO mapping in any case. See [bring-up.md](/docs/userland/driver-i2c-pci/bring-up/).

None of these gaps widen the capsule's authority beyond the six-bit mask; they are coverage and latency
limits, not safety ones.

## Source map

```
  userland/capsule_driver_i2c_pci/Capsule.mk    slug, handle, ports, capability mask, kernel mirror
  userland/capsule_driver_i2c_pci/src/main.rs   _start -> setup::run -> server::run
  userland/capsule_driver_i2c_pci/src/driver.rs the runtime Driver state
  userland/capsule_driver_i2c_pci/src/          protocol/, server/, setup/, init/, transaction/, discover.rs, constants/
  src/capabilities/types.rs                     the capability bits behind the mask
  src/hardware/i2c_pci_capsule/                 the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/drivers_bus.rs  the bus-driver spawn entry
  userland/capsule_driver_i2c_hid/src/i2c_client/  the i2c-hid client that drives OP_TRANSFER
```

Every reference above is verified against those trees.
