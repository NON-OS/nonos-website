---
title: "Debugging capsule_driver_hda"
description: "This page lists the log markers the driver and its boot path emit, the per-error exit codes, and the concrete failure modes with where to look for each."
weight: 5
---
This page lists the log markers the driver and its boot path emit, the per-error exit codes, and the
concrete failure modes with where to look for each. For the bring-up path see the [bring-up](/docs/userland/driver-hda/bringup/)
page, for the query surface see the [operations](/docs/userland/driver-hda/operations/) page, and for the driver's identity see
the [README](/docs/userland/driver-hda/).

## Log markers

The first thing to confirm is that the capsule ran. The driver fleet boots it under the tag `DRIVER-HDA`
([`src/userspace/init/spawn_plan/drivers_storage.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L40)), and a successful spawn logs
`[DRIVER-HDA] capsule spawned` from the capsule boot path: the `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is
absent the capsule never started, and the `Err` arm logged an error line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure. The sibling drivers page records `[DRIVER-HDA]` as that marker
(`docs/userland/drivers.md:295`). If the ELF fails to load specifically, the spawn path emits the debug
tag `[DRIVER-HDA] load_elf_executable error:` ([`src/hardware/hda_capsule/spawn.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/hda_capsule/spawn.rs#L57)).

## Setup exit codes

Setup failures are hard barriers, and each `HdaError` maps to a distinct process exit code, so a driver
that never comes up tells you exactly where it stopped ([`src/error/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L29)):

```
  2  DeviceNotFound             no PCI HDA function matched discovery          discover.rs:32
  3  BrokerCallFailed           a claim/mmio/irq/pci broker call returned < 0  setup/*
  4  ControllerResetTimeout     GCTL.CRST never read back set                  controller/reset.rs:35
  5  ImmediateCommandBusy       IRS.BUSY never cleared before a codec verb     controller/immediate.rs:46
  6  ImmediateResponseTimeout   no valid immediate response for a codec verb   controller/immediate.rs:59
  7  UnsupportedController      GCAP or the major version read back as zero    setup/sequence.rs:41
```

`_start` runs `exit_code(e)` on any setup error and exits with that number ([`src/main.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L43),
[`src/error/types.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L29)), so the exit code alone names the failing step.

## Failure modes

### The controller is never found

Exit code 2 (`DeviceNotFound`) means no record in the audio-class device list passed the candidate
predicate ([`src/discover.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L50)). The predicate is strict: PCI bus, multimedia class `0x04`, HDA subclass
`0x03`, BAR0 present as MMIO of at least 4 KiB, a non-zero interrupt pin, and a routed interrupt line
([`src/discover.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L50)). A controller that is present but has no routed line, or whose BAR0 is not yet
assigned, fails here. This is a discovery problem one layer down, in the broker device table, not a
driver bug; the [claim](/docs/subsystems/hardware-broker/claim/) page describes the
`NONOS_DEVICE_CENSUS=1` build that renders that table so you can see whether the device was enumerated at
all.

### A broker call is refused

Exit code 3 (`BrokerCallFailed`) carries the negative broker return and comes from any of the four
bring-up steps: claim, bus-master write, BAR0 map, or IRQ bind ([`src/setup/claim.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L23),
[`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23), [`src/setup/mmio.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L25), [`src/setup/irq.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L25)). The setup path unwinds cleanly on
each: a failed map or bind releases what was already taken, so a code-3 exit never leaves a dangling
grant ([`src/setup/mmio.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L26), [`src/setup/irq.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L26)). The broker's own stage markers name which step was
refused: the [MMIO](/docs/subsystems/hardware-broker/mmio/) page documents the `[MMIO]` trace and the
[IRQ](/docs/subsystems/hardware-broker/irq/) page the bind-error variants. A `StaleEpoch` here means the
claim was lost between claim and grant, a release race worth tracing on the
[claim](/docs/subsystems/hardware-broker/claim/) page.

### The controller never leaves reset

Exit code 4 (`ControllerResetTimeout`) means `GCTL.CRST` was driven high but never read back set within
the bounded spin ([`src/controller/reset.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset.rs#L29)). That points at the controller or the BAR0 mapping, not
the wire format: if the register window is mapped to the wrong physical range, `GCTL` reads back a
constant and `CRST` never appears set. Confirm the BAR0 map succeeded first (no code-3 exit), then the
suspect is the controller state or a firmware quirk in the reset polarity.

### A codec is present but its ids are zero

If the driver comes up and `OP_CODEC_LIST` reports a codec whose `probe_ok` byte is 0, the codec's
presence bit was set in `STATESTS` but the immediate-command `Get Parameter(Vendor ID)` timed out for that
address ([`src/controller/codec_probe.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L56)). The entry still lists the address and marks it present, so a
present-but-unidentified codec is distinguishable from an identified one. This is a per-codec timeout that
does not fail the whole bring-up. A codec whose immediate interface hangs at setup, never clearing busy or
never returning a valid response, is the more severe case: it fails the entire bring-up with exit code 5
or 6 instead ([`src/controller/immediate.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L46), `:59`).

### No codecs reported at all

If discovery found the controller and it left reset but `OP_CODEC_MASK` returns a zero mask and
`OP_CODEC_LIST` a zero count, no `STATESTS` presence bit is set, so no codec was detected on the link
([`src/controller/codec_probe.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L36), [`src/server/handlers/codec_mask.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/codec_mask.rs#L28)). `OP_CONTROLLER_INFO` still
answers with the live registers, so read back `STATESTS` there to confirm the controller sees the same
empty link ([`src/server/handlers/controller_info.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L39)).

### A request gets no useful reply

A frame whose first four bytes are not `NHDA` or whose version is not 1 is dropped inside `decode_request`
and answered with `E_INVAL` through the decode-failed path ([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23),
[`src/server/error.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L29)). Any op that arrives with a non-zero `payload_len` is answered with `E_INVAL`
before dispatch, and an unknown opcode falls to the same error ([`src/server/runner/run.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L50), `:60`). So a
client that gets only `E_INVAL` should check that it is sending a bare 20-byte `NHDA` v1 header with a
known opcode and no body. Because no op accepts caller data and no op programs the device, a malformed
request can only ever read what the controller reports; it cannot drive the controller into any state.

### The interrupt fires but nothing waits on it

This is expected, not a bug. The runtime `poll_irq` drains the controller interrupt each loop iteration
and acknowledges it, but no query waits on it, because every op is a synchronous register read
([`src/server/runner/poll_irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/poll_irq.rs#L21)). There is no stream DMA in this slice, so there is no
completion-interrupt work. If you are looking for audio buffer completions, they do not exist here; see
the [contributing](/docs/userland/driver-hda/contributing/) page for what a playback path would add.

## Source map

This page is drawn from the boot path, the capsule's error and discovery modules, the controller and
server modules, and the broker debugging pages.

```
  src/userspace/init/spawn_plan/drivers_storage.rs        the DRIVER-HDA spawn entry
  src/userspace/init/capsule_boot/run.rs                  [DRIVER-HDA] capsule spawned / error path
  src/hardware/hda_capsule/spawn.rs                       the load_elf_executable error tag
  userland/capsule_driver_hda/src/main.rs                 exit_code on a setup failure
  userland/capsule_driver_hda/src/error/types.rs          HdaError and the exit-code mapping
  userland/capsule_driver_hda/src/discover.rs             the candidate predicate
  userland/capsule_driver_hda/src/controller/reset.rs     the reset timeout
  userland/capsule_driver_hda/src/controller/immediate.rs the immediate-command timeouts
  userland/capsule_driver_hda/src/controller/codec_probe.rs  presence vs probe_ok
  userland/capsule_driver_hda/src/server/runner/run.rs    the decode and payload guards
  userland/capsule_driver_hda/src/server/runner/poll_irq.rs  the drain-only interrupt poll
  docs/subsystems/hardware-broker/claim.md                claim, epoch, and the device census
  docs/subsystems/hardware-broker/mmio.md                 the MMIO stage trace
  docs/subsystems/hardware-broker/irq.md                  the bind-error variants
```

Every reference above is verified against those trees.
