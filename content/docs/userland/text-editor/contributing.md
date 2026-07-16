---
title: "Contributing to capsule_text_editor"
description: "This page is for a contributor who wants to change the editor."
weight: 3
---
This page is for a contributor who wants to change the editor. It covers where the source lives, how the
tree is laid out, the exact steps to add a key action or a chord, how to build and sign the capsule, and
the code standards a change has to meet. For what the editor does and how it is put together, read the
[README](/docs/userland/text-editor/), the [editing](/docs/userland/text-editor/editing/) page, and the [file-io](/docs/userland/text-editor/file-io/) page in this folder.

## Where the source lives

The capsule is at `userland/capsule_text_editor/`. It is a `no_std`/`no_main` app-skeleton GUI app:
`_start` hands `Editor::new` to the skeleton's `run`, and the runtime owns the surface, window, input
subscription, and paint loop ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). There is one top-level module, `editor`, declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

The `editor` module is flat: no subfolders, one unit per file, and `mod.rs` holds the module list and a
single re-export of `Editor` ([`src/editor/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/mod.rs#L17), [`src/editor/mod.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/mod.rs#L45)). The files group by role.

| Files | Own | Touch them when |
|---|---|---|
| `app.rs`, `state.rs`, `state_new.rs` | the `App` impl and the `State` model | you change the document model or the initial state |
| `event.rs`, `on_nav.rs`, `insert.rs`, `backspace.rs` | the key router and the editing and scroll actions | you change a keybinding or how an edit works |
| `on_ctrl.rs`, `ctrl_open.rs`, `ctrl_save.rs`, `ctrl_copy.rs`, `ctrl_paste.rs`, `path_prompt.rs`, `notify.rs`, `resolve_owner_pid.rs` | the chords, the prompt, and the IPC to vfs, clipboard, and the shell | you change a file, clipboard, or notify path |
| `paint.rs`, `layout.rs`, `theme.rs`, `visible_rows.rs`, `visual_lines.rs`, `end_position.rs`, and the scroll helpers | the renderer and the wrap and scroll geometry | you change how a frame is drawn or how the view scrolls |
| `manifest.rs` | the window manifest (title, id, size, input mask) | you change the window's shape or input subscription |

## Adding a key action

There are two edits, and the router wiring is the load-bearing one.

1. Write the handler as its own file under `src/editor/`, following the shape already in the tree. An
   editing helper is a method on `State` returning a `bool` for changed-or-not, the way `insert` and
   `backspace` are ([`src/editor/insert.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/insert.rs#L20), [`src/editor/backspace.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/backspace.rs#L20)). A command that talks to a
   service is a `pub(super) fn action(state: &mut State) -> EventOutcome` that sets a status line and
   returns `Repaint`, the way `ctrl_copy` and `ctrl_paste` are ([`src/editor/ctrl_copy.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_copy.rs#L21),
   [`src/editor/ctrl_paste.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_paste.rs#L22)). Register the module in [`src/editor/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/mod.rs#L17).

2. Wire it into the right router. A plain editing key belongs in the `match` in [`src/editor/event.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L39).
   A scroll or view key belongs in [`src/editor/on_nav.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_nav.rs#L26), which must return `Some(Repaint)` for a key
   it claims and `None` for a key it does not. A Ctrl chord belongs in [`src/editor/on_ctrl.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_ctrl.rs#L24), and it
   should match both the upper and lower case code the way the existing chords do. A key that should take
   over input until dismissed should open a prompt through `path_prompt::start`
   ([`src/editor/path_prompt.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/path_prompt.rs#L23)) and be handled in `path_prompt::on_key` ([`src/editor/path_prompt.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/path_prompt.rs#L32)).

Two rules that keep the model honest. Always set a short static status line on the outcome so the result
is visible, the way every existing action does ([`src/editor/event.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L53), [`src/editor/ctrl_save.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_save.rs#L32)).
Any action that appends bytes must go through `State::insert` so the `CAPACITY` bound holds, and any read
from outside the capsule must be UTF-8 checked before it enters the buffer, the way open and paste are
([`src/editor/insert.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/insert.rs#L20), [`src/editor/ctrl_open.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L36), [`src/editor/ctrl_paste.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_paste.rs#L25)).

## Talking to a service

If an action touches a file, resolve the owner pid with `resolve_owner_pid` and go through the skeleton's
vfs client rather than any raw syscall ([`src/editor/resolve_owner_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/resolve_owner_pid.rs#L21), [`src/editor/ctrl_open.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L17)).
If it needs a service the editor does not already reach, add a client under the app skeleton, not the
editor, and keep the editor holding only the app envelope. Adding a capability to the mask is a separate,
deliberate change to `Capsule.mk:11` and the requested set in
[`src/userspace/capsule_text_editor/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_text_editor/spawn.rs#L50), and it widens the blast radius, so it is not something a
feature does casually.

## Build and sign

The per-slug make targets are generated from the capsule rule template in `nonos-mk/capsule.mk` and
pulled in through `userland/capsule_text_editor/Capsule.mk:14`.

```
  make nonos-mk-text-editor              build the capsule ELF
  make nonos-mk-text-editor-sign         id cert, manifest, attestation trailer
  make nonos-mk-text-editor-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-text-editor-keys   assert the per-capsule signing keys exist
```

For a bootable desktop image that includes the editor:

```
  make nonos-mk-text-editor-prod         full desktop GUI image     Makefile:1185
```

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`; every fallible path returns through a
  status line and an `EventOutcome`, and UTF-8 decoding uses `from_utf8(...).is_ok()` and `unwrap_or("")`
  rather than an unwrapping panic. The release profile is `panic = "abort"`
  ([`userland/capsule_text_editor/Cargo.toml:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_text_editor/Cargo.toml#L26)).
- One unit per file. New actions are one file each under `src/editor/`, and `mod.rs` is used only for the
  module list and the single `pub use`, matching the existing tree ([`src/editor/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/mod.rs#L17)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_text_editor/src/main.rs        _start -> run(Editor::new); the editor module
  userland/capsule_text_editor/src/editor/        the flat module tree, one unit per file
  userland/capsule_text_editor/src/editor/mod.rs  the module list and the Editor re-export
  userland/capsule_text_editor/Capsule.mk         slug, handle, ports, capability mask; includes the targets
  userland/capsule_text_editor/Cargo.toml         the release profile and dependencies
  src/userspace/capsule_text_editor/spawn.rs      the verified spawn and the requested capability set
  nonos-mk/capsule.mk                             the nonos-mk-text-editor[-sign|-verify] target template
  Makefile                                        the -prod desktop image target
```

Every reference above is verified against those trees.
