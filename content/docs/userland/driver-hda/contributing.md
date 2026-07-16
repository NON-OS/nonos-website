---
title: "Contributing to capsule_driver_hda"
description: "This page is for a contributor who wants to change the HDA driver."
weight: 4
---
This page is for a contributor who wants to change the HDA driver. It covers where the source lives, which
folder owns which behaviour, how to add an operation, what a real playback path would still require, how
to build and sign the capsule, and the code standards a change has to meet. For what the driver does and
how it is put together, read the [README](/docs/userland/driver-hda/), the [bring-up](/docs/userland/driver-hda/bringup/), and the
[operations](/docs/userland/driver-hda/operations/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_hda/`. It is `no_std`/`no_main`: `_start` initialises the
heap, runs `setup::run` once, and hands the resulting `Driver` to `server::run`; a setup failure exits
with a code derived from the error ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)). The top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). The tree is one unit per file.

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | PCI discovery: the candidate predicate over the audio-class device list | you change how the controller is found |
| `src/setup/` | the one-shot broker bring-up: claim, bus master, mmio, irq, and the failure unwinds | you change the privileged path or its cleanup |
| `src/controller/` | reset release, controller-info read, the immediate-command interface, codec probe, stream layout | you touch a register, a codec verb, or the layout math |
| `src/constants/` | HDA register offsets and PCI class/BAR constants | you add a register or a class match |
| `src/regs/` | the volatile `Regs` wrapper over BAR0 | you change how MMIO is accessed |
| `src/protocol/` | the NHDA wire format: header, decode, encode, ops, errno, limits, endpoint | you add or change an operation's shape |
| `src/server/` | the request loop, the payload guards, the IRQ poll, and the per-op handlers | you change dispatch or a handler |
| `src/handles/` | `BrokerHandles`: the owner that frees the irq, mmio, and device grants on drop | you change grant ownership or teardown |
| `src/error/` | `HdaError` and the setup exit-code mapping | you add a setup failure mode |

Keep raw MMIO behind the `Regs` wrapper ([`src/regs/mmio.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/mmio.rs#L29)) and keep every fallible path returning an
`HdaError` or an errno, never a panic.

## Adding an operation

Every query in this slice is fixed-shape and payload-free, and the request loop enforces that. There are
four edits.

1. Add the opcode to [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) next to the existing five ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)), and add
   any fixed reply sizes to [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs). The transmit buffer is sized from those limits at
   compile time through `max_tx_body`, so a new worst-case body has to be reflected there
   ([`src/server/runner/max_tx_body.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/max_tx_body.rs#L19), [`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22)).
2. Write the handler as one file under `src/server/handlers/`, exposing `pub fn handle(...)`. Build the
   reply with `encode_response_header` and `write_status`, then send it with `mk_ipc_send` to
   `KERNEL_REPLY_ENDPOINT`, the way `controller_info` does ([`src/server/handlers/controller_info.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/controller_info.rs#L26));
   a status-only reply can use `reply_with_status` instead ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)). Re-export the
   module from [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs) ([`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17)).
3. Wire it into the dispatch match in [`src/server/runner/run.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L54) and add the opcode to the `use`
   import list at the top of the runner ([`src/server/runner/run.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L23)).
4. Keep the op payload-free, because the guard at [`src/server/runner/run.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L50) rejects any request with a
   non-zero `payload_len` before dispatch. An op that must accept caller data would require relaxing that
   guard deliberately, and no op in this slice does.

If the op needs a new register or codec verb, add the offset to [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs) and the access
under `src/controller/`, behind `Regs` ([`src/regs/mmio.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/mmio.rs#L29)).

## What a playback path would need

This slice is enumeration-only. Turning it into an audio driver is not a documentation edit; it is real
device programming that this capsule deliberately does not carry today. The concrete gaps, in the order
they would have to land:

- **A `Dma` capability.** The mask is `0x78019` and holds no `Dma` bit (`Capsule.mk:17`,
  [`src/capabilities/types.rs:75`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L75)). Any DMA-backed structure requires that bit added to the manifest and
  granted at spawn, plus the broker DMA path. Until then there is no device-visible buffer at all.
- **CORB/RIRB verb transport.** The current codec path is the single-verb immediate-command interface
  ([`src/controller/immediate.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L23)). Real codec configuration needs the Command Output Ring Buffer and
  Response Input Ring Buffer: DMA-backed ring buffers with their own registers, a write pointer, and a
  response reader. This replaces `get_parameter` as the general verb channel.
- **A buffer descriptor list.** Each stream needs a BDL in DMA memory describing the sample buffers, plus
  the stream descriptor registers programmed to point at it. The stream-descriptor offsets this slice
  computes ([`src/controller/stream_layout.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/stream_layout.rs#L48)) are exactly where that programming would target, but
  nothing writes them today.
- **Stream DMA and the run bit.** Programming the stream format, the cyclic buffer length, and the run
  bit, then servicing buffer-completion interrupts. This is where the `poll_irq` path
  ([`src/server/runner/poll_irq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/poll_irq.rs#L21)), which today only drains the line, would gain real work.
- **Codec node configuration.** Widget enumeration, converter and pin setup, and mixer and jack policy,
  layered on the working verb transport.

None of that is present, and the honest boundary is stated in the manifest comment and the `Cargo.toml`
description (`Capsule.mk:4`, `Cargo.toml:5`).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_hda/Capsule.mk:19`.

```
  make nonos-mk-driver-hda              build the capsule ELF                       capsule.mk:182
  make nonos-mk-driver-hda-sign         id cert, manifest, attestation trailer      capsule.mk:261
  make nonos-mk-driver-hda-verify       verify the artifacts vs the trust anchor    capsule.mk:263
  make nonos-mk-check-driver-hda-keys   assert the per-capsule signing keys exist   capsule.mk:184
```

For a bootable kernel image that embeds and spawns the driver:

```
  make nonos-mk-driver-hda-prod         kernel image with the microkernel-driver-hda feature   Makefile:1010
```

That target sets `KERNEL_FEATURES := microkernel-driver-hda` so the driver fleet spawns `driver_hda` at
boot (`Makefile:1010`, [`src/userspace/init/spawn_plan/drivers_storage.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_storage.rs#L37)). The README documents the
plain build and static-gate entry points, `make -B nonos-mk-driver-hda` and
`bash nonos-ci/run-static-checks.sh` (`userland/capsule_driver_hda/README.md:152`, `:153`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every fallible path returns an
  `HdaError` ([`src/error/types.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/error/types.rs#L18)) or an errno, and the release profile is `panic = "abort"`
  (`Cargo.toml:26`).
- One unit per file. New handlers are one op per file under `src/server/handlers/`, controller accesses
  are one concern per file under `src/controller/`, and `mod.rs` is used only for re-exports, matching the
  existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.
- HDA stays a userland capsule that reaches hardware only through broker MMIO and IRQ in this slice; it
  takes no `Dma` or `Pio` capability until a real stream path lands
  (`userland/capsule_driver_hda/README.md:154`).

## Source map

This page is drawn from the capsule tree, its `Capsule.mk` and `Cargo.toml`, the generated capsule make
rules, the top-level `Makefile` targets, and the driver-fleet spawn entry.

```
  userland/capsule_driver_hda/src/main.rs        _start -> setup::run -> server::run; the modules
  userland/capsule_driver_hda/src/protocol/ops.rs        the opcode constants
  userland/capsule_driver_hda/src/protocol/limits.rs     the reply size limits
  userland/capsule_driver_hda/src/server/runner/run.rs   the dispatch match and the payload guard
  userland/capsule_driver_hda/src/server/handlers/       one file per op
  userland/capsule_driver_hda/src/controller/immediate.rs  the immediate-command interface a CORB/RIRB path replaces
  userland/capsule_driver_hda/src/error/types.rs         HdaError and the exit-code mapping
  userland/capsule_driver_hda/Capsule.mk                 slug, ports, mask; includes the generated targets
  userland/capsule_driver_hda/Cargo.toml                 the bin, deps, and panic = "abort" profile
  nonos-mk/capsule.mk                                    the nonos-mk-driver-hda[-sign|-verify] templates
  Makefile                                               the -prod image target
  src/userspace/init/spawn_plan/drivers_storage.rs       the driver-fleet spawn entry
  src/capabilities/types.rs                              the Dma bit a playback path would need
```

Every reference above is verified against those trees.
