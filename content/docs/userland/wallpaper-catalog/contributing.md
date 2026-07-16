---
title: "Contributing to capsule_wallpaper_catalog"
description: "This page is for a contributor who wants to add a wallpaper or change the catalog."
weight: 3
---
This page is for a contributor who wants to add a wallpaper or change the catalog. It covers where the
source lives, which folder owns which behaviour, the exact steps to add an image, how to build and sign
the capsule, and the code standards a change has to meet. For what the catalog does and how the wire
protocol works, read the [README](/docs/userland/wallpaper-catalog/) and the [protocol and catalog](/docs/userland/wallpaper-catalog/protocol/) page. For
runtime failures, see the [debugging](/docs/userland/wallpaper-catalog/debugging/) page.

## Where the source lives

The capsule is at `userland/capsule_wallpaper_catalog/`. It is a `no_std`/`no_main` app: `_start`
initializes the heap, registers the service, and enters `server::run`, which never returns
([`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)). The top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/bootstrap/` | the service name, the port, and registration | you change the service name or port |
| `src/protocol/` | the wire header, op codes, errnos, and size limits | you add an operation or change a limit |
| `src/server/` | the receive loop, the per-op handlers, and reply framing | you change how a request is dispatched or a reply is framed |
| `src/catalog/` | the four embedded image groups and the count/size/slug/bytes accessors | you add, remove, or reorder a wallpaper |

The images themselves are not in the capsule tree. They live in `nonos-data/wallpapers/` as JPEG files
and are pulled into the binary by the `include_bytes!` in each group under `src/catalog/entries/`.

## Adding a wallpaper

There are two edits: drop the file in, then reference it from a group. Order matters, because the catalog
index is flat across the groups and clients address images by that index.

1. Put the JPEG in `nonos-data/wallpapers/`. The build wires it in automatically: `CAPSULE_EXTRA_DEPS` is
   the sorted wildcard of every `nonos-data/wallpapers/*.jpg` (`Capsule.mk:13`), so a new file becomes a
   build dependency without a Makefile edit. Adding a file with no entry that references it only makes the
   disk count diverge from the served count, the way `special-variant-6.jpg` already does; the file has to
   be referenced by an `Entry` to be served.

2. Add an `Entry` to the right group under `src/catalog/entries/`. Pick the group its slug belongs to
   (`field_focus.rs`, `hardware_aesthetic.rs`, `network_topology.rs`, or `special_variant.rs`), and add a
   line of the same shape as the existing ones, for example
   `Entry { slug: b"field-focus-14", bytes: include_bytes!("../../../../../nonos-data/wallpapers/field-focus-14.jpg") }`
   ([`src/catalog/entries/field_focus.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/field_focus.rs#L20) is the reference shape). `count` and `entry_at` recompute from
   the group lengths on every call ([`src/catalog/count.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/count.rs#L19), [`src/catalog/entries/entry_at.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/entry_at.rs#L20)), so no
   count constant has to be updated.

Two things to keep in mind. Appending to a group is safe; inserting in the middle or reordering shifts
every later index, and the policy store selects a wallpaper by that flat index (its default is 52,
[`userland/capsule_policy/src/store/defaults/store.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/store/defaults/store.rs#L45)), so an insert silently repoints existing
selections. And the slug string in the `Entry` is what a client matches on `OP_GET_SLUG`; it does not have
to equal the file stem (`special-variant-6` maps to `special-variant-6-1080p.jpg`,
[`src/catalog/entries/special_variant.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/special_variant.rs#L27)), but keeping them equal avoids confusion.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:156` and pulled in through
`userland/capsule_wallpaper_catalog/Capsule.mk:18`.

```
  make nonos-mk-wallpaper_catalog              build the capsule ELF            capsule.mk:182
  make nonos-mk-wallpaper_catalog-sign         id cert, manifest, attestation   capsule.mk:261
  make nonos-mk-wallpaper_catalog-verify       verify artifacts vs trust anchor capsule.mk:263
  make nonos-mk-check-wallpaper_catalog-keys   assert the per-capsule signing keys exist capsule.mk:184
```

A new image changes the binary, so the capsule has to be rebuilt and re-signed: the manifest carries the
payload hash and the signing step recomputes it. The catalog's artifacts are part of the desktop image's
verify and pack sets (`Makefile:723`, `Makefile:1076`), so a stale unsigned catalog fails the image
verify.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. A missing index returns `None` from the
  accessor and an `E_NOT_FOUND` reply from the handler; an out-of-range chunk offset returns `E_RANGE`;
  neither panics.
- One unit per file. Each image group is its own file under `src/catalog/entries/`, each handler its own
  file under `src/server/handlers/`, and `mod.rs` is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_wallpaper_catalog/src/main.rs                      _start; heap, register, run
  userland/capsule_wallpaper_catalog/src/catalog/entries/             the four groups; add an Entry here
  userland/capsule_wallpaper_catalog/src/catalog/count.rs             count recomputed from group lengths
  userland/capsule_wallpaper_catalog/src/catalog/entries/entry_at.rs  the flat index walk
  userland/capsule_wallpaper_catalog/Capsule.mk                       slug, endpoints, caps 0x19, asset deps
  nonos-data/wallpapers/                                              the JPEG files
  nonos-mk/capsule.mk                                                 the generated build, sign, verify targets
  Makefile                                                            the image verify and pack sets
  userland/capsule_policy/src/store/defaults/store.rs                 default selection index 52
```

Every reference above is verified against those trees.
