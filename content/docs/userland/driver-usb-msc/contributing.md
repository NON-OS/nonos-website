---
title: "Contributing to capsule_driver_usb_msc"
description: "This page is for a contributor who wants to change the USB MSC driver."
weight: 2
---
This page is for a contributor who wants to change the USB MSC driver. It covers where the source lives,
which folder owns which behaviour, how to add an operation, what an end-to-end transfer path would still
need, how to build and sign the capsule, and the code standards a change has to meet. For what the capsule
does and how it fits together, read the [overview](/docs/userland/driver-usb-msc/), the [operations reference](/docs/userland/driver-usb-msc/operations/),
and the [BOT and SCSI page](/docs/userland/driver-usb-msc/bot-scsi/).

## Where the source lives

The capsule is at `userland/capsule_driver_usb_msc/`. It is a `no_std`/`no_main` userland binary: `_start`
initializes the heap and calls `server::run`, which never returns
([`userland/capsule_driver_usb_msc/src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/src/main.rs#L32), `:36`). The module trees are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the NUMS wire: header, decode, encode, opcodes, errno, limits | you change the envelope, add an opcode constant, or move a bound |
| `src/server/` | the request loop and one handler per op | you change routing or add an operation |
| `src/descriptors/` | the USB configuration-descriptor probe and binding encode | you change how endpoints are classified or reported |
| `src/bot/` | the Bulk-Only Transport CBW writer and CSW parser | you change the command or status wrapper layout |
| `src/scsi/` | the CDB builders and the block-request guard | you add a SCSI command or change the transfer bound |
| `src/state/` | process-local bindings, the BOT tag, and the counters | you change what the capsule remembers between requests |

## Adding an operation

The shape is the same as the existing handlers, and the dispatch wiring is the load-bearing edit.

1. Add the opcode constant in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and re-export it from [`src/protocol/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L31).
2. Write the handler as one file under `src/server/handlers/`, following an existing one. A handler takes
   `state`, `sender_pid`, `req`, optionally `body`, and `tx`; it does its work and replies through
   `respond::status` for a bare status or `respond::payload` for a status plus payload
   ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21), `:27`). A build-style handler writes its payload into
   `tx[HDR_LEN + STATUS_LEN..]`, the way `build_inquiry` does ([`src/server/handlers/build_inquiry.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_inquiry.rs#L33)).
   Register the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire the opcode into the match in [`src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L22). If the op takes no body, add the
   `body.is_empty()` guard the empty-body ops use, so an unknown op with a body still falls to the
   `E_INVAL` catch-all rather than your arm ([`src/server/dispatch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L23), `:35`, `:38`).
4. Keep the capability boundary. Do not import any kernel driver, memory, paging, phys, or hardware path,
   and do not call a `mk_pio_*`, `mk_dma_*`, `mk_mmio_*`, `mk_irq_*`, or `mk_device_*` syscall or an `asm!`
   block; the static gate greps the whole tree and fails the build otherwise
   ([`nonos-ci/run-static-checks.sh:1394`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1394), `:1403`).

## What an end-to-end transfer path still needs

The capsule builds a Command Block Wrapper and validates a Command Status Wrapper, but it never runs the
bulk transfer that sits between them, and it publishes no block device. Closing that path is the next real
slice, and it is more than a handler edit. The pieces, in the order a transfer touches them:

- A transport caller. Something has to hold the xHCI service handle, take the CBW this capsule returns,
  schedule it as a bulk-out transfer, run the data-stage bulk-in or bulk-out, read the 13-byte CSW, and
  hand that CSW back to `OP_ACCEPT_CSW`. That caller holds the transport relationship; this capsule stays
  a pure server. The xHCI side of that relationship is documented under the hardware broker:
  [claim.md](/docs/subsystems/hardware-broker/claim/),
  [mmio.md](/docs/subsystems/hardware-broker/mmio/), [dma.md](/docs/subsystems/hardware-broker/dma/),
  and [irq.md](/docs/subsystems/hardware-broker/irq/).
- Error recovery. `OP_ACCEPT_CSW` counts a phase error and a tag mismatch but takes no action
  ([`src/state/ops.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L37), `:44`). A real path needs a BOT reset recovery (clear-feature on both bulk
  endpoints, mass-storage reset) driven off the phase-error signal, which does not exist here.
- Multi-LUN. Every CBW is built with `lun: 0` hard-coded
  ([`src/server/handlers/build_inquiry.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_inquiry.rs#L29), [`src/server/handlers/build_write.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/build_write.rs#L34)). Addressing a
  second logical unit means threading a LUN through the build ops and the CBW.
- Sense decoding. There is no REQUEST SENSE and no sense-data parse. A failing command surfaces only as
  the CSW status byte; a diagnosable path needs to issue REQUEST SENSE and decode the key/ASC/ASCQ.
- Block-device publication and mount. Even with transfers working, nothing registers a block device or
  mounts a filesystem; that belongs to a block service above this capsule, per the intended chain
  `driver.xhci0 -> driver.usb_msc0 -> block service -> filesystem capsules`
  (`userland/capsule_driver_usb_msc/README.md:139`).

None of that changes the boundary this capsule keeps: it would still hold `0x19` and speak IPC only. The
transport authority stays in xHCI, and the block and mount policy stays above.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` for the `driver-usb-msc` slug and
pulled in through `userland/capsule_driver_usb_msc/Capsule.mk:20`.

```
  make nonos-mk-driver-usb-msc              build the capsule ELF
  make nonos-mk-driver-usb-msc-sign         id cert, manifest, attestation trailer
  make nonos-mk-driver-usb-msc-verify       verify the signed artifacts vs the trust anchor
  make nonos-mk-check-driver-usb-msc-keys   assert the per-capsule signing keys exist
```

Those four targets are declared for the slug on the `.PHONY` line at `Makefile:31`. For a kernel image
that includes the driver, `make nonos-mk-driver-usb-msc-prod` builds the profile with
`KERNEL_FEATURES := microkernel-driver-usb-msc`, pulling in the proof-io and xHCI artifacts as
dependencies (`Makefile:985`, `Makefile:986`). Run the static gate with `bash nonos-ci/run-static-checks.sh`;
it enforces the capability boundary and the MSC descriptor plus BOT/SCSI surface for this capsule
([`nonos-ci/run-static-checks.sh:1394`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1394), `:1403`, `:1412`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns an errno as a status
  word, never a panic; the release profile is `panic = "abort"`
  ([`userland/capsule_driver_usb_msc/Cargo.toml:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_msc/Cargo.toml#L25)).
- One unit per file. New handlers are one op per file under `src/server/handlers/`, and `mod.rs` is used
  only for re-exports, matching the existing tree ([`src/protocol/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs), [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_usb_msc/src/main.rs      _start -> heap_init -> server::run
  userland/capsule_driver_usb_msc/src/protocol/    the NUMS wire, opcodes, errno, limits
  userland/capsule_driver_usb_msc/src/server/      the request loop, dispatch, respond, handlers
  userland/capsule_driver_usb_msc/src/descriptors/ the configuration-descriptor probe
  userland/capsule_driver_usb_msc/src/bot/         the CBW writer and the CSW parser
  userland/capsule_driver_usb_msc/src/scsi/        the CDB builders and the block-request guard
  userland/capsule_driver_usb_msc/src/state/       process-local bindings, tag, and counters
  userland/capsule_driver_usb_msc/Cargo.toml       the panic = "abort" release profile
  userland/capsule_driver_usb_msc/Capsule.mk       slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                              the nonos-mk-driver-usb-msc target templates
  Makefile                                         the -prod image target and the .PHONY declarations
  nonos-ci/run-static-checks.sh                    the capability-boundary and MSC-path static gates
```

Every reference above is verified against those trees.
