---
title: "Driver Capsules"
description: "This page documents the user-mode hardware driver capsules."
weight: 21
---
This page documents the user-mode hardware driver capsules. Read
[Capsule Inventory](/docs/userland/capsules/), [Hardware Broker](/docs/subsystems/hardware-broker/),
[Input](/docs/subsystems/input/), [Graphics](/docs/subsystems/graphics/), and
[Storage](/docs/subsystems/storage/) first.

Read each driver as two contracts. The first contract is its service surface:
which port, capability set, and protocol operations it exposes. The second is
its side effect on the system: packets, blocks, display state, or input events.

---

## 1. Boot group

Driver startup is split into virtio, bus, input, NIC, USB, and storage groups
([`src/userspace/init/spawn_plan/orchestrator.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/orchestrator.rs#L29)). The virtio group delegates
I/O drivers and display/network drivers separately
([`src/userspace/init/spawn_plan/drivers_virtio.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio.rs#L17)). USB, NIC, bus, input,
and storage groups each call their capsule spawn functions in fixed order
([`src/userspace/init/spawn_plan/drivers_usb.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L17),
[`src/userspace/init/spawn_plan/drivers_nic.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L17),
[`src/userspace/init/spawn_plan/drivers_bus.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L17),
[`src/userspace/init/spawn_plan/drivers_input.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_input.rs#L17),
[`src/userspace/init/spawn_plan/drivers_storage.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L17)).

```
+----------------+
| init drivers   |
+-------+--------+
        |
+-------+--------+
| virtio group   |
+-------+--------+
        |
+-------+--------+
| bus group      |
+-------+--------+
        |
+-------+--------+
| input group    |
+-------+--------+
        |
+-------+--------+
| nic group      |
+-------+--------+
        |
+-------+--------+
| usb group      |
+-------+--------+
        |
+-------+--------+
| storage group  |
+----------------+
```

## 2. Driver contract table

Each of the thirteen non-network drivers has a dedicated page in
[capsule-catalog](/docs/userland/capsules-catalog/) with the full operation reference, bring-up,
and source map; the `Page` column links it. The five network drivers
(`e1000`, `iwlwifi`, `rtl8139`, `rtl8169`, `virtio_net`) are documented by the
[networking subsystem](/docs/subsystems/networking/) and have no dedicated
capsule page. Masks below are the signed `CAPSULE_REQUIRED_CAPS` from each
capsule's `Capsule.mk`.

| Capsule | Service | Caps | Protocol operations | Entrypoint | Page | Spec refs |
|---------|---------|------|---------------------|------------|------|-----------|
| `driver.virtio_rng` | `service:4200:driver.virtio_rng` | `0x1F8019` | fill random, healthcheck | [`userland/capsule_driver_virtio_rng/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_rng/src/main.rs#L35) | [driver-virtio-rng](/docs/userland/driver-virtio-rng/) | `userland/capsule_driver_virtio_rng/Capsule.mk:13`, `userland/capsule_driver_virtio_rng/Capsule.mk:17`, [`userland/capsule_driver_virtio_rng/src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_rng/src/protocol/ops.rs#L21) |
| `driver.virtio_blk0` | `service:4202:driver.virtio_blk0` | `0x1F8019` | healthcheck, capacity, read blocks, write blocks, flush | [`userland/capsule_driver_virtio_blk/src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/main.rs#L30) | [driver-virtio-blk](/docs/userland/driver-virtio-blk/) | `userland/capsule_driver_virtio_blk/Capsule.mk:13`, `userland/capsule_driver_virtio_blk/Capsule.mk:16`, [`userland/capsule_driver_virtio_blk/src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/protocol/ops.rs#L16) |
| `driver.virtio_net0` | `service:4204:driver.virtio_net0` | `0x1F8019` | healthcheck, link status, MAC address, TX packet, RX packet | [`userland/capsule_driver_virtio_net/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_net/src/main.rs#L36) | [networking](/docs/subsystems/networking/) | `userland/capsule_driver_virtio_net/Capsule.mk:14`, `userland/capsule_driver_virtio_net/Capsule.mk:17`, [`userland/capsule_driver_virtio_net/src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_net/src/protocol/ops.rs#L21) |
| `driver.virtio_gpu0` | `service:4226:driver.virtio_gpu0` | `0x1F9019` | healthcheck, controller info, display info, controlq state, query caps, create resource, attach backing, transfer to host, set scanout, flush, mode list, primary surface | [`userland/capsule_driver_virtio_gpu/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_gpu/src/main.rs#L35) | [driver-virtio-gpu](/docs/userland/driver-virtio-gpu/) | `userland/capsule_driver_virtio_gpu/Capsule.mk:12`, `userland/capsule_driver_virtio_gpu/Capsule.mk:16`, [`userland/capsule_driver_virtio_gpu/src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_gpu/src/protocol/ops.rs#L16) |
| `driver.xhci0` | `service:4206:driver.xhci0` | `0xF8019` | healthcheck, controller status, port status, enable slot, disable slot, address device, device descriptor, config descriptor, transfer ring allocation, control transfer, interrupt in | [`userland/capsule_driver_xhci/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_xhci/src/main.rs#L36) | [driver-xhci](/docs/userland/driver-xhci/) | `userland/capsule_driver_xhci/Capsule.mk:13`, `userland/capsule_driver_xhci/Capsule.mk:16`, [`userland/capsule_driver_xhci/src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_xhci/src/protocol/ops.rs#L16) |
| `driver.ps2_kbd0` | `service:4208:driver.ps2_kbd0` | `0x358019` | healthcheck, poll events, get state, controller status, poll mouse | [`userland/capsule_driver_ps2_input/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/main.rs#L31) | [driver-ps2-input](/docs/userland/driver-ps2-input/) | `userland/capsule_driver_ps2_input/Capsule.mk:13`, `userland/capsule_driver_ps2_input/Capsule.mk:17`, [`userland/capsule_driver_ps2_input/src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/protocol/ops.rs#L16) |
| `driver.e1000_0` | `service:4210:driver.e1000_0` | `0xF8019` | healthcheck, link status, MAC address, TX packet, RX packet, stats | [`userland/capsule_driver_e1000/src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_e1000/src/main.rs#L38) | [networking](/docs/subsystems/networking/) | `userland/capsule_driver_e1000/Capsule.mk:16`, `userland/capsule_driver_e1000/Capsule.mk:19`, [`userland/capsule_driver_e1000/src/protocol/ops.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_e1000/src/protocol/ops.rs#L23) |
| `driver.rtl8139_0` | `service:4212:driver.rtl8139_0` | `0x1D8019` | healthcheck, link status, MAC address, TX packet, RX packet, stats | [`userland/capsule_driver_rtl8139/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_rtl8139/src/main.rs#L35) | [networking](/docs/subsystems/networking/) | `userland/capsule_driver_rtl8139/Capsule.mk:13`, `userland/capsule_driver_rtl8139/Capsule.mk:16`, [`userland/capsule_driver_rtl8139/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_rtl8139/src/protocol/ops.rs#L17) |
| `driver.rtl8169_0` | `service:4214:driver.rtl8169_0` | `0xF8019` | healthcheck, link status, MAC address, TX packet, RX packet, stats | [`userland/capsule_driver_rtl8169/src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_rtl8169/src/main.rs#L40) | [networking](/docs/subsystems/networking/) | `userland/capsule_driver_rtl8169/Capsule.mk:13`, `userland/capsule_driver_rtl8169/Capsule.mk:16`, [`userland/capsule_driver_rtl8169/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_rtl8169/src/protocol/ops.rs#L17) |
| `driver.ahci0` | `service:4216:driver.ahci0` | `0xf8019` | healthcheck, controller info, port list | [`userland/capsule_driver_ahci/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/main.rs#L37) | [driver-ahci](/docs/userland/driver-ahci/) | `userland/capsule_driver_ahci/Capsule.mk:14`, `userland/capsule_driver_ahci/Capsule.mk:16`, [`userland/capsule_driver_ahci/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/protocol/ops.rs#L17) |
| `driver.hda0` | `service:4218:driver.hda0` | `0x78019` | healthcheck, controller info, codec mask, stream layout, codec list | [`userland/capsule_driver_hda/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_hda/src/main.rs#L37) | [driver-hda](/docs/userland/driver-hda/) | `userland/capsule_driver_hda/Capsule.mk:14`, `userland/capsule_driver_hda/Capsule.mk:17`, [`userland/capsule_driver_hda/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_hda/src/protocol/ops.rs#L17) |
| `driver.nvme0` | `service:4220:driver.nvme0` | `0xF8019` | healthcheck, controller info, identify controller, identify namespace, SMART health | [`userland/capsule_driver_nvme/src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/main.rs#L39) | [driver-nvme](/docs/userland/driver-nvme/) | `userland/capsule_driver_nvme/Capsule.mk:14`, `userland/capsule_driver_nvme/Capsule.mk:16`, [`userland/capsule_driver_nvme/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/protocol/ops.rs#L17) |
| `driver.usb_hid0` | `service:4222:driver.usb_hid0` | `0x200019` | healthcheck, probe config, feed keyboard report, feed mouse report, poll keys, poll mouse, get state | [`userland/capsule_driver_usb_hid/src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/main.rs#L33) | [driver-usb-hid](/docs/userland/driver-usb-hid/) | `userland/capsule_driver_usb_hid/Capsule.mk:13`, `userland/capsule_driver_usb_hid/Capsule.mk:15`, [`userland/capsule_driver_usb_hid/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/protocol/ops.rs#L17) |
| `driver.usb_msc0` | `service:4224:driver.usb_msc0` | `0x19` | healthcheck, probe config, build inquiry, build read capacity, build read10, build write10, accept CSW, get state | [`userland/capsule_driver_usb_msc/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/main.rs#L32) | [driver-usb-msc](/docs/userland/driver-usb-msc/) | `userland/capsule_driver_usb_msc/Capsule.mk:13`, `userland/capsule_driver_usb_msc/Capsule.mk:18`, [`userland/capsule_driver_usb_msc/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/protocol/ops.rs#L17) |
| `driver.iwlwifi0` | `service:4228:driver.iwlwifi0` | `0xF8019` | healthcheck, device info, firmware info, RF state, DMA state, firmware stage, alive wait | [`userland/capsule_driver_iwlwifi/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_iwlwifi/src/main.rs#L35) | [networking](/docs/subsystems/networking/) | `userland/capsule_driver_iwlwifi/Capsule.mk:12`, `userland/capsule_driver_iwlwifi/Capsule.mk:15`, [`userland/capsule_driver_iwlwifi/src/protocol/ops.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_iwlwifi/src/protocol/ops.rs#L9) |
| `driver.i2c_pci0` | `service:4230:driver.i2c_pci0` | `0x78019` | healthcheck, controller info, register snapshot, timing info, transfer, probe | [`userland/capsule_driver_i2c_pci/src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_pci/src/main.rs#L19) | [driver-i2c-pci](/docs/userland/driver-i2c-pci/) | `userland/capsule_driver_i2c_pci/Capsule.mk:13`, `userland/capsule_driver_i2c_pci/Capsule.mk:16`, [`userland/capsule_driver_i2c_pci/src/protocol/ops.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_pci/src/protocol/ops.rs#L1) |
| `driver.i2c_hid0` | `service:4232:driver.i2c_hid0` | `0x200019` | healthcheck, probe, descriptor | [`userland/capsule_driver_i2c_hid/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/main.rs#L32) | [driver-i2c-hid](/docs/userland/driver-i2c-hid/) | `userland/capsule_driver_i2c_hid/Capsule.mk:12`, `userland/capsule_driver_i2c_hid/Capsule.mk:14`, [`userland/capsule_driver_i2c_hid/src/protocol/ops.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/protocol/ops.rs#L1) |

The `i2c_hid` capsule on this branch is the relative-mouse driver: it posts
relative pointer, wheel, and button events
([`userland/capsule_driver_i2c_hid/src/input/publish.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/publish.rs#L28),
[`userland/capsule_driver_i2c_hid/src/input/publish.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/publish.rs#L31),
[`userland/capsule_driver_i2c_hid/src/input/publish.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/publish.rs#L38)). The full Precision
Touchpad path with absolute coordinates lives on a separate branch and is not in
this tree.

There is a fourteenth display capsule in the source tree,
[driver-bga](/docs/userland/driver-bga/), which is not in the table above
because it is parked. `capsule_driver_bga` has source but no `Capsule.mk`, so it
has no service handle, no port, no capability mask, and no entry in the
build-and-sign system; its README calls it a parked source inventory for a
future brokered BGA display capsule
(`userland/capsule_driver_bga/README.md:5`). Treat it as reference source, not a
shipping driver.

## 3. Server form

NIC drivers run mutable driver state through their server loops after device
construction ([`userland/capsule_driver_e1000/src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_e1000/src/main.rs#L38),
[`userland/capsule_driver_rtl8139/src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_rtl8139/src/main.rs#L35),
[`userland/capsule_driver_rtl8169/src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_rtl8169/src/main.rs#L40),
[`userland/capsule_driver_virtio_net/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_net/src/main.rs#L36)). Storage-class drivers
enter server loops after driver setup or service bootstrap
([`userland/capsule_driver_virtio_blk/src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_virtio_blk/src/main.rs#L30),
[`userland/capsule_driver_ahci/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/main.rs#L37),
[`userland/capsule_driver_nvme/src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_nvme/src/main.rs#L39),
[`userland/capsule_driver_usb_msc/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/main.rs#L32)). Input drivers expose PS/2,
USB HID, and I2C HID event/configuration protocols
([`userland/capsule_driver_ps2_input/src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/protocol/ops.rs#L16),
[`userland/capsule_driver_usb_hid/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/protocol/ops.rs#L17),
[`userland/capsule_driver_i2c_hid/src/protocol/ops.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/protocol/ops.rs#L1)).

## 4. Input driver event path

Input drivers do not send GUI events directly to apps. They normalize hardware
events into `InputEvent` and post them into the kernel input ring. The
`input_router` capsule drains that ring in bounded batches, applies grabs,
routes pointer events through WM hit testing, routes key events through WM focus,
and delivers `NINP` frames to subscribers
([`userland/capsule_input_router/src/sources/kernel_ring.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L17),
[`userland/capsule_input_router/src/sources/kernel_ring.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L25),
[`userland/capsule_input_router/src/sources/kernel_ring.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/sources/kernel_ring.rs#L27),
[`userland/capsule_input_router/src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L30),
[`userland/capsule_input_router/src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L43),
[`userland/capsule_input_router/src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L44),
[`userland/capsule_input_router/src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/runner.rs#L49)).

```
+----------------+
| PS/2 driver    |
| USB HID driver |
| I2C HID driver |
+-------+--------+
        |
+-------+--------+
| mk_input_event |
| post           |
+-------+--------+
        |
+-------+--------+
| kernel ring    |
+-------+--------+
        |
+-------+--------+
| input_router   |
| drain batch    |
+-------+--------+
        |
+-------+--------+
| WM focus and   |
| topmost query  |
+-------+--------+
        |
+-------+--------+
| NINP delivery  |
| app or shell   |
+----------------+
```

The router dispatches grabbed event kinds to the grab holder before normal
routing. Pointer kinds are routed through the pointer path, keyboard kinds
through the keyboard path, and other subscribed kinds are fanned out by
subscription match
([`userland/capsule_input_router/src/route/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L28),
[`userland/capsule_input_router/src/route/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L29),
[`userland/capsule_input_router/src/route/dispatch.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L37),
[`userland/capsule_input_router/src/route/dispatch.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L40),
[`userland/capsule_input_router/src/route/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L43),
[`userland/capsule_input_router/src/route/dispatch.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L61),
[`userland/capsule_input_router/src/route/dispatch.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/dispatch.rs#L65)). Keyboard routing asks
WM for focus and falls back to the shell pid when WM has no focused owner
([`userland/capsule_input_router/src/route/keyboard.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L25),
[`userland/capsule_input_router/src/route/keyboard.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/keyboard.rs#L27)). Pointer routing
refreshes display bounds, applies cursor state, mirrors pointer events to the
shell, queries the topmost target, and routes to the shell or target window
([`userland/capsule_input_router/src/route/pointer/route_pointer.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L28),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L29),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L30),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L31),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L32),
[`userland/capsule_input_router/src/route/pointer/route_pointer.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/pointer/route_pointer.rs#L35)). Delivery
encodes the event into the fixed input envelope and sends it to the target pid
([`userland/capsule_input_router/src/route/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L24),
[`userland/capsule_input_router/src/route/deliver.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L28),
[`userland/capsule_input_router/src/route/deliver.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L29),
[`userland/capsule_input_router/src/route/deliver.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/route/deliver.rs#L30)).

The producer table is written left to right: hardware work, normalized event
kinds, and the exact post or poll point. That is the chain to inspect when a key
or mouse event is missing from the desktop.

```
+--------------------------+
| ps2 pump                 |
+------------+-------------+
             |
+------------+-------------+
| usb hid poll             |
+------------+-------------+
             |
+------------+-------------+
| i2c hid poll             |
+------------+-------------+
             |
+------------+-------------+
| normalized InputEvent    |
+------------+-------------+
             |
+------------+-------------+
| kernel input ring        |
+--------------------------+
```

| Producer | Hardware path | Posted event kinds | Source |
|----------|---------------|--------------------|--------|
| `driver.ps2_kbd0` | Startup retries setup until a driver object is returned, then enters the server loop. Each loop pumps IRQ sequence state, drains PS/2 data, acknowledges keyboard and auxiliary IRQ grants, then services IPC. | Keyboard translation posts key-down and key-up. Mouse publishing posts relative pointer movement, wheel, button-down, and button-up. | Startup at [`userland/capsule_driver_ps2_input/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/main.rs#L31) to [`userland/capsule_driver_ps2_input/src/main.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/main.rs#L45), pump at [`userland/capsule_driver_ps2_input/src/server/pump.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/server/pump.rs#L24) to [`userland/capsule_driver_ps2_input/src/server/pump.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/server/pump.rs#L45), server loop at [`userland/capsule_driver_ps2_input/src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/server/runner.rs#L32) to [`userland/capsule_driver_ps2_input/src/server/runner.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/server/runner.rs#L73), keyboard post at [`userland/capsule_driver_ps2_input/src/keymap/post.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/keymap/post.rs#L18) to [`userland/capsule_driver_ps2_input/src/keymap/post.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/keymap/post.rs#L31), mouse post at [`userland/capsule_driver_ps2_input/src/mouse/post.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/mouse/post.rs#L24) to [`userland/capsule_driver_ps2_input/src/mouse/post.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ps2_input/src/mouse/post.rs#L52). |
| `driver.usb_hid0` | Startup initializes heap, waits until the xHCI service can be resolved, enumerates connected xHCI ports, then polls HID endpoints and rescans when no endpoints are present for the rescan interval. | Keyboard publishing posts key-down and key-up with modifier flags and mapped special keys. Mouse publishing posts relative pointer movement, wheel, button-down, and button-up. | Startup at [`userland/capsule_driver_usb_hid/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/main.rs#L32) to [`userland/capsule_driver_usb_hid/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/main.rs#L37), xHCI lookup at [`userland/capsule_driver_usb_hid/src/orchestrator/run.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/run.rs#L19) to [`userland/capsule_driver_usb_hid/src/orchestrator/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/run.rs#L28), enumeration at [`userland/capsule_driver_usb_hid/src/orchestrator/enumerate/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/enumerate/run.rs#L25) to [`userland/capsule_driver_usb_hid/src/orchestrator/enumerate/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/enumerate/run.rs#L36), poll loop at [`userland/capsule_driver_usb_hid/src/orchestrator/poll/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/poll/run.rs#L26) to [`userland/capsule_driver_usb_hid/src/orchestrator/poll/run.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/orchestrator/poll/run.rs#L44), keyboard post at [`userland/capsule_driver_usb_hid/src/hid/post_key.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_key.rs#L32) to [`userland/capsule_driver_usb_hid/src/hid/post_key.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_key.rs#L66), mouse post at [`userland/capsule_driver_usb_hid/src/hid/post_mouse.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_mouse.rs#L24) to [`userland/capsule_driver_usb_hid/src/hid/post_mouse.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_mouse.rs#L49), shared post at [`userland/capsule_driver_usb_hid/src/hid/post_wire.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_wire.rs#L19) to [`userland/capsule_driver_usb_hid/src/hid/post_wire.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/src/hid/post_wire.rs#L22). |
| `driver.i2c_hid0` | Startup resolves the I2C controller, probes the bus for a HID descriptor, records address, descriptor length, input register, and input report length, then the server loop polls input after every receive timeout. | Parsed mouse samples post relative pointer movement, wheel, button-down, and button-up. | Startup at [`userland/capsule_driver_i2c_hid/src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/main.rs#L31) to [`userland/capsule_driver_i2c_hid/src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/main.rs#L39), setup at [`userland/capsule_driver_i2c_hid/src/setup.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/setup.rs#L5) to [`userland/capsule_driver_i2c_hid/src/setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/setup.rs#L19), server poll point at [`userland/capsule_driver_i2c_hid/src/server/runner.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/server/runner.rs#L15) to [`userland/capsule_driver_i2c_hid/src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/server/runner.rs#L33), I2C read and report parse at [`userland/capsule_driver_i2c_hid/src/input/poll.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/poll.rs#L22) to [`userland/capsule_driver_i2c_hid/src/input/poll.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/poll.rs#L34), event publishing at [`userland/capsule_driver_i2c_hid/src/input/publish.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/publish.rs#L25) to [`userland/capsule_driver_i2c_hid/src/input/publish.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/publish.rs#L45), shared post at [`userland/capsule_driver_i2c_hid/src/input/post.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/post.rs#L19) to [`userland/capsule_driver_i2c_hid/src/input/post.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_i2c_hid/src/input/post.rs#L30). |

## 6. Security analysis

Every one of the eighteen drivers is a ring-3 capsule, and not one of them runs in the kernel. The
kernel owns no keyboard controller, no NIC ring, no NVMe queue; it owns the [hardware
broker](/docs/subsystems/hardware-broker/), the input ring, and the capability check, and it lends
the hardware to a capsule that asks correctly. A driver reaches its device through four broker grants,
each a separate call checked against the same claim epoch and each revoked when the capsule exits:
[claim](/docs/subsystems/hardware-broker/claim/) takes exclusive ownership of the device and returns the
epoch, [mmio](/docs/subsystems/hardware-broker/mmio/) maps a slice of a BAR into the capsule's address
space, [irq](/docs/subsystems/hardware-broker/irq/) binds the device line to a kernel-delivered
notification, and [dma](/docs/subsystems/hardware-broker/dma/) hands back a DMA-coherent buffer, with a
fifth path, [pio](/docs/subsystems/hardware-broker/pio/), minting a kernel-mediated `in`/`out` window
against a port BAR. A driver holds exactly the subset of these its device needs and nothing more.

The mask is where that least-privilege split is written down, and it decodes exactly to the grants a
device requires (bits from [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs)). The masks in the table above are not
interchangeable; each is the smallest set for its bus:

| Mask | Capabilities beyond CoreExec/IPC/Memory | Drivers |
|------|-----------------------------------------|---------|
| `0x19` | none | `usb_msc` |
| `0x200019` | InputSource | `usb_hid`, `i2c_hid` |
| `0x78019` | DeviceEnum, Driver, Mmio, Irq | `hda`, `i2c_pci` |
| `0xf8019` | DeviceEnum, Driver, Mmio, Irq, Dma | `ahci`, `xhci`, `nvme`, `e1000`, `rtl8169`, `iwlwifi` |
| `0x1D8019` | DeviceEnum, Driver, Irq, Dma, Pio | `rtl8139` |
| `0x1F8019` | DeviceEnum, Driver, Mmio, Irq, Dma, Pio | `virtio_rng`, `virtio_blk`, `virtio_net` |
| `0x1F9019` | DeviceEnum, Driver, Mmio, Irq, Dma, Pio, GraphicsSurfaceCreate | `virtio_gpu` |
| `0x358019` | DeviceEnum, Driver, Irq, Pio, InputSource | `ps2_kbd` |

Several properties are worth reading straight off that table. The HID drivers, `usb_hid` and `i2c_hid`,
hold `InputSource` and nothing else in the hardware column: they carry no Mmio, no Irq, no Dma, no Pio,
because they reach their hardware through another capsule (the xHCI driver and the i2c bus driver
respectively) over IPC. A compromised HID report parser, which is the most complex and most exposed code
in the input path, cannot map a register, take an interrupt, or program DMA; the worst it can do is post
forged input events, which are bounded by the ring. The inverse is `i2c_pci`: it has Mmio and Irq but
*not* InputSource, so the capsule that drives the controller registers cannot inject a keystroke. The
right to touch the hardware and the right to produce input are held by different capsules on purpose,
which is the [input drivers](/docs/subsystems/input/drivers/) page in one sentence. `usb_msc` is the
extreme case, mask `0x19`, the three baseline bits and no hardware capability at all, because it builds
SCSI command blocks and hands them to the xHCI driver rather than touching a controller itself.

`Dma` is the capability to watch, and the split between `0x78019` and `0xf8019` is exactly the line
between devices that bus-master and devices that do not. `hda` and `i2c_pci` get Mmio and Irq but no
Dma; AHCI, the NICs, NVMe, xHCI, and iwlwifi get Dma because they move data through descriptor rings in
RAM. The [broker's DMA grant](/docs/subsystems/hardware-broker/dma/) bounds what a *capsule* may allocate
and program (a per-class page ceiling, a zero-scrub before the frames leave the kernel, and an epoch
check against use-after-release), but it is honest about the one bound it does not enforce: the IOMMU
backend is behind the `nonos-arch-iommu` feature and is not engaged in the shipping builds, so the
address the broker returns is a raw physical address and a device programmed by a driver can in principle
DMA to any physical page regardless of the grant. DMA safety therefore rests on the software bounds plus
the assumption of non-malicious device hardware, and this is the same boundary every DMA-capable driver
in the table inherits. The storage drivers reach the [block device](/docs/subsystems/storage/block-device/)
layer and ultimately the [vfs capsule](/docs/subsystems/storage/vfs-capsule/) above them, none of which
gains the driver any authority the mask did not already grant.

## 7. Debugging

The drivers are instrumented so that a machine which boots with a dead device names the stage that
failed rather than going silent. The debugging follows the spawn, then the grant, then the device, in
that order.

The first question is whether the driver capsule loaded. Every driver is spawned through
`super::boot::capsule(prefix, ...)` in its spawn-plan group
([`src/userspace/init/spawn_plan/drivers_storage.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs), `drivers_nic.rs`, `drivers_usb.rs`,
`drivers_bus.rs`, `drivers_input.rs`, `drivers_virtio.rs`), which routes to `capsule_boot::boot`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)) and prints `boot_log::ok(prefix, "capsule spawned")` on
success or `boot_log::error(...)` on failure. So a live driver prints a line naming it: `[DRIVER-AHCI]`,
`[DRIVER-NVME]`, `[DRIVER-HDA]`, `[DRIVER-PS2-INPUT]`, and the rest, each followed by `capsule spawned`.
If that line is absent the capsule never ran: its ELF failed signature verification or its manifest asked
for a capability outside policy, and the spawn was refused before any driver code executed. This is the
same marker the [input drivers](/docs/subsystems/input/drivers/) page uses to answer "did the driver even
load."

If the driver spawned but the device is dead, the next stage is the broker grant, and the broker prints
its own markers as it hands hardware over. An MMIO map walks through `[MMIO] claim`, `[MMIO] device`,
`[MMIO] reserve`, `[MMIO] va`, `[MMIO] map`, and `[MMIO] record`
([`src/hardware/broker/mmio/map.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/mmio/map.rs)), so a driver that spawned but never reached `[MMIO] record` for its
device failed partway through the map. A DMA grant prints `[DMA]` lines and names the exact failure class
when it refuses ([`src/hardware/broker/dma/map/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/dma/map/mod.rs)): `[DMA] validate not-claimed` means the driver
asked for DMA on a device it never claimed, `[DMA] validate stale-epoch` means its claim lapsed and was
re-taken, `[DMA] validate bad-length-class` means the request exceeded the per-class ceiling, and
`[DMA] alloc no-memory` means the physical frames were not available. These distinguish a driver bug
(asking wrong) from a resource problem (nothing free) without reading the driver's code. The claim
itself is the gate before any of these: a claim is refused with `AlreadyClaimed`
([`src/hardware/broker/claim.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/claim.rs#L51)) when another capsule already holds the device, so two drivers
contending for one device shows up as the second one never getting past claim.

If the grant succeeded but nothing happens, the failure has moved to the device or its interrupt, and
the distinction is between enumeration and drive. Whether the firmware exposed the device at all is a
broker-table question, separate from whether a driver spawned: a device absent from the broker's device
table is a firmware or ACPI problem, not a driver defect, and the device-census tooling described on the
[input drivers](/docs/subsystems/input/drivers/) page renders that table so the two can be told apart
before any driver is blamed. An enumerated device with a spawned driver that still produces nothing is
usually the interrupt: the [irq grant](/docs/subsystems/hardware-broker/irq/) bound the line but the line
never fires, which on real hardware is typically GSI-to-vector routing through the IOAPIC rather than a
driver fault. For the input drivers specifically, the producer table in section 4 above lists the exact
poll and post points to inspect when a key or mouse event goes missing, and the
[input drivers](/docs/subsystems/input/drivers/) page covers isolating the kernel ring from the driver
with a synthetic-event probe.
