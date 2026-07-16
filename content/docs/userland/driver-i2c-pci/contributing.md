---
title: "Contributing to capsule_driver_i2c_pci"
description: "This page is for a contributor who wants to change the driver."
weight: 4
---
This page is for a contributor who wants to change the driver. It covers where the source lives, which
folder owns which behaviour, the steps to add a controller or an operation, how to build and sign the
capsule, and the code standards a change has to meet. For what the driver does and how it is put together,
read the [README](/docs/userland/driver-i2c-pci/), the [operations](/docs/userland/driver-i2c-pci/operations/), the [bring-up](/docs/userland/driver-i2c-pci/bring-up/), and the
[transfer engine](/docs/userland/driver-i2c-pci/transfer-engine/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_i2c_pci/`. It is a `no_std`/`no_main` app: `_start` inits the
heap, runs `setup::run` once, and on success hands the `Driver` to `server::run`; a bring-up failure
exits 1 ([`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)). The top-level modules are declared there ([`src/main.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L8)).

## Module map

| Folder or file | Owns | Touch it when |
|---|---|---|
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | PCI enumeration and the Intel/PCI match | you add a controller or change the match rule |
| [`src/constants/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs) | the PCI-id table and the DesignWare register offsets and bits | you add an id range or a register |
| `src/setup/` | the bring-up sequence: claim, mmio, irq | you change how a broker grant is taken or unwound |
| `src/init/` | the DesignWare reset and the SCL clock program | you change the reset or the clock math |
| `src/protocol/` | the `NI2C` wire format: header, ops, errno, limits, decode, encode | you change the wire or add an opcode constant |
| `src/server/` | the receive loop and the per-op handlers under `handlers/` | you change dispatch or a handler |
| `src/transaction/` | the transfer engine, split into `control/`, `engine/`, `types/` | you change how a bus transaction runs |
| [`src/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs), [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs) | the runtime state and the volatile register accessor | rarely |

## Adding a controller

To support another Intel LPSS I2C function, extend the PCI-id match in `device_info` with the new id or
id range and its source clock ([`src/constants/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L28)). Discovery and bring-up pick it up with no
other change: `find_controller` already gates on `device_info` returning `Some`
([`src/discover.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L44), `discover.rs:64`), and the clock program derives its counts from whatever source
clock the table returns ([`src/init/scl.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/scl.rs#L44)). This only helps a PCI-enumerated controller; an
ACPI-only controller needs discovery work, which is the named gap in [bring-up.md](/docs/userland/driver-i2c-pci/bring-up/).

## Adding an operation

The four fixed-width read operations share a shape, and adding one is four edits.

1. Define the opcode constant in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and re-export it from [`src/protocol/mod.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L13).
2. Write the handler as one file under `src/server/handlers/`, next to the existing ones. A read handler
   takes `(driver, sender_pid, req, out)`, builds a fixed body, and calls `respond::send` with `E_OK`,
   the way `timing.rs` does ([`src/server/handlers/timing.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/timing.rs#L6)). Declare it in
   [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs).
3. Wire it into the dispatch match in [`src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L35). Keep a fixed-width read gated on an empty
   body with the `if body.is_empty()` guard the existing four use, so a stray body falls to `E_INVAL`
   ([`src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L49)).
4. If the operation carries a request body (like `OP_TRANSFER` or `OP_PROBE`), parse and bound it in the
   handler before touching hardware, the way `transfer.rs` rejects a length that does not match its
   declared write length ([`src/server/handlers/transfer.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/transfer.rs#L30)) and `probe.rs` rejects an address over
   `0x7F` ([`src/server/handlers/probe.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/probe.rs#L7)).

## Build and sign

The per-slug make targets are generated by `nonos-mk/capsule.mk` from the `CAPSULE_*` variables in
`userland/capsule_driver_i2c_pci/Capsule.mk`, which is included into the top-level build at
`Makefile:661` (`Capsule.mk:19`).

```
  make nonos-mk-driver-i2c-pci                build the capsule ELF             capsule.mk:182
  make nonos-mk-driver-i2c-pci-sign           id cert, manifest, attestation    capsule.mk:261
  make nonos-mk-driver-i2c-pci-verify         verify artifacts vs trust anchor  capsule.mk:263
  make nonos-mk-check-driver-i2c-pci-keys     assert the per-capsule signing keys exist  capsule.mk:184
```

For a kernel image that spawns the driver, `make nonos-mk-driver-i2c-pci-prod` builds the profile with
the `microkernel-driver-i2c-pci` feature and the driver's signed artifacts as prerequisites
(`Makefile:960`). The same artifacts are a prerequisite of the i2c-hid prod profile, because the HID
driver's client cannot run without the controller driver present (`Makefile:966`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every path returns an error as a status
  word or an `Err(&str)`; the release profile is `panic = "abort"` (`Cargo.toml:18`). The clock math is
  saturating and clamped so no input can overflow ([`src/init/scl.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/scl.rs#L31)), and every wait loop has a finite
  iteration budget ([`src/transaction/engine/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L32)).
- One unit per file. New handlers are one op per file under `server/handlers/`; new transfer helpers are
  one function per file under `transaction/engine/`; `mod.rs` is used only for re-exports, the way
  [`src/transaction/engine/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/mod.rs#L16) and [`src/protocol/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L1) are.
- The AGPL header is present today on [`src/discover.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L1) and across the `src/transaction/` tree (for
  example [`src/transaction/engine/run.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L1)), but the rest of the tree, including [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs),
  `src/protocol/`, `src/server/`, `src/setup/`, and `src/init/`, does not carry it yet. New files should
  add the header byte for byte as it appears on [`src/transaction/engine/run.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/transaction/engine/run.rs#L1), and backfilling the
  files that lack it is welcome.

## Source map

```
  userland/capsule_driver_i2c_pci/src/main.rs           _start -> setup::run -> server::run; module list
  userland/capsule_driver_i2c_pci/src/discover.rs       the PCI match to extend for a new controller
  userland/capsule_driver_i2c_pci/src/constants/mod.rs  the PCI-id table and register offsets
  userland/capsule_driver_i2c_pci/src/protocol/         the wire format and opcode constants
  userland/capsule_driver_i2c_pci/src/server/           the dispatch match and the per-op handlers
  userland/capsule_driver_i2c_pci/src/setup/            the broker grants and their unwind
  userland/capsule_driver_i2c_pci/src/init/             the reset and the SCL clock math
  userland/capsule_driver_i2c_pci/src/transaction/      the transfer engine and its types
  userland/capsule_driver_i2c_pci/Capsule.mk            the CAPSULE_* variables the targets read
  nonos-mk/capsule.mk                                   the generated build/sign/verify/check-keys targets
  Makefile                                              the Capsule.mk include and the -prod profile
```

Every reference above is verified against those trees.
