---
title: "Contributing to the compositor"
description: "This page is for a contributor who wants to change the compositor."
weight: 8
---
This page is for a contributor who wants to change the compositor. It covers where the source lives, which
folder owns which behaviour, the exact steps to add an op or change compositing, how to build and sign the
capsule, and the code standards a change has to meet. For what the compositor does and how it is put
together, read the [README](/docs/userland/compositor/), the [operations](/docs/userland/compositor/operations/), the [frame pacing](/docs/userland/compositor/frame-pacing/),
the [scene and damage](/docs/userland/compositor/scene-and-damage/), the [GPU client](/docs/userland/compositor/gpu-client/), and the
[cursor and input](/docs/userland/compositor/cursor-and-input/) pages in this folder.

## Where the source lives

The capsule is at `userland/compositor/`. It is a `no_std`/`no_main` capsule: `_start` initialises the heap,
waits for setup, registers the `compositor` service, and enters `server::run` ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)). The
top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|--------|------|---------------|
| `src/protocol/` | the `NCMP` wire: opcodes, header, limits, decode, encode, errno | you change the frame format or add an opcode |
| `src/server/` | the request loop, batch drain, dispatch, and the eight handlers | you change what clients can request |
| `src/state/` | scene table, damage accumulator, focus, cursor, attach cache, context | you change the runtime data model |
| `src/frame_pacer/` | the tick, compositing pass, cursor sprite, vsync pacing | you change how or when a frame is drawn |
| `src/sw_blitter/` | the bounds-checked software fill and composite | you change how pixels are copied |
| `src/gfx_client/` | the outbound `NVGP` virtio-gpu client | you change how the compositor drives the driver |
| `src/setup/`, [`src/wait_for_setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs) | display bring-up and backend selection | you change how the display comes up |

## Adding or changing an op

To change what clients can request, edit the protocol and a handler:

1. Add the opcode to [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) as an `OP_*` constant, and, if the op has a fixed request length,
   a constant to [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs). Re-export both from [`src/protocol/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs) ([`protocol/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/mod.rs#L24)
   through `:35` is the re-export list).
2. Write the handler as one file under `src/server/handlers/`, taking `(ctx, sender_pid, req, body, tx)`.
   Guard the request length first and reply through `respond::status` or `respond::status_payload`; mirror
   [`handlers/damage_commit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/damage_commit.rs), which checks `body.len() != DAMAGE_COMMIT_REQ_LEN` before reading any field
   ([`handlers/damage_commit.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/damage_commit.rs#L28)) and reads fields through the `u32_at` / `u64_at` helpers
   ([`handlers/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mod.rs#L26)). Add its `pub mod` line to [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs).
3. Wire the op into the match in [`src/server/runner/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L31). An op with no payload is gated on
   `body.is_empty()` in the arm itself, the way `HEALTHCHECK` and `DISPLAY_INFO` are (`dispatch.rs:32`,
   `:41`); a payload-carrying op routes straight to its handler.

Keep the reply shape consistent: a status-only reply is `respond::status`, a reply with a data block is
`respond::status_payload` ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21), `:32`). A handler that must not reply at all returns
`Ok(())` without calling `respond`, the way `CURSOR_UPDATE` does ([`handlers/cursor_update.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/cursor_update.rs#L30)).

## Changing compositing or pacing

To change how a frame is produced, edit `src/frame_pacer/`:

- `composite.rs` for how layers are drawn: the fill colour `BACKGROUND_ARGB` (`composite.rs:22`), the
  z-order (from `z_sorted_snapshot`), the alpha rule (in the blitter), and the reap threshold
  `REAP_THRESHOLD` (`composite.rs:24`).
- `tick.rs` for the present sequence and the split between the two backends (`tick.rs:29`).
- `vsync.rs` for how the loop paces (`vsync.rs:19`).

The blitter itself is `src/sw_blitter/`. Any new blit must route every access through `Surface::row_start`
([`src/sw_blitter/mod.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sw_blitter/mod.rs#L33)) so the bounds check against `byte_len` is preserved; do not index a surface
buffer directly.

To change the outbound virtio protocol, edit `src/gfx_client/`: one op per file (`transfer.rs`,
`set_scanout.rs`, `flush.rs`, `get_primary.rs`), each building its body and checking the reply status
through `read_status`. The shared wire and timeouts live in [`src/gfx_client/wire.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gfx_client/wire.rs) and its submodules.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/compositor/Capsule.mk:17`.

```
  make nonos-mk-compositor              build the capsule ELF               capsule.mk:182
  make nonos-mk-compositor-sign         id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-compositor-verify       verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-compositor-keys   assert the per-capsule signing keys exist  capsule.mk:184
```

There is no `nonos-mk-compositor-prod` target. The compositor ships inside the full desktop image built by
`make nonos-mk-desktop-gui-prod` (`Makefile:1067`) and `make nonos-mk-full-gui-prod` (`Makefile:1093`), and
its artifacts are pulled into those builds through `$(compositor_ARTIFACTS)` (`Makefile:880`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns a status or a
  `Result<(), &'static str>`, and every fallible primitive returns a `Result` or an `Option`; the surface
  guards return `None` rather than index out of bounds ([`src/sw_blitter/mod.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sw_blitter/mod.rs#L34)).
- One unit per file. Each op is one handler file under `src/server/handlers/`, each virtio op is one file
  under `src/gfx_client/`, each scene operation is one file under `src/state/scene/`, and `mod.rs` is used
  only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/compositor/src/main.rs        _start: heap, setup, register, run; the module list
  userland/compositor/src/protocol/      opcodes, header, limits, decode, encode, errno
  userland/compositor/src/server/        drain, dispatch, respond, the eight handlers
  userland/compositor/src/state/         scene, damage, focus, cursor, attach, context
  userland/compositor/src/frame_pacer/   tick, composite, cursor, vsync
  userland/compositor/src/sw_blitter/    the bounds-checked fill and composite
  userland/compositor/src/gfx_client/    the virtio-gpu NVGP client
  userland/compositor/src/setup/         the two display backends and gfx discovery
  userland/compositor/Capsule.mk         slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                    the nonos-mk-compositor[-sign|-verify] target templates
  Makefile                               the desktop-gui-prod and full-gui-prod image targets
```

Every reference above is verified against those trees.
</content>
