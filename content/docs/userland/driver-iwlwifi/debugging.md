---
title: "Debugging capsule_driver_iwlwifi"
description: "This page lists the log marker the driver's boot path emits, the two setup exit codes, and the runtime errno words with where to look for each."
weight: 9
---
This page lists the log marker the driver's boot path emits, the two setup exit codes, and the runtime errno
words with where to look for each. For the shape of the driver and its honest state see the
[README](/docs/userland/driver-iwlwifi/), the [operations](/docs/userland/driver-iwlwifi/operations/) page, the [bring-up](/docs/userland/driver-iwlwifi/bring-up/) page, and the
[firmware](/docs/userland/driver-iwlwifi/firmware/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[DRIVER-IWLWIFI] capsule spawned`: the bus-driver spawn plan calls `boot::capsule` with the tag
`DRIVER-IWLWIFI` ([`src/userspace/init/spawn_plan/drivers_bus.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L26)), whose `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which formats
`[` + tag + `] ` + message. An absent line means the capsule never started, usually a signature, manifest,
or capability failure; the `Err` arm prints an error line instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)).
The spawn is feature-gated: without `nonos-capsule-driver-iwlwifi` the spawn function is a no-op and no
marker appears at all ([`src/userspace/init/spawn_plan/drivers_bus.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L34)).

## The two setup exit codes

Unlike the NVMe driver, which maps each failure to a distinct exit code, this capsule uses only two: `_start`
exits 1 if the heap fails to initialise, and 2 if `setup::run` returns any `Err`
([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), [`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). So exit 2 is the single "bring-up failed" code, and the specific reason
is the `&'static str` the failing step returned. The steps and their messages:

| Message | Where | Meaning |
|---|---|---|
| `iwlwifi: device not found` | [`src/setup/sequence.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L20) | no PCI function matched Intel vendor, class/subclass `02/80`, a supported family id, a valid IRQ pin/line, and a non-zero MMIO BAR0 ([`src/discover.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L34)). |
| `iwlwifi: unsupported device` | [`src/setup/sequence.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L21) | the matched device id has no family mapping; in practice unreachable because discovery already required one ([`src/firmware/family.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/family.rs#L19)). |
| `iwlwifi: device claim failed` | [`src/setup/claim.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L14) | `mk_device_claim` returned non-positive, usually a missing `Driver` capability or a device already claimed. |
| `iwlwifi: mmio map failed` | [`src/setup/mmio.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L20) | `mk_mmio_map` on BAR0 was refused; the device is released before returning. |
| `iwlwifi: irq bind failed` | [`src/setup/irq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L19) | `mk_irq_bind` (legacy INTx) was refused; the MMIO grant is unmapped and the device released. |
| `iwlwifi: dma staging failed` | [`src/setup/dma.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L27) | `mk_dma_map` for the 64 KiB staging region was refused; the IRQ, MMIO, and claim are rolled back. |
| `iwlwifi: mac clock not ready` | [`src/init.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L27) | the APM `MAC_CLOCK_READY` poll spun out after 250000 iterations without the clock coming ready. |

Because all of these collapse to exit code 2, the way to tell them apart is the console message the failing
step printed, or the broker's own stage markers on the [MMIO](/docs/subsystems/hardware-broker/mmio/),
[DMA](/docs/subsystems/hardware-broker/dma/), and [IRQ](/docs/subsystems/hardware-broker/irq/) pages.

### Device not found on real hardware

The `02/80` class/subclass match is the generic network-controller/other class Intel Wi-Fi parts report, so
a device present but reporting a different class, or one that never enumerated, gives `device not found`. If
the census shows the Intel function present but the driver still reports not found, check the interrupt pin
and line: discovery skips a device with `irq_pin == 0` or `irq_line == 0xFF` ([`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41)). A
`NONOS_DEVICE_CENSUS=1` build renders the broker device table so you can confirm the device and its IRQ
routing before any driver runs (see the [claim](/docs/subsystems/hardware-broker/claim/) page).

### MAC clock not ready

This is the one register-level bring-up failure. `bring_up` sets `XTAL_ON` then `MAC_ACCESS_REQ | INIT_DONE`
and polls `GP_CNTRL` for `MAC_CLOCK_READY` ([`src/init.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L24)). A spin-out means the device did not bring its
MAC clock up, which on real hardware points at power state, a wrong BAR mapped (so the register reads are
not the real `CSR_GP_CNTRL`), or a device held in reset. On QEMU, where no real Intel Wi-Fi model exists,
this step is not exercised the way it is on hardware.

## Runtime errno words

After a successful boot the failures surface as errno words in the reply, not exit codes. The full set is on
the [operations](/docs/userland/driver-iwlwifi/operations/) page; the two that indicate a real condition rather than a malformed request:

### OP_ALIVE_WAIT returns E_TIMEOUT

`OP_ALIVE_WAIT` returns `E_TIMEOUT` (`-110`) when the alive-bit poll spun out
([`src/server/handlers/alive.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/alive.rs#L13)). On this capsule that is the expected result, not a fault: nothing
programs the flow-handler transfer that would make the firmware run and raise the alive interrupt, so the
bit is not expected to be set (see the [firmware](/docs/userland/driver-iwlwifi/firmware/) page). A client should treat a timeout here as
"firmware not yet delivered", which is the current state of the driver, rather than a device error.

### OP_FIRMWARE_STAGE returns E_FW_INVALID

`OP_FIRMWARE_STAGE` returns `E_FW_INVALID` (`-84`) when `stage_firmware` returned `None`
([`src/server/handlers/firmware_stage.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/firmware_stage.rs#L9)). Two causes: the TLV header failed validation (a wrong magic, or
an API version outside 22 to 77) ([`src/firmware/tlv.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/tlv.rs#L23)), or the sections overflowed the 64 KiB DMA
staging capacity ([`src/firmware/stage/stage_section.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/stage_section.rs#L27)). The first points at the wrong or a corrupt blob
for the family; the second at a firmware whose init, runtime, and paging sections plus their 12-byte records
exceed the staging buffer, which would need the `FW_STAGING_SIZE` constant raised
([`src/constants/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L20)).

### Bad requests

`E_BAD_OP` (`-38`) is an unknown opcode with an empty body, and `E_INVAL` (`-22`) is any request that carried
a non-empty body, since every op is fixed-width and takes no payload ([`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47),
`runner.rs:50`). These are client protocol errors, not device state.

## Source map

```
  src/userspace/init/spawn_plan/drivers_bus.rs        the DRIVER-IWLWIFI spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs              the capsule-spawned / error boot markers
  userland/capsule_driver_iwlwifi/src/main.rs         the two exit codes
  userland/capsule_driver_iwlwifi/src/setup/          the per-step Err messages behind exit code 2
  userland/capsule_driver_iwlwifi/src/discover.rs     the device match behind device not found
  userland/capsule_driver_iwlwifi/src/init.rs         the mac-clock poll behind mac clock not ready
  userland/capsule_driver_iwlwifi/src/server/handlers/alive.rs          the E_TIMEOUT path
  userland/capsule_driver_iwlwifi/src/server/handlers/firmware_stage.rs the E_FW_INVALID path
  userland/capsule_driver_iwlwifi/src/firmware/tlv.rs                   the TLV header validation
  userland/capsule_driver_iwlwifi/src/firmware/stage/stage_section.rs   the staging capacity bound
  userland/capsule_driver_iwlwifi/src/server/runner.rs                  the E_BAD_OP / E_INVAL fall-through
```

Every reference above is verified against those trees.
