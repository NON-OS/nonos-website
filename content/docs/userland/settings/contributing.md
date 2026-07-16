---
title: "Contributing to capsule_settings"
description: "This page is for a contributor who wants to change settings."
weight: 5
---
This page is for a contributor who wants to change settings. It covers where the source lives, which
folder owns which behaviour, the exact steps to add a setting, how to build and sign the capsule, and the
code standards a change has to meet. For what settings does and how it is put together, read the
[README](/docs/userland/settings/), the [panels and controls reference](/docs/userland/settings/panels/), the
[policy client and write gate](/docs/userland/settings/policy/), the [rendering](/docs/userland/settings/rendering/), and the [input](/docs/userland/settings/input/) pages
in this folder.

## Where the source lives

The capsule is at `userland/capsule_settings/`. It is a `no_std`/`no_main` app-skeleton GUI app: `_start`
hands `Settings::new` to the skeleton's `run`, and the runtime owns the surface, window, input
subscription, and paint loop ([`userland/capsule_settings/src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_settings/src/main.rs#L28)). The module tree is declared in
[`src/settings/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/mod.rs#L17).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/settings/schema/` | the field list and the three tab groups | you add a field or move it between tabs |
| `src/settings/state/` | the model: category, cursor, scroll, value cache, edit buffer, status | you change what the capsule remembers |
| `src/settings/event/` | input handlers: keys, pointer, adjust, toggle, the string editor, the write paths | you change a keybinding or a write path |
| `src/settings/ipc/` | the policy client: lookup, read, the four setters, `call`, the shell toast | you change how the capsule talks to the policy service |
| `src/settings/paint/` | the renderer: header, tabs, rows, per-kind values, scroll, status | you change how a frame is drawn |
| `src/settings/{app,manifest,theme}.rs` | the `App` impl, the window manifest, the palette | you change the window or the colours |

Most of the field metadata (names, labels, kinds, ranges, enum tables) is not in this capsule at all. It
lives in the shared `userland/policy_proto/` crate, which both settings and the policy service depend on,
so a field's behaviour is defined once and both sides agree.

## Adding a setting

There are two crates to touch, and the schema wiring in the capsule is the load-bearing part. No new event
or paint code is needed for a new field of an existing kind: the row's behaviour follows from its kind.

1. Add the field to the shared protocol. Give it an id in the right category range in
   [`userland/policy_proto/src/field.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs) (`0x01xx` user, `0x02xx` kernel, `0x03xx` identity), a label in
   `field_label.rs`, a kind in `field_kind.rs`, and, if it is numeric, a max in `field_max.rs`. For an
   enum, add a labels table and wire it into `enum_table.rs`. Then teach the policy service to store it by
   adding the matching store field and handler under `userland/capsule_policy/src/store/`.

2. Register it in the capsule schema. Add the field to `ALL_FIELDS`
   ([`src/settings/schema/all_fields.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/all_fields.rs#L19)) so it gets a cache slot and is hydrated at startup, and add it
   to the right group in `visible_for` ([`src/settings/schema/visible_for.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/visible_for.rs#L19)) so it shows up as a row on
   a tab. A field in `ALL_FIELDS` but not in any `visible_for` group is hydrated and writable but never
   drawn.

To add a new control kind beyond bool, u8, i8, and string, you would extend the kind constants in the
shared crate, the `adjust` and `toggle_or_inc` dispatch ([`src/settings/event/adjust.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/adjust.rs#L29),
[`src/settings/event/toggle_or_inc.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/toggle_or_inc.rs#L29)), the per-kind paint renderers (`src/settings/paint/`), and the
matching setter and store handler. The four existing kinds cover every field today.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_settings/Capsule.mk:14`.

```
  make nonos-mk-settings              build the capsule ELF               capsule.mk:182
  make nonos-mk-settings-sign         id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-settings-verify       verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-settings-keys   assert the per-capsule signing keys exist  capsule.mk:184
```

For a bootable desktop image that includes settings:

```
  make nonos-mk-settings-prod         full desktop GUI image (maps to nonos-mk-desktop-gui-prod)  Makefile:1186
```

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every write reports an error as a status
  line and leaves the cache unchanged, never a panic; the release profile is `panic = "abort"`.
- One unit per file. Each event handler, each setter, and each paint pass is its own file, and `mod.rs` is
  used only for re-exports, matching the existing tree ([`src/settings/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/mod.rs), [`src/settings/event/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/mod.rs),
  [`src/settings/ipc/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/mod.rs), [`src/settings/paint/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/mod.rs)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  existing module.

## Source map

```
  userland/capsule_settings/src/main.rs              _start -> run(Settings::new)
  userland/capsule_settings/src/settings/mod.rs      the module tree
  userland/capsule_settings/src/settings/schema/     the field list and tab groups
  userland/capsule_settings/src/settings/state/      the model
  userland/capsule_settings/src/settings/event/      input and write paths
  userland/capsule_settings/src/settings/ipc/        the policy client
  userland/capsule_settings/src/settings/paint/      the renderer
  userland/capsule_settings/Capsule.mk               slug, ports, mask; includes the generated targets
  userland/policy_proto/                             the shared Field enum, labels, kinds, ranges, enum tables
  userland/capsule_policy/                           the policy service that owns the store and gates writes
  nonos-mk/capsule.mk                                the nonos-mk-settings[-sign|-verify] target templates
  Makefile                                           the -prod image target
```

Every reference above is verified against those trees.
