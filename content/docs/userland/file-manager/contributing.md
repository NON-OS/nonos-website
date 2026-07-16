---
title: "Contributing"
description: "The source lives at userland/capsulefilemanager/."
weight: 6
---
The source lives at `userland/capsule_file_manager/`. Everything is under `src/fm/`, one unit per file,
and [`src/fm/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/mod.rs) lists the modules and re-exports `FileManager` ([`src/fm/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/mod.rs#L17), `:80`). The
groupings this documentation follows are:

- input: `event_dispatch.rs`, `event_mode.rs`, `event_modes.rs`, `event_browse.rs`, `event_mouse.rs`,
  `event_move.rs`, `event_open.rs`, `event_parent.rs`, `scroll.rs` (see [input.md](/docs/userland/file-manager/input/)).
- actions: `event_actions.rs`, `selection*.rs`, `clipboard.rs`, `clipboard_paste.rs`, `duplicate.rs`,
  `perms.rs`, `prompt_start.rs`, `prompt.rs`, `prompt_commit.rs`, `prompt_run_op.rs` (see
  [actions.md](/docs/userland/file-manager/actions/)).
- listing: `state.rs`, `state_new.rs`, `entries.rs`, `refresh.rs`, `refresh_meta.rs`, `view.rs`,
  `filter.rs`, `view_sort*.rs`, `sort_*.rs` (see [listing.md](/docs/userland/file-manager/listing/)).
- preview: `preview.rs`, `preview_hex.rs`, `preview_text.rs`, `preview_is_binary.rs`, `preview_key.rs`,
  `preview_info.rs`, `preview_paint.rs`, `preview_clip.rs` (see [preview.md](/docs/userland/file-manager/preview/)).
- rendering: `manifest.rs`, `paint.rs`, `paint_*.rs`, `layout.rs`, `theme.rs`, `help.rs`, and the
  file-decoration units (see [rendering.md](/docs/userland/file-manager/rendering/)).

## Add a single-key action

A browse action is a new single-key operation over the selection or the cursor.

1. Write the operation as its own module under `src/fm/`, taking `&mut State`. Get the acting set with
   `crate::fm::selection_acting::acting` if it should work on the selection or the cursor, run the vfs
   client call, then `refresh` and set a status. Follow `duplicate.rs` or `perms.rs` as the template
   ([`src/fm/duplicate.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/duplicate.rs#L28), [`src/fm/perms.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/perms.rs#L29)).
2. Wire the key into the match in [`src/fm/event_actions.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/event_actions.rs#L28) and return `EventOutcome::Repaint`.
3. Add a line to the in-app help table in [`src/fm/help.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/help.rs#L27) so the `?` overlay documents it.

## Add a prompt-driven operation

A prompt-driven operation collects a name first.

1. Add a `PromptKind` variant in [`src/fm/state.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/state.rs#L34).
2. Add a browse key that calls `start_prompt` with a status hint in [`src/fm/event_browse.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/event_browse.rs#L43).
3. Add the matching arm in [`src/fm/prompt_run_op.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/prompt_run_op.rs#L28).

## Reach a new vfs op

The vfs client is outside the capsule, in the app skeleton at
`userland/app_skeleton/src/clients/vfs/`, and the opcodes are in that folder's `types.rs`. To use an op
the client does not expose yet, add a thin wrapper alongside the existing `mkdir.rs`, `rename.rs`, and
`chmod.rs`, using the opcode from `types.rs`, then call it from the capsule. The capsule holds no
FileSystem capability of its own; every op is an IPC request that `vfs_pool` decides on (see
[README](/docs/userland/file-manager/#identity)).

## Build and sign

The build and sign targets are generated per slug from the `Capsule.mk` in the capsule directory, which
sets the `CAPSULE_*` variables and includes `nonos-mk/capsule.mk`
(`userland/capsule_file_manager/Capsule.mk:14`, `nonos-mk/capsule.mk:158`):

```
  make nonos-mk-file-manager             build the capsule ELF          (capsule.mk:182)
  make nonos-mk-file-manager-sign        cert, manifest, attestation    (capsule.mk:261)
  make nonos-mk-file-manager-verify      verify against the trust anchor (capsule.mk:263)
  make nonos-mk-check-file-manager-keys  check the per-capsule signing keys exist (capsule.mk:184)
```

For a running desktop that includes the file manager, `make nonos-mk-file-manager-prod` builds the full
desktop GUI image (`Makefile:1166`).

## Code standards

- `cargo fmt` and a clean `cargo clippy`.
- No panics, `unwrap`, or `expect` in capsule code. Every action reports errors as a status line and
  swallows the client's `Result`; the release profile is `panic = "abort"`
  ([`userland/capsule_file_manager/Cargo.toml:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_file_manager/Cargo.toml#L26)).
- Modular files, one unit per file, with `mod.rs` used only for re-exports ([`src/fm/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/mod.rs)).
- The AGPL header at the top of every source file, matching the header on every existing module.

## Source map

Everything here is drawn from `userland/capsule_file_manager/` (the `src/fm/` tree, `Cargo.toml`, and
`Capsule.mk`), the generated targets in `nonos-mk/capsule.mk`, the desktop-image target in `Makefile`,
and the shared vfs client under `userland/app_skeleton/src/clients/vfs/`. Every reference above is
verified against those trees.
