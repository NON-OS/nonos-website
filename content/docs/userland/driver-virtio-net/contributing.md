---
title: "Contributing to capsule_driver_virtio_net"
description: "This page is for a contributor who wants to change the virtio-net driver."
weight: 5
---
This page is for a contributor who wants to change the virtio-net driver. It covers where the source
lives, which folder owns which behaviour, the exact steps to add an operation, how to build and sign the
capsule, and the code standards a change has to meet. For what the driver does and how it is put
together, read the [README](/docs/userland/driver-virtio-net/), the [operations](/docs/userland/driver-virtio-net/operations/), the [bring-up](/docs/userland/driver-virtio-net/bringup/), and
the [queues](/docs/userland/driver-virtio-net/queues/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_virtio_net/`. It is a `no_std`/`no_main` binary: `_start`
initialises the heap, retries `setup::run` until it returns a live `Driver`, rejects a driver whose ring
regions did not map, and then enters `server::run`, which never returns ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). The top-level
modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the NNET wire format: header, ops, errno, limits | you change the wire format or add an opcode constant |
| `src/server/` | the receive loop and the per-op handlers | you change how a request is dispatched or handled |
| `src/discover/` | finding the virtio-net device on the broker list | you change device matching or BAR selection |
| `src/setup/` | the bring-up transaction (claim, regs, irq, four DMA maps) and its rollback | you change how grants are taken or unwound |
| `src/init/` | the legacy virtio handshake, queue program, and deferred `DRIVER_OK` | you change negotiation, the offered features, or queue setup |
| `src/regs/` | the MMIO-versus-PIO register abstraction | you change register access |
| `src/queue/` | the RX/TX ring state, prime, refill, post, and used ring | you change the descriptor shape or ring handling |
| [`src/rx.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs), [`src/tx.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx.rs) | pulling a received frame and sending one | you change the frame path |
| `src/constants/` | frame, pci, queue, regs, and status constants | you change a device or protocol constant |

Every handler under `src/server/handlers/` is one op per file ([`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17)), and each
`mod.rs` in the tree is used only for re-exports.

## Adding an operation

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant in [`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21) and re-export it from [`src/protocol/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L32).
   The five existing opcodes are `1..=5`.

2. Write the handler as its own file under `src/server/handlers/`, one op per file. Parse and
   bounds-check the body before any DMA the way [`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24) does, replying a
   negative status word on rejection, and reply through `reply_with_status` for a status-only reply or
   build a payload reply in the tx buffer and send the exact length the way
   [`src/server/handlers/mac_address.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mac_address.rs#L23) does. A reply that returns device data must bound the slice to
   the buffer the way [`src/rx.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx.rs#L52) and [`src/queue/used.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L46) do, never a raw device length.

3. Wire the opcode into the dispatch match in [`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57), and add the handler module to
   [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17). A word no arm matches already falls to the `_ =>` arm and replies
   `E_INVAL` ([`src/server/runner.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L63)).

If the operation needs a new virtqueue direction or descriptor shape, extend the ring writers in
[`src/queue/post_packet.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post_packet.rs) (TX) or [`src/queue/post.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs) (RX) and keep the fixed page-aligned ring offsets
in [`src/constants/queue.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L34); the whole engine assumes those offsets.

## Keeping the kernel mirror in sync

The kernel-side mirror at `src/hardware/virtio_net_capsule/` carries a matching protocol definition and
an in-kernel client. Its header and ops modules are documented as mirrors of the userland source and must
be kept byte-for-byte in step: the magic, version, and frame constants in
[`src/hardware/virtio_net_capsule/protocol/header.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_net_capsule/protocol/header.rs#L22) point back at the userland files, and a mismatch
surfaces at runtime as `DriverNetError::ProtocolMismatch` ([`src/hardware/virtio_net_capsule/error.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_net_capsule/error.rs#L33),
[`src/hardware/virtio_net_capsule/protocol/codec.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_net_capsule/protocol/codec.rs#L34)). A new opcode is two edits, one per side
([`src/hardware/virtio_net_capsule/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_net_capsule/protocol/ops.rs#L21)). The in-kernel client is reachable only by a
caller holding `CAP_DRIVER` ([`src/hardware/virtio_net_capsule/capability.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_net_capsule/capability.rs#L30)).

One stale-source note for a contributor: the kernel transport comment points at a userland file
[`src/protocol/endpoint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs) for the reply-inbox value ([`src/hardware/virtio_net_capsule/client/transport.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_net_capsule/client/transport.rs#L26)),
but this capsule has no such file. The userland driver replies to the sender pid returned by
`mk_ipc_recv_from`, not to a baked endpoint constant ([`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44), [`src/server/error.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L24)).
If you touch either side of the reply path, fix that comment rather than adding the file it names.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_virtio_net/Capsule.mk:20`. The generated slug for this capsule is `virtio-net`,
so the targets read:

```
  make nonos-mk-virtio-net                  build the capsule ELF
  make nonos-mk-virtio-net-sign             id cert, manifest, and attestation trailer
  make nonos-mk-check-virtio-net-keys       assert the per-capsule signing keys exist
```

The three appear in the Makefile `.PHONY` line for the generated capsule targets (`Makefile:31`). Note
the capsule README's build line reads `make -B nonos-mk-driver-virtio-net`
(`userland/capsule_driver_virtio_net/README.md:128`), but the generated target is `nonos-mk-virtio-net`;
prefer the Makefile as the source of truth.

For a running kernel that includes the driver, `make nonos-mk-driver-virtio-net-prod` builds the kernel
with the `microkernel-driver-virtio-net` feature and the driver's signed artifacts (`Makefile:950`).
Under QEMU the NIC is `-device virtio-net-pci,netdev=net0` over a user-mode netdev (`Makefile:286`,
`Makefile:293`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as a
  negative status word in the reply, never a panic. Setup returns a `Result<_, &'static str>` and the
  bring-up loop retries rather than aborting ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)).
- One unit per file. Handlers are one op per file, the DMA maps are one region per file, the register
  accessors are one width per file, and `mod.rs` is used only for re-exports, matching the existing tree
  ([`src/protocol/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L17), [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17), [`src/regs/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/mod.rs#L17)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  existing module.
- Keep the driver protocol-blind: no ARP, IP, sockets, or routing belongs here. That authority lives in
  net_core and the capsules above it (`userland/capsule_driver_virtio_net/README.md:5`).

## Source map

```
  src/main.rs                         _start -> retry setup::run -> ring-phys check -> server::run
  src/protocol/ops.rs                 the opcodes
  src/protocol/mod.rs                 the protocol re-exports
  src/server/runner.rs                the receive loop and opcode dispatch
  src/server/handlers/                the per-op handlers
  src/queue/post_packet.rs            the TX descriptor writer
  src/queue/post.rs                   the RX prime
  src/constants/queue.rs              the fixed ring offsets and queue sizes
  src/hardware/virtio_net_capsule/protocol/header.rs   the kernel mirror of the wire format
  src/hardware/virtio_net_capsule/capability.rs        the CAP_DRIVER caller gate
  src/hardware/virtio_net_capsule/client/transport.rs  the reply inbox and the stale endpoint comment
  Capsule.mk                          slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                 the nonos-mk-virtio-net[-sign] target templates
  Makefile                            the -prod image target and the QEMU virtio-net device
```

Every reference above is verified against those trees.
