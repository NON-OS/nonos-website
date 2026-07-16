---
title: "The BGA Display Capsule"
description: "capsuledriverbga is the Bochs Graphics Adapter (BGA) display capsule in the NØNOS tree: a userland capsule that claims the QEMU/Bochs standard-VGA PCI device, sets a linear-fram..."
weight: 400
---
`capsule_driver_bga` is the Bochs Graphics Adapter (BGA) display capsule in the NØNOS tree: a userland
capsule that claims the QEMU/Bochs standard-VGA PCI device, sets a linear-framebuffer mode through the
VBE DISPI register interface, and paints a solid clear colour into the framebuffer. It is a
scanout-provider peer to the GOP and virtio-gpu paths, and it is the simplest of the three: one PCI
device, two MMIO BARs, four register writes to set a mode, and a linear 32-bit framebuffer. It reaches
hardware exclusively through the [hardware broker](/docs/subsystems/hardware-broker/), never
through kernel driver code ([`userland/capsule_driver_bga/Cargo.toml:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_bga/Cargo.toml#L5)).

Read the status first, because it shapes everything below. This capsule is parked. It has no
`Capsule.mk`, so it has no service handle, no service or reply port, no capability mask, and no entry in
the build-and-sign system; its own crate README calls it a parked source inventory for a future brokered
BGA display capsule (`userland/capsule_driver_bga/README.md:5`). There is no `make` target for it and no
production profile spawns it. What the source does do, end to end, is a real one-shot bring-up: discover,
claim, bus-master, map both BARs, set the mode, clear the screen, and then park in a yield loop
([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). This folder documents exactly that, and marks every gap between the code and a
production driver where it exists.

The documentation mirrors the source structure so a page can be read beside the folder it describes.
Because the capsule is small, the split is deliberately shallow: two behaviour pages, plus contributing
and debugging.

## Identity

There is no `Capsule.mk` in this capsule, so the identity fields that name and reach a production driver
do not exist yet. What identity the capsule has comes from its `Cargo.toml` and its source constants.

| Field | Value | Source |
|---|---|---|
| Crate name | `nonos_capsule_driver_bga` | `Cargo.toml:11` |
| Binary name | `driver_bga` | `Cargo.toml:20` |
| Capsule slug | none (no `Capsule.mk`) | `userland/capsule_driver_bga/` has no `Capsule.mk` |
| Service handle | none while parked | `README.md:15` |
| Service endpoint | none while parked | `README.md:15` |
| Reply endpoint | none while parked | `README.md:15` |
| Capability mask | not declared (no `CAPSULE_REQUIRED_CAPS`) | `README.md:9`, `README.md:63` |
| Kernel mirror | none | no `src/*/bga*` tree exists |
| PCI identity it matches | vendor `0x1234`, device `0x1111`, class `0x03` | [`src/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L17) |

Because there is no manifest, there is no capability mask to decompose. What a promoted version would
need is spelled out by its sibling, the virtio-gpu driver, whose manifest declares
`CAPSULE_REQUIRED_CAPS := 0x1F9019` for `CoreExec | IPC | Memory | GraphicsSurfaceCreate | DeviceEnum |
Driver | Mmio | Irq | Dma | Pio` (`userland/capsule_driver_virtio_gpu/Capsule.mk:16`). The BGA capsule
uses a strict subset of the broker syscalls (no IRQ, no DMA, no PIO, no surface), so the capabilities its
code actually exercises are exactly these five, each decomposed against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec       bit()      1     types.rs:56    the capsule runs at all
  0x08000  DeviceEnum     bit()  32768     types.rs:71    mk_device_list          (discover.rs:34)
  0x10000  Driver         bit()  65536     types.rs:72    mk_device_claim/release, mk_pci_config_write
  0x20000  Mmio           bit() 131072     types.rs:73    mk_mmio_map / mk_mmio_unmap
  ------
  (IPC 0x8 and Memory 0x10 would also be needed once it serves clients and owns a heap)
```

The `DeviceEnum` / `Driver` / `Mmio` split is the broker's own vocabulary: `DeviceEnum` is
enumerate-only, `Driver` lets a capsule claim and release a device, and `Mmio` lets a claim holder map a
BAR slice into its own address space ([`src/capabilities/types.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L35)). The BGA source touches no IRQ, DMA,
or PIO wrapper, so a promoted manifest would not carry `Irq` (0x40000), `Dma` (0x80000), or `Pio`
(0x100000).

## The two behaviour pages

The source under `userland/capsule_driver_bga/src/` splits into a broker bring-up half (`setup/`,
`discover.rs`, `handles.rs`) and a DISPI half (`dispi/`, `regs.rs`). The two pages follow that split.
Data flows in one direction: `bring-up` obtains the two mapped BARs, then `mode-set` writes the register
BAR and fills the framebuffer BAR.

```
  discover -> claim -> bus-master -> map regs -> map fb  ||  set_mode -> clear
  ---------------- bring-up.md -----------------          ||  --- mode-set.md ---
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [bring-up.md](/docs/userland/driver-bga/bring-up/) | `src/setup/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs) | The one-shot bring-up sequence: PCI discovery and the match filter, the exclusive claim and epoch, the single Bus Master Enable write, mapping the register and framebuffer BARs, and RAII teardown. |
| [mode-set.md](/docs/userland/driver-bga/mode-set/) | `src/dispi/`, [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs), [`src/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs) | The DISPI mode-set path: the index-addressed register model, the disable/xres/yres/bpp/enable sequence, the linear-framebuffer bit, and the solid-colour framebuffer clear. |
| [contributing.md](/docs/userland/driver-bga/contributing/) | the whole tree | How the capsule would be promoted to a real display driver: adding a `Capsule.mk`, a service, and the generated make targets, plus the code standards a change must keep. |
| [debugging.md](/docs/userland/driver-bga/debugging/) | runtime | The failure modes: no device match, a broker call rejected, wrong resolution, and a garbled fill from the stride assumption. |

## Overview

The capsule is `no_std`/`no_main`. `_start` runs the one-shot setup sequence and, on success, keeps the
resulting `Driver` alive and parks the capsule in a `mk_yield` loop; on failure it exits with a code
derived from the error ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). Holding the `Driver` alive is what keeps the display up: the
`Driver` owns the broker grants, and dropping it would unmap the framebuffer and release the device, so
the yield loop is load-bearing, not idle ([`src/setup/driver.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L19), [`src/handles.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L31)).

Setup is the whole capsule. `setup::run` discovers the BGA PCI function, claims it, enables PCI bus
mastering, maps the register BAR and then the framebuffer BAR, sets a 1024x768x32 linear-framebuffer
mode through the DISPI registers, clears the framebuffer to a solid colour, and returns a `Driver` that
records the framebuffer virtual address, the resolution, and the stride ([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)).
There is no request loop after that, because there is no service endpoint: unlike the storage and input
driver capsules, this one does not serve clients over IPC. It brings the panel up once and then parks.
The [bring-up](/docs/userland/driver-bga/bring-up/) page walks the sequence step by step.

The mode is fixed. Width, height, and bit depth are compile-time constants (1024x768, 32bpp), not
parameters a client selects, and the clear colour is a constant as well ([`src/constants.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L33)). This is
the honest shape of a bring-up capsule: it proves the DISPI path and the two BAR mappings on real or
emulated hardware, and a promoted version would add the client protocol and the mode negotiation that are
absent today. The [mode-set](/docs/userland/driver-bga/mode-set/) page documents the register writes that program that mode.

There are no client operations. This capsule has no opcodes, no request or reply layout, and no wire
format, because it registers no service and runs no request loop ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33); there is no `server`
module and no IPC call anywhere in `src/`). It speaks only the broker syscall ABI. Errors are a
two-variant enum mapped to process exit codes, since there is no reply channel to carry a status
([`src/error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L17)): `DeviceNotFound` exits `2` (`error.rs:27`) and `BrokerCallFailed(rc)` exits `3`
(`error.rs:28`). The raw negative broker return code is carried inside the error value but collapsed away
by `exit_code`, so the specific rc is visible only if the setup call is traced, not in the exit status
(`error.rs:20`, `error.rs:25`).

## Security posture

The BGA capsule is a userland driver with no ambient authority. Everything it can touch, it touches
through a broker grant that the kernel checks against a claim it holds, and it holds nothing beyond one
display device and two mappings of that device's own BARs.

The claim is exclusive and epoch-stamped. `mk_device_claim` refuses a device another capsule already
holds, and the epoch it returns is quoted on every later grant and re-checked, so a stale grant from a
prior ownership cannot be replayed after the device changes hands
([device claim](/docs/subsystems/hardware-broker/claim/)). The BGA capsule threads that epoch through
the bus-master write and both MMIO maps ([`src/setup/pci.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L22), [`src/setup/mmio.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L23)), so all three
grants are bound to the same claim.

The MMIO mappings are bounded by construction. The broker computes the physical range from the kernel's
device table, not from the request, checks it lies inside the BAR, maps it uncached, no-execute,
read-write, adds a guard page between grants, and withholds any MSI-X table page
([MMIO grants](/docs/subsystems/hardware-broker/mmio/)). So even though the capsule writes raw 16-bit
values into the register BAR and raw 32-bit values into the framebuffer BAR, it can only reach memory
inside two BARs of a device it claims; a bug in the mode-set sequence or the clear loop cannot walk into
another device's registers or into RAM, and the no-execute attribute means the writable framebuffer is
not a code-injection path.

The PCI configuration authority is a single bit. The broker only accepts a `mk_pci_config_write` into
the Command register's Bus Master Enable bit (or the MSI-X control bits, which this capsule never
touches); every other offset and bit pattern is rejected ([`userland/libc/src/broker/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/broker/pci.rs#L17)). So the
capsule cannot reprogram BARs, move the device, or change its command word beyond enabling bus mastering.

The honest caveat is the same as the status caveat. Because there is no manifest, the capsule is not
enrolled and not spawned in any production profile today, so this posture describes the authority the code
would exercise once promoted, bounded by the broker, not authority it is granted on a shipping image
(`README.md:17`, `README.md:27`).

## Lifecycle

A promoted capsule would be spawned through [verified spawn](/docs/security/capsules-and-trust/): its
signature and attestation checked, its requested capabilities held against its manifest ceiling, and only
then its ELF mapped. This capsule has no manifest and no spawn-plan entry, so no production profile spawns
it; the only way to run it today is a direct build of the crate (see [contributing](/docs/userland/driver-bga/contributing/)).
When it does run, its lifecycle is entirely `setup::run` followed by the park loop: there is no service
registration, no request loop, and no shutdown handler beyond the RAII drop that fires if the `Driver` is
ever released ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33), [`src/handles.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs#L31)).

## Source map

```
  userland/capsule_driver_bga/src/main.rs         _start -> setup::run, then park in mk_yield
  userland/capsule_driver_bga/src/setup/          the one-shot bring-up (see bring-up.md)
  userland/capsule_driver_bga/src/discover.rs     find_bga: PCI vendor/device/class + two-MMIO-BAR match
  userland/capsule_driver_bga/src/handles.rs      BrokerHandles: unmap both BARs and release on drop
  userland/capsule_driver_bga/src/dispi/          the DISPI mode-set and clear (see mode-set.md)
  userland/capsule_driver_bga/src/regs.rs         Regs: volatile 16-bit register accessors
  userland/capsule_driver_bga/src/error.rs        BgaError, exit_code
  userland/capsule_driver_bga/src/constants.rs    PCI identity, BAR indices, DISPI indices, mode, clear colour
  userland/capsule_driver_bga/Cargo.toml          crate and binary name, panic=abort
  userland/capsule_driver_bga/README.md           the crate README: parked status and the promotion checklist
  src/capabilities/types.rs                       the capability bits a promoted manifest would declare
  userland/capsule_driver_virtio_gpu/Capsule.mk   the sibling driver's manifest, as the promotion model
  docs/subsystems/hardware-broker/                the claim, mmio, and pio grant contracts
```

Every reference above is verified against those trees.
