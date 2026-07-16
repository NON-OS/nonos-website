---
title: "Contributing to capsule_driver_virtio_blk"
description: "This page is for a contributor who wants to change the virtio-blk driver."
weight: 4
---
This page is for a contributor who wants to change the virtio-blk driver. It covers where the source lives,
which folder owns which behaviour, the exact steps to add an operation, how to build and sign the capsule,
and the code standards a change has to meet. For what the driver does and how it is put together, read the
[README](/docs/userland/driver-virtio-blk/), the [client protocol](/docs/userland/driver-virtio-blk/client/), the [bring-up](/docs/userland/driver-virtio-blk/bringup/), and the
[queue engine](/docs/userland/driver-virtio-blk/queue/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_virtio_blk/`. It is a `no_std`/`no_main` binary: `_start`
initialises the heap, retries `setup::run` until it returns a live `Driver`, and then enters `server::run`,
which never returns ([`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)). The top-level modules are declared there ([`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the NBLK wire format: header, ops, errno, limits, reply endpoint | you change the wire format or add an opcode constant |
| `src/server/` | the receive loop and the per-op handlers | you change how a request is dispatched or handled |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | finding the virtio-blk device on the broker list | you change device matching |
| `src/setup/` | the bring-up transaction (claim, regs, irq, dma) and its rollback | you change how grants are taken or unwound |
| [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs) | the legacy virtio status handshake and feature negotiation | you change negotiation or the offered features |
| `src/regs/` | the MMIO-versus-PIO register abstraction | you change register access |
| `src/queue/` | the virtqueue layout, descriptor chain, publish, and used ring | you change the descriptor shape or ring handling |
| `src/io/` | submit, the completion wait, and the ack | you change the submit or wait path |
| `src/constants/` | pci, queue, regs, request, and status constants | you change a device or protocol constant |

Inside `src/server/handlers/`, the simple and status-only ops (`health`, `capacity`, `flush`, and
`write`'s reply) are one file each, and the parse-heavy ops (`read/`, `write/`) are a subdirectory with
`handle.rs`, `request.rs`, and, for read, `reply.rs` split out ([`src/server/handlers/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L16)).

## Adding an operation

There are four edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant in [`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16) and re-export it from [`src/protocol/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L31). The
   five existing opcodes are `1..=5`.

2. Write the handler as its own module under `src/server/handlers/`, one file per op, or a subdirectory
   with `handle.rs`, `request.rs`, and `reply.rs` split out the way `read/` and `write/` are. Parse and
   bounds-check the body before any DMA, returning a negative errno on rejection the way
   [`src/server/handlers/read/request.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L33) does (`Result<_, i32>` where the error is the errno), and reply
   through `reply_with_status` for a status-only reply or build a payload reply in the tx buffer the way
   [`src/server/handlers/capacity.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L22) does. A read-style reply must slice the DMA buffer through
   `queue.data`, which clamps to the buffer length, never a raw pointer.

3. Wire the opcode into the dispatch match in [`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45), and export the handler from
   [`src/server/handlers/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L16). A word no arm matches already falls to the `_ =>` arm and replies
   `E_INVAL` ([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51)).

4. If the operation needs a new virtqueue direction or descriptor shape, extend `Direction`
   ([`src/queue/post/direction.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/direction.rs#L18)) and its `req_type` mapping, and the chain builder
   ([`src/queue/post/descriptors.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post/descriptors.rs#L27)). Keep the header descriptor at slot 0 and the status descriptor as
   the device-writable tail; the single-request-in-flight design depends on the chain always starting at
   descriptor 0.

## Keeping the kernel mirror in sync

The kernel-side mirror at `src/hardware/virtio_blk_capsule/` carries a matching protocol definition and an
in-kernel client. Its header, ops, and errno modules are documented as mirrors of the userland source and
must be kept byte-for-byte in step: the magic and layout in
[`src/hardware/virtio_blk_capsule/protocol/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_blk_capsule/protocol/header.rs#L20) point back at the userland file, and a mismatch
surfaces at runtime as `DriverBlkError::ProtocolMismatch`. A new opcode or a changed field is two edits, one
per side.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_virtio_blk/Capsule.mk:19`.

```
  make nonos-mk-driver-virtio-blk              build the capsule ELF
  make nonos-mk-driver-virtio-blk-sign         id cert, manifest, and attestation trailer
  make nonos-mk-driver-virtio-blk-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-virtio-blk-keys   assert the per-capsule signing keys exist
```

For a running kernel that includes the driver, `make nonos-mk-driver-virtio-blk-prod` builds the kernel
with the `microkernel-driver-virtio-blk` feature and the driver's signed artifacts (`Makefile:940`). Under
QEMU the backing disk is `-device virtio-blk-pci` over a raw drive image (`Makefile:272`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as a
  negative status word in the reply, never a panic; the release profile is `panic = "abort"`.
- One unit per file. Handlers are one op per file or a subdirectory split into `handle`, `request`, and
  `reply`, and `mod.rs` is used only for re-exports, matching the existing tree ([`src/protocol/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L16),
  [`src/server/handlers/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L16)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  existing module.

## Source map

```
  src/main.rs                         _start -> retry setup::run -> server::run; the module tree
  src/protocol/ops.rs                 the opcodes
  src/protocol/mod.rs                 the protocol re-exports
  src/server/runner.rs                the receive loop and opcode dispatch
  src/server/handlers/                the per-op handlers
  src/queue/post/direction.rs         Direction and its virtio request type
  src/queue/post/descriptors.rs       the descriptor chain builder
  src/hardware/virtio_blk_capsule/protocol/header.rs   the kernel mirror of the wire format
  Capsule.mk                          slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                 the nonos-mk-driver-virtio-blk[-sign|-verify] target templates
  Makefile                            the -prod image target and the QEMU virtio-blk device
```

Every reference above is verified against those trees.
