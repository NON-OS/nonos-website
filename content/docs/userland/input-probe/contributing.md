---
title: "Contributing to input_probe"
description: "This page is the map a change follows: where each file lives, which one owns what, how to build and sign the capsule, and the standards a patch has to meet before it ships."
weight: 5
---
This page is the map a change follows: where each file lives, which one owns what, how to build and sign
the capsule, and the standards a patch has to meet before it ships. For what the probe is and its
identity read the [overview](/docs/userland/input-probe/); for the receive-and-render internals read
[rendering.md](/docs/userland/input-probe/rendering/).

## Module map

The whole capsule is under `userland/capsule_input_probe/src/`. Every file has one job, so a change
usually touches one of them and its immediate caller.

```
  main.rs        _start: heap init, then setup, then the never-returning run loop
  setup/
    mod.rs       bring-up: service lookup, surface register/share, scene submit, damage
    discover.rs  compositor and input_router service-name lookups
    fill.rs      the one-shot background fill of the mapped surface
  server/
    mod.rs       module glue for the server half
    runner.rs    subscribe, grab, the recv loop, the printable filter
  protocol.rs    NIRS request encode and NINP delivery decode
  clients/
    mod.rs       re-exports the three IPC clients
    compositor.rs    healthcheck, scene submit, damage commit
    display_info.rs  the display-geometry query
    input_router.rs  subscribe and grab-keyboard calls
  render/
    mod.rs       the history ring, redraw, glyph and rect draw
    font.rs      ASCII to bitmap-row mapping
    font_table.rs  the built-in letter and digit bitmaps
  state.rs       the Context struct: surface handle, geometry, ports, history buffer
```

`main.rs` is the only place that owns the process lifecycle: it initializes the heap and exits 1 on
failure, runs `setup::run` and exits 2 on failure, then hands the `Context` to `server::runner::run`,
which never returns ([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16)). Nothing else calls `mk_exit`.

## How to extend it

A change lands in exactly one seam, and the seams do not leak into each other:

- To change what the probe brings up (a different surface format, a second overlay, a health gate),
  edit [`setup/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/mod.rs). It is the only file that maps memory, registers a surface, and talks to the
  compositor during bring-up ([`src/setup/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L18)). Keep the stride guard in
  `display_info::query_display_info` intact; it is what stops the fill loop writing past the mapping
  ([`src/clients/display_info.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/display_info.rs#L50)).
- To change which events the probe acts on, edit [`server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/runner.rs). The recv loop filters on
  `INPUT_KIND_KEY_DOWN` and `on_key` gates on the printable ASCII range `0x20..=0x7E`
  ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31), [`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). A new event class is a new arm in the loop,
  not a change to the decoder.
- To change the wire format the probe speaks, edit `protocol.rs`. `encode_request` builds the 20-byte
  NIRS header and `parse_delivery` reads the 40-byte NINP frame field for field
  ([`src/protocol.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs#L15), [`src/protocol.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs#L27)). Both sides must move together with the router; the probe
  reads exactly what the router writes.
- To change how a key is drawn, edit `render/`. `push_and_draw` owns the 64-byte ring and `draw_glyph`
  walks the bitmap; adding punctuation or lower-case means extending the font tables, not the ring
  ([`src/render/mod.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L10), [`src/render/font.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/font.rs#L5)).

If a change needs a capability the probe does not hold, it does not belong in the probe. The mask is
`0x1819` and the kernel spawn mirror requests exactly those five bits and no others
([`src/userspace/capsule_input_probe/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_probe/spawn.rs#L50)). Widening it is a trust-boundary change reviewed
against the manifest ceiling, not a capsule-local edit.

## Build, sign, and run

The capsule is built and signed through the shared capsule macro, which materializes a fixed target set
for every slug from its `Capsule.mk` (`nonos-mk/capsule.mk:1`). The slug is `input-probe`
(`userland/capsule_input_probe/Capsule.mk:7`), so the targets are:

| Target | What it does | Source |
|---|---|---|
| `make nonos-mk-input-probe` | build the userland ELF for `x86_64-nonos-user` | `nonos-mk/capsule.mk:182` |
| `make nonos-mk-input-probe-sign` | sign the id cert, manifest, and zk attestation trailer | `nonos-mk/capsule.mk:261` |
| `make nonos-mk-input-probe-verify` | re-verify the manifest against the baked trust anchor | `nonos-mk/capsule.mk:263` |
| `make nonos-mk-check-input-probe-keys` | assert the publisher seeds and pubs exist | `nonos-mk/capsule.mk:184` |

The manifest re-signs whenever the ELF changes, so `payload_hash` never drifts from the binary
(`nonos-mk/capsule.mk:221`). To boot the probe end to end, build the inject image, which pulls in the
proof, ps2, virtio-gpu, router, compositor, and probe artifacts and builds the kernel under the
`microkernel-input-probe,input-probe-inject` features (`Makefile:1143`). The serial-console run target is
`make nonos-mk-run-input-probe-inject-serial-log` (`Makefile:1343`).

## Code standards

- No `std`. The capsule is `#![no_std]` with `alloc` for the receive buffer and history draw
  ([`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1)).
- No panics on the runtime path. Setup returns `Result` and the loop swallows a bad delivery rather than
  faulting ([`src/setup/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L18), [`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)).
- Every raw surface write stays inside the mapping and carries the invariant in a SAFETY comment; the
  clamps in `fill_rect` and `fill` are load-bearing, not decorative ([`src/render/mod.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L47),
  [`src/setup/fill.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/fill.rs#L5)).
- One job per file. A new concern is a new module under the tree above, re-exported through the relevant
  `mod.rs`, not folded into an existing file.
- Run `cargo fmt` and `cargo clippy` before sending a change.

## Source map

```
  userland/capsule_input_probe/src/          the capsule modules described above
  userland/capsule_input_probe/Capsule.mk    slug, handle, ports, mask, kernel mirror
  nonos-mk/capsule.mk                         the build/sign/verify/keys target macro
  Makefile                                    the input-probe inject image and serial-run targets
  src/userspace/capsule_input_probe/spawn.rs the kernel spawn mirror and requested caps
```

Every reference above is verified against those trees.
