---
title: "Contributing to capsule_driver_i2c_hid"
description: "This page is for a contributor who wants to change the i2c-HID driver."
weight: 3
---
This page is for a contributor who wants to change the i2c-HID driver. It covers where the source lives,
which folder owns which behaviour, how the absolute Precision Touchpad path would be added, the build and
sign steps, and the code standards a change has to meet. For what the driver does and how it is put
together, read the [README](/docs/userland/driver-i2c-hid/), the [protocol and discovery](/docs/userland/driver-i2c-hid/protocol/) page, and the
[report path](/docs/userland/driver-i2c-hid/input/) page.

## Where the source lives

The capsule is at `userland/capsule_driver_i2c_hid/`. It is a `no_std`/`no_main` binary: `_start`
initialises the heap, runs `setup::run`, and hands the built `State` to `server::run`; any setup failure
exits with code 1 ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). The module tree is declared there ([`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23)). The
kernel-side embed and verified spawn are mirrored at `src/userspace/capsule_driver_i2c_hid/`.

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/hid/` | descriptor discovery: address scan, descriptor validation, deriving the input register and length | you change how the device is found or which fields arm the poll |
| `src/i2c_client/` | the client side of the `NI2C` controller protocol: `write_read`, the wire encode/decode, the request-id counter | you change how the driver talks to `driver.i2c_pci0` |
| `src/input/` | the report path: poll, parse, publish, post | you change what a report decodes to or which events are posted |
| `src/protocol/` | the `NHID` server wire format: header, decode, encode, ops, errno, limits | you change the request or reply frame or add an error code |
| `src/server/` | the request loop and the op handlers | you add an operation or change the loop |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs), [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | bring-up and the shared `State` | you add a field the loop or a handler needs |

Each `mod.rs` under this tree is re-exports only ([`src/hid/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/mod.rs), [`src/protocol/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs),
[`src/i2c_client/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/mod.rs), [`src/input/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/mod.rs), [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs)), matching the one-unit-per-file layout.

## Adding a server operation

There are four edits, and the dispatch wiring is the load-bearing one.

1. Add the constant in [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs), next to `OP_DESCRIPTOR`, and re-export it from
   [`src/protocol/mod.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L13).
2. Write the handler as one file under `src/server/handlers/`, matching the shape of
   [`src/server/handlers/descriptor.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/descriptor.rs): build the reply body and call `respond::send` with the status and
   the body. Re-export it from [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs).
3. Wire it into the dispatch match in [`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43). Keep the `if body.is_empty()` guard so an
   op with a stray body still falls to the `E_INVAL` arm ([`src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L53)).
4. If the handler needs new state, add the field to `State` ([`src/state.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L1)) and initialise it in
   `State::new` ([`src/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L17)).

## Adding the absolute Precision Touchpad path

This branch decodes a relative-pointer report and posts `INPUT_KIND_POINTER_REL`
([`src/input/parse_report.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/parse_report.rs#L19), [`src/input/publish.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/publish.rs#L28)). A separate branch carries the absolute
multi-contact path; if that work were brought here, these are the modules it would touch, and they are
worth knowing even if you only read the relative build.

1. Switch the device into absolute mode. HID-over-I2C sets a feature report to select the input mode. That
   is a new `write_read` in a setup step, writing the mode feature report through the existing I2C client
   ([`src/i2c_client/transfer.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/i2c_client/transfer.rs#L7)); no new capability is needed, since it is still an `OP_TRANSFER` to
   `driver.i2c_pci0`.
2. Parse the report descriptor to find the touch report id and the contact field offsets, rather than the
   current fixed relative layout. That is a new module under `src/hid/`, feeding the offsets into a new
   parser under `src/input/` alongside `parse_report`.
3. Extend the sample. `MouseSample` holds `buttons, dx, dy, wheel` ([`src/input/sample.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/sample.rs#L17)); an absolute
   report needs `x`, `y`, and per-contact fields, so the struct grows or a new sample type is added.
4. Post absolute events. `publish` would post `INPUT_KIND_POINTER_ABS` with `x`/`y` set through the `post`
   wrapper ([`src/input/post.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/post.rs#L19)), which already accepts a full `InputEvent`. The `InputSource`
   capability already in the mask covers absolute posts; no mask change is required.
5. Pace the read on a doorbell. The doorbell path needs an `Irq` grant, which this capsule does not hold,
   so it is a capability and spawn change, not just a source change. It is the one part that is not a local
   edit: the mask in `Capsule.mk:14` and the requested caps in `spawn.rs:42` would both have to add the
   `Irq` bit, and the broker would have to grant it. Until then the loop stays on the 2 ms poll cadence
   ([`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through the
`include nonos-mk/capsule.mk` line at `userland/capsule_driver_i2c_hid/Capsule.mk:17`.

```
  make nonos-mk-driver-i2c-hid               build the capsule ELF
  make nonos-mk-driver-i2c-hid-sign          produce the id cert, manifest, and attestation trailer
  make nonos-mk-driver-i2c-hid-verify        verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-i2c-hid-keys    check the per-capsule signing keys exist
```

For a kernel image that includes this driver, `make nonos-mk-driver-i2c-hid-prod` builds the
`microkernel-driver-i2c-hid` profile, which pulls in the proof-io, i2c-pci, and i2c-hid artifacts together
(`Makefile:965`). A profile check without a full build is
`cargo check --no-default-features --features microkernel-driver-i2c-hid`.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every failure returns through an
  `Option`/`Result` or a pushed error status, and the release profile is `panic = "abort"`
  (`Cargo.toml:18`).
- One unit per file. New handlers, parsers, and wire units are one per file under the folder that owns
  them, and `mod.rs` is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file. The `src/input/*` files carry the full header
  byte for byte (for example [`src/input/poll.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input/poll.rs#L1)); a few older files under `src/hid/`, `src/protocol/`,
  `src/server/`, and `src/i2c_client/` predate the header sweep and open with code instead (for example
  [`src/hid/descriptor.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/descriptor.rs#L1) and [`src/protocol/header.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L1)). Any new file must include the header, and
  touching an old one is a good chance to add it.

## Source map

```
  userland/capsule_driver_i2c_hid/src/main.rs           _start -> setup::run -> server::run; the modules
  userland/capsule_driver_i2c_hid/src/setup.rs          run + reprobe
  userland/capsule_driver_i2c_hid/src/state.rs          the shared State
  userland/capsule_driver_i2c_hid/src/hid/              descriptor discovery
  userland/capsule_driver_i2c_hid/src/i2c_client/       the NI2C client to driver.i2c_pci0
  userland/capsule_driver_i2c_hid/src/input/            the report path
  userland/capsule_driver_i2c_hid/src/protocol/         the NHID server wire format
  userland/capsule_driver_i2c_hid/src/server/           the request loop and op handlers
  userland/capsule_driver_i2c_hid/Cargo.toml            panic = abort, the release profile
  userland/capsule_driver_i2c_hid/Capsule.mk            slug, ports, mask; includes the generated targets
  src/userspace/capsule_driver_i2c_hid/spawn.rs         the kernel-side verified spawn and cap request
  nonos-mk/capsule.mk                                   the nonos-mk-driver-i2c-hid[-sign|-verify] templates
  Makefile                                              the -prod image target
```

Every reference above is verified against those trees.
