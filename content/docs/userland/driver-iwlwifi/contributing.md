---
title: "Contributing to capsule_driver_iwlwifi"
description: "This page is for a contributor who wants to change the Intel Wi-Fi driver."
weight: 8
---
This page is for a contributor who wants to change the Intel Wi-Fi driver. It covers where the source lives,
which folder owns which concern, how to add a client op, how to build and sign the capsule, and the code
standards a change has to meet. For what the driver does and its honest state, read the [README](/docs/userland/driver-iwlwifi/),
the [operations](/docs/userland/driver-iwlwifi/operations/) page, the [bring-up](/docs/userland/driver-iwlwifi/bring-up/) page, and the [firmware](/docs/userland/driver-iwlwifi/firmware/) page.

## Where the source lives

The capsule is at `userland/capsule_driver_iwlwifi/`. It is a `no_std`/`no_main` capsule: `_start`
initialises the heap, runs `setup::run`, and hands the built `Driver` to `server::run`, which loops forever
([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NIWF` wire format: header, ops, errno, limits, decode and encode | you change the request or reply layout |
| `src/server/` | the request loop and one handler per op | you add or change a client op |
| `src/setup/` | the bring-up sequence and the broker calls | you change discovery, claim, or a grant |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | the `mk_device_list` scan and the Intel Wi-Fi match | you change how the device is found |
| [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs) | the APM clock bring-up and `InitState` | you touch the power-management sequence |
| [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs), `src/constants/` | register access, offsets, CSR and `GP_CNTRL` bits | you touch a register offset or bit |
| `src/firmware/` | blob selection, TLV parse, section staging, the alive poll | you add a family, a TLV type, or the FH transfer |
| [`src/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs) | the built `Driver` struct and `stage_firmware` | you add a field to the driver state |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L9) and re-export it from [`src/protocol/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L21).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that fills a
   fixed byte buffer, then calls `respond::send` with the errno and the payload, following `device.rs` (a
   cached read), `rf.rs` (a live register read), or `firmware_stage.rs` (an on-demand action). Declare the
   module in [`src/server/handlers/mod.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L9).
3. Wire it into the dispatch match in [`src/server/runner.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L37). Add the arm with the `if body.is_empty()`
   guard so a client cannot smuggle a body into a fixed-width query; the fall-through already answers
   `E_BAD_OP` for an unknown empty-body op and `E_INVAL` for anything carrying a body.

## Adding a firmware family or TLV type

To support another device, add a `Family` variant in [`src/firmware/family.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/family.rs#L11), its PCI id range in
`family_for_device` (`family.rs:19`), an `include_bytes!` blob and a `blob_for_family` arm in
[`src/firmware/blob.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/blob.rs), and place the `.ucode` file under `nonos-bootloader/firmware/intel/`. To stage
another TLV section type, add its constant next to `TLV_SEC_RT` in [`src/firmware/tlv.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/tlv.rs#L5), add it to the
`matches!` set in `stage_firmware` ([`src/firmware/stage/stage_firmware.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/stage_firmware.rs#L40)), and count it in
`count_section` ([`src/firmware/stage/count_section.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/count_section.rs#L20)).

## Where the driver would grow next

The honest gap the [firmware](/docs/userland/driver-iwlwifi/firmware/) page describes is the flow-handler transfer. Wiring the firmware
to the device would add the FH transfer-control register offsets to [`src/constants/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs), a transfer step
in a new module that programs the DMA source (the `dma_device_addr` the driver already holds) and destination
and starts the transfer, and then the existing `wait_for_alive` becomes meaningful. Everything past that,
the command queue, the RX and TX rings, association, and the `net.l2` handoff, is new subsystems, not edits
to the current files.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_iwlwifi/Capsule.mk:18`.

```
  make nonos-mk-driver-iwlwifi              build the capsule ELF
  make nonos-mk-driver-iwlwifi-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-driver-iwlwifi-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-iwlwifi-keys   assert the per-capsule signing keys exist
```

For a kernel image that embeds and spawns the driver, the `nonos-capsule-driver-iwlwifi` feature gates the
embed and the spawn ([`src/hardware/iwlwifi_capsule/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/iwlwifi_capsule/embed.rs#L17),
[`src/userspace/init/spawn_plan/drivers_bus.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_bus.rs#L23)), and the source `README.md` documents the profile check
`cargo check --no-default-features --features microkernel-driver-iwlwifi`.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every bring-up path returns an
  `Err(&'static str)` and every request path returns an errno word; the release profile is `panic = "abort"`
  (`Cargo.toml:25`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and the firmware staging
  steps are one file each under `src/firmware/stage/`, matching the existing tree. `mod.rs` is used only for
  module declarations and re-exports.
- Every setup phase that can fail rolls back the grants acquired before it, in reverse order, inline at the
  failure site ([`src/setup/mmio.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L19), [`src/setup/irq.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L17), [`src/setup/dma.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L23)).
- The AGPL header sits at the top of every source file, matching the header on [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every
  other module.

## Source map

```
  userland/capsule_driver_iwlwifi/src/main.rs                 _start -> setup::run -> server::run; module list
  userland/capsule_driver_iwlwifi/src/protocol/ops.rs         the opcode constants
  userland/capsule_driver_iwlwifi/src/protocol/mod.rs         the protocol re-exports
  userland/capsule_driver_iwlwifi/src/server/handlers/mod.rs  the handler module declarations
  userland/capsule_driver_iwlwifi/src/server/runner.rs        the dispatch match and the empty-body guard
  userland/capsule_driver_iwlwifi/src/server/respond.rs       send: response encode plus mk_ipc_reply
  userland/capsule_driver_iwlwifi/src/firmware/family.rs      the Family variants and the PCI id map
  userland/capsule_driver_iwlwifi/src/firmware/blob.rs        the include_bytes blobs
  userland/capsule_driver_iwlwifi/src/firmware/stage/         the TLV walk, the copy, and the section tally
  userland/capsule_driver_iwlwifi/src/setup/                  the grant rollback sites
  userland/capsule_driver_iwlwifi/Cargo.toml                  panic = "abort" and the binary name
  userland/capsule_driver_iwlwifi/Capsule.mk                  slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                         the nonos-mk-driver-iwlwifi target template
  src/hardware/iwlwifi_capsule/embed.rs                       the feature-gated embed
  src/userspace/init/spawn_plan/drivers_bus.rs                the feature-gated spawn
```

Every reference above is verified against those trees.
