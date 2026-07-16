---
title: "Contributing to capsule_driver_bga"
description: "This page is for a contributor who wants to work on the BGA capsule, or to promote it from a parked source inventory into a real, signed, brokered display capsule."
weight: 4
---
This page is for a contributor who wants to work on the BGA capsule, or to promote it from a parked source
inventory into a real, signed, brokered display capsule. It covers where the source lives, which folder
owns which behaviour, the exact steps promotion takes, and the code standards a change must keep. For what
the capsule does and how it is put together, read the [README](/docs/userland/driver-bga/), the [bring-up](/docs/userland/driver-bga/bring-up/),
and the [mode-set](/docs/userland/driver-bga/mode-set/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_bga/`. It is a `no_std`/`no_main` binary: `_start` runs the
one-shot `setup::run` and, on success, parks in a `mk_yield` loop holding the resulting `Driver`
([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). There is no app skeleton and no runtime, because the capsule serves no clients; the
whole capsule is the setup sequence plus the park.

## Module map

| Folder or file | Owns | Touch it when |
|---|---|---|
| [`src/setup/sequence.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs) | the ordered bring-up (discover, claim, bus-master, map x2, mode-set, clear) | you change the bring-up order or add a step |
| [`src/setup/claim.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs) | `mk_device_claim` and the epoch | you change how the device is claimed |
| [`src/setup/pci.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs) | the single Bus Master Enable write | you change the PCI config authority the capsule uses |
| [`src/setup/mmio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs) | mapping a BAR, releasing on failure | you change how a BAR is mapped |
| [`src/setup/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs) | `Driver`: the RAII-owning result | you add state the capsule keeps alive |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | the PCI match filter | you support a different display device or BAR layout |
| `src/dispi/` | the mode-set, the clear, the offset helper | you change the mode-set or the framebuffer fill |
| [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs) | the volatile register accessors | you change how registers are read or written |
| [`src/handles.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles.rs) | RAII broker teardown | you change what is unmapped or released on drop |
| [`src/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs) | the error type and exit codes | you add a failure case |
| [`src/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs) | every device id, register index, and mode constant | you change the device match, the mode, or the clear colour |

## Promoting it to a real capsule

The capsule is parked because it has no `Capsule.mk`, so it has no slug, no service, no capability mask,
and no build-and-sign entry (`README.md:5`). There are no `make` targets for it today: a grep of the
`Makefile` and `nonos-mk/` finds no `driver-bga` or `driver_bga` slug, so do not cite one that does not
exist yet. The only build the current source supports is a direct `cargo build` of the crate. Promotion is
four steps.

1. **Add a `Capsule.mk`.** Declare the slug, handle, domain, capsule directory, binary name, feature,
   namespace, service and reply endpoints, and `CAPSULE_REQUIRED_CAPS`, then let `nonos-mk/capsule.mk`
   generate the per-slug targets. The virtio-gpu driver is the working model: its manifest sets
   `CAPSULE_SLUG := driver-virtio-gpu`, `CAPSULE_SERVICE_ENDPOINT`, `CAPSULE_REPLY_ENDPOINT`, and
   `CAPSULE_REQUIRED_CAPS := 0x1F9019` (`userland/capsule_driver_virtio_gpu/Capsule.mk:5`,
   `userland/capsule_driver_virtio_gpu/Capsule.mk:16`). The generated rules come from the
   `NONOS_CAPSULE_RULES` template evaluated per slug (`nonos-mk/capsule.mk:156`,
   `nonos-mk/capsule.mk:272`); once the manifest exists, the pattern mints `nonos-mk-driver-bga`,
   `nonos-mk-driver-bga-sign`, `nonos-mk-driver-bga-verify`, and `nonos-mk-check-driver-bga-keys`
   (the `.PHONY` line at `nonos-mk/capsule.mk:158`).

2. **Set `CAPSULE_REQUIRED_CAPS` to what the code exercises, and no more.** The BGA source uses five
   capability bits: `CoreExec` (`0x1`), `DeviceEnum` (`0x8000`), `Driver` (`0x10000`), `Mmio` (`0x20000`),
   and, once it serves clients and owns a heap, `IPC` (`0x8`) and `Memory` (`0x10`), decomposed against
   [`src/capabilities/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L56). Do not add `Irq` (`0x40000`), `Dma` (`0x80000`), or `Pio` (`0x100000`):
   the source touches no IRQ, DMA, or PIO wrapper, so those bits would be authority the code never uses.
   This is where the BGA manifest diverges from virtio-gpu, whose mask carries all three because that
   driver does use them.

3. **Register a signed spawn path.** Add a kernel spawn mirror and a spawn-plan entry so the capsule is
   verified and enrolled at spawn like every other capsule, then regenerate the trust artifacts. Without
   this, no production profile spawns it, which is the second half of why it is parked today
   (`README.md:17`).

4. **Add the client protocol and mode negotiation.** The fixed 1024x768x32 mode is a compile-time constant
   ([`src/constants.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L33)), and the capsule serves no clients. A promoted display capsule would register a
   service endpoint, accept surface and mode requests, and turn that constant into a negotiated mode, so
   the driver becomes a scanout provider rather than a one-shot bring-up.

## Code standards

These are the standards the capsule already meets, and a change must keep them.

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. `setup::run` returns a `BgaResult` and
  `_start` maps the error to an exit code ([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34), [`src/error.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error.rs#L25)); the release profile is
  `panic = "abort"` (`Cargo.toml:27`).
- One unit per file. Each bring-up step, each DISPI step, and each type lives in its own file, and `mod.rs`
  is used only for re-exports ([`src/setup/mod.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L23), [`src/dispi/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/mod.rs#L21)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_bga/src/main.rs             _start -> setup::run, then park in mk_yield
  userland/capsule_driver_bga/src/setup/              the bring-up steps (see bring-up.md)
  userland/capsule_driver_bga/src/dispi/              the mode-set and clear (see mode-set.md)
  userland/capsule_driver_bga/src/constants.rs        the mode constants a promoted version would negotiate
  userland/capsule_driver_bga/Cargo.toml              crate and binary name, panic=abort
  src/capabilities/types.rs                           the capability bits a promoted manifest would declare
  userland/capsule_driver_virtio_gpu/Capsule.mk       the sibling driver's manifest, as the promotion model
  nonos-mk/capsule.mk                                 the per-slug target template promotion would enable
```

Every reference above is verified against those trees.
