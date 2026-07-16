---
title: "Debugging capsule_driver_i2c_pci"
description: "This page lists the log markers the driver and its boot path emit, and the concrete failure modes with where to look for each."
weight: 5
---
This page lists the log markers the driver and its boot path emit, and the concrete failure modes with
where to look for each. For the operation surface see [operations.md](/docs/userland/driver-i2c-pci/operations/), for bring-up see
[bring-up.md](/docs/userland/driver-i2c-pci/bring-up/), and for the transfer engine see [transfer-engine.md](/docs/userland/driver-i2c-pci/transfer-engine/).

## Log markers

The first thing to confirm is that the capsule ran. When the bus-driver spawn plan brings it up with the
prefix `DRIVER-I2C-PCI` ([`src/userspace/init/spawn_plan/drivers_bus.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L41)), a successful spawn logs
`[DRIVER-I2C-PCI] capsule spawned`: the `Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`, which
frames the tag in brackets on the serial line ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the capsule never started, and the `Err` arm
logged an `[ERROR]` line instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32),
[`src/sys/boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L49)), which is the usual signature, manifest, or capability failure. The
kernel-side load error carries the tag `[DRIVER-I2C-PCI] load_elf_executable error:`
([`src/hardware/i2c_pci_capsule/spawn.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/i2c_pci_capsule/spawn.rs#L48)).

## Bring-up failure modes

Each is a distinct `Err(&str)` from the setup sequence, and the capsule exits 1 on any of them
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

### Controller not found

`find_controller` returned `None`, so `setup::run` fails with `i2c-pci: controller not found`
([`src/setup/sequence.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L10)). The common cause is the Intel/PCI-only discovery gap: the controller is
described in ACPI rather than PCI, its PCI id is not in `device_info`, or the record had no interrupt pin
or a masked-off line ([`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41), [`src/constants/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L28)). The broker device census (a
`NONOS_DEVICE_CENSUS=1` build, documented on the
[device claim](/docs/subsystems/hardware-broker/claim/) page) shows whether the device is enumerated at
all before any driver runs.

### Claim, map, or bind refused

`i2c-pci: device claim failed`, `i2c-pci: mmio map failed`, or `i2c-pci: irq bind failed` each name the
broker step that was refused ([`src/setup/claim.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L5), [`src/setup/mmio.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L11), [`src/setup/irq.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L9)). The
broker's own stage markers isolate which check inside the grant failed; see the
[MMIO](/docs/subsystems/hardware-broker/mmio/) and [IRQ](/docs/subsystems/hardware-broker/irq/)
pages. The setup path unwinds cleanly: a failed map releases the claim, and a failed bind unmaps the MMIO
and releases the claim, so a refused step leaves no dangling grant ([`src/setup/mmio.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L11),
[`src/setup/irq.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L9)).

### No SCL clock

There are two shapes. The hard one fails bring-up: if the controller never disables cleanly, `bring_up`
returns `i2c-pci: controller disable timeout` ([`src/init/mod.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L55)). The subtler one does not fail
bring-up at all: a controller whose HCNT/LCNT count pairs were never programmed emits no clock, and every
later transfer NACKs or times out. `OP_TIMING_INFO` is the probe. It reads back the four SCL count
registers ([`src/server/handlers/timing.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/timing.rs#L7)), and a zero count there is the "no SCL clock" signature.
The count math itself clamps to a floor of 1 ([`src/init/scl.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/scl.rs#L39)), so a genuine zero read points at the
controller not accepting the program, not at the driver computing a zero.

## Runtime transfer failures

The transfer and probe status words map straight to real faults.

- **`E_BUSY`** means the master was still active when the transfer began, a stuck or contended bus;
  `wait_idle` ran its budget without the master going idle ([`src/transaction/control/wait_idle.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/control/wait_idle.rs#L27)).
- **`E_TIMEOUT`** means the engine ran its full 250,000-iteration budget without completing, typically a
  missing clock, a device that never fills the RX FIFO, or a controller that never reports done
  ([`src/transaction/engine/run.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L54)).
- **`E_NACK`** means the DesignWare TX-abort bit fired. The abort source is latched into the transfer
  reply so a client can read the exact abort reason ([`src/transaction/engine/check_abort.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/check_abort.rs#L24),
  [`src/server/handlers/transfer.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L39)).

`OP_PROBE` uses the same path and distinguishes a clean NACK (`[0]`, absent) from a real error, so probing
a known-good address is the fastest way to tell a dead controller from an empty bus
([`src/transaction/engine/probe.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/probe.rs#L23)).

## The interrupt-routing trap

There is one real-hardware trap worth naming, described on the
[IRQ](/docs/subsystems/hardware-broker/irq/) page: a driver can claim its device and bind the IRQ, yet
no interrupt ever arrives because the IO-APIC redirect targets a LAPIC destination the running CPU is not
listening on. This driver polls its transfers ([`src/transaction/engine/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L32)), so it does not depend
on interrupt delivery to make progress. The same routing gap explains why an interrupt-driven successor
would stall where the polled engine still completes.

## Source map

```
  src/userspace/init/spawn_plan/drivers_bus.rs      the DRIVER-I2C-PCI spawn entry and prefix
  src/userspace/init/capsule_boot/run.rs            [DRIVER-I2C-PCI] capsule spawned / error path
  src/sys/boot_log/output.rs                        the bracketed ok/error serial framing
  src/hardware/i2c_pci_capsule/spawn.rs             the load_elf_executable error tag
  userland/capsule_driver_i2c_pci/src/main.rs       the exit-1 on any bring-up error
  userland/capsule_driver_i2c_pci/src/setup/        the claim/map/bind error strings and their unwind
  userland/capsule_driver_i2c_pci/src/init/         the disable-timeout string and the clock floor
  userland/capsule_driver_i2c_pci/src/server/handlers/timing.rs   the SCL-count read-back probe
  userland/capsule_driver_i2c_pci/src/transaction/  the Busy/Timeout/Nack paths behind the status words
  docs/subsystems/hardware-broker/{claim,mmio,irq}.md   the broker stage markers and the routing trap
```

Every reference above is verified against those trees.
