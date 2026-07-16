---
title: "Contributing to capsule_driver_e1000"
description: "This page is for a contributor who wants to change the e1000 driver."
weight: 7
---
This page is for a contributor who wants to change the e1000 driver. It covers where the source lives, which
folder owns which concern, the exact steps to add a client op or a register, how to build and sign the
capsule, and the code standards a change has to meet. For what the driver does and how it fits together, read
the [README](/docs/userland/driver-e1000/), the [operations](/docs/userland/driver-e1000/operations/) page, the [bring-up](/docs/userland/driver-e1000/bring-up/) page, and the
[queues](/docs/userland/driver-e1000/queues/) page.

## Where the source lives

The capsule is at `userland/capsule_driver_e1000/`. It is a `no_std`/`no_main` capsule: `_start` initialises
the heap, runs `setup::run` to take the broker grants, runs `init::bring_up` to program the hardware, and
hands the built `Driver` to `server::run`, which loops forever ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38)). The top-level modules are
declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NE10` wire format: header, ops, errno, limits, decode and encode | you change the request or reply layout |
| `src/server/` | the request loop and one handler per op | you add or change a client op |
| `src/setup/` | the broker handshake: discover, claim, MMIO, IRQ, four DMA grants, and teardown | you change a grant or the rollback order |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | the `mk_device_list` scan and the Intel NIC match | you change how the device is found or add a device id |
| `src/init/` | reset, link, EEPROM MAC, receive-address filter, RX and TX programming | you change hardware bring-up |
| `src/queue/` | the descriptor layout and the RX/TX ring cursors | you change the ring mechanics |
| [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs) | the volatile 32-bit MMIO accessor over BAR0 | you change how registers are read or written |
| `src/constants/` | register offsets, control/status bits, PCI ids, ring sizing | you touch a register offset, a bit, or a size |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L23) and re-export it from [`src/protocol/mod.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L34); if it
   carries a fixed payload, add its length to [`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that encodes the
   response header, writes the status word, and sends with `mk_ipc_send`, following `link_status.rs` (a live
   register read) or `mac_address.rs` (a cached read). A status-only op can delegate to `reply_with_status`
   ([`src/server/error.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L27)). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L60).

If the op is meant for the kernel-side network client, it also needs a client method and an op constant in
the mirror at [`src/hardware/e1000_capsule/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/protocol/ops.rs); the header wire constants are shared and drift
surfaces there as a protocol mismatch ([`src/hardware/e1000_capsule/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/protocol/header.rs#L17)).

## Adding a register or a device id

A new register offset goes in [`src/constants/regs.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L24) and its bit fields in [`src/constants/status.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/status.rs#L17),
matching the 82540EM / 82545EM naming already used there. Read or write it through the `Regs` accessor
([`src/regs.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L41)), never with a raw pointer, so the volatile access and the BAR0 base stay in one place. A
new e1000-class device id goes in the `E1000_DEVICE_IDS` table ([`src/constants/pci.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L19)); discovery matches
against it automatically.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:7`) and pulled in through `userland/capsule_driver_e1000/Capsule.mk:22`.

```
  make nonos-mk-driver-e1000              build the capsule ELF
  make nonos-mk-driver-e1000-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-driver-e1000-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-e1000-keys   assert the per-capsule signing keys exist
```

For a kernel image that embeds and spawns the driver, `make nonos-mk-driver-e1000-prod` builds the
`microkernel-driver-e1000` profile with the signed e1000 artifacts baked in (`Makefile:990`). The embed pulls
the ELF, id cert, manifest, and attestation trailer into the kernel image only when the
`nonos-capsule-driver-e1000` feature is set ([`src/hardware/e1000_capsule/embed.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/e1000_capsule/embed.rs#L23)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every bring-up path returns a `&'static str`
  error the entry point maps to an exit code, and every request path returns an errno word; the release
  profile is `panic = "abort"` (`Cargo.toml:29`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and setup phases are one
  file each under `src/setup/`, matching the existing tree. `mod.rs` is used only for module declarations and
  re-exports.
- Every setup phase must roll back in reverse order on failure. Each intermediate step releases the grants it
  already holds before returning the error ([`src/setup/mmio.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L34), [`src/setup/irq.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L30)), the DMA phase
  funnels through `rollback::after` ([`src/setup/rollback.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L25)), and `Driver::release` is the full
  reverse-order teardown ([`src/setup/driver.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L49)).
- Every `unsafe` block that touches MMIO or DMA memory carries a `SAFETY` note tying the access back to the
  broker grant that guarantees the mapping, matching the notes already in [`src/regs.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L35) and the init and
  queue files.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_e1000/src/main.rs                _start -> setup::run -> init::bring_up -> server::run; module list
  userland/capsule_driver_e1000/src/protocol/ops.rs        the opcode constants
  userland/capsule_driver_e1000/src/protocol/limits.rs     the fixed payload lengths
  userland/capsule_driver_e1000/src/protocol/mod.rs        the protocol re-exports
  userland/capsule_driver_e1000/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_driver_e1000/src/server/runner.rs       the dispatch match and the envelope check
  userland/capsule_driver_e1000/src/server/error.rs        reply_with_status
  userland/capsule_driver_e1000/src/setup/rollback.rs      the reverse-order grant teardown
  userland/capsule_driver_e1000/src/setup/driver.rs        Driver::release
  userland/capsule_driver_e1000/src/regs.rs                the Regs accessor
  userland/capsule_driver_e1000/src/constants/regs.rs      the register offsets
  userland/capsule_driver_e1000/src/constants/status.rs    the control/status bit fields
  userland/capsule_driver_e1000/src/constants/pci.rs       the Intel vendor id and the e1000 device table
  userland/capsule_driver_e1000/Cargo.toml                 panic = "abort" and the binary name
  userland/capsule_driver_e1000/Capsule.mk                 slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                      the nonos-mk-driver-e1000[-sign|-verify] target template
  src/hardware/e1000_capsule/embed.rs                      the feature-gated kernel embed
  Makefile                                                 the -prod image target
```

Every reference above is verified against those trees.
