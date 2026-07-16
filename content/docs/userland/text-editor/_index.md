---
title: "The Text Editor Capsule"
description: "The text editor is a signed NØNOS userland capsule that draws its own window, reads the keyboard, and holds one document in a fixed-capacity buffer."
weight: 400
---
The text editor is a signed NØNOS userland capsule that draws its own window, reads the keyboard, and
holds one document in a fixed-capacity buffer. It reaches the rest of the system only through
capability-checked IPC: it loads and saves through the vfs service and copies and pastes through the
clipboard service. Its source is a flat module tree, and this documentation mirrors that structure one
page per concern so a page can be read beside the code it describes.

This is a focused single-document editor, not an IDE. On this tree there is no file explorer, no tab bar,
no find or replace, no undo or redo, no selection, and no in-text caret movement. Editing is append and
backspace at the end of the buffer, and the arrow keys scroll the wrapped view rather than move an
insertion point. The capsule's own `Cargo.toml` header is stale on one point: it describes keyboard input
only and does not mention file I/O, but the capsule does load and save through vfs
([`userland/capsule_text_editor/Cargo.toml:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_text_editor/Cargo.toml#L4), [`src/editor/ctrl_open.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L23)). Everything below is verified
against the source, not the header.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `text-editor` | `userland/capsule_text_editor/Capsule.mk:1` |
| Service handle | `app.text_editor` | `Capsule.mk:2` |
| Service endpoint | `service:4726:app.text_editor` | `Capsule.mk:8` |
| Reply endpoint | `reply:4727:endpoint.app.text_editor.reply` | `Capsule.mk:9` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Window id | `0x5445_4458` | [`src/editor/manifest.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/manifest.rs#L27) |
| Window size | `500x320`, Normal, key-down only | [`src/editor/manifest.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/manifest.rs#L19), `manifest.rs:28`, `manifest.rs:33` |
| Buffer capacity | `16384` bytes | [`src/editor/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L17) |
| Default path | `/notes.txt` | [`src/editor/state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L18) |

The mask decomposes into five bits, whose values are checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| CoreExec | `0x0001` | run as a process | [`src/capabilities/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L56) |
| IPC | `0x0008` | send and receive on its endpoints | [`src/capabilities/types.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L59) |
| Memory | `0x0010` | map its own heap and stack | [`src/capabilities/types.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L60) |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | [`src/capabilities/types.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L67) |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into | [`src/capabilities/types.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L68) |

`0x0001 | 0x0008 | 0x0010 | 0x0800 | 0x1000 = 0x1819`. The spawn path requests exactly these five bits
and no others ([`src/userspace/capsule_text_editor/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_text_editor/spawn.rs#L50)). There is no Network bit, no FileSystem
bit, and no hardware, driver, or DMA capability in the mask. The editor holds no filesystem, clipboard,
network, driver, or crypto authority of its own. Every load, save, copy, and paste it performs is an
outbound IPC request to a service that does hold that right, checked at that service's boundary.
Compromising the editor yields the editor's mask and nothing more.

## The code pillars

The source under `userland/capsule_text_editor/src/` is one flat `editor` module: no subfolders, one unit
per file, with `mod.rs` holding the module list and a single re-export ([`src/editor/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/mod.rs#L17),
[`src/editor/mod.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/mod.rs#L45)). The files group into two behavioural concerns, and this documentation is one page
per concern. Data flows one way: a key comes in through `event`, is routed to an editing, navigation, or
IPC handler, mutates `State`, and `paint` projects that state into pixels.

```
  event.rs  ->  insert / backspace / on_nav  ->  State  ->  paint.rs
  key           editing and scrolling            the       the frame
  router        (in process)                      buffer    on screen
                    |
                    +->  on_ctrl -> vfs / clipboard  (outbound IPC)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [editing.md](/docs/userland/text-editor/editing/) | `event.rs`, `on_nav.rs`, `insert.rs`, `backspace.rs`, the scroll and layout helpers, `paint.rs` | The key-down router, the full keybinding list, printable insert and UTF-8 backspace, the scroll model over wrapped lines, the wrap and caret geometry, and how a frame is drawn. |
| [file-io.md](/docs/userland/text-editor/file-io/) | `on_ctrl.rs`, `ctrl_open.rs`, `ctrl_save.rs`, `ctrl_copy.rs`, `ctrl_paste.rs`, `path_prompt.rs`, `notify.rs`, `resolve_owner_pid.rs` | The control chords, the path-prompt input mode, the vfs load and save calls, the clipboard copy and paste calls, and the best-effort desktop-shell save notification. |
| [contributing.md](/docs/userland/text-editor/contributing/) | the whole tree | Where the source lives, how to add a key action or chord, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/text-editor/debugging/) | runtime | The boot marker, the status-line vocabulary, and where to look when input, a file op, or the display misbehaves. |

## Lifecycle

The editor is spawned at boot through the desktop-fleet plan and [verified spawn](/docs/security/capsules-and-trust/):
the plan calls `spawn_text_editor_capsule`, which decodes the baked trust anchor and verifies the embedded
ELF, id cert, manifest, and attestation trailer before its capabilities are held against its manifest
ceiling and its ELF is mapped ([`src/userspace/init/spawn_plan/apps_tools.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs#L24),
[`src/userspace/capsule_text_editor/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_text_editor/spawn.rs#L37), `spawn.rs:57`). `_start` hands `Editor::new` to the
app-skeleton `run`, so the runtime owns the surface, window, input subscription, and paint loop
([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28), [`src/editor/app.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/app.rs#L34)). It registers `app.text_editor` at port 4726 with a reply
inbox on 4727 and enters the input-driven paint loop. A successful spawn prints
`[APP-TEXT-EDITOR] capsule spawned` on the boot log ([`src/userspace/init/spawn_plan/apps_tools.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs#L27),
[`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); the [debugging](/docs/userland/text-editor/debugging/) page covers what each later
status word means.

The document model is deliberately small. The whole document is one fixed `16384`-byte array with a
`len`, and the caret is implicit: text is always appended at the end of the buffer and Backspace always
removes the last character, so there is no arbitrary insertion point to track ([`src/editor/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L17),
[`src/editor/insert.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/insert.rs#L20), [`src/editor/backspace.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/backspace.rs#L20)). On start the buffer is empty, the path is
`/notes.txt`, and the status line lists the four chords ([`src/editor/state_new.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state_new.rs#L20)). This is an
[app-skeleton](/docs/userland/writing-an-app/) GUI app; the vfs protocol it speaks is documented under
[../vfs/README.md](/docs/userland/vfs/).

## Source map

Everything here is drawn from `userland/capsule_text_editor/` (the capsule source and its `Capsule.mk`),
`userland/app_skeleton/src/` (the `App` runtime and the vfs and clipboard clients), the capability bits
in [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), and the kernel spawn mirror under `src/userspace/capsule_text_editor/`
and `src/userspace/init/`. Every reference above is verified against those trees.
