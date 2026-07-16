---
title: "Debugging capsule_driver_i2c_hid"
description: "This page lists the boot marker the driver emits, the live introspection surface, and the concrete failure modes with where to look for each."
weight: 4
---
This page lists the boot marker the driver emits, the live introspection surface, and the concrete failure
modes with where to look for each. For the driver model see the [README](/docs/userland/driver-i2c-hid/), the
[protocol and discovery](/docs/userland/driver-i2c-hid/protocol/) page, and the [report path](/docs/userland/driver-i2c-hid/input/) page.

## Boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[DRIVER-I2C-HID] capsule spawned` from the capsule boot path: the `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), and the tag comes from the bus-driver
plan ([`src/userspace/init/spawn_plan/drivers_bus.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L55)). If that line is absent the capsule never started,
and the `Err` arm logged an error line through `boot_log::error` instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure.

## The live introspection surface

`OP_HEALTHCHECK` is the one runtime introspection surface. Its reply carries the found flag, the selected
address, the controller port and pid, and the `probes`, `input_polls`, `input_reports`, and
`post_failures` counters ([`src/server/handlers/health.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L5)). Those counters isolate most report-path
failures: `input_polls` counts read attempts and `input_reports` counts successful parses, so the gap
between them is transfers or parses that failed. The layout of the 56-byte body is in the
[protocol](/docs/userland/driver-i2c-hid/protocol/) page.

## Failure modes

### Startup fails closed, no capsule at all

`setup::run` returns an error only when `driver.i2c_pci0` does not resolve
([`src/i2c_client/service.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/service.rs#L3), [`src/setup.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L6)). Confirm the I2C controller capsule is spawned and
registered before this one; without it, `_start` exits 1 ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38)) and no boot marker appears.

### Touchpad dead, descriptor never found

`found()` stays false when no candidate address returns a valid 30-byte descriptor
([`src/hid/probe.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L6), [`src/state.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L34)). `OP_DESCRIPTOR` returns `E_NOT_FOUND`
([`src/server/handlers/descriptor.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/descriptor.rs#L6)) and `OP_HEALTHCHECK` shows the found flag clear with a rising
`probes` count. The device address may be outside the fixed candidate list
([`src/hid/probe.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/probe.rs#L4)), or the descriptor may fail the length or BCD-version check
([`src/hid/descriptor.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/descriptor.rs#L3)). `OP_PROBE` forces a re-scan ([`src/server/handlers/probe.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L7)).

### Descriptor found but no reports

`OP_HEALTHCHECK` shows `found` set but `input_reports` flat. Two cases:

- If `input_polls` is also flat, the poll guard is rejecting the setup: the derived input register is zero
  or the input length is under five bytes ([`src/input/poll.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L23)). Those come from descriptor offsets 8..10
  and 10..12 ([`src/hid/input_register.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_register.rs#L17), [`src/hid/input_len.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/input_len.rs#L17)).
- If `input_polls` climbs while `input_reports` stays flat, the transfer is failing or the returned bytes
  are not parsing: `write_read` returned `None`, a controller error or a 250 ms timeout
  ([`src/input/poll.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L30), [`src/i2c_client/transfer.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/transfer.rs#L16)), or `parse_report` rejected the length prefix
  ([`src/input/parse_report.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L24)).

### Reports arrive but the pointer misbehaves or coordinates are wrong

This is the expected symptom on a real Precision Touchpad, because the parser decodes a relative-pointer
layout, not the absolute multi-contact report ([`src/input/parse_report.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L19)). The device is sending an
absolute touch report and the parser is reading its first bytes as if they were mouse deltas. The fix is a
proper absolute decode, not a tweak; see the [contributing](/docs/userland/driver-i2c-hid/contributing/) page for the modules the
absolute path would touch and the note that it is on a different branch.

### Events decode but never reach the surface

If `post_failures` climbs, the kernel is refusing the post
([`src/input/publish.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L43)), which points at the `InputSource` capability check
([`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78)) or a full input ring
([`src/kernel_core/surface_registry/input_ring.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs#L59)). If `post_failures` stays flat and events still do
not appear, the input path past the ring is the suspect, not this driver; see
[the input path](/docs/subsystems/input/path/).

## Source map

```
  src/userspace/init/capsule_boot/run.rs               [DRIVER-I2C-HID] capsule spawned / error path
  src/userspace/init/spawn_plan/drivers_bus.rs         the DRIVER-I2C-HID tag and spawn entry
  userland/capsule_driver_i2c_hid/src/server/handlers/health.rs   the health counters
  userland/capsule_driver_i2c_hid/src/server/handlers/descriptor.rs  E_NOT_FOUND when no descriptor
  userland/capsule_driver_i2c_hid/src/server/handlers/probe.rs    OP_PROBE forces a re-scan
  userland/capsule_driver_i2c_hid/src/i2c_client/service.rs       resolve driver.i2c_pci0
  userland/capsule_driver_i2c_hid/src/setup.rs                    startup fails closed on missing controller
  userland/capsule_driver_i2c_hid/src/hid/probe.rs               candidate-address scan
  userland/capsule_driver_i2c_hid/src/hid/descriptor.rs          descriptor validation
  userland/capsule_driver_i2c_hid/src/input/poll.rs             the poll guard and read
  userland/capsule_driver_i2c_hid/src/input/parse_report.rs     the length-prefix and relative decode
  userland/capsule_driver_i2c_hid/src/input/publish.rs          post_failures
  src/syscall/contract/cap_table/mk.rs                          the InputSource gate
  src/kernel_core/surface_registry/input_ring.rs                the bounded ring drop
```

Every reference above is verified against those trees.
