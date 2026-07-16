---
title: "Input Driver Capsules"
description: "The ring and the three syscalls are the kernel half of input."
weight: 3
---
The [ring](/docs/subsystems/input/ring/) and the [three syscalls](/docs/subsystems/input/path/) are the kernel half of input. This page is the
other half, in full: the driver capsules that turn a physical keypress, a touchpad glide, or a USB
report into an `InputEvent` posted into that ring, the exact hardware each one drives, the broker
grants it holds, the capabilities it is allowed, and how to debug it when a machine boots with dead
input. There are four drivers and none runs in the kernel. Each is a ring-3 capsule that reaches its
device only through the [hardware broker](/docs/subsystems/hardware-broker/), reads the hardware, and calls
`MkInputEventPost`. The kernel never talks to a keyboard controller; it owns the ring and lends the
hardware.

| Capsule | Device | Service | Capability mask | Reaches hardware through |
|---------|--------|---------|-----------------|--------------------------|
| `capsule_driver_ps2_input` | PS/2 keyboard + AUX mouse | `driver.ps2_kbd0` (4208) | `0x358019` | port I/O grant + IRQ 1 / IRQ 12 |
| `capsule_driver_i2c_pci` | Intel LPSS i2c controller | `driver.i2c_pci0` (4230) | `0x78019` | MMIO grant + IRQ, no input of its own |
| `capsule_driver_i2c_hid` | i2c-HID touchpad / keyboard | `driver.i2c_hid0` (4232) | `0x200019` | IPC to `i2c_pci`, then `MkInputEventPost` |
| `capsule_driver_usb_hid` | USB HID keyboard / mouse / tablet | `driver.usb_hid0` (4222) | `0x200019` | IPC to the xHCI driver, then `MkInputEventPost` |

## Contents

- [The shared model](#the-shared-model)
- [The broker grants in detail](#the-broker-grants-in-detail)
- [PS/2: hardware to the register bit](#ps2-hardware-to-the-register-bit)
- [i2c-HID: a driver on top of a driver](#i2c-hid-a-driver-on-top-of-a-driver)
- [USB HID: a driver on top of xHCI](#usb-hid-a-driver-on-top-of-xhci)
- [What the kernel guarantees them](#what-the-kernel-guarantees-them)
- [Security analysis](#security-analysis)
- [Debugging input](#debugging-input)
- [Honest gaps](#honest-gaps)
- [Source map](#source-map)

## The shared model

Every input driver follows the same four steps, and the differences between them are only in how each
step is spelled for a particular bus:

```
  claim   -> broker claim of the device, an exclusive epoch-stamped handle
  grant   -> port I/O or MMIO grant for the registers, plus an IRQ binding
  read    -> poll or wait on the device, pull bytes or reports out of it
  post    -> translate to an InputEvent, MkInputEventPost into the kernel ring
```

The claim and the grants come from the [broker](/docs/subsystems/hardware-broker/): a claim is refused if
another capsule already holds the device, every grant is checked against the claim's epoch, and all of
it is revoked when the capsule exits. The post is one syscall. `post` in the i2c-HID driver
([`userland/capsule_driver_i2c_hid/src/input/post.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/post.rs)) is the whole translation layer in miniature:

```
  post(kind, code, dx, dy):
      ev = InputEvent { kind, flags: 0, code, x: 0, y: 0, delta_x: dx, delta_y: dy, timestamp_ns: 0 }
      mk_input_event_post(&ev) >= 0
```

The capsule fills a flat [`InputEvent`](/docs/subsystems/input/path/#the-event), hands it to the kernel by value, and is
done. It never sees the ring, the sequence number, or the router; the kernel takes the record from
there. A driver that cannot claim its device or bind its IRQ simply never posts, so a missing or busy
device produces no events rather than an error the desktop has to handle. Every driver's `_start` is
built around this: [`capsule_driver_ps2_input/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_driver_ps2_input/src/main.rs) retries `setup::run` in a yield loop until
the device is claimed and only then enters the server loop, so a driver spawned before its device is
ready waits instead of failing.

## The broker grants in detail

A driver holds four kinds of authority over its device, each a separate broker call checked against
the same claim epoch, and each released on the exit path. The PS/2 driver uses three of them and shows
the pattern exactly.

**Claim** ([`setup/claim.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/claim.rs)) returns the epoch that stamps everything after it:

```
  claim(device_id):
      r = mk_device_claim(device_id)          // -EBUSY if already claimed
      r < 0 -> Err ; else Ok(epoch = r)
```

**Port I/O grant** ([`setup/pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/pio.rs)) opens the register window, and rolls the claim back if it fails so
a half-open state never survives:

```
  grant(device_id, epoch):
      out = PioGrantOut { port_base, port_count, grant_id }
      r = mk_pio_grant(device_id, epoch, BAR_INDEX = 0, 0, &out)
      r < 0 -> mk_device_release(device_id) ; Err
      else  -> Ok(out)                        // port_base = 0x60, port_count spans 0x60..0x64
```

**IRQ bind** ([`setup/irq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/irq.rs)) attaches the device's line, and on failure releases the port grant it
already took, again to avoid a dangling grant:

```
  bind(device, epoch, pio_grant_id):
      out = IrqBindOut { grant_id, vector }
      r = mk_irq_bind(device.device_id, epoch, device.irq_line, 0, 0, &out)   // irq_line = 1 or 12
      r < 0 -> mk_pio_release(pio_grant_id) ; Err
      else  -> Ok(out)                        // vector is the CPU vector the driver waits on
```

The MMIO-based drivers use `mk_mmio_map` instead of the port grant, and the HID drivers use neither,
because they reach hardware through another capsule. Every grant carries the epoch, so a stale grant
(from a claim that was released and re-taken) fails the broker's `StaleEpoch` check, and every grant
is torn down when the capsule exits through the broker's four-class revoke. The rollback-on-failure
pattern above (release the claim if the grant fails, release the grant if the IRQ bind fails) is what
keeps a driver that dies mid-setup from stranding authority it can no longer use.

## PS/2: hardware to the register bit

`capsule_driver_ps2_input` owns its hardware directly, with no bus driver underneath, so it is the
place to see the full detail. It drives the 8042 controller through two ports the grant exposes as
offsets from `port_base`: `DATA_OFFSET = 0` (0x60) and `STATUS_OFFSET = 4` (0x64)
([`constants/ports.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/ports.rs)). The status byte it polls has five bits it cares about ([`constants/status.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/status.rs)):

```
  STATUS_OUTPUT_FULL = 0x01    a byte is waiting in the output buffer
  STATUS_INPUT_FULL  = 0x02    the controller has not consumed the last command
  STATUS_AUX_DATA    = 0x20    the waiting byte came from the AUX (mouse) port
  STATUS_TIMEOUT     = 0x40    a transmit/receive timeout, counted
  STATUS_PARITY      = 0x80    a parity error, counted
```

Bring-up (`setup/`, `init/`) is a fixed command sequence written to the control port: read the config
byte (`CTL_READ_CONFIG = 0x20`), enable both channels (`CTL_ENABLE_KBD = 0xAE`,
`CTL_ENABLE_AUX = 0xA8`), write the config back (`CTL_WRITE_CONFIG = 0x60`) with the two interrupt
bits set (`CONFIG_IRQ1 = 1<<0`, `CONFIG_IRQ12 = 1<<1`) and the disable bits clear
(`CONFIG_KBD_DISABLE = 1<<4`, `CONFIG_AUX_DISABLE = 1<<5`), enable scanning on the keyboard
(`KBD_ENABLE_SCANNING = 0xF4`), and set the mouse to defaults and reporting through the AUX write
command (`CTL_WRITE_AUX = 0xD4`, then `MOUSE_SET_DEFAULTS = 0xF6`, `MOUSE_ENABLE_REPORTING = 0xF4`),
acknowledging each with `MOUSE_ACK = 0xFA`. The two devices are identified by PnP id
([`constants/pnp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/pnp.rs)): the keyboard is `0x0001:0x0303`, the AUX mouse `0x0001:0x0304`.

Once configured the driver waits on its IRQ and drains the controller when it fires. The drain
([`poll/drain.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll/drain.rs)) reads at most sixteen bytes per pass, and routes each by the AUX-data bit:

```
  drain(grant, ...):
      for _ in 0..MAX_BYTES_PER_DRAIN = 16:
          status = read_port(grant, STATUS_OFFSET)
          if not (status & OUTPUT_FULL):  return
          if status & PARITY:   parity_errors += 1
          if status & TIMEOUT:  timeout_errors += 1
          byte = read_port(grant, DATA_OFFSET)
          if status & AUX_DATA:  mouse.absorb(byte)     // reassemble 3/4-byte PS/2 packets
          else:                  keyboard.absorb(byte)  // decode scancode set
```

The keyboard absorber decodes the scancode set and posts key events; the mouse parser reassembles the
PS/2 movement packets into pointer motion and button events. Both end at `MkInputEventPost`. None of
the 8042 protocol, the scancode set, or the packet format reaches the kernel: the driver owns the
quirks, the kernel owns the ring.

## i2c-HID: a driver on top of a driver

A modern laptop touchpad is not on a legacy port; it is an i2c-HID device hanging off an Intel LPSS
i2c controller, and reaching it takes two capsules. `capsule_driver_i2c_pci` owns the *bus*: it claims
the LPSS controller, takes an MMIO grant for its registers ([`setup/mmio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/mmio.rs)) and an IRQ
([`setup/irq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/irq.rs)), brings the controller out of reset, programs the SCL clock timing ([`init/scl.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/init/scl.rs)),
and exposes a transaction service. It posts no input events of its own; it is pure transport,
`driver.i2c_pci0`, and its capability mask (`0x78019`) grants MMIO, IRQ, and the device rights but
*not* the input-post right.

`capsule_driver_i2c_hid` owns the *device*. It never touches a bus register; it sends i2c transactions
to `driver.i2c_pci0` over IPC (`i2c_client/`), reads the HID descriptor and input reports that way,
parses each report ([`input/parse_report.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/input/parse_report.rs)), and posts pointer and key events ([`input/post.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/input/post.rs)). Its
capability mask (`0x200019`) is the input-post right plus IPC and memory, and nothing else, because it
reaches all of its hardware through another capsule. The device address and the interrupt come from
ACPI: the touchpad is described in the DSDT, not on PCI, so it is discovered by walking the ACPI
namespace (`src/arch/x86_64/acpi/devices/i2c/`) rather than enumerating a bus.

The layering is the point. The bus driver knows i2c timing and nothing about HID; the HID driver knows
report descriptors and nothing about SCL clocks; and the kernel knows neither, only the ring. Each
capsule holds exactly the authority its job needs, and a bug in HID report parsing cannot reach the
controller registers because that capsule was never granted them.

## USB HID: a driver on top of xHCI

`capsule_driver_usb_hid` follows the same shape one bus over. It does not own the USB host controller;
the xHCI driver does. The HID driver looks its device up through the xHCI service (`xhci/`), reads the
device and HID report descriptors (`descriptors/`), binds the interrupt endpoint, and then translates
each report: the boot-keyboard report through a keymap ([`hid/keymap.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hid/keymap.rs)), a mouse or tablet report
through the pointer path ([`hid/tablet.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hid/tablet.rs)), and posts the result. Its capability mask (`0x200019`) is
the same narrow input-post set as the i2c-HID driver, for the same reason: it reaches its hardware
through another capsule and needs only the right to post.

## What the kernel guarantees them

The drivers are mutually distrustful ring-3 programs, so the kernel's ring gives them properties none
of them has to coordinate. Posting is bounded and non-blocking: `post_input`
([`src/kernel_core/surface_registry/input_ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/surface_registry/input_ring.rs)) takes the ring mutex only long enough to store one
record and advance the head, and if the 1024-entry ring is full it increments a dropped counter and
returns rather than blocking the driver. Ordering across drivers is total: the ring is MPSC, so a key
from PS/2 and a motion from the touchpad interleave in posting order and the single router drains them
in that order. And the wakeup is exact: a post bumps a release-ordered sequence number and wakes the
one waiter armed on the ring, so the [input_router](/docs/userland/input-router/)
sleeps until there is an event instead of spinning. A driver never has to know any of this; it calls
one syscall and the kernel provides the bound, the order, and the wakeup.

## Security analysis

The capability masks are not decoration; they are the least-privilege boundary, and they decode
exactly to what each driver's job needs (bits from [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs)):

| Driver | Mask | Capabilities |
|--------|------|--------------|
| ps2_input | `0x358019` | CoreExec, IPC, Memory, DeviceEnum, Driver, Irq, **Pio**, **InputSource** |
| i2c_pci | `0x78019` | CoreExec, IPC, Memory, DeviceEnum, Driver, **Mmio**, **Irq** |
| i2c_hid | `0x200019` | CoreExec, IPC, Memory, **InputSource** |
| usb_hid | `0x200019` | CoreExec, IPC, Memory, **InputSource** |

Three properties fall straight out of that table. First, the HID drivers hold *no hardware capability
at all*: `i2c_hid` and `usb_hid` have `InputSource` and IPC and nothing else, so a compromised HID
report parser, the most complex and most exposed code in the input path, cannot map an MMIO region,
touch a port, take an interrupt, or program DMA. The worst it can do with its authority is post forged
input events, which is bounded by the ring and visible to the router. Second, the bus driver holds the
inverse: `i2c_pci` has `Mmio` and `Irq` but *not* `InputSource`, so the capsule that can touch the
controller registers cannot inject a keystroke. The right to drive the hardware and the right to
produce input are held by different capsules on purpose. Third, `Pio` is held by exactly one capsule
in the system, `ps2_input`, and only for its claimed device's port window; no other capsule can issue
a port instruction, and the broker refuses a port grant outside the claim. The trust boundary that
remains is `InputSource` itself: any capsule that holds it can post any event, so the mask is granted
only to the three drivers whose job is input, and the kernel checks it on every `MkInputEventPost`. A
capsule without `InputSource` calling the syscall is rejected at the boundary.

## Debugging input

Input is the subsystem where "nothing happens" has the most possible causes, so it is instrumented to
name the stage that failed rather than leave it silent. On a machine with a serial port the boot log
carries it; on a laptop with none, the same log renders on the framebuffer.

**The boot log.** Every driver is spawned through `capsule_boot::run`
([`src/userspace/init/capsule_boot/run.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs)), which prints `boot_log::ok(prefix, "capsule spawned")` on
success and `boot_log::error(...)` with the spawn error on failure. So the first question, "did the
driver capsule even load," is answered by a line like `[DRIVER-PS2-INPUT] capsule spawned`. If that
line is absent, the capsule's ELF failed verification or its manifest requested a capability outside
policy, and the spawn never happened.

**Seeing the log without a serial port.** A laptop has no serial port, so a `NONOS_FBCONSOLE=1` build
mirrors the boot log to the framebuffer (`src/sys/boot_log/`), where those `[DRIVER-*]` lines and any
capsule `mk_debug` output appear on screen. This is the on-silicon equivalent of `dmesg` during
bring-up: it is how you see that ps2_input spawned but i2c_hid did not, or that a claim failed.

**Confirming the device exists.** If a driver spawns but never posts, the next question is whether the
firmware even exposed its device. A `NONOS_DEVICE_CENSUS=1` build renders the broker device table to
the framebuffer and holds (`src/hardware/broker/census/`), so you can read off whether the i2c
controller or the touchpad is enumerated at all before any driver runs. An absent device is a
firmware/ACPI problem, not a driver bug, and the census separates the two.

**Isolating the ring from the driver.** `capsule_input_probe`
(`src/userspace/capsule_input_probe/`, the `input-probe-inject` feature) posts synthetic events into
the ring, so the router-to-consumer path can be exercised with no hardware. If probe events reach the
desktop but the real keyboard does not, the failure is below the ring, in the driver or its device; if
probe events also fail, it is above the ring, in the router or the consumer. This splits the input
path in half at the ring.

**The common failure stages,** each with its own signature: the capsule did not spawn (no boot-log
line, verification or capability failure); it spawned but could not claim (claim retry loop in
`main.rs` never exits, no port/MMIO grant); it claimed but the IRQ never fires (bound but silent,
usually GSI-to-vector routing through the [IOAPIC](/docs/subsystems/interrupts/) or, for an ACPI device, a
wrong interrupt recovered from the DSDT); or it reads but nothing appears (a parse or post bug, checked
by whether the census/probe path works). Each stage is a different subsystem, and the tools above tell
you which one before you change any code.

## Honest gaps

The PS/2 driver decodes the common scancode set and the standard three/four-byte mouse packet; exotic
keyboards and high-resolution scroll modes are not all covered. The i2c-HID path depends on the
touchpad's `_CRS` in the DSDT being well-formed; a firmware that hides the address behind an
indirection the ACPI walker does not resolve leaves the device undiscovered, which is a real-hardware
variation rather than a driver defect. The USB-HID driver handles boot-protocol keyboards and mice and
tablets; the full report-descriptor generality of arbitrary HID devices is not implemented.

## Source map

- `userland/capsule_driver_ps2_input/` - the PS/2 driver: `setup/` (`claim.rs`, `pio.rs`, `irq.rs`,
  `sequence.rs`), `constants/` (`ports.rs`, `status.rs`, `pnp.rs`), [`poll/drain.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/poll/drain.rs), `keymap.rs`,
  `mouse.rs`, `server/`. Kernel embed at `src/hardware/ps2_kbd_capsule/`.
- `userland/capsule_driver_i2c_pci/` - the LPSS i2c bus driver: `setup/` (`mmio.rs`, `irq.rs`,
  `claim.rs`), [`init/scl.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/init/scl.rs), `transaction/`. Kernel embed at `src/hardware/i2c_pci_capsule/`.
- `userland/capsule_driver_i2c_hid/` - the i2c-HID driver: `i2c_client/`, [`input/parse_report.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/input/parse_report.rs),
  [`input/post.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/input/post.rs), `hid/`. ACPI discovery in `src/arch/x86_64/acpi/devices/i2c/`.
- `userland/capsule_driver_usb_hid/` - the USB HID driver: `xhci/`, `descriptors/`, [`hid/keymap.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hid/keymap.rs),
  [`hid/tablet.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/hid/tablet.rs).
- Kernel side: the ring and event type in `src/kernel_core/surface_registry/`, the post/drain/wait
  syscalls in [`src/syscall/dispatch/router/input_ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/input_ops.rs), the capability bits in
  [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), the driver spawn plan in [`src/userspace/init/spawn_plan/drivers_input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_input.rs),
  and the broker grant paths in `src/hardware/broker/`.

Every reference above is verified against those trees. The router capsule that drains the ring and fans
events out to focus is documented on the
[input_router](/docs/userland/input-router/) page; the grant syscalls it rests on are
specified on the [hardware broker](/docs/subsystems/hardware-broker/) pages.
