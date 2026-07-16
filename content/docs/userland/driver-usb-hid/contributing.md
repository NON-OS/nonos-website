---
title: "Contributing to capsule_driver_usb_hid"
description: "This page is for a contributor changing the USB HID driver."
weight: 7
---
This page is for a contributor changing the USB HID driver. It covers where the source lives, which
folder owns which behaviour, how to add a service op or extend the HID parse, and the build and sign
steps. For what the driver does and how it is put together, read the [README](/docs/userland/driver-usb-hid/), the
[service protocol](/docs/userland/driver-usb-hid/protocol/), the [enumeration](/docs/userland/driver-usb-hid/enumeration/), and the
[input-post path](/docs/userland/driver-usb-hid/input-post/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_usb_hid/`. It is a `no_std`/`no_main` driver capsule, not a
GUI app: `_start` initializes the heap and calls `orchestrator::run`, which never returns
([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). The seven top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/descriptors/` | the config-descriptor walk and HID-class classification | you change how a device is recognized as keyboard/mouse/tablet |
| `src/hid/` | report normalization and the input-post path | you change the keymap, a report parse, or how events reach the ring |
| `src/orchestrator/` | discovery, the boot-protocol binding, and the poll loop | you change bring-up or the drain/rescan cadence |
| `src/protocol/` | the `NUHI` wire format, ops, limits, errno | you change the service wire format or add an op code |
| `src/server/` | receive, dispatch, and the request handlers | you add or change a service op |
| `src/state/` | the shared `State`: parsers plus counters | you add a counter or a piece of shared runtime state |
| `src/xhci/` | the `driver.xhci0` transport client | you call a new transport op |

Keep controller mechanics out of this capsule. PCI, MMIO, IRQ, DMA, the xHCI rings, and interrupt
scheduling belong in `driver.xhci0`; a new hardware op is an `NXHC` op there, called through
`src/xhci/`. This capsule holds no `Driver`, `Mmio`, `Irq`, `Dma`, or `Pio` bit
(`Capsule.mk:15`), so it cannot do otherwise.

## Adding a service op

There are three edits.

1. Add the op code to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and re-export it from [`src/protocol/mod.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L33), next to
   the existing `OP_*` codes.
2. Write the handler as one file under `src/server/handlers/`, exposing a `pub fn handle(...)` that
   builds its reply through `respond::status` for a bare status or `respond::payload` for a body, and
   never panics; declare it in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17). The state ops
   ([`src/server/handlers/get_state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_state.rs#L21)) and poll ops ([`src/server/handlers/poll_keys.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_keys.rs#L21)) are the
   reference shape for a payload reply.
3. Wire the op into the match in [`src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L22). Gate it on an empty body in the match
   arm if it takes no input, the way the poll and state ops do ([`src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L27)), or
   validate the body length inside the handler the way the feed ops do
   ([`src/server/handlers/feed_key.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/feed_key.rs#L22)). A body that does not fit an op's expectation returns
   `E_INVAL` through the dispatch fall-through ([`src/server/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L33)).

## Extending the HID parse or the input mapping

Edit the relevant unit under `src/hid/`. The keyboard diff is [`src/hid/keyboard/feed.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keyboard/feed.rs), the
usage-to-ASCII mapping is [`src/hid/keymap.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/keymap.rs) and [`src/hid/punctuation.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/punctuation.rs), the navigation-key and
flag mapping is [`src/hid/post_key.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_key.rs), the mouse is [`src/hid/mouse.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mouse.rs) with its post in
[`src/hid/post_mouse.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_mouse.rs), and the absolute tablet path is [`src/hid/tablet.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/tablet.rs). The actual
`mk_input_event_post` call is centralized in [`src/hid/post_wire.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs), so a change to how any event
reaches the ring belongs there and nowhere else. If a new device shape needs a new endpoint kind, add
it to `HidKind` ([`src/descriptors/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/types.rs#L26)) and to the classification in
[`src/descriptors/binding.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/binding.rs#L32) and the routing in [`src/orchestrator/poll/feed_report.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/feed_report.rs#L29).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_usb_hid/Capsule.mk:17`.

```
  make nonos-mk-driver-usb-hid                build the capsule ELF
  make nonos-mk-driver-usb-hid-sign           id cert, manifest, attestation trailer
  make nonos-mk-driver-usb-hid-verify         verify the signed artifacts vs the trust anchor
  make nonos-mk-check-driver-usb-hid-keys     assert the per-capsule signing keys exist
```

For a running kernel that includes the driver, `make nonos-mk-driver-usb-hid-prod` builds the kernel
with the `microkernel-driver-usb-hid` feature, staging the proof, xHCI, and USB HID artifacts together
(`Makefile:980`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns an error as a
  signed status word, never a panic; the release profile is `panic = "abort"`
  ([`userland/capsule_driver_usb_hid/Cargo.toml:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_driver_usb_hid/Cargo.toml#L26)).
- One unit per file. New ops are one handler per file under `src/server/handlers/`, and `mod.rs` is
  used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  src/main.rs                        _start -> heap_init -> orchestrator::run; the seven modules
  src/protocol/ops.rs                the OP_* codes to extend
  src/protocol/mod.rs                the protocol re-exports
  src/server/dispatch.rs             the op-code match to wire a new op into
  src/server/handlers/mod.rs         the handler module list
  src/server/handlers/               the reference handler shapes
  src/hid/                           the parsers and the centralized post_wire call
  src/descriptors/types.rs           HidKind and the class constants
  src/descriptors/binding.rs         the classification to extend for a new kind
  src/orchestrator/poll/feed_report.rs   the kind-to-parser routing
  userland/capsule_driver_usb_hid/Capsule.mk   slug, handle, ports, mask; includes capsule.mk
  userland/capsule_driver_usb_hid/Cargo.toml   the panic = "abort" release profile
  nonos-mk/capsule.mk                the generated nonos-mk-driver-usb-hid[-sign|-verify] targets
  Makefile                           the -prod image target
```

Every reference above is verified against those trees.
