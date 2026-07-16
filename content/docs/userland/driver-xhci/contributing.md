---
title: "Contributing to capsule_driver_xhci"
description: "This page is for a contributor who wants to change the xHCI driver."
weight: 5
---
This page is for a contributor who wants to change the xHCI driver. It covers where the source lives, which
folder owns which behaviour, how to add a client op, how to build and sign the capsule, and the code
standards a change has to meet. For what the driver does and how it is put together, read the
[README](/docs/userland/driver-xhci/), the [operations](/docs/userland/driver-xhci/operations/) surface, and the [bring-up](/docs/userland/driver-xhci/bring-up/),
[rings](/docs/userland/driver-xhci/rings/), and [enumeration](/docs/userland/driver-xhci/enumeration/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_xhci/`. It is a `no_std`/`no_main` driver: `_start` initialises
the heap, runs the one-shot `setup::run`, and on success hands the assembled `Driver` to the blocking
server loop ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36)). The thirteen top-level modules are declared there ([`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)). It is
the largest driver capsule in the tree, roughly 227 files, and the modularity is deliberate: one unit per
file, `mod.rs` for re-exports only.

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/setup/` | the ordered bring-up and the broker grant calls | you change how the controller is discovered, claimed, mapped, or started |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | the PCI match for the controller | you change which devices the driver will bind |
| `src/handles/` | `BrokerHandles`: the claim, MMIO, and IRQ grants and their Drop | you change grant lifetime or teardown order |
| `src/dma/` | `DmaPool` and `DmaRegion` over `mk_dma_map` | you change how DMA buffers are allocated or freed |
| `src/controller/` | the register-level operations: halt, reset, start, waits, DCBAA, port reset, event drain, IRQ ack, and every issue/get helper | you change a controller command or a wait |
| `src/regs/` | the cap/op/runtime MMIO accessors | you add or change a register field |
| `src/constants/` | register offsets, TRB kinds and flags, completion codes, ring sizes | you name a new register bit or TRB type |
| `src/trb/` | the TRB struct, its accessors, the stage builders, and the command TRBs | you add a TRB kind or a builder |
| `src/rings/` | the command, event, and transfer ring state and enqueue | you change ring mechanics |
| `src/contexts/` | the input and device context layouts | you change a slot or endpoint context field |
| `src/slots/` | the slot table, the DCI mapping, and per-slot resources | you change per-device state |
| `src/protocol/` | the NXHC header, the opcodes, errno, and the fixed body lengths | you change the wire format |
| `src/server/` | the recv/dispatch/reply loop and one handler per op | you add or change a client op |
| `src/error/` | `XhciError` and its errno mapping | you add a failure mode |

## Adding a client op

An op is added across the protocol and the server. The dispatch wiring and the length gate are the
load-bearing edits.

1. Assign the opcode in [`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16), next to the existing ones. Reuse one of the currently
   unassigned values (`0x000A`, `0x000C`, `0x000D`) rather than inventing a gap; they fall through the
   dispatch default today.
2. Define the fixed body lengths in [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs), both the request body length and any reply
   body length, as named constants. Every handler reads its lengths from there, never a literal.
3. Write the handler under `src/server/handlers/`. A simple op is one file
   (`port_status.rs`, `health.rs`); an op with a data stage is a folder with `handle.rs`, `reply.rs`, and a
   `transfer.rs` split apart, the way `control_transfer/` and `config_descriptor/` are. The handler takes
   the `Context` (which owns the one `Driver`), the decoded `Request`, the body slice, and the transmit
   buffer, validates its exact body length first, does the work through `src/controller/` helpers, and
   replies with `reply_with_status` on error or `encode_response_header` plus `write_status` plus
   `reply::send` on success.
4. Wire it into `dispatch` ([`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25)). A no-body status op is gated with
   `if body.is_empty()`; a body-carrying op is routed unconditionally and validates its own body length
   inside the handler. Anything that matches nothing returns `E_INVAL` from the default arm.
5. Register the op and its bytes on the [operations](/docs/userland/driver-xhci/operations/) page so the wire contract stays
   documented in one place.

If the op needs a new controller command, add the command TRB builder under `src/trb/commands/` and the
issue helper under `src/controller/`, following the shape of `issue_enable_slot` (build with the ring
cycle, enqueue, ring doorbell 0, wait completion).

## Build and sign

The per-slug make targets are generated from the template at `nonos-mk/capsule.mk:158` and pulled in
through `userland/capsule_driver_xhci/Capsule.mk`, whose slug is `driver-xhci` (`Capsule.mk:6`). The
targets are named after the slug, so the real target is `nonos-mk-driver-xhci`, not `nonos-mk-xhci`.

```
  make nonos-mk-driver-xhci              build the capsule ELF              capsule.mk:182
  make nonos-mk-driver-xhci-sign         id cert, manifest, attestation     capsule.mk:261
  make nonos-mk-driver-xhci-verify       verify artifacts vs trust anchor   capsule.mk:263
  make nonos-mk-check-driver-xhci-keys   assert the per-capsule signing keys exist  capsule.mk:184
```

`nonos-mk-xhci`, `nonos-mk-xhci-sign`, and `nonos-mk-check-xhci-keys` appear in one stale `.PHONY` line
(`Makefile:31`) that predates the slug being renamed to `driver-xhci`; they have no recipe and will not
build the capsule. Use the `driver-xhci` names.

For a bootable image that includes the driver:

```
  make nonos-mk-driver-xhci-prod         kernel image with the xHCI driver profile  Makefile:975
```

`nonos-mk-driver-xhci-prod` sets `KERNEL_FEATURES := microkernel-driver-xhci` and depends on the driver's
signed artifacts plus the proof-io capsule (`Makefile:975`). The USB HID and USB mass-storage prod targets
also depend on the xHCI driver's artifacts, since those class capsules sit on top of it
(`Makefile:981`, `Makefile:986`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!` on a runtime path. Every fallible step
  returns an `XhciError` ([`src/error/xhci_error.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/xhci_error.rs#L16)) that maps to an errno at the boundary
  ([`src/error/errno_value.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/errno_value.rs#L23)), and every handler replies with a status word rather than aborting.
- One unit per file. A new op handler, controller helper, register accessor, or TRB builder is its own
  file, and `mod.rs` is used only for re-exports, matching the existing tree.
- Program the controller only with broker-issued device addresses (`DmaRegion::phys`), never a physical
  address the capsule computed. Touch ring and register memory only through the volatile accessors.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_xhci/src/main.rs             _start -> heap, setup::run, server::run; the modules
  userland/capsule_driver_xhci/src/protocol/ops.rs     the opcodes
  userland/capsule_driver_xhci/src/protocol/limits.rs  every fixed body-length constant
  userland/capsule_driver_xhci/src/server/dispatch.rs  op -> handler routing and the E_INVAL default
  userland/capsule_driver_xhci/src/server/handlers/    one handler (or handler folder) per op
  userland/capsule_driver_xhci/src/controller/         the issue/get helpers a handler calls
  userland/capsule_driver_xhci/src/trb/commands/       the command TRB builders
  userland/capsule_driver_xhci/src/error/xhci_error.rs XhciError
  userland/capsule_driver_xhci/src/error/errno_value.rs  the errno mapping
  userland/capsule_driver_xhci/Capsule.mk              slug driver-xhci, ports, mask; includes the targets
  nonos-mk/capsule.mk                                  the nonos-mk-<slug>[-sign|-verify] target template
  Makefile                                             nonos-mk-driver-xhci-prod and the stale .PHONY line
```

Every reference above is verified against those trees.
