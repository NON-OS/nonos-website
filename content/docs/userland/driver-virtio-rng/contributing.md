---
title: "Contributing to capsule_driver_virtio_rng"
description: "This page is for a contributor who wants to change the virtio-rng driver."
weight: 5
---
This page is for a contributor who wants to change the virtio-rng driver. It covers where the source lives,
which folder owns which behaviour, how to extend the driver, the build and sign targets, and the code
standards a change has to meet. For what the driver does and how it is put together, read the
[overview](/docs/userland/driver-virtio-rng/), the [operations and protocol](/docs/userland/driver-virtio-rng/operations/), the [hardware bring-up](/docs/userland/driver-virtio-rng/hardware/),
and the [request queue](/docs/userland/driver-virtio-rng/queue/) pages in this folder.

Two things constrain almost every change here. First, this is a hardware driver: it holds real device
authority (`Driver`, `DeviceEnum`, `Mmio`, `Irq`, `Dma`, `Pio`) and no crypto bit, so a change that reaches
for policy or a pool is out of scope by design (see the mask in the [overview](/docs/userland/driver-virtio-rng/)). Second, the wire
format has a bit-for-bit mirror in the kernel under `src/hardware/virtio_rng_capsule/`; a change to the frame
or the op set on the capsule side has a counterpart there that must move with it.

## Where the source lives

The capsule is at `userland/capsule_driver_virtio_rng/`. It is a `no_std`/`no_main` process: `_start`
initializes the heap, loops on `setup::run` until the whole broker bring-up chain succeeds, does one sanity
fill and rejects an all-zero result, then enters the server loop ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The nine top-level
modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder or file | Owns | Touch it when |
|---|---|---|
| `src/discover/` | device-table match: vendor and device id, IRQ pin/line, first register BAR | you change which devices the driver claims |
| `src/setup/` | the ordered broker chain (claim, registers, IRQ, DMA) and reverse rollback | you change bring-up order or add a grant |
| [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs) | the virtio legacy init handshake (ACK, DRIVER, features, queue PFN, DRIVER_OK) | you change the device negotiation |
| `src/regs/` | the MMIO-or-PIO register accessor | you change how a register is read or written |
| `src/queue/` | the split virtqueue: descriptor post, available ring, used ring, bounded buffer read | you change the ring mechanics |
| [`src/fill.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs) | one virtqueue round trip: notify, bounded wait, IRQ ack, byte count | you change the completion wait |
| `src/protocol/` | the `NORD` frame, ops, errno, limits, reply endpoint | you change the wire format or add an op |
| `src/server/` | the IPC loop, the single reply path, the fill and health handlers | you change request handling |
| `src/constants/` | device ids, register offsets, queue layout, status bits | you change a fixed value |

The kernel mirror is a separate tree under `src/hardware/virtio_rng_capsule/`. It holds the verified spawn
path (`spawn.rs`), the embedded capsule ELF and its trust artifacts (`embed`), the `CAP_DRIVER` read gate
(`capability.rs`), the bit-for-bit protocol mirror (`protocol/`), and the kernel-side client that is the only
in-tree caller (`client/`). Any change to `src/protocol/` in the capsule has to be reflected in
`src/hardware/virtio_rng_capsule/protocol/` or the two ends disagree on the frame.

## Adding an operation

There are three edits on the capsule side, and the kernel mirror has to move with the first two.

1. Define the opcode. Add the `OP_*` constant next to `OP_FILL_RANDOM = 1` and `OP_HEALTHCHECK = 2`
   ([`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21)). Pick the next free number; the decoder does not care about the value, only the
   runner's match does.

2. Write the handler as one file per op under `src/server/handlers/`, next to `fill.rs` and `health.rs`. A
   handler takes the decoded `Request` and the transmit buffer, does its work, and emits its reply through the
   shared encoders: `encode_response_header` then `write_status`, or the `reply_with_status` helper for a
   status-only reply ([`src/server/handlers/health.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L25), [`src/server/error.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L27)). Do not open a new reply
   path; every reply, success or error, goes to `KERNEL_REPLY_ENDPOINT` through those calls so a malformed
   envelope and a real reply are indistinguishable in shape ([`src/server/error.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L27), `error.rs:33`).

3. Route it. Add a match arm in the server loop next to the two existing ops; an unknown op stays on the
   `_ =>` arm and returns `E_INVAL` ([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51), `runner.rs:54`). Declare the new handler module
   in [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs).

Then mirror the opcode and any frame change in `src/hardware/virtio_rng_capsule/protocol/`, and if the kernel
should call the new op, add a method under `src/hardware/virtio_rng_capsule/client/` that gates on
`CAP_DRIVER` the way `fill_random` and `healthcheck` do (`src/hardware/virtio_rng_capsule/client/`). A new op
that returns more than `MAX_FILL_BYTES` of payload needs the transmit buffer sizing in the runner widened to
match ([`src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L34)).

## Build and sign

The per-slug make targets are generated from the `NONOS_CAPSULE_RULES` template in `nonos-mk/capsule.mk` and
instantiated for this capsule with the slug `driver-virtio-rng` through
`$(eval $(call NONOS_CAPSULE_RULES,$(CAPSULE_SLUG)))` (`nonos-mk/capsule.mk:272`,
`userland/capsule_driver_virtio_rng/Capsule.mk:20`). The slug, handle, ports, and capability mask come from
`Capsule.mk` (`Capsule.mk:6`).

```
  make nonos-mk-driver-virtio-rng              build the capsule ELF               capsule.mk:182
  make nonos-mk-driver-virtio-rng-sign         id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-driver-virtio-rng-verify       verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-driver-virtio-rng-keys   assert the per-capsule signing keys exist   capsule.mk:184
```

The target stems are the slug, so `nonos-mk-$(1)` with `$(1) = driver-virtio-rng` yields
`nonos-mk-driver-virtio-rng` and its `-sign`, `-verify`, and `check-...-keys` siblings (`capsule.mk:158`).
The `.PHONY` line in the Makefile that names `nonos-mk-virtio-rng` is a legacy short name and does not match
the slug-generated targets, which all carry the `driver-` prefix (`Makefile:31`).

For a bootable image that includes the driver:

```
  make nonos-mk-driver-virtio-rng-prod         kernel image with the driver feature   Makefile:935
```

`nonos-mk-driver-virtio-rng-prod` sets `KERNEL_FEATURES := microkernel-driver-virtio-rng` and depends on the
capsule's signed artifacts plus the proof-io artifacts before it builds the kernel (`Makefile:935`,
`Makefile:936`). The QEMU run line attaches the backing device with `-device virtio-rng-pci`
(`Makefile:280`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. The decoder returns `None` on any bad
  envelope rather than unwrapping ([`src/protocol/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs)), the fill path returns `Result` on a device that
  does not respond ([`src/fill.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L43)), and setup returns `Result` and rolls back rather than aborting inside a
  grant ([`src/setup/dma.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs)).
- `unsafe` is confined to the volatile register and ring accesses and to the DMA buffer read, and each block
  carries a `SAFETY`/`# Safety` note tying it to the grant it operates on ([`src/queue/post.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L39),
  [`src/queue/used.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L51)). New device memory touches follow the same pattern.
- Every grant a phase takes is released in reverse order on failure, so the broker never holds a partial
  setup ([`src/setup/dma.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L57)), and the live `Driver::release` drops every grant in reverse on teardown
  ([`src/setup/driver.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L44)).
- One unit per file. New ops are one handler per file under `src/server/handlers/`, and `mod.rs` is used only
  for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_virtio_rng/src/main.rs             _start: heap, setup retry, sanity fill, server
  userland/capsule_driver_virtio_rng/src/protocol/ops.rs     the opcode table to extend
  userland/capsule_driver_virtio_rng/src/server/runner.rs    the op routing and buffer sizing
  userland/capsule_driver_virtio_rng/src/server/handlers/    one handler per op
  userland/capsule_driver_virtio_rng/src/server/error.rs     the single shared reply path
  userland/capsule_driver_virtio_rng/Capsule.mk              slug driver-virtio-rng, ports, mask; includes the template
  nonos-mk/capsule.mk                                        NONOS_CAPSULE_RULES template and its instantiation
  Makefile                                                   the -prod image target and the QEMU device line
  src/hardware/virtio_rng_capsule/                           the kernel spawn, protocol mirror, and CAP_DRIVER client
```

Every reference above is verified against those trees.
</content>
