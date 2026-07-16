---
title: "Contributing to capsule_driver_nvme"
description: "This page is for a contributor who wants to change the NVMe driver."
weight: 6
---
This page is for a contributor who wants to change the NVMe driver. It covers where the source lives, which
folder owns which concern, the exact steps to add a client op or an NVMe command, how to build and sign the
capsule, and the code standards a change has to meet. For what the driver does and how it fits together,
read the [README](/docs/userland/driver-nvme/), the [operations](/docs/userland/driver-nvme/operations/) page, the [bring-up](/docs/userland/driver-nvme/bring-up/) page, and
the [queues](/docs/userland/driver-nvme/queues/) page.

## Where the source lives

The capsule is at `userland/capsule_driver_nvme/`. It is a `no_std`/`no_main` capsule: `_start` initialises
the heap, runs `setup::run`, and hands the built `Driver` to `server::run`, which loops forever
([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NNVM` wire format: header, ops, errno, limits, decode and encode | you change the request or reply layout |
| `src/server/` | the request loop and one handler per op | you add or change a client op |
| `src/setup/` | the bring-up sequence and the broker calls | you change discovery, claim, or a grant |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | the `mk_device_list` scan and the NVMe match | you change how the device is found |
| `src/controller/` | reading and decoding the register block | you read a new `CAP` or `CSTS` field |
| `src/dma/`, `src/handles/` | the broker-grant wrappers and their `Drop` | you add a grant or change teardown |
| `src/regs/`, `src/constants/` | register access, offsets, bit and CAP decoders | you touch a register offset or bit |
| `src/admin/` | the admin queue, its commands, and the Identify/SMART parsers | you add an admin command or parse a new field |
| `src/nvm/` | the IO queue pair, the PRP path, and read/write/flush | you change the block I/O path |
| `src/error/` | `NvmeError` and the exit-code mapping | you add a bring-up failure mode |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and, if it carries a fixed payload, its length to
   [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that encodes the
   response header, writes the status word, and sends with `mk_ipc_send`, following `capacity.rs` (a cached
   read) or `read.rs` (a device read). A status-only op can delegate to `reply_with_status`
   ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54). If the op takes no payload, add it to the
   zero-payload guard arm at `runner.rs:56` so a client cannot smuggle a body.

## Adding an NVMe command

Add a `Submission` constructor as one file under `src/admin/command/` (one command per file, like
`nvm_flush.rs`, each a `const fn` that fills the sixteen command dwords), then add an `AdminQueue` method
under `src/admin/queue/` or an `IoQueue` method under `src/nvm/` that allocates a command id, submits the
command, and waits the completion. The read/write path in [`src/nvm/transfer.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nvm/transfer.rs#L25) and the flush path in
[`src/nvm/flush.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nvm/flush.rs#L23) are the reference shapes; both roll the command id with
`cid.wrapping_add(1).max(1)` so it never reuses zero.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:7`) and pulled in through `userland/capsule_driver_nvme/Capsule.mk:18`.

```
  make nonos-mk-driver-nvme              build the capsule ELF
  make nonos-mk-driver-nvme-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-driver-nvme-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-nvme-keys   assert the per-capsule signing keys exist
```

For a kernel image that embeds and spawns the driver, `make nonos-mk-driver-nvme-prod` builds the
`microkernel-driver-nvme` profile with the signed NVMe artifacts baked in (`Makefile:1015`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every bring-up path returns an `NvmeError`
  and every request path returns an errno word; the release profile is `panic = "abort"` (`Cargo.toml:26`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and new commands are one
  file per command under `src/admin/command/`, matching the existing tree. `mod.rs` is used only for module
  declarations and re-exports.
- Every setup phase must have reverse-order rollback, which is what the `Drop` impls provide: `BrokerHandles`
  unbinds the IRQ, unmaps MMIO, and releases the claim in reverse order ([`src/handles/broker_handles_drop.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/handles/broker_handles_drop.rs#L21)),
  and each `DmaRegion` unmaps itself ([`src/dma/region.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dma/region.rs#L46)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_nvme/src/main.rs                _start -> setup::run -> server::run; module list
  userland/capsule_driver_nvme/src/protocol/ops.rs        the opcode constants
  userland/capsule_driver_nvme/src/protocol/limits.rs     the fixed payload lengths
  userland/capsule_driver_nvme/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_driver_nvme/src/server/runner.rs       the dispatch match and the zero-payload guard
  userland/capsule_driver_nvme/src/server/error.rs        reply_with_status
  userland/capsule_driver_nvme/src/admin/command/         the Submission constructors, one per file
  userland/capsule_driver_nvme/src/admin/queue/           the AdminQueue submit/wait methods
  userland/capsule_driver_nvme/src/nvm/transfer.rs        the read/write reference path
  userland/capsule_driver_nvme/src/nvm/flush.rs           the flush reference path
  userland/capsule_driver_nvme/src/dma/region.rs          the DmaRegion Drop unmap
  userland/capsule_driver_nvme/src/handles/broker_handles_drop.rs  the reverse-order grant teardown
  userland/capsule_driver_nvme/src/error/types.rs         NvmeError and exit_code
  userland/capsule_driver_nvme/Cargo.toml                 panic = "abort" and the binary name
  userland/capsule_driver_nvme/Capsule.mk                 slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                     the nonos-mk-driver-nvme[-sign|-verify] target template
  Makefile                                                the -prod image target
```

Every reference above is verified against those trees.
</content>
