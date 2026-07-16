---
title: "Debugging capsule_driver_bga"
description: "This page lists the concrete failure modes of the BGA capsule and where to look for each."
weight: 5
---
This page lists the concrete failure modes of the BGA capsule and where to look for each. For how the
capsule is put together, read the [README](/docs/userland/driver-bga/), the [bring-up](/docs/userland/driver-bga/bring-up/), and the
[mode-set](/docs/userland/driver-bga/mode-set/) pages in this folder.

The capsule has no log markers of its own. It prints nothing, because it registers no service and calls no
debug syscall ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33); there is no debug call anywhere in `src/`). What it produces instead is a
process exit code on failure and a solid dark-teal panel on success. Diagnose it through the exit code and
the broker's own traces.

## Nothing on screen, capsule exits with code 2

`find_bga` matched no device, so `setup::run` returned `DeviceNotFound`, which `exit_code` maps to `2`
([`src/discover.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L51), [`src/setup/sequence.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L28), [`src/error.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L27)). Either the QEMU stdvga device is
absent, or its PCI identity or BAR layout does not match the filter: it requires vendor `0x1234`, device
`0x1111`, class `0x03`, more than three BARs, and both BAR 0 and BAR 2 as non-zero MMIO BARs
([`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41)). Confirm the device is enumerated at all before this capsule runs by checking the
broker device table ([device claim](/docs/subsystems/hardware-broker/claim/)). The full filter is in the
[bring-up](/docs/userland/driver-bga/bring-up/) page.

## Capsule exits with code 3

A broker call returned a negative rc, wrapped as `BrokerCallFailed(rc)` and mapped to exit `3`
([`src/error.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L28), [`src/error.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L25)). The failing call is one of claim, bus-master, or either MMIO map,
in that order ([`src/setup/sequence.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L29)). A claim rejection is usually `AlreadyClaimed` (another capsule
holds the display, for example the virtio-gpu driver) or a stale epoch
([device claim](/docs/subsystems/hardware-broker/claim/)); a map rejection is one of the broker's own
ordered `MkMmioMap` checks, such as a stale epoch, a bad range, or the MSI-X clamp
([MMIO grants](/docs/subsystems/hardware-broker/mmio/)). The raw negative rc is carried inside the error
value but not in the exit code, which is fixed at `3` ([`src/error.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L20), [`src/error.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L25)), so trace the
setup call to see which rc it was.

## Panel comes up but at the wrong resolution

The mode is the compile-time constant 1024x768x32 ([`src/constants.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L33)). This capsule does not read EDID
and does not negotiate a mode, so it always programs 1024x768 over the DISPI linear-framebuffer path
([`src/dispi/set_mode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L24)). A display or emulated adapter that does not accept that mode shows whatever
the firmware left. Changing the mode today means changing the `MODE_WIDTH` and `MODE_HEIGHT` constants and
rebuilding; there is no runtime path (see the promotion note in [contributing](/docs/userland/driver-bga/contributing/)).

## Panel is garbled or a partial fill

The clear loop writes exactly `width * height` pixels contiguously from the framebuffer base, which
assumes the scanline stride equals `width * 4` ([`src/dispi/clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/clear.rs#L19), [`src/setup/sequence.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L38),
[`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41)). If the adapter's real scanline stride differs from `width * 4`, the fill will
step across scanlines out of phase and the panel will look sheared or striped. If the framebuffer BAR is
smaller than `width * height * 4`, the loop walks past the mapped slice and faults into the guard page the
broker installs after every grant ([MMIO grants](/docs/subsystems/hardware-broker/mmio/)). The capsule
does not read back a hardware stride register; it trusts the packed 32-bit layout the DISPI mode-set
requested. This assumption is the honest gap in the mode-set, documented in [mode-set](/docs/userland/driver-bga/mode-set/).

## Panel stays up but nothing else happens

That is the expected steady state, not a fault. After a successful bring-up the capsule parks in a
`mk_yield` loop holding the `Driver`, which keeps the two BAR grants and the device claim alive
([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38), [`src/setup/driver.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L19)). It has no request loop and serves no clients, so it does
nothing further by design. If the panel goes blank, suspect that the `Driver` was dropped, since
`BrokerHandles::drop` unmaps both BARs and releases the device ([`src/handles.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L31)); on the normal
success path that only happens at process exit.

## Source map

```
  userland/capsule_driver_bga/src/main.rs             _start, the park loop; no log markers
  userland/capsule_driver_bga/src/discover.rs         find_bga: the match filter behind exit code 2
  userland/capsule_driver_bga/src/setup/sequence.rs   the ordered calls behind exit code 3
  userland/capsule_driver_bga/src/error.rs            BgaError, exit_code (2 and 3), the hidden raw rc
  userland/capsule_driver_bga/src/dispi/set_mode.rs   the fixed 1024x768x32 mode
  userland/capsule_driver_bga/src/dispi/clear.rs      the stride-assuming fill
  userland/capsule_driver_bga/src/constants.rs        the mode constants
  userland/capsule_driver_bga/src/handles.rs          the RAII teardown behind a blank panel
  docs/subsystems/hardware-broker/claim.md            claim rejections and the device table
  docs/subsystems/hardware-broker/mmio.md             map rejections and the guard page
```

Every reference above is verified against those trees.
