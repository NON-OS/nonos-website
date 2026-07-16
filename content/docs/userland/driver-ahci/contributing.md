---
title: "Contributing to capsule_driver_ahci"
description: "This page is for a contributor changing the AHCI driver."
weight: 5
---
This page is for a contributor changing the AHCI driver. It covers where each behaviour lives, the exact
steps to add an operation or an ATA command, how to build and sign the capsule, and the code standards a
change has to meet. For what the driver does and how it is put together, read the [README](/docs/userland/driver-ahci/),
the [operation surface](/docs/userland/driver-ahci/operations/), the [bring-up](/docs/userland/driver-ahci/bringup/), and the [command engine](/docs/userland/driver-ahci/engine/)
pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_ahci/`. It is `no_std`/`no_main`: `_start` initialises the
heap, runs `setup::run` once, and hands the resulting `Driver` to `server::run`
([`userland/capsule_driver_ahci/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_ahci/src/main.rs#L37)). The module tree is declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NAHC` wire format: header, decode, encode, ops, errno, limits, endpoint | you change the wire layout or add an opcode |
| `src/server/` | the request loop, dispatch, IRQ poll, and one handler per op | you change how a request is routed or answered |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | the PCI storage/SATA/AHCI match | you change what counts as a candidate controller |
| `src/setup/` | the one-shot bring-up and the broker grant steps | you change the claim, mmio, irq, or port bring-up path |
| `src/controller/` | AHCI enable, the global register read, the port scan and signature | you change controller-global reads or the port snapshot |
| `src/engine/` | DMA regions, the hardware structures, program/stop/start, issue, and the ATA commands | you change the command path or add an ATA command |
| `src/handles/` | `BrokerHandles`: the device, mmio, and irq grants freed on drop | you change grant ownership or teardown |
| `src/regs/` | the volatile 32-bit MMIO wrapper | rarely; only to change how a register is accessed |
| `src/constants/` | HBA/port register offsets, ATA commands, signatures, port kinds | you add a register, command byte, or signature |
| `src/error/` | `AhciError` and the setup exit-code mapping | you add a bring-up failure class |

The tree is one unit per file, and `mod.rs` is used only for re-exports. Discovery is one file; the
one-shot bring-up is one file per step under `src/setup/`; the command engine is one file per structure
and one per verb under `src/engine/`; the request loop and each per-op handler are one file each under
`src/server/`.

## Adding an operation

There are four edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode to [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs), following the existing constants (`ops.rs:17`). Add any fixed
   payload size to [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs) (`limits.rs:17`).
2. Write the handler as one file under `src/server/handlers/`, exposing a `pub fn handle(...)` that builds
   the reply with `encode_response_header` and `write_status` and sends it with `mk_ipc_send`, or returns
   an errno through `reply_with_status` ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23), [`src/server/handlers/capacity.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L26)
   is a good reference for a fixed-size reply that guards on `driver.block`). Re-export it from
   [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs).
3. Wire it into the match in [`src/server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs) (`runner.rs:55`). If it is a fixed-size op that must
   carry no payload, add it to the leading guard arm alongside the existing three
   ([`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57)); otherwise add a plain arm.
4. If the op transfers sectors, parse and range-check the body through `super::rw_parse::parse` the way
   read and write do, so a bad LBA or count is rejected before any hardware is touched
   ([`src/server/handlers/rw_parse.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rw_parse.rs#L20)).

## Adding an ATA command

1. Add the command byte to [`src/constants/ata.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ata.rs) next to the existing ones (`ata.rs:17`).
2. Add an engine wrapper under `src/engine/` that calls `build::build_slot0` (or hand-builds the FIS for a
   no-data command the way `flush` does), then `issue::issue_slot0`, and runs `recover` on error, the way
   `transfer` and `flush` do ([`src/engine/transfer.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/transfer.rs#L22), [`src/engine/flush.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/flush.rs#L27)). Re-export it from
   [`src/engine/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/mod.rs) if a handler needs to call it ([`src/engine/mod.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/mod.rs#L35)).
3. Keep every register offset and bit mask in [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs); the engine code should reference a
   named constant, never a literal offset.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_ahci/Capsule.mk:18`. The slug is `driver-ahci`.

```
  make nonos-mk-driver-ahci             build the capsule ELF                        capsule.mk:182
  make nonos-mk-driver-ahci-sign        id cert, manifest, attestation trailer       capsule.mk:261
  make nonos-mk-driver-ahci-verify      verify the artifacts vs the trust anchor     capsule.mk:263
  make nonos-mk-check-driver-ahci-keys  assert the per-capsule signing keys exist    capsule.mk:184
```

For a running kernel that embeds and spawns the driver:

```
  make nonos-mk-driver-ahci-prod        kernel image with the microkernel-driver-ahci feature  Makefile:1005
```

That build sets `KERNEL_FEATURES := microkernel-driver-ahci`, which is the feature the storage-fleet
spawn plan gates on before it spawns `driver_ahci` at boot
([`src/userspace/init/spawn_plan/drivers_storage.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L23)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every fallible bring-up path returns an
  `AhciError` ([`src/error/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L17)) and every request path returns an errno, never a panic; the
  release profile is `panic = "abort"` (`Cargo.toml:26`).
- One unit per file. New ops are one handler per file under `src/server/handlers/`, new ATA commands one
  wrapper per file under `src/engine/`, and `mod.rs` is used only for re-exports, matching the existing
  tree.
- Every hardware structure that the controller reads carries a `const _: () = assert!(size == ...)` so a
  layout mistake fails the build, the way `CmdHeader`, `CmdTable`, `FisH2D`, and `PrdtEntry` do
  ([`src/engine/cmd_header.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/cmd_header.rs#L29)).
- No path to hardware except the broker. The driver holds no `Pio` bit and never touches an I/O port; MMIO
  goes through `Regs` on the broker-mapped ABAR, and every DMA address is one `mk_dma_map` returned
  ([`src/engine/region.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/engine/region.rs#L28)). Do not import kernel driver, memory, or paging code; the only hardware path
  stays the broker.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_ahci/src/main.rs        _start -> setup::run -> server::run; the module tree
  userland/capsule_driver_ahci/src/protocol/ops.rs      the opcode constants
  userland/capsule_driver_ahci/src/protocol/limits.rs   the fixed payload sizes
  userland/capsule_driver_ahci/src/server/handlers/     one handler per op
  userland/capsule_driver_ahci/src/server/handlers/mod.rs   the handler re-exports
  userland/capsule_driver_ahci/src/server/runner.rs     the dispatch match
  userland/capsule_driver_ahci/src/server/handlers/rw_parse.rs   the LBA/count range check
  userland/capsule_driver_ahci/src/engine/mod.rs        the engine re-exports
  userland/capsule_driver_ahci/src/engine/transfer.rs   the ATA command wrapper reference shape
  userland/capsule_driver_ahci/src/constants/ata.rs     the ATA command bytes
  userland/capsule_driver_ahci/src/constants/regs.rs    the register offsets and bit masks
  userland/capsule_driver_ahci/src/error/types.rs       AhciError and exit_code
  userland/capsule_driver_ahci/Cargo.toml               the panic = "abort" release profile
  userland/capsule_driver_ahci/Capsule.mk               slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                   the per-slug build/sign/verify/keys target templates
  Makefile                                              the nonos-mk-driver-ahci-prod image target
  src/userspace/init/spawn_plan/drivers_storage.rs      the storage-fleet spawn gate
```

Every reference above is verified against those trees.
