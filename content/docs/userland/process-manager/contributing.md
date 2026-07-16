---
title: "Contributing"
description: "The source lives at userland/capsuleprocessmanager/."
weight: 2
---
The source lives at `userland/capsule_process_manager/`. The whole capsule is one module tree under
`src/pm/`, one unit per file: the `App` glue in `app.rs`, the input handler in `event.rs`, the window
shape in `manifest.rs`, the renderer in `paint.rs`, the CPU sampler in `sample.rs`, the monitored rows and
refresh in `state.rs`, the decimal helper in `format.rs`, and the palette in `theme.rs` ([`src/pm/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/mod.rs#L17)).
The [sampling](/docs/userland/process-manager/sampling/) and [interface](/docs/userland/process-manager/interface/) pillars describe each of these in detail.

## Where to work

- To change what the tool watches, edit the `KNOWN` table in [`src/pm/state.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L42). Each entry is a label
  and the service name to resolve. The array length and the `State` fields (`rows`, `last_ticks`) are
  fixed at eight, so if you add a row there you must keep those widths in step ([`src/pm/state.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L54),
  `state.rs:58`).
- To change the sampling window or math, edit [`src/pm/sample.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs): the `MAX_ENTRIES` cap (`sample.rs:21`)
  and the delta computation (`sample.rs:34`, `sample.rs:44`), and `HISTORY` in [`src/pm/state.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L19) for
  the sparkline depth.
- To change the layout, edit [`src/pm/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs) and the column offsets at its head (`paint.rs:24`).
- To change the window shape or the input subscription, edit [`src/pm/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/manifest.rs).

The one thing not to do is add a control that acts on a process. The capsule holds no `Admin` bit and no
signalling syscall, so a kill or signal action would not have the authority to work; adding one would be a
lie in the interface. If per-process capability reporting is ever added, it belongs in the `caps` column
that currently renders `unavailable` ([`src/pm/paint.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L46)), and it needs a real kernel read behind it.

## Build and sign

Use the generated per-slug make targets. The rule template that defines them lives at
`nonos-mk/capsule.mk:158` and is pulled in through the capsule's own `Capsule.mk` (`Capsule.mk:14`):

```
  make nonos-mk-process-manager                 build the capsule ELF
  make nonos-mk-process-manager-sign            produce the id cert, manifest, and attestation trailer
  make nonos-mk-process-manager-verify          verify the signed artifacts against the trust anchor
  make nonos-mk-check-process-manager-keys      check the per-capsule signing keys exist
```

For a running desktop that includes the process manager, `make nonos-mk-process-manager-prod` builds the
full desktop GUI image (`Makefile:1187`).

## Code standards

- `cargo fmt` and a clean `cargo clippy`.
- No panics, `unwrap`, or `expect` in capsule code. The sampler returns early on a bad read rather than
  trusting it ([`src/pm/sample.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L28)), and the release profile is `panic = "abort"` (`Cargo.toml:26`).
- Modular files, one unit per file, with `mod.rs` used only for re-exports ([`src/pm/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/mod.rs#L17)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/pm/sample.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L1) and every other module.

## Source map

```
  userland/capsule_process_manager/src/pm/mod.rs      the module tree, re-exports only
  userland/capsule_process_manager/src/pm/state.rs    the KNOWN table and the fixed eight-row width
  userland/capsule_process_manager/src/pm/sample.rs   the sampling cap, delta math, and early return
  userland/capsule_process_manager/src/pm/paint.rs    the layout and column offsets
  userland/capsule_process_manager/src/pm/manifest.rs the window shape and input subscription
  userland/capsule_process_manager/Cargo.toml         the panic=abort release profile
  userland/capsule_process_manager/Capsule.mk         the include of the generated targets
  nonos-mk/capsule.mk                                 the nonos-mk-process-manager[-sign|-verify] template
  Makefile                                            the -prod image target
```

Every reference above is verified against those trees.
