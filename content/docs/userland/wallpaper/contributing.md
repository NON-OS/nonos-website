---
title: "Contributing to capsule_wallpaper"
description: "This page is for a contributor who wants to change the wallpaper capsule."
weight: 5
---
This page is for a contributor who wants to change the wallpaper capsule. It covers where the source
lives, which folder owns which behaviour, the two most likely changes and exactly where to make them, the
build and sign steps, and the code standards a change has to meet. For what the capsule does and how it is
put together, read the [README](/docs/userland/wallpaper/), the [control protocol](/docs/userland/wallpaper/operations/), and the
[selection and paint pipeline](/docs/userland/wallpaper/pipeline/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_wallpaper/`. It is a `no_std`/`no_main` app: `_start` initializes the
heap, calls `wait_for_setup` to retry setup until the compositor is up, and then enters `server::run`,
which never returns ([`userland/capsule_wallpaper/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/main.rs#L37)). The top-level modules are declared
there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NWLP` wire header, op codes, errnos, limits, parse and encode | you change the request or reply format |
| `src/server/` | the drain loop, the op dispatch, the five handlers, reply framing, the fade pacer | you change how a request is handled or add an op |
| `src/subscriber/` | the 300-tick policy poll and the fetch/decode/paint/commit apply | you change when or how a wallpaper change is picked up |
| `src/policy_client/` | resolving the policy service and reading `Field::Wallpaper` | you change how selection is read |
| `src/catalog_client/` | resolving the catalog and streaming an image in size + chunk calls | you change how image bytes are fetched |
| `src/paint/` | the flat fill, the in-process JPEG decode, and the stretch blit | you change how catalog and embedded images are decoded or scaled |
| `src/decode_client/` | the inline decode header, the png/bmp/lz4/jpeg decode, and its stretch | you change how inline `SET_WALLPAPER` images are handled |
| `src/compositor_client/` | the `NCMP` calls: health, display_info, scene_submit, damage_commit | you change how the surface is registered or damage is committed |
| `src/setup/` | compositor discovery, backing mmap, surface register, initial apply | you change the boot-time bring-up |
| `src/state/` | the runtime `Context`, the fade timeline, the fit-policy enum | you change the live state model |

## The two changes you are most likely to make

Wire the fit policy into scaling. Today both paint paths always nearest-neighbor stretch the image to the
full backing size and neither consults the stored `Policy`, so `Fill`, `Fit`, `Stretch`, `Center`, and
`Tile` all render identically ([`src/paint/blit_argb.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/blit_argb.rs#L31), [`src/decode_client/seq.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs#L51),
[`src/state/policy.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/policy.rs#L19)). The fit style is already stored on the context and reported through
`GET_WALLPAPER`, so the work is entirely in the two paint functions: `blit_argb` for catalog and embedded
images and `paint_stretch` under [`src/decode_client/seq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs) for inline images. Both take the source and
destination dimensions already; a policy argument threaded from `ctx.policy` is the natural shape.

Change how images are fetched. The streaming client is [`src/catalog_client/fetch_image.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/fetch_image.rs); the size and
chunk bounds are the constants at the top of that file and in [`src/catalog_client/proto.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog_client/proto.rs) (the 4096-byte
chunk, the 2,000,000-byte image cap). Keep the reply validation that echoes the op, index, and offset, and
keep the reassembled-length check, since those are what make a hostile or buggy catalog safe to stream
from.

## Build and sign

The per-slug make targets are generated from the `define` block at `nonos-mk/capsule.mk:158` and pulled in
through `userland/capsule_wallpaper/Capsule.mk:15`.

```
  make nonos-mk-wallpaper               build the capsule ELF
  make nonos-mk-wallpaper-sign          produce the id cert, manifest, and attestation trailer
  make nonos-mk-wallpaper-verify        verify the signed artifacts against the trust anchor
  make nonos-mk-check-wallpaper-keys    check the per-capsule signing keys exist
```

`make nonos-mk-wallpaper` is also listed explicitly in the top-level `.PHONY` (`Makefile:31`). There is no
wallpaper-specific `-prod` target; the wallpaper is built and signed as part of the desktop GUI image
alongside the other fleet capsules, its `Capsule.mk` included from the top-level Makefile
(`Makefile:681`), its catalog neighbor from `Makefile:648`.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as a
  status word in the reply, never a panic; the release and dev profiles are both `panic = "abort"`
  (`Cargo.toml:31`, `Cargo.toml:38`).
- One unit per file. Each op handler, each catalog call, and each paint routine is its own file, and
  `mod.rs` is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  other module.

## Source map

```
  userland/capsule_wallpaper/src/main.rs             _start -> heap init -> wait_for_setup -> server::run
  userland/capsule_wallpaper/src/protocol/           the NWLP wire format
  userland/capsule_wallpaper/src/server/             drain, dispatch, handlers, respond, fade pacer
  userland/capsule_wallpaper/src/subscriber/         the policy poll and apply
  userland/capsule_wallpaper/src/catalog_client/     the streaming image fetch
  userland/capsule_wallpaper/src/paint/blit_argb.rs  the stretch to wire the fit policy into
  userland/capsule_wallpaper/src/decode_client/seq.rs  the inline stretch to wire the fit policy into
  userland/capsule_wallpaper/src/state/policy.rs     the fit-style enum
  userland/capsule_wallpaper/Capsule.mk              slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                the nonos-mk-wallpaper[-sign|-verify] target templates
  Makefile                                           the .PHONY entry and the desktop-image includes
```

Every reference above is verified against those trees.
